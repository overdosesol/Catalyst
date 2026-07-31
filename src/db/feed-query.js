/**
 * Единственное место, где строится SQL ленты нарративов.
 *
 * Зовут двое: dashboard `_handleTrends` и агентский read-слой (`src/agent/`).
 * Общий билдер — не украшательство: без него у агента появляется второй
 * запрос рядом с дашбордным, они расходятся, и инвариант «агент видит то же,
 * что сайт» тихо перестаёт быть правдой.
 *
 * Функция чистая: ничего не читает из БД и не знает про entitlements.
 * Ограничения плана накладывает вызывающий, ДО вызова (см. `sources`).
 */

/** Значения `raw_metrics.narrativePhase`. НЕ путать с колонкой `trigger_phase`. */
export const NARRATIVE_PHASES = ['early', 'forming', 'strong', 'saturated'];

/** Значения колонки `trends.trigger_phase` — фаза из Catalyst forecast. */
export const FORECAST_PHASES = ['early', 'building', 'peaking', 'saturated', 'fading'];

/** 'virality' — легаси: UI-опцию убрали в R5, старые ссылки должны резолвиться. */
export const SORT_MODES = ['rank', 'time', 'meme', 'emergence', 'virality'];

/** Значения колонки `trends.alert_type`. Легаси-строки имеют NULL. */
export const ALERT_TYPES = ['event', 'trend', 'post'];

/** Значения колонки `trends.pipeline_status`. */
export const PIPELINE_STATUSES = ['scored', 'save_only'];

const ORDER_BY = {
  time:      'first_seen_at DESC',
  virality:  'score DESC',
  meme:      "CAST(JSON_EXTRACT(raw_metrics, '$.memePotential') AS INT) DESC",
  emergence: "CAST(JSON_EXTRACT(raw_metrics, '$.emergenceScore') AS INT) DESC",
  rank:      "CAST(JSON_EXTRACT(raw_metrics, '$.rankScore') AS INT) DESC",
};

const clampInt = (v, min, max, fallback) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/** Оставляет только значения из белого списка. Мусор молча отбрасывается. */
const whitelist = (input, allowed) => {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(',');
  return arr.map(s => String(s).trim()).filter(s => allowed.includes(s));
};

/**
 * @param {object} f
 * @param {string}   f.cutoff        SQLite-строка времени (см. utils/sqlite-time.js). Обязательна.
 * @param {string}   [f.sort]        SORT_MODES, дефолт 'rank'
 * @param {number[]} [f.excludeIds]  скрытые пользователем id
 * @param {number[]} [f.onlyIds]     ограничить этим списком (избранное)
 * @param {string[]} [f.sources]     уже применённый план-гейт («что разрешено видеть»)
 * @param {string}   [f.source]      собственный выбор юзера. НЕЗАВИСИМ от `sources` — см. комментарий в теле
 * @param {string}   [f.category]
 * @param {string[]} [f.phase]       NARRATIVE_PHASES
 * @param {number}   [f.minEmergence]
 * @param {string}   [f.q]           до 80 символов
 * @param {number}   [f.limit]       1..200, дефолт 50
 * @param {number}   [f.offset]
 * @returns {{sql: string, params: any[], countSql: string, countParams: any[]}}
 */
export function buildFeedQuery(f = {}) {
  const params = [f.cutoff];
  let sql = `SELECT * FROM trends WHERE last_seen_at > ?`;

  if (Array.isArray(f.excludeIds) && f.excludeIds.length > 0) {
    sql += ` AND id NOT IN (${f.excludeIds.map(() => '?').join(',')})`;
    params.push(...f.excludeIds);
  }
  if (Array.isArray(f.onlyIds)) {
    // Пустой массив = «ничего не подходит». Пустой IN() — синтаксическая
    // ошибка SQLite, поэтому подставляем заведомо непопадающее условие.
    if (f.onlyIds.length === 0) {
      sql += ` AND 0`;
    } else {
      sql += ` AND id IN (${f.onlyIds.map(() => '?').join(',')})`;
      params.push(...f.onlyIds);
    }
  }
  // `sources` (список) и `source` (одиночный) — ДВА НЕЗАВИСИМЫХ условия, и
  // схлопывать их нельзя. `sources` — это уже применённый план-гейт («что юзеру
  // вообще разрешено видеть»), `source` — его собственный выбор в фильтре.
  // Пересечение выглядит соблазнительно, но пустое пересечение здесь читалось
  // бы как «фильтра нет» и открыло бы закрытые планом источники.
  if (Array.isArray(f.sources) && f.sources.length > 0) {
    sql += ` AND source IN (${f.sources.map(() => '?').join(',')})`;
    params.push(...f.sources);
  }
  if (f.source) {
    sql += ` AND source = ?`;
    params.push(f.source);
  }
  if (f.category) {
    sql += ` AND category = ?`;
    params.push(f.category);
  }

  const phases = whitelist(f.phase, NARRATIVE_PHASES);
  if (phases.length > 0) {
    sql += ` AND JSON_EXTRACT(raw_metrics, '$.narrativePhase') IN (${phases.map(() => '?').join(',')})`;
    params.push(...phases);
  }

  const minEmergence = clampInt(f.minEmergence, 0, 100, 0);
  if (minEmergence > 0) {
    sql += ` AND CAST(JSON_EXTRACT(raw_metrics, '$.emergenceScore') AS INT) >= ?`;
    params.push(minEmergence);
  }

  const q = String(f.q || '').trim().slice(0, 80);
  if (q) {
    // Экранируем LIKE-wildcards, чтобы введённая пунктуация была буквальной.
    const like = '%' + q.replace(/[\\%_]/g, c => '\\' + c) + '%';
    sql += ` AND (title LIKE ? ESCAPE '\\' OR original_title LIKE ? ESCAPE '\\'`
         + ` OR ai_explanation LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')`;
    params.push(like, like, like, like);
  }

  const alertTypes = whitelist(f.alertType, ALERT_TYPES);
  if (alertTypes.length > 0) {
    // NB: легаси-строки имеют alert_type = NULL и читателями трактуются как
    // «любой тип» (database.js:109-110). Явный фильтр по типу их исключает —
    // это осознанно: агент, спросивший 'event', не должен получать строки,
    // про которые неизвестно, event ли они.
    sql += ` AND alert_type IN (${alertTypes.map(() => '?').join(',')})`;
    params.push(...alertTypes);
  }

  if (f.manualOnly === true) {
    // Флаг лежит внутри JSON raw_metrics. Используем ровно тот же приём, что
    // getManualTrends (database.js:1670-1678) — маркер уникален, JSON_EXTRACT
    // тут не нужен. Строка-константа, параметров не добавляет.
    sql += ` AND raw_metrics LIKE '%"manualSubmitted":true%'`;
  }

  const forecastPhases = whitelist(f.forecastPhase, FORECAST_PHASES);
  if (forecastPhases.length > 0) {
    sql += ` AND trigger_phase IN (${forecastPhases.map(() => '?').join(',')})`;
    params.push(...forecastPhases);
  }

  const minScore = clampInt(f.minScore, 0, 100, 0);
  if (minScore > 0) {
    sql += ` AND score >= ?`;
    params.push(minScore);
  }

  if (PIPELINE_STATUSES.includes(f.pipelineStatus)) {
    sql += ` AND pipeline_status = ?`;
    params.push(f.pipelineStatus);
  }

  // Count считаем до навешивания ORDER BY / LIMIT — так не нужен regex-срез.
  const countSql = sql.replace(/^SELECT \*/, 'SELECT COUNT(*) as c');
  const countParams = params.slice();

  const orderBy = ORDER_BY[f.sort] || ORDER_BY.rank;
  const limit  = clampInt(f.limit, 1, 200, 50);
  const offset = Math.max(0, clampInt(f.offset, 0, Number.MAX_SAFE_INTEGER, 0));

  sql += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return { sql, params, countSql, countParams };
}
