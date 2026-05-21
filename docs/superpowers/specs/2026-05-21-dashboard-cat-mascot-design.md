# Catalyst Cat Mascot — Design Spec

**Date:** 2026-05-21
**Owner:** skipnick
**Status:** Approved, ready for plan

> First round of decorative mascot work. Adds a 2D rigged SVG cat to the
> Catalyst dashboard and login screen — lives along the bottom edge,
> idles continuously, walks through the screen periodically, and reacts
> to Forecast Catalyst loading + user inactivity. Tier 2.5 hybrid:
> mostly lives its own life, but has 3 specific user-event reactions.

---

## 1. Goal

Add a decorative cat mascot to Catalyst dashboard and login screen. The cat lives along the bottom edge of the viewport, has continuous idle behavior (breathing, blinking, tail flicks, ear twitches), periodically walks through the screen (Pacman-style: exits right, respawns left), and reacts to three specific events: Forecast Catalyst loading, user inactivity, and the random walk-through cycle itself. Style matches the Catalyst logo — minimalist line-art, white outline on dark background.

## 2. Context

After Round 5 (sort redesign), the Catalyst dashboard is visually mature: flat abyss-black surfaces, sharp radii, line-art SVG icons (R4), labeled chip-style sort selector (R5). The dashboard is functional but visually static — no "personality" element beyond the brand mark.

Operator request (verbatim): *"Я хочу добавить кота, который будет ползать, бегать, играться на сайте. Чисто визуальный прикол. Нужно постараться продумать, чтобы он при определенных действиях пользователя выполнял какие-то действия. Выглядеть должно так, будто он живой и занимается своей жизнью, но при этом иногда реагирует на юзера."*

The cat is purely decorative — adds personality without affecting product functionality. It does not analyze content, doesn't influence sorting/filtering, doesn't log events. Pure animation layer on top of the existing UI.

Source assets: 2 hand-prompted illustrations generated via Grok (X Premium) — sitting cat (side profile, facing right) and standing cat (side profile, facing right, 4 paws on ground). Both follow the same line-art aesthetic as the Catalyst logo: thick white outline on solid black, minimal interior detail.

## 3. Principles

### 3.1 Style matches the logo

The cat reads as part of the Catalyst brand system: white line-art outline on dark surface, same line weight as the existing logo cat-head monogram. No bespoke colors. Uses existing theme tokens (`var(--text)`, `var(--surface)`, etc.) so theme switching (pulse / ink / tide) works automatically.

### 3.2 Never blocks the product

The cat container is `position: fixed; pointer-events: none`. Clicks always pass through to the UI behind it. Z-index `500` — above feed-cards (`~50-100`), well below modals (`7000+`) and toasts (`9999`). When a modal opens, the cat is hidden behind the modal backdrop, not interfering.

### 3.3 Performance over fidelity

After R5's wheel-scroll perf fix (removed `box-shadow` from `.feed-card:hover` to prevent paint storms), we keep the same discipline here. The cat uses **only composite-cheap transforms** (translate, scale, rotate, opacity). No animated `box-shadow`, no animated `filter` properties, no continuous DOM-thrashing JS loops. Idle animations are CSS keyframes; high-level state transitions are short `setTimeout` chains.

### 3.4 Fully optional, hidden toggle

Default: ON. Persistent off-switch: triple-click on the Catalyst logo (within 1.5 seconds) toggles `localStorage.catMascotOff`. Toast confirms the change. No Settings UI — this is an Easter egg. Decision rationale: the operator wants the cat included by default but wants the off-switch hidden, so curious power-users can find it but regular users don't see "ugly toggle".

### 3.5 Mobile-aware

On screens narrower than 700px the cat does not render at all. This is the same breakpoint already used in `src/dashboard/server.js` (line 4390, 4590). On a narrow mobile screen the cat would take significant viewport area and conflict with BottomNav — better to hide entirely.

### 3.6 Reduced motion is ignored (explicit decision)

The cat animates regardless of OS-level `prefers-reduced-motion`. This is a conscious operator decision — current dashboard already lacks `prefers-reduced-motion` guards anywhere (only one CSS rule at line 5540, no JS guard). Maintaining consistency. If a user can't tolerate the cat for accessibility reasons, they have the triple-click off-switch.

## 4. Architecture

### 4.0 Home position (X coordinate)

The cat's "home position" along the bottom edge: `left: 80px` from the viewport's left edge (cat anchored by its left edge). At ~80-100px wide for the sitting cat SVG, this puts the cat's full silhouette visible in the lower-left area without touching the screen edge. Same X on both login screen (where there's no sidebar) and dashboard (where the cat sits over the sidebar's bottom region, since sidebar z-index < cat z-index).

### 4.1 Component placement

```
src/dashboard/server.js (inline React SPA template literal)
├── existing App component
│   ├── existing Header (Catalyst logo here — triple-click target)
│   ├── existing LoginScreen / Dashboard route content
│   └── NEW <CatMascot /> mounted at App top level
│       ├── visibility gate (route + localStorage + width)
│       ├── 2 inline SVGs (sitting + standing, rigged into <g> groups)
│       ├── state machine (useState + useEffect chains)
│       ├── 4 idle behavior timers (blink, tail, ear, breath)
│       ├── walk-through scheduler (random 1-3 min)
│       ├── inactivity detector (60s timeout)
│       └── forecast loading prop subscriber
```

The `<CatMascot />` mounts once at App top level, persists across login → dashboard transition. Single instance, single source of truth.

### 4.2 SVG rigged structure

Both source illustrations (sitting and standing) are vectorized through Vectorizer.AI by the operator, producing clean SVG paths. The output is then decomposed into named `<g>` groups so each animatable part has its own transform-origin:

```
<svg id="cat-sitting" viewBox="...">
  <g id="cs-body">          <!-- main silhouette path -->
    <g id="cs-tail-base">   <!-- root section of tail -->
      <g id="cs-tail-tip">  <!-- last ~20% — only this rotates -->
    <g id="cs-front-legs">
    <g id="cs-back-legs">
    <g id="cs-head">
      <g id="cs-ear-left">
      <g id="cs-ear-right">
      <g id="cs-eye">       <!-- single shape, scaleY for blink -->
</svg>

<svg id="cat-standing" viewBox="..."> ...same group structure... </svg>
```

The decomposition step happens during implementation — operator provides the raw vectorized SVG, an implementation subagent splits paths into the group hierarchy. Decisions about which exact paths go into which group are made at implementation time based on the actual vectorized output.

`transform-origin` is set per group: e.g. tail-tip rotates around its base, ear rotates around its attachment point on the head, eye scales around its center, body scales around its bottom edge.

### 4.3 CSS layer

```
.cat-mascot { ... container: fixed, bottom 0, z-index 500, pointer-events none, drop-shadow filter }
.cat-mascot[data-state="sitting"]  { ... }
.cat-mascot[data-state="walking-right"] { ... }
... etc for each state

@keyframes catBreath { ... }
@keyframes catWalkBob { ... }
@keyframes catSleep  { ... }
... etc

.cat-mascot .blink { ... blink keyframe applied via JS-added class }
.cat-mascot .tail-wag { ... }
.cat-mascot .ear-twitch-left { ... }
.cat-mascot .ear-twitch-right { ... }
```

State transitions use `data-state` attribute swaps (no class concat soup). CSS handles all visual transitions; JS only owns *when* to swap states.

### 4.4 JavaScript state machine

States (mutually exclusive):

| State | Visual | Triggered by | Next state |
|---|---|---|---|
| `idleSitting` | sitting cat at home position, idle behaviors running | default; return from any other | (stays) |
| `idleSleeping` | sitting cat, head rotated down -20°, idle behaviors slowed | 60s inactivity | `idleSitting` on next activity |
| `standingUp` | crossfade sitting → standing (250ms) | walk-through scheduler fires | `walkingRight` |
| `walkingRight` | standing cat translates X across viewport, leg/tail animation | `standingUp` completes | `disappearing` at right edge |
| `disappearing` | fade out at right edge | `walkingRight` ends | `dormant` |
| `dormant` | invisible, off-screen | `disappearing` completes | `appearing` after 30-60s |
| `appearing` | fade in at left edge | `dormant` timer fires | `walkingHome` |
| `walkingHome` | standing cat walks from left edge → home X | `appearing` completes | `sittingDown` |
| `sittingDown` | crossfade standing → sitting (250ms) | `walkingHome` completes | `idleSitting` |
| `forecastWatching` | sitting → standing + head rotate +12° up | Forecast Catalyst loading state activates | `idleSitting` when loading completes |

Implementation: single `useState('idleSitting')` + helper `transitionTo(nextState)` that owns cleanup of any active timers/animations.

### 4.5 Visibility gate

`<CatMascot />` returns `null` (does not render) unless ALL three conditions are true:

1. **Route check**: current route is `login` OR `dashboard`. Most other routes don't exist in Catalyst today, but if any do in the future (settings panel, admin) this guard prevents accidental rendering.

2. **Storage check**: `localStorage.getItem('catMascotOff') !== 'true'`. If user has explicitly disabled, no render.

3. **Width check**: `window.innerWidth >= 700`. Implemented via `matchMedia` + `change` event listener for live ressponsiveness.

`useEffect` cleanups handle unmount: all timers cleared, all listeners removed. No zombie state when conditions change.

### 4.6 Hidden toggle (triple-click on logo)

The clickable target is the **entire Catalyst brand-mark wrapper** in Header — both the monogram (cat-head SVG) and the "Catalyst" wordmark, wrapped in a single container element. Clicking anywhere on this wrapper counts toward the buffer. The wrapper gets an `onClick` handler that maintains a buffer of recent click timestamps (filtered to last 1500ms). On the 3rd click within the window:

1. Toggle `localStorage.catMascotOff`
2. Show toast: "Cat mascot enabled" / "Cat mascot disabled" (i18n)
3. Force a `<CatMascot />` re-evaluation via a counter state in App

Buffer is cleared on every successful triple-click. Regular single/double clicks on logo do nothing (no current logo behavior to preserve).

### 4.7 i18n keys (new)

Added to EN and RU blocks:

```
EN:
'cat.toggle_on':  'Cat mascot enabled',
'cat.toggle_off': 'Cat mascot disabled',

RU:
'cat.toggle_on':  'Кот-маскот включён',
'cat.toggle_off': 'Кот-маскот выключен',
```

Only two keys. No other cat-related strings exposed to the user.

## 5. Animation system

### 5.1 Idle behaviors (R1, continuous)

Four independent loops, all running in parallel without sync. Random intervals make the cat feel less mechanical.

| Behavior | Animates | Duration | Interval | Implementation |
|---|---|---|---|---|
| **Breath** | `scale(1.0 → 0.99)` on `#cs-body` (and `#cstanding-body`) | 3500ms cycle, easeInOutSine | continuous | CSS keyframe |
| **Blink** | `scaleY(1.0 → 0.1 → 1.0)` on `#cs-eye` | 280ms | random 4-8s | JS setTimeout chain |
| **Tail-tip wag** | `rotate(0° → -5° → 3° → 0°)` on `#cs-tail-tip` (transform-origin: base) | 800ms (sometimes 2 in a row) | random 8-15s | JS setTimeout chain |
| **Ear twitch** | `rotate(0° → -10° → 0°)` on alternating ear | 150ms | random 5-12s | JS setTimeout chain |

When `idleSleeping`: blink/tail/ear intervals slowed 3x. Breath continues normally.

### 5.2 Reactions

#### R2 — Walk-through cycle

Triggered by an internal timer that fires at a random interval of 1-3 minutes after entering `idleSitting`. The sequence:

1. **standingUp** — crossfade sitting SVG → standing SVG (250ms, opacity swap)
2. **walkingRight** — translateX from home position to `viewport_width + 100px` over ~15 seconds. During the walk:
   - Slight Y-bob (`translateY ±2px`) synced with leg gait
   - Tail tip continues wagging (slower interval)
   - Walk perspective scale (0.96 at edges → 1.0 at center)
3. **disappearing** — opacity 1 → 0 over 200ms at the right edge
4. **dormant** — off-screen for random 30-60 seconds
5. **appearing** — opacity 0 → 1 at left edge (off-screen left, ~-100px)
6. **walkingHome** — translateX from left edge to home position (~4s, faster than the walk-out)
7. **sittingDown** — crossfade standing → sitting (250ms)
8. Return to **idleSitting**, schedule next walk-through

If interrupted by forecast loading, the entire chain is canceled and cat enters `forecastWatching` from its current position.

#### R3 — Forecast watching

Triggered when the Forecast Catalyst loading state changes from `false` to `true`. The exact mechanism for receiving this trigger is decided at implementation time (most likely a prop passed from App to CatMascot, since loading state is already in App scope).

1. **Cancel** any in-progress state queue
2. **standingUp** (250ms) — if currently sitting
3. **head-up** — rotate `#cs-head` (or `#cstanding-head`) by +12° (300ms)
4. **hold** while loading is true
5. **head-back** — rotate head to 0° (300ms)
6. **sittingDown** (250ms) — back to sitting at current position
7. Return to **idleSitting**

If the cat was mid-walk and forecast triggers, the cat performs the reaction *at its current X position*, not at home. After the reaction it remains where it is (doesn't continue interrupted walk). Walk-through scheduler resets and starts fresh.

#### R6 — Inactivity sleep

Activity detector listens (throttled where appropriate, `passive: true`) to `document`-level events:
- `mousemove` (throttled 1Hz)
- `keydown`
- `click`
- `wheel` (passive)
- `touchmove` (passive)
- `scroll` (passive)

On any event: reset 60-second timer. When timer fires:

1. **Enter idleSleeping**: rotate `#cs-head` -20° down (head-droops, 600ms slow)
2. Idle behavior intervals slowed 3x (cat looks asleep)

On next activity event while in `idleSleeping`:

1. **Exit idleSleeping**: rotate head back to 0° (300ms, faster wake-up than sleep)
2. Idle intervals restore to normal
3. Re-enter `idleSitting`

If walk-through scheduler fires while sleeping: wake first, then walk-through after a 1-second delay (cat doesn't go from sleep straight to standing).

### 5.3 3D-feeling tricks

#### Soft drop-shadow

`filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5))` on `.cat-mascot` container. Applied to the final rendered SVG (not per-path), which is cheap. Static — not animated. Creates subtle ambient depth so the cat doesn't feel "pasted" on the background.

#### Breath scale (integrated)

The breath keyframe scales the *entire* body group (not just chest), `1.0 → 0.99 → 1.0`. Combined with `transform-origin: 50% 100%` (anchored at the ground), this creates a subtle "cat is volumetric, not flat" illusion. Synced with no other animation.

#### Walk perspective

During `walkingRight` and `walkingHome`, the cat's `scaleX` is dynamically adjusted based on its X position:
- At viewport center: `scaleX(1.0)`
- At either edge: `scaleX(0.96)`
- Linear interpolation in between

This is updated via a CSS custom property `--walk-scale` written from `requestAnimationFrame` during walk states. Subtle, ~4% scaling — imitates perspective foreshortening at the screen edges.

## 6. Timings constants

All magic numbers collected into a single config object near the top of the CatMascot component:

```
CAT_TIMINGS = {
  BREATH_CYCLE_MS: 3500,
  BLINK_DURATION_MS: 280,
  BLINK_INTERVAL_MIN_MS: 4000,
  BLINK_INTERVAL_MAX_MS: 8000,
  TAIL_WAG_DURATION_MS: 800,
  TAIL_WAG_INTERVAL_MIN_MS: 8000,
  TAIL_WAG_INTERVAL_MAX_MS: 15000,
  EAR_TWITCH_DURATION_MS: 150,
  EAR_TWITCH_INTERVAL_MIN_MS: 5000,
  EAR_TWITCH_INTERVAL_MAX_MS: 12000,

  CROSSFADE_MS: 250,
  WALK_THROUGH_INTERVAL_MIN_MS: 60000,
  WALK_THROUGH_INTERVAL_MAX_MS: 180000,
  WALK_RIGHT_DURATION_MS: 15000,
  WALK_HOME_DURATION_MS: 4000,
  EDGE_FADE_MS: 200,
  DORMANT_MIN_MS: 30000,
  DORMANT_MAX_MS: 60000,

  INACTIVITY_TIMEOUT_MS: 60000,
  ACTIVITY_THROTTLE_MS: 1000,
  SLEEP_BEHAVIOR_SLOWDOWN: 3,

  FORECAST_HEAD_TURN_DURATION_MS: 300,
  FORECAST_HEAD_TURN_ANGLE_DEG: 12,
  SLEEP_HEAD_ANGLE_DEG: -20,

  TRIPLE_CLICK_WINDOW_MS: 1500,
}
```

Single point of tuning if any timings feel off post-launch.

## 7. Edge cases

1. **Window minimized during walk-through.** Use Page Visibility API to pause all timers on `document.visibilitychange` when hidden. Resume from saved progress when visible again.

2. **Forecast loading triggers during walk-through.** Forecast reaction supersedes walk. Cat performs `forecastWatching` at its current X position. After the reaction, cat stays where it is — does not continue the interrupted walk. Walk-through scheduler resets.

3. **Modal opens during any state.** Modal backdrop visually covers cat (z-index). Cat continues running animations behind modal. When modal closes, cat is wherever it should be.

4. **User toggles cat OFF, then ON.** Cat unmounts on OFF (all timers cleared in `useEffect` cleanup). On ON, fresh mount, fresh `idleSitting` at home position.

5. **Window resize during walk-through.** If width changes significantly (>100px delta), cat is teleported back to home position. If small delta, walk continues with updated viewport width as new target.

6. **Desktop → mobile resize.** `matchMedia` listener fires, `<CatMascot>` unmounts. All cleanup runs.

7. **Login → Dashboard navigation.** Cat persists. Component is mounted at App top level, lives across route changes.

8. **Two tabs open.** Each tab has independent cat with independent timers. localStorage shared — if user toggles in tab A, tab B sees the change only on reload (no `storage` event listener for v1; may add in v2 if needed).

9. **Triple-click while cat is mid-walk.** Toggle OFF → cat fades out immediately (unmount). Toggle ON later → fresh mount at home.

10. **Forecast loading was already true when cat first mounts.** On mount, immediately check `forecastLoading` prop and enter `forecastWatching` if true.

## 8. Risks

1. **AI vectorization output is messy.** Vectorizer.AI may produce jittery paths or extra micro-paths from soft edges in Grok output. Mitigation: if first vectorization is messy, re-run with smoother settings or manually clean up paths via subagent in Inkscape-style SVG editing. Worst case: re-generate the source image with adjusted Grok prompt.

2. **Triple-click on logo conflicts with future logo actions.** If we later attach copy-link or branding behavior to the logo, conflicts will arise. Mitigation: triple-click window is 1500ms — regular single clicks pass through cleanly. Future actions can be bound to double-click or button-click on a separate logo affordance.

3. **Forecast loading state is hard to wire.** If `loading` state for Forecast Catalyst is buried deep in component tree, prop-drilling is verbose. Mitigation: investigate during implementation. Fallback to a custom DOM event (`window.dispatchEvent`) if prop drilling is too painful.

4. **Walk-through frequency is annoying.** Over an hour, 20-60 walk-throughs happen. May feel intrusive. Mitigation: single config value `WALK_THROUGH_INTERVAL_MIN_MS` / `MAX_MS` — easy adjustment if feedback comes in.

5. **Drop-shadow filter taxes GPU.** Filter effects are more expensive than borders. Mitigation: small SVG (~30kB), single filter on container (not per-path). Profile in DevTools after deploy. If FPS drops during walk-through, remove drop-shadow entirely or replace with a static SVG drop-shadow path inside the container.

6. **SPA-trap regression.** Any backtick in JS comments or any unescaped `\n` inside string literals in JSX bodies of `src/dashboard/server.js` will collapse the dashboard to a black screen. Mitigation: run `node scripts/check-dashboard-spa.cjs` after every Edit. Same discipline as R4 (which caught this trap 4 times) and R5.

## 9. Out of scope

- **Front view cat asset** — deferred. Required only for in-frame turning, which we avoid via Pacman-respawn pattern. May add in v2 if bidirectional walking becomes desired.
- **Video assets on production** — Grok video output used only as motion reference for me, not embedded in the site.
- **Mouse parallax** — consciously declined. Tends to get annoying in extended sessions.
- **R4 Modal hide reaction** — cat does not actively dodge open modals.
- **R5 Toast / R7 Scroll-to-top / R8 Welcome animations** — not in v1.
- **Cursor-following / pouncing behavior** — frenetic; conflicts with "calm intelligent observer" character.
- **Sound effects** — no meowing, purring, or any audio.
- **Settings panel UI for toggle** — explicit choice for hidden Easter-egg triple-click.
- **Cat reacts to actual trend content** — purely decorative; cat is not an AI agent over the feed.
- **Curl-up sleeping pose** — requires a 3rd source asset. Sleep state is just "head drops" on existing sitting asset.
- **Touch interaction** — cat is `pointer-events: none`; touches pass through. On desktop the triple-click toggle works; mobile users (where cat isn't visible anyway) have no interaction surface.
- **Theme-specific behaviors** — cat looks identical across pulse / ink / tide themes (white outline + drop-shadow).

## 10. File touch list

- **`src/dashboard/server.js`** (the only code file):
  - CSS: ~80-100 new lines (container, state classes, keyframes, idle animation classes)
  - SVG: ~300-400 new lines (sitting + standing inline SVGs with rigged group structure; numbers are estimates pending actual vectorization output size)
  - React component: ~150-200 new lines (`<CatMascot />`, state machine, timer effects, activity detector, forecast subscriber)
  - Header integration: ~20 lines (triple-click handler on logo)
  - App integration: ~10 lines (visibility gate + mount)
  - i18n: 4 new lines (2 keys × 2 languages)
  - **Total**: ~600-900 new lines. File grows from ~320kB to ~340-360kB.
- **`ai-context/WORKLOG.md`**: one new entry at top with summary, files touched, deploy notes.

No other files touched. Backend (`src/api/*`), scripts, configs, admin server — untouched.

## 11. Acceptance criteria

1. Cat is visible on login screen and dashboard when:
   - Viewport width ≥ 700px
   - `localStorage.catMascotOff` is not `'true'`
   - User is on login or dashboard route
2. Cat is NOT visible on viewports < 700px.
3. Triple-clicking the Catalyst logo within 1.5 seconds toggles `localStorage.catMascotOff` and shows a toast (`cat.toggle_on` / `cat.toggle_off`). Setting persists across reloads.
4. Idle animations run continuously: breathing (3.5s cycle), blinking (random 4-8s), tail tip wag (random 8-15s), ear twitch (random 5-12s).
5. Walk-through fires every random 1-3 minutes: cat stands up, walks right, disappears at right edge, dormant 30-60s, reappears at left edge, walks home, sits down.
6. Triggering Forecast Catalyst: cat stands up and rotates head 12° up. When loading completes, head returns to 0°, cat sits down.
7. 60 seconds of no user input (mousemove, keydown, click, wheel, touchmove, scroll): cat drops head -20° (sleep). Any input: head returns to 0° (wake).
8. `node scripts/check-dashboard-spa.cjs` passes after all edits.
9. On deploy, visual inspection shows smooth animations, no jank, no FPS drops during walk-through. Cat looks coherent across all three themes (pulse / ink / tide).
10. `<CatMascot>` survives login → dashboard transition without unmount.
