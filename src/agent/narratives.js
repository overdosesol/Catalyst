/**
 * Слой чтения для агентского MCP.
 *
 * Инвариант: SQL ленты здесь НЕ строится — только через buildFeedQuery, тот же,
 * что у дашборда. Иначе «агент видит то же, что сайт» перестаёт быть правдой.
 *
 * Плановые ограничения (getPlanEntitlements) тут намеренно НЕ применяются:
 * агент операторский, читает на admin-уровне — все источники, вся история.
 */

import {
  buildFeedQuery, NARRATIVE_PHASES, FORECAST_PHASES,
  SORT_MODES, ALERT_TYPES, PIPELINE_STATUSES,
} from '../db/feed-query.js';
import { sqliteCutoff } from '../utils/sqlite-time.js';
import {
  truncateText, pickMetrics, enforceBudget, SEARCH_DESC_CHARS, DETAIL_TEXT_CHARS,
} from './shape.js';

const DEFAULT_HOURS = 24;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 100;

const parseMetrics = row => {
  try {
    return typeof row.raw_metrics === 'string'
      ? JSON.parse(row.raw_metrics || '{}')
      : (row.raw_metrics || {});
  } catch { return {}; }
};

const parseJsonArray = raw => {
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
};

/** Компактная карточка для поиска. Без raw_metrics — они едут в get_narrative. */
function toCard(row) {
  const m = parseMetrics(row);
  const desc = truncateText(row.description, SEARCH_DESC_CHARS);
  return {
    id:              row.id,
    title:           row.title,
    source:          row.source,
    category:        row.category,
    alert_type:      row.alert_type || m.alertType || null,
    score:           row.score,
    // save_only-строки не проходили Stage 1 — score у них 0 ПО ОПРЕДЕЛЕНИЮ,
    // а не потому что нарратив плохой. Поле обязано ехать в каждой карточке.
    pipeline_status: row.pipeline_status,
    narrative_phase: m.narrativePhase ?? null,
    forecast_phase:  row.trigger_phase || null,
    meme_potential:  m.memePotential ?? 0,
    emergence_score: m.emergenceScore ?? 0,
    rank_score:      m.rankScore ?? null,
    url:             row.url,
    description:     desc.text,
    description_truncated: desc.truncated,
    first_seen_at:   row.first_seen_at,
    last_seen_at:    row.last_seen_at,
    times_seen:      row.times_seen,
  };
}

export function searchNarratives(db, filters = {}) {
  const hours  = Number.isFinite(+filters.hours) && +filters.hours > 0 ? +filters.hours : DEFAULT_HOURS;
  const limit  = Math.max(1, Math.min(MAX_LIMIT, parseInt(filters.limit, 10) || DEFAULT_LIMIT));
  const offset = Math.max(0, parseInt(filters.offset, 10) || 0);

  const { sql, params, countSql, countParams } = buildFeedQuery({
    cutoff:         sqliteCutoff(hours * 3_600_000),
    sort:           filters.sort,
    sources:        Array.isArray(filters.source) ? filters.source : undefined,
    source:         typeof filters.source === 'string' ? filters.source : undefined,
    category:       filters.category,
    phase:          filters.narrative_phase,
    forecastPhase:  filters.forecast_phase,
    alertType:      filters.alert_type,
    manualOnly:     filters.manual_only === true,
    pipelineStatus: filters.pipeline_status,
    minScore:       filters.min_score,
    minEmergence:   filters.min_emergence,
    q:              filters.q,
    limit,
    offset,
  });

  const rows  = db.db.prepare(sql).all(...params);
  const total = db.db.prepare(countSql).get(...countParams)?.c ?? 0;

  return enforceBudget({
    items: rows.map(toCard),
    total, limit, offset, window_hours: hours,
  });
}

export function getNarrative(db, id) {
  const numericId = parseInt(id, 10);
  if (!Number.isFinite(numericId)) return { error: 'invalid_id', id };

  const row = db.db.prepare(`SELECT * FROM trends WHERE id = ?`).get(numericId);
  if (!row) return { error: 'not_found', id: numericId };

  const m = parseMetrics(row);
  const explanation = truncateText(row.ai_explanation, DETAIL_TEXT_CHARS);
  const description = truncateText(row.description, DETAIL_TEXT_CHARS);

  let feedback = { likes: 0, dislikes: 0, weighted_score: 0 };
  try {
    const fb = db.getFeedbackStats?.(row.id);
    if (fb) feedback = { likes: fb.likes || 0, dislikes: fb.dislikes || 0, weighted_score: fb.weightedScore || 0 };
  } catch { /* фидбек необязателен — не роняем чтение нарратива */ }

  return enforceBudget({
    id:              row.id,
    title:           row.title,
    original_title:  row.original_title || row.title,
    source:          row.source,
    url:             row.url,
    category:        row.category,
    sentiment:       row.sentiment,
    alert_type:      row.alert_type || m.alertType || null,
    score:           row.score,
    pipeline_status: row.pipeline_status,
    predicted_lifespan: row.predicted_lifespan,
    description:     description.text,
    description_truncated: description.truncated,
    ai_explanation:  explanation.text,
    ai_explanation_truncated: explanation.truncated,
    why_now:         row.why_now || '',
    metrics:         pickMetrics(m),
    forecast: row.trigger_text ? {
      text:        row.trigger_text,
      phase:       row.trigger_phase || null,
      window:      row.trigger_window || null,
      drivers:     parseJsonArray(row.trigger_drivers),
      risks:       parseJsonArray(row.trigger_risks),
      confidence:  row.trigger_confidence ?? 0,
      sources:     parseJsonArray(row.trigger_sources),
      searched_at: row.trigger_searched_at || null,
    } : null,
    feedback,
    first_seen_at: row.first_seen_at,
    last_seen_at:  row.last_seen_at,
    times_seen:    row.times_seen,
  });
}

/**
 * Допустимые значения фильтров. Категории берутся ИЗ БД: захардкоженный список
 * протухнет, модель начнёт искать по несуществующим значениям и получать пустые
 * ответы, не понимая почему.
 */
export function getFilterValues(db) {
  const categories = db.db.prepare(
    `SELECT DISTINCT category FROM trends WHERE category IS NOT NULL AND category != '' ORDER BY category`
  ).all().map(r => r.category);

  const sources = db.db.prepare(
    `SELECT DISTINCT source FROM trends ORDER BY source`
  ).all().map(r => r.source);

  return {
    categories,
    sources,
    sort:            SORT_MODES,
    narrative_phase: NARRATIVE_PHASES,
    forecast_phase:  FORECAST_PHASES,
    alert_type:      ALERT_TYPES,
    pipeline_status: PIPELINE_STATUSES,
  };
}

/** Сводка за окно. Зеркалит дашбордный /api/stats, но без плановых урезаний. */
export function getStats(db, hours = DEFAULT_HOURS) {
  const h = Number.isFinite(+hours) && +hours > 0 ? +hours : DEFAULT_HOURS;
  const cutoff = sqliteCutoff(h * 3_600_000);
  const one  = sql => db.db.prepare(sql).get(cutoff);
  const many = sql => db.db.prepare(sql).all(cutoff);

  return {
    window_hours: h,
    total:              one(`SELECT COUNT(*) as c FROM trends WHERE last_seen_at > ?`).c,
    by_source:          many(`SELECT source, COUNT(*) as count FROM trends WHERE last_seen_at > ? GROUP BY source`),
    by_category:        many(`SELECT category, COUNT(*) as count FROM trends WHERE last_seen_at > ? GROUP BY category ORDER BY count DESC`),
    by_pipeline_status: many(`SELECT pipeline_status, COUNT(*) as count FROM trends WHERE last_seen_at > ? GROUP BY pipeline_status`),
    avg_score:          one(`SELECT AVG(score) as avg FROM trends WHERE last_seen_at > ? AND score > 0`).avg || 0,
  };
}

/**
 * Медиа отдельным вызовом: тяжёлый payload не должен ехать с каждым чтением.
 *
 * Пути к полям выяснены по коду, не угаданы:
 *   - `imageUrl` / `imageUrls[0]` — так их читает сам капшнер
 *     (gemini-captioner.js:503), `videoUrl` — там же на :501;
 *   - капшн живёт в `raw_metrics.preStage.gemini`: pre-stage.js:82 кладёт
 *     `{ nano, gemini, elapsedMs }`, database.js:1538 сохраняет `preStage`
 *     внутрь `raw_metrics`, а поля объекта заданы в gemini-captioner.js:927-933.
 *
 * `visible_text` и `spoken_text` для оценки нарратива часто ценнее самой
 * подписи: это буквальный текст на картинке и расшифровка речи из ролика.
 */
export function getNarrativeMedia(db, id) {
  const numericId = parseInt(id, 10);
  if (!Number.isFinite(numericId)) return { error: 'invalid_id', id };

  const row = db.db.prepare(`SELECT id, url, raw_metrics FROM trends WHERE id = ?`).get(numericId);
  if (!row) return { error: 'not_found', id: numericId };

  const m = parseMetrics(row);
  const g = m.preStage?.gemini || null;
  const nonEmpty = v => (typeof v === 'string' && v.trim() !== '') ? v : null;

  return {
    id:            row.id,
    post_url:      row.url,
    image_url:     m.imageUrl || (Array.isArray(m.imageUrls) ? m.imageUrls[0] : null) || null,
    video_url:     m.videoUrl || null,
    picture_source: m.pictureSource || null,
    // Разбор изображения/видео от Gemini. null, если PreStage не отработал
    // (он деградирует молча по дизайну — см. pre-stage.js).
    caption:       g ? nonEmpty(g.visualCaption) : null,
    visible_text:  g ? nonEmpty(g.visibleText)   : null,
    video_summary: g ? nonEmpty(g.videoSummary)  : null,
    audio_summary: g ? nonEmpty(g.audioSummary)  : null,
    spoken_text:   g ? nonEmpty(g.spokenText)    : null,
    caption_available: !!g,
  };
}
