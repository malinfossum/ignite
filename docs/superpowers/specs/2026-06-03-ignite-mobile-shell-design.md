# Mobile shell — drawer + pinned capture — design spec

**Date:** 2026-06-03
**Phase:** v0.2 (mobile UX — first of the mobile / PWA / Pages trio)
**Goal:** Make Ignite genuinely usable on a phone. Replace the v0.1 raw vertical stack (sidebar full-width *above* main, no nav) with a real mobile shell: a **pinned bottom capture bar**, a **full-screen task list**, and an **off-canvas drawer** (the existing sidebar) opened from a slim top bar. **Desktop is unchanged.**

This is a **layout + navigation** change, not a feature change. It adds one small view (`topbar.js`), a transient drawer-open flag + behavior in the controller, two shell elements, and a mobile-first CSS pass. It **reuses the entire `#sidebar` view as-is** — the drawer is the sidebar *repositioned* by CSS, not a new component.

**Settled scope decisions (from brainstorm 2026-06-03):**
- **Capture is the priority** — "the *What's next?* box should always be one tap away." → capture is **pinned to the bottom of the viewport** on mobile. (Review and area-switching are secondary but must both work.)
- **Approach A — left off-canvas drawer** (chosen over B bottom-tab-bar and C title-sheet). The drawer is the existing sidebar; it holds Today, all areas + counts, ＋ New area, and the ⋯ menus.
- **Top bar shows the "Ignite" wordmark** (taps → Today as a one-tap home shortcut) next to the ☰ button. No current-view name in the bar (orientation comes from the content: the area view's own title; Today is self-evident).
- **Desktop (`≥768px`) is untouched** — same 2-column grid, same collapse-to-rail toggle, capture stays inline at the top.

---

## Approach

**Approach A (selected): left off-canvas drawer + pinned bottom capture.**
On phones the layout becomes three bands — a slim **top bar** (☰ + "Ignite"), a **scrollable task list**, and a **pinned capture bar** at the very bottom. The `#sidebar` is moved off-screen to the left (`translateX(-100%)`); tapping ☰ slides it in over a dimmed **scrim**. Picking an area, tapping the scrim, or pressing Esc closes it. Everything behind the drawer is made **`inert`** while it's open (clean focus containment + AT scoping, no manual Tab-trap).

**Why A:** it serves all three needs at once (capture pinned, tasks front-and-centre for review, every area reachable) and **re-homes the sidebar Malin already built** instead of inventing a new component. Areas are user-created and unbounded, which rules out a fixed tab bar.

**Rejected — Approach B (bottom tab bar):** a fixed Today / Areas / Add tab row claims the bottom of the screen, demoting capture from a pinned field to a tap-away tab — directly against the "always one tap away" priority. Unbounded areas still need a separate sheet, so B ends up needing a drawer/sheet *anyway*.

**Rejected — Approach C (title-tap sheet):** least chrome, but the area switcher is hidden behind a title tap (poor discoverability) and a bottom sheet is a brand-new component rather than a reuse of the sidebar.

---

## Architecture

| Layer | Change |
|---|---|
| **Model** | **No changes.** Drawer-open is throwaway UI state, not saved data — it does **not** become a model field (contrast `settings.sidebarCollapsed`, which *is* persisted). |
| **Shell — `index.html`** | Add two body-level elements: `<header id="topbar"></header>` (before `#sidebar`) and `<div id="scrim" hidden></div>` (after `#main`). The scrim is a **body-level sibling of `#main`** on purpose — it must stay clickable while `#main` is `inert` (see a11y). Also extend the viewport meta to `width=device-width, initial-scale=1.0, interactive-widget=resizes-content` so the on-screen keyboard shrinks the layout viewport (keeps the pinned capture bar visible — see Layout & CSS). |
| **View — `topbar.js`** (**new file**) | `createTopbarView(rootEl, { onToggleDrawer, onGoToday }) → { setExpanded(open), destroy() }`. **Render-once** (like `capture.js`) — its content is static (☰ + "Ignite"), so it never re-renders from state. `setExpanded(bool)` flips the ☰'s `aria-expanded`. Forwards `toggle-drawer` / `go-today` via `data-action` + `bindActions`. No logic. |
| **View — `sidebar.js`** | **One small addition:** a new `onCloseDrawer` callback, called at the **tail of the existing Esc handler** (after the rename / menu branches `return`). Everything else — menu/rename closure state, `isRendering`, focus flags, doc handlers — is **unchanged**. |
| **Controller — `controller.js`** | Owns a transient `drawerOpen` boolean and toggles `body.is-drawer-open` — mirroring how it already toggles `is-sidebar-collapsed` / `is-area-route` (controller.js:59–66). Adds `openDrawer()` / `closeDrawer()` (body class, scrim `hidden`, `inert` on background, focus in/return, `topbar.setExpanded`). Mounts + destroys the topbar. Wires: topbar `onToggleDrawer`/`onGoToday`, sidebar `onCloseDrawer` + closing the drawer inside the existing `onOpenArea`/`onGoToday`, a scrim click handler, and a `matchMedia('(min-width:768px)')` listener that closes the drawer on desktop crossover. |
| **App wiring — `app.js`** | Grab `#topbar`, `#scrim`, and `#main` (the `inert` target, distinct from the existing `#main-root`) and pass them in `els` alongside the existing roots (app.js:30–39). ~4 lines. |
| **CSS — `main.css`** | Mobile-first pass: top bar, off-canvas drawer + slide transition, scrim, **capture pinned to bottom**, toast lifted above capture, scroll-lock, plus `@media (min-width:768px)` overrides that restore today's desktop layout exactly. Respects `prefers-reduced-motion`. **`base.css` and `design-system/` are untouched.** |

---

## Layout & CSS

### Mobile baseline (`<768px`) — the new default

```
 default                         drawer open
┌──────────────────┐          ┌──────────────────┐
│ ☰   Ignite        │ #topbar  │▓ Ignite       ░░░│  #sidebar slid in
├──────────────────┤  sticky  │▓ ⌂ Today      ░░░│  over #scrim;
│ ☑ task            │          │▓ • Work    3  ░░░│  #topbar + #main
│ ☐ task            │ #main    │▓ • Home    1  ░░░│  + #toast-root are
│ ☐ task            │ scrolls  │▓ ＋ New area  ░░░│  inert + dimmed
│        ⋮          │          │▓              ░░░│
├──────────────────┤          │▓              ░░░│  ▓ = drawer
│ ＋ What's next?   │ #capture │▓░░░░░░░░░░░░░░░░░│  ░ = scrim
└──────────────────┘  pinned   └──────────────────┘     (tap = close)
```

- **`#topbar`** — `position: sticky; top: 0`; holds the ☰ button and the "Ignite" wordmark button — **both ≥44×44px touch targets**.
- **`#sidebar`** (the drawer) — `position: fixed; inset-block: 0; inset-inline-start: 0; transform: translateX(-100%); visibility: hidden; transition: transform 200ms ease, visibility 200ms;`. `body.is-drawer-open #sidebar { transform: none; visibility: visible }`. Width ~`min(80vw, 300px)`. **`visibility: hidden` is load-bearing, not cosmetic:** a transform-only off-screen drawer stays in the tab order + AT tree — `visibility: hidden` removes it from both, and (going to `visible` immediately on open / delayed to end on close) it transitions cleanly alongside the slide.
- **`#scrim`** — `position: fixed; inset: 0; background: rgba(0,0,0,.5)`, shown when `body.is-drawer-open` (the controller toggles its `hidden` attribute). Fades via opacity; below the drawer, above everything else.
- **`#capture-root`** — `position: fixed; inset-inline: 0; bottom: 0`, with a solid background + `border-top`. `#main` (or `#main-root`) gets `padding-block-end` = capture height so the last task clears it.
  - **Keyboard caveat (the #1 use case):** a `position: fixed; bottom: 0` input is anchored to the *layout* viewport, so on Android Chrome the on-screen keyboard overlays it by default — the focused capture bar can sit behind the keyboard. Mitigation: the `interactive-widget=resizes-content` viewport meta (above) makes the keyboard shrink the layout viewport so the bar rides above it. **Must be verified with the keyboard up on a real/emulated phone.**
  - **Grid-rows fallback / preferred path:** if `interactive-widget` doesn't fully solve the overlap, restructure the mobile layout as a CSS grid with rows `[topbar auto][scroll 1fr][capture auto]` — the task list scrolls and capture is a normal-flow bottom row (not `position: fixed`). This also fixes the focus-order mismatch (below), since capture is no longer DOM-first. Adopt grid-rows if the keyboard test fails; otherwise the simpler fixed-position approach stands.
- **`#toast-root`** — on mobile its `bottom` lifts to clear the capture bar (currently `bottom: 1rem`, main.css:303). Use a shared spacing value so the toast floats just above capture.
- **Scroll-lock** — `body.is-drawer-open { overflow: hidden }`.
- **Z-order** — content/topbar/capture < scrim < drawer < toast.
- **Reduced motion** — `@media (prefers-reduced-motion: reduce)` disables the drawer/scrim transitions (matches the existing chevron rule, main.css:621–625).

### Desktop / tablet (`@media (min-width: 768px)`) — unchanged behavior

- `#topbar { display: none }`, `#scrim { display: none }`.
- `#sidebar` returns to a static grid column: `position: static; transform: none; visibility: visible` — the existing 2-column grid (main.css:52–58) and collapse-to-rail toggle work exactly as today.
- `#capture-root { position: static }` — capture is inline at the top of `#main` again.
- `body.is-drawer-open` is inert at this width (drawer state is cleared by the matchMedia listener on crossover, so scroll-lock can't linger).

Mobile-first is preserved: the drawer/pinned-capture is the **baseline**, desktop is the `min-width` layer-up. **No `max-width` queries.**

---

## View — `topbar.js` (new)

```js
// createTopbarView(rootEl, { onToggleDrawer, onGoToday }) → { setExpanded(open), destroy() }
// Render-once (mirrors capture.js): static content, never re-renders from state.
// setExpanded(bool) reflects drawer state on the ☰ button's aria-expanded.
```

Rendered markup (once):

```html
<button class="topbar__menu" type="button"
  data-action="toggle-drawer"
  aria-label="Open menu" aria-expanded="false" aria-controls="sidebar">☰</button>
<button class="topbar__wordmark" type="button" data-action="go-today">Ignite</button>
```

- Content is **static** ("Ignite", "☰") — no user data, **no `escapeHtml` needed**.
- The wordmark is a **home shortcut** (→ Today). It deliberately does **not** show an `is-active` state (the drawer already shows the active route); keeping it stateless is why the topbar can render once.
- `setExpanded(open)` sets `aria-expanded` to `"true"`/`"false"` on `.topbar__menu`. Called by the controller's `openDrawer`/`closeDrawer`.

---

## Controller — drawer behavior

New transient state + helpers (no model involvement):

```js
let drawerOpen = false;

function openDrawer() {
  if (drawerOpen) return;
  drawerOpen = true;
  document.body.classList.add("is-drawer-open"); // CSS: slide in + scroll-lock
  scrimEl.hidden = false;
  topbar.setExpanded(true);                       // ☰ aria-expanded="true"
  // Modal dialog semantics (controller-set, so sidebar.js stays unchanged;
  // openDrawer only ever runs on mobile, so these never exist on desktop).
  sidebarRoot.setAttribute("role", "dialog");
  sidebarRoot.setAttribute("aria-modal", "true");
  sidebarRoot.setAttribute("aria-label", "Navigation");
  // Background becomes inert → focus is contained in the drawer, AT ignores it.
  for (const el of [topbarRoot, mainEl, toastRoot]) el.inert = true;
  // Move focus into the drawer (first focusable: the "Ignite" home button).
  sidebarRoot.querySelector(".sidebar__home")?.focus();
}

function closeDrawer() {
  if (!drawerOpen) return;
  drawerOpen = false;
  document.body.classList.remove("is-drawer-open");
  scrimEl.hidden = true;
  for (const el of [topbarRoot, mainEl, toastRoot]) el.inert = false;
  for (const attr of ["role", "aria-modal", "aria-label"]) sidebarRoot.removeAttribute(attr);
  topbar.setExpanded(false);
  // Return focus to the ☰ trigger (DOM lookup, not a stale ref — the topbar is render-once).
  topbarRoot.querySelector(".topbar__menu")?.focus();
}
```

Wiring in `start()`:
- **topbar** mounted with `onToggleDrawer: () => (drawerOpen ? closeDrawer() : openDrawer())` and `onGoToday: () => { window.location.hash = "#today"; closeDrawer(); }`.
- **sidebar** — extend the two existing nav callbacks to close the drawer: `onGoToday` (controller.js:427–429) and `onOpenArea` (430–432) each call `closeDrawer()` after setting the hash. Add `onCloseDrawer: () => closeDrawer()` (no-op when already closed / on desktop).
- **scrim** — `scrimEl.addEventListener("click", closeDrawer)`.
- **matchMedia** — `const mq = matchMedia("(min-width: 768px)"); mq.addEventListener("change", e => { if (e.matches) closeDrawer(); });` so crossing to desktop clears `is-drawer-open` (and thus the scroll-lock + inert).
- **`onHashChange`** — call `closeDrawer()` at the top of the existing `onHashChange` (controller.js:411–415). It's the single choke point for *all* route changes, so it also catches **browser back/forward** (which don't go through the nav callbacks). Idempotent/guarded → harmless when already closed. Keep the explicit `closeDrawer()` in the topbar's `onGoToday` too, since tapping "Ignite" while already on `#today` is a same-hash no-op that never fires `hashchange`.
- `stop()`/teardown **calls `closeDrawer()` first** (clears `is-drawer-open`, the `inert` flags, scroll-lock, and the dialog ARIA in one place), then removes the scrim + matchMedia listeners, destroys the topbar, and clears `drawerOpen`.

### Escape — extend the sidebar's existing handler (precedence preserved)

The sidebar already owns Esc precedence for its menus/rename (sidebar.js docKeyHandler). Add the drawer-close as the **fall-through**, so one Esc never both closes a menu *and* the drawer:

```js
// sidebar.js docKeyHandler, Escape block:
if (event.key === "Escape") {
  if (renamingAreaId) { cancelRename(); return; }
  if (openAreaMenuId) { closeMenu(); return; }
  onCloseDrawer?.();   // nothing internal consumed Esc → ask controller to close the drawer
  return;
}
```

The controller's `onCloseDrawer` no-ops unless `drawerOpen`, so this is inert on desktop and when the drawer is shut. *(Rejected alternative: a controller-side Esc handler that DOM-probes `#sidebar [role=menu]` to decide precedence — fragile, because the sidebar's synchronous `closeMenu()` re-render removes the menu from the DOM before the probe runs, and listener execution order would decide the outcome. Threading the fall-through through the sidebar's own handler is order-independent and reuses the precedence already there.)*

---

## Accessibility

- **`inert` on the background** (`#topbar`, `#main`, `#toast-root`) while the drawer is open: focus cannot leave the drawer (no manual focus-trap keydown handler needed) and assistive tech ignores the dimmed content. Removed on close. *(Baseline support: Chrome/Edge ≥102, Firefox ≥112, Safari ≥15.5 — all current in 2026.)*
- **Modal dialog semantics:** while open, the controller sets `role="dialog"`, `aria-modal="true"`, and `aria-label="Navigation"` on the drawer (cleared on close), so SR users are told they're in a *named modal overlay* (the `inert` background alone wouldn't announce it). Controller-set on `sidebarRoot`, so `sidebar.js` is untouched (invariant #4 holds).
- **Closed drawer is removed from tab order + AT** via `visibility: hidden` on mobile (see Layout & CSS / invariant #12) — a transform-only off-screen drawer would otherwise stay focusable and screen-reader-readable while invisible.
- **Focus in on open** → first focusable in the drawer (the "Ignite"/Today button). **Focus return on close** → the ☰ trigger, via DOM lookup (the topbar is render-once, so no stale-ref hazard).
- **☰** carries `aria-label="Open menu"`, `aria-expanded` (kept in sync), `aria-controls="sidebar"`. **Touch targets ≥44px** on ☰ and the wordmark (drawer area rows are already ≥44px, main.css:604).
- **Dismissal**: scrim tap, Esc, picking an area, or tapping Today — all close the drawer (ARIA APG dialog dismissal expectations).
- **Scroll-lock** prevents background scroll behind the drawer.
- The existing sidebar a11y (roles, arrow-key menu nav, `aria-current`) is unchanged inside the drawer.
- **Reading / focus order (accepted trade-off):** `#capture-root` is DOM-first in `#main` (app.js:21–24), so on mobile the tab/reading order is *capture → task list* while the visual order is *task list → capture* (capture is CSS-pinned to the bottom). This is a *named* accepted trade-off — capture is the primary action and the order matches desktop (capture-on-top). The grid-rows fallback (Layout & CSS) makes capture DOM-last *and* visually bottom, removing the mismatch; adopt it if grid-rows is taken for the keyboard fix.

---

## Edge cases

| Scenario | Behavior |
|---|---|
| Open drawer, tap an area | Navigates (`#area/<id>`) **and** closes the drawer (controller `onOpenArea`). |
| Open drawer, tap "Ignite" / Today | Navigates to `#today` and closes the drawer. |
| Open drawer, tap the scrim | Closes the drawer; focus returns to ☰. |
| Open drawer, press Esc | Closes the drawer (after any open ⋯ menu / rename is handled first). |
| Open an area ⋯ menu **inside** the drawer, then Esc | First Esc closes the menu (sidebar handler), second Esc closes the drawer. |
| Rename an area inside the drawer | Works unchanged (sidebar rename machinery intact); Esc cancels rename before it closes the drawer. |
| Rotate / resize phone → desktop width with drawer open | matchMedia `change` fires → `closeDrawer()` clears `is-drawer-open`, scroll-lock, and `inert`; desktop grid shows normally. |
| Capture while drawer open | `#main` (containing capture) is `inert` + behind the scrim → not interactable until the drawer closes (correct). |
| Toast appears while drawer open | `#toast-root` is `inert` while open; it's usable again on close. |
| Last task hidden behind pinned capture | `#main` has `padding-block-end` = capture height so the final row clears it. |
| Long area list in the drawer | Drawer scrolls internally (it's a fixed-height panel); background stays scroll-locked. |
| Desktop unchanged | Top bar + scrim are `display:none`; sidebar is a static grid column; collapse-to-rail still works; capture inline at top. |
| `prefers-reduced-motion` | Drawer/scrim appear without the slide/fade transition. |
| 60s tick fires while the drawer is open | The sidebar re-renders (innerHTML); focus on a plain area row can drop to `<body>`. The `inert` background keeps focus off content controls, and Tab re-enters the drawer. Rare (the drawer is open only briefly). Full focus-restore-across-ticks is out of scope (see below). |

---

## Invariants (do NOT simplify away)

1. **Mobile-first, no `max-width` queries.** The drawer + pinned-capture is the CSS **baseline**; desktop is the `@media (min-width: 768px)` layer-up. (CLAUDE.md mobile-first rule.)
2. **Desktop is byte-for-byte behavior-unchanged** — 2-column grid, collapse-to-rail, inline-top capture. The mobile work only *adds* baseline rules + overrides them at `≥768px`.
3. **`is-drawer-open` is controller-owned + transient** — a `body` class + a closure boolean, **not** a model field and **not** persisted (mirrors `is-area-route`). Do not route it through the settings model.
4. **The `#sidebar` view is reused unchanged** except for the single `onCloseDrawer` Esc tail. Do not fork a separate "mobile sidebar".
5. **`topbar.js` is render-once** (mirrors `capture.js`) with one imperative `setExpanded` — it must not re-render on every `applyState`/60s tick (that would churn the ☰ and risk focus loss).
6. **Focus return uses a DOM lookup, never a stored element ref** (project-wide rule — refs go stale across re-renders; the topbar happens to be stable, but the lookup keeps the pattern consistent).
7. **Background `inert` is the focus-containment mechanism** — keep it rather than hand-rolling a Tab-trap. Set on `#topbar` + `#main` + `#toast-root`; always cleared on close.
8. **The `#scrim` is a body-level sibling of `#main`** (NOT inside it) — otherwise it'd be `inert` and un-tappable while open.
9. **matchMedia closes the drawer on desktop crossover** — without it, an open-drawer resize leaves scroll-lock + inert stuck on a desktop layout.
10. **Esc precedence is preserved** by threading drawer-close through the sidebar's existing handler tail — not a competing document handler.
11. **`base.css` and `design-system/` are untouched.** All CSS lands in `main.css`.
12. **The closed drawer is `visibility: hidden` on mobile** (not just transformed off-screen) — a transform-only hide leaves it in the tab order + AT tree. Restored to `visible` under `body.is-drawer-open` and at `≥768px`.
13. **Dialog ARIA is controller-set, not in `sidebar.js`** — `role="dialog"` + `aria-modal="true"` + `aria-label="Navigation"` are added in `openDrawer` and removed in `closeDrawer`; they only ever exist on mobile (`openDrawer` never runs on desktop).
14. **All route changes close the drawer via `onHashChange`** (not only the nav callbacks) — covers browser back/forward; `stop()` also closes it so teardown can't strand `inert` / scroll-lock.

---

## Files touched (estimated)

| File | LOC | Note |
|---|---|---|
| `index.html` | +2 | `#topbar` + `#scrim` shell elements; extend viewport meta (`interactive-widget=resizes-content`) |
| `src/views/topbar.js` | +35 | **new** — render-once view + `setExpanded` |
| `src/views/sidebar.js` | +3 | `onCloseDrawer` param + Esc-tail call |
| `src/controller.js` | +64 | `drawerOpen`, open/close (+ dialog ARIA), scrim + matchMedia + `onHashChange` close + topbar mount/teardown, wiring |
| `src/app.js` | +4 | grab + pass `#topbar` / `#scrim` / `#main` (inert target) in `els` |
| `main.css` *(repo root)* | +98 | top bar, drawer + transition + closed-state `visibility`, scrim, pinned capture, toast lift, scroll-lock, desktop overrides, reduced-motion |
| **Total** | **~206** | **0 new unit tests** (no new pure logic) — 134 existing stay green |

---

## Testing

### Unit (Vitest)
- **None new.** This work is CSS + DOM behavior; there's no new pure function. If a focus/util helper emerges during planning, TDD it (and consider reusing `src/utils/menu-keyboard.js`). The existing 134 tests must stay green (no model/util changes).

### Manual / Claude Preview MCP E2E (at 375px, plus a desktop regression pass)
- **Pinned capture:** at 375px the "What's next?" field sits at the bottom and stays put while the task list scrolls; capturing a task works and the list updates.
- **Capture with keyboard up (the #1 use case):** focus capture on a real/emulated phone — the field stays visible above the on-screen keyboard (verifies `interactive-widget=resizes-content`). If it's hidden behind the keyboard, switch to the grid-rows layout.
- **Drawer open/close:** ☰ slides the sidebar in over the scrim; scrim tap closes; Esc closes; focus moves into the drawer on open and back to ☰ on close.
- **Navigate from drawer:** tap an area → navigates + drawer closes; tap "Ignite" → Today + closes.
- **Esc precedence:** open an area ⋯ menu in the drawer → first Esc closes the menu, second closes the drawer.
- **Rename in drawer:** rename an area inside the drawer; Esc cancels rename (doesn't close the drawer) first.
- **inert / focus containment:** while open, Tab stays within the drawer; capture + content are not focusable.
- **Closed drawer not reachable:** at 375px with the drawer closed, Tab from `☰` reaches the capture/task content, NOT the (off-screen) drawer items; a screen reader doesn't announce the hidden drawer.
- **Back/forward:** open the drawer, press the browser Back button → the drawer closes (no stuck scrim / scroll-lock over the new view).
- **Dialog semantics:** with the drawer open, a screen reader announces a "Navigation" dialog; `role`/`aria-modal`/`aria-label` are gone again after close.
- **Crossover:** open the drawer at 375px, resize to ≥768px → drawer state clears, desktop grid intact, no stuck scroll-lock.
- **Desktop regression:** at ≥1024px the layout is identical to v0.1 — grid, collapse-to-rail, inline-top capture; top bar + scrim absent.
- **Reduced motion:** with the OS setting on, the drawer appears without transition.
- **No console errors throughout.**
- Final gate: `npm test` green · Biome clean · `npm run build` clean.

---

## Out of scope (later v0.2 items / refinements)

- **PWA** (manifest + service worker, installable + offline) — the next v0.2 item; needs HTTPS hosting.
- **GitHub Pages hosting** (Vite `base: '/ignite/'`, the hardcoded `/base.css` + `/main.css` paths) — the third v0.2 item.
- **Swipe-to-open/close** the drawer (touch gesture) — taps only for v1.
- **iOS Safari rubber-band scroll-lock edge cases** (`position: fixed` body technique) — `overflow:hidden` is sufficient for the curriculum bar; revisit if it misbehaves on a real device.
- **Restoring drawer focus across a 60s tick re-render** — the sidebar's focus flags cover its menu/rename ops, not plain navigation focus; a tick while the drawer is open can drop focus to `<body>` (`inert` keeps it off background controls; Tab re-enters). Pre-existing sidebar re-render behavior; not solved here.
- **Bottom-nav or title-sheet** switchers — explicitly rejected above.
- **Notch / home-indicator safe areas** (`env(safe-area-inset-bottom)` padding on the capture bar) — a polish follow-up; cheap to fold in during planning if it helps on notched devices. *(The keyboard-overlap problem is now **in scope** — see the capture keyboard caveat in Layout & CSS.)*
- **`_rename.js` helper extraction** — unrelated refactor.

## Plan-phase flags (notes for the plan-writer)

- **CSS path** — the project's styles live in the repo-root `main.css` (served as `/main.css`); there is no `src/styles/` directory. All CSS lands there.
- **`inert` reflected property** — set via `el.inert = true/false` (the IDL attribute); verify the target browsers in scope. Provide no polyfill (baseline support is fine for 2026); note it if the curriculum targets older browsers.
- **Capture height for `padding-block-end` + toast lift** — derive from one shared value (a CSS custom property like `--capture-h`) so the main bottom-padding and the toast `bottom` can't drift. Consider `safe-area-inset-bottom`.
- **`#scrim` toggling** — `hidden` attribute vs a CSS class driven by `body.is-drawer-open`. Picking the class route means the controller needn't touch `scrim.hidden`; either is fine — choose one and keep it consistent with how `is-drawer-open` already drives the slide.
- **Topbar mount point** — `app.js` must fetch `#topbar`/`#scrim` and pass them; mirror the existing `els` object (app.js:30–39). Decide render-into-`#topbar` (recommended) vs. dynamic creation like `#toast-root`.
- **Desktop grid with 4 body children** — `#topbar` + `#scrim` are extra grid items; at `≥768px` both are `display:none` (removed from grid flow) so `#sidebar` + `#main` still fill the two columns. Verify no blank grid track.
- **Stress-test:** done (2026-06-03) — see "Stress-test outcome" below; all 7 findings folded in. Ready for `writing-plans`.

---

## Stress-test outcome (2026-06-03)

4-lens pass (security / privacy / accessibility / loopholes): **0 🔴, 2 🟠, 5 🟡 — converged in one pass; all 7 findings folded inline above.**
- **Security ✅ + Privacy ✅** clean — static topbar, no new user-input → `innerHTML` boundary, no new network/telemetry; the drawer reuses `sidebar.js`'s existing `escapeHtml`.
- **🟠 ×2:** closed off-canvas drawer left in the tab order + AT (→ `visibility: hidden` when closed, invariant #12); pinned capture hidden behind the mobile keyboard (→ `interactive-widget=resizes-content` viewport meta + keyboard-up E2E + grid-rows fallback).
- **🟡 ×5:** capture-first reading-order mismatch (documented as an accepted trade-off); drawer left open on browser back/forward (→ `closeDrawer()` in `onHashChange`, invariant #14); teardown stranding `inert`/scroll-lock (→ `stop()` closes the drawer first); missing dialog semantics (→ controller-set `role="dialog"` / `aria-modal` / `aria-label`, invariant #13); wordmark touch target unsized (→ both topbar buttons ≥44px).
- **Considered and rejected:** scrim-tap closing both an open menu + the drawer (dismiss-all is correct); no ✕ close button (scrim/Esc suffice); first-focus on the Today button; focus returns to ☰ not capture; `is-sidebar-collapsed` is desktop-only so it can't affect the mobile drawer; `inert` graceful degradation on pre-2022 browsers.

No open questions.
