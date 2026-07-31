import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import TrendDatabase from '../src/db/database.js';
import { truncateText, pickMetrics, enforceBudget, MAX_RESPONSE_BYTES } from '../src/agent/shape.js';
import {
  searchNarratives, getNarrative, getNarrativeMedia, getStats, getFilterValues,
} from '../src/agent/narratives.js';
import { buildInstructions, buildResource, RESOURCE_URIS } from '../src/agent/docs.js';
import { buildTools } from '../src/agent/tools.js';
import AgentMcpServer, { checkAuth, AGENT_KEY_PATTERN } from '../src/agent/server.js';
import {
  getAgentKey, generateAgentKey, revokeAgentKey,
  isAgentApiEnabled, setAgentApiEnabled, maskAgentKey,
} from '../src/agent/key.js';
import { NARRATIVE_PHASES, FORECAST_PHASES } from '../src/db/feed-query.js';

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function withDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalyst-agent-'));
  const db = new TrendDatabase(path.join(dir, 'test.db'), silentLogger);
  try { return fn(db); }
  finally {
    try { db.db.close(); } catch { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Вставляет нарратив напрямую — коллекторы в юнит-тестах не гоняем. */
function seed(db, over = {}) {
  const { metrics, ...rest } = over;
  const row = {
    source: 'reddit', title: 'Test narrative', description: 'д'.repeat(500),
    url: 'https://example.com/x', score: 75, category: 'meme',
    ai_explanation: 'потому что', alert_type: 'trend', pipeline_status: 'scored',
    raw_metrics: JSON.stringify({
      memePotential: 80, emergenceScore: 40, rankScore: 70,
      narrativePhase: 'strong', secretInternalField: 'нельзя', ...metrics,
    }),
    ...rest,
  };
  const cols = Object.keys(row);
  return db.db.prepare(
    `INSERT INTO trends (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).run(...cols.map(c => row[c])).lastInsertRowid;
}

// ── shape.js: бюджет выдачи ───────────────────────────────────────────────

test('короткий текст не трогается и не помечается', () => {
  assert.deepEqual(truncateText('коротко', 100), { text: 'коротко', truncated: false });
});

test('длинный текст режется и помечается', () => {
  const r = truncateText('а'.repeat(300), 200);
  assert.equal(r.text.length, 200);
  assert.equal(r.truncated, true);
});

test('пустой и отсутствующий текст дают пустую строку без флага', () => {
  assert.deepEqual(truncateText('', 10),        { text: '', truncated: false });
  assert.deepEqual(truncateText(null, 10),      { text: '', truncated: false });
  assert.deepEqual(truncateText(undefined, 10), { text: '', truncated: false });
});

test('pickMetrics отдаёт только поля из вайтлиста', () => {
  const out = pickMetrics({ memePotential: 80, secretInternalField: 'нельзя', views: 1000 });
  assert.equal(out.memePotential, 80);
  assert.equal(out.views, 1000);
  assert.ok(!('secretInternalField' in out));
});

test('pickMetrics переживает мусор вместо объекта', () => {
  assert.deepEqual(pickMetrics(null), {});
  assert.deepEqual(pickMetrics('строка'), {});
  assert.deepEqual(pickMetrics([1, 2]), {});
});

test('enforceBudget пропускает то, что влезает', () => {
  const out = enforceBudget({ items: [1, 2, 3] });
  assert.deepEqual(out.items, [1, 2, 3]);
  assert.ok(!out.response_truncated);
});

test('enforceBudget режет массив, а не отдаёт мегабайт', () => {
  const payload = { items: Array.from({ length: 5000 }, (_, i) => ({ i, pad: 'x'.repeat(200) })) };
  const out = enforceBudget(payload);
  assert.ok(out.items.length < 5000, 'массив должен быть урезан');
  assert.equal(out.response_truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(out), 'utf8') <= MAX_RESPONSE_BYTES,
    'урезанный ответ обязан влезать в бюджет ЦЕЛИКОМ, вместе с флагами');
});

test('enforceBudget сообщает, сколько элементов осталось', () => {
  const payload = { items: Array.from({ length: 5000 }, (_, i) => ({ i, pad: 'x'.repeat(200) })) };
  const out = enforceBudget(payload);
  assert.equal(out.items_returned, out.items.length);
});

test('enforceBudget помечает и одиночный объект, который не влез', () => {
  // Резать нечего — но модель обязана знать, что ответ ненормального размера.
  const out = enforceBudget({ id: 1, blob: 'x'.repeat(MAX_RESPONSE_BYTES + 100) });
  assert.equal(out.response_truncated, true);
});

// ── narratives.js: слой чтения ────────────────────────────────────────────

test('searchNarratives отдаёт карточки с обрезанным описанием', () => {
  withDb(db => {
    seed(db);
    const out = searchNarratives(db, {});
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].description.length, 200);
    assert.equal(out.items[0].description_truncated, true);
  });
});

test('searchNarratives не отдаёт raw_metrics в карточках', () => {
  withDb(db => {
    seed(db);
    const out = searchNarratives(db, {});
    assert.ok(!('raw_metrics' in out.items[0]));
    assert.ok(!JSON.stringify(out.items[0]).includes('secretInternalField'));
  });
});

test('searchNarratives всегда сообщает total', () => {
  withDb(db => {
    seed(db); seed(db); seed(db);
    const out = searchNarratives(db, { limit: 1 });
    assert.equal(out.items.length, 1);
    assert.equal(out.total, 3);
  });
});

test('searchNarratives видит все 5 источников — план-гейта нет', () => {
  withDb(db => {
    seed(db, { source: 'tiktok' });
    seed(db, { source: 'twitter' });
    assert.equal(searchNarratives(db, {}).total, 2);
  });
});

test('limit зажимается сотней', () => {
  withDb(db => {
    seed(db);
    assert.equal(searchNarratives(db, { limit: 9999 }).limit, 100);
  });
});

test('searchNarratives фильтрует по alert_type серверно, а не по загруженной странице', () => {
  withDb(db => {
    for (let i = 0; i < 30; i++) seed(db, { alert_type: 'trend' });
    seed(db, { alert_type: 'event', title: 'Единственный event' });
    // limit меньше, чем строк с другим типом: клиентский фильтр здесь дал бы 0.
    const out = searchNarratives(db, { alert_type: ['event'], limit: 5 });
    assert.equal(out.total, 1);
    assert.equal(out.items[0].title, 'Единственный event');
  });
});

test('getNarrative отдаёт метрики по вайтлисту', () => {
  withDb(db => {
    const id = seed(db);
    const n = getNarrative(db, id);
    assert.equal(n.metrics.memePotential, 80);
    assert.ok(!('secretInternalField' in n.metrics));
  });
});

test('getNarrative на несуществующем id даёт структурированный not_found', () => {
  withDb(db => {
    const n = getNarrative(db, 999999);
    assert.equal(n.error, 'not_found');
    assert.ok(!(n instanceof Error));
  });
});

test('getNarrative на мусорном id не кидает', () => {
  withDb(db => {
    assert.equal(getNarrative(db, 'абв').error, 'invalid_id');
  });
});

test('getNarrative отдаёт pipeline_status — модель обязана его видеть', () => {
  withDb(db => {
    const id = seed(db, { pipeline_status: 'save_only', score: 0 });
    assert.equal(getNarrative(db, id).pipeline_status, 'save_only');
  });
});

test('getFilterValues берёт категории из БД, а не из хардкода', () => {
  withDb(db => {
    seed(db, { category: 'animals' });
    seed(db, { category: 'events' });
    const v = getFilterValues(db);
    assert.ok(v.categories.includes('animals'));
    assert.ok(v.categories.includes('events'));
  });
});

test('getFilterValues отдаёт обе фазы раздельно', () => {
  withDb(db => {
    const v = getFilterValues(db);
    assert.deepEqual(v.narrative_phase, ['early', 'forming', 'strong', 'saturated']);
    assert.deepEqual(v.forecast_phase, ['early', 'building', 'peaking', 'saturated', 'fading']);
  });
});

test('getStats считает разбивку по pipeline_status', () => {
  withDb(db => {
    seed(db, { pipeline_status: 'scored' });
    seed(db, { pipeline_status: 'save_only' });
    const s = getStats(db, 24);
    assert.equal(s.total, 2);
    const byStatus = Object.fromEntries(s.by_pipeline_status.map(r => [r.pipeline_status, r.count]));
    assert.equal(byStatus.scored, 1);
    assert.equal(byStatus.save_only, 1);
  });
});

test('getNarrativeMedia читает капшн из raw_metrics.preStage.gemini', () => {
  // Форма подтверждена по коду: pre-stage.js:82 кладёт { nano, gemini, elapsedMs },
  // database.js:1538 сохраняет preStage внутрь raw_metrics,
  // gemini-captioner.js:927-933 задаёт поля объекта gemini.
  withDb(db => {
    const id = seed(db, { metrics: {
      imageUrl: 'https://img.example/a.jpg',
      preStage: { gemini: {
        visualCaption: 'Кот в коробке',
        visibleText:   'ЛОЛ',
        spokenText:    'смотрите какой кот',
        videoSummary:  '',
      } },
    } });
    const m = getNarrativeMedia(db, id);
    assert.equal(m.image_url, 'https://img.example/a.jpg');
    assert.equal(m.caption, 'Кот в коробке');
    assert.equal(m.visible_text, 'ЛОЛ');
    assert.equal(m.spoken_text, 'смотрите какой кот');
  });
});

test('getNarrativeMedia переживает отсутствие preStage', () => {
  withDb(db => {
    const id = seed(db);
    const m = getNarrativeMedia(db, id);
    assert.equal(m.caption, null);
    assert.equal(m.error, undefined);
  });
});

test('getNarrativeMedia берёт первую картинку из imageUrls, если imageUrl пуст', () => {
  withDb(db => {
    const id = seed(db, { metrics: { imageUrls: ['https://img.example/b.jpg'] } });
    assert.equal(getNarrativeMedia(db, id).image_url, 'https://img.example/b.jpg');
  });
});

// ── docs.js: документация, едущая внутри сервера ──────────────────────────

test('instructions объясняют save_only — самый важный факт', () => {
  withDb(db => {
    const text = buildInstructions(db);
    assert.match(text, /save_only/);
    assert.match(text, /Stage 1/);
  });
});

test('instructions разводят две фазы', () => {
  withDb(db => {
    const text = buildInstructions(db);
    assert.match(text, /narrative_phase/);
    assert.match(text, /forecast_phase/);
  });
});

test('instructions предупреждают про prompt injection', () => {
  withDb(db => {
    assert.match(buildInstructions(db), /инструкц|instruction/i);
  });
});

test('instructions честно говорят, что кластеризации нет', () => {
  withDb(db => {
    assert.match(buildInstructions(db), /кластер|cluster/i);
  });
});

test('instructions короткие — они всегда в контексте', () => {
  withDb(db => {
    assert.ok(buildInstructions(db).length < 4000,
      'instructions едут в каждой сессии; длинное место — ресурсы');
  });
});

test('глоссарий перечисляет фазы из источника истины, а не из головы', () => {
  withDb(db => {
    const text = buildResource(db, RESOURCE_URIS.glossary);
    for (const p of [...NARRATIVE_PHASES, ...FORECAST_PHASES]) {
      assert.ok(text.includes(p), `глоссарий молчит про фазу ${p}`);
    }
  });
});

test('глоссарий не выдумывает фаз, которых нет в словарях', () => {
  withDb(db => {
    const glossary = buildResource(db, RESOURCE_URIS.glossary);
    for (const fake of ['emerging', 'declining', 'growing', 'mature', 'dormant']) {
      assert.ok(!glossary.includes(fake), `глоссарий выдумал фазу: ${fake}`);
    }
  });
});

test('ресурс sources отражает то, что реально лежит в БД', () => {
  withDb(db => {
    seed(db, { source: 'tiktok' });
    assert.match(buildResource(db, RESOURCE_URIS.sources), /tiktok/);
  });
});

test('категории в instructions приходят из БД, а не из хардкода', () => {
  withDb(db => {
    seed(db, { category: 'animals' });
    assert.match(buildInstructions(db), /animals/);
  });
});

test('неизвестный URI ресурса не кидает исключение', () => {
  withDb(db => {
    assert.match(buildResource(db, 'catalyst://docs/выдумка'), /unknown/i);
  });
});

// ── tools.js: то, по чему модель выбирает вызов ───────────────────────────

test('зарегистрированы ровно пять инструментов', () => {
  withDb(db => {
    const names = buildTools(db).map(t => t.name).sort();
    assert.deepEqual(names, ['get_narrative', 'get_narrative_media', 'get_stats',
                             'list_filter_values', 'search_narratives']);
  });
});

test('у каждого инструмента непустое описание', () => {
  withDb(db => {
    for (const t of buildTools(db)) {
      assert.ok(t.description && t.description.length > 20, `${t.name} без описания`);
    }
  });
});

test('у каждого параметра непустое описание — модель читает только их', () => {
  withDb(db => {
    for (const t of buildTools(db)) {
      for (const [name, schema] of Object.entries(t.inputSchema.properties || {})) {
        assert.ok(schema.description && schema.description.length > 10,
          `${t.name}.${name} без описания`);
      }
    }
  });
});

test('у каждого enum-параметра перечислены допустимые значения', () => {
  withDb(db => {
    const props = buildTools(db).find(t => t.name === 'search_narratives').inputSchema.properties;
    assert.deepEqual(props.sort.enum, ['rank', 'time', 'meme', 'emergence', 'virality']);
    assert.deepEqual(props.narrative_phase.items.enum, ['early', 'forming', 'strong', 'saturated']);
    assert.deepEqual(props.forecast_phase.items.enum, ['early', 'building', 'peaking', 'saturated', 'fading']);
    assert.deepEqual(props.alert_type.items.enum, ['event', 'trend', 'post']);
    assert.deepEqual(props.pipeline_status.enum, ['scored', 'save_only']);
  });
});

test('описание sort объясняет, что rank — это «топ»', () => {
  withDb(db => {
    const props = buildTools(db).find(t => t.name === 'search_narratives').inputSchema.properties;
    assert.match(props.sort.description, /топ|top/i);
  });
});

test('описание search предупреждает про save_only', () => {
  withDb(db => {
    const t = buildTools(db).find(x => x.name === 'search_narratives');
    assert.match(t.description, /save_only|scored/);
  });
});

test('search реально ищет через слой чтения', () => {
  withDb(db => {
    seed(db);
    const t = buildTools(db).find(x => x.name === 'search_narratives');
    assert.equal(t.handler({}).total, 1);
  });
});

test('get_narrative на несуществующем id не кидает', () => {
  withDb(db => {
    const t = buildTools(db).find(x => x.name === 'get_narrative');
    assert.equal(t.handler({ id: 424242 }).error, 'not_found');
  });
});

// ── server.js: авторизация ────────────────────────────────────────────────

const GOOD_KEY = 'cak_' + 'a'.repeat(64);

test('валидный ключ проходит', () => {
  assert.equal(checkAuth(`Bearer ${GOOD_KEY}`, GOOD_KEY), true);
});

test('пустой заголовок отвергается', () => {
  assert.equal(checkAuth('', GOOD_KEY), false);
  assert.equal(checkAuth(undefined, GOOD_KEY), false);
});

test('чужой ключ отвергается', () => {
  assert.equal(checkAuth(`Bearer cak_${'b'.repeat(64)}`, GOOD_KEY), false);
});

test('ключ без префикса cak_ отвергается — это форма сессионного токена дашборда', () => {
  // Ключевая защита: даже если строки совпадают, голый 64-hex не должен
  // приниматься агентским эндпоинтом, а cak_-ключ — дашбордом.
  const bare = 'a'.repeat(64);
  assert.equal(checkAuth(`Bearer ${bare}`, bare), false);
});

test('схема не Bearer отвергается', () => {
  assert.equal(checkAuth(`Basic ${GOOD_KEY}`, GOOD_KEY), false);
});

test('пустой настроенный ключ не пускает никого', () => {
  assert.equal(checkAuth(`Bearer ${GOOD_KEY}`, ''), false);
  assert.equal(checkAuth('Bearer ', ''), false);
  assert.equal(checkAuth(`Bearer ${GOOD_KEY}`, undefined), false);
});

test('паттерн ключа требует ровно 64 hex после cak_', () => {
  assert.ok(AGENT_KEY_PATTERN.test(GOOD_KEY));
  assert.ok(!AGENT_KEY_PATTERN.test('cak_' + 'a'.repeat(63)));
  assert.ok(!AGENT_KEY_PATTERN.test('cak_' + 'a'.repeat(65)));
  assert.ok(!AGENT_KEY_PATTERN.test('cak_' + 'z'.repeat(64)));
  assert.ok(!AGENT_KEY_PATTERN.test('a'.repeat(64)));
});

test('инструменты без обязательных полей вызываются без аргументов', () => {
  withDb(db => {
    seed(db);
    for (const name of ['search_narratives', 'list_filter_values', 'get_stats']) {
      const t = buildTools(db).find(x => x.name === name);
      assert.doesNotThrow(() => t.handler(), `${name} упал на пустом вызове`);
      assert.doesNotThrow(() => t.handler({}), `${name} упал на пустом объекте`);
    }
  });
});

// ── Инварианты, ловящие самые дорогие ошибки ──────────────────────────────

/** Снимок числа строк по всем пользовательским таблицам. */
function rowCounts(db) {
  const tables = db.db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  ).all().map(r => r.name);
  const counts = {};
  for (const t of tables) counts[t] = db.db.prepare(`SELECT COUNT(*) as c FROM "${t}"`).get().c;
  return counts;
}

test('прогон всех инструментов не меняет ни одной строки в БД', () => {
  withDb(db => {
    const id = seed(db);
    seed(db, { source: 'tiktok', category: 'animals' });

    const before = rowCounts(db);

    for (const tool of buildTools(db)) {
      const args = tool.name === 'search_narratives' ? { limit: 50 }
                 : tool.name === 'get_stats'         ? { hours: 48 }
                 : tool.inputSchema.required?.includes('id') ? { id } : {};
      tool.handler(args);
    }
    buildInstructions(db);
    for (const uri of Object.values(RESOURCE_URIS)) buildResource(db, uri);

    assert.deepEqual(rowCounts(db), before, 'read-only слой не имеет права ничего писать');
  });
});

test('снимок покрывает непустой набор таблиц — иначе инвариант доказывал бы пустоту', () => {
  withDb(db => {
    const counts = rowCounts(db);
    assert.ok(Object.keys(counts).length > 5, 'таблиц должно быть много, иначе проверка холостая');
    assert.ok('trends' in counts);
    assert.ok('users' in counts);
  });
});

test('kill-switch читается из настроек и по умолчанию включён', () => {
  withDb(db => {
    assert.equal(isAgentApiEnabled(db), true);
    setAgentApiEnabled(db, false);
    assert.equal(isAgentApiEnabled(db), false);
    setAgentApiEnabled(db, true);
    assert.equal(isAgentApiEnabled(db), true);
  });
});

// ── key.js: выпуск и ротация ключа из админки ─────────────────────────────

test('пока ключ не выпущен, getAgentKey отдаёт пустую строку', () => {
  withDb(db => assert.equal(getAgentKey(db), ''));
});

test('generateAgentKey выпускает ключ нужного формата и сохраняет его', () => {
  withDb(db => {
    const key = generateAgentKey(db);
    assert.ok(AGENT_KEY_PATTERN.test(key), `формат ключа неверен: ${key}`);
    assert.equal(getAgentKey(db), key);
  });
});

test('каждый выпуск даёт новый ключ', () => {
  withDb(db => {
    const a = generateAgentKey(db);
    const b = generateAgentKey(db);
    assert.notEqual(a, b);
    assert.equal(getAgentKey(db), b, 'в настройках должен остаться последний');
  });
});

test('revokeAgentKey закрывает доступ', () => {
  withDb(db => {
    generateAgentKey(db);
    revokeAgentKey(db);
    assert.equal(getAgentKey(db), '');
    assert.equal(checkAuth(`Bearer ${GOOD_KEY}`, getAgentKey(db)), false);
  });
});

test('мусор в настройке не принимается за ключ', () => {
  withDb(db => {
    db.setSetting('agentApiKey', 'cak_короткий');
    assert.equal(getAgentKey(db), '', 'ключ не по формату должен читаться как отсутствующий');
  });
});

test('maskAgentKey не раскрывает середину', () => {
  const masked = maskAgentKey(GOOD_KEY);
  assert.ok(masked.startsWith('cak_aaaa'));
  assert.ok(masked.includes('…'));
  assert.ok(masked.length < 20);
  assert.equal(maskAgentKey(''), '');
});

// ── End-to-end по реальному HTTP ──────────────────────────────────────────
// Поднимаем настоящий сервер на временной БД и ходим в него настоящими
// запросами. Юнит-тесты выше проверяют куски; здесь проверяется, что связка
// «HTTP → auth → MCP-транспорт → инструмент» работает целиком.

/**
 * Поднимает сервер на свободном порту, отдаёт { db, port, srv }.
 * Ключ кладётся в БД — так же, как его выпускает админка.
 */
async function withServer(fn, { key = GOOD_KEY, enabled = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalyst-e2e-'));
  const db = new TrendDatabase(path.join(dir, 'test.db'), silentLogger);
  if (key !== null) db.setSetting('agentApiKey', key);
  const srv = new AgentMcpServer(
    { agent: { enabled, port: 0 } }, silentLogger, db,
  );
  srv.start();
  try {
    if (srv.server) {
      await new Promise(r => srv.server.listening ? r() : srv.server.once('listening', r));
    }
    return await fn({ db, port: srv.server?.address()?.port, srv });
  } finally {
    await srv.stop(2000);
    try { db.db.close(); } catch { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const rpc = (port, body, headers = {}) => fetch(`http://127.0.0.1:${port}/mcp`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...headers,
  },
  body: JSON.stringify(body),
});

const INIT = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  },
};

/** Ответ приходит либо JSON, либо SSE-потоком — разбираем оба. */
async function readRpc(res) {
  const text = await res.text();
  if (text.startsWith('event:') || text.includes('\ndata: ')) {
    const line = text.split('\n').find(l => l.startsWith('data: '));
    return JSON.parse(line.slice(6));
  }
  return JSON.parse(text);
}

test('e2e: без ключа — 401, до всякой работы', async () => {
  await withServer(async ({ port }) => {
    const res = await rpc(port, INIT);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate')?.includes('Bearer'), true);
  });
});

test('e2e: чужой ключ — 401', async () => {
  await withServer(async ({ port }) => {
    const res = await rpc(port, INIT, { Authorization: `Bearer cak_${'b'.repeat(64)}` });
    assert.equal(res.status, 401);
  });
});

test('e2e: без выпущенного ключа эндпоинт отвечает 401 всем', async () => {
  // Ключ выпускается из админки, поэтому его отсутствие — рабочее состояние,
  // а не повод не стартовать. Безопасность держится тем, что checkAuth с
  // пустым ключом всегда false.
  await withServer(async ({ port }) => {
    const res = await rpc(port, INIT, { Authorization: `Bearer ${GOOD_KEY}` });
    assert.equal(res.status, 401);
  }, { key: null });
});

test('e2e: повреждённый ключ в настройках не открывает доступ', async () => {
  // Заголовок обязан быть ASCII, поэтому подставляем ровно ту строку,
  // что лежит в настройке: совпадение не должно помочь — ключ не по формату
  // читается как отсутствующий.
  const junk = 'not-a-valid-key';
  await withServer(async ({ port }) => {
    const res = await rpc(port, INIT, { Authorization: `Bearer ${junk}` });
    assert.equal(res.status, 401);
  }, { key: junk });
});

test('e2e: ротация ключа действует сразу, без рестарта', async () => {
  await withServer(async ({ db, port }) => {
    const ok = await rpc(port, INIT, { Authorization: `Bearer ${GOOD_KEY}` });
    assert.equal(ok.status, 200);

    const fresh = generateAgentKey(db);
    assert.notEqual(fresh, GOOD_KEY);

    const stale = await rpc(port, INIT, { Authorization: `Bearer ${GOOD_KEY}` });
    assert.equal(stale.status, 401, 'старый ключ обязан перестать работать немедленно');

    const renewed = await rpc(port, INIT, { Authorization: `Bearer ${fresh}` });
    assert.equal(renewed.status, 200, 'новый ключ обязан заработать без рестарта');
  });
});

test('e2e: выключенный сервер не слушает вовсе', async () => {
  await withServer(async ({ srv }) => {
    assert.equal(srv.server, null);
  }, { enabled: false });
});

test('e2e: initialize отдаёт instructions с предупреждением про save_only', async () => {
  await withServer(async ({ port }) => {
    const res = await rpc(port, INIT, { Authorization: `Bearer ${GOOD_KEY}` });
    assert.equal(res.status, 200);
    const body = await readRpc(res);
    assert.match(body.result.instructions, /save_only/);
    assert.equal(body.result.serverInfo.name, 'catalyst');
  });
});

test('e2e: tools/list отдаёт все пять инструментов со схемами', async () => {
  await withServer(async ({ port }) => {
    await rpc(port, INIT, { Authorization: `Bearer ${GOOD_KEY}` });
    const res = await rpc(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { Authorization: `Bearer ${GOOD_KEY}` });
    const body = await readRpc(res);
    const names = body.result.tools.map(t => t.name).sort();
    assert.deepEqual(names, ['get_narrative', 'get_narrative_media', 'get_stats',
                             'list_filter_values', 'search_narratives']);
    const search = body.result.tools.find(t => t.name === 'search_narratives');
    assert.equal(search.inputSchema.type, 'object');
    assert.deepEqual(search.inputSchema.properties.sort.enum,
      ['rank', 'time', 'meme', 'emergence', 'virality']);
  });
});

test('e2e: tools/call реально возвращает данные из БД', async () => {
  await withServer(async ({ db, port }) => {
    seed(db, { title: 'Нарратив через HTTP' });
    await rpc(port, INIT, { Authorization: `Bearer ${GOOD_KEY}` });
    const res = await rpc(port, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'search_narratives', arguments: { limit: 5 } },
    }, { Authorization: `Bearer ${GOOD_KEY}` });
    const body = await readRpc(res);
    const payload = JSON.parse(body.result.content[0].text);
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0].title, 'Нарратив через HTTP');
  });
});

test('e2e: kill-switch отдаёт 503 на всё', async () => {
  await withServer(async ({ db, port }) => {
    db.setSetting('agentApiEnabled', '0');
    const res = await rpc(port, INIT, { Authorization: `Bearer ${GOOD_KEY}` });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'agent_api_disabled');
  });
});

test('без AGENT_MCP_HOST сервер привязывается к loopback', async () => {
  // Регрессионный сторож. Дефолт обязан быть безопасным при запуске без Docker.
  // В docker-compose стоит 0.0.0.0, и это ВЫНУЖДЕННО: проброшенный порт идёт на
  // bridge-интерфейс контейнера, а не на его loopback, поэтому 127.0.0.1 внутри
  // сделал бы порт недостижимым. «Только локально» там держит префикс
  // 127.0.0.1: в маппинге портов.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalyst-host-'));
  const db = new TrendDatabase(path.join(dir, 'test.db'), silentLogger);
  db.setSetting('agentApiKey', GOOD_KEY);
  const srv = new AgentMcpServer({ agent: { enabled: true, port: 0 } }, silentLogger, db);
  srv.start();
  try {
    await new Promise(r => srv.server.listening ? r() : srv.server.once('listening', r));
    assert.equal(srv.server.address().address, '127.0.0.1');
  } finally {
    await srv.stop(2000);
    try { db.db.close(); } catch { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('e2e: посторонний путь — 404', async () => {
  await withServer(async ({ port }) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/trends`, {
      method: 'POST', headers: { Authorization: `Bearer ${GOOD_KEY}` },
    });
    assert.equal(res.status, 404);
  });
});
