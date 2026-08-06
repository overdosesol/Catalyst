/**
 * Lane assignment.
 *
 * `narrative` — this item is worth looking at even if its engagement is not
 * spectacular. `volume` — everything else.
 *
 * The lane grants PRIORITY only. Virality thresholds are NOT relaxed for it
 * (owner decision, 2026-08-07): thresholds are the blunt lever, and recall
 * here comes from what we search for, not from how much we let through.
 */

import { classifyStoryShape } from './story-markers.js';
import { hasLore } from '../db/entity-ledger.js';

export const LANE_NARRATIVE = 'narrative';
export const LANE_VOLUME    = 'volume';

/** Default ON. A missing or broken db must never change scoring behaviour. */
export function isNarrativeLaneEnabled(db) {
  try {
    return String(db?.getSetting?.('narrativeLaneEnabled', '1') ?? '1') !== '0';
  } catch (_) {
    return true;
  }
}

/**
 * @param {object} item — collector item (title / description / metrics)
 * @param {object} opts
 * @param {boolean} opts.enabled
 * @param {(name: string) => boolean} [opts.hasLore] — entity-ledger lookup
 * @returns {{ lane: string, reason: string }}
 */
export function resolveLane(item, opts = {}) {
  if (!opts.enabled) return { lane: LANE_VOLUME, reason: 'disabled' };

  if (item?._fromProbe) return { lane: LANE_NARRATIVE, reason: 'probe' };

  const shape = classifyStoryShape(item?.title, item?.description);
  if (shape.isStory) return { lane: LANE_NARRATIVE, reason: `lexical:${shape.family}` };

  // Lore check last: it is the only branch that touches the DB, and it only
  // matters for items the cheap checks already let go.
  //
  // Where the names come from decides WHERE this can usefully run. Stage 0b
  // (vision) produces `preStage.gemini.subjectNames`, and it runs AFTER
  // collection — so at collector time there is nothing here to look up. The
  // ledger branch only does real work when called from the clusterer, after
  // PreStage and before the routing decision.
  if (typeof opts.hasLore === 'function') {
    const names = item?.preStage?.gemini?.subjectNames
      || item?.metrics?.subjectNames
      || item?.subjectNames
      || [];
    try {
      for (const name of names) {
        if (name && opts.hasLore(name)) return { lane: LANE_NARRATIVE, reason: `ledger:${name}` };
      }
    } catch (_) {
      // Ledger unavailable — degrade to lexical only, never break collection.
    }
  }

  return { lane: LANE_VOLUME, reason: 'none' };
}

/**
 * Bind a ledger lookup to a db handle. Returns a checker that never throws:
 * the ledger is an enrichment, and a broken enrichment must not stop
 * collection.
 */
export function makeLoreChecker(db) {
  const handle = db?.db || db; // Database wrapper or raw better-sqlite3 handle
  if (!handle?.prepare) return () => false;
  return (name) => {
    try { return hasLore(handle, name); } catch (_) { return false; }
  };
}
