// URL → synthetic-trend resolver. Used by the admin's "Ручной анализ" tab,
// the dashboard's pro/admin manual-analysis endpoint, and the Telegram bot's
// URL-paste handler. All three need to take a raw URL (Twitter/X, Reddit,
// TikTok, or any og:image-bearing page) and produce a trend object that
// Scorer can consume.
//
// Pure functions — no `this`, no class state. Extracted from admin/server.js
// 2026-05-01 when manual analysis became multi-surface.
//
// All resolvers throw on unrecoverable errors (404, parse failure, no title).
// Caller is expected to catch and report to the user.

const FETCH_TIMEOUT_MS = 8000;

/**
 * Top-level dispatcher. Picks a resolver based on the host and returns the
 * synthetic trend. Throws if the URL doesn't match any known shape and
 * generic og:image fallback also fails.
 *
 * @param {string} rawUrl
 * @returns {Promise<Object>}  trend-shaped object ready for scorer.scoreTrends()
 */
export async function resolveUrlToTrend(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) throw new Error('URL is empty');
  if (!/^https?:\/\//i.test(url)) throw new Error('URL must start with http(s)://');

  const isTwitter = /^https?:\/\/(www\.|mobile\.)?(twitter|x)\.com\//i.test(url);
  const isReddit  = /^https?:\/\/(www\.|old\.|new\.)?reddit\.com\//i.test(url);
  const isTiktok  = /^https?:\/\/(www\.)?tiktok\.com\//i.test(url);

  if (isTwitter) return resolveTwitterUrl(url);
  if (isReddit)  return resolveRedditUrl(url);
  if (isTiktok)  return resolveTiktokUrl(url);
  return resolveGenericUrl(url);
}

// ── Twitter / X ─────────────────────────────────────────────────────────────
// Uses fxtwitter's free JSON proxy (api.fxtwitter.com/i/status/<id>) — no
// auth required, returns engagement counts + author + media (main + quote
// + reply parent).

export async function resolveTwitterUrl(url) {
  const m = url.match(/(?:twitter|x)\.com\/[^/?#]+\/status\/(\d+)/i);
  if (!m) throw new Error('Not a valid tweet URL');
  const [, tweetId] = m;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`https://api.fxtwitter.com/i/status/${tweetId}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Catalyst/3.0', 'Accept': 'application/json' },
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`fxtwitter ${r.status}`);
    const data = await r.json();
    const tw = data?.tweet;
    if (!tw) throw new Error('Tweet not found');

    const likes    = tw.likes    || 0;
    const retweets = tw.retweets || 0;
    const replies  = tw.replies  || 0;
    const views    = tw.views    || 0;
    const author   = tw.author?.screen_name || 'unknown';
    const text     = tw.text || '';
    const createdAt = tw.created_at ? new Date(tw.created_at) : null;
    const ageHours  = createdAt ? Math.max(0.25, (Date.now() - createdAt.getTime()) / 3_600_000) : 1;
    const engagement = likes + retweets * 2;
    const velocity  = Math.round(engagement / ageHours);

    // Pull media (main + quote + reply-parent) — mirrors /api/preview
    const upgrade = (u) => {
      if (!u || !/pbs\.twimg\.com\//.test(u)) return u;
      try {
        const x = new URL(u);
        x.searchParams.set('name', 'orig');
        if (!x.searchParams.get('format')) {
          const ext = x.pathname.match(/\.(jpe?g|png|webp)$/i)?.[1] || 'jpg';
          x.searchParams.set('format', ext.toLowerCase().replace('jpeg', 'jpg'));
        }
        return x.toString();
      } catch { return u; }
    };
    const imageUrls = [];
    const pushMedia = (list) => {
      if (!Array.isArray(list)) return;
      for (const m of list) {
        const raw = m?.type === 'photo' ? (m.url || m.thumbnail_url) : (m?.thumbnail_url || m?.url);
        const u = raw ? upgrade(raw) : null;
        if (u && !imageUrls.includes(u)) imageUrls.push(u);
      }
    };
    pushMedia(tw.media?.all);
    pushMedia(tw.quote?.media?.all);
    pushMedia(tw.replying_to?.media?.all);

    const pickVideo = (list) => {
      if (!Array.isArray(list)) return null;
      for (const m of list) {
        if (m?.type === 'video' || m?.type === 'gif') {
          return m.url || m.thumbnail_url;
        }
      }
      return null;
    };
    const videoUrl = pickVideo(tw.media?.all) || pickVideo(tw.quote?.media?.all) || null;

    const hashtags = [...new Set((text.match(/#\w+/g) || []).map(h => h.toLowerCase()))];
    const tickers  = [...new Set(text.match(/\$[A-Z]{2,8}/g) || [])];

    const title = (hashtags[0] && tickers[0]) ? `${hashtags[0]} ${tickers[0]}`
                : hashtags[0] || tickers[0]
                || text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().substring(0, 120);

    return {
      externalId: `manual_twitter_${tweetId}`,
      source: 'twitter',
      title: title || `Tweet by @${author}`,
      originalTitle: title || `Tweet by @${author}`,
      description: text.substring(0, 300),
      url: `https://twitter.com/${author}/status/${tweetId}`,
      metrics: {
        views, likes, retweets, replies,
        upvotes: engagement,
        velocity,
        ageHours: Math.round(ageHours * 10) / 10,
        hashtags, tickers,
        author: `@${author}`,
        followers: tw.author?.followers || 0,
        thumbnailUrl: imageUrls[0] || null,
        imageUrls,
        videoUrl,
        searchQuery: '(manual)',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Reddit ──────────────────────────────────────────────────────────────────
// Reddit's <permalink>.json endpoint — public, returns full post data
// including gallery + reddit_video fallback URLs.

export async function resolveRedditUrl(url) {
  const jsonUrl = url.replace(/\/?(\?.*)?$/, '') + '.json?raw_json=1';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(jsonUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Catalyst/3.0)', 'Accept': 'application/json' },
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`reddit ${r.status}`);
    const data = await r.json();
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) throw new Error('Reddit post not found');

    const score     = post.score || post.ups || 0;
    const comments  = post.num_comments || 0;
    const createdAt = post.created_utc ? new Date(post.created_utc * 1000) : null;
    const ageHours  = createdAt ? Math.max(0.25, (Date.now() - createdAt.getTime()) / 3_600_000) : 1;
    const velocity  = Math.round(score / ageHours);
    const subreddit = post.subreddit || '';
    const author    = post.author || '';

    let imageUrl = null;
    const directUrl = post.url_overridden_by_dest || post.url;
    if (directUrl && /\.(jpe?g|png|gif|webp)(\?|$)/i.test(directUrl)) imageUrl = directUrl;
    else if (post.preview?.images?.[0]?.source?.url) imageUrl = post.preview.images[0].source.url;
    else if (post.is_gallery && post.media_metadata) {
      const firstId = post.gallery_data?.items?.[0]?.media_id;
      const item = firstId && post.media_metadata[firstId];
      imageUrl = item?.s?.u || item?.s?.gif || null;
    }
    const imageUrls = [];
    if (imageUrl) imageUrls.push(imageUrl);
    if (post.is_gallery && post.media_metadata && post.gallery_data?.items) {
      for (const it of post.gallery_data.items) {
        const m = post.media_metadata[it.media_id];
        const u = m?.s?.u || m?.s?.gif;
        if (u && !imageUrls.includes(u)) imageUrls.push(u);
      }
    }

    const videoUrl = post.preview?.reddit_video_preview?.fallback_url
                  || post.media?.reddit_video?.fallback_url
                  || null;

    return {
      externalId: `manual_reddit_${post.id}`,
      source: 'reddit',
      title: post.title || '(untitled Reddit post)',
      originalTitle: post.title || '(untitled Reddit post)',
      description: (post.selftext || '').substring(0, 400),
      url: 'https://reddit.com' + (post.permalink || ''),
      metrics: {
        upvotes: score,
        comments,
        velocity,
        ageHours: Math.round(ageHours * 10) / 10,
        subreddit,
        author: `u/${author}`,
        thumbnailUrl: imageUrls[0] || null,
        imageUrls,
        videoUrl,
        searchQuery: '(manual)',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── TikTok ──────────────────────────────────────────────────────────────────
// oEmbed only — TikTok doesn't expose play counts via public APIs without
// an Apify-style scraper. Title + thumbnail is enough for Stage 1 to score.

export async function resolveTiktokUrl(url) {
  const videoIdMatch = url.match(/\/video\/(\d+)/);
  if (!videoIdMatch) throw new Error('Not a valid TikTok URL');
  const videoId = videoIdMatch[1];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Catalyst/3.0', 'Accept': 'application/json' },
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`tiktok ${r.status}`);
    const data = await r.json();
    const title  = (data.title || '').substring(0, 200);
    const author = data.author_name || '';
    const thumb  = data.thumbnail_url || null;
    return {
      externalId: `manual_tiktok_${videoId}`,
      source: 'tiktok',
      title: title || '(TikTok video)',
      originalTitle: title || '(TikTok video)',
      description: title,
      url,
      metrics: {
        upvotes: 0,
        comments: 0,
        velocity: 0,
        ageHours: 1,
        author: `@${author}`,
        thumbnailUrl: thumb,
        imageUrls: thumb ? [thumb] : [],
        videoUrl: null,
        searchQuery: '(manual)',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── Generic web page (og:image / og:title) ──────────────────────────────────

export async function resolveGenericUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Catalyst/3.0)' },
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) throw new Error('Not an HTML page');
    const html = await r.text();
    const pick = (re) => { const m = html.match(re); return m ? m[1] : ''; };
    const title = pick(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
               || pick(/<title[^>]*>([^<]+)<\/title>/i);
    const desc  = pick(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
               || pick(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const image = pick(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    const cleanTitle = (title || '').replace(/\s+/g, ' ').trim().substring(0, 200);
    const cleanDesc  = (desc  || '').replace(/\s+/g, ' ').trim().substring(0, 400);
    if (!cleanTitle) throw new Error('No title or og:title found on page');
    return {
      externalId: `manual_web_${Buffer.from(url).toString('base64').substring(0, 16)}`,
      source: 'web',
      title: cleanTitle,
      originalTitle: cleanTitle,
      description: cleanDesc,
      url,
      metrics: {
        upvotes: 0,
        comments: 0,
        velocity: 0,
        ageHours: 1,
        thumbnailUrl: image || null,
        imageUrls: image ? [image] : [],
        videoUrl: null,
        searchQuery: '(manual)',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
