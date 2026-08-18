/**
 * Source health — notice when a collector stops working, and say so once.
 *
 * Written 2026-08-18 after xquik tightened its input schema and rejected every
 * narrative-probe and X-Trends request for three days. Nothing raised a hand:
 * the failures were caught per-request, logged at WARN, and Twitter's third
 * slot kept returning the odd post, so the source read as quiet rather than
 * broken. Partial failure never gets louder on its own — something has to
 * count it.
 *
 * Two conditions, because they fail differently:
 *   • `down`   — requests are erroring. Loud and unambiguous.
 *   • `silent` — no errors at all, just nothing coming back. This is what a
 *                changed response schema, an expired token or a dead hashtag
 *                list looks like from the outside.
 *
 * The silence thresholds are per source and they are NOT a style choice: a
 * Reddit cycle returning nothing is alarming, a TikTok one is Tuesday.
 *
 * Pure state machine — no bot, no clock, no I/O. The transport lives in
 * admin-alert.js and the wiring in base-collector.js, so the interesting part
 * can be tested by calling a function.
 */

/** Consecutive cycles with at least one failed request before we speak up. */
export const DEFAULT_FAIL_CYCLES = 4;

/**
 * Consecutive EMPTY cycles before silence counts as a fault, per source.
 *
 * MEASURED, not guessed. The first draft of this file used 4/24/24/24/24 and
 * would have fired a false alarm on every source except Reddit within a day.
 * The longest real gap between saved items over 10 days of prod (cycle = 30
 * min, so cycles = hours × 2):
 *
 *   source          max gap    avg gap    threshold here
 *   reddit             1.1h      0.18h     6  (3h)
 *   twitter           18.0h      1.94h    72  (36h)
 *   tiktok            20.2h      2.46h    80  (40h)
 *   google_trends     32.3h      4.47h   144  (72h)
 *   x_trends          84.1h     33.2h    336  (7d)
 *
 * Roughly double the observed maximum. Be honest about what that buys: for
 * Reddit this is a real detector, and for x_trends it is only a backstop
 * against total death. A source that naturally goes three days between items
 * cannot have a sensitive silence alarm — the unit is wrong, and pretending
 * otherwise just produces noise. The `down` signal carries those sources.
 */
export const SILENT_CYCLES = Object.freeze({
  reddit:          6,
  twitter:        72,
  tiktok:         80,
  google_trends: 144,
  x_trends:      336,
});

/** Fallback for a source with no entry above — err on the quiet side. */
export const DEFAULT_SILENT_CYCLES = 144;

/** A fault that is still unresolved re-announces itself this rarely. */
export const DEFAULT_REMIND_MS = 6 * 60 * 60 * 1000;

export function normalizeSource(name) {
  const raw = String(name || '').toLowerCase().trim();
  if (raw === 'googletrends' || raw === 'google trends') return 'google_trends';
  if (raw === 'xtrends' || raw === 'x trends') return 'x_trends';
  return raw;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.failCycles]   consecutive failing cycles before `down`
 * @param {object} [opts.silentCycles] per-source empty-cycle thresholds
 * @param {number} [opts.remindAfterMs] silence between repeats of one fault
 * @param {() => number} [opts.now]    injectable clock
 */
export function createHealthTracker(opts = {}) {
  const failCycles    = opts.failCycles    ?? DEFAULT_FAIL_CYCLES;
  const silentCycles  = opts.silentCycles  ?? SILENT_CYCLES;
  const remindAfterMs = opts.remindAfterMs ?? DEFAULT_REMIND_MS;
  const now           = opts.now           ?? (() => Date.now());

  /** source -> { failStreak, emptyStreak, active, announcedAt, lastError } */
  const state = new Map();

  const seat = (source) => {
    if (!state.has(source)) {
      state.set(source, {
        failStreak: 0, emptyStreak: 0, active: null, announcedAt: 0, lastError: '',
      });
    }
    return state.get(source);
  };

  const silenceLimit = (source) =>
    Number.isFinite(silentCycles?.[source]) ? silentCycles[source] : DEFAULT_SILENT_CYCLES;

  /**
   * Record one collection cycle. Returns an event to announce, or null.
   *
   * @param {string} name
   * @param {object} cycle
   * @param {number} cycle.items     items the collector returned
   * @param {number} [cycle.failures] sub-requests that failed and were swallowed
   * @param {boolean} [cycle.skipped] collector deliberately sat this cycle out
   * @param {string} [cycle.lastError] most recent error text, for the message
   */
  function record(name, cycle = {}) {
    const source = normalizeSource(name);
    const s = seat(source);

    // A cycle the collector chose not to run is not evidence of anything.
    // TikTok idles through half of them by design; counting those as silence
    // would have it permanently "broken".
    if (cycle.skipped) return null;

    const items    = Math.max(0, Number(cycle.items) || 0);
    const failures = Math.max(0, Number(cycle.failures) || 0);
    if (cycle.lastError) s.lastError = String(cycle.lastError).slice(0, 300);

    s.failStreak  = failures > 0 ? s.failStreak + 1 : 0;
    s.emptyStreak = items === 0  ? s.emptyStreak + 1 : 0;

    // Recovery first: items coming back settles both conditions at once, and
    // a recovery notice must never wait behind a fresh fault.
    if (s.active && items > 0 && failures === 0) {
      const was = s.active;
      s.active = null;
      s.announcedAt = 0;
      return { kind: 'recovered', source, from: was, items };
    }

    // `down` outranks `silent`: an erroring source is also an empty one, and
    // two messages about one fault is the spam we are trying to avoid.
    const condition = s.failStreak >= failCycles ? 'down'
      : s.emptyStreak >= silenceLimit(source)    ? 'silent'
      : null;
    if (!condition) return null;

    const t = now();
    const fresh   = s.active !== condition;
    const overdue = t - s.announcedAt >= remindAfterMs;
    if (!fresh && !overdue) return null;

    s.active = condition;
    s.announcedAt = t;
    return {
      kind: condition,
      source,
      repeat: !fresh,
      cycles: condition === 'down' ? s.failStreak : s.emptyStreak,
      lastError: s.lastError,
    };
  }

  return {
    record,
    /** Read-only peek, for the admin panel and for tests. */
    snapshot: () => Object.fromEntries(
      [...state].map(([k, v]) => [k, { ...v }])
    ),
    reset: () => state.clear(),
  };
}

/** Process-wide tracker used by BaseCollector. Tests build their own. */
export const sourceHealth = createHealthTracker();

/** Human-readable one-liner for Telegram. */
export function formatHealthEvent(event) {
  if (!event) return '';
  const src = event.source;
  if (event.kind === 'recovered') {
    return `✅ <b>${src}</b> снова отдаёт данные (${event.items} шт. за цикл)`;
  }
  const head = event.repeat ? '⏳ всё ещё' : '⚠️';
  if (event.kind === 'down') {
    const tail = event.lastError ? `\n<code>${event.lastError}</code>` : '';
    return `${head} <b>${src}</b>: запросы падают ${event.cycles} циклов подряд${tail}`;
  }
  return `${head} <b>${src}</b>: ноль записей ${event.cycles} циклов подряд, ошибок при этом нет`;
}
