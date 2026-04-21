/**
 * Twitter/X On-Demand Checker — uses Apify's Twitter Scraper actor
 * Called on user request (button click), NOT automatically on every scan.
 */

const MAX_TWEETS = 5;
const TIMEOUT_SECS = 60;

// Mirror of the main collector's actor registry. Kept in-sync manually —
// when you add an actor here, also add it in src/collectors/twitter.js.
const ACTORS = {
  kaitoeasyapi: {
    id: 'kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest',
    // Use searchTerms[] — see comment in twitter.js ACTORS for the why.
    buildInput: (query, maxItems) => ({
      searchTerms: [query], maxItems, queryType: 'Top',
    }),
  },
  xquik: {
    id: 'xquik~x-tweet-scraper',
    buildInput: (query, maxItems) => ({
      searchTerms: [query], maxItems, queryType: 'Top', includeSearchTerms: false,
    }),
  },
};
const DEFAULT_ACTOR = 'kaitoeasyapi';

class TwitterChecker {
  constructor(config, logger, db = null) {
    this.twitterKeys = config?.apify?.twitterKeys || {};
    this.logger = logger;
    this.db = db;
    this.enabled = Object.values(this.twitterKeys).some(Boolean);
  }

  _activeActor() {
    const chosen = (this.db?.getSetting('twitterActor', DEFAULT_ACTOR) || DEFAULT_ACTOR).toLowerCase();
    const def = ACTORS[chosen] || ACTORS[DEFAULT_ACTOR];
    const key = this.twitterKeys[chosen] || this.twitterKeys[DEFAULT_ACTOR] || '';
    const name = ACTORS[chosen] ? chosen : DEFAULT_ACTOR;
    return { name, def, key };
  }

  /**
   * Search Twitter for a given narrative keyword query.
   * Returns a structured result object, or null on failure.
   */
  async searchNarrative(query) {
    if (!this.enabled) {
      throw new Error('Apify API key not configured (APIFY_API_KAITO / APIFY_API_XQUIK missing from .env)');
    }

    const { name: actorName, def: actor, key: apiKey } = this._activeActor();
    if (!apiKey) {
      throw new Error(`[Twitter/X] No API key configured for actor '${actorName}'`);
    }
    this.logger.info(`[Twitter/X] Searching via '${actorName}' for: "${query}"`);

    const runUrl = `https://api.apify.com/v2/acts/${actor.id}/run-sync-get-dataset-items?token=${apiKey}&timeout=${TIMEOUT_SECS}`;
    const input = actor.buildInput(query, MAX_TWEETS);

    const response = await fetch(runUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Apify error ${response.status}: ${err.substring(0, 200)}`);
    }

    const tweets = await response.json();
    if (!Array.isArray(tweets) || tweets.length === 0) return null;

    return this._summarize(tweets, query);
  }

  _summarize(tweets) {
    let totalViews = 0;
    let totalLikes = 0;
    let totalRetweets = 0;
    let totalReplies = 0;

    const accounts = [];

    for (const t of tweets) {
      totalViews    += t.viewCount    || t.viewsCount      || 0;
      totalLikes    += t.likeCount    || t.favoriteCount   || 0;
      totalRetweets += t.retweetCount || t.retweet_count   || 0;
      totalReplies  += t.replyCount   || t.reply_count     || 0;

      const user = t.author?.userName || t.user?.screen_name || t.userName;
      if (user && accounts.length < 5 && !accounts.includes(`@${user}`)) {
        accounts.push(`@${user}`);
      }
    }

    // Virality score: weighted log formula
    const viralityScore = Math.min(100, Math.round(
      (Math.log10(tweets.length + 1) * 15) +
      (Math.log10(totalViews + 1) * 10) +
      (Math.log10(totalLikes + 1) * 12) +
      (Math.log10(totalRetweets + 1) * 15)
    ));

    return {
      tweetCount: tweets.length,
      totalViews,
      totalLikes,
      totalRetweets,
      totalReplies,
      viralityScore,
      accounts,
    };
  }

  /**
   * Build a clean search query from narrative title
   */
  static buildQuery(title) {
    if (!title) return '';
    
    // Support Unicode (Russian, etc.) by using \p{L} (letters) and \p{N} (numbers)
    const words = title
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 3);

    return words.join(' ');
  }
}

export default TwitterChecker;
