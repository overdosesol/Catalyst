import BaseCollector from './base-collector.js';
import { getActivePresetConfig } from '../analysis/preset-config.js';
import { parseRedditAtomFeed } from '../utils/reddit-preview.js';
import { isNarrativeLaneEnabled, resolveLane } from '../analysis/lane.js';
import { STORY_FAMILIES, PROBE_ROTATION } from '../analysis/story-markers.js';

/**
 * Reddit collector — uses Reddit JSON API (no auth needed with proper User-Agent)
 *
 * Strategy:
 *  - Per active preset, fetches hot listings from a curated subreddit list.
 *    The list, min-upvotes bar and posts-per-sub all live in
 *    settings.presetConfigs (see preset-config.js DEFAULT_PRESET_CONFIGS) and
 *    are editable from the admin "Пресеты" tab.
 *  - NICHE_SUBS (crypto) get a lowered bar (1 000) — only relevant when an
 *    operator hand-adds crypto subs into a preset; defaults stay meme-shape.
 */

/**
 * Gap between the two RSS requests a cycle makes.
 *
 * Measured from prod: 45s apart both return 200; 5s apart the second returns
 * 429. The budget is per-IP and short-lived, so spacing is the whole strategy —
 * there is nothing else to tune, and a 45s pause inside a 30-minute cycle is
 * free.
 */
const RSS_GAP_MS = 45_000;

const NICHE_MIN_UPVOTES = 1_000;
const NICHE_SUBS = new Set(['cryptocurrency', 'cryptomoonshots', 'solana', 'memecoins', 'defi', 'wallstreetbets', 'dogecoin', 'pepecoin', 'shib', 'AICoins']);

class RedditCollector extends BaseCollector {
  constructor(config, logger, db) {
    super('Reddit', logger);
    // Env overrides (config.reddit.*) — when set, take priority over the
    // preset config. Operators who pin a fixed subreddit list via env keep
    // that pin regardless of which preset is active.
    this.envCustomSubs    = config.reddit.subreddits?.length ? config.reddit.subreddits : null;
    this.envMinUpvotes    = Number.isFinite(+config.reddit.minUpvotes) ? +config.reddit.minUpvotes : null;
    this.envPostsPerSub   = Number.isFinite(+config.reddit.postsPerSubreddit) ? +config.reddit.postsPerSubreddit : null;
    this.db = db;
    // Resolved at start of every collect() call so admin "Пресеты" edits
    // pick up on the next cycle without a restart.
    this.minUpvotes  = this.envMinUpvotes  ?? 5000;
    this.postsPerSub = this.envPostsPerSub ?? 50;
  }

  _resolveRedditConfig() {
    let cfg = {};
    try { cfg = getActivePresetConfig(this.db).sources?.reddit || {}; }
    catch (_) { cfg = {}; }
    return {
      subreddits:        this.envCustomSubs   || cfg.subreddits || [],
      minUpvotes:        this.envMinUpvotes   ?? cfg.minUpvotes ?? 5000,
      postsPerSubreddit: this.envPostsPerSub  ?? cfg.postsPerSubreddit ?? 50,
    };
  }

  _getSubreddits() {
    return this._resolveRedditConfig().subreddits;
  }

  async collect() {
    // Refresh per-preset knobs at the start of every cycle. Within a single
    // collect() call _filterByMinBar (line ~310) reads this.minUpvotes, so
    // we set the instance fields once here and trust callees to use them.
    const cfg = this._resolveRedditConfig();
    this.minUpvotes  = cfg.minUpvotes;
    this.postsPerSub = cfg.postsPerSubreddit;
    const allItems = [];
    const subreddits = cfg.subreddits;

    // TWO requests per cycle, not one per subreddit.
    //
    // Reddit's unauthenticated JSON API returns 403 for every listing since
    // ~2026-08, so every fetch falls through to RSS — and RSS rate-limits hard:
    // measured from prod, roughly one request in three succeeds no matter how
    // they are paced. Ten sequential per-sub requests therefore collapsed into
    // ONE surviving subreddit per cycle (log evidence 2026-08-06: "Collected 1
    // items", against 20-45 on the days before).
    //
    // A multireddit feed (`/r/a+b+c/`) returns all of them in a single request.
    // Same data, one hundredth of the rate-limit pressure. Verified from prod:
    // 100 entries across 8 distinct subs in one 200.
    try {
      allItems.push(...await this._fetchMultiRSS(subreddits));
    } catch (error) {
      this.logger.warn(`[Reddit] multireddit hot feed failed: ${error.message}`);
      // No retry on this one, and it is the floor the whole source stands on —
      // count it every time.
      this.noteFailure(error);
    }

    // Story search — the second reading mode. `hot` answers "what is at the top
    // right now", which is a popularity question. This asks "what HAPPENED in
    // these subs this week", which is the question that finds narratives.
    // One story family per cycle, rotated, so the cost stays at one request.
    //
    // The gap before it is load-bearing. Reddit's RSS budget is roughly one
    // request per 30-45s from this IP: measured 45s apart both requests return
    // 200, measured 5s apart the second returns 429 (which is exactly what
    // happened on the first production cycle). Two requests spaced by
    // RSS_GAP_MS is the entire rate-limit strategy, and 45s inside a 30-minute
    // cycle costs nothing.
    const family = this._nextSearchFamily();
    for (let attempt = 1; attempt <= 2; attempt++) {
      await this._delay(RSS_GAP_MS);
      try {
        const items = await this._fetchMultiSearch(subreddits, family);
        if (items.length > 0) { allItems.push(...items); break; }
        // Empty means refused (the method logs the status) — one more try, then
        // let it go. The hot feed above is the floor.
        if (attempt === 2) {
          this.logger.warn(`[Reddit] story search ${family} gave up after 2 attempts`);
          this.noteFailure(new Error(
            `story search ${family} gave up after 2 attempts` +
            (this._lastSearchStatus ? ` (HTTP ${this._lastSearchStatus})` : '')
          ));
        }
      } catch (error) {
        this.logger.warn(`[Reddit] story search (${family}) failed: ${error.message}`);
        this.noteFailure(error);
        break;
      }
    }

    // Deduplicate by post ID
    const seen = new Set();
    return allItems.filter(item => {
      if (seen.has(item.externalId)) return false;
      seen.add(item.externalId);
      return true;
    });
  }

  /** Browser-shaped headers. Reddit refuses non-browser UAs outright. */
  _rssHeaders() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/atom+xml, text/xml, */*',
    };
  }

  _buildMultiRssUrl(subreddits) {
    if (!subreddits?.length) return null;
    return `https://www.reddit.com/r/${subreddits.join('+')}/hot/.rss?limit=100`;
  }

  /**
   * Search across the whole multireddit for one story family.
   *
   * `restrict_sr=on` is load-bearing: without it Reddit silently widens the
   * query to all of Reddit and the preset stops meaning anything.
   */
  _buildMultiSearchUrl(subreddits, family) {
    const def = STORY_FAMILIES[family];
    if (!def) throw new Error(`[Reddit] unknown story family: ${family}`);
    if (!subreddits?.length) return null;

    const q = def.probeTerms.map(t => (t.includes(' ') ? `"${t}"` : t)).join(' OR ');
    const params = new URLSearchParams({
      q,
      restrict_sr: 'on',
      sort:        'top',
      t:           'week',
      limit:       '50',
    });
    return `https://www.reddit.com/r/${subreddits.join('+')}/search.rss?${params.toString()}`;
  }

  /** Rotates through the four story families, one per cycle. */
  _nextSearchFamily() {
    this._searchCycle = (this._searchCycle || 0) + 1;
    return PROBE_ROTATION[this._searchCycle % PROBE_ROTATION.length];
  }

  async _fetchMultiRSS(subreddits) {
    const url = this._buildMultiRssUrl(subreddits);
    if (!url) return [];

    const response = await fetch(url, { headers: this._rssHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const items = this._parseAtomFeed(await response.text());
    // RSS carries no scores, so freshness is the only bar available here.
    // Kept at 6h: the same proxy the old per-sub fallback used.
    const fresh = items.filter(item => (item.metrics.ageHours || 99) < 6);
    this.logger.info(`[Reddit] multireddit hot: ${fresh.length} fresh of ${items.length} across ${subreddits.length} subs`);
    return fresh;
  }

  async _fetchMultiSearch(subreddits, family) {
    const url = this._buildMultiSearchUrl(subreddits, family);
    if (!url) return [];

    const response = await fetch(url, { headers: this._rssHeaders() });
    // Never throw on refusal: one dead search must not take collect() down,
    // and the hot feed above is the floor either way.
    if (!response.ok) {
      this.logger.warn(`[Reddit] story search ${family} → HTTP ${response.status}`);
      // Deliberately NOT noteFailure() here. A single 429 is routine — Reddit
      // passes roughly one RSS request in three — and the caller retries. The
      // failure is recorded only where the cycle actually gives up, otherwise
      // a third of all cycles would look faulty and the alert would cry wolf
      // about twice a week.
      this._lastSearchStatus = response.status;
      return [];
    }

    // Search results span the whole week on purpose — a story worth telling
    // does not stop being one after six hours — so the freshness filter that
    // guards the hot feed is deliberately NOT applied here. They arrive
    // pre-marked as narrative, which is what earns them the priority lane.
    const items = this._parseAtomFeed(await response.text(), { fromProbe: true });
    this.logger.info(`[Reddit] story search ${family}: ${items.length} items`);
    return items;
  }

  /**
   * Per-subreddit JSON fetch — NOT called by `collect()` since 2026-08-07.
   *
   * Reddit answers 403 to every unauthenticated `.json` listing (verified from
   * prod against www / old / api hosts, and from a second network), so this
   * path cannot succeed today. It is kept, with `_normalize` and
   * `_fetchRSSFallback`, because it is the shape the collector returns to the
   * moment credentials exist: swap the host for `oauth.reddit.com`, add the
   * bearer header, and real scores come back — which is the only way the
   * `minUpvotes` bar can ever apply again.
   *
   * Until then the live path is `_fetchMultiRSS` + `_fetchMultiSearch`.
   */
  async _fetchJSON(subreddit) {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${this.postsPerSub}&raw_json=1`;

    const response = await fetch(url, {
      headers: {
        // Reddit blocks non-browser UAs — mimic Chrome
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });

    if (response.status === 403 || response.status === 429) {
      this.logger.warn(`[Reddit] JSON API blocked for r/${subreddit} (${response.status}) — falling back to RSS`);
      return this._fetchRSSFallback(subreddit);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const posts = data?.data?.children || [];

    return posts
      .map(child => this._normalize(child.data, subreddit))
      .filter(Boolean);
  }

  /**
   * RSS fallback — no upvote counts, but filters by freshness (< 6h) and uses
   * position-on-page as a proxy for popularity. Only keeps recent posts from
   * high-quality subreddits to reduce noise.
   */
  async _fetchRSSFallback(subreddit) {
    const url = `https://www.reddit.com/r/${subreddit}/hot/.rss?limit=50`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/atom+xml, text/xml, */*',
      },
    });
    if (!response.ok) throw new Error(`RSS fallback failed: HTTP ${response.status}`);

    const text = await response.text();
    const items = this._parseAtomFeed(text);

    // RSS has no scores — only keep very fresh top-page posts as a rough proxy
    return items.filter(item => (item.metrics.ageHours || 99) < 6);
  }

  /**
   * @param {string} xml
   * @param {object} [opts]
   * @param {boolean} [opts.fromProbe] — came from the story search, so it is
   *        narrative by provenance rather than by wording.
   */
  _parseAtomFeed(xml, opts = {}) {
    const laneEnabled = isNarrativeLaneEnabled(this.db);

    return parseRedditAtomFeed(xml).map((post, position) => {
      const ageHours = post.createdAt
        ? (Date.now() - post.createdAt) / 3_600_000
        : 99;
      const imageUrls = (post.media || [])
        .filter(m => m?.type === 'photo' && m.url)
        .map(m => m.url);

      const item = {
        externalId: `reddit_${post.id}`,
        source:     'reddit',
        title:      post.title,
        description:'',
        url:        post.permalink,
        metrics: {
          upvotes:   0,           // unknown via RSS
          comments:  0,
          ageHours:  Math.round(ageHours * 10) / 10,
          velocity:  0,
          engagement:0,
          subreddit: post.author?.subreddit || '',
          author:    post.author?.name ? `u/${post.author.name}` : '',
          imageUrl:  imageUrls[0] || null,
          imageUrls,
          position,               // proxy: lower = more popular on page
        },
      };

      // The lane belongs here too, not only in `_normalize`. RSS is the path
      // Reddit actually takes now, and the lexical classifier only needs a
      // title — which RSS has. Skipping it would mean every Reddit item on the
      // live path silently counts as volume.
      if (opts.fromProbe) item._fromProbe = true;
      const { lane, reason } = resolveLane(item, { enabled: laneEnabled });
      item.lane       = lane;
      item.laneReason = reason;
      return item;
    });
  }

  _extractTag(xml, tag) {
    const m = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(xml);
    return m ? m[1].trim() : null;
  }

  _extractAttr(xml, tag, attr) {
    const m = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*/?>`, 'i').exec(xml);
    return m ? m[1] : null;
  }

  _decodeHtml(text) {
    return text
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
  }

  /**
   * Pick the best available image URL from a Reddit post.
   * Priority:
   *   1. Direct image post (.jpg/.png/.gif/.webp)
   *   2. Video/GIF preview thumbnail at source resolution
   *   3. Reddit preview at source resolution (full-quality)
   *   4. First image from a gallery (source resolution)
   *   5. Low-res thumbnail (last resort — 140×140, what was used before the fix)
   *
   * NB: reddit JSON is fetched with ?raw_json=1 so URLs are NOT HTML-escaped.
   */
  _bestImage(post) {
    if (!post) return null;

    // 1. Direct image link (i.redd.it, i.imgur.com, etc.)
    const directUrl = post.url_overridden_by_dest || post.url;
    if (directUrl && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(directUrl)) {
      return directUrl;
    }

    // 2. Preview source (full-quality preview that Reddit itself generates)
    const previewSrc = post.preview?.images?.[0]?.source?.url;
    if (previewSrc) return previewSrc;

    // 3. Video/GIF post — preview.reddit_video_preview or media.oembed.thumbnail
    const videoPreview = post.preview?.reddit_video_preview?.fallback_url;
    if (videoPreview) return videoPreview;
    const oembedThumb = post.media?.oembed?.thumbnail_url;
    if (oembedThumb) return oembedThumb;

    // 4. Galleries — first item's source URL
    if (post.is_gallery && post.media_metadata) {
      const firstId = post.gallery_data?.items?.[0]?.media_id;
      const item = firstId && post.media_metadata[firstId];
      const srcUrl = item?.s?.u || item?.s?.gif;
      if (srcUrl) return srcUrl;
    }

    // 5. Low-res thumbnail fallback
    if (post.thumbnail?.startsWith('http')) return post.thumbnail;
    return null;
  }

  /**
   * Pick a direct, Telegram-friendly MP4 URL for a Reddit video post.
   * Returns null if the post isn't video-y.
   *
   * Caveat: v.redd.it uses DASH, so `fallback_url` is VIDEO-ONLY (no audio).
   * Muxing would require FFmpeg — out of scope. We accept silent playback.
   */
  _bestVideo(post) {
    if (!post) return null;

    // 1. Native Reddit-hosted video (v.redd.it) — silent MP4
    const rv = post.media?.reddit_video || post.secure_media?.reddit_video;
    if (rv?.fallback_url) return rv.fallback_url.split('?')[0];

    // 2. Reddit's video preview (e.g. for cross-posted/gif-as-video content)
    const prev = post.preview?.reddit_video_preview;
    if (prev?.fallback_url) return prev.fallback_url.split('?')[0];

    // 3. Direct link — .mp4 / .webm
    const directUrl = post.url_overridden_by_dest || post.url || '';
    if (/\.(mp4|webm)(\?|$)/i.test(directUrl)) return directUrl;

    // 4. Imgur .gifv → swap to .mp4 (their HTML wrapper is not playable)
    if (/imgur\.com\/\w+\.gifv$/i.test(directUrl)) {
      return directUrl.replace(/\.gifv$/i, '.mp4');
    }

    // 5. oEmbed video (YouTube/Vimeo embeds aren't direct MP4 — skip)
    return null;
  }

  /**
   * Collect ALL image URLs from a post — primarily for Reddit galleries.
   * Returns up to 10 URLs (Telegram media-group cap). Order preserved.
   * For single-image posts returns [bestImage] (array of 1).
   */
  _allImages(post) {
    if (!post) return [];
    const out = [];

    // Gallery: full order from gallery_data.items
    if (post.is_gallery && post.media_metadata && post.gallery_data?.items?.length) {
      for (const gi of post.gallery_data.items) {
        const item = post.media_metadata[gi.media_id];
        const url  = item?.s?.u || item?.s?.gif;
        if (url && !out.includes(url)) out.push(url);
        if (out.length >= 10) break;
      }
      if (out.length) return out;
    }

    // Non-gallery: fall back to best single image
    const best = this._bestImage(post);
    if (best) out.push(best);
    return out;
  }

  _normalize(post, requestedSub) {
    if (!post || !post.title) return null;

    const score    = post.score       || 0;   // upvotes (net)
    const comments = post.num_comments || 0;
    const upvoteRatio = post.upvote_ratio || 0;
    const sub      = post.subreddit    || requestedSub;
    const isNiche  = NICHE_SUBS.has(sub.toLowerCase());
    const minBar   = isNiche ? NICHE_MIN_UPVOTES : this.minUpvotes;

    // Hard filter — if it's not popular enough, skip entirely
    if (score < minBar) return null;

    // Also skip very controversial posts (ratio < 0.6) — usually drama, not memes
    if (upvoteRatio < 0.6 && score < 20_000) return null;

    const id          = post.id        || post.name;
    const title       = post.title     || '';
    const url         = post.url       || `https://reddit.com${post.permalink}`;
    const permalink   = `https://reddit.com${post.permalink}`;
    const createdUtc  = post.created_utc ? post.created_utc * 1000 : Date.now();
    const ageHours    = (Date.now() - createdUtc) / 3_600_000;

    // Engagement composite
    const engagement  = score + comments * 5;
    const velocity    = ageHours > 0 ? Math.round(score / ageHours) : score;

    // Skip very old posts (> 48h) — they're not trending anymore
    if (ageHours > 48) return null;

    const item = {
      externalId: `reddit_${id}`,
      source:     'reddit',
      title:      title,
      description: post.selftext?.substring(0, 300) || '',
      url:        permalink,
      metrics: {
        upvotes:     score,
        comments,
        upvoteRatio,
        ageHours:    Math.round(ageHours * 10) / 10,
        velocity,        // upvotes/hour — key virality signal
        engagement,
        subreddit:   sub,
        flair:       post.link_flair_text || '',
        imageUrl:    this._bestImage(post),
        imageUrls:   this._allImages(post),
        videoUrl:    this._bestVideo(post),
        // For scorer compatibility
        score,
      },
    };

    // No ledger lookup here on purpose — subject names arrive from Stage 0b,
    // which runs after collection. The clusterer re-checks the lane once the
    // names exist (see clusterer.route).
    const { lane, reason } = resolveLane(item, { enabled: isNarrativeLaneEnabled(this.db) });
    item.lane       = lane;
    item.laneReason = reason;
    return item;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default RedditCollector;
