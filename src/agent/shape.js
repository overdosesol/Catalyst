/**
 * Бюджет выдачи для агентского слоя.
 *
 * Модель читает эти ответы как контекст. Ответ на 200 KB бесполезен дважды:
 * он вытесняет всё остальное и провоцирует достраивание вместо чтения.
 * Поэтому режем — но ВСЕГДА помечаем, что урезали. Необозначенная обрезка
 * хуже отсутствия данных: модель уверенно делает вывод по огрызку.
 */

export const MAX_RESPONSE_BYTES  = 60 * 1024;
export const SEARCH_DESC_CHARS   = 200;
export const DETAIL_TEXT_CHARS   = 4000;

/**
 * Белый список полей `raw_metrics`. Сырой блоб наружу не отдаём: он разный по
 * источникам, растёт со временем и может содержать внутренние поля, которых
 * агенту знать не нужно.
 */
const METRIC_FIELDS = [
  // Скоринг
  'memePotential', 'adoptionScore', 'emergenceScore', 'storyScore', 'storyHook',
  'rankScore', 'alertScore', 'narrativePhase', 'marketStage', 'velocity',
  // Джанк-фильтр — почему нарратив просел
  'junkPenalty', 'junkReasons',
  // Вовлечённость (имена полей различаются по источникам)
  'views', 'plays', 'upvotes', 'likes', 'comments', 'replies', 'retweets', 'shares',
  // Происхождение
  'manualSubmitted', 'alertType',
];

export function truncateText(value, maxChars) {
  const s = typeof value === 'string' ? value : (value == null ? '' : String(value));
  if (s.length <= maxChars) return { text: s, truncated: false };
  return { text: s.slice(0, maxChars), truncated: true };
}

export function pickMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return {};
  const out = {};
  for (const key of METRIC_FIELDS) {
    if (metrics[key] !== undefined && metrics[key] !== null) out[key] = metrics[key];
  }
  return out;
}

const byteLen = o => Buffer.byteLength(JSON.stringify(o), 'utf8');

/**
 * Последний рубеж. Если ответ не влез в бюджет — половиним массив `items`,
 * пока не влезет, и выставляем флаг.
 *
 * NB: замеряем ИТОГОВУЮ форму (вместе с флагами `items_returned` /
 * `response_truncated`), иначе на границе бюджета ответ вылезал бы за лимит
 * ровно на размер добавленных полей.
 */
export function enforceBudget(payload) {
  const out = { ...payload };

  if (Array.isArray(out.items)) {
    if (byteLen({ ...out, items_returned: out.items.length }) <= MAX_RESPONSE_BYTES) {
      out.items_returned = out.items.length;
      return out;
    }
    let items = out.items;
    const shaped = arr => ({ ...out, items: arr, items_returned: arr.length, response_truncated: true });
    while (items.length > 1 && byteLen(shaped(items)) > MAX_RESPONSE_BYTES) {
      items = items.slice(0, Math.floor(items.length / 2));
    }
    return shaped(items);
  }

  // Резать нечего — единичный объект. Отдаём как есть, но с честным флагом:
  // большой ответ с предупреждением лучше молчаливой пустоты.
  if (byteLen(out) > MAX_RESPONSE_BYTES) out.response_truncated = true;
  return out;
}
