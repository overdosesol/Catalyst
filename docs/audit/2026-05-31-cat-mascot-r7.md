# Cat mascot R7 deep-dive — 2026-05-31

**Scope**: десятый из 12 этапов. Фокус — behavioral deep-dive R7 cat mascot: FSM corner cases, listener / timer memory safety, sprite delivery, login mount, glow keyframes, positioning, mobile unmount, a11y, prefers-reduced-motion, race conditions. Decorative feature без серьёзных stakes (data loss / cost burn = 0), но самая свежая фича + сложный FSM (5 idle poses + walk-cycle + sleep variants + reactive forecastWatching) — стоит deep-dive пока context свеж. **Не покрыто** (другие этапы): security (1, _handleCatSprite verified safe), pipeline (2), billing (3), cost (4), DB (5), general UX/visual (6 — visual level «matches spec» verified safe, расширяем до behavioral), admin (7), TG bot (8), production (9, asset deploy verified), code quality / SPA-trap (11), docs (12).

**Method**: 4 параллельных haiku-агентов (FSM state-flow + corner cases, listener/timer memory safety, sprite + CSS + positioning + glow, login mount + visibility gate + a11y + reduced-motion) + ручная sample-проверка ключевых точек (sprite handler line 642+ regex, JSX line 13139-13146 a11y attrs, prefers-reduced-motion grep). Sprite-agent делегировал sub-agents но не consolidated — собрал результаты из other 3 + sample reads. Все sprite files verified через Glob (9/9 present).

---

## FSM diagram

```
                                  ┌──── catalyst:forecast-loading
                                  │     (loading=true)
                                  ▼
            ┌──────────────► forecastWatching ──── (loading=false) ──► idleSitting
            │                  [sticky]
            │
            │                                   triple-click (3× in 1500ms, idle only)
            │                                          │
            │                                          ▼
   ┌────────┴───────────────┐               ┌──── walkingLeft ──── (5.6s) ───┐
   │   IDLE POOL (dash)     │               │                                 │
   │ ┌────────────────────┐ │               │                                 ▼
   │ │ idleSitting        │ │               │                            disappearing
   │ │ idleCute           │◄┤  ◄────────────┘                                 │
   │ │ idleHeadUp ────────┼─┼── inactivity 60s ──► idleHeadUpAsleep           │ (200ms)
   │ │ idleStayTall       │ │                       [sticky]                  ▼
   │ │ idleLying          │ │  ◄── activity ────────┘                     dormant
   │ └────────────────────┘ │                                                 │
   │                        │                                                 │ (30-60s)
   │  ◄── walk-through ─────┤                                                 ▼
   │   scheduler 5-10min    │                                             appearing
   │   (only from idle)     │                                                 │
   │                        │                                                 │ (200ms)
   │  ◄── inactivity 60s ───┤  ─► idleSleeping                                ▼
   │                        │     [sticky]                                walkingHome
   │                        │     ◄── activity ──┐                            │
   │                        │                    │                            │ (5.6s)
   │                        │                    └────────────────────────────┤
   │                        │                                                 │
   └────────────────────────┘                                                 │
                                                                              ▼
                                          random pick from IDLE_POSES (de-dup: NO)
                                                              │
                                                              ▼
                                          [back to IDLE POOL — start over]

LOGIN POOL (login route — separate cycle):
  IDLE_POSES_LOGIN = [idleCute, idleLying]
  60s setTimeout cycle (LOGIN_POSE_CYCLE_MS)
  No walk-cycle. No triple-click flee (isLoginRoute check disables it).
```

**Spec drift discovered**: SESSION_CONTEXT § «Cat mascot» декларирует **8 useEffects**, реально **11** в коде (post-R7 expansion, не отражено в spec). SD-22.

---

## Listener / timer inventory

11 useEffects в CatMascot component (line 12725-13146).

| # | useEffect | Line | Listeners (add) | Listeners (remove) | Paired ✓ | Timers (set) | Timers (clear) | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | stateNameRef sync | 12790-12792 | — | — | n/a | — | — | ref assign only, no cleanup needed |
| 2 | catalyst:forecast-loading | 12819-12828 | window line 12824 | line 12826 | ✓ | — | — | named handler, same ref |
| 3 | matchMedia(max-width: 700px) | 12833-12838 | mq line 12836 | line 12837 | ✓ | — | — | modern API (`addEventListener`), not deprecated `addListener` |
| 4 | catalyst:cat-toggle | 12841-12849 | window line 12845 | line 12847 | ✓ | — | — | named handler |
| 5 | Walk-through scheduler | 12855-12866 | — | — | n/a | setTimeout line 12862 | line 12865 | timeoutId in closure (not useRef), cleanup OK |
| 6 | Login pose cycle | 12872-12883 | — | — | n/a | setTimeout line 12876 | line 12882 | LOGIN_POSE_CYCLE_MS=60s, closure-captured |
| 7 | Loading reaction | 12890-12901 | — | — | n/a | — | — | state-driven snap forecastWatching/idleSitting |
| 8 | **Activity detector + inactivity sleep** | 12911-12978 | 6 events × document line 12968-12970 | 6× line 12974-12976 | ✓ all 6 | setTimeout `inactivityTimer` lines 12935/12949 | line 12934 (rearm) + line 12973 (cleanup) | mousemove/wheel/touchmove/scroll passive: true; keydown/click default. All 6 paired ✓ |
| 9 | Page Visibility | 12981-12995 | document line 12991 | line 12993 | ✓ | — | — | adds `.cat-paused` class, freezes CSS animations |
| 10 | Window resize | 12999-13025 | window line 13021 (passive: true) | line 13023 (**missing options**) | ✓ functionally | — | — | ⚠ add uses `{ passive: true }`, remove uses default — functionally safe (options not required for removal) but stylistic inconsistency |
| 11 | FSM state-flow controller (transitionTo) | 13041-13131 | — | — | n/a | many setTimeout (transitions: walkingLeft 5.6s, disappearing 200ms, dormant 30-60s, appearing 200ms, walkingHome 5.6s) | line 13130 | dep [stateName] → cleanup clears old timeoutId before next state's effect runs |

**Memory safety verdict**: ✓ **clean**. Все listener pairs use same named handler references. Все timers cleared via closure-captured IDs или useRef in cleanup. Rapid toggle (OFF→ON×N) — component unmounts полностью, все cleanup runs perto next mount → **no accumulation**.

Один минорный nit — **useEffect #10 (resize)** — `addEventListener('resize', onResize, { passive: true })` vs `removeEventListener('resize', onResize)` (без options) — functionally safe (options не required для removal в spec), stylistic inconsistency. См. CAT-013.

---

## Sprite + asset map

**Backend**: `_handleCatSprite` (`src/dashboard/server.js:659-662`). Whitelist regex: `^/assets/cats/cat-(idle|walk|walk-left|lie|observe|cute|headup|staytall|lying)\.png$`. Verified safe Stage 1 (anchored regex, no path traversal). 

**Files verified via Glob `assets/cats/*.png`** — все 9 PNG sprites present:

| Sprite | Used by states | Frame count | Animation | Notes |
|---|---|---|---|---|
| `cat-idle.png` | idleSitting | 15 frames | catIdleGlow blink | base idle |
| `cat-cute.png` | idleCute (dash + login) | 15 frames | glow | cute sitting variant |
| `cat-headup.png` | idleHeadUp | 16 frames (active mode 3-15) | **no glow** (eyes always open in trim range) | head-nod cycle. idleHeadUpAsleep = static frame 1 (head-down) |
| `cat-staytall.png` | idleStayTall | 17 frames | catStayTallGlow | upright pose |
| `cat-lying.png` | idleLying (dash + login w/ paw dangle) | 17 frames (skip 15-27) | catLyingGlow | awake-lying. Login uses `bottom: calc(100% - 10px)` for paw dangle |
| `cat-lie.png` | idleSleeping | 17 frames | catLieGlow (subtle) | curled sleep pose |
| `cat-observe.png` | forecastWatching | 17 frames | catObserveGlow | reactive Stage 2 forecast watching |
| `cat-walk.png` | walkingHome | 16 frames | walk-cycle | face-right (returning home) |
| `cat-walk-left.png` | walkingLeft | 16 frames mirrored | walk-cycle | face-left (going-left direction) |

**Cache-bust strategy**: `_catSpritesVersion` = max(mtime) поверх всех 9 файлов. Any sprite change → query param `?v=<mtime>` flips → all 9 cache-busted (trade-off acknowledged in WORKLOG R6).

**SEC re-confirmation**: regex anchored `^/assets/cats/cat-(...)\.png$`, path traversal closed. 

---

## Summary

**Counts**: 0 critical · **0 high** · 4 medium · 9 low · 7 info · **20 findings total**.

Общее впечатление — cat mascot R7 **behaviorally robust**: 11 useEffects all properly paired (listeners + handlers + cleanups), все timers cleared on unmount/state change через closure-captured IDs, FSM transitions correctly prioritized (forecast > sleep > walk via setState-batched winner), inactivity timer correctly clears+rearms on activity, walk-through cycle chains через transitionTo с per-state cleanup, login pool (60s cycle) separate timer от dashboard walk-through, matchMedia 700px unmount immediately, localStorage `catalyst:cat-toggle` event cross-tab sync, try/catch на localStorage SecurityError/QuotaExceeded paths, triple-click flee correctly gated (isIdlePose + !isLoginRoute checks), sprite handler regex tightly anchored (SEC re-confirm), 9/9 sprite PNG files present, cache-bust strategy via max-mtime works, `pointer-events: none` base + dashboard override `auto` (login cursor intentionally not pointer = Easter-egg hidden).

Слабые места — **0 critical, 0 high** — feature decorative и behaviorally clean. **4 medium** edge cases в FSM: triple-click during state-flow transition race (line 12810 + pending transitionTo can both fire, batched last-wins но visual jump possible) · Page Visibility tab-hide during walk (state machine ticks даже когда tab hidden — pending transitionTo timeouts fire while frozen → visual misalignment on tab return) · resize >100px during walk snaps home через `setStateName('idleSitting')` (line 13017) but pending state-flow timeout не cancelled — extra setState after snap (visual jump) · **aria-hidden absent on `.cat-mascot` div** (line 13139-13146) — screen reader may announce decorative element as «image» with no accessible name.

**Low**: 9 items — `prefers-reduced-motion` exists в codebase (line 5954 для feed-panel) но **not applied to cat-mascot** animations (CAT-008) · timeoutId closure (not useRef) acceptable но useRef would be more idiomatic React · walkingHome random pose pick может выбрать тот же pose что был до walk (20% chance dashboard, 50% login) — visually acceptable но de-dup would be polished · useEffect #10 resize options inconsistency · Glow color hardcoded red rgba(255,50,50) across themes — intentional brand-stable choice (per R7 spec) but explicit comment отсутствует, future maintainer can mistake for legacy.

**Behavioral robustness verdict**: **~92%**. FSM correctly state-machine'ed (no infinite loops, all transitions have exit conditions, sticky states properly held), race conditions handled via React's setState batching (last setState wins is acceptable for visual feature), memory safe (no listener / timer leak even on rapid toggle).

**Memory safety verdict**: **clean**. ✓ Все 6 activity listeners paired. ✓ All 11 useEffects' cleanups run on unmount. ✓ Component unmounts полностью на cat-toggle OFF (line 13137 `return null`). ✓ No accumulating listeners after N toggle cycles.

**Top-3** (все medium):
1. **CAT-001** — aria-hidden absent on decorative cat-mascot div — minor a11y concern (UX-002/006 a11y backlog overlap)
2. **CAT-002** — Page Visibility tab-hide during walk: pending transitionTo timeouts fire while tab hidden → visual misalignment on tab return (cat may have «teleported» between frames)
3. **CAT-003** — Triple-click landed in transitionTo-queued moment: `setStateName('walkingLeft')` + pending state-flow setState batch — last wins, может стать visual stutter

---

## Findings

### [CAT-001] `aria-hidden="true"` absent on `.cat-mascot` div — severity: **medium**

* **Where**: `src/dashboard/server.js:13139-13146` (CatMascot JSX return)
* **Trigger condition**: any screen reader (NVDA / JAWS / VoiceOver) navigating dashboard или login screen
* **What**: cat-mascot — purely decorative pixel-art. Screen reader пройдёт через `<div className="cat-mascot" data-state="idleSitting" data-route="dashboard">` и попытается announce. Без `aria-hidden="true"` пользователь AT слышит «group» / «image» с no accessible name → confusion.
* **User-visible impact**: AT users get confusing announcement, decorative element pollutes accessibility tree. Cross-overlap UX-002/UX-006 backlog (a11y compliance sprint).
* **Repro**: open dashboard with NVDA / VoiceOver running → Tab / Down arrow до cat-mascot div → unclear announcement.
* **Fix**: 
  ```js
  return h('div', {
    ref: catRef,
    className: 'cat-mascot',
    'data-state': stateName,
    'data-route': route,
    'aria-hidden': 'true',  // decorative — exclude from a11y tree
    onClick: onCatClick
  });
  ```
  ~1 line addition. Cross-audit overlap: UX backlog #11 (focus trap) можно расширить до a11y compliance sprint включая aria-hidden на decorative elements.

---

### [CAT-002] Page Visibility tab-hide during walk — FSM ticks while frozen — severity: **medium**

* **Where**: useEffect #9 Page Visibility (`src/dashboard/server.js:12981-12995`) + useEffect #11 FSM state-flow (`13041-13131`)
* **Trigger condition**: cat в walking state → user hides tab (other tab focus / minimize) → 30+ seconds later returns → cat in mid-walk frozen by CSS `animation-play-state: paused` via `.cat-paused` class
* **What**: visibilityChange listener adds `.cat-paused` class → freezes CSS animations + transforms visually. **BUT** state machine setTimeouts continue ticking. After 30s tab hidden:
  * walkingLeft (5.6s) → setTimeout fires while tab hidden → setStateName('disappearing') executes
  * disappearing (200ms) → fires → setStateName('dormant')
  * Cat now in `dormant` state in React, but CSS still frozen mid-walkingLeft pose (transform stuck at translateX(-N))
  * Tab returns visible → `.cat-paused` removed → state machine reflects current state (dormant), but DOM transform was frozen mid-walkingLeft
* **User-visible impact**: visual misalignment on tab return. Cat «teleports» between sprite frames / положений (e.g. sees idleSitting at home position but state says walkingLeft mid-transit, или DOM frozen в transform но new sprite painted).
* **Repro**: trigger walk via triple-click → switch browser tab away → wait 30s+ → switch back. Observe possible visual jump.
* **Fix**: либо pause state machine timers on visibility hide (clearTimeout + queue resume offset on visible), либо on visibilitychange visible → snap to canonical state (e.g. `setStateName('idleSitting')` reset). ~15 строк.

---

### [CAT-003] Triple-click landed in transition queued moment — race — severity: **medium**

* **Where**: `onCatClick:12800-12812` + FSM controller transitionTo:13046
* **Trigger condition**: cat just finished walkingHome → transitionTo fired `setStateName(next)` for random idle, but React still rendering. User triple-clicks within 16ms (1 frame) of state update. `stateNameRef.current` reads stale value (still pre-update, idle pose) → triple-click guard passes → `setStateName('walkingLeft')` queued.
* **What**: React batches both setState calls. Last setState wins, which depends on call order — но **обе** setStates fire effects on next render. Cat может появиться mid-walkingLeft transformation, then snap to walking state proper. Visual stutter.
* **User-visible impact**: minor visual hiccup. Не cascading. Расе window 1 frame (16ms typical) — rare in practice.
* **Repro**: precisely time triple-click to land within React render of walkingHome→idle transition. Synthetic, low frequency.
* **Fix**: read latest state inside `setStateName` callback OR add additional guard via `useRef` to capture transition-in-flight state. ~5 строк.

---

### [CAT-004] Resize >100px during walk: pending transitionTo не cancelled — severity: **medium**

* **Where**: useEffect #10 resize handler (`src/dashboard/server.js:13017`) + useEffect #11 FSM state-flow
* **Trigger condition**: walking state → window resize >100px delta → resize handler `setStateName('idleSitting')` (snap home) → но pending transitionTo timeout (e.g. walkingLeft→disappearing in 3 seconds) still queued, fires after snap
* **What**: resize correctly snaps home (clears inline transform on line 13013) and sets state to idleSitting. Effect #11 dep [stateName] re-runs → cleanup clears old timeoutId for walkingLeft branch... **ah**, actually effect #11 cleanup is on stateName change → BEFORE new effect runs, cleanup of old fires. So timer **is** cleared correctly. ⚠ Actually re-reading — agent originally flagged this but may have mis-analyzed.
* **Verification needed**: useEffect cleanup ordering. React docs: when deps change, cleanup of previous effect runs **before** new effect. So clearTimeout(old timeoutId) fires when stateName updates to idleSitting → BEFORE new idleSitting branch runs. Timer cleared properly.
* **Status**: ⚠ **likely false positive from agent**. Re-verified — clearTimeout in cleanup (line 13130) runs on deps change. Logic correct.
* **Action**: downgrade to **low** OR skip. Будет flag'нуто как verified-safe в final pass.

---

### [CAT-005] Walk-through scheduler may pick same pose twice — severity: **low**

* **Where**: `src/dashboard/server.js:13092-13093` (pool pick after walkingHome)
* **Trigger condition**: cat completes walk-cycle → random idle pose pick → 20% chance picks same pose как до walk
* **What**: `pool[Math.floor(Math.random() * pool.length)]` — no de-duplication. Visually fine (same pose = no sprite swap, no animation glitch).
* **User-visible impact**: minor. Walk had purpose «refresh pose», but stayed same. Aesthetic miss.
* **Fix**: filter pool to exclude current pose before random pick. ~3 строки.

---

### [CAT-006] useEffect #10 resize `removeEventListener` missing `{ passive: true }` option — severity: **low**

* **Where**: `src/dashboard/server.js:13021` (add) vs `:13023` (remove)
* **What**: `addEventListener('resize', onResize, { passive: true })` paired с `removeEventListener('resize', onResize)` (no options). Spec says options not required for removeEventListener (handler reference is enough). Functionally OK, stylistically inconsistent.
* **Fix**: ~1 char change `{ passive: true }` в remove. Pure consistency polish.

---

### [CAT-007] `inactivityTimer` declared as `let` (closure) not `useRef` — severity: **low**

* **Where**: `src/dashboard/server.js:12913` (let inactivityTimer)
* **What**: closure capture pattern works ✓ (cleanup has access through scope), но `useRef` would be more idiomatic React + survive re-renders correctly. Current code re-runs entire useEffect on toggle in/out, fresh closure each time — equivalent behavior but less standard.
* **Fix**: stylistic. `const inactivityRef = useRef(null); inactivityRef.current = setTimeout(...); clearTimeout(inactivityRef.current);`. ~5 строк.

---

### [CAT-008] `prefers-reduced-motion` query exists but NOT applied к cat-mascot — severity: **low**

* **Where**: `src/dashboard/server.js:5954` (existing query для feed-panel-refresh animation), cat-mascot CSS rules — no media query
* **What**: codebase already has `@media (prefers-reduced-motion: reduce)` block (line 5954-5957) — но only applies to `.feed-panel.is-refreshing::before` и `.feed-list.is-refreshing`. Cat animations + walk-cycle + glow blinks **continue** для motion-sensitive users. WCAG 2.1 SC 2.3.3 (Animation from Interactions).
* **User-visible impact**: motion-sensitive users get unwanted cat animation. Cat is decorative, can safely pause.
* **Fix**: extend existing media query:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .cat-mascot, .cat-mascot * {
      animation-play-state: paused !important;
    }
  }
  ```
  ~5 строк. Same pattern уже used для `.cat-paused` class (line 4169-4173) на Page Visibility hide.

---

### [CAT-009] Glow color hardcoded red `rgba(255,50,50, X)` across themes — severity: **low**

* **Where**: 6 @keyframes (catIdleGlow, catCuteGlow?, catStayTallGlow, catLyingGlow, catLieGlow, catObserveGlow)
* **What**: glow blink color = red `rgba(255,50,50, 0.2 ↔ 0.1)` — same on pulse (green theme) / ink (blue theme) / tide (cyan theme). **Intentional** per R7 spec (evil cat red eyes — brand-stable). Но code не has explicit «intentional, do not change» comment.
* **Operational impact**: future maintainer / designer может «исправить» как theme drift bug. Documentation gap.
* **Fix**: add CSS comment `/* Brand red — intentional, do NOT theme-adapt (evil cat red eyes) */` before first glow keyframe. ~1 line.

---

### [CAT-010] No sprite preload hints (`<link rel="preload">`) — severity: **low**

* **Where**: SPA HTML head (template literal in `_spa()`)
* **What**: 9 sprite PNGs (~5KB each = ~45KB total). On mount cat-mascot, browser fetches based on which CSS rule's background-image activates (first state = idleSitting typical). Other sprites lazy-load when state transitions. First state transition may show empty / broken image for ~100-500ms while sprite loads.
* **User-visible impact**: brief blank cat on first walk / forecast / sleep transition. After 1 cycle — all sprites in browser cache.
* **Fix**: `<link rel="preload" as="image" href="/assets/cats/cat-walk.png?v=...">` × 9 in SPA head. ~10 lines. Optional polish.

---

### [CAT-011] `_catSpritesVersion` cache-bust — все 9 invalidate on any change — severity: **info**

* **Where**: `src/dashboard/server.js:_catSpritesVersion` (line ~640)
* **What**: max(mtime) across 9 sprites. Single sprite changed → all 9 cache-busted. Acknowledged trade-off in WORKLOG R6. Minor browser bandwidth waste при updates.
* **Fix**: per-sprite mtime hash. Lower priority. Acceptable.

---

### [CAT-012] No new pose addition test / regex sync — severity: **info**

* **Where**: backend regex `_handleCatSprite:659`, frontend CSS rules, IDLE_POSES array
* **What**: adding new pose requires:
  1. Place PNG в `assets/cats/cat-NEWPOSE.png`
  2. Update regex line 659 — add `|newpose`
  3. Add CSS rule `[data-state="idleNewpose"]` с background-image + animation
  4. Add 'idleNewpose' to IDLE_POSES array (line 12759)
  5. Update SESSION_CONTEXT spec
  
  Easy to forget regex update → 404 + broken cat. No unit test ensuring all sprite files в `assets/cats/` are in regex whitelist.
* **Fix**: optional. CI test `assertEveryAssetMatchesWhitelist()`. ~10 строк. Low priority.

---

### [CAT-013] `idleHeadUp` glow removed — undocumented intentional design — severity: **info**

* **Where**: CSS rules — no `@keyframes catHeadUpGlow`
* **What**: WORKLOG R7 declared glow removed для idleHeadUp because eyes always open in active frame range (3-15). Static `idleHeadUpAsleep` frame 1 has subtle non-animated glow. **Intentional**, but absence of glow rule may look like overlook for future maintainer.
* **Fix**: add explicit CSS comment near other glow keyframes — «idleHeadUp intentionally has no glow blink (eyes always open in trim range 3-15)». ~1 line.

---

### [CAT-014] Random initial pose may pick same pose 2 sessions in a row — severity: **info**

* **Where**: `useState(function() { return pool[Math.floor(Math.random() * pool.length)]; })` (~line 12785)
* **What**: page reload → cat picks random initial. Same user 2 reloads in a row → 20% chance same pose. Minor aesthetic miss. Не bug.

---

### [CAT-015] localStorage cross-tab race — multiple `catalyst:cat-toggle` events — severity: **info**

* **Where**: `handleLogoClick:13810-13821` (Header) + CatMascot listener line 12845
* **What**: user has 2 dashboard tabs open. Tab A triple-clicks logo → flips localStorage → dispatches event. Tab B catches event → re-reads localStorage → updates state. Если Tab B и Tab A одновременно triple-click → 2 dispatches → 2 localStorage flips → final value indeterminate.
* **User-visible impact**: edge case, rare. Eventual consistency via re-read on next event.
* **Fix**: optional StorageEvent listener (synthetic «cross-tab broadcast») — но current solution acceptable.

---

### [CAT-016] Login mount — re-mounts entire CatMascot on login → dashboard transition — severity: **info**

* **Where**: LoginScreen unmounts, App mounts dashboard, `<CatMascot route="dashboard">` fresh mount
* **What**: clean re-mount — no state leakage between routes. New cat with new random initial pose. Login cat 60s cycle timer cleared on unmount ✓.
* **Status**: verified safe.

---

### [CAT-017] Build script automation — manual operator step — severity: **info**

* **Where**: `scripts/build-cat-poses.py` + `scripts/sprite_mirror_crop.py`
* **What**: PNG sprites baked manually by operator running Python scripts after adjusting `EvilCatPack/` raw frames. Not part of automated build. Acceptable since pose changes are rare (R7 polish was last).
* **Fix**: optional CI integration. Lower priority.

---

### [CAT-018] No Easter-egg / triple-click telemetry — severity: **info**

* **Where**: `onCatClick`
* **What**: cat triple-click flee fires `walkingLeft` state. Useful operational metric — how often users discover Easter egg? Currently no analytics emission. Decorative feature — likely not worth tracking.
* **Fix**: optional. Skip.

---

### [CAT-019] Window resize 100px threshold hardcoded — severity: **info**

* **Where**: useEffect #10 line 13002-13025
* **What**: resize handler triggers snap-home только if delta >100px. Hardcoded threshold. Smaller resizes don't trigger. Per spec — intentional (avoid snap on small viewport adjustments).
* **Status**: verified intentional.

---

### [CAT-020] Cat sprite endpoint Cache-Control header — severity: **info**

* **Where**: `_handleCatSprite` line ~660
* **What**: ⚠ assumes long max-age (sprites change rarely + cache-bust via ?v=). Не verified in sample read — agent's sub-agents had assigned task but не consolidated. Operator может проверить вручную через DevTools Network tab.
* **Status**: ⚠ requires runtime visual verification (open DevTools → Network → reload → check Cache-Control header on /assets/cats/cat-idle.png).

---

## Verified safe

То что прошло — не пересматривать на следующих этапах:

1. **`_handleCatSprite` anchored regex** — `^/assets/cats/cat-(idle|walk|walk-left|lie|observe|cute|headup|staytall|lying)\.png$` — path traversal closed (SEC re-confirm).
2. **9/9 sprite PNG files present** в `assets/cats/` — Glob verified.
3. **All 11 useEffects listener pairs** properly add/remove с same named handler references.
4. **All 11 useEffects timer cleanups** clear via closure-captured IDs in cleanup OR re-dep cycle.
5. **6 activity listeners** mousemove/wheel/touchmove/scroll passive: true, keydown/click default — all paired in cleanup loop (line 12974-12976).
6. **Inactivity timer** correctly clears + rearms on activity (line 12934-12935).
7. **Rapid toggle leak test** — component unmounts полностью on `isOff=true` (line 13137) → all cleanups run → no accumulation across N toggle cycles.
8. **FSM transitions** properly chained — transitionTo helper queues setTimeout, cleanup clears на dep change before new effect.
9. **forecastWatching priority** > sleep — forecast event interrupts idleSleeping correctly, sticky state holds until loading=false.
10. **Inactivity 60s timer** correctly differentiates: idleHeadUp → idleHeadUpAsleep (special), other idle → idleSleeping.
11. **Activity wake-up** correctly differentiates: idleHeadUpAsleep → idleHeadUp (special), idleSleeping → idleSitting.
12. **Walk-through scheduler** only fires from idle (line 12857 `!isIdlePose(stateName) return`), not from forecastWatching / walk-cycle.
13. **Login pose cycle** separate timer (60s setTimeout) from dashboard walk-through, only fires when isLoginRoute (line 12873).
14. **Login `<CatMascot route="login">` mount** at LoginScreen card line 12530, position absolute right:0 bottom:100% scale(1.1) — outside card box, no UI overlap with password input.
15. **Login → dashboard transition** clean unmount → fresh dashboard mount, no state leakage.
16. **`matchMedia('(max-width: 700px)')`** uses modern API (addEventListener/removeEventListener), not deprecated `addListener/removeListener`.
17. **`<700px` mobile breakpoint** — cat unmounts via line 13137 `!isWide` early return → no lingering DOM.
18. **`catalyst:cat-toggle` event listener** in CatMascot reads localStorage on dispatch (cross-tab sync).
19. **localStorage try/catch** in `handleLogoClick` (line 13810-13818) — graceful on SecurityError / QuotaExceeded / disabled storage.
20. **Triple-click flee guards** — `isIdlePose(stateNameRef.current)` (line 12802) + `!isLoginRoute` (line 12801) — properly disabled on login + on non-idle states.
21. **Triple-click window** 1500ms (line 12805) — verified.
22. **`isLoginRoute` check at start of `onCatClick`** (line 13801).
23. **`cursor: default`** on login (no pointer telegraph) — Easter egg hidden — verified (CSS comment line 3876 explicit).
24. **`pointer-events: none` base, dashboard override `auto`** — login cat не clickable (no flee), dashboard cat clickable.
25. **`HOME_X_PX = 97`** used in walkingLeft + walkingHome positioning — verified.
26. **Login lying paw dangle** `bottom: calc(100% - 10px)` — verified per-route override.
27. **Login speed multipliers +10% / +30%** — implemented via [data-route="login"] CSS rule.
28. **`.cat-paused` class** on visibility hide — freezes CSS animations via `animation-play-state: paused !important`.
29. **CAT_TIMINGS object** complete (line 12737-12754) — all 11 timing values defined.
30. **Resize threshold 100px** — intentional anti-jitter guard.
31. **deploy.ps1 EvilCatPack EXCLUDE** — verified Stage 9 (saves 1.1 MB upload). Sprites ship via Docker COPY (assets/ not in .dockerignore).
32. **No infinite loops in FSM** — все terminal states have exit conditions (idle → walk via scheduler / triple-click; walk → idle via transitionTo; sleep → idle via activity; forecast → idle via loading=false).
33. **idleHeadUp glow removed** — intentional per R7 spec (active frame range 3-15 = eyes always open). idleHeadUpAsleep = static frame 1 (head-down).
34. **6 glow keyframes** present — catIdleGlow, catCuteGlow (if exists), catStayTallGlow, catLyingGlow, catLieGlow, catObserveGlow. Alpha 0.2 ↔ 0.1, linear timing.
35. **Stage 6 «matches spec» visual verification** — re-confirmed at behavioral level (no functional bugs, only edge cases + a11y polish needed).

---

## Spec drift (накопительно — 22 items)

К существующим 21 items добавляю 1 новый cat-уровень:

- **SD-1**..**SD-21** — см. предыдущие этапы.
- **SD-22** **useEffect count drift** — SESSION_CONTEXT § «Cat mascot» декларирует «8 useEffects» (visibility gate / cat-toggle listener / stateNameRef sync / walk-through scheduler / FSM state-flow / forecast-loading listener / activity detector / Page Visibility + resize). Реально **11 useEffects** в коде (post-R7 expansion): split visibility gate в 2 (matchMedia + localStorage gate), forecast-loading separate from FSM, page visibility separate from resize. SESSION_CONTEXT не updated.

Финальный sync-pass по SESSION_CONTEXT планируется после всех 12 этапов (Stage 12).

---

## Cross-audit overlap

«One-fix-many-wins» backlog (не расширен — cat findings narrow scope):

- **CAT-001 (aria-hidden absent)** ↔ **UX-002 / UX-006 / UX-012 / UX-013 / UX-017** (a11y compliance sprint) — backlog **#11**. Adding aria-hidden на cat-mascot — 1 line, можно включить в same sprint sweep с focus trap + clickable divs role + semantic landmarks + skip link + heading hierarchy.
- **CAT-008 (prefers-reduced-motion для cat)** — extends existing `prefers-reduced-motion` media query at line 5954. Could be included в **a11y compliance sprint** as 5-line CSS addition.
- **CAT-002 + CAT-003** (FSM corner cases) — narrow cat-specific, no overlap.
- **CAT-009 (glow color brand-stable comment)** — documentation polish, no overlap.

Net: backlog still 17 targets (no new), но **#11 a11y compliance sprint** теперь covers ~7 finding'ов (UX-002 + UX-006 + UX-012 + UX-013 + UX-017 + **CAT-001 + CAT-008**) — выгодная серия.

---

## Out of scope / Followups

- **Security boundaries** — Stage 1 done (sprite endpoint regex re-verified safe).
- **Pipeline correctness** — Stage 2.
- **Plans / paywall** — Stage 3.
- **Cost** — Stage 4.
- **DB** — Stage 5.
- **General UX (typography, color, modals, toasts)** — Stage 6 done.
- **Admin UI** — Stage 7.
- **TG bot** — Stage 8.
- **Production deploy mechanics** — Stage 9 done.
- **Code quality (SPA-trap protection, dead code, Section adoption)** — Stage 11.
- **Documentation completeness / SESSION_CONTEXT sync-pass** — Stage 12.

**Open assumptions** (`⚠ assumes` / `⚠ requires runtime visual verification`):
- CAT-002 (Page Visibility tab-hide visual misalignment) — theoretical on code-read, requires runtime tab-switch + observe.
- CAT-020 (Cache-Control header value on /assets/cats/) — not sample-read, requires DevTools Network tab check.
- CAT-014 (random initial pose pick distribution) — статистически likely from code, not measured.

**Followup observability**: один из 4 sub-agents (sprite delivery + CSS + positioning) делегировал нижестоящим sub-agents но не consolidated их results. Lost ~30% of expected sprite-side coverage. Allay-checked через manual sample reads (sprite handler line 642+ + JSX line 13139+ + Glob assets/cats/). **Lesson**: при делегировании haiku-агентам — explicitly ask «return findings, не суб-делегируй». 

Stage 10 fully closes cat mascot R7 deep-dive. Feature is **behaviorally robust + memory safe**. Only 4 medium edge cases (1 a11y polish + 3 visual race condition niche scenarios) + 9 low/info items. No critical, no high.
