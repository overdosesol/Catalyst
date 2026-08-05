/**
 * AI prompts for memecoin trend virality analysis
 *
 * v3 changes:
 *  - Adapted for general world trends (not crypto-native content)
 *  - Input = mainstream viral trends from Reddit, Twitter, Google Trends, TikTok
 *  - Task = evaluate each trend's potential to become a Solana memecoin
 *  - Improved scoring rubric with clearer examples
 *  - Better multilingual handling (trends come in all languages)
 */

import { LIFESPAN_VALUES, LIFESPAN_DESCRIPTORS } from './lifespan.js';

/**
 * Single source of truth for the alert-type axis. event/trend/post.
 * Surfaces (db, scorer, dashboard, telegram) all import this constant
 * so adding a value or renaming one fails loudly at module load.
 */
export const ALERT_TYPE_VALUES = ['event', 'trend', 'post'];

/**
 * Normalise an arbitrary string (from AI, DB, user input) to a valid
 * alert-type or null. Empty/garbage → null so callers can apply the
 * deterministic fallback (whyNow → event, platforms≥2 → trend, else post).
 */
export function normalizeAlertType(v) {
  const s = String(v || '').trim().toLowerCase();
  return ALERT_TYPE_VALUES.includes(s) ? s : null;
}

// Human-readable form for the Stage 1 prompt: "flash=hours, short=1-2 days, ..."
const LIFESPAN_HINT = LIFESPAN_VALUES
  .map(k => `${k}=${LIFESPAN_DESCRIPTORS[k]}`)
  .join(', ');

export const SYSTEM_PROMPT = `You are DEGEN-PARSER's SCORER and ALERT WRITER. Stage 0b (a multimodal observer) has watched the media and reported FACTS about it — what is visible and audible, the format, and whether it looks authentic. It does NOT score. You do.

You see things Stage 0b cannot: engagement metrics, how old the trend is, how many posts the narrative spans, junk signals, user feedback — and the OTHER TRENDS IN THIS BATCH. Use all of it.

━━━ YOUR JOB ━━━
For every trend, return:

• memePotential:  0-100. THE score — how strong this is as a memecoin narrative. Rubric below.
• viralityScore:  0-100. Engagement-based virality (likes/views/upvotes weighted by velocity and age).
• category:       one of [meme, celebrity, animals, tech, gambling, sports, politics, entertainment, gaming, boring, other]

• title:                     SHORT punchy English headline summarizing the trend. Use Stage 0b's subjectNames where relevant. NEVER a clickbait stub — finish the thought. ≤120 chars.
• explanation:               ONE short sentence (≤200 chars) explaining the memecoin angle — terse, no filler.
• whyNow:                    1-2 sentences (≤280 chars) naming the concrete trigger event (who/what/timing) — what JUST happened that makes this alert-worthy NOW. Empty string if there is no specific trigger and the trend is just bubbling.
• alertType:                 "event" | "trend" | "post". See ALERT TYPE rules below.
• sentiment:                 "positive" | "negative" | "neutral" | "mixed". Tone of the ORIGINAL content (not your judgment of it).
• predictedLifespan:         How long this narrative is likely to stay relevant. Values: ${LIFESPAN_HINT}, or "unknown".
• isGenuinelyInteresting:    Boolean. FALSE for spam, bots, crypto promos, gibberish, recycled content with no fresh angle. TRUE for genuine narratives even if memePotential is low.
- needsDeeperLook: set true when this trend's importance is genuinely AMBIGUOUS — the title may hide the real story, judging it needs context you don't have, or it could be bigger than the surface suggests. Put a short why in escalationReason. Do NOT set it just because a score is high; this flags UNCERTAINTY, not interest. When unsure, use false and an empty escalationReason.
• storyScore:                0-100. Stickiness of the STORY. See NARRATIVE SCORING below.
• storyHook:                 ≤80 chars naming character + conflict + stakes. Empty string when storyScore < 60 — do not write a hook nobody will read.
• subjectName:               Tickerable proper noun attached to the narrative, or "" when there is none.
• nameStrength:              0-100. How tickerable that name is. 0 when subjectName is "".

━━━ SCORING RUBRIC (memePotential) ━━━
Be CONSERVATIVE and SPREAD scores across the range. Score 100 is reserved for the single best trend of the day.

Anchors:
• 95-100: Once-a-day rarity. EVERYTHING fires — named subject + visual punch + ticker hook + cultural pull.
• 80-94:  Excellent. Strong meme energy, ONE signal partial (no visual / no name / not yet a moment).
• 60-79:  Solid narrative. Most "good" trends belong HERE — default upper band.
• 40-59:  Decent meme energy but niche / generic / overdone.
• 20-39:  Weak — real news with little meme appeal, low novelty.
• 0-19:   Politics (non-meme) / routine sports scores / corporate news / weather / regular product launches.

Calibration check: "Is this clearly more meme-able than 9 of 10 viral trends in a normal day?" If no → not 95+. If 1-of-10 → 80-94. Most "good" actually-good trends are 60-79.

SCORING HARD RULES (apply BEFORE anchors):
• Politics (unless absurd viral meme) = 0.
• Standard sports results = 0. Exception: a player does something insane/absurd/meme-worthy.
• Spam, bots, crypto promos, gibberish → memePotential 0 + isGenuinelyInteresting=false.
• hasSubject=false AND hasNarrative=false → cap at 30.

SOURCE-AWARE METRIC CALIBRATION (input metrics include source):
• TikTok plays inflated 5-10× vs Twitter views. 500K-1M = baseline-viral; 5M+ = distinctive. DO NOT score 95+ just because plays=10M.
• TikTok shares × 50 ≈ Twitter retweets in cultural impact. 5K+ shares = stronger than likes.
• TikTok memes burn out in 24-48h. >72h-old TikTok = past peak. Twitter 5-7 days. Reddit 1-2 weeks.
• Reddit upvotes vote-democratized: 10K upvotes ≈ 100K+ readers. 500+ comments = real discussion.
• Google Trends "Searches: 200K+" = active demand, strong narrative signal even without social buzz.
• Mega-account (1M+ followers) low engagement (<0.1%) = NOT a signal by itself; score on CONTENT novelty.

viralityScore is a separate axis from memePotential: it measures engagement reality alone. Lower than memePotential when meme shape is good but engagement is lukewarm; higher when engagement is wildfire but the meme shape is mediocre.

━━━ READING THE OBSERVED FACTS ━━━
The "Observed:" line describes THE MEDIA, not the story. Read it accordingly:
• hasNarrative=false means nothing unfolds ON SCREEN. For a screenshot, a text post, a meme image or a photo that is always false, and it says NOTHING about whether there is a story — the story is in the text. Judge those from the title, description and visible text. Do NOT treat hasNarrative=false as evidence against a narrative unless the media is a VIDEO where nothing happens.
• hasSubject / subjects name who is on screen. A named subject in the text counts too, even when the frame is a wall of text.
• memeShape rates format only. A 40 on a screenshot of a genuinely funny post is normal and not a reason to score low.

━━━ BATCH CALIBRATION (you see several trends at once — use that) ━━━
Score RELATIVE to the batch in front of you, not in a vacuum. Rank them mentally first, then assign numbers. Multiple 90+ in one batch means you are inflating: at most one trend per batch belongs above 85, and most batches have none. A batch where every trend lands in 60-79 is a sign you are not discriminating — spread them.

━━━ COMPILATIONS ━━━
When Stage 0b reports isCompilation=true, or pattern=compilation, or its description says the clip is a series/montage of unrelated fragments: cap memePotential at 25 regardless of engagement. A compilation has no single narrative to attach to — the account packaging it is the only through-line, and that is not a story.

━━━ NO VISION AVAILABLE ━━━
When the input has no "Observed" block, Stage 0b did not run (text-only source, or it failed). Score from text alone and stay conservative: without seeing the media you cannot confirm a visual hook. Generic group-label titles ("Sea Animals sounds", "[Topic] Compilation", "Weird [Group] Sounds") describe a CATEGORY of content, not a narrative — cap at 25. A title with no concrete subject (no named person, animal, event or $TICKER) — cap at 35. With a concrete focal subject, score normally but stay in 35-65 unless engagement is extraordinary. Say in "explanation" that visual analysis was unavailable.

━━━ ALERT TYPE (signal shape) ━━━
• "event" — SPECIFIC trigger happened (someone did something, launch/scandal/breaking moment). If whyNow non-empty pointing to outside trigger → almost always "event".
• "trend" — narrative accumulating across MULTIPLE posts / platforms / authors. No single trigger; broadly bubbling.
• "post"  — ONE viral post without broader chatter. The post itself IS the story.
Tiebreaker: independent voices on same topic → "trend"; just this one post going viral → "post".

━━━ NARRATIVE SCORING (storyScore / subjectName) ━━━
Both feed ADDITIVE boosters downstream. They can only raise a score, never lower one — so
"unsure" means a LOW number, not a hedge in the middle. Stage 0b already gave you
hasNarrative / hasSubject / subjectNames / tickerSuggestion — use them, do not re-derive.

storyScore — stickiness of the story (named character + conflict + stakes = high):
• 85-100: named character + conflict + stakes + shareable backstory
• 60-84:  strong named character or memorable hook
• 30-59:  mild hook, specific moment but no arc
• 0-29:   no character / no story / generic

subjectName + nameStrength — a tickerable proper name. Animal / character / person /
catchphrase / $TICKER all count. Generic descriptors and topic labels do NOT → return "".
• 85-100: short, phonetic, unique, already memed
• 60-84:  solid name, easily shortened to a ticker
• 30-59:  long, generic, or competing with existing tokens
• 0-29:   weak / no name

━━━ HARD RULES ━━━
1. Inputs may be in ANY language. ALL OUTPUT FIELDS MUST BE IN ENGLISH.
2. Spam / bots / crypto promos / gibberish → memePotential 0 and isGenuinelyInteresting=false.
3. Never invent context. If the input is sparse, keep whyNow empty rather than fabricating a trigger.
4. Use Stage 0b's subjectNames in the title when there is a focal subject — readers care about WHO/WHAT, not abstract descriptions.
5. Respect engagement reality: do not write whyNow as if a trend is "trending" when it has no momentum signal.

Always respond with ONLY valid JSON. No markdown, no preamble, no explanation outside the JSON array.`;

// ─── Narrative-core guidance (2026-08-05) ────────────────────────────────────
//
// Spliced into SYSTEM_PROMPT ahead of BATCH CALIBRATION so it sits next to the
// other "how to read Stage 0b" guidance. Kept as its own constant because it is
// re-tuned far more often than the rest of the rubric.
//
// The last line is load-bearing: without it the model penalises weak core
// fields AND the code caps the same trend afterwards, punishing it twice for
// one flaw.
const NARRATIVE_CORE_BLOCK = `━━━ NARRATIVE CORE ━━━
Stage 0b also reports whether there is anything here to hold on to. Still observations, not verdicts — but these are the ones that separate a real narrative from a pleasant frame:
• "Retelling" — the event in one sentence with judgement words stripped out. "Retelling: NONE" means that after removing "cute / funny / weird", nothing was left but a mood or a pose. That is strong evidence there is no story, whatever the engagement says.
• replaceability — how interchangeable the subject is. 71+ means any member of the category would have produced the same clip: no identity, so nothing an audience can name or come back to.
• residue — what survives once views are zero and the imagery stops looking unusual. 20 or below means the whole appeal was spectacle.
• authDependency — whether the interest depends on believing it really happened. It matters together with aiOrigin: a generated clip that needs to be believed is a trap, a generated clip that fools nobody is just a meme.
50 on any of these means the observer was NOT SURE. Treat it as no signal, never as a negative.
Do NOT double-punish. Hard caps for the extreme values are applied in code after you. Your job is to score the content honestly; when these fields are weak, simply do not reach for the top bands.`;

/**
 * Assembled Stage 1 system prompt. Marker miss falls back to appending — losing
 * the block silently would be worse than misplacing it.
 * `test/potential-gates.test.mjs` asserts the marker still hits.
 */
function composeSystemPrompt() {
  const marker = '━━━ BATCH CALIBRATION';
  const at = SYSTEM_PROMPT.indexOf(marker);
  if (at < 0) return `${SYSTEM_PROMPT}\n\n${NARRATIVE_CORE_BLOCK}`;
  return `${SYSTEM_PROMPT.slice(0, at)}${NARRATIVE_CORE_BLOCK}\n\n${SYSTEM_PROMPT.slice(at)}`;
}

export const STAGE1_SYSTEM_PROMPT = composeSystemPrompt();

export function buildAnalysisPrompt(trends) {
  const trendList = trends.map((t, i) => {
    let detail = `${i + 1}. "${t.title}" [Source: ${t.source}]`;

    if (t.description) {
      detail += `\n   Description: ${t.description}`;
    }

    // ── PreStage enrichment (Stage 0) — only present when PreStage ran ──
    // Surface nano text-classifier and gemini vision outputs verbatim.
    // None of these influence routing; they're the factual base the scorer
    // works from.
    const ps = t.preStage;
    if (ps?.nano) {
      const n = ps.nano;
      if (n.topicSummary)                   detail += `\n   Topic: ${n.topicSummary}`;
      if (Array.isArray(n.entityCanonical) && n.entityCanonical.length > 0)
                                            detail += `\n   Entities: ${n.entityCanonical.slice(0, 8).join(', ')}`;
      if (n.slangDecoded && n.slangDecoded.trim())
                                            detail += `\n   Slang: ${n.slangDecoded}`;
      if (n.language && n.language !== 'en') detail += `\n   Language: ${n.language}`;
    }
    if (ps?.gemini) {
      const g = ps.gemini;
      // Stage 0b output. Visual/audio/spoken/text are factual descriptions of
      // the media. Topic/Slang/Entities/Language come from the enrichment
      // section (which used to live in nano). No score line: Stage 0b stopped
      // scoring on 2026-08-05.
      if (g.visualCaption)                  detail += `\n   Visual: ${g.visualCaption}`;
      if (g.videoSummary && g.videoSummary.trim())
                                            detail += `\n   Video: ${g.videoSummary}`;
      if (g.audioSummary && g.audioSummary.trim())
                                            detail += `\n   Audio: ${g.audioSummary}`;
      if (g.spokenText && g.spokenText.trim())
                                            detail += `\n   Speech: "${g.spokenText}"`;
      if (g.visibleText && g.visibleText.trim())
                                            detail += `\n   VisibleText: "${g.visibleText}"`;
      if (g.mood)                           detail += `\n   Mood: ${g.mood}`;

      // Enrichment block (Section B in the captioner prompt — was nano).
      if (g.topicSummary && g.topicSummary.trim())
                                            detail += `\n   Topic: ${g.topicSummary}`;
      if (g.slangDecoded && g.slangDecoded.trim())
                                            detail += `\n   Slang: ${g.slangDecoded}`;
      if (Array.isArray(g.entityCanonical) && g.entityCanonical.length > 0)
                                            detail += `\n   Entities: [${g.entityCanonical.join(', ')}]`;
      if (g.language && g.language !== 'en')
                                            detail += `\n   Language: ${g.language}`;

      // Observed facts (Sections C+D of the captioner). No score line any more:
      // since 2026-08-05 Stage 0b reports what it saw and Stage 1 does the
      // judging. The label is deliberately "Observed" — these are findings,
      // not instructions.
      const sigBits = [];
      if (Number.isFinite(g.memeShapeStrength)) sigBits.push(`memeShape=${g.memeShapeStrength}/100`);
      if (typeof g.hasNarrative === 'boolean')  sigBits.push(`hasNarrative=${g.hasNarrative}`);
      if (typeof g.hasSubject === 'boolean')    sigBits.push(`hasSubject=${g.hasSubject}`);
      if (g.viralPattern)                       sigBits.push(`pattern=${g.viralPattern}`);
      if (g.isCompilation === true)             sigBits.push(`COMPILATION`);
      if (g.aiOrigin && g.aiOrigin !== 'unclear') sigBits.push(`aiOrigin=${g.aiOrigin}`);
      if (g.aiTells && g.aiTells.trim())        sigBits.push(`aiTells="${g.aiTells}"`);
      if (g.presentedAsReal === false)          sigBits.push(`presentedAsReal=false`);
      if (g.tickerSuggestion && g.tickerSuggestion.trim())
                                                sigBits.push(`tickerHint=${g.tickerSuggestion}`);
      if (Array.isArray(g.subjectNames) && g.subjectNames.length > 0)
                                                sigBits.push(`subjects=[${g.subjectNames.join(', ')}]`);
      if (g.isAmbient === true)                 sigBits.push(`AMBIENT`);
      if (g.isLipSync === true)                 sigBits.push(`LIPSYNC`);

      // Section E — narrative core (2026-08-05). Absent on records captioned
      // before that date, hence the Number.isFinite guards.
      if (Number.isFinite(g.replaceability))
        sigBits.push(`replaceability=${g.replaceability}/100`);
      if (Number.isFinite(g.residue))
        sigBits.push(`residue=${g.residue}/100`);
      if (Number.isFinite(g.authenticityDependency))
        sigBits.push(`authDependency=${g.authenticityDependency}/100`);

      if (sigBits.length > 0)               detail += `\n   Observed: ${sigBits.join(', ')}`;

      // Retelling gets its own line — it is a sentence, and burying it in a
      // comma-joined list makes it read as one more flag. `typeof` rather than
      // a truthiness check: '' is MEANINGFUL here ("no event survived the
      // judgement-word strip"), undefined only means the record predates it.
      if (typeof g.retelling === 'string') {
        detail += g.retelling.trim()
          ? `\n   Retelling: "${g.retelling.trim()}"`
          : `\n   Retelling: NONE (nothing but mood or pose once judgement words are stripped)`;
      }
    }

    // [MARKET_STAGE] optional context hint — remove 3 lines to disable
    const _msHint = t.clusterMetrics?.marketStage && t.clusterMetrics.marketStage !== 'none'
      ? { tokenizing: '⚠️ Market signal: TOKENIZING — launch discussions / pump.fun mentioned', live: '🟢 Market signal: LIVE MARKET — contract address or DEX links found', overheated: '🔴 Market signal: OVERHEATED — trading active but late/rug language detected' }[t.clusterMetrics.marketStage]
      : null;
    if (_msHint) detail += `\n   ${_msHint}`;

    if (t.metrics) {
      const m = t.metrics;

      // Age — critical for freshness scoring
      if (m.ageHours !== undefined) detail += `\n   Age: ${m.ageHours}h`;

      // Reddit metrics
      if (m.upvotes)      detail += `\n   Upvotes: ${m.upvotes} | Comments: ${m.comments || 0} | Velocity: ${m.velocity || 0}/hr`;
      if (m.subreddit)    detail += ` | r/${m.subreddit}`;
      if (m.positionScore !== undefined) detail += ` | Feed position: #${m.positionScore}`;

      // Google Trends metrics
      if (m.formattedTraffic) detail += `\n   Google Searches: ${m.formattedTraffic} | Geo: ${m.geo || 'worldwide'}`;

      // Twitter/X metrics
      if (m.views || m.likes || m.retweets) {
        detail += `\n   Twitter: ${m.views || 0} views | ${m.likes || 0} likes | ${m.retweets || 0} RTs`;
        if (m.tweetCount)  detail += ` | ${m.tweetCount} tweets`;
        if (m.viralScore)  detail += ` | Viral score: ${m.viralScore}/100`;
        if (m.tickers?.length) detail += ` | Tickers seen: ${m.tickers.join(', ')}`;
        if (m.author)      detail += ` | Top account: ${m.author}`;
        if (m.followers)   detail += ` | Followers: ${m.followers}`;
        if (m.engagementRate !== undefined) detail += ` | Engagement Rate: ${m.engagementRate}%`;
      }
      // Legacy twitter cross-reference from on-demand checker
      if (m.twitter && m.twitter.tweetCount > 0) {
        const tw = m.twitter;
        detail += `\n   Twitter (${tw.windowHours}h): ${tw.tweetCount} tweets`;
        if (tw.totalViews   > 0) detail += ` | 👁 ${tw.totalViews}`;
        if (tw.totalLikes   > 0) detail += ` | ❤️ ${tw.totalLikes}`;
        if (tw.totalRetweets > 0) detail += ` | 🔁 ${tw.totalRetweets}`;
        detail += ` | Viral: ${tw.viralityScore}/100`;
      }

      // TikTok metrics — IMPORTANT: `plays`/`likes`/`shares` are the REPRESENTATIVE
      // video's own counts (the URL the user will click through to). They are
      // NOT cluster sums. When writing whyNow about a specific user/post, use
      // these numbers — referring to "@user posted with X plays" must match the
      // linked video. Cluster aggregates are exposed separately (next line) and
      // describe how many viral videos sit under the same hashtag.
      if (m.plays || m.videoCount) {
        detail += `\n   TikTok (single video): ${m.plays || 0} plays | ${m.likes || 0} likes | ${m.shares || 0} shares`;
        if (m.videoCount > 1) {
          detail += `\n   TikTok (hashtag cluster): ${m.videoCount} viral videos | total ${m.clusterPlays || 0} plays | ${m.clusterLikes || 0} likes | ${m.clusterShares || 0} shares — describes the WAVE, not any one user`;
        }
        if (m.sourceHashtag) detail += `\n   Source: #${m.sourceHashtag}`;
        if (m.tickers?.length) detail += ` | Tickers: ${m.tickers.join(', ')}`;
        if (m.followers)   detail += ` | Followers: ${m.followers}`;
        if (m.engagementRate !== undefined) detail += ` | Engagement Rate: ${m.engagementRate}%`;
      }
    }

    // Junk context.
    //
    // Emergence and ClusterSize were added here on 2026-08-05 (stage-roles swap)
    // and removed again the same day. Do not put them back. Two reasons:
    //   • Double counting. Emergence is a purely technical number (DB velocity,
    //     author spread, novelty, breakout, Reddit ideaBoost — clusterer.js).
    //     Feeding it to the model makes memePotential absorb it, and then
    //     computeAlertScore adds emergence AGAIN at weight 0.10.
    //   • ClusterSize is ~always 1 in practice, so the line carried no
    //     information while still inviting the model to reason about "waves".
    const cm = t.clusterMetrics || {};
    const junkReasons = t.junkReasons || cm.junkReasons || [];
    if (Array.isArray(junkReasons) && junkReasons.length > 0) {
      detail += `\n   JunkSignals: ${junkReasons.join(', ')} (heuristic hints — context, not a verdict)`;
    }

    return detail;
  }).join('\n\n');

  return `Write alerts for the following ${trends.length} trends.

For each trend, return a JSON object with these fields (definitions in the SYSTEM_PROMPT):
- "title", "explanation", "whyNow"        — narrative text (English, terse, no speculation)
- "alertType"                             — "event" | "trend" | "post"
- "sentiment"                             — "positive" | "negative" | "neutral" | "mixed"
- "predictedLifespan"                     — one of [${LIFESPAN_VALUES.join(', ')}] or "unknown"   (${LIFESPAN_HINT})
- "isGenuinelyInteresting"                — false ONLY for spam/bots/gibberish/recycled-no-angle
- "memePotential", "viralityScore", "category" — YOUR scores per the rubric. Categories: [meme, celebrity, animals, tech, gambling, sports, politics, entertainment, gaming, boring, other]
- "storyScore", "storyHook"               — narrative stickiness 0-100 + ≤80-char hook (empty when storyScore < 60)
- "subjectName", "nameStrength"           — tickerable proper noun + how tickerable 0-100 ("" and 0 when there is none)

The "Observed:" line holds FACTS from a model that watched the media — treat them as true. The scores are YOURS: judge each trend against the rubric and against the other trends in this batch. Use Stage 0b's subjectNames in the title where they exist.

Respond ONLY with { "trends": [ ... ] }. Same length as input. Same order. No markdown, no preamble.

TRENDS:
${trendList}`;
}

// ─── Stage 1 JSON schema (Structured Outputs) ────────────────────────────────
//
// Used with OpenAI Responses API `text.format = { type: "json_schema", ... }`.
// Schema constraints enforced by the API:
//   - root must be an object (we wrap the array in `{ trends: [...] }`)
//   - every property must appear in `required`
//   - `additionalProperties: false` everywhere
//   - all enums must be exhaustive (we mirror the prompt rubric)
//
// Order of fields here must stay aligned with `_analyzeBatchStage1` consumer
// in scorer.js — adding/removing a field requires both ends.
export const STAGE1_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['trends'],
  properties: {
    trends: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'viralityScore',
          'memePotential',
          'category',
          'alertType',
          'sentiment',
          'explanation',
          'whyNow',
          'predictedLifespan',
          'isGenuinelyInteresting',
          'needsDeeperLook',
          'escalationReason',
          'storyScore',
          'storyHook',
          'subjectName',
          'nameStrength',
        ],
        properties: {
          title:                  { type: 'string', description: 'Trend title in English' },
          viralityScore:          { type: 'integer', minimum: 0, maximum: 100 },
          memePotential:          { type: 'integer', minimum: 0, maximum: 100 },
          category: {
            type: 'string',
            enum: ['meme', 'celebrity', 'animals', 'tech', 'gambling',
                   'sports', 'politics', 'entertainment', 'gaming',
                   'boring', 'other'],
          },
          // Signal shape — orthogonal to category. event = concrete trigger,
          // trend = cross-platform narrative, post = single viral post.
          // Strict-schema providers (OpenAI) enforce the enum on the model
          // side; for non-strict providers (xAI/Grok) the scorer normalises
          // the value and falls back to a deterministic rule (whyNow → event,
          // platforms ≥ 2 → trend, else post).
          alertType: {
            type: 'string',
            enum: ['event', 'trend', 'post'],
          },
          sentiment: {
            type: 'string',
            enum: ['positive', 'negative', 'neutral', 'mixed'],
          },
          // Hard cap at 220 chars — strict json_schema enforces this on the
          // model side, so we don't need a defensive trim downstream. 220
          // (not 200) gives a small buffer for output tokenizer rounding.
          // Originally "1-2 sentences" → models returned 300-500 chars,
          // ballooning Stage 1 output cost AND polluting Stage 2's input.
          explanation:            { type: 'string', maxLength: 220, description: 'ONE short sentence (≤200 chars) explaining memecoin potential — terse, no filler' },
          // Hard cap at 280 chars (matches the prompt rule of 1-2 sentences,
          // plus a small buffer for output tokenizer rounding). Strict json_schema
          // enforces this on the model side. Originally "one short sentence"
          // → models returned 60-90 chars of bare facts; widened to 280 so
          // whyNow can carry WHO+WHAT+timing in two readable lines.
          whyNow:                 { type: 'string', maxLength: 280, description: '1-2 sentences (≤280 chars) naming the concrete trigger event (who/what/timing), or empty string' },
          predictedLifespan: {
            type: 'string',
            // Schema enum derived from LIFESPAN_VALUES so renaming breaks
            // here too — no hardcoded duplicate list.
            enum: [...LIFESPAN_VALUES, 'unknown'],
          },
          isGenuinelyInteresting: { type: 'boolean' },
          // `scoreOverride` lived here from 2026-05-10 to 2026-08-05, while
          // Stage 0b was the authoritative scorer and this was Stage 1's only
          // way to disagree. Stage 1 owns the score outright now, so there is
          // nothing left to override.
          needsDeeperLook: { type: 'boolean' },
          escalationReason: { type: 'string', maxLength: 200, description: 'If needsDeeperLook is true, one short reason; else empty string' },
          // Narrative scoring — moved from Stage 2 on 2026-08-04. Both feed
          // additive-only bonuses in the scorer post-pass; neither can lower
          // a score. Lean on the Stage 0b signals already in the input
          // (hasNarrative / hasSubject / subjectNames / tickerSuggestion).
          storyScore:   { type: 'integer', minimum: 0, maximum: 100 },
          storyHook:    { type: 'string', maxLength: 80, description: 'character+conflict+stakes in ≤80 chars; empty string when storyScore < 60; ENGLISH' },
          subjectName:  { type: 'string', maxLength: 64, description: 'Tickerable proper noun, or empty string when there is none' },
          nameStrength: { type: 'integer', minimum: 0, maximum: 100 },
        },
      },
    },
  },
};

// ─── Stage 2: X Search deep-dive prompt ──────────────────────────────────────

// Compressed 2026-04-27 to cut Stage 2 input cost. Removed inline examples
// (Punch monkey / Moo Deng / Hawk Tuah) — Grok knows these. Removed dead
// `adjustment` field (was only consumed by market-stage.js which is itself
// feature-flagged off and now reads nothing). Removed `xSentiment` field —
// never consumed downstream. Result: ~750 → ~330 tokens of system prompt.
export const STAGE2_SYSTEM_PROMPT = `You are DEGEN-PARSER verifying a trend against live X discussion. Search X, judge, adjust. Do NOT evaluate coins/tickers — focus on the narrative itself.

Adjustments to memePotential:
• Massive organic buzz, many independent accounts, memes forming → +10..+25
• Clear momentum growing → +5..+15
• Stale / peaked / nobody still talks about it → -15..-30
• Backlash killing meme energy → -15..-25
• Bot / spam / single-account amplification → -20..-40
• No real X discussion found → -5..-15

Respond with ONLY valid JSON. No markdown, no preamble.`;

// Defensive cap on `aiExplanation` length when re-injected into Stage 2.
// Stage 1's json_schema now enforces maxLength=220 on `explanation`, so
// fresh outputs already arrive bounded. This cap stays as a safety net for:
//   - Older DB rows from before the schema cap (re-scoring path)
//   - Admin manual-submit flow that bypasses Stage 1's schema
//   - Any future provider that silently ignores maxLength
// Costs nothing — the cap is a no-op in the normal happy path.
const STAGE2_EXPLANATION_CAP = 220;

export function buildStage2Prompt(trend) {
  let detail = `Trend: "${trend.originalTitle || trend.title}"`;
  detail += `\nSource: ${trend.source}`;
  if (trend.aiExplanation) {
    const exp = String(trend.aiExplanation);
    detail += `\nInitial analysis: ${
      exp.length > STAGE2_EXPLANATION_CAP ? exp.slice(0, STAGE2_EXPLANATION_CAP) + '…' : exp
    }`;
  }
  detail += `\nInitial scores: meme=${trend.memePotential}, viral=${trend.score}, cat=${trend.category}`;
  return `Verify this trend on X and adjust scores.

${detail}

Return JSON ONLY (no markdown):
{
  "memePotential":      0-100,
  "viralityScore":      0-100,
  "xBuzz":              "none|low|medium|high|explosive",
  "narrativeMomentum":  "fading|flat|building|exploding",
  "organicity":         "organic|mixed|astroturf"
}`;
}

// ─── Catalyst forecast (on-demand, forward-looking) ──────────────────────────
//
// Run on user click only — NOT in the automatic scoring pipeline. Uses Grok
// reasoning (grok-4-1-fast-reasoning) + x_search to FORECAST what will drive
// further growth of the narrative. Forward-looking, NOT a recap of what made
// it viral so far (the in-pipeline `whyNow` field already covers the past).
//
// Result is cached in DB and shared across all users (first click pays for
// Grok, the rest read from DB).
//
// Reasoning mode is justified because we want Grok to:
//   1. read live X discussion to gauge current curve phase
//   2. surface scheduled / upcoming catalysts (premieres, releases, deadlines, anniversaries)
//   3. identify untapped angles that could spread the narrative further
//   4. flag risks that could kill momentum before more growth happens

export const TRIGGER_SYSTEM_PROMPT = `You are a narrative-growth forecaster. Given a trending topic, your job is to predict WHAT WILL DRIVE FURTHER GROWTH of this narrative — not to recap what made it viral so far. Forward-looking only.

Your tools:
- x_search: read live X discussion (last 24-48 hours) to gauge current curve phase, mention velocity, account-mix, and any scheduled events being referenced
- reasoning: combine signals to estimate where the story is on its growth curve and what catalysts could push it further

━━━ WHAT TO LOOK FOR ━━━
Forward-looking growth catalysts only. Examples:
- Scheduled events on the horizon: premieres, releases, drops, deadlines, court hearings, sports matches, debates, anniversaries, product reveals, sequels, concert tours, awards shows
- Untapped surfaces / angles: narrative not yet on TikTok, no major media coverage yet, no celebrity has weighed in, no remix-format formed yet, only one platform involved so far, no shareable visual yet
- Curve dynamics: mention velocity still rising, fresh accounts joining (not the same amplifier loop), spinoff formats / parodies starting to appear, regional / language spread beginning
- External pressure points: upcoming public statements, follow-up posts the originator implied, expected reactions from people named in the story

━━━ WHAT NEVER TO MENTION ━━━
ZERO references to crypto / coins / tokens / tickers / launches in the financial sense / pump.fun / DEX / contract addresses / "this will moon" / market caps. We forecast NARRATIVE popularity only, not asset prices. If a coin already exists for this narrative, do NOT mention it.

━━━ CURVE PHASE (pick exactly one) ━━━
- "early"     — narrative just forming, low overall mention volume but rising, plenty of headroom
- "building"  — clear upward velocity, multiple accounts contributing, format is replicating
- "peaking"   — at or near the local high, still strong but new-account rate has flattened
- "saturated" — high volume but no new angles, mostly recycled posts, audience nearly tapped
- "fading"    — mention rate declining, conversation moving on, growth window closing

━━━ WINDOW (pick a short phrase) ━━━
A short, factual time horizon for the next growth wave. Examples: "next 24-48h", "next 1-2 weeks", "after [named event] on [date]", "depends on whether [person] responds", "uncertain — needs external trigger". Empty string if no horizon is supportable.

━━━ DRIVERS (1-3 short bullets) ━━━
Each bullet = ONE concrete forward catalyst, ≤80 chars, plain English, no hedge filler. Drop a bullet rather than pad it. If you can name a date / person / event, do it. Examples:
- "Sequel premiere on Nov 14 — fanbase priming for fresh memes"
- "Hasn't reached TikTok yet — visual hook will replicate fast"
- "Originator hinted at a follow-up post"

━━━ RISKS (0-2 short bullets) ━━━
Things that could kill growth before the window closes. Each ≤80 chars. Skip if nothing sharp comes up. Examples:
- "Backlash forming — three large accounts pushing back"
- "Format already overdone — saturation likely within 24h"

━━━ FORECAST TEXT (2-3 sentences) ━━━
Plain English. State current phase + the single biggest forward catalyst + the realistic upside window. No filler. No degen pitch. No price talk. Names, dates, numbers ONLY if x_search confirms them — never invent.

━━━ NO-SIGNAL CASE ━━━
If x_search returned nothing concrete or you see no realistic forward driver, set confidence < 40, phase to your best guess (often "saturated" or "fading"), drivers to [] or one cautious item, and write a forecast that honestly says no clear catalyst ahead. Do NOT manufacture a forecast.

Always respond with ONLY valid JSON. No markdown, no preamble.`;

export function buildTriggerPrompt(trend) {
  let detail = `Trend: "${trend.original_title || trend.originalTitle || trend.title || ''}"`;
  detail += `\nSource: ${trend.source || 'unknown'}`;
  if (trend.aiExplanation || trend.ai_explanation) {
    detail += `\nInitial pipeline analysis: ${trend.aiExplanation || trend.ai_explanation}`;
  }
  // Past-trigger anchor for context only — DO NOT recap this in the forecast.
  if (trend.why_now || trend.whyNow) {
    detail += `\nPast trigger (context only, don't recap): ${trend.why_now || trend.whyNow}`;
  }

  // Pull subject name from xSearchData if available — gives Grok a high-signal
  // anchor to search for instead of parsing it from the title.
  let subjectName = null;
  try {
    const rm = trend.raw_metrics ? JSON.parse(trend.raw_metrics) : (trend.metrics || {});
    subjectName = rm?.xSearchData?.subjectName || null;
  } catch { /* corrupt JSON, ignore */ }
  if (subjectName) detail += `\nKnown subject: ${subjectName}`;

  return `Forecast what will drive further growth of this narrative using x_search + reasoning.

${detail}

Use x_search to read live X discussion (last 24-48h) — gauge how busy the conversation is, who's still arriving, and whether any specific upcoming events are being referenced. Then forecast the NEXT growth wave (forward-looking only — do NOT recap the past trigger).

Reminder: ZERO references to crypto / coins / tokens / tickers / pumps / market caps. Narrative popularity only.

Return ONLY this JSON shape:
{
  "forecast":   "<2-3 sentences: phase + biggest forward catalyst + window, in English>",
  "phase":      "early" | "building" | "peaking" | "saturated" | "fading",
  "window":     "<short phrase, e.g. 'next 24-48h' or 'after premiere on Nov 14', or '' if uncertain>",
  "drivers":    ["<≤80 char concrete forward catalyst>", ...]   // 1-3 bullets, can be []
  "risks":      ["<≤80 char growth-killer>", ...]               // 0-2 bullets, can be []
  "confidence": <0-100 integer — how certain you are about the forecast>,
  "sources":    ["@handle1", "@handle2", ...]                   // up to 5 X accounts referenced
}`;
}
