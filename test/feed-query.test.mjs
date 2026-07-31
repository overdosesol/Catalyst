import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFeedQuery, SORT_MODES, NARRATIVE_PHASES, FORECAST_PHASES } from '../src/db/feed-query.js';

// NB: `params` всегда заканчивается на [limit, offset] — их добавляет
// ORDER BY ... LIMIT ? OFFSET ?. Поэтому фильтровые параметры сверяем по
// countParams: это тот же список, но без хвоста пагинации.
test('окно фильтруется по last_seen_at, не first_seen_at', () => {
  const { sql, countParams } = buildFeedQuery({ cutoff: '2026-07-30 12:00:00' });
  assert.match(sql, /WHERE last_seen_at > \?/);
  assert.ok(!sql.includes('first_seen_at >'), 'окно не должно считаться по first_seen_at');
  assert.deepEqual(countParams, ['2026-07-30 12:00:00']);
});

test('без фильтров сортировка по rankScore', () => {
  const { sql } = buildFeedQuery({ cutoff: 'x' });
  assert.match(sql, /ORDER BY CAST\(JSON_EXTRACT\(raw_metrics, '\$\.rankScore'\) AS INT\) DESC/);
});

test('sort=time сортирует по first_seen_at DESC', () => {
  const { sql } = buildFeedQuery({ cutoff: 'x', sort: 'time' });
  assert.match(sql, /ORDER BY first_seen_at DESC/);
});

test('неизвестный sort откатывается на rank, а не ломает запрос', () => {
  const { sql } = buildFeedQuery({ cutoff: 'x', sort: 'нет-такого' });
  assert.match(sql, /rankScore/);
});

test('phase собирается в IN-список с плейсхолдерами', () => {
  const { sql, countParams } = buildFeedQuery({ cutoff: 'x', phase: ['early', 'strong'] });
  assert.match(sql, /JSON_EXTRACT\(raw_metrics, '\$\.narrativePhase'\) IN \(\?,\?\)/);
  assert.deepEqual(countParams, ['x', 'early', 'strong']);
});

test('мусорные значения phase отбрасываются, а не уезжают в SQL', () => {
  const { sql, countParams } = buildFeedQuery({ cutoff: 'x', phase: ['early', "'; DROP TABLE trends--"] });
  assert.deepEqual(countParams, ['x', 'early']);
  assert.ok(!sql.includes('DROP'));
});

test('пустой список phase не добавляет условия', () => {
  const { sql } = buildFeedQuery({ cutoff: 'x', phase: [] });
  assert.ok(!sql.includes('narrativePhase'));
});

test('q экранирует LIKE-wildcards и ищет по четырём колонкам', () => {
  const { sql, params } = buildFeedQuery({ cutoff: 'x', q: '100%_win' });
  assert.match(sql, /title LIKE \? ESCAPE/);
  assert.match(sql, /original_title LIKE \? ESCAPE/);
  assert.match(sql, /ai_explanation LIKE \? ESCAPE/);
  assert.match(sql, /category LIKE \? ESCAPE/);
  assert.equal(params[1], '%100\\%\\_win%');
  assert.equal(params.filter(p => p === '%100\\%\\_win%').length, 4);
});

test('countSql теряет ORDER BY / LIMIT и считает COUNT(*)', () => {
  const { countSql } = buildFeedQuery({ cutoff: 'x', limit: 20, offset: 40 });
  assert.match(countSql, /^SELECT COUNT\(\*\) as c/);
  assert.ok(!countSql.includes('ORDER BY'));
  assert.ok(!countSql.includes('LIMIT'));
});

test('countParams не содержат limit/offset', () => {
  const { params, countParams } = buildFeedQuery({ cutoff: 'x', limit: 20, offset: 40 });
  assert.deepEqual(params.slice(-2), [20, 40]);
  assert.deepEqual(countParams, ['x']);
});

test('limit зажимается в [1, 200], offset не уходит в минус', () => {
  assert.deepEqual(buildFeedQuery({ cutoff: 'x', limit: 9999 }).params.slice(-2), [200, 0]);
  assert.deepEqual(buildFeedQuery({ cutoff: 'x', limit: 0 }).params.slice(-2), [1, 0]);
  assert.deepEqual(buildFeedQuery({ cutoff: 'x', offset: -5 }).params.slice(-2), [50, 0]);
});

test('экспортируемые словари совпадают с тем, что принимает запрос', () => {
  assert.deepEqual(NARRATIVE_PHASES, ['early', 'forming', 'strong', 'saturated']);
  assert.deepEqual(SORT_MODES, ['rank', 'time', 'meme', 'emergence', 'virality']);
});

// ── Фильтры, которых в дашборде не было на сервере (Task 2) ────────────────

test('alertType собирается в IN-список по колонке', () => {
  const { sql, countParams } = buildFeedQuery({ cutoff: 'x', alertType: ['event', 'post'] });
  assert.match(sql, /AND alert_type IN \(\?,\?\)/);
  assert.deepEqual(countParams, ['x', 'event', 'post']);
});

test('alertType отбрасывает значения вне event/trend/post', () => {
  const { countParams } = buildFeedQuery({ cutoff: 'x', alertType: ['event', 'выдумка'] });
  assert.deepEqual(countParams, ['x', 'event']);
});

test('manualOnly использует тот же LIKE, что getManualTrends', () => {
  const { sql } = buildFeedQuery({ cutoff: 'x', manualOnly: true });
  assert.match(sql, /raw_metrics LIKE '%"manualSubmitted":true%'/);
});

test('manualOnly=false не добавляет условия', () => {
  const { sql } = buildFeedQuery({ cutoff: 'x', manualOnly: false });
  assert.ok(!sql.includes('manualSubmitted'));
});

test('forecastPhase фильтрует по колонке trigger_phase, а не по narrativePhase', () => {
  const { sql, countParams } = buildFeedQuery({ cutoff: 'x', forecastPhase: ['building', 'fading'] });
  assert.match(sql, /AND trigger_phase IN \(\?,\?\)/);
  assert.ok(!sql.includes('narrativePhase'));
  assert.deepEqual(countParams, ['x', 'building', 'fading']);
});

test('две фазы не смешиваются: building валиден только для forecastPhase', () => {
  assert.deepEqual(buildFeedQuery({ cutoff: 'x', phase: ['building'] }).countParams, ['x']);
  assert.deepEqual(buildFeedQuery({ cutoff: 'x', forecastPhase: ['forming'] }).countParams, ['x']);
  assert.deepEqual(FORECAST_PHASES, ['early', 'building', 'peaking', 'saturated', 'fading']);
});

test('minScore фильтрует по колонке score', () => {
  const { sql, countParams } = buildFeedQuery({ cutoff: 'x', minScore: 70 });
  assert.match(sql, /AND score >= \?/);
  assert.deepEqual(countParams, ['x', 70]);
});

test('pipelineStatus фильтрует точным совпадением', () => {
  const { sql, countParams } = buildFeedQuery({ cutoff: 'x', pipelineStatus: 'scored' });
  assert.match(sql, /AND pipeline_status = \?/);
  assert.deepEqual(countParams, ['x', 'scored']);
});

test('невалидный pipelineStatus игнорируется', () => {
  assert.deepEqual(buildFeedQuery({ cutoff: 'x', pipelineStatus: 'нет' }).countParams, ['x']);
});

test('sources (план-гейт) и source (выбор юзера) применяются независимо', () => {
  // Критично: это ДВА разных условия, а не одно. Схлопывание их в пересечение
  // даёт дыру — пустое пересечение читалось бы как «фильтра нет», и юзер
  // увидел бы источники, закрытые его планом.
  const { sql, countParams } = buildFeedQuery({
    cutoff: 'x', sources: ['reddit', 'google_trends'], source: 'tiktok',
  });
  assert.match(sql, /AND source IN \(\?,\?\)/);
  assert.match(sql, /AND source = \?/);
  assert.deepEqual(countParams, ['x', 'reddit', 'google_trends', 'tiktok']);
});

test('одиночный source работает без план-гейта', () => {
  const { sql, countParams } = buildFeedQuery({ cutoff: 'x', source: 'reddit' });
  assert.match(sql, /AND source = \?/);
  assert.ok(!sql.includes('source IN'));
  assert.deepEqual(countParams, ['x', 'reddit']);
});

test('новые фильтры попадают и в countParams', () => {
  const { countParams } = buildFeedQuery({ cutoff: 'x', alertType: ['event'], minScore: 50, limit: 10 });
  assert.deepEqual(countParams, ['x', 'event', 50]);
});
