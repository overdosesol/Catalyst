/**
 * Entity ledger — lore detection from our own database, at zero cost.
 *
 * The case this exists for: a photo of a capybara with no caption. The post
 * carries no story, but the SUBJECT has one — and we already know that,
 * because the name has been passing through our pipeline for weeks.
 *
 * Names arrive from Stage 0b (`subjectNames`) and Stage 1 (`subjectName`).
 * Crucially `save_only` trends are persisted WITH their PreStage data, so
 * names accumulate even from posts that were never scored.
 *
 * Not Stage 2: that one verifies live spread over x_search, costs money, is
 * capped at 3 calls, and is gated behind `memePotential >= threshold` — an
 * underrated post never reaches it. This runs before scoring, for everything.
 */

export const LEDGER_MIN_MENTIONS      = 3;   // two mentions are coincidence
export const LEDGER_MIN_DISTINCT_DAYS = 2;   // the load-bearing one: spread over time
export const LEDGER_WINDOW_DAYS       = 30;  // animal characters run for months
const MIN_NAME_LENGTH = 3;

/**
 * Names that must never become ledger entities, because they fuse unrelated
 * posts into one fake character. Grow this by observation, not by imagination.
 *
 * The species block is what the 2026-08-10 prod snapshot demanded. Of the
 * eight names that had accumulated enough mentions to count as lore, half
 * were species — capybara (20 mentions over 4 days), bunny, otter, elephant —
 * and only `chuck` and `tom holland` were real subjects. A capybara is a kind
 * of animal, not a character; every capybara post was feeding the same row.
 */
const STOP_NAMES = new Set([
  // Pet names common enough that two dogs sharing one are not one dog.
  'bella', 'luna', 'max', 'charlie', 'lucy', 'daisy', 'buddy', 'milo', 'coco',

  // Generic subjects.
  'animal', 'animals', 'pet', 'baby', 'creature', 'critter', 'wildlife',

  // Species and common animal words. Seeded from the ledger snapshot and from
  // what the `animals` preset's own sources produce.
  'dog', 'cat', 'puppy', 'kitten', 'kitty', 'bunny', 'rabbit', 'hare',
  'capybara', 'otter', 'seal', 'walrus', 'manatee', 'dolphin', 'whale', 'orca',
  'shark', 'octopus', 'squid', 'jellyfish', 'crab', 'lobster', 'turtle',
  'tortoise', 'frog', 'toad', 'newt', 'salamander', 'lizard', 'gecko',
  'iguana', 'chameleon', 'snake', 'python', 'cobra', 'alligator', 'crocodile',
  'elephant', 'rhino', 'hippo', 'giraffe', 'zebra', 'buffalo', 'bison',
  'lion', 'tiger', 'leopard', 'cheetah',
  'lynx', 'bobcat', 'wolf', 'coyote', 'jackal', 'hyena', 'fox', 'bear',
  'panda', 'koala', 'sloth', 'anteater', 'armadillo', 'pangolin', 'aardvark',
  'monkey', 'ape', 'gorilla', 'chimp', 'chimpanzee', 'orangutan', 'baboon',
  'lemur', 'meerkat', 'mongoose', 'raccoon', 'badger', 'skunk', 'possum',
  'opossum', 'ferret', 'weasel', 'stoat', 'marten', 'beaver', 'porcupine',
  'hedgehog', 'squirrel', 'chipmunk', 'marmot', 'groundhog', 'mole', 'shrew',
  'mouse', 'rat', 'hamster', 'gerbil', 'guinea pig', 'chinchilla',
  'kangaroo', 'wallaby', 'wombat', 'quokka', 'platypus', 'echidna',
  'alpaca', 'llama', 'camel', 'moose', 'elk', 'deer', 'fawn', 'antelope',
  'gazelle', 'ibex', 'horse', 'pony', 'foal', 'donkey', 'mule', 'cow',
  'calf', 'goat', 'sheep', 'lamb', 'pig', 'piglet', 'boar',
  'bird', 'owl', 'eagle', 'hawk', 'vulture', 'heron',
  'stork', 'pelican', 'flamingo', 'penguin', 'puffin', 'seagull',
  'gull', 'duck', 'duckling', 'goose', 'swan', 'chicken', 'rooster', 'hen',
  'turkey', 'peacock', 'parrot', 'cockatoo', 'macaw', 'crow',
  'magpie', 'pigeon', 'sparrow', 'plover', 'woodpecker',
  'hummingbird', 'bat', 'fish', 'koi', 'snail', 'slug', 'spider', 'tarantula',
  'scorpion', 'bee', 'wasp', 'hornet', 'ant', 'beetle', 'butterfly', 'moth',
  'dragonfly', 'mantis', 'cicada', 'caterpillar', 'worm', 'bug', 'insect',

  // Breeds. Same failure as species: every corgi post feeds one row.
  'corgi', 'husky', 'malamute', 'shiba', 'akita', 'retriever',
  'labrador', 'shepherd', 'collie', 'poodle', 'chihuahua', 'dachshund',
  'pug', 'beagle', 'bulldog', 'terrier', 'pitbull', 'rottweiler', 'doberman',
  'dalmatian', 'greyhound', 'spaniel', 'pomeranian', 'samoyed',
  'tabby', 'calico', 'siamese', 'persian', 'sphynx', 'ragdoll',

  'tiktok', 'reddit', 'twitter', 'youtube', 'instagram',
]);

// Deliberately NOT here, though they are animals: panther, puma, cougar,
// jaguar, falcon, raven, robin, bull, crane, chick, condor, lab, chow, inu.
// The ledger is shared by every preset, and in `culture` / `celebrities` /
// `events` those read as brands, teams, films and surnames — real subjects
// that deserve to accumulate lore. Losing "capybara" costs nothing; losing
// "Black Panther" costs a narrative.

/** "capybaras" is the same entity as "capybara". Guarded by MIN_NAME_LENGTH,
 *  so short real names ("gus") are never truncated into a match. */
function singular(word) {
  return word.endsWith('s') && word.length - 1 >= MIN_NAME_LENGTH
    ? word.slice(0, -1)
    : word;
}

/**
 * A plural ("capybaras") and a species used as the head noun ("grizzly bear",
 * "chinstrap penguin", "baby alpaca", "german shepherd") are the two shapes
 * the ledger actually produced. Neither is caught by a plain set lookup, and
 * the multi-word ones cannot be enumerated — there is always another heron.
 */
function isStopName(normalized) {
  if (STOP_NAMES.has(normalized) || STOP_NAMES.has(singular(normalized))) return true;
  const head = normalized.split(' ').pop();
  if (head === normalized) return false;
  return STOP_NAMES.has(head) || STOP_NAMES.has(singular(head));
}

export function normalizeEntityName(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecordable(normalized) {
  return normalized.length >= MIN_NAME_LENGTH && !isStopName(normalized);
}

/** Idempotent — called from _migrate() on every boot. */
export function createEntityLedgerSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_ledger (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      source      TEXT,
      seen_at     TEXT NOT NULL,
      seen_day    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entity_ledger_name ON entity_ledger(name, seen_at);
  `);
}

export function recordEntityMentions(db, names, source, seenAtIso = new Date().toISOString()) {
  if (!Array.isArray(names) || names.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO entity_ledger (name, source, seen_at, seen_day) VALUES (?, ?, ?, ?)`
  );
  let written = 0;
  for (const raw of names) {
    const name = normalizeEntityName(raw);
    if (!isRecordable(name)) continue;
    stmt.run(name, String(source || 'unknown'), seenAtIso, seenAtIso.slice(0, 10));
    written++;
  }
  return written;
}

/**
 * Lore = enough mentions, spread over enough distinct days, inside the window.
 *
 * Distinct days matter more than raw count: three mentions in one afternoon
 * are one burst; three mentions across three weeks are an accumulated story.
 *
 * NB: `seen_at` is written as a full ISO string here, never as a SQLite
 * CURRENT_TIMESTAMP value — so the lexicographic comparison below is safe.
 * Mixing the two formats is the classic trap in this codebase (space < 'T');
 * if this column ever gains a DEFAULT CURRENT_TIMESTAMP, use sqliteCutoff().
 */
export function hasLore(db, rawName) {
  const name = normalizeEntityName(rawName);
  if (!isRecordable(name)) return false;

  const cutoff = new Date(Date.now() - LEDGER_WINDOW_DAYS * 86_400_000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) AS mentions, COUNT(DISTINCT seen_day) AS days
    FROM entity_ledger
    WHERE name = ? AND seen_at >= ?
  `).get(name, cutoff);

  return (row?.mentions ?? 0) >= LEDGER_MIN_MENTIONS
      && (row?.days ?? 0)     >= LEDGER_MIN_DISTINCT_DAYS;
}
