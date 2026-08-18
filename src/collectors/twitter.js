import BaseCollector from './base-collector.js';
import { getActivePresetConfig } from '../analysis/preset-config.js';
import { isNarrativeLaneEnabled, resolveLane, LANE_NARRATIVE } from '../analysis/lane.js';

/**
 * Twitter/X collector — uses Apify's tweet-scraper to find viral world trends.
 *
 * Strategy:
 *  - Runs broad high-engagement search queries per cycle (no specific topic keywords)
 *  - Uses ultra-common words (a, the, is, de, la…) + min_faves to capture ANY viral tweet
 *  - Themed presets (animals, culture, celebrities, events) narrow the focus when needed
 *  - Clusters tweets by hashtag/topic to surface emerging narratives
 */

const MAX_ITEMS = 20;
const TIMEOUT_SECS = 90;

// ── Actor registry ──────────────────────────────────────────────────────────
// Each entry is a pluggable Apify Twitter scraper. The active actor is picked
// at runtime from DB setting 'twitterActor' (admin-configurable without
// restart). Both current actors happen to return identical engagement fields
// (viewCount / likeCount / retweetCount), so _normalize stays actor-agnostic.
// Default is 'kaitoeasyapi' — the more mature one (20+ months, 17K users).
//
// To add a new actor: drop a new key here + its token in .env (APIFY_API_<X>),
// wire it into config.js → apify.twitterKeys, and add it to admin-side
// VALID_TWITTER_ACTORS. No changes needed elsewhere.
const ACTORS = {
  kaitoeasyapi: {
    id: 'kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest',
    // Kaito accepts EITHER twitterContent (single string) OR searchTerms (array).
    // We use searchTerms — safer because `twitterContent: ""` triggers input
    // validation errors on some schema revisions. Empty lang field also
    // intermittently fails validation → only include it when non-empty.
    buildInput: (query, maxItems) => ({
      searchTerms: [query],
      maxItems,
      queryType: 'Top',
    }),
  },
  xquik: {
    id: 'xquik~x-tweet-scraper',
    // Rejects the ENTIRE run with 400 "Max Items must be at least 20" below
    // this. Declared per-actor because two callers legitimately want less:
    // narrative probes (shallow on purpose) and X-Trends tweet pulls (7 per
    // trend). Both failed 100% of the time from 2026-08-15.
    //
    // The floor is the ACTOR's, and it appeared without warning: the same probe
    // query ran against xquik on 08-07 and 08-10 asking for 15 and was accepted
    // (it failed those days on a transient 502, not on validation). Nothing on
    // our side changed on 08-15. An actor's input schema is somebody else's
    // deploy — treat these limits as data that can move, not as constants.
    minItems: 20,
    buildInput: (query, maxItems) => ({
      searchTerms: [query],
      maxItems,
      queryType: 'Top',
      includeSearchTerms: false,
    }),
  },
};
const DEFAULT_ACTOR = 'kaitoeasyapi';

/**
 * Honour the actor's floor, whatever the caller asked for.
 *
 * A request below the floor does not degrade — it 400s the whole run, so a
 * caller wanting fewer items gets NONE. Clamping up costs a few extra results;
 * not clamping costs the entire slot.
 */
export function resolveItemBudget(actorDef, requested) {
  const want = Math.max(1, Math.floor(Number(requested) || 0));
  return Math.max(want, actorDef?.minItems || 1);
}

/**
 * Probe queries are deliberately shallower than volume ones: a story-shaped
 * query matches a far wider slice of the firehose, and Apify bills per result.
 * Subject to the actor floor above — on an actor with minItems=20 this has no
 * effect, which is the correct trade: shallow is a preference, running at all
 * is not.
 */
export const PROBE_ITEM_CAP = 15;

// ── Search presets ────────────────────────────────────────────────────────────
// Each preset = 6 queries. Per cycle we run 2 (rotated).
// Strategy: ultra-common words + high min_faves to catch ANY viral content.
// No lang filter — we want global trends from all languages.

const PRESET_QUERIES = {
  // Universal — catches any viral content worldwide via common words from multiple languages.
  //
  // Language coverage (one slot each unless noted):
  //   • EN          — 4 slots (articles/prepositions, wh-words, pronouns, demonstratives)
  //   • Romance+RU  — 1 slot  (ES/PT/FR particles + RU particles merged; RU trades
  //                            dedicated coverage for an extra EN slot)
  //   • CJK         — 1 slot  (JP + KR + ZH particles in a single OR clause).
  //                            JP is weighted slightly heavier (6 particles vs 3+3)
  //                            because JP Twitter is the most active non-EN market.
  general: [
    '(a OR the OR is OR to OR in) min_faves:10000 -is:retweet',
    '(de OR la OR el OR que OR en OR и OR я OR на OR не OR что) min_faves:10000 -is:retweet',
    '(when OR where OR why OR how OR who) min_faves:10000 -is:retweet',
    '(you OR me OR my OR we OR our) min_faves:10000 -is:retweet',
    '(this OR that OR it OR was OR has) min_faves:10000 -is:retweet',
    '(の OR は OR を OR が OR に OR で OR 이 OR 가 OR 는 OR 的 OR 是 OR 了) min_faves:10000 -is:retweet',
  ],

  // 🐾 Animals — viral pets, funny animals, cute creatures
  animals: [
    '(dog OR puppy OR doggo OR pupper) min_faves:10000 -is:retweet',
    '(cat OR kitten OR kitty OR meow) min_faves:10000 -is:retweet',
    '(animal OR pet OR cute OR adorable) min_faves:10000 -is:retweet',
    '(duck OR frog OR monkey OR bear OR hamster) min_faves:10000 -is:retweet',
    '(rescue OR adopt OR stray OR shelter) (dog OR cat OR animal) min_faves:5000 -is:retweet',
    '(funny OR hilarious OR silly) (dog OR cat OR animal OR pet) min_faves:5000 -is:retweet',
  ],

  // 🎭 Culture — memes, internet culture, slang, humor
  culture: [
    '(meme OR memes OR viral OR trend) min_faves:10000 -is:retweet',
    '(funny OR hilarious OR lmao OR lol OR bruh) min_faves:10000 -is:retweet',
    '(slay OR iconic OR based OR goated OR era) min_faves:10000 -is:retweet',
    '(insane OR crazy OR wild OR unhinged OR unreal) min_faves:10000 -is:retweet',
    '(cancel OR ratio OR timeline OR main character) min_faves:10000 -is:retweet',
    '(gen z OR millennial OR boomer OR tiktok OR trend) min_faves:10000 -is:retweet',
  ],

  // ⭐ Celebrities — famous people, viral moments, pop culture
  celebrities: [
    '(elon OR musk OR trump OR biden) min_faves:10000 -is:retweet',
    '(taylor OR beyonce OR drake OR kanye OR rihanna) min_faves:10000 -is:retweet',
    '(movie OR film OR series OR netflix OR disney) min_faves:10000 -is:retweet',
    '(album OR song OR music OR concert OR tour) min_faves:10000 -is:retweet',
    '(celebrity OR famous OR star OR interview OR paparazzi) min_faves:10000 -is:retweet',
    '(award OR grammy OR oscar OR golden globe) min_faves:10000 -is:retweet',
  ],

  // 🌍 Events — world events, sports, breaking news, happenings
  events: [
    '(breaking OR "breaking news" OR happening OR urgent OR alert) min_faves:10000 -is:retweet',
    '(NASA OR space OR mars OR moon OR launch OR rocket) min_faves:10000 -is:retweet',
    '(earthquake OR hurricane OR flood OR wildfire OR disaster) min_faves:5000 -is:retweet',
    '(championship OR final OR world cup OR super bowl OR olympics) min_faves:10000 -is:retweet',
    '(protest OR march OR rally OR movement OR strike) min_faves:10000 -is:retweet',
    '(AI OR ChatGPT OR robot OR artificial intelligence) min_faves:10000 -is:retweet',
  ],
};

class TwitterCollector extends BaseCollector {
  constructor(config, logger, db) {
    super('Twitter', logger);
    this.enabled = config.twitter?.enabled ?? false;
    this.twitterKeys = config.apify?.twitterKeys || {};
    this.customQueries = config.twitter?.queries || null; // manual override via .env
    this.maxItemsPerQuery = config.twitter?.maxItemsPerQuery || MAX_ITEMS;
    this.db = db;

    // Validate: at least one actor key must be present.
    const configuredActors = Object.entries(this.twitterKeys).filter(([, v]) => v).map(([k]) => k);
    if (this.enabled && configuredActors.length === 0) {
      this.logger.warn('[Twitter] enabled=true but no actor keys (APIFY_API_KAITO / APIFY_API_XQUIK) set — disabling');
      this.enabled = false;
    }
  }

  /**
   * Resolve the active actor definition + its API key.
   * Falls back to default if the configured actor has no key or is unknown.
   */
  _activeActor() {
    const chosen = (this.db?.getSetting('twitterActor', DEFAULT_ACTOR) || DEFAULT_ACTOR).toLowerCase();
    const def = ACTORS[chosen] || ACTORS[DEFAULT_ACTOR];
    const key = this.twitterKeys[chosen] || this.twitterKeys[DEFAULT_ACTOR] || '';
    const name = ACTORS[chosen] ? chosen : DEFAULT_ACTOR;
    return { name, def, key };
  }

  _getQueries() {
    if (this.customQueries) return this.customQueries; // .env override takes priority
    // Per-preset queries since 2026-05-01 (PR-2). Edited from admin "Пресеты"
    // tab. Falls back to defaults baked into preset-config.js if the preset's
    // sources.twitter.queries is missing (resolver always populates).
    let queries = [];
    try { queries = getActivePresetConfig(this.db).sources?.twitter?.queries || []; }
    catch (_) { queries = []; }
    return queries.length > 0 ? queries : (PRESET_QUERIES.general);
  }

  async collect() {
    if (!this.enabled) return [];

    const allTweets = [];

    // 3 slots when the preset has probes (1 volume + 2), else 2 volume slots
    const queriesThisCycle = this._pickQueries();

    for (const { query, fromProbe } of queriesThisCycle) {
      try {
        const items = await this._searchQuery(query, undefined, { fromProbe });
        allTweets.push(...items);
        await this._delay(2000);
      } catch (err) {
        this.logger.warn(`[Twitter] Query failed "${query.substring(0, 60)}": ${err.message}`);
        this.noteFailure(err);
      }
    }

    // Deduplicate by tweet id
    const seen = new Set();
    const unique = allTweets.filter(t => {
      if (seen.has(t.externalId)) return false;
      seen.add(t.externalId);
      return true;
    });

    // Group by topic / hashtag to avoid 20 micro-alerts for the same trend
    return this._clusterByTopic(unique);
  }

  /**
   * With probes: 3 slots — 1 volume + 2 narrative probes.
   * Without probes: 2 volume slots, the pre-narrative-lane cycle size.
   *
   * The volume slot count is not fixed at one. A preset that never configured
   * `narrativeProbes` must not silently lose half its X coverage because the
   * narrative lane exists for a different preset.
   *
   * Two probe slots, not one, so a full pass over the four story families
   * takes one hour instead of two at a 30-minute cadence. Event narratives
   * ("escaped from the zoo") live in hours — arriving two hours late is
   * arriving after it is over.
   *
   * Returns `[{ query, fromProbe }]`, not bare strings: `fromProbe` rides all
   * the way down into `_normalize`, where it puts the item in the narrative
   * lane regardless of what its text happens to say.
   */
  _pickQueries() {
    const volume = this._getQueries();
    const probes = this._getNarrativeProbes();

    this._cycleCounter = (this._cycleCounter || 0) + 1;
    const picked = [];

    // Never more than the list holds — a one-query preset must not spend two
    // Apify calls on the same query.
    const volumeSlots = Math.min(probes.length > 0 ? 1 : 2, volume.length);
    if (volumeSlots > 0) {
      const start = (this._cycleCounter * volumeSlots) % volume.length;
      for (let i = 0; i < volumeSlots; i++) {
        picked.push({ query: volume[(start + i) % volume.length], fromProbe: false });
      }
    }
    for (let i = 0; i < 2 && probes.length > 0; i++) {
      const idx = (this._cycleCounter * 2 + i) % probes.length;
      picked.push({ query: probes[idx], fromProbe: true });
    }
    return picked;
  }

  _getNarrativeProbes() {
    if (this.customQueries) return []; // env pin means "operator drives this"
    try {
      return getActivePresetConfig(this.db).sources?.twitter?.narrativeProbes || [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Public single-query helper for external callers (e.g. XTrendsCollector
   * ingesting top X-trends and pulling real tweets per trend). Internal
   * `collect()` always uses `_searchQuery` directly with the per-instance cap.
   *
   * `opts.relaxedFloor=true` — softens the 500K-views / 10K-likes floor in
   * `_normalize` to 10K-views / 500-likes. Use case: X Trends top-tweet pulls,
   * where the trending status is itself a quality signal and tweets needn't
   * clear the firehose-grade bar.
   */
  async searchByQuery(query, maxItems, opts = {}) {
    if (!this.enabled) return [];
    return this._searchQuery(query, maxItems, opts);
  }

  async _searchQuery(query, maxItems, opts = {}) {
    const { name: actorName, def: actor, key: apiKey } = this._activeActor();
    if (!apiKey) {
      throw new Error(`[Twitter] No API key configured for actor '${actorName}'`);
    }
    // Authorization: Bearer instead of ?token= so a network-error
    // err.message can never leak the API key (see tiktok.js for the same fix).
    const runUrl = `https://api.apify.com/v2/acts/${actor.id}/run-sync-get-dataset-items?timeout=${TIMEOUT_SECS}`;

    // Per-actor input shape. Both return identical engagement fields. The
    // optional maxItems arg lets callers (X Trends discovery) ask for a smaller
    // batch than the default cycle cap — subject to the actor's own floor.
    const cap    = opts.fromProbe ? Math.min(this.maxItemsPerQuery, PROBE_ITEM_CAP) : this.maxItemsPerQuery;
    const wanted = maxItems || cap;
    const budget = resolveItemBudget(actor, wanted);
    if (budget !== wanted) {
      this.logger.debug?.(`[Twitter] ${actorName} floor: asked ${wanted} items, sending ${budget}`);
    }
    // Ask for the window we are actually going to keep. Without this the
    // request ('Top', all-time) and the filter (twitterMaxAgeHours) contradict
    // each other and most of what we pay for is discarded unread.
    const maxAgeHours = Number(this.db?.getSetting('twitterMaxAgeHours', 72) ?? 72);
    const windowed = withRecencyWindow(query, maxAgeHours);
    const input = actor.buildInput(windowed, budget);

    const response = await fetch(runUrl, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const err = await response.text();
      // Bump the log slice up — Apify's 400 responses carry nested JSON with
      // the actual validation reason beyond the first 200 chars.
      throw new Error(`Apify ${response.status} [${actorName}]: ${err.substring(0, 600)}`);
    }

    const tweets = await response.json();
    if (!Array.isArray(tweets)) return [];

    // The actor answered 201 with a well-formed payload. That is not the same
    // as the actor having done what we asked — see detectIgnoredFilter.
    const ignored = detectIgnoredFilter(tweets, parseMinFaves(windowed));
    if (ignored) {
      const msg = `${actorName} ignored min_faves:${ignored.minFaves} — `
        + `${ignored.below}/${ignored.total} tweets below it, median ${ignored.medianLikes} likes`;
      this.logger.warn(`[Twitter] ${msg}`);
      this.noteFailure(new Error(msg));
      return [];
    }

    return tweets.map(t => this._normalize(t, query, opts)).filter(Boolean);
  }

  _normalize(tweet, query, opts = {}) {
    if (!tweet) return null;

    const id   = tweet.id || tweet.tweet_id || tweet.rest_id;
    const text = tweet.text || tweet.full_text || tweet.rawContent || '';
    if (!text || text.length < 10) return null;

    const author    = tweet.author?.userName || tweet.author?.username || tweet.user?.screen_name || tweet.userName || tweet.username || 'unknown';
    const url       = id ? `https://twitter.com/${author}/status/${id}` : '';
    const views     = tweet.viewCount    || tweet.viewsCount      || 0;
    const likes     = tweet.likeCount    || tweet.favoriteCount   || 0;
    const retweets  = tweet.retweetCount || tweet.retweet_count   || 0;
    const replies   = tweet.replyCount   || tweet.reply_count     || 0;
    const followers = tweet.author?.followers || tweet.user?.followers_count || 0;

    // Extract hashtags
    const hashtagMatches = text.match(/#\w+/g) || [];
    const hashtags = [...new Set(hashtagMatches.map(h => h.toLowerCase()))];

    // Extract tickers (e.g. $BONK, $SOL)
    const tickerMatches = text.match(/\$[A-Z]{2,8}/g) || [];
    const tickers = [...new Set(tickerMatches)];

    // Virality score for filtering
    const engagement = likes + retweets * 3 + replies;
    const viralScore = Math.min(100, Math.round(
      (Math.log10(views + 1) * 8) +
      (Math.log10(likes + 1) * 12) +
      (Math.log10(retweets + 1) * 15) +
      (Math.log10(followers + 1) * 5)
    ));

    // Engagement rate: likes relative to follower count
    // High rate from small account = organic virality; low rate from big account = baseline noise
    const engagementRate = followers > 0 ? Math.round((likes / followers) * 10000) / 100 : 0; // percentage

    // Minimum engagement bar — must have real traction to be worth analysing.
    // Accepts a tweet if it meets ANY of these thresholds:
    //   ≥ 500  likes  (small viral)
    //   ≥ 100  retweets (shared, not just liked)
    //   ≥ 10 000 views (significant reach)
    //   viralScore ≥ 35 (composite signal)
    // Hard filter: 500K+ views required. If views unavailable — fallback to 10K+ likes.
    //
    // CJK-script tweets get a harder bar — the Apify firehose pulls in too
    // much low-signal Asian-language virality (idol fandom, regional memes,
    // news copypasta) that meets the global threshold but never converts into
    // a tradeable narrative on EN/global crypto twitter.
    //   • Chinese (zh): 4× — biggest source of noise, mostly mainland reposts
    //   • Japanese (ja) / Korean (ko): 2× — noisier than EN but more often
    //     genuinely on-trend (idol launches, anime/game IP)
    const cjkScript = _detectCjkScript(text);
    const cjkMult   = cjkScript === 'zh' ? 4 : cjkScript ? 2 : 1;
    // Relaxed floor: X-Trends top-tweet pulls bypass the firehose-grade bar
    // (the trending position already certifies quality). Soft bar still applied
    // so total noise (zero-engagement bots, etc.) doesn't slip through.
    if (!meetsEngagementBar(views, likes, { cjkMult, relaxedFloor: opts.relaxedFloor })) return null;

    const createdAt = tweet.created_at || tweet.createdAt || null;
    const ageHours  = createdAt
      ? (Date.now() - new Date(createdAt).getTime()) / 3_600_000
      : 0;

    // Drop stale tweets — default 72h, admin-configurable via 'twitterMaxAgeHours'.
    // 0 disables the filter. Only applies when the tweet has a createdAt.
    const maxAgeHours = Number(this.db?.getSetting('twitterMaxAgeHours', 72) ?? 72) || 0;
    if (createdAt && maxAgeHours > 0 && ageHours > maxAgeHours) return null;

    const title = this._buildTitle(text, hashtags, tickers);

    // Media — works for both photos and videos (preview frame)
    // Twitter API v2: tweet.media[].preview_image_url (videos) or .url (photos)
    // Legacy/Apify:   tweet.entities.media[].media_url_https
    // xquik:          tweet.media[].mediaUrl (camelCase, direct pbs.twimg.com link)
    const mediaList = tweet.media?.length ? tweet.media
                    : (tweet.entities?.media || []);
    // NB: xquik puts the real file in `mediaUrl` and a t.co shortlink in `url`.
    // A t.co URL inside <img src> serves an HTML redirect page, not an image, so
    // the preview breaks while everything looks fine in the DB. Hence: prefer the
    // direct CDN link, and reject t.co no matter which field it arrives in.
    const isShortlink = (u) => /^https?:\/\/t\.co\//i.test(u);
    const pickUrl = (m) => {
      if (!m) return null;
      const isPhoto = m?.type === 'photo' || !m?.type;
      const candidates = isPhoto
        ? [m.media_url_https, m.mediaUrl, m.media_url, m.preview_image_url, m.url]
        : [m.preview_image_url, m.media_url_https, m.mediaUrl, m.media_url, m.url];
      return candidates.find(u => u && !isShortlink(u)) || null;
    };
    const upgrade = (u) => {
      if (!u || !/pbs\.twimg\.com\//.test(u)) return u;
      try {
        const url = new URL(u);
        url.searchParams.set('name', 'orig');
        if (!url.searchParams.get('format')) {
          const ext = url.pathname.match(/\.(jpe?g|png|webp)$/i)?.[1] || 'jpg';
          url.searchParams.set('format', ext.toLowerCase().replace('jpeg', 'jpg'));
        }
        return url.toString();
      } catch (_) { return u; }
    };
    // Helper: extract image URLs from a given media array into `imageUrls`.
    // Dedupes against existing entries; caps the final list at 10.
    const pushImagesFrom = (list) => {
      if (!Array.isArray(list)) return;
      for (const m of list) {
        const raw = pickUrl(m);
        const url = upgrade(raw);
        if (url && !imageUrls.includes(url)) imageUrls.push(url);
        if (imageUrls.length >= 10) break;
      }
    };

    // Helper: extract the best MP4 video URL from a media array.
    const pickVideoFrom = (list) => {
      if (!Array.isArray(list)) return null;
      for (const m of list) {
        const type = m?.type;
        if (type !== 'video' && type !== 'animated_gif') continue;
        // video_info.variants — Twitter API v2 / legacy shape (kaitoeasyapi);
        // videoVariants — xquik's camelCase equivalent, same {url, bitrate,
        // contentType} entries, so the filtering below needs no other change.
        const variants = m.video_info?.variants || m.variants || m.videoVariants || [];
        const mp4s = variants
          .filter(v => (v.content_type || v.contentType || '').includes('mp4') || /\.mp4(\?|$)/i.test(v.url || ''))
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        const best = mp4s[0]?.url;
        if (best) return best;
      }
      return null;
    };

    // All photo URLs (preserve order, dedupe); cap 10 for Telegram media group.
    // Order: (1) main tweet images, (2) quoted tweet images, (3) reply-parent
    // images. This keeps the tweet's own content primary while still surfacing
    // the referenced media — crucial for quote tweets where the "story" lives
    // entirely in the embedded card.
    const imageUrls = [];
    pushImagesFrom(mediaList);

    // Quoted tweet — multiple Apify/X API shapes. fxtwitter uses `quote`,
    // apidojo/kaitoeasy usually `quoted_tweet` / `quotedStatus`.
    const quoted = tweet.quote || tweet.quoted_tweet || tweet.quotedStatus
                 || tweet.quoted_status || tweet.retweeted_tweet || null;
    if (quoted) {
      const qMedia = quoted.media?.length ? quoted.media
                   : (quoted.entities?.media || quoted.media?.all || []);
      pushImagesFrom(qMedia);
    }

    // Reply-parent tweet — when the current tweet is itself a reply and the
    // parent carries the original content (e.g. a thread starter with the
    // screenshot). Less common in Apify payloads; fetched when exposed.
    const replyParent = tweet.in_reply_to_tweet || tweet.in_reply_to_status
                      || tweet.replying_to || null;
    if (replyParent) {
      const rMedia = replyParent.media?.length ? replyParent.media
                   : (replyParent.entities?.media || []);
      pushImagesFrom(rMedia);
    }

    const thumbnailUrl = imageUrls[0] || null;

    // Best video URL — main tweet first, then quoted/reply-parent as fallback.
    let videoUrl = pickVideoFrom(mediaList);
    if (!videoUrl && quoted) {
      const qMedia = quoted.media?.length ? quoted.media : (quoted.entities?.media || []);
      videoUrl = pickVideoFrom(qMedia);
    }
    if (!videoUrl && replyParent) {
      const rMedia = replyParent.media?.length ? replyParent.media : (replyParent.entities?.media || []);
      videoUrl = pickVideoFrom(rMedia);
    }

    const item = {
      externalId: `twitter_${id || Buffer.from(text.substring(0, 30)).toString('base64').substring(0, 12)}`,
      source: 'twitter',
      title,
      description: text.substring(0, 300),
      url,
      metrics: {
        views,
        likes,
        retweets,
        replies,
        followers,
        engagementRate,
        viralScore,
        ageHours: Math.round(ageHours * 10) / 10,
        hashtags,
        tickers,
        author: `@${author}`,
        searchQuery: query.substring(0, 60),
        thumbnailUrl,
        imageUrls,
        videoUrl,
      },
    };

    // NB: `title` here is often just hashtags (see _buildTitle), so the story
    // words live in `description` — the raw tweet text. resolveLane reads both.
    // No ledger lookup here on purpose — subject names arrive from Stage 0b,
    // which runs after collection. The clusterer re-checks the lane once the
    // names exist (see clusterer.route).
    if (opts.fromProbe) item._fromProbe = true;
    const { lane, reason } = resolveLane(item, { enabled: isNarrativeLaneEnabled(this.db) });
    item.lane       = lane;
    item.laneReason = reason;
    return item;
  }

  /**
   * Build a clean trend title from tweet text
   */
  _buildTitle(text, hashtags, tickers) {
    // Filter out generic / noise hashtags — keep only meaningful ones
    const STOP_HASHTAGS = [
      '#fyp', '#foryou', '#foryoupage', '#viral', '#trending', '#trend',
      '#follow', '#like', '#retweet', '#rt', '#breaking', '#news',
    ];
    const meaningfulHashtags = hashtags.filter(h => !STOP_HASHTAGS.includes(h));

    if (meaningfulHashtags.length > 0 && tickers.length > 0) {
      return `${meaningfulHashtags[0]} ${tickers[0]}`;
    }
    if (meaningfulHashtags.length > 0) return meaningfulHashtags.slice(0, 2).join(' ');
    if (tickers.length > 0) return tickers.join(' ');

    // Fallback: clean first sentence
    return text
      .replace(/https?:\/\/\S+/g, '')
      .replace(/#\w+|@\w+|\$\w+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
  }

  /**
   * Group individual tweets into cluster-level trend signals.
   * Returns one item per unique topic (hashtag cluster or ticker),
   * with aggregated engagement metrics.
   */
  _clusterByTopic(tweets) {
    const clusters = new Map();

    for (const tweet of tweets) {
      const { hashtags = [], tickers = [] } = tweet.metrics;
      const keys = [...tickers, ...hashtags].slice(0, 3);
      const clusterKey = keys.length > 0 ? keys[0] : tweet.title.substring(0, 30);

      // Per-tweet engagement velocity (likes/hour). Reused both for the
      // initial cluster seed and every merged tweet — we accumulate the sum
      // of rates so the cluster velocity reflects real-time traction across
      // all tweets, not just cluster size.
      const tweetEngagement = (tweet.metrics.likes || 0) + (tweet.metrics.retweets || 0) * 2;
      const tweetAge = Math.max(tweet.metrics.ageHours || 0, 0.25); // floor at 15min
      const tweetVelocity = tweetEngagement / tweetAge;

      if (!clusters.has(clusterKey)) {
        clusters.set(clusterKey, { ...tweet, _count: 1, _velocitySum: tweetVelocity });
      } else {
        const c = clusters.get(clusterKey);
        c._count++;
        // Lane is upgrade-only for a cluster: one narrative member makes the
        // whole cluster narrative. Losing this means a story that clustered
        // under a popular hashtag silently inherits the volume lane.
        if (tweet.lane === LANE_NARRATIVE && c.lane !== LANE_NARRATIVE) {
          c.lane       = LANE_NARRATIVE;
          c.laneReason = tweet.laneReason;
        }
        c._velocitySum = (c._velocitySum || 0) + tweetVelocity;
        c.metrics.views    = (c.metrics.views    || 0) + (tweet.metrics.views    || 0);
        c.metrics.likes    = (c.metrics.likes    || 0) + (tweet.metrics.likes    || 0);
        c.metrics.retweets = (c.metrics.retweets || 0) + (tweet.metrics.retweets || 0);
        // Keep the best-performing tweet's URL
        if ((tweet.metrics.likes || 0) > (c.metrics.likes || 0)) {
          c.url = tweet.url;
        }
      }
    }

    return Array.from(clusters.values())
      // Drop clusters that still don't meet the bar after aggregation.
      // Same either-signal rule as _normalize — via the same function, so the
      // two can never drift apart. They did: this copy would have re-dropped
      // every likes-qualified tweet the floor above had just let through.
      .filter(c => meetsEngagementBar(c.metrics.views, c.metrics.likes))
      .map(cluster => ({
        ...cluster,
        metrics: {
          ...cluster.metrics,
          tweetCount: cluster._count,
          // upvotes-equivalent for scorer
          upvotes: (cluster.metrics.likes || 0) + (cluster.metrics.retweets || 0) * 2,
          // Likes/hour — sum of per-tweet rates, mirrors Reddit's velocity
          velocity: Math.round(cluster._velocitySum || 0),
        },
      }));
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  normalize(item) {
    return item; // already normalized in _normalize()
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

// ── Recency window ──────────────────────────────────────────────────────────
//
// `queryType: 'Top'` means top of ALL TIME. It shipped in the first commit
// (2026-04-16). `twitterMaxAgeHours` arrived on 2026-04-24 and has been
// throwing away exactly what Top returns ever since — two numbers that nobody
// had put side by side. Measured 2026-08-18 on a live preset query: of 20
// tweets, 6 cleared the engagement bar, 7 were under 72h, and only 1 was both.
// The oldest result was 66957 hours old. Seven and a half years.
//
// So derive the ask from our own cap. One setting, one window, and the two can
// never drift apart again.
//
// The operator goes in the query string rather than the actor's native
// `since_time` field, and that is not a style preference — the native field
// was tested and does not hold the line: asking for 3 days still returned
// tweets 281h and 452h old. `within_time:` returned nothing older than 72h
// across three runs. Same lesson as `min_faves`: a field in an actor's schema
// is a claim, not a behaviour.

// THE TWO-GROUP LIMIT. Adding the operator to a query with two or more
// parenthesised groups makes the advanced-search parse collapse: `min_faves`
// stops being honoured and the response degrades to a plain text search with a
// median of 0 likes. Caught in the first cycle after this shipped, by the
// min_faves detector below flagging our OWN queries.
//
// Measured, two passes, identical both times:
//
//   (a OR b OR c) min_faves:5000 -is:retweet within_time:3d      OK,   20/20 honoured, 6 reach
//   (a OR b) (c OR d) min_faves:5000 -is:retweet within_time:3d  JUNK,  2/15 honoured, 0 reach
//   (a OR b OR c) (d OR e OR f) min_faves:5000 within_time:3d    JUNK,  4/15 honoured, 2 reach
//
// It is the group COUNT, not the term count and not `-is:retweet`. `since:`
// fails the same way, and the native `since_time` field has no effect on these
// queries at all, so for a two-group query there is currently no way to ask for
// recency. Those are left un-windowed: stale results that are honestly labelled
// beat fresh-looking noise, and the alternative trips the health alarm every
// cycle on our own malformed query.
//
// The narrative probes are all two-group by construction (story-shape verbs
// against subject), which is why they are the ones that lose out. Rewriting
// them as single-group queries would earn them the window - measured at 6
// reaching items against today's 0 - but that drops the subject constraint, so
// it is a preset-design decision rather than a collector one. See NEXT.md.

/** Parenthesised groups in a query. Two or more and the parser gives up. */
export const MAX_GROUPS_FOR_WINDOW = 1;

export function countQueryGroups(query) {
  return (String(query || '').match(/\([^()]*\)/g) || []).length;
}

export function withRecencyWindow(query, maxAgeHours) {
  const q = String(query || '').trim();
  if (!q) return '';
  const hours = Number(maxAgeHours);
  // 0 disables our own age filter. Narrowing the request anyway would quietly
  // reinstate a filter the operator switched off.
  if (!Number.isFinite(hours) || hours <= 0) return q;
  // An explicit window written by the caller outranks the default.
  if (/\b(?:within_time|since|until|since_time|until_time)\s*:/i.test(q)) return q;
  // Too complex to survive the operator - see THE TWO-GROUP LIMIT above.
  if (countQueryGroups(q) > MAX_GROUPS_FOR_WINDOW) return q;

  const h = Math.max(1, Math.ceil(hours));
  const window = h % 24 === 0 ? `${h / 24}d` : `${h}h`;
  return `${q} within_time:${window}`;
}

// ── Did the actor actually run our query? ─────────────────────────────
//
// Written 2026-08-18 after Twitter spent weeks yielding ~7 items a day instead
// of the expected 100+. Nothing was erroring. Measured against
// xquik~x-tweet-scraper: on roughly two runs in three the actor ignores the
// `min_faves:` operator and returns ~20 arbitrary tweets with a median of 0
// likes. HTTP 201, well-formed payload, no warning of any kind. All of them
// then fail the 500K-views floor, so the cycle logs "Collected 0 items".
// Sampled that day: xquik honoured the filter on 5 runs of 15, kaitoeasyapi on
// 5 of 5.
//
// This is a third failure mode, and the two we already watch for cannot see
// it. `down` needs a thrown error; there is none. `silent` needs 72 empty
// cycles in a row; the occasional honest run trickles an item through and
// resets the streak forever. A source that returns confident nonsense reads as
// healthy to both.
//
// The check is cheap because we already know what we asked for: our own query
// carries `min_faves:N`, so every tweet coming back should have at least N
// likes. When most of them do not, the actor ignored the filter. That is a
// comparison against our own demand, not against a guess about the world,
// which is what keeps it from producing false alarms.

/** Consecutive-sample floor. Three bad tweets is noise, not evidence. */
export const IGNORED_FILTER_MIN_SAMPLE = 5;

/** Share of the batch that must be under the floor before we call it a lie. */
export const IGNORED_FILTER_SHARE = 0.5;

/** The engagement floor our own query demanded, or 0 if it demanded none. */
export function parseMinFaves(query) {
  const m = /min_faves:(\d+)/i.exec(String(query || ''));
  return m ? Number(m[1]) : 0;
}

/**
 * Did this batch come back honouring the floor the query asked for?
 *
 * Returns null when everything is fine (including "no floor to check" and
 * "sample too small to judge"), or a report when the actor plainly ignored it.
 *
 * The threshold is half the batch, not all of it, for two reasons. Search
 * indexes lag, so a genuine result can be indexed above the floor and read
 * back below it — a handful of those must not page anyone. And the observed
 * junk was not uniformly zero: one sampled run carried two real viral tweets
 * among fourteen duds, which a stricter all-or-nothing rule would have passed.
 */
export function detectIgnoredFilter(tweets, minFaves) {
  if (!minFaves || !Array.isArray(tweets)) return null;
  if (tweets.length < IGNORED_FILTER_MIN_SAMPLE) return null;

  const likes = tweets.map(t => Number(t?.likeCount ?? t?.favoriteCount) || 0);
  const below = likes.filter(l => l < minFaves).length;
  if (below / likes.length < IGNORED_FILTER_SHARE) return null;

  const sorted = [...likes].sort((a, b) => a - b);
  return {
    minFaves,
    below,
    total: likes.length,
    medianLikes: sorted[Math.floor(sorted.length / 2)],
  };
}

/** Base engagement floor. CJK gets a multiplier — see _detectCjkScript. */
export const VIEWS_BAR         = 500_000;
export const LIKES_BAR         = 5_000;
const RELAXED_VIEWS_BAR = 10_000;
const RELAXED_LIKES_BAR = 500;

/**
 * Does this tweet (or aggregated cluster) clear the engagement floor?
 *
 * BOTH signals must clear their bar (owner decision 2026-08-07). The old rule
 * was `views > 0 ? views >= viewsBar : likes >= likesBar` — when views were
 * known, likes were never consulted at all, so a tweet could pass on reach
 * alone with almost no engagement behind it.
 *
 * Requiring both turns this into an implicit ratio test, and that is the point:
 * a sticky clip collects impressions from the scroll without anyone stopping to
 * react, so it clears views and fails likes. Something people actually engaged
 * with clears both.
 *
 * Consequence worth knowing: every preset query already carries
 * `min_faves:5000`, so for those the likes half is satisfied by construction
 * and the effective bar is the views one. Where this genuinely bites is
 * queries without a min_faves clause and payloads that arrive with no view
 * count at all — those now fail, where before they were judged on likes.
 *
 * Lives here as one function because the rule is applied twice — per tweet in
 * `_normalize` and per cluster in `_clusterByTopic`. Those two copies had
 * already drifted once.
 */
export function meetsEngagementBar(views, likes, { cjkMult = 1, relaxedFloor = false } = {}) {
  const v = Number(views) || 0;
  const l = Number(likes) || 0;
  const viewsBar = (relaxedFloor ? RELAXED_VIEWS_BAR : VIEWS_BAR) * cjkMult;
  const likesBar = (relaxedFloor ? RELAXED_LIKES_BAR : LIKES_BAR) * cjkMult;
  return v >= viewsBar && l >= likesBar;
}

/**
 * Detect dominant CJK script in a tweet.
 *
 * Returns one of: 'zh' (Chinese-only Han chars), 'ja' (any Hiragana/Katakana),
 * 'ko' (any Hangul), or null (not CJK-dominant).
 *
 * Logic:
 *  - Counts CJK characters across Han + Hiragana/Katakana + Hangul ranges.
 *  - Requires ≥30 % of all Unicode letters to be CJK — otherwise null.
 *  - Once CJK-dominant: presence of kana → 'ja', presence of hangul → 'ko',
 *    only Han ideographs → 'zh' (the Chinese case).
 *
 * Why script-specific detection: Chinese pulls 4× more low-signal virality
 * (regional news, idol gossip, copypasta) through Apify than ja/ko, so it
 * gets a stricter floor in `_normalize`.
 */
function _detectCjkScript(text) {
  if (!text) return null;
  // Hiragana (3040-309F) + Katakana (30A0-30FF) — Japanese-exclusive
  const kanaRe   = /[぀-ゟ゠-ヿ]/g;
  // Hangul Syllables (AC00-D7AF) — Korean-exclusive
  const hangulRe = /[가-힯]/g;
  // Han ideographs (CJK Ext-A 3400-4DBF + CJK Unified 4E00-9FFF) — shared
  const hanRe    = /[㐀-䶿一-鿿]/g;

  const kanaCount   = (text.match(kanaRe)   || []).length;
  const hangulCount = (text.match(hangulRe) || []).length;
  const hanCount    = (text.match(hanRe)    || []).length;
  const cjkCount    = kanaCount + hangulCount + hanCount;
  if (cjkCount === 0) return null;

  const letterMatches = text.match(/\p{L}/gu);
  const letters = letterMatches ? letterMatches.length : 0;
  if (letters === 0) return null;
  if ((cjkCount / letters) < 0.30) return null;

  if (kanaCount > 0)   return 'ja';
  if (hangulCount > 0) return 'ko';
  return 'zh'; // pure Han, no kana, no hangul
}

export default TwitterCollector;
