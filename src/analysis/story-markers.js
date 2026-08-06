/**
 * Story markers — the lexical footprint of a narrative.
 *
 * A trend-discovery system that ranks by engagement systematically loses
 * stories: a cute frame earns a like without being read, a story has to be
 * read first. The two axes are orthogonal, so no threshold tuning finds
 * narratives — you have to look for a different SHAPE.
 *
 * Four families, matching the narrative types the owner named as targets.
 * Used in two places, deliberately from one source:
 *   1. `probeTerms` — what the X probes and the Reddit story search look for.
 *   2. `classifyStoryShape` — free lexical prefilter, runs before any AI and
 *      before any paid call.
 *
 * Calibration lives HERE. Do not scatter copies of these words into
 * collectors or prompts.
 */

export const STORY_FAMILIES = Object.freeze({
  // A subject with a proper name can accumulate lore even when this single
  // post carries none. That is the whole point of the `named` family.
  //
  // NB: "this is" was considered and rejected. It reads like a naming
  // construction but is ordinary English glue — "This is the cutest thing
  // you will see today" is pure cuteness and would have been promoted.
  // A marker that fires on the thing we are trying to exclude is worse
  // than no marker.
  named: {
    markers: ['meet', 'named', 'called', 'nicknamed', 'his name is', 'her name is'],
    probeTerms: ['meet', 'named', 'nicknamed'],
  },
  event: {
    markers: [
      'rescued', 'rescue', 'reunited', 'escaped', 'returned', 'survived', 'released',
      'adopted', 'born', 'retired', 'saved', 'found', 'freed', 'missing',
      'after years', 'finally', 'every day since', 'years later',
    ],
    probeTerms: ['rescued', 'reunited', 'escaped', 'survived', 'released'],
  },
  anomaly: {
    markers: [
      'rare', 'rarest', 'first ever', 'for the first time', 'never before',
      'new species', 'only known', 'discovered', 'unprecedented',
      'one of the last', 'never seen',
    ],
    probeTerms: ['rare', 'first ever', 'new species', 'discovered'],
  },
  drama: {
    markers: [
      'zoo', 'sanctuary', 'shelter', 'aquarium', 'court', 'ban', 'banned',
      'petition', 'fundraiser', 'mayor', 'honoured', 'honored', 'award', 'protest',
    ],
    probeTerms: ['zoo', 'sanctuary', 'shelter', 'petition'],
  },
});

/**
 * Families are checked in this order; first hit wins the `family` label.
 *
 * Order matters where families overlap. "for the first time" sits in
 * `anomaly`, not `event`, precisely because event is checked first: a
 * first-ever sighting is an anomaly, and putting the phrase in the earlier
 * family would relabel every one of them as an event.
 */
const FAMILY_ORDER = ['named', 'event', 'anomaly', 'drama'];

/**
 * Whole-word matcher. Multi-word markers ("first ever") are matched as a
 * phrase. Without the word boundaries "born" fires on "airborne" and "rare"
 * on "rarely" — measured false positives, not hypothetical ones.
 */
function matchesMarker(haystack, marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(haystack);
}

/**
 * @param {string} title
 * @param {string} [description]
 * @returns {{ isStory: boolean, family: string|null, hits: string[] }}
 */
export function classifyStoryShape(title, description = '') {
  const text = `${typeof title === 'string' ? title : ''} ${typeof description === 'string' ? description : ''}`
    .toLowerCase()
    .trim();

  if (!text) return { isStory: false, family: null, hits: [] };

  for (const familyName of FAMILY_ORDER) {
    const hits = STORY_FAMILIES[familyName].markers.filter(m => matchesMarker(text, m));
    if (hits.length > 0) return { isStory: true, family: familyName, hits };
  }
  return { isStory: false, family: null, hits: [] };
}

/**
 * Stable rotation order for probe slots.
 *
 * NB: the X probe queries themselves live in `preset-config.js` as data, not
 * generated here — the operator edits them from the admin UI, and generated
 * strings would be invisible there. `probeTerms` above are used directly by
 * the Reddit story search, which builds its query at call time.
 */
export const PROBE_ROTATION = Object.freeze(FAMILY_ORDER);
