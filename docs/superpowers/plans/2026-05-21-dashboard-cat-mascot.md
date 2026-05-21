# Catalyst Cat Mascot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 2D rigged SVG cat mascot to Catalyst dashboard and login screen — lives along the bottom edge, idles continuously, walks through the screen on a random schedule, and reacts to Forecast Catalyst loading + 60-second user inactivity.

**Architecture:** Single React component (`<CatMascot />`) mounted at App top level inside `src/dashboard/server.js`. Two inline SVG assets (sitting + standing) decomposed into named `<g>` groups. JS state machine drives high-level transitions; CSS keyframes drive idle animations. Visibility gated by route + localStorage + width.

**Tech Stack:** Inline React (no bundler) inside `src/dashboard/server.js` template literal. CSS keyframes + composite-only transforms. Native DOM listeners (mousemove, scroll, keydown, etc) with `passive: true` where applicable. `localStorage` for toggle persistence.

**Spec reference:** `docs/superpowers/specs/2026-05-21-dashboard-cat-mascot-design.md`

---

## Project-specific verification

This project has **no unit tests** for the dashboard SPA — the inline template literal in `src/dashboard/server.js` can't be unit-tested in isolation. Verification at each step is **two-stage**:

1. **SPA syntax check** (automated, after every edit to `server.js`):
   ```
   node scripts/check-dashboard-spa.cjs
   ```
   Expected output ends with `OK` and a character count. If it errors or reports unbalanced template literal, the previous edit broke the SPA — revert and retry.

2. **Visual smoke** (operator's job after deploy via `deploy.ps1`). Each task lists what the operator should look for in browser.

**No commits without operator's explicit instruction** (per project CLAUDE.md). Plan includes suggested commit messages at task end; controller pauses for operator confirmation before running `git commit`.

**Deploy is operator-managed.** Implementation agents stop after the SPA check and visual smoke notes; never run `deploy.ps1`.

---

## File structure

This entire feature lives inside one file: **`src/dashboard/server.js`** (inline React SPA template literal). No new files created. Logical sections inside the file:

| Section | Approximate location | What goes here |
|---|---|---|
| `:root` theme tokens block | ~line 2600 | (untouched — uses existing tokens) |
| CSS rules block | ~line 3720+ | New `.cat-mascot` styles, keyframes, state classes |
| i18n EN block | ~line 6950+ | 2 new keys (`cat.toggle_on`, `cat.toggle_off`) |
| i18n RU block | ~line 7380+ | Same 2 keys translated |
| `icon()` / `ICONS` infrastructure | ~line 8200+ | (untouched — uses existing) |
| Header component | (find by Grep) | Triple-click handler added to logo wrapper |
| `App` component / route routing | (find by Grep) | `<CatMascot />` mount + visibility gate |
| New `CatMascot` component | At end of components block | Full component with SVGs, state machine, timers |

Implementation agents use Grep/Read to locate exact line numbers before editing — line numbers drift between tasks as the file grows.

---

## Pre-task (Operator): Vectorize the Grok cat images

**Owner:** skipnick

Before any implementation task can begin, the operator must convert the two source PNG/JPG images from Grok into clean SVG files.

- [ ] **Step 1: Upload sitting cat image to vectorizer**

Go to https://vectorizer.ai (free tier handles 2-3 images per session). Upload the sitting cat image (the original Grok output where the cat sits in side profile, facing right).

- [ ] **Step 2: Configure vectorizer settings**

In the right-side panel:
- **Palette**: 2 colors (black background + white outline)
- **Curve fit**: "Best" or "Smooth"
- **Cleanup**: enable "Despeckle"
- **Output format**: SVG

Click "Process".

- [ ] **Step 3: Download cleaned SVG (sitting)**

Click "Download SVG". Save as `cat-sitting.svg` in any temporary folder. Pass the file path to the next implementation agent OR paste the file contents directly into the chat when prompted.

- [ ] **Step 4: Repeat for standing cat image**

Same procedure with the standing pose image. Save as `cat-standing.svg`.

- [ ] **Step 5: Quick sanity check (in browser)**

Open both SVG files directly in a browser. They should display the cat as recognizable white-on-black silhouettes. If they look broken (random lines, missing tail/legs), re-run vectorization with different settings or re-generate the Grok image with the spec prompts (see brainstorm transcript).

- [ ] **Step 6: Report ready**

Once both SVG files render correctly in browser, post their paths or contents in the chat so Task 3 can proceed. **Tasks 1, 2 can start in parallel without SVG ready** — they don't reference the rigged SVGs.

---

## Task 1: CSS foundation + empty CatMascot component + App mount

**Files:**
- Modify: `src/dashboard/server.js` — add CSS rules block + empty component + mount in App.

**Goal:** Get a visible `<CatMascot />` rendering on dashboard with a placeholder colored rectangle (no real SVG yet). Visibility gate works: 3 conditions evaluated, component renders `null` if any fails. Drop-shadow and z-index correct. After this task, a "cat" (red 80×80px rectangle placeholder) appears at bottom-left of viewport on desktop dashboard, doesn't appear on narrow viewport, doesn't appear if `localStorage.catMascotOff` is `'true'`.

- [ ] **Step 1: Locate CSS rules section**

Use Grep to find where the R5 sort-chip styles end:
```
Grep pattern: "\.sort-chip:focus-visible" in src/dashboard/server.js, output_mode: content, -n: true
```
Note the line number. The new CSS block goes immediately after this rule's closing brace.

- [ ] **Step 2: Add CSS rules**

Edit `src/dashboard/server.js`, immediately after the `.sort-chip:focus-visible` closing brace, insert:

```css
/* ===== Cat Mascot (R6) ===== */
.cat-mascot {
  position: fixed;
  bottom: 0;
  left: 80px;
  width: 96px;
  height: 96px;
  z-index: 500;
  pointer-events: none;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5));
  transition: opacity 0.2s ease;
  /* Placeholder visual until SVG is dropped in Task 3 */
  background: rgba(255, 64, 64, 0.4);
  border: 1px solid #ff4040;
}
.cat-mascot[data-hidden="true"] {
  opacity: 0;
  pointer-events: none;
}
```

**Why placeholder background**: visual landing pad for Task 1 verification. The placeholder is removed in Task 3 when real SVG arrives.

- [ ] **Step 3: SPA check after CSS edit**

Run:
```
node scripts/check-dashboard-spa.cjs
```
Expected: ends with `OK` and a character count slightly higher than before.

- [ ] **Step 4: Locate App component**

Use Grep:
```
Grep pattern: "function App\\(" or "const App = " in src/dashboard/server.js, output_mode: content, -n: true
```
Note the line number where the App function body starts.

- [ ] **Step 5: Add empty CatMascot component before App**

Edit `src/dashboard/server.js`, just before the `function App` line, insert this component:

```js
function CatMascot(props) {
  // ALL hooks called unconditionally at the top (Rules of Hooks).
  // Visibility gate is a single combined check AFTER hooks, before render.
  const [isOff, setIsOff] = useState(function() {
    return localStorage.getItem('catMascotOff') === 'true';
  });

  const [isWide, setIsWide] = useState(function() {
    return window.innerWidth >= 700;
  });

  useEffect(function() {
    const mq = window.matchMedia('(min-width: 700px)');
    function handler(e) { setIsWide(e.matches); }
    mq.addEventListener('change', handler);
    return function() { mq.removeEventListener('change', handler); };
  }, []);

  // Listen to triple-click toggle event from Header (dispatched in Task 2)
  useEffect(function() {
    function onToggle() {
      setIsOff(localStorage.getItem('catMascotOff') === 'true');
    }
    window.addEventListener('catalyst:cat-toggle', onToggle);
    return function() {
      window.removeEventListener('catalyst:cat-toggle', onToggle);
    };
  }, []);

  // Visibility gate — 3 conditions combined. All hooks already called above,
  // so this early return is safe (no hooks below it).
  const route = props.route || 'dashboard';
  const isLoginOrDashboard = route === 'login' || route === 'dashboard';
  if (!isLoginOrDashboard || isOff || !isWide) return null;

  return h('div', { className: 'cat-mascot', 'data-state': 'idleSitting' });
}
```

**Note on event bus**: Task 1 sets up the listener; Task 2 adds the dispatcher. This decouples Header from CatMascot — Header doesn't need to know CatMascot's internals.

- [ ] **Step 6: SPA check after component edit**

Run:
```
node scripts/check-dashboard-spa.cjs
```
Expected: ends with `OK`.

- [ ] **Step 7: Mount CatMascot in App**

Find inside `function App()` body where the main return is. Most likely it's a top-level `h('div', ...)` wrapper. Add `<CatMascot route={currentRoute} />` as the LAST child of the top-level wrapper (so it's painted on top of all UI).

If `currentRoute` is named differently in App (e.g. `screen`, `view`, `page`), pass that variable. If route detection isn't already in App, hardcode `route="dashboard"` for now — Task 6 (or later) refines this when LoginScreen route is wired through.

Example insertion (line numbers will differ):
```js
// Inside App's return, at the very end of the wrapper:
//   ...existing children...
h(CatMascot, { route: 'dashboard' })
```

- [ ] **Step 8: SPA check after mount**

```
node scripts/check-dashboard-spa.cjs
```
Expected: ends with `OK`.

- [ ] **Step 9: Operator visual smoke**

Operator deploys via `deploy.ps1` and verifies in browser:
1. Open dashboard at desktop width (≥700px) → red placeholder rectangle visible at bottom-left
2. Open DevTools → Console: run `localStorage.setItem('catMascotOff', 'true')` → reload → no red rectangle
3. Run `localStorage.removeItem('catMascotOff')` → reload → red rectangle returns
4. Resize browser window down to <700px → rectangle disappears immediately (no reload needed)
5. Resize back to >=700px → rectangle reappears

If all 5 pass → Task 1 done. Otherwise, share screenshot + console errors with implementation agent.

- [ ] **Step 10: Suggest commit (operator's call)**

Suggested message (operator decides whether to commit now or batch):
```
feat(dashboard): r6 task 1 — cat mascot foundation (placeholder, visibility gate)
```

Wait for operator confirmation before running `git commit`.

---

## Task 2: Triple-click toggle on logo + i18n keys

**Files:**
- Modify: `src/dashboard/server.js` — add Header logo handler + dispatch event + i18n keys.

**Goal:** Triple-clicking the Catalyst logo within 1.5 seconds toggles `localStorage.catMascotOff` and shows a toast. CatMascot listener (from Task 1) reacts and unmounts/mounts. After this task, triple-click flips the cat between "visible red placeholder" and "no rectangle", with a toast confirming the state.

- [ ] **Step 1: Add i18n keys (EN)**

Use Grep to find an existing `sort.` key in EN block as anchor:
```
Grep pattern: "'sort.rank':" in src/dashboard/server.js, output_mode: content, -n: true
```
Note the line number (EN block contains it). Read 30 lines around it to find the closing brace of the EN i18n block.

Edit immediately before the EN block's closing brace, insert:
```js
'cat.toggle_on':  'Cat mascot enabled',
'cat.toggle_off': 'Cat mascot disabled',
```

- [ ] **Step 2: Add i18n keys (RU)**

Same procedure with RU block — Grep for `'sort.rank':` in RU section (will be a separate occurrence further down). Add just before the RU block's closing brace:
```js
'cat.toggle_on':  'Кот-маскот включён',
'cat.toggle_off': 'Кот-маскот выключен',
```

- [ ] **Step 3: SPA check after i18n**

```
node scripts/check-dashboard-spa.cjs
```
Expected: ends with `OK`.

- [ ] **Step 4: Locate Header component logo wrapper**

Use Grep to find where the Catalyst logo monogram is rendered in Header:
```
Grep pattern: "monogram|brand.*logo|Catalyst" in src/dashboard/server.js, output_mode: content, -n: true
```
Look for the JSX block that renders the small cat-head SVG + the word "Catalyst" together (this is the logo wrapper). Read 20 lines around it to understand the current structure.

The wrapper is typically a `h('div', { className: 'brand' or 'logo' }, ...)` or similar.

- [ ] **Step 5: Wrap or augment the logo with onClick handler**

Inside the logo wrapper's props, add the onClick handler. If the wrapper already has props (className, etc), merge:

```js
// Above the Header component body, declare a click buffer ref:
const catLogoClicksRef = useRef([]);

// Inside the Header component, define handler:
function handleLogoClick() {
  const now = Date.now();
  const WINDOW_MS = 1500;
  // Keep only recent clicks
  catLogoClicksRef.current = catLogoClicksRef.current.filter(function(t) {
    return now - t < WINDOW_MS;
  });
  catLogoClicksRef.current.push(now);

  if (catLogoClicksRef.current.length >= 3) {
    catLogoClicksRef.current = [];  // reset buffer
    const wasOff = localStorage.getItem('catMascotOff') === 'true';
    if (wasOff) {
      localStorage.removeItem('catMascotOff');
      addToast(t('cat.toggle_on'), 'success');
    } else {
      localStorage.setItem('catMascotOff', 'true');
      addToast(t('cat.toggle_off'), 'info');
    }
    // Notify CatMascot to re-evaluate
    window.dispatchEvent(new CustomEvent('catalyst:cat-toggle'));
  }
}
```

Then attach `onClick: handleLogoClick` to the logo wrapper's props.

**Note on `useRef` and `addToast`**: both already exist in this file (used by R1 toast system and various components). Verify by Grep before adding — if `useRef` is destructured at top of file, reuse the existing destructure; if not, add it.

**Note on `t`**: i18n translation function, already in scope inside components (Catalyst uses i18n hook). Verify by Grep for `t('sort.rank')` to see how it's called elsewhere.

- [ ] **Step 6: SPA check**

```
node scripts/check-dashboard-spa.cjs
```
Expected: ends with `OK`.

- [ ] **Step 7: Operator visual smoke**

After deploy:
1. Triple-click on the Catalyst logo in header (3 clicks within 1.5s)
2. Toast appears: "Cat mascot disabled" (RU: "Кот-маскот выключен")
3. Red placeholder rectangle disappears immediately
4. Triple-click again → toast "Cat mascot enabled" → placeholder returns
5. Single-click on logo → nothing happens
6. Reload page → state persists (cat is in whatever state was last toggled)

If all 6 pass → Task 2 done.

- [ ] **Step 8: Suggest commit (operator's call)**

```
feat(dashboard): r6 task 2 — triple-click logo toggle + i18n keys
```

---

## Task 3: Insert rigged SVG assets

**Files:**
- Modify: `src/dashboard/server.js` — replace CatMascot placeholder with real SVG.

**Goal:** Replace the red rectangle placeholder with the actual sitting-cat SVG (rigged into named `<g>` groups). Visual result: cat sits at bottom-left, static, white outline on the dark dashboard. No animations yet — just the asset in place.

**Prerequisites:** Pre-task complete — operator has both `cat-sitting.svg` and `cat-standing.svg` vectorized and ready.

- [ ] **Step 1: Get the source SVGs**

Ask the operator to either paste both SVG file contents into chat OR provide local file paths. Implementation agent reads the files.

- [ ] **Step 2: Dispatch SVG-splitting subagent**

This step is delegated to a haiku-model subagent because it's mechanical path-analysis work:

```
Agent({
  model: "haiku",
  description: "Split cat SVG into rigged groups",
  prompt: "I'm giving you two SVG files: cat-sitting.svg and cat-standing.svg. Both are line-art outline cats (white on black) — sitting cat in side profile facing right, standing cat in side profile facing right with 4 paws on ground.

For each SVG:
1. Identify all paths and trace which body part each belongs to (head, ear-left, ear-right, eye, body, tail-base, tail-tip, front-legs, back-legs).
2. Group paths into <g> elements with these IDs (prefix 'cs-' for sitting, 'cstanding-' for standing):
   - cs-body / cstanding-body (the main silhouette path or paths)
   - cs-head / cstanding-head (head outline)
   - cs-ear-left, cs-ear-right (ear paths — may be inside head silhouette)
   - cs-eye / cstanding-eye (single eye path)
   - cs-tail-base / cstanding-tail-base (proximal section of tail)
   - cs-tail-tip / cstanding-tail-tip (distal ~20% of tail — this is the only part that animates in tail wag)
   - cs-front-legs / cstanding-front-legs
   - cs-back-legs / cstanding-back-legs (may overlap with front in standing pose — best-effort separation)
3. Strip any decorative artifacts not part of cat anatomy (light gradients on right edge, hovering 'shadow' line under cat). Keep only outline + eye.
4. Add transform-origin hints as comments to each group based on natural pivot points:
   - tail-tip: rotates around its connection point to tail-base
   - ear-*: rotates around its base where it joins the head
   - eye: scales around its own center
   - head: rotates around the neck (where head joins body)
   - body: scales around its bottom edge (transform-origin: 50% 100%)
5. Output two clean SVG strings ready to paste inline. Keep viewBox normalized (e.g. 0 0 100 100 for both).
6. Report any paths you couldn't confidently classify — list them with their `d` attribute first 60 chars so the human can decide.

Source SVG file contents:
SITTING: [paste here]
STANDING: [paste here]
"
})
```

The subagent returns two normalized SVG strings.

- [ ] **Step 3: Replace placeholder in CatMascot component**

Find the CatMascot component (added in Task 1). Replace its return statement and remove the placeholder background CSS.

Update CSS (find the `.cat-mascot` rule from Task 1, remove placeholder lines):
```css
.cat-mascot {
  position: fixed;
  bottom: 0;
  left: 80px;
  width: 96px;
  height: 96px;
  z-index: 500;
  pointer-events: none;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5));
  transition: opacity 0.2s ease;
  /* placeholder background and border REMOVED */
}
.cat-mascot svg {
  width: 100%;
  height: 100%;
  display: block;
}
.cat-mascot .cat-svg-standing {
  display: none;
}
.cat-mascot[data-pose="standing"] .cat-svg-sitting {
  display: none;
}
.cat-mascot[data-pose="standing"] .cat-svg-standing {
  display: block;
}
```

Update CatMascot component return:
```js
return h('div', {
  className: 'cat-mascot',
  'data-state': 'idle-sitting',
  'data-pose': 'sitting'
},
  // Sitting SVG (inline, from subagent output)
  h('svg', {
    className: 'cat-svg-sitting',
    viewBox: '0 0 100 100',  // adjust if subagent uses different viewBox
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    style: { color: '#ffffff' },
    dangerouslySetInnerHTML: { __html: '[PASTE SITTING SVG INNER CONTENTS HERE — everything inside <svg>...</svg>]' }
  }),
  h('svg', {
    className: 'cat-svg-standing',
    viewBox: '0 0 100 100',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    style: { color: '#ffffff' },
    dangerouslySetInnerHTML: { __html: '[PASTE STANDING SVG INNER CONTENTS HERE]' }
  })
);
```

**Why `dangerouslySetInnerHTML`**: Inline React without JSX compiler can't take SVG markup as JSX. We render raw SVG markup as innerHTML on the wrapper `<svg>` element. The `<g>` group structure is preserved inside.

**Alternative**: convert SVG to nested `h('g', {...})` calls. More verbose but uses no innerHTML. Pick based on subagent output cleanliness. If SVG has <50 paths, prefer h() form.

- [ ] **Step 4: SPA check**

```
node scripts/check-dashboard-spa.cjs
```
Expected: ends with `OK`. Character count will jump significantly (~10-20kB) due to SVG content.

- [ ] **Step 5: Operator visual smoke**

After deploy:
1. Dashboard at desktop width → cat (white outline on dark) sits at bottom-left
2. Cat is fully visible (no clipping at viewport edge)
3. Cat doesn't move yet (no animations) — that's expected
4. Triple-click logo → cat disappears → triple-click again → cat returns
5. Inspect element on cat → check that `<g id="cs-head">`, `<g id="cs-tail-tip">` etc are present (these are needed for animations in later tasks)

If cat looks broken or has misaligned parts → re-vectorize OR re-run subagent with feedback on which paths went into which group.

- [ ] **Step 6: Suggest commit**

```
feat(dashboard): r6 task 3 — rigged cat SVG assets (sitting + standing)
```

---

## Task 4: Idle behaviors (R1) — breath + blink + tail wag + ear twitch

**Files:**
- Modify: `src/dashboard/server.js` — add 4 idle animation timers + corresponding CSS keyframes.

**Goal:** Cat sits at home and exhibits 4 continuous idle behaviors:
- Breath: smooth slow scale on body (3.5s cycle, CSS-only)
- Blink: eye scaleY pulse (random 4-8s interval)
- Tail wag: tail-tip rotation (random 8-15s interval)
- Ear twitch: alternating ear rotation (random 5-12s interval)

After this task, the cat looks visibly "alive" while just sitting there.

- [ ] **Step 1: Add CSS keyframes**

Find the `.cat-mascot` CSS block (added in Task 1, refined in Task 3). Insert keyframes immediately after the existing cat rules:

```css
/* Breath: continuous, CSS-only */
@keyframes catBreath {
  0%, 100% { transform: scale(1.0); }
  50%      { transform: scale(0.99); }
}
.cat-mascot #cs-body,
.cat-mascot #cstanding-body {
  transform-origin: 50% 100%;
  animation: catBreath 3500ms ease-in-out infinite;
}

/* Blink: triggered by JS adding/removing class */
@keyframes catBlink {
  0%, 100% { transform: scaleY(1); }
  50%      { transform: scaleY(0.1); }
}
.cat-mascot #cs-eye.blinking,
.cat-mascot #cstanding-eye.blinking {
  transform-origin: 50% 50%;
  animation: catBlink 280ms ease-in-out;
}

/* Tail wag: triggered by JS adding/removing class */
@keyframes catTailWag {
  0%   { transform: rotate(0deg); }
  30%  { transform: rotate(-5deg); }
  60%  { transform: rotate(3deg); }
  100% { transform: rotate(0deg); }
}
.cat-mascot #cs-tail-tip.wagging,
.cat-mascot #cstanding-tail-tip.wagging {
  /* transform-origin set inline in SVG per group */
  animation: catTailWag 800ms ease-in-out;
}

/* Ear twitch: triggered by JS adding/removing class */
@keyframes catEarTwitch {
  0%, 100% { transform: rotate(0deg); }
  50%      { transform: rotate(-10deg); }
}
.cat-mascot #cs-ear-left.twitching,
.cat-mascot #cs-ear-right.twitching {
  animation: catEarTwitch 150ms ease-in-out;
}
```

- [ ] **Step 2: SPA check after CSS**

```
node scripts/check-dashboard-spa.cjs
```
Expected: `OK`.

- [ ] **Step 3: Add timings constants to CatMascot component**

Inside the CatMascot component, at the top of the function body (before useState calls), add:

```js
const CAT_TIMINGS = {
  BLINK_INTERVAL_MIN_MS: 4000,
  BLINK_INTERVAL_MAX_MS: 8000,
  TAIL_WAG_INTERVAL_MIN_MS: 8000,
  TAIL_WAG_INTERVAL_MAX_MS: 15000,
  EAR_TWITCH_INTERVAL_MIN_MS: 5000,
  EAR_TWITCH_INTERVAL_MAX_MS: 12000,
  SLEEP_BEHAVIOR_SLOWDOWN: 3,  // intervals × 3 when sleeping (used in Task 7)
};

function randomInterval(min, max) {
  return min + Math.random() * (max - min);
}
```

- [ ] **Step 4: Add blink timer hook**

Inside CatMascot component, after the visibility-gate useEffects from Task 1, add:

```js
const catRef = useRef(null);
const [stateName, setStateName] = useState('idleSitting');

useEffect(function() {
  let timeoutId;
  let mounted = true;

  function scheduleNextBlink() {
    const interval = randomInterval(
      CAT_TIMINGS.BLINK_INTERVAL_MIN_MS,
      CAT_TIMINGS.BLINK_INTERVAL_MAX_MS
    ) * (stateName === 'idleSleeping' ? CAT_TIMINGS.SLEEP_BEHAVIOR_SLOWDOWN : 1);

    timeoutId = setTimeout(function() {
      if (!mounted) return;
      const root = catRef.current;
      if (!root) { scheduleNextBlink(); return; }
      const eyeIds = ['cs-eye', 'cstanding-eye'];
      eyeIds.forEach(function(id) {
        const el = root.querySelector('#' + id);
        if (el) {
          el.classList.add('blinking');
          setTimeout(function() { el.classList.remove('blinking'); }, 280);
        }
      });
      scheduleNextBlink();
    }, interval);
  }

  scheduleNextBlink();
  return function() {
    mounted = false;
    clearTimeout(timeoutId);
  };
}, [stateName]);
```

- [ ] **Step 5: Add tail wag timer hook**

Immediately after the blink useEffect:

```js
useEffect(function() {
  let timeoutId;
  let mounted = true;

  function scheduleNextWag() {
    const interval = randomInterval(
      CAT_TIMINGS.TAIL_WAG_INTERVAL_MIN_MS,
      CAT_TIMINGS.TAIL_WAG_INTERVAL_MAX_MS
    ) * (stateName === 'idleSleeping' ? CAT_TIMINGS.SLEEP_BEHAVIOR_SLOWDOWN : 1);

    timeoutId = setTimeout(function() {
      if (!mounted) return;
      const root = catRef.current;
      if (!root) { scheduleNextWag(); return; }
      const tipIds = ['cs-tail-tip', 'cstanding-tail-tip'];
      tipIds.forEach(function(id) {
        const el = root.querySelector('#' + id);
        if (el) {
          el.classList.add('wagging');
          setTimeout(function() { el.classList.remove('wagging'); }, 820);
        }
      });
      // 30% chance of double wag
      if (Math.random() < 0.3) {
        setTimeout(function() {
          tipIds.forEach(function(id) {
            const el = root.querySelector('#' + id);
            if (el) {
              el.classList.add('wagging');
              setTimeout(function() { el.classList.remove('wagging'); }, 820);
            }
          });
        }, 1000);
      }
      scheduleNextWag();
    }, interval);
  }

  scheduleNextWag();
  return function() {
    mounted = false;
    clearTimeout(timeoutId);
  };
}, [stateName]);
```

- [ ] **Step 6: Add ear twitch timer hook**

Immediately after the tail wag useEffect:

```js
useEffect(function() {
  let timeoutId;
  let mounted = true;
  let earToggle = 0;  // alternate between ears

  function scheduleNextTwitch() {
    const interval = randomInterval(
      CAT_TIMINGS.EAR_TWITCH_INTERVAL_MIN_MS,
      CAT_TIMINGS.EAR_TWITCH_INTERVAL_MAX_MS
    ) * (stateName === 'idleSleeping' ? CAT_TIMINGS.SLEEP_BEHAVIOR_SLOWDOWN : 1);

    timeoutId = setTimeout(function() {
      if (!mounted) return;
      const root = catRef.current;
      if (!root) { scheduleNextTwitch(); return; }
      const earId = earToggle % 2 === 0 ? 'cs-ear-left' : 'cs-ear-right';
      earToggle++;
      const el = root.querySelector('#' + earId);
      if (el) {
        el.classList.add('twitching');
        setTimeout(function() { el.classList.remove('twitching'); }, 170);
      }
      scheduleNextTwitch();
    }, interval);
  }

  scheduleNextTwitch();
  return function() {
    mounted = false;
    clearTimeout(timeoutId);
  };
}, [stateName]);
```

- [ ] **Step 7: Attach ref to root container**

Update the CatMascot return to attach the ref:

```js
return h('div', {
  ref: catRef,
  className: 'cat-mascot',
  'data-state': stateName,
  'data-pose': 'sitting'
}, /* ...svgs... */ );
```

- [ ] **Step 8: SPA check**

```
node scripts/check-dashboard-spa.cjs
```
Expected: `OK`.

- [ ] **Step 9: Operator visual smoke**

After deploy:
1. Watch the cat for 30 seconds. You should see:
   - Subtle constant breathing motion (body scales 1.0 ↔ 0.99 every 3.5s)
   - Eye blinks roughly every 4-8 seconds (1 blink each)
   - Tail tip wags every 8-15 seconds (1 or 2 quick wags)
   - One ear twitches every 5-12 seconds (alternating left/right)
2. Open DevTools → Performance tab → record 10s of idle. Look for steady 60fps. No long tasks.
3. Open DevTools → Elements → inspect `#cs-eye` while blinking happens — class `.blinking` should appear/disappear.

Common issues:
- "Nothing animates" → SVG group IDs don't match (`cs-eye` vs `cs-eyes`). Re-check IDs.
- "Tail wag origin is wrong" → adjust `transform-origin` on `#cs-tail-tip` inline in SVG.

- [ ] **Step 10: Suggest commit**

```
feat(dashboard): r6 task 4 — idle animations (breath, blink, tail wag, ear twitch)
```

---

## Task 5: State machine + walk-through cycle (R2)

**Files:**
- Modify: `src/dashboard/server.js` — extend CatMascot with state machine and walk-through scheduler.

**Goal:** Implement the full walk-through chain: cat stands up, walks right, fades at right edge, dormant off-screen, fades in at left, walks home, sits down. Scheduled every random 1-3 minutes. Walk perspective scaleX applied during walk states.

- [ ] **Step 1: Extend CAT_TIMINGS**

Find the CAT_TIMINGS object (added in Task 4). Append:

```js
// Add to existing CAT_TIMINGS object:
CROSSFADE_MS: 250,
WALK_THROUGH_INTERVAL_MIN_MS: 60000,
WALK_THROUGH_INTERVAL_MAX_MS: 180000,
WALK_RIGHT_DURATION_MS: 15000,
WALK_HOME_DURATION_MS: 4000,
EDGE_FADE_MS: 200,
DORMANT_MIN_MS: 30000,
DORMANT_MAX_MS: 60000,
HOME_X_PX: 80,
```

- [ ] **Step 2: Add walk-state CSS rules**

In the cat CSS block, append:

```css
.cat-mascot {
  /* existing position properties */
  transform: translateX(0) scaleX(1);
  transition: opacity var(--cat-fade-ms, 200ms) ease,
              transform var(--cat-walk-dur, 0ms) linear;
}
.cat-mascot[data-state="walkingRight"],
.cat-mascot[data-state="walkingHome"] {
  transition: transform var(--cat-walk-dur, 15000ms) linear,
              opacity 200ms ease;
}
.cat-mascot[data-state="disappearing"],
.cat-mascot[data-state="appearing"] {
  opacity: 0;
}
.cat-mascot[data-state="dormant"] {
  opacity: 0;
  visibility: hidden;
}
```

**Why CSS variables for walk dur**: lets JS update durations per-state without touching the CSS rule.

- [ ] **Step 3: Add walk-through scheduler**

Inside CatMascot component, after the ear twitch useEffect, add:

```js
useEffect(function() {
  // Only schedule walks when in idleSitting (not during reactions or sleep)
  if (stateName !== 'idleSitting') return;

  const interval = randomInterval(
    CAT_TIMINGS.WALK_THROUGH_INTERVAL_MIN_MS,
    CAT_TIMINGS.WALK_THROUGH_INTERVAL_MAX_MS
  );
  const timeoutId = setTimeout(function() {
    setStateName('standingUp');
  }, interval);

  return function() { clearTimeout(timeoutId); };
}, [stateName]);
```

- [ ] **Step 4: Add state transition controller**

After the walk-through scheduler, add the state-flow effect (handles each transient state):

```js
useEffect(function() {
  const root = catRef.current;
  if (!root) return;

  let timeoutId;

  function transitionTo(next, delay) {
    timeoutId = setTimeout(function() { setStateName(next); }, delay);
  }

  if (stateName === 'standingUp') {
    root.setAttribute('data-pose', 'standing');
    transitionTo('walkingRight', CAT_TIMINGS.CROSSFADE_MS);
  } else if (stateName === 'walkingRight') {
    // Set walk duration and target
    root.style.setProperty('--cat-walk-dur', CAT_TIMINGS.WALK_RIGHT_DURATION_MS + 'ms');
    // Force reflow to commit current transform before changing
    void root.offsetWidth;
    root.style.transform = 'translateX(' + (window.innerWidth - CAT_TIMINGS.HOME_X_PX + 100) + 'px) scaleX(0.96)';
    transitionTo('disappearing', CAT_TIMINGS.WALK_RIGHT_DURATION_MS);
  } else if (stateName === 'disappearing') {
    transitionTo('dormant', CAT_TIMINGS.EDGE_FADE_MS);
  } else if (stateName === 'dormant') {
    // Teleport off-screen-left while invisible
    root.style.setProperty('--cat-walk-dur', '0ms');
    root.style.transform = 'translateX(' + (-CAT_TIMINGS.HOME_X_PX - 100) + 'px) scaleX(0.96)';
    const dormantMs = randomInterval(CAT_TIMINGS.DORMANT_MIN_MS, CAT_TIMINGS.DORMANT_MAX_MS);
    transitionTo('appearing', dormantMs);
  } else if (stateName === 'appearing') {
    transitionTo('walkingHome', CAT_TIMINGS.EDGE_FADE_MS);
  } else if (stateName === 'walkingHome') {
    root.style.setProperty('--cat-walk-dur', CAT_TIMINGS.WALK_HOME_DURATION_MS + 'ms');
    void root.offsetWidth;
    root.style.transform = 'translateX(0px) scaleX(1)';
    transitionTo('sittingDown', CAT_TIMINGS.WALK_HOME_DURATION_MS);
  } else if (stateName === 'sittingDown') {
    root.setAttribute('data-pose', 'sitting');
    transitionTo('idleSitting', CAT_TIMINGS.CROSSFADE_MS);
  }

  return function() { clearTimeout(timeoutId); };
}, [stateName]);
```

- [ ] **Step 5: SPA check**

```
node scripts/check-dashboard-spa.cjs
```
Expected: `OK`.

- [ ] **Step 6: Operator visual smoke (long)**

After deploy:
1. Wait up to 3 minutes for the first walk-through cycle.
2. Watch: cat stands up (sitting SVG fades to standing SVG, 250ms), walks right (~15s smooth translate), fades at right edge.
3. Cat is gone for 30-60s.
4. Cat fades in at left edge, walks back to home (~4s, faster than out-walk), sits down.

For faster testing (don't wait 3 minutes), temporarily change in source:
```js
WALK_THROUGH_INTERVAL_MIN_MS: 5000,  // was 60000 — REVERT before commit
WALK_THROUGH_INTERVAL_MAX_MS: 10000, // was 180000 — REVERT before commit
```
Then redeploy, walk-through fires every 5-10 seconds. Revert values before final commit.

Common issues:
- "Cat snaps instantly across screen" → `--cat-walk-dur` not applied. Check CSS rule syntax.
- "Walk perspective not visible" → check scaleX(0.96) is in the transform string.
- "Cat doesn't come back" → check the transitionTo chain in step 4 covers every state.

- [ ] **Step 7: Suggest commit**

```
feat(dashboard): r6 task 5 — state machine + walk-through cycle (R2)
```

---

## Task 6: Forecast watching reaction (R3)

**Files:**
- Modify: `src/dashboard/server.js` — locate Forecast loading state, pass to CatMascot, implement reaction state.

**Goal:** When user triggers Forecast Catalyst and `loading` flips to `true`, cat (wherever it is) immediately reacts: cancels current state, stands up, rotates head 12° up, holds while loading. When loading flips back to `false`, head returns, cat sits at current position.

- [ ] **Step 1: Locate Forecast loading state**

Use Grep to find the trigger / forecast loading state in App:
```
Grep pattern: "trigger.btn_loading|forecastLoading|setLoading\\(true\\)|onSearch" in src/dashboard/server.js, output_mode: content, -n: true
```
Identify the loading state variable name (likely `loading` from `const [loading, setLoading] = useState(...)`). Note the line of the `useState` declaration.

- [ ] **Step 2: Pass loading state as prop to CatMascot**

Find the existing `<CatMascot route={...} />` mount (added in Task 1). Update it to pass loading:

```js
h(CatMascot, { route: 'dashboard', forecastLoading: loading })
```

If `loading` is not in App scope but in a nested component, lift it OR use a callback ref to the CatMascot. Simplest fix: lift `loading` to App level if it isn't already.

- [ ] **Step 3: Add forecastLoading effect to CatMascot**

Update CatMascot to receive and react to the prop. Add new useEffect inside CatMascot, after the state-flow controller from Task 5:

```js
useEffect(function() {
  if (props.forecastLoading) {
    setStateName('forecastWatching');
  } else if (stateName === 'forecastWatching') {
    setStateName('idleSitting');
  }
}, [props.forecastLoading]);
```

- [ ] **Step 4: Add forecastWatching state handling**

Extend the state-flow controller useEffect from Task 5 with the new state. Inside the chain of else-if blocks, add:

```js
} else if (stateName === 'forecastWatching') {
  // If currently sitting, stand up first; then rotate head
  if (root.getAttribute('data-pose') !== 'standing') {
    root.setAttribute('data-pose', 'standing');
  }
  // Apply head rotation via CSS class
  root.classList.add('cat-forecast-watching');
  // No further timeout — we stay in this state until forecastLoading drops
} else {
  // For any non-forecast state, ensure the class is removed
  root.classList.remove('cat-forecast-watching');
}
```

Make sure the `classList.remove('cat-forecast-watching')` runs on transition OUT of forecastWatching.

- [ ] **Step 5: Add CSS for forecastWatching head rotation**

In the cat CSS block:
```css
.cat-mascot.cat-forecast-watching #cs-head,
.cat-mascot.cat-forecast-watching #cstanding-head {
  transform: rotate(12deg);
  transition: transform 300ms ease;
}
.cat-mascot #cs-head,
.cat-mascot #cstanding-head {
  transition: transform 300ms ease;
  /* transform-origin should match neck attachment — set inline in SVG group or override here */
  transform-origin: 30% 90%;  /* approximate; adjust during operator smoke if head pivots wrong */
}
```

- [ ] **Step 6: SPA check**

```
node scripts/check-dashboard-spa.cjs
```
Expected: `OK`.

- [ ] **Step 7: Operator visual smoke**

After deploy:
1. Click Forecast Catalyst button.
2. Immediately: cat stands up (if it was sitting) and tilts head up 12°.
3. Cat stays in this pose while spinner runs.
4. When result comes back: head returns to 0°, cat sits down (if it stood up).
5. Trigger Forecast while cat is mid-walk-through: cat immediately switches to forecastWatching from its current X position. After loading completes, cat sits down where it is (does NOT continue walk).

Common issues:
- "Head rotates around wrong point" → adjust transform-origin in CSS to match head SVG anatomy.
- "Cat continues walking during forecast" → the state-flow controller from Task 5 keeps walking transition timers running. Add explicit `clearTimeout` cleanup at the start of the forecastWatching branch.

- [ ] **Step 8: Suggest commit**

```
feat(dashboard): r6 task 6 — forecast watching reaction (R3)
```

---

## Task 7: Inactivity sleep reaction (R6)

**Files:**
- Modify: `src/dashboard/server.js` — add activity detector + idleSleeping state.

**Goal:** After 60 seconds of no user input (mousemove, keydown, click, wheel, touchmove, scroll), cat drops head -20° (sleeping). Any subsequent input wakes the cat. Behavior intervals slow 3x during sleep.

- [ ] **Step 1: Extend CAT_TIMINGS**

Append to the CAT_TIMINGS object:

```js
INACTIVITY_TIMEOUT_MS: 60000,
ACTIVITY_THROTTLE_MS: 1000,
SLEEP_HEAD_ANGLE_DEG: -20,
SLEEP_HEAD_TURN_DURATION_MS: 600,
WAKE_HEAD_TURN_DURATION_MS: 300,
```

- [ ] **Step 2: Add stateNameRef helper (used by listener-based effects)**

Inside CatMascot component, immediately after the existing `const [stateName, setStateName] = useState(...)` line, add:

```js
const stateNameRef = useRef(stateName);
useEffect(function() {
  stateNameRef.current = stateName;
}, [stateName]);
```

This ref always holds the current `stateName` and is safe to read inside event listeners (which would otherwise capture stale closure values).

- [ ] **Step 3: Add activity detector with inactivity timer**

Inside CatMascot component, after the forecastLoading effect from Task 6, add:

```js
useEffect(function() {
  // Don't run activity detector when cat is mounted but Forecast is active
  // (forecast state supersedes sleep)
  if (props.forecastLoading) return;

  let inactivityTimer;
  let lastMouseMove = 0;

  function onActivity(e) {
    if (e && e.type === 'mousemove') {
      const now = Date.now();
      if (now - lastMouseMove < CAT_TIMINGS.ACTIVITY_THROTTLE_MS) return;
      lastMouseMove = now;
    }
    // Read current state via ref (closure-safe)
    if (stateNameRef.current === 'idleSleeping') {
      setStateName('idleSitting');
    }
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(function() {
      if (stateNameRef.current === 'idleSitting') {
        setStateName('idleSleeping');
      }
    }, CAT_TIMINGS.INACTIVITY_TIMEOUT_MS);
  }

  const events = [
    ['mousemove', { passive: true }],
    ['keydown', null],
    ['click', null],
    ['wheel', { passive: true }],
    ['touchmove', { passive: true }],
    ['scroll', { passive: true }],
  ];

  events.forEach(function(pair) {
    document.addEventListener(pair[0], onActivity, pair[1]);
  });

  // Start the initial timer
  inactivityTimer = setTimeout(function() {
    if (stateNameRef.current === 'idleSitting') {
      setStateName('idleSleeping');
    }
  }, CAT_TIMINGS.INACTIVITY_TIMEOUT_MS);

  return function() {
    events.forEach(function(pair) {
      document.removeEventListener(pair[0], onActivity, pair[1]);
    });
    clearTimeout(inactivityTimer);
  };
}, [props.forecastLoading]);
```

Note: `stateName` is NOT in the dep array — we read it via ref. This effect only re-runs when `props.forecastLoading` toggles, which is correct.

- [ ] **Step 4: Add idleSleeping handling to state-flow controller**

In the state-flow useEffect (extended in Tasks 5 and 6), add an `else if` branch:

```js
} else if (stateName === 'idleSleeping') {
  // Drop head down
  root.classList.add('cat-sleeping');
  // Behaviors continue but with 3x slower intervals (the [stateName] dep
  // of blink/wag/twitch effects already covers this — they re-schedule
  // when stateName changes)
} else {
  // Ensure sleep class is removed when transitioning out
  root.classList.remove('cat-sleeping');
}
```

(The existing forecastWatching else-branch becomes nested logic — adjust carefully.)

- [ ] **Step 5: Add CSS for sleeping head**

In the cat CSS block:

```css
.cat-mascot.cat-sleeping #cs-head,
.cat-mascot.cat-sleeping #cstanding-head {
  transform: rotate(-20deg);
  transition: transform 600ms ease;
}
.cat-mascot #cs-head,
.cat-mascot #cstanding-head {
  /* transition already declared in Task 6; ensure 300ms is also good for wake (faster) */
  transition: transform 300ms ease;
}
.cat-mascot.cat-sleeping #cs-head,
.cat-mascot.cat-sleeping #cstanding-head {
  /* sleep is slower (600ms), wake is the default 300ms */
  transition: transform 600ms ease;
}
```

**Note**: the two `transition` declarations on `#cs-head` use different durations for sleep vs wake. CSS-only this is asymmetric — sleep takes 600ms when class is added, wake takes 300ms when class is removed.

- [ ] **Step 6: SPA check**

```
node scripts/check-dashboard-spa.cjs
```
Expected: `OK`.

- [ ] **Step 7: Operator visual smoke**

After deploy:
1. Load dashboard. Don't touch anything for 60 seconds.
2. After 60s: cat's head slowly drops down -20° (600ms). Blink/tail/ear intervals visibly slow (compared to before).
3. Move mouse anywhere on page → cat's head returns to 0° (300ms, faster). Idle intervals restore.
4. Verify idle continues normally afterwards (not stuck).

Common issues:
- "Cat never sleeps" → check that `stateNameRef.current` is being updated by the ref-sync effect.
- "Cat sleeps but doesn't wake" → check that the `if (stateNameRef.current === 'idleSleeping') setStateName('idleSitting')` line runs at the top of `onActivity`.

- [ ] **Step 8: Suggest commit**

```
feat(dashboard): r6 task 7 — inactivity sleep reaction (R6)
```

---

## Task 8: Edge cases — Page Visibility + resize + cleanup

**Files:**
- Modify: `src/dashboard/server.js` — add Page Visibility pause/resume + resize guard.

**Goal:** Handle browser-level edge cases:
- Window minimized/tab hidden → pause all timers, freeze cat state. On visible again → resume.
- Window resize >100px width delta during walk → teleport cat back to home.
- Mobile breakpoint crossed → CatMascot unmounts cleanly (already handled by visibility gate in Task 1, but verify cleanup).

- [ ] **Step 1: Add Page Visibility handler**

Inside CatMascot component, after the activity detector from Task 7, add:

```js
useEffect(function() {
  function onVisibilityChange() {
    if (document.hidden) {
      // Pause all animations by adding a class
      if (catRef.current) catRef.current.classList.add('cat-paused');
    } else {
      // Resume
      if (catRef.current) catRef.current.classList.remove('cat-paused');
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  return function() {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}, []);
```

- [ ] **Step 2: Add CSS for paused state**

In the cat CSS block:

```css
.cat-mascot.cat-paused,
.cat-mascot.cat-paused *,
.cat-mascot.cat-paused *::before,
.cat-mascot.cat-paused *::after {
  animation-play-state: paused !important;
  transition: none !important;
}
```

This pauses all CSS keyframe animations and transitions. JS timers continue (they're cheap — single setTimeout per behavior), but visual movement freezes.

- [ ] **Step 3: Add resize handler**

After the visibility handler, add:

```js
useEffect(function() {
  let lastWidth = window.innerWidth;

  function onResize() {
    const delta = Math.abs(window.innerWidth - lastWidth);
    lastWidth = window.innerWidth;
    if (delta > 100) {
      // Significant resize during walk — teleport home (read state via ref)
      const current = stateNameRef.current;
      if (current === 'walkingRight' || current === 'walkingHome') {
        const root = catRef.current;
        if (root) {
          root.style.setProperty('--cat-walk-dur', '0ms');
          root.style.transform = 'translateX(0px) scaleX(1)';
          setStateName('idleSitting');
        }
      }
    }
  }

  window.addEventListener('resize', onResize, { passive: true });
  return function() {
    window.removeEventListener('resize', onResize);
  };
}, []);
```

- [ ] **Step 4: SPA check**

```
node scripts/check-dashboard-spa.cjs
```
Expected: `OK`.

- [ ] **Step 5: Operator visual smoke**

After deploy:
1. **Visibility test**: switch to another tab for 10 seconds, then come back. Cat should be in the same place (not "skipped ahead"). Animations resume smoothly.
2. **Resize during walk test**: trigger or wait for walk-through. While cat is walking, drag browser window edge to resize by >100px width. Cat should snap back to home position.
3. **Resize narrow → wide test**: shrink to <700px → cat unmounts. Grow back to >700px → cat remounts at home, no errors in console.
4. **Console errors**: open DevTools console during all of the above. No errors related to cat (e.g. "can't read property of null") should appear.

- [ ] **Step 6: Suggest commit**

```
fix(dashboard): r6 task 8 — page visibility + resize edge cases
```

---

## Task 9: WORKLOG entry + final verification

**Files:**
- Modify: `ai-context/WORKLOG.md` — prepend new entry at top.

**Goal:** Document the work in WORKLOG. Run final SPA check. No code changes beyond worklog.

- [ ] **Step 1: Read existing WORKLOG to match format**

```
Read: ai-context/WORKLOG.md (first 50 lines)
```

Note the format of the most recent entry (R5 sort redesign).

- [ ] **Step 2: Prepend new WORKLOG entry**

Edit `ai-context/WORKLOG.md`, insert at the very top (after the header, before the most recent entry):

```markdown
## 2026-05-21 · Claude Sonnet · R6 Cat mascot v1

**Цель**: Декоративный кот-маскот на dashboard и login screen. Tier 2.5 hybrid — живёт сам, реагирует на Forecast Catalyst loading + inactivity, периодически проходит через экран.

**Файлы**:
- `src/dashboard/server.js` — основной (CSS + 2 inline SVG + CatMascot компонент + triple-click handler в Header + i18n keys)
- `ai-context/WORKLOG.md` — эта запись

**Что добавлено**:
- CSS: `.cat-mascot` container, keyframes (breath, blink, tail wag, ear twitch), state-specific styles
- SVG: 2 inline ассета от Grok (sitting + standing), векторизованы через Vectorizer.AI, разрезаны на rigged `<g>` группы
- React: `<CatMascot />` компонент с visibility gate (route + localStorage + width), state machine (idleSitting → walkingRight → ... → idleSitting), 4 idle-behavior timers, walk-through scheduler (1-3 min random), forecast subscriber, inactivity detector (60s)
- Header: triple-click handler на лого-обёртке + custom event 'catalyst:cat-toggle'
- i18n: `cat.toggle_on` / `cat.toggle_off` (EN + RU)

**Реакции (R1-R6)**:
- R1 Idle: дыхание (3.5s CSS), моргание (4-8s random), tail wag (8-15s), ear twitch (5-12s alternating)
- R2 Walk-through: каждые 1-3 мин кот стоит/идёт/исчезает/респавнится/возвращается домой
- R3 Forecast watching: при loading → встаёт, голова 12° вверх. При завершении → возврат
- R6 Inactivity: 60s no input → голова -20° (спит). Any input → просыпается

**Не сделано / отложено в v2**:
- Front view ассет (нужен только для in-frame разворотов; Pacman-respawn избегает)
- R4 Modal hide / R5 Toast / R7 Scroll-to-top / R8 Welcome — не выбраны в v1
- Mouse parallax — declined (легко надоедает)
- Sound effects — нет
- Settings UI toggle — выбран hidden triple-click

**Деплой**: оператор сам через `deploy.ps1`. Не deployed автоматически.

**Риски (контролируются)**:
- SPA-trap: `check-dashboard-spa.cjs` запускался после каждого Edit, все зелёные
- Drop-shadow GPU cost: будет профилировать после deploy, если FPS drops — убрать filter
- Триплклик на лого vs future logo-actions: 1500ms окно изолирует от обычного клика
```

- [ ] **Step 3: SPA check**

```
node scripts/check-dashboard-spa.cjs
```
Expected: `OK`. (WORKLOG edit doesn't affect server.js, but run anyway as final verification.)

- [ ] **Step 4: Final cumulative check**

Open DevTools on dashboard, look at:
1. **Console**: no errors, no warnings related to cat
2. **Network**: server.js loaded, no 404s for cat-related resources (there shouldn't be any — everything is inline)
3. **Performance**: record 30s. CPU usage during idle should be <2%, no long tasks >50ms

- [ ] **Step 5: Suggest final commit (operator's call)**

```
docs(worklog): r6 cat mascot v1 — full implementation summary
```

If operator wants to batch all R6 commits → operator can `git rebase -i HEAD~9` and squash later. But standard pattern is one commit per task.

---

## Self-review checklist (for plan author)

After writing this plan, verify:

**Spec coverage** — every spec section maps to a task:
- Spec §1 Goal → Task 1 (foundation), all subsequent tasks
- Spec §3 Principles → embedded in task choices (sharp, light, mobile-aware, etc)
- Spec §4.0-4.7 Architecture → Tasks 1, 2, 3
- Spec §5.1 Idle behaviors → Task 4
- Spec §5.2 R2 Walk-through → Task 5
- Spec §5.2 R3 Forecast → Task 6
- Spec §5.2 R6 Inactivity → Task 7
- Spec §5.3 3D-feeling tricks → integrated in Task 1 (drop-shadow), Task 4 (breath), Task 5 (walk perspective)
- Spec §6 CAT_TIMINGS → defined incrementally across Tasks 4, 5, 7
- Spec §7 Edge cases → Task 8
- Spec §8 Risks → SPA check addresses #6, visual smoke addresses #1, #4, #5
- Spec §9 Out of scope → not implemented (correct)
- Spec §10 File touch list → matches plan's "File structure" section
- Spec §11 Acceptance criteria → mapped to each task's visual smoke step

**Placeholder scan** — no "TBD", "implement later", "fill in details", "add appropriate error handling" anywhere.

**Type consistency**:
- `CAT_TIMINGS` keys consistent across Tasks 4, 5, 7
- State names match: `idleSitting`, `idleSleeping`, `standingUp`, `walkingRight`, `disappearing`, `dormant`, `appearing`, `walkingHome`, `sittingDown`, `forecastWatching`
- SVG group IDs consistent: `cs-*` for sitting, `cstanding-*` for standing
- Event name consistent: `catalyst:cat-toggle`
- localStorage key consistent: `catMascotOff`

---

## Execution options

**Plan complete and saved to `docs/superpowers/plans/2026-05-21-dashboard-cat-mascot.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — controller dispatches a fresh subagent per task, two-stage review (spec compliance + code quality) after each. Faster iteration, less context bloat.

2. **Inline Execution** — execute tasks in this session using executing-plans skill, batch execution with checkpoints between tasks.

**Which approach?**
