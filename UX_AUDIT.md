# Ingenious Web App — UX Report

## Assessment

The app's biggest systemic problems are redundancy and divergent sources of truth, exactly where you've asked us to focus. The "Your name" editor, board-size stepper, segmented controls, card surfaces, and back/leave affordances are each hand-rolled multiple times and have already drifted (different placeholders, persistence, casing, radii, and styles for the same role), so every tweak must be made in several places and the UI reads as unstandardized. Layered on top is one genuinely high-severity flow defect — startup bypasses the Menu's server guard and strands offline users on a dead Browse screen — plus a broad accessibility gap where the core board interaction and most custom controls are unreachable by keyboard.

---

## High

- **App auto-launches into online play, stranding offline first-run users** (`web/src/App.tsx:36`)
  Default screen is hardcoded to online quickplay; if the server is unreachable, the socket closes with no reconnect and the user lands on a Browse screen showing "Disconnected" with dead Create/Join buttons. The polished Menu server-probe is entirely bypassed. **Fix:** Default to Menu (reserve direct online landing for the resume case via `OnlineMatch.hasSession()`); at minimum, when link is closed with an error, render a clear retry/back-to-menu screen instead of the full Browse UI.

- **Board cells are mouse/touch-only — no keyboard access or roles** (`web/src/components/Board.tsx:182`)
  The core interaction (placing tiles) is SVG `<g>` elements with `onClick` only — no role, tabIndex, or key handler — so the game is unplayable without a pointer. Heatmap values live only in SVG `<title>` tooltips. **Fix:** Add `role="button"`, conditional `tabIndex` on interactive anchor/candidate cells, an `aria-label` ("Place here, up to N points"), and `onKeyDown` triggering `clickCell` on Enter/Space; consider arrow-key navigation between candidates.

- **Segmented controls signal selection by color only, with no aria state** (`Menu.tsx:101`, `TimerSettings.tsx:21-23`, `Lobby.tsx:169`)
  Every seg control (Opponents/Players/Difficulty, timer options, host Players pill) marks the active option with just a `.on` class painting it accent-blue — no `aria-pressed`/`role="radio"`, and no non-color cue (WCAG 1.4.1 + 4.1.2 failure). The adjacent CPU-fill toggle correctly uses `role="switch"`, confirming this is an omission. **Fix:** Render options as buttons with `aria-pressed` (or wrap in `role="radiogroup"`/`radio`) and add a non-color active cue (check glyph, bold, or inset ring) in `styles.css`.

---

## Medium

### Flow

- **Menu gates "Play Online" behind a server probe, but startup ignores that gate** (`web/src/components/Menu.tsx:50`)
  The two entry points into online play apply contradictory availability rules. **Fix:** Run `pingServer()` before auto-entering online, or default to Menu so the single guarded button is the only entry; consolidate to one reachability rule.

- **Browse (room list / create / join-by-code) is hidden behind a Leave action** (`web/src/App.tsx:26`)
  `openOnline()` always quickplays, so the only way to reach the richest online surface is to be seated in a random lobby then click "← Leave room." **Fix:** Add a deliberate "Browse games" / "Join with code" Menu option, or have "Play Online" land on Browse with a prominent Quick Play button.

- **No "play again" / back-to-room after an online game ends** (`web/src/components/GameView.tsx:312`)
  Both in-game "Leave" and GameOver's "Back to menu" dispose the OnlineMatch and dump the user to the single-player Menu, tearing down room/opponents — inconsistent with the Lobby's two-action pattern. **Fix:** Offer an online-aware exit ("Back to room" via `leaveToBrowse`, or a same-room rematch) alongside "Main menu."

### Redundancy / consistency

- **Two separate "Your name" inputs (Browse vs Lobby) that don't share state and can disagree** (`Browse.tsx:31-37`, `Lobby.tsx:54-64`)
  Browse seeds `useState("")` and never persists; Lobby seeds from `loadName()` and saves. A returning user sees their name in Lobby but a blank box in Browse, and names typed in Browse silently fail to persist. **Fix:** Seed Browse from `loadName()` and `saveName()` on commit; better, hoist to one shared `<NameEditor>` source of truth. *(Consolidates the duplicate-input, empty-default, and markup-divergence findings — same root cause.)*

- **Back / leave control varies in style and label across screens** (`web/src/components/Lobby.tsx:81-82`)
  Same action appears as `.textlink` "← back"/"← menu" (lowercase), and in the Lobby footer as BOTH `.ghost` "← Leave room" and `.textlink` "Main menu" side by side, plus GameView's `.ghost` "Leave." **Fix:** Standardize one secondary-back class (e.g. `.textlink` with leading "←"), Title Case, consistent labels; don't pair two back styles in the footer.

- **Two distinct "code pill" styles for the room code** (`web/src/styles.css:99-100,173-181`)
  `.room-code-pill` (Browse, flat gray) vs `.code-pill` (Lobby, gradient + copy affordance) render the same code very differently. **Fix:** One shared room-code visual token with size variants; consider making the Browse code copyable too.

- **Three overlapping chip/row classes for the same "icon + label/value" element** (`web/src/styles.css:104-105,182-185,222-226`)
  `.rchip`, `.chip`, and `.ss-row` differ in radius (999px vs 12px), padding, and font — the same board/players info appears as a pill in one place and a rounded-rect row in another within one lobby. **Fix:** Consolidate into one Chip component (icon + optional label + value).

### Feedback

- **Create/Join give no loading or disabled feedback** (`web/src/components/Browse.tsx:60,68,75`)
  Actions just queue a WebSocket message with no pending/disabled/spinner state; buttons stay enabled when offline so clicks silently queue, and errors only surface at the top of the card. **Fix:** Track an in-flight flag (disable + "Joining…"/spinner), disable when the socket isn't open, and surface errors inline near the action.

- **Browse has no connection / empty-vs-loading distinction** (`web/src/components/Browse.tsx:46-47`)
  "No open games right now" renders identically while connecting/reconnecting, so a dropped socket looks like an empty lobby (unlike App's "Reconnecting…" and Lobby's "Finding a game…"). **Fix:** Expose a `linkState()` accessor on OnlineMatch and show "Connecting…"/"Reconnecting…" until a `rooms` reply actually arrives.

### Accessibility

- **Clock low-time warning and track/result highlights rely on color alone** (`Clock.tsx:33-40`, `styles.css:278,294,269`)
  `.clock-badge.low` is red text + a pulse that ignores `prefers-reduced-motion`; the leading counter differs only by a red glow; the badge's only name is a static `title="Time left"`. **Fix:** Add a non-color low cue (⚠ glyph / bold), gate the pulse behind `prefers-reduced-motion`, give the badge a descriptive `aria-label` with remaining time, and mark the leading counter beyond color.

- **CPU-fill toggle has no visible focus styling** (`Lobby.tsx:177`, `styles.css:239-244`)
  The borderless pill defines no `:focus-visible`, so the default ring is clipped/invisible; no `focus-visible` rule exists anywhere in the stylesheet. **Fix:** Add `.toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }` and audit seg/pill-seg/code-pill/icon buttons similarly.

- **Win/Game-over modal is not a focus-trapped dialog and isn't keyboard-dismissable** (`web/src/components/GameView.tsx:285-313`)
  Plain `<div className="overlay">` with no `role="dialog"`, aria-modal, labelling, focus move/trap, or Escape — keyboard/SR users aren't told the game ended and can tab the board behind it. **Fix:** Add `role="dialog" aria-modal="true" aria-labelledby` (win-title), move focus on mount, trap Tab, support Escape → `onLeave`.

### Responsive layout

- **Seat grid stays 2-column on phones, crushing 4-player lobby cards** (`web/src/styles.css:188`)
  `.seat-grid` is hardcoded `1fr 1fr` with no override; on a ~320-360px phone seat cards are ~150px wide, ellipsing names and wrapping tags. **Fix:** `@media (max-width: 460px) { .seat-grid { grid-template-columns: 1fr; } }`.

- **Timer option rows squeeze a 6-button `.seg.wrap` against a fixed label** (`web/src/components/TimerSettings.tsx:28`, `styles.css:119,127`)
  `.field` never becomes a column on mobile and `.seg.wrap` is pinned right, producing a lopsided right-hand 2-3-per-row stack while the left sits empty. **Fix:** `@media (max-width: 520px) { .timer-settings .field { flex-direction: column; align-items: stretch; } .timer-settings .seg.wrap { justify-content: flex-start; } }`. *(Same shared component also affects the Menu vs-CPU and Pass & Play setup screens.)*

- **Game-over results row can overflow the modal** (`web/src/styles.css:429`, `GameView.tsx:303-307`)
  `.rname` has no `min-width:0`/ellipsis and `.rdetail` lists 6 values in an auto column, so a long name + "(you)" + detail overflows the ~330px modal. **Fix:** `.rname { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }` and hide/wrap `.rdetail` at narrow widths.

- **Score-panel head can overflow the mobile strip with clock + long name** (`web/src/styles.css:475`, `ScorePanel.tsx:31-40`)
  Panels keep `min-width:208px` in the horizontal strip; `.pname` has no overflow handling, so name + away tag + clock badge + result exceeds the panel. **Fix:** Add `min-width:0`/ellipsis to `.pname`, `flex:none` on the right group; consider a scroll affordance on the strip.

---

## Low

- **Browse "Your name" box is largely dead in the default flow** (`Browse.tsx:12-21,68-69`) — the box isn't seen on the common quickplay path and is redundant with the lobby's authoritative name field. **Fix:** Drop it (rely on the lobby) or at least remove the divergent local default.
- **"Create a game" hardcodes create() args the lobby immediately overrides** (`Browse.tsx:19-21`) — `aiLevel=1`, `DEFAULT_TIMER`, etc. are sent then overwritten; `cpuSeats`/`aiLevel` are never configurable online at all. **Fix:** Add `OnlineMatch.createDefault(name)` and trim the dead create fields.
- **Board-size stepper duplicated between Menu and Lobby** (`Lobby.tsx:189-195`, `Menu.tsx:84-89`) — same clamp/label logic copied twice, already drifted (Menu shows the "(standard/+N)" em label, Lobby doesn't). **Fix:** Extract a shared `<BoardSizeStepper>`. *(TimerSettings is already correctly shared; only the stepper remains.)*
- **Dead export `defaultBoardRadius()`** (`web/src/board.ts:9-11`) — never imported; callers use `STANDARD_RADIUS`. **Fix:** Delete it.
- **Dead OnlineMatch methods `roomCode()` and `inGame()`** (`web/src/match/OnlineMatch.ts:91,110`) — never called; `phase()`/`lobby()`/`snapshot()` cover the state. **Fix:** Remove both.
- **In-game "Leave" instantly abandons an online game with no confirmation** (`GameView.tsx:189`) — one mis-click sends `{t:"leave"}` and `clearSession()`, irrevocably forfeiting the seat. **Fix:** Confirm before leaving an in-progress online game, or split non-destructive "menu" from destructive "resign."
- **Two different button styles for the same "Join" action** (`Browse.tsx:60,75`) — room-list Join is `.primary`, code Join is `.ghost`. **Fix:** Use one treatment for "Join."
- **Inconsistent text casing on buttons/headers** (`Menu.tsx:119,129`) — "← back"/"⟳ refresh" (lowercase) vs "Start game"/"Join" (sentence case); double space in Lobby's "▶  Start game" (`Lobby.tsx:73`). **Fix:** Adopt one convention (sentence case) everywhere; fix the double space.
- **Segmented-control pattern re-implemented 4+ ways** (`Menu.tsx:97-105`) — a `Seg` exists but Difficulty, timer, and host Players hand-roll it; `pill-seg`/`seg.wrap` variants already diverge. **Fix:** Promote `Seg` to a shared generic component.
- **Inconsistent icon glyphs for the same concept** (`GameView.tsx:179-180`) — three rotational glyphs (⟳/⟲/↶), shopping-bag 🛍 for the tile bag, ⬡ vs "hexes." **Fix:** One icon-mapping module, one glyph per concept.
- **CPU seat labeled/iconified inconsistently** (`Lobby.tsx:135`) — "Computer" vs "CPU" vs 🤖 across Menu, seat card, toggle, chip, scoreboard. **Fix:** One term + one icon everywhere.
- **Duration formatted three ways with no shared helper** (`TimerSettings.tsx:63-67`) — "5m+5s" config vs "⏱ 5:00" badge vs "30s"/"5m" buttons. **Fix:** Centralize duration formatting.
- **Card surface styling duplicated with slightly different values** (`styles.css:96-98,190-192,66-70`) — `.room-card`/`.seat-card`/`.bigchoice` redefine near-equal gradient/border/shadow. **Fix:** Extract a shared `.card` base or CSS custom properties.
- **Inconsistent header/logo treatment across menu-card screens** (`Browse.tsx:27`) — brand `.logo` gradient reused for the "Play Online" title; Lobby uses an eyebrow; error path a bare `<h2>`. **Fix:** Reserve `.logo` for the wordmark; add one shared screen-title element.
- **Empty/placeholder states styled inconsistently** (`Chat.tsx:35`) — dashed-box `.empty-rooms` vs italic `.chat-empty` vs bare-`<p>` loading splashes. **Fix:** Shared empty-state and loading-splash treatments.
- **Refresh button gives no feedback** (`Browse.tsx:44`) — `match.refresh()` updates silently. **Fix:** Spin the ⟳ / disable briefly, or show "Updated just now."
- **Rack reordering is drag-only** (`Tiles.tsx:82-86`) — no keyboard/touch path. **Fix:** Cosmetic feature; add arrow-key/move-handle or small reorder buttons, or document as optional.
- **Auto-pass announced only in transient hint text** (`GameView.tsx:161-171,240`) — `.turn-hint` is not an aria-live region, so auto-pass/rejection reasons aren't announced. **Fix:** Wrap the hint in `aria-live="polite"`; consider a brief toast.
- **Topbar icon-only controls rely on `title` alone** (`GameView.tsx:179-188`) — bag 🛍, undo ↶, mute, chat 💬 have no `aria-label`; unread badge is visual-only. **Fix:** Add explicit `aria-label`s; expose bag count and toggle state via aria.
- **Chat drawer overlays the board with no scrim/board lock on small screens** (`styles.css:369`, `GameView.tsx:251-259`) — ~331px drawer leaves the board a clickable sliver; only the small ✕ dismisses. **Fix:** Full-width on narrow screens + a tap-to-dismiss scrim.
- **Bottom bar rack + hint + actions wrap unpredictably under 820px** (`styles.css:302-311,478`, `GameView.tsx:232-249`) — the variable-length hint lands between rack and Swap, making the primary action jump between turns. **Fix:** Put `.rack` on its own row and keep hint + actions together (or move the hint above the rack).

---

## Nits

- **`Match.pass()` is in the interface and implemented but never invoked from the UI** (`web/src/match/types.ts:65`) — passing is always automatic. **Fix:** Drop `pass()` from the interface and both impls (keep internal `applyPass`), or wire a manual pass button.
- **ClockBadge maintains two parallel notions of "running"** (`Clock.tsx:23-40`) — `active` prop drives the CSS class while `isRunning` (from `clock.running`) drives the tick/low cue; they can momentarily disagree. **Fix:** Derive running/visual state solely from `clock.running`.
- **Lobby name commits silently with no save confirmation** (`Lobby.tsx:54-64`) — rename on blur/Enter shows no inline cue, unlike the room-code copy's "✓ copied." **Fix:** Show a brief "saved" check or visually tie the field to the updating seat card.