# Mobile Shell (drawer + pinned capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ignite usable on a phone — replace the v0.1 raw vertical stack with a real mobile shell: a slim top bar (☰ + "Ignite"), a full-screen scrollable task list, a pinned bottom capture bar, and the existing sidebar re-homed as an off-canvas drawer. Desktop is unchanged.

**Architecture:** Layout + navigation only — no model changes. Adds one render-once view (`topbar.js`), two shell elements (`#topbar`, `#scrim`), a transient controller-owned `drawerOpen` flag with open/close behavior (body class + `inert` + dialog ARIA + focus management), a single `onCloseDrawer` Esc tail in the sidebar, and a mobile-first CSS pass. The drawer **is** the existing `#sidebar` repositioned by CSS — not a new component. Desktop is restored byte-for-byte via `@media (min-width: 768px)` overrides.

**Tech Stack:** Vanilla JS (MVC), Vite, Biome, Vitest. CSS lives in repo-root `main.css` (served as `/main.css`); there is no `src/styles/`. `base.css` and `design-system/` are untouched.

**Source spec:** [`docs/superpowers/specs/2026-06-03-ignite-mobile-shell-design.md`](../specs/2026-06-03-ignite-mobile-shell-design.md) (Approach A, 4-lens stress-tested, 0🔴).

---

## Conventions for this plan

- **Commits:** Each task ends with a **proposed commit** (message + staged files). Per project convention, **Malin commits via GitHub Desktop** — the executor stages/proposes but does not run `git commit`, and **never** adds a `Co-Authored-By` trailer. Pause for Malin between tasks.
- **No TDD here — by design.** Project rule: TDD only on the pure-function seam (`utils/`, model reorder helpers); views are verified manually. This work is **CSS + DOM behavior with zero new pure functions**, so there are **no new unit tests**. The existing **134 tests must stay green** throughout (no model/util changes). Verification is the Claude Preview MCP E2E pass in Task 7. This overrides the writing-plans skill's default TDD rhythm, per the instruction hierarchy (user convention > skill default).
- **Verification commands:** `npm run test:run` (one-shot Vitest), `npm run check` (Biome lint+format check), `npm run build` (Vite build). The Stop hook also runs `npm test` automatically.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `index.html` | Modify | Add `#topbar` (before `#sidebar`) + `#scrim` (after `#main`); extend viewport meta with `interactive-widget=resizes-content`. |
| `src/views/topbar.js` | **Create** | Render-once view: ☰ + "Ignite" wordmark. Exposes `setExpanded(open)` + `destroy()`. No state, no re-render. |
| `src/app.js` | Modify | Grab `#topbar` / `#scrim` / `#main`; pass `topbarRoot` / `scrimEl` / `mainEl` in `els`. |
| `src/views/sidebar.js` | Modify | Add `onCloseDrawer` param + a single Esc-tail call. Everything else unchanged. |
| `src/controller.js` | Modify | Own `drawerOpen`; `openDrawer()` / `closeDrawer()` (body class, `inert`, dialog ARIA, focus); mount/teardown topbar; wire scrim, matchMedia, `onHashChange` close, sidebar/topbar nav callbacks. |
| `main.css` | Modify | Mobile-first baseline (top bar, off-canvas drawer, scrim, pinned capture, toast lift, scroll-lock) + `@media (min-width: 768px)` desktop restore + reduced-motion. |

**Build order rationale:** shell DOM first (Task 1), then the standalone view (Task 2), then the two small "prep" edits that Task 5 consumes (Tasks 3–4), then the controller that wires it all (Task 5), then the CSS that makes it visible/behave (Task 6), then the full E2E + gate (Task 7). Each task builds clean and keeps the 134 tests green; desktop is unaffected at every intermediate step (top bar + scrim are `display:none` and the sidebar is a static grid column at ≥768px).

---

## Two design decisions locked at plan time (sanctioned by the spec's plan-phase flags)

1. **Scrim uses the CSS-class route, NOT the `hidden` attribute.** The spec's illustrative controller code sets `scrimEl.hidden`, but the plan-phase flag (`#scrim toggling`) explicitly permits either. We choose the class route so the scrim can **fade via opacity** (a `[hidden]` → `display:none` element can't transition) and so `body.is-drawer-open` is the **single source of truth** for the whole drawer (slide + scrim + scroll-lock + inert). Consequences: the scrim ships **without** a `hidden` attribute (Task 1), the controller **does not** touch `scrimEl.hidden` (Task 5), and the scrim's resting state lives in CSS (`opacity:0; visibility:hidden`, Task 6). `scrimEl` is still passed to the controller — for the click-to-close handler.
2. **Capture uses the fixed-position approach** (spec primary), not grid-rows. The grid-rows layout is the documented fallback **only if** the keyboard-up E2E (Task 7, Step 3) shows the keyboard covering the capture bar despite `interactive-widget=resizes-content`.

---

## Task 1: Shell elements + keyboard-aware viewport (`index.html`)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Extend the viewport meta so the on-screen keyboard shrinks the layout viewport**

Replace (line 5):

```html
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

with:

```html
		<meta name="viewport" content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content" />
```

- [ ] **Step 2: Add the `#topbar` and `#scrim` shell elements**

Replace the body block:

```html
	<body>
		<aside id="sidebar"></aside>
		<main id="main"></main>
		<script type="module" src="/src/main.js"></script>
	</body>
```

with:

```html
	<body>
		<header id="topbar"></header>
		<aside id="sidebar"></aside>
		<main id="main"></main>
		<div id="scrim"></div>
		<script type="module" src="/src/main.js"></script>
	</body>
```

Notes: `#topbar` is **before** `#sidebar`; `#scrim` is a **body-level sibling after `#main`** (invariant #8 — it must stay tappable while `#main` is `inert`). `#scrim` has **no `hidden` attribute** (class-route decision above); its resting hidden state comes from CSS in Task 6.

- [ ] **Step 3: Verify the build still parses the entry HTML and tests stay green**

Run: `npm run build`
Expected: build completes, no errors.

Run: `npm run test:run`
Expected: 134 passed.

- [ ] **Step 4: Propose commit** (Malin commits via GitHub Desktop)

Files: `index.html`
Message:

```
feat(mobile): add topbar + scrim shell elements and keyboard-aware viewport
```

---

## Task 2: Render-once top bar view (`src/views/topbar.js`)

**Files:**
- Create: `src/views/topbar.js`

- [ ] **Step 1: Create the view file**

Create `src/views/topbar.js` with exactly:

```js
// createTopbarView(rootEl, { onToggleDrawer, onGoToday }) → { setExpanded(open), destroy() }
//
// Mobile-only top bar: the ☰ menu button (opens the off-canvas drawer) and the
// "Ignite" wordmark (a one-tap home shortcut → Today). Hidden on desktop via CSS.
//
// Render-once (mirrors capture.js): the content is static (☰ + "Ignite"), so it
// never re-renders from state. The only imperative update is setExpanded(bool),
// which reflects drawer open/closed state on the ☰ button's aria-expanded.
// Content is static — no user data — so no escapeHtml is needed.

import { bindActions } from "../utils/dom.js";

export function createTopbarView(rootEl, { onToggleDrawer, onGoToday }) {
	rootEl.innerHTML = `
		<button class="topbar__menu" type="button"
			data-action="toggle-drawer"
			aria-label="Open menu" aria-expanded="false" aria-controls="sidebar">☰</button>
		<button class="topbar__wordmark" type="button" data-action="go-today">Ignite</button>
	`;

	const menuBtn = rootEl.querySelector(".topbar__menu");

	const unbindClick = bindActions(rootEl, {
		"toggle-drawer": () => onToggleDrawer(),
		"go-today": () => onGoToday(),
	});

	return {
		setExpanded(open) {
			menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
		},
		destroy() {
			unbindClick();
			rootEl.innerHTML = "";
		},
	};
}
```

This mirrors `capture.js` (render-once, returns `destroy()`) and uses `bindActions` for delegated clicks like `sidebar.js`. Invariant #5: it must **not** re-render on `applyState`/the 60s tick — it has no `render(state)` method, so the controller never calls it on state changes.

- [ ] **Step 2: Verify lint/format clean and tests green**

Run: `npm run check`
Expected: no diagnostics (the new file is import-sorted, formatted, lint-clean).

Run: `npm run test:run`
Expected: 134 passed (the view is not yet imported anywhere; nothing breaks).

- [ ] **Step 3: Propose commit** (Malin commits via GitHub Desktop)

Files: `src/views/topbar.js`
Message:

```
feat(mobile): add render-once topbar view (menu button + Ignite wordmark)
```

---

## Task 3: Pass `#topbar` / `#scrim` / `#main` to the controller (`src/app.js`)

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Grab the two new shell elements**

Replace:

```js
	const sidebarRoot = document.getElementById("sidebar");
	const mainEl = document.getElementById("main");
```

with:

```js
	const sidebarRoot = document.getElementById("sidebar");
	const mainEl = document.getElementById("main");
	const topbarRoot = document.getElementById("topbar");
	const scrimEl = document.getElementById("scrim");
```

`mainEl` already existed and is `#main` — the parent of `#capture-root` + `#main-root`. It is the **inert target** (distinct from `#main-root`). It's grabbed before the `mainEl.innerHTML = ...` write below, so it's the same element.

- [ ] **Step 2: Pass them in the `els` object**

Replace:

```js
		els: {
			sidebarRoot,
			captureRoot: document.getElementById("capture-root"),
			mainRoot: document.getElementById("main-root"),
			toastRoot,
		},
```

with:

```js
		els: {
			sidebarRoot,
			topbarRoot,
			scrimEl,
			mainEl,
			captureRoot: document.getElementById("capture-root"),
			mainRoot: document.getElementById("main-root"),
			toastRoot,
		},
```

(The controller destructures these new keys in Task 5; until then they're harmlessly unused.)

- [ ] **Step 3: Verify build + tests**

Run: `npm run build`
Expected: build completes, no errors.

Run: `npm run test:run`
Expected: 134 passed.

- [ ] **Step 4: Propose commit** (Malin commits via GitHub Desktop)

Files: `src/app.js`
Message:

```
feat(mobile): pass topbar, scrim, and main els to the controller
```

---

## Task 4: Sidebar `onCloseDrawer` Esc fall-through (`src/views/sidebar.js`)

**Files:**
- Modify: `src/views/sidebar.js`

- [ ] **Step 1: Document the new callback in the contract header**

Replace:

```js
// createSidebarView(rootEl, {
//   onToggleCollapse, onGoToday, onOpenArea,
//   onAddArea, onCommitAreaRename, onMoveAreaUp, onMoveAreaDown, onDeleteArea,
// }) → { render(state), enterRename(areaId), destroy() }
```

with:

```js
// createSidebarView(rootEl, {
//   onToggleCollapse, onGoToday, onOpenArea,
//   onAddArea, onCommitAreaRename, onMoveAreaUp, onMoveAreaDown, onDeleteArea,
//   onCloseDrawer,
// }) → { render(state), enterRename(areaId), destroy() }
```

- [ ] **Step 2: Add `onCloseDrawer` to the destructured params**

Replace:

```js
	{
		onToggleCollapse,
		onGoToday,
		onOpenArea,
		onAddArea,
		onCommitAreaRename,
		onMoveAreaUp,
		onMoveAreaDown,
		onDeleteArea,
	},
```

with:

```js
	{
		onToggleCollapse,
		onGoToday,
		onOpenArea,
		onAddArea,
		onCommitAreaRename,
		onMoveAreaUp,
		onMoveAreaDown,
		onDeleteArea,
		onCloseDrawer,
	},
```

- [ ] **Step 3: Add the drawer-close fall-through in the Esc block**

In `docKeyHandler`, replace:

```js
		if (event.key === "Escape") {
			if (renamingAreaId) {
				cancelRename();
				return;
			}
			if (openAreaMenuId) {
				closeMenu();
			}
			return;
		}
```

with:

```js
		if (event.key === "Escape") {
			if (renamingAreaId) {
				cancelRename();
				return;
			}
			if (openAreaMenuId) {
				closeMenu();
				return;
			}
			onCloseDrawer?.(); // nothing internal consumed Esc → ask controller to close the drawer
			return;
		}
```

Two changes: a `return;` is added after `closeMenu()` so a single Esc never both closes a menu *and* the drawer (precedence: rename → menu → drawer), and `onCloseDrawer?.()` runs only when nothing internal consumed Esc. The optional chain keeps this inert on desktop and when the drawer is shut (invariant #10). This preserves the sidebar's existing Esc precedence rather than adding a competing document handler.

- [ ] **Step 4: Verify lint + tests**

Run: `npm run check`
Expected: no diagnostics.

Run: `npm run test:run`
Expected: 134 passed (sidebar has no unit tests; `onCloseDrawer` is optional, so the current controller — which doesn't pass it yet — is unaffected).

- [ ] **Step 5: Propose commit** (Malin commits via GitHub Desktop)

Files: `src/views/sidebar.js`
Message:

```
feat(mobile): add onCloseDrawer Esc fall-through to the sidebar
```

---

## Task 5: Drawer behavior + wiring (`src/controller.js`)

**Files:**
- Modify: `src/controller.js`

- [ ] **Step 1: Import the topbar view**

Replace:

```js
import { createTodayView } from "./views/today.js";
```

with:

```js
import { createTodayView } from "./views/today.js";
import { createTopbarView } from "./views/topbar.js";
```

- [ ] **Step 2: Destructure the new els**

Replace:

```js
	const { sidebarRoot, captureRoot, mainRoot, toastRoot } = els;
```

with:

```js
	const {
		sidebarRoot,
		topbarRoot,
		scrimEl,
		mainEl,
		captureRoot,
		mainRoot,
		toastRoot,
	} = els;
```

- [ ] **Step 3: Add the drawer closure state**

Replace:

```js
	let sidebar = null;
	let capture = null;
	let toast = null;
	let currentMainView = null;
	let currentRoute = { name: "today" };
	let tickHandle = null;
	let unsubs = [];
	let taskDeleteBatch = null; // null | { tasks: Array<TaskSnapshot> }
```

with:

```js
	let sidebar = null;
	let topbar = null;
	let capture = null;
	let toast = null;
	let currentMainView = null;
	let currentRoute = { name: "today" };
	let tickHandle = null;
	let unsubs = [];
	let taskDeleteBatch = null; // null | { tasks: Array<TaskSnapshot> }
	let drawerOpen = false; // transient UI state — NOT a model field (mirrors is-area-route)
	let drawerMq = null; // matchMedia("(min-width: 768px)") — stored for teardown
	let drawerMqHandler = null;
```

- [ ] **Step 4: Add `openDrawer()` and `closeDrawer()`**

Insert these two functions immediately **before** `function onHashChange()` (function declarations hoist, so order vs. callers doesn't matter; placing them here keeps drawer logic together):

```js
	function openDrawer() {
		if (drawerOpen) return;
		drawerOpen = true;
		document.body.classList.add("is-drawer-open"); // CSS: slide in + scrim + scroll-lock
		topbar.setExpanded(true); // menu button aria-expanded="true"
		// Modal dialog semantics — controller-set so sidebar.js stays unchanged
		// (invariant #13). openDrawer only ever runs on mobile, so these attributes
		// never exist on the desktop layout.
		sidebarRoot.setAttribute("role", "dialog");
		sidebarRoot.setAttribute("aria-modal", "true");
		sidebarRoot.setAttribute("aria-label", "Navigation");
		// Background becomes inert → focus is contained in the drawer, AT ignores it
		// (invariant #7). The scrim is NOT inert — it must stay tappable to close.
		for (const el of [topbarRoot, mainEl, toastRoot]) el.inert = true;
		// Move focus into the drawer (first focusable: the "Ignite" home button).
		sidebarRoot.querySelector(".sidebar__home")?.focus();
	}

	function closeDrawer() {
		if (!drawerOpen) return;
		drawerOpen = false;
		document.body.classList.remove("is-drawer-open");
		for (const el of [topbarRoot, mainEl, toastRoot]) el.inert = false;
		for (const attr of ["role", "aria-modal", "aria-label"]) {
			sidebarRoot.removeAttribute(attr);
		}
		topbar.setExpanded(false);
		// Return focus to the menu trigger via DOM lookup, never a stored ref
		// (invariant #6 — the topbar is render-once, so the lookup is stable).
		topbarRoot.querySelector(".topbar__menu")?.focus();
	}
```

Both are guarded (`if (drawerOpen)` / `if (!drawerOpen)`) so every caller is idempotent. The `drawerOpen` guard also means `topbar.setExpanded` / focus are only reached when the drawer is genuinely open — which is only possible after `start()` has assigned `topbar`.

> **Watch-point for Task 7:** `openDrawer` adds the body class then synchronously focuses `.sidebar__home`. The drawer is `visibility:hidden` until `body.is-drawer-open` flips it to `visible`; `.focus()` forces a style flush in current browsers, so this normally works. If the E2E shows focus NOT landing in the drawer, wrap the focus line in `requestAnimationFrame(() => sidebarRoot.querySelector(".sidebar__home")?.focus())`.

- [ ] **Step 5: Close the drawer on every route change**

Replace:

```js
	function onHashChange() {
		currentRoute = parseHash(window.location.hash);
		mountMainView(currentRoute);
		applyState();
	}
```

with:

```js
	function onHashChange() {
		closeDrawer(); // close on ALL route changes incl. browser back/forward (invariant #14)
		currentRoute = parseHash(window.location.hash);
		mountMainView(currentRoute);
		applyState();
	}
```

This is the single choke point for all routing, so it also catches browser back/forward (which never go through the nav callbacks). Idempotent → harmless when already closed.

- [ ] **Step 6: Mount the topbar and extend the sidebar nav callbacks in `start()`**

Insert the topbar mount immediately after `toast = createToastView(toastRoot);`:

```js
		topbar = createTopbarView(topbarRoot, {
			onToggleDrawer: () => (drawerOpen ? closeDrawer() : openDrawer()),
			onGoToday: () => {
				window.location.hash = "#today";
				closeDrawer(); // same-hash tap of "Ignite" on #today fires no hashchange
			},
		});
```

Then, in the `createSidebarView(...)` call, replace:

```js
			onGoToday: () => {
				window.location.hash = "#today";
			},
			onOpenArea: (id) => {
				window.location.hash = `#area/${id}`;
			},
```

with:

```js
			onGoToday: () => {
				window.location.hash = "#today";
				closeDrawer();
			},
			onOpenArea: (id) => {
				window.location.hash = `#area/${id}`;
				closeDrawer();
			},
			onCloseDrawer: () => closeDrawer(),
```

The explicit `closeDrawer()` calls cover same-hash taps (no `hashchange`); cross-route taps also fire `onHashChange` → `closeDrawer()` again, but it's idempotent so the double call is harmless.

- [ ] **Step 7: Wire the scrim click + matchMedia crossover in `start()`**

Insert immediately after `window.addEventListener("hashchange", onHashChange);`:

```js
		scrimEl.addEventListener("click", closeDrawer);

		// Crossing to the desktop layout must clear is-drawer-open, the inert
		// flags, and the scroll-lock — otherwise an open-drawer resize strands
		// them on the desktop grid (invariant #9).
		drawerMq = matchMedia("(min-width: 768px)");
		drawerMqHandler = (event) => {
			if (event.matches) closeDrawer();
		};
		drawerMq.addEventListener("change", drawerMqHandler);
```

- [ ] **Step 8: Tear it all down in `stop()`**

Replace:

```js
	function stop() {
		clearInterval(tickHandle);
		tickHandle = null;
		window.removeEventListener("hashchange", onHashChange);
		for (const unsub of unsubs) unsub();
		unsubs = [];
		currentMainView?.destroy();
		capture?.destroy();
		sidebar?.destroy();
		toast?.destroy();
		currentMainView = null;
		capture = null;
		sidebar = null;
		toast = null;
	}
```

with:

```js
	function stop() {
		closeDrawer(); // clears is-drawer-open, inert, scroll-lock, dialog ARIA in one place (invariant #14)
		clearInterval(tickHandle);
		tickHandle = null;
		window.removeEventListener("hashchange", onHashChange);
		scrimEl.removeEventListener("click", closeDrawer);
		drawerMq?.removeEventListener("change", drawerMqHandler);
		drawerMq = null;
		drawerMqHandler = null;
		for (const unsub of unsubs) unsub();
		unsubs = [];
		currentMainView?.destroy();
		capture?.destroy();
		sidebar?.destroy();
		topbar?.destroy();
		toast?.destroy();
		currentMainView = null;
		capture = null;
		sidebar = null;
		topbar = null;
		toast = null;
		drawerOpen = false;
	}
```

`closeDrawer()` runs **first** (while `topbar` is still mounted, before `topbar?.destroy()`), so the inert/scroll-lock/ARIA cleanup happens cleanly. If the drawer was already closed it early-returns.

- [ ] **Step 9: Verify lint, tests, and build**

Run: `npm run check`
Expected: no diagnostics (import order: `today.js` then `topbar.js`).

Run: `npm run test:run`
Expected: 134 passed.

Run: `npm run build`
Expected: build completes, no errors.

(Behavioral verification of open/close/inert/focus is Task 7 — there are no unit tests for controller wiring.)

- [ ] **Step 10: Propose commit** (Malin commits via GitHub Desktop)

Files: `src/controller.js`
Message:

```
feat(mobile): wire drawer open/close, scrim, matchMedia, and teardown
```

---

## Task 6: Mobile-first CSS pass (`main.css`)

**Files:**
- Modify: `main.css`

> **Specificity discipline (project lesson):** Biome's `noDescendingSpecificity` flags a lower-specificity rule that appears *after* a higher-specificity one for the same target. Keep base rules before state overrides. The appended block in Step 5 is deliberately ordered: tokens → element baselines → scroll-lock → reduced-motion → desktop `@media` → `body.is-drawer-open` state overrides (highest specificity, LAST). Do not reorder.

- [ ] **Step 1: Turn the baseline `#sidebar` into the off-canvas drawer**

Replace:

```css
#sidebar {
	border-bottom: 1px solid var(--color-border);
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}
```

with:

```css
/* Mobile baseline: the sidebar is an off-canvas drawer that slides in from the left.
   visibility:hidden (not just the off-screen transform) removes the closed drawer from
   the tab order + AT tree (invariant #12); it's restored to visible by
   body.is-drawer-open and at >=768px. */
#sidebar {
	position: fixed;
	inset-block: 0;
	inset-inline-start: 0;
	z-index: 90;
	width: min(80vw, 300px);
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	overflow-y: auto;
	background: var(--color-bg);
	border-right: 1px solid var(--color-border);
	transform: translateX(-100%);
	visibility: hidden;
	transition:
		transform 200ms ease,
		visibility 200ms;
}
```

- [ ] **Step 2: Reset `#sidebar` to a static grid column on desktop**

In the `@media (min-width: 768px)` block, replace:

```css
	#sidebar {
		border-right: 1px solid var(--color-border);
		border-bottom: none;
	}
```

with:

```css
	#sidebar {
		position: static;
		z-index: auto;
		width: auto;
		overflow-y: visible;
		transform: none;
		visibility: visible;
		border-right: 1px solid var(--color-border);
		border-bottom: none;
	}
```

This returns the sidebar to the existing 2-column grid + collapse-to-rail behavior exactly as v0.1.

- [ ] **Step 3: Lift the toast above the pinned capture bar on mobile**

In the `#toast-root` rule, replace:

```css
	bottom: 1rem;
```

with:

```css
	bottom: calc(var(--capture-h) + 0.5rem);
```

(`--capture-h` is defined in Step 5. The desktop reset back to `1rem` is also in Step 5's `@media` block.)

- [ ] **Step 4: Verify the desktop layout is still intact before adding mobile rules**

Run: `npm run check`
Expected: no diagnostics. (If `noDescendingSpecificity` fires here, it points at the Step 1–3 edits — the appended block in Step 5 supplies the matching state overrides; complete Step 5 before re-judging.)

- [ ] **Step 5: Append the mobile shell section to the end of `main.css`**

Append exactly (after the final `.task__rename-input:focus { ... }` rule):

```css

/* ================================================================= */
/* v0.2 — Mobile shell: top bar + off-canvas drawer + pinned capture  */
/* Mobile-first: the rules below are the BASELINE (phones). The        */
/* @media (min-width: 768px) block restores the desktop layout, and    */
/* the body.is-drawer-open state overrides come LAST so specificity     */
/* stays ascending (Biome noDescendingSpecificity).                    */
/* ================================================================= */

:root {
	/* Height reserved for the pinned mobile capture bar (input + padding + the
	   home-indicator safe area). Single source of truth: #main's bottom padding
	   and the toast lift both derive from it so they can't drift. */
	--capture-h: calc(3.4rem + env(safe-area-inset-bottom, 0px));
}

/* Top bar — mobile only (hidden at >=768px). Both buttons are >=44px touch targets. */
#topbar {
	position: sticky;
	top: 0;
	z-index: 50;
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.25rem 0.5rem;
	background: var(--color-bg);
	border-bottom: 1px solid var(--color-border);
}
.topbar__menu,
.topbar__wordmark {
	background: transparent;
	border: 0;
	color: var(--color-text);
	font: inherit;
	min-block-size: 44px;
	min-inline-size: 44px;
	border-radius: var(--radius);
	cursor: pointer;
}
.topbar__menu {
	font-size: 1.25rem;
}
.topbar__wordmark {
	padding-inline: 0.5rem;
	font-size: 1.1rem;
	font-weight: 700;
}
.topbar__menu:hover,
.topbar__wordmark:hover {
	color: var(--color-accent);
}
.topbar__menu:focus-visible,
.topbar__wordmark:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}

/* Scrim behind the open drawer. Body-level sibling of #main so it stays tappable
   while #main is inert. Class-driven (not the hidden attribute) so it can fade. */
#scrim {
	position: fixed;
	inset: 0;
	z-index: 80;
	background: rgba(0, 0, 0, 0.5);
	opacity: 0;
	visibility: hidden;
	transition:
		opacity 200ms ease,
		visibility 200ms;
}

/* Capture pinned to the bottom of the viewport. */
#capture-root {
	position: fixed;
	inset-inline: 0;
	bottom: 0;
	z-index: 60;
	padding: 0.5rem var(--main-padding);
	padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px));
	background: var(--color-bg);
	border-top: 1px solid var(--color-border);
}

/* Reserve space so the last task clears the pinned capture bar. */
#main {
	padding-block-end: calc(var(--main-padding) + var(--capture-h));
}

/* Lock background scroll while the drawer is open. */
body.is-drawer-open {
	overflow: hidden;
}

/* Reduced motion: drawer + scrim appear without the slide/fade.
   Placed before the state overrides so #sidebar / #scrim specificity stays ascending. */
@media (prefers-reduced-motion: reduce) {
	#sidebar,
	#scrim {
		transition: none;
	}
}

/* Desktop / tablet: restore the v0.1 layout exactly. */
@media (min-width: 768px) {
	#topbar {
		display: none;
	}
	#scrim {
		display: none;
	}
	#capture-root {
		position: static;
		z-index: auto;
		padding: 0;
		background: transparent;
		border-top: 0;
	}
	#main {
		padding-block-end: var(--main-padding);
	}
	#toast-root {
		bottom: 1rem;
	}
}

/* Open-state overrides — LAST so their higher specificity stays in ascending
   source order. Only meaningful on mobile; harmless at >=768px (matchMedia clears
   is-drawer-open on crossover, and these props are no-ops against the static layout). */
body.is-drawer-open #sidebar {
	transform: none;
	visibility: visible;
}
body.is-drawer-open #scrim {
	opacity: 1;
	visibility: visible;
}
```

- [ ] **Step 6: Verify lint/format, tests, and build**

Run: `npm run check`
Expected: no diagnostics (no `noDescendingSpecificity`; formatting clean — Biome may reflow the multi-value `transition` declarations, which is fine).

Run: `npm run test:run`
Expected: 134 passed.

Run: `npm run build`
Expected: build completes, no errors.

- [ ] **Step 7: Propose commit** (Malin commits via GitHub Desktop)

Files: `main.css`
Message:

```
feat(mobile): mobile-first CSS — top bar, drawer, scrim, pinned capture
```

---

## Task 7: E2E verification + final gate (Claude Preview MCP)

No code unless a check fails. This task runs the spec's full Testing checklist at **375px** plus a **desktop regression** pass, then the final gate. If a check fails, read source → fix → re-verify from the failing step → propose a follow-up commit.

> **Preview MCP gotchas (from project history — heed these):**
> - Start with `preview_start name:"ignite-dev"` (uses the gitignored `.claude/launch.json`). Resize with `preview_resize` to **375×812**.
> - `preview_click` can **silently no-op** (reports success, dispatches no DOM click). Probe first with a capture-phase `document` click listener via `preview_eval`; if it no-ops, fall back to synthetic `el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))` (`detail:1` = mouse, `detail:0` = keyboard activation).
> - `preview_screenshot` can **hang**. For focus/inert/ARIA/menu-omission proof, `preview_eval` DOM + `document.activeElement` probes are more reliable than a screenshot — don't block on screenshots.
> - When the app re-renders via `innerHTML`, captured DOM refs go stale — **re-query after each action**.
> - For time-windowed checks, do the whole sequence inside **one** `preview_eval` with internal `await new Promise(r => setTimeout(r, ms))` (between-eval wall-clock is non-deterministic).

- [ ] **Step 1: Launch + size**

`preview_start name:"ignite-dev"`, then `preview_resize` to 375×812. `preview_console_logs` → expect none. Seed a couple of areas/tasks if the store is empty (capture a task; add an area via the drawer once it's open).

- [ ] **Step 2: Pinned capture** — the "What's next?" field sits at the bottom and stays put while the task list scrolls; capturing a task works and the list updates. (`preview_snapshot` for structure; `preview_inspect` on `#capture-root` → `position: fixed`, `bottom: 0`.)

- [ ] **Step 3: Capture with the keyboard up (the #1 use case)** — focus the capture input on an emulated phone; the field stays visible above the on-screen keyboard (verifies `interactive-widget=resizes-content`). **If it's hidden behind the keyboard:** switch to the grid-rows layout (spec "Grid-rows fallback") — restructure the mobile shell as a grid `[topbar auto][scroll 1fr][capture auto]` with capture in normal flow (not `position: fixed`), then re-run Steps 2–3. Note the switch in the commit message.

- [ ] **Step 4: Drawer open/close** — tap ☰ → sidebar slides in over the scrim. Verify `document.body.classList.contains("is-drawer-open")` is true, `#sidebar` computed `visibility: visible` / `transform: none`, and `document.activeElement` is `.sidebar__home`. Tap the scrim → closes; `activeElement` returns to `.topbar__menu`. Re-open, press Esc → closes. Confirm `.topbar__menu` `aria-expanded` tracks `"true"`/`"false"`.

- [ ] **Step 5: Navigate from the drawer** — open drawer, tap an area → hash becomes `#area/<id>` AND drawer closes. Open drawer, tap "Ignite" → hash `#today` AND closes.

- [ ] **Step 6: Esc precedence** — open an area ⋯ menu inside the drawer → first Esc closes the menu (drawer stays open), second Esc closes the drawer.

- [ ] **Step 7: Rename in the drawer** — rename an area inside the drawer; Esc cancels the rename first (drawer stays open); a second Esc closes the drawer. The rename commit (Enter/blur) still works.

- [ ] **Step 8: inert / focus containment** — with the drawer open, Tab cycles only within the drawer; `#capture-root` input and task content are not focusable (`mainEl.inert`, `topbarRoot.inert`, `toastRoot.inert` all true). Probe: attempt `document.getElementById("capture-root").querySelector("input").focus()` → `activeElement` does NOT become that input.

- [ ] **Step 9: Closed drawer not reachable** — with the drawer closed at 375px, Tab from ☰ reaches the capture/task content, NOT the off-screen drawer items (drawer is `visibility: hidden`). Probe: `.sidebar__home` is not focusable while closed.

- [ ] **Step 10: Back/forward** — open the drawer, then `window.history.back()` (or the browser Back button) → drawer closes; no stuck scrim, no lingering `body.is-drawer-open`, no stuck `overflow:hidden`.

- [ ] **Step 11: Dialog semantics** — with the drawer open, `#sidebar` has `role="dialog"`, `aria-modal="true"`, `aria-label="Navigation"`; after close, all three attributes are gone.

- [ ] **Step 12: Crossover** — open the drawer at 375px, `preview_resize` to ≥768px → `is-drawer-open` cleared, `inert` flags cleared, no stuck scroll-lock, desktop grid intact.

- [ ] **Step 13: Desktop regression** — `preview_resize` to 1280×800: layout identical to v0.1 — 2-column grid, collapse-to-rail toggle works, capture inline at the top of `#main`; `#topbar` and `#scrim` are `display:none` (no blank grid track). `preview_console_logs` → none.

- [ ] **Step 14: Reduced motion** — emulate `prefers-reduced-motion: reduce`; the drawer/scrim appear without the slide/fade transition.

- [ ] **Step 15: No console errors** at any point in Steps 1–14.

- [ ] **Step 16: Final gate**

Run: `npm run test:run` → Expected: 134 passed.
Run: `npm run check` → Expected: no diagnostics.
Run: `npm run build` → Expected: build completes, no errors.

- [ ] **Step 17: Propose a follow-up commit ONLY if Steps 1–16 required code fixes** (e.g., the grid-rows fallback or the `requestAnimationFrame` focus tweak). Otherwise the feature is complete. Suggested message if the grid-rows fallback was adopted:

```
fix(mobile): use grid-rows capture layout so the keyboard never covers it
```

---

## Self-Review (run by the plan author — completed)

**1. Spec coverage** — every spec section maps to a task: shell elements + viewport (T1); `topbar.js` render-once view (T2); `els` wiring (T3); sidebar `onCloseDrawer` Esc tail (T4); `drawerOpen` + open/close + dialog ARIA + inert + focus + scrim + matchMedia + `onHashChange` close + `stop()` close + topbar mount/teardown (T5); mobile-first CSS — top bar, drawer + transition + closed `visibility`, scrim, pinned capture, toast lift, scroll-lock, desktop overrides, reduced-motion (T6); full E2E checklist incl. keyboard-up + grid-rows fallback + desktop regression + final gate (T7). All 14 invariants are called out at their implementing step.

**2. Placeholder scan** — none. Every code step contains complete, copy-ready code; every command has expected output.

**3. Type/name consistency** — `topbarRoot` / `scrimEl` / `mainEl` consistent across T3 (`els`) and T5 (destructure); `createTopbarView(rootEl, { onToggleDrawer, onGoToday }) → { setExpanded, destroy }` consistent T2↔T5; `onCloseDrawer` consistent T4↔T5; `.topbar__menu` / `.topbar__wordmark` consistent T2 markup ↔ T6 CSS; `body.is-drawer-open` consistent T5 ↔ T6; `--capture-h` consistent within T6 (`#main` padding + toast lift); `aria-controls="sidebar"` matches `#sidebar`. Scrim class-route decision is consistently applied (no `hidden` attribute in T1, no `scrimEl.hidden` in T5, CSS resting state in T6).

**Deliberate deviations from the spec's illustrative code (both sanctioned by its plan-phase flags):** (a) scrim via CSS class instead of the `hidden` attribute (enables fade + single source of truth); (b) fixed-position capture as primary with grid-rows as the documented keyboard-fail fallback.
