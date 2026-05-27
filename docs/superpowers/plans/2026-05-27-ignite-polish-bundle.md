# Polish Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land three v0.1-blocking polish items — task-delete toast aggregation, WCAG 2.2.1 pause-on-hover/focus, and ARIA APG menu arrow-key navigation — across 5 atomic commits.

**Architecture:** Pure-function seam in `src/utils/` (TDD'd: `menu-keyboard.js` + `formatTaskDeleteMessage`), view-side extensions to `src/views/toast.js` (new `update` / `isActive` + closure-state reset contract + pause/resume + aria-live placement fix), view-side keyboard wiring in `today.js` / `area.js` / `sidebar.js` (delegating to the shared pure helper), and controller-scoped batch state in `createController`.

**Tech Stack:** Vanilla JavaScript (ES modules), Vite, Vitest, Biome, IndexedDB. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-27-ignite-polish-bundle-design.md](../specs/2026-05-27-ignite-polish-bundle-design.md)

---

## File structure

| Path | Status | Purpose |
|---|---|---|
| `src/utils/menu-keyboard.js` | **NEW** | Three pure helpers: `firstEnabledIndex`, `lastEnabledIndex`, `nextEnabledIndex`. No DOM, no view dependencies. |
| `tests/utils/menu-keyboard.test.js` | **NEW** | 13 Vitest unit tests, one assertion per `it()`. |
| `src/utils/text.js` | Modify | Add `formatTaskDeleteMessage(count)` next to existing `capitalizeFirst`. |
| `tests/utils/text.test.js` | Modify | Add a second `describe("formatTaskDeleteMessage", …)` block with 3 tests. |
| `src/views/toast.js` | Modify | Extended API (`update`, `isActive`, `TASK_DELETE_BATCH_KEY` constant), template `aria-live` move to message span, pause/resume on `.toast` div, closure-state reset contract. ~58 → ~150 LOC. |
| `src/views/section.js` | Modify | Add `tabindex="-1"` to all menuitem buttons in both section and task menus. |
| `src/views/today.js` | Modify | Add `tabindex="-1"` on its task-menu Delete button + extend `docKeyHandler` with arrow-key cases. |
| `src/views/area.js` | Modify | Extend `docKeyHandler` with arrow-key cases for both section and task menus. |
| `src/views/sidebar.js` | Modify | Add `tabindex="-1"` to area-menu items + extend `docKeyHandler` with arrow-key cases. |
| `src/controller.js` | Modify | Add controller-scoped `taskDeleteBatch` closure + `handleTaskDelete` helper. Today and area view delete callbacks become thin wrappers. |

---

## Task 1 — Menu-keyboard utility (TDD)

**Files:**
- Create: `src/utils/menu-keyboard.js`
- Create: `tests/utils/menu-keyboard.test.js`

**Commit message (proposed):**
```
feat(utils): menu-keyboard navigation helpers (first/last/next enabled index)
```

**Why:** Foundational pure helper for Task 2. TDD'd because it's the pure-function seam per project convention (memory: "TDD only on `src/utils/` model reorder helpers and time/text").

---

### 1.1 — Create the test file with the first 3 tests (firstEnabledIndex)

- [ ] Create `tests/utils/menu-keyboard.test.js` with content:

```js
import { describe, expect, it } from "vitest";
import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../../src/utils/menu-keyboard.js";

describe("firstEnabledIndex", () => {
	it("returns 0 when all items are enabled", () => {
		expect(
			firstEnabledIndex([
				{ disabled: false },
				{ disabled: false },
				{ disabled: false },
			]),
		).toBe(0);
	});

	it("skips leading disabled items", () => {
		expect(
			firstEnabledIndex([
				{ disabled: true },
				{ disabled: true },
				{ disabled: false },
				{ disabled: false },
			]),
		).toBe(2);
	});

	it("returns -1 when all items are disabled (or array is empty)", () => {
		expect(firstEnabledIndex([])).toBe(-1);
		expect(
			firstEnabledIndex([{ disabled: true }, { disabled: true }]),
		).toBe(-1);
	});
});
```

### 1.2 — Verify all three tests fail

- [ ] Run:
```
npx vitest run tests/utils/menu-keyboard.test.js
```

Expected: 3 failures, all with "Failed to resolve import" or "firstEnabledIndex is not a function" (since `src/utils/menu-keyboard.js` doesn't exist yet).

### 1.3 — Create the source file with minimal `firstEnabledIndex` implementation

- [ ] Create `src/utils/menu-keyboard.js` with:

```js
// Pure helpers for ARIA APG menu keyboard navigation.
// No DOM, no view dependencies. The view code maps menuitem DOM nodes
// to the `items` shape:
//   Array.from(menuEl.querySelectorAll('[role="menuitem"]'))
//     .map(el => ({ disabled: el.disabled }))

// Returns the index of the first non-disabled item.
// -1 if none (including empty array).
export function firstEnabledIndex(items) {
	for (let i = 0; i < items.length; i++) {
		if (!items[i].disabled) return i;
	}
	return -1;
}
```

### 1.4 — Verify the firstEnabledIndex tests pass

- [ ] Run:
```
npx vitest run tests/utils/menu-keyboard.test.js
```

Expected: 3 PASS (the firstEnabledIndex describe block), 0 FAIL. Other named imports (`lastEnabledIndex`, `nextEnabledIndex`) trigger "Failed to resolve" errors at module load — that's fine; we'll add them next.

If imports fail at module-load level, briefly stub the missing exports as `export function lastEnabledIndex(){}; export function nextEnabledIndex(){};` so test discovery proceeds. (We'll fill them in 1.5–1.8.) Confirm 3 PASS.

### 1.5 — Add 3 tests for lastEnabledIndex

- [ ] Append to `tests/utils/menu-keyboard.test.js`:

```js
describe("lastEnabledIndex", () => {
	it("returns the last index when all items are enabled", () => {
		expect(
			lastEnabledIndex([
				{ disabled: false },
				{ disabled: false },
				{ disabled: false },
			]),
		).toBe(2);
	});

	it("skips trailing disabled items", () => {
		expect(
			lastEnabledIndex([
				{ disabled: false },
				{ disabled: false },
				{ disabled: true },
				{ disabled: true },
			]),
		).toBe(1);
	});

	it("returns -1 when all items are disabled (or array is empty)", () => {
		expect(lastEnabledIndex([])).toBe(-1);
		expect(
			lastEnabledIndex([{ disabled: true }, { disabled: true }]),
		).toBe(-1);
	});
});
```

### 1.6 — Verify the lastEnabledIndex tests fail

- [ ] Run:
```
npx vitest run tests/utils/menu-keyboard.test.js
```

Expected: firstEnabledIndex's 3 PASS continue; lastEnabledIndex's 3 FAIL (returns `undefined` from the stub, expected 2/1/-1).

### 1.7 — Implement lastEnabledIndex

- [ ] Replace the stub `lastEnabledIndex` in `src/utils/menu-keyboard.js`:

```js
// Returns the index of the last non-disabled item.
// -1 if none (including empty array).
export function lastEnabledIndex(items) {
	for (let i = items.length - 1; i >= 0; i--) {
		if (!items[i].disabled) return i;
	}
	return -1;
}
```

### 1.8 — Verify all 6 tests pass

- [ ] Run:
```
npx vitest run tests/utils/menu-keyboard.test.js
```

Expected: 6 PASS, 0 FAIL.

### 1.9 — Add 7 tests for nextEnabledIndex

- [ ] Append to `tests/utils/menu-keyboard.test.js`:

```js
describe("nextEnabledIndex", () => {
	const allEnabled = [
		{ disabled: false },
		{ disabled: false },
		{ disabled: false },
		{ disabled: false },
	];

	it("moves forward by one from the middle", () => {
		expect(nextEnabledIndex(allEnabled, 1, 1)).toBe(2);
	});

	it("wraps forward from last to first", () => {
		expect(nextEnabledIndex(allEnabled, 3, 1)).toBe(0);
	});

	it("moves backward by one from the middle", () => {
		expect(nextEnabledIndex(allEnabled, 2, -1)).toBe(1);
	});

	it("wraps backward from first to last", () => {
		expect(nextEnabledIndex(allEnabled, 0, -1)).toBe(3);
	});

	it("skips disabled items going forward", () => {
		expect(
			nextEnabledIndex(
				[
					{ disabled: false }, // 0
					{ disabled: true }, // 1
					{ disabled: true }, // 2
					{ disabled: false }, // 3
				],
				0,
				1,
			),
		).toBe(3);
	});

	it("returns currentIndex when it's the only enabled item", () => {
		expect(
			nextEnabledIndex(
				[{ disabled: true }, { disabled: false }, { disabled: true }],
				1,
				1,
			),
		).toBe(1);
		expect(
			nextEnabledIndex(
				[{ disabled: true }, { disabled: false }, { disabled: true }],
				1,
				-1,
			),
		).toBe(1);
	});

	it("returns -1 when all items are disabled (or array is empty)", () => {
		expect(nextEnabledIndex([], 0, 1)).toBe(-1);
		expect(
			nextEnabledIndex(
				[{ disabled: true }, { disabled: true }],
				0,
				1,
			),
		).toBe(-1);
	});
});
```

### 1.10 — Verify the nextEnabledIndex tests fail

- [ ] Run:
```
npx vitest run tests/utils/menu-keyboard.test.js
```

Expected: 6 PASS (first + last), 7 FAIL (next).

### 1.11 — Implement nextEnabledIndex

- [ ] Replace the stub `nextEnabledIndex` in `src/utils/menu-keyboard.js`:

```js
// Returns the next non-disabled index in `direction` (+1 = forward, -1 = backward),
// wrapping around the array boundary. Returns `currentIndex` if it's the only
// enabled item. Returns -1 if no item is enabled (including empty array).
export function nextEnabledIndex(items, currentIndex, direction) {
	if (items.length === 0) return -1;
	let idx = currentIndex;
	for (let step = 0; step < items.length; step++) {
		idx = (idx + direction + items.length) % items.length;
		if (!items[idx].disabled) return idx;
	}
	return -1; // all disabled
}
```

**Why the loop bound is `items.length`:** after `items.length` steps we've visited every index exactly once (modular walk), so if nothing was found, no items are enabled. The `+ items.length` inside the modulo handles negative `direction` correctly (JS `%` preserves sign of dividend).

### 1.12 — Verify all 13 tests pass

- [ ] Run:
```
npx vitest run tests/utils/menu-keyboard.test.js
```

Expected: 13 PASS, 0 FAIL, output pristine (no warnings).

### 1.13 — Run the full test suite to confirm no regressions

- [ ] Run:
```
npm run test:run
```

Expected: 117 PASS (104 previous + 13 new), 0 FAIL.

### 1.14 — Run Biome lint check

- [ ] Run:
```
npm run check
```

Expected: clean (no errors, no warnings).

### 1.15 — Stage + propose commit

- [ ] Stage files (Malin commits via GitHub Desktop):
```
src/utils/menu-keyboard.js
tests/utils/menu-keyboard.test.js
```

Proposed commit message:
```
feat(utils): menu-keyboard navigation helpers (first/last/next enabled index)
```

---

## Task 2 — Menu arrow-key wiring across four views

**Files:**
- Modify: `src/views/section.js` (template: tabindex on section + task menuitems)
- Modify: `src/views/today.js` (template: tabindex on task menu; extend `docKeyHandler`)
- Modify: `src/views/area.js` (extend `docKeyHandler`)
- Modify: `src/views/sidebar.js` (template: tabindex on area menu; extend `docKeyHandler`)

**Commit message (proposed):**
```
feat(views): ARIA APG menu arrow-key navigation in today/area/sidebar
```

**Why:** Wires the pure helper from Task 1 into all four menus. Adds `tabindex="-1"` so menuitems are removed from the Tab sequence; arrow keys / Home / End navigate within the menu; Tab closes the menu (via the existing `closeMenu(returnFocus=true)` path from s3) and returns focus to `⋯`.

**Pattern:** each view's existing `docKeyHandler` already handles Esc-to-close. We extend it with a `findOpenMenuContainingTarget(event.target)` lookup followed by a switch on `event.key`. The pattern is structurally identical across views; only the menu-state flag differs.

---

### 2.1 — Add `tabindex="-1"` to all section-menu menuitems in `section.js`

- [ ] Open `src/views/section.js`. Find the section-menu `<button role="menuitem" …>` lines (look around line 110-130 per the earlier grep). Add `tabindex="-1"` to each:

**Before (5 menuitems in the section menu):**
```html
<button role="menuitem" type="button" class="section-menu__item" data-action="rename-section">Rename</button>
<button role="menuitem" type="button" class="section-menu__item" data-action="move-section-up">Move up</button>
<button role="menuitem" type="button" class="section-menu__item" data-action="move-section-down">Move down</button>
<button role="menuitem" type="button" class="section-menu__item" data-action="delete-section">Delete</button>
```

**After:**
```html
<button role="menuitem" tabindex="-1" type="button" class="section-menu__item" data-action="rename-section">Rename</button>
<button role="menuitem" tabindex="-1" type="button" class="section-menu__item" data-action="move-section-up">Move up</button>
<button role="menuitem" tabindex="-1" type="button" class="section-menu__item" data-action="move-section-down">Move down</button>
<button role="menuitem" tabindex="-1" type="button" class="section-menu__item" data-action="delete-section">Delete</button>
```

Apply the same `tabindex="-1"` insertion to every `<button role="menuitem" …>` in section.js, including the task-menu rendered in the same file (Move up / Move down / Delete on tasks within an area view section).

**Note:** Don't modify section.js if your file has the menuitems on multi-line buttons — apply the attribute in the same relative position (after `role="menuitem"`). Use the file's existing formatting style.

### 2.2 — Add `tabindex="-1"` to the today task-menu Delete button in `today.js`

- [ ] Open `src/views/today.js`. Find `data-action="delete-task" role="menuitem"` (around line 170). Add `tabindex="-1"`:

**Before:**
```html
<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem">Delete</button>
```

**After:**
```html
<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem" tabindex="-1">Delete</button>
```

### 2.3 — Add `tabindex="-1"` to all area-menu menuitems in `sidebar.js`

- [ ] Open `src/views/sidebar.js`. Find the sidebar-menu `<button role="menuitem" …>` lines (around 456-475). Add `tabindex="-1"` to each:

**Before (4 menuitems):**
```html
<button role="menuitem" type="button" class="sidebar-menu__item" data-action="rename-area">Rename</button>
<button role="menuitem" type="button" class="sidebar-menu__item" data-action="move-area-up">Move up</button>
<button role="menuitem" type="button" class="sidebar-menu__item" data-action="move-area-down">Move down</button>
<button role="menuitem" type="button" class="sidebar-menu__item" data-action="delete-area">Delete</button>
```

**After:**
```html
<button role="menuitem" tabindex="-1" type="button" class="sidebar-menu__item" data-action="rename-area">Rename</button>
<button role="menuitem" tabindex="-1" type="button" class="sidebar-menu__item" data-action="move-area-up">Move up</button>
<button role="menuitem" tabindex="-1" type="button" class="sidebar-menu__item" data-action="move-area-down">Move down</button>
<button role="menuitem" tabindex="-1" type="button" class="sidebar-menu__item" data-action="delete-area">Delete</button>
```

### 2.4 — Quick template-change verification (no commit yet)

- [ ] Run the dev server:
```
npm run dev
```

- [ ] In a browser, open the app and verify:
  - Today task `⋯` opens menu, Delete button visible, Tab from outside DOES NOT focus the Delete button anymore (it's now `tabindex="-1"`).
  - Area view section `⋯` and task `⋯` menus: same.
  - Sidebar area `⋯` menu: same.

Acceptance: keyboard Tab no longer cycles through menuitems. Menu open via mouse-click still works (the `⋯` click invokes the existing `open-menu` action handler which auto-focuses the first menuitem via the M5 `pendingMenuFocus*` flag pattern).

If a menu fails to open or focus auto-management breaks, stop and re-verify the template changes (you may have edited an unrelated `role="menuitem"`).

### 2.5 — Add the `findOpenMenuContainingTarget` helper + arrow-key extension to `today.js`

- [ ] In `src/views/today.js`, add the import at the top of the file (near other utility imports):

```js
import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../utils/menu-keyboard.js";
```

- [ ] Locate the existing `docKeyHandler` function (around line 35). Inside the closure scope that contains it, add the helper function ABOVE `docKeyHandler` (so it has access to `rootEl` and the relevant `openMenuTaskId` state — both are closure variables in today.js):

```js
function findOpenMenuInToday(target) {
	if (!openMenuTaskId) return null;
	const menu = rootEl.querySelector(
		`[data-id="${CSS.escape(openMenuTaskId)}"] [role="menu"]`,
	);
	return menu?.contains(target) ? menu : null;
}
```

- [ ] Extend `docKeyHandler` to handle arrow keys AFTER the existing Esc-close branch. The full updated `docKeyHandler` should look like:

```js
function docKeyHandler(event) {
	// Existing Esc-close logic stays:
	if (event.key === "Escape") {
		if (openMenuTaskId) {
			closeMenu(true);
			event.preventDefault();
		}
		return;
	}

	// NEW: menu keyboard navigation
	const menuEl = findOpenMenuInToday(event.target);
	if (!menuEl) return;

	const menuItems = Array.from(
		menuEl.querySelectorAll('[role="menuitem"]'),
	);
	const currentIndex = menuItems.indexOf(event.target);
	const items = menuItems.map((el) => ({ disabled: el.disabled }));

	let nextIdx = -1;
	switch (event.key) {
		case "ArrowDown":
			nextIdx = nextEnabledIndex(items, currentIndex, 1);
			break;
		case "ArrowUp":
			nextIdx = nextEnabledIndex(items, currentIndex, -1);
			break;
		case "Home":
			nextIdx = firstEnabledIndex(items);
			break;
		case "End":
			nextIdx = lastEnabledIndex(items);
			break;
		case "Tab":
			event.preventDefault();
			closeMenu(true); // returnFocus = true → focuses ⋯
			return;
		default:
			return;
	}

	event.preventDefault();
	if (nextIdx >= 0) menuItems[nextIdx].focus();
}
```

**Important:** preserve the exact existing Esc-close logic — copy what's already there if your version differs slightly. The arrow-key block is purely additive.

### 2.6 — Manual E2E on today task menu

- [ ] In a browser (dev server already running from 2.4):
  - Navigate to Today.
  - Capture a task if there are none visible.
  - Click the task's `⋯` → menu opens, focus on Delete.
  - Press **ArrowDown** → focus stays on Delete (single-item menu wraps to itself; expected no-op).
  - Press **ArrowUp** → same.
  - Press **Home** → same.
  - Press **End** → same.
  - Press **Tab** → menu closes, focus returns to `⋯`.
  - Press **Esc** while menu open → menu closes, focus on `⋯`.
  - Click outside while menu open → menu closes, focus NOT stolen to `⋯` (s3 behavior preserved).
- [ ] Confirm zero console errors.

### 2.7 — Add the helper + extension to `area.js`

- [ ] In `src/views/area.js`, add the import at top:

```js
import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../utils/menu-keyboard.js";
```

- [ ] Find the existing `docKeyHandler` function (around line 122 per the grep). Inside the same closure scope, add the helper ABOVE it. Note: area.js has TWO menu states (`openMenuSectionId` for section ⋯ and `openMenuTaskId` for task ⋯), so the helper checks both:

```js
function findOpenMenuInArea(target) {
	if (openMenuSectionId) {
		const menu = rootEl.querySelector(
			`[data-section-id="${CSS.escape(openMenuSectionId)}"] [role="menu"]`,
		);
		if (menu?.contains(target)) return menu;
	}
	if (openMenuTaskId) {
		const menu = rootEl.querySelector(
			`[data-id="${CSS.escape(openMenuTaskId)}"] [role="menu"]`,
		);
		if (menu?.contains(target)) return menu;
	}
	return null;
}
```

- [ ] Extend `docKeyHandler` with the same arrow-key block as in today.js (replace `findOpenMenuInToday` with `findOpenMenuInArea`; keep area.js's existing Esc-close branch for both menu states):

```js
function docKeyHandler(event) {
	// Existing Esc-close logic (handles both menu states) stays unchanged.
	// ... existing Esc handling ...

	// NEW: menu keyboard navigation
	const menuEl = findOpenMenuInArea(event.target);
	if (!menuEl) return;

	const menuItems = Array.from(
		menuEl.querySelectorAll('[role="menuitem"]'),
	);
	const currentIndex = menuItems.indexOf(event.target);
	const items = menuItems.map((el) => ({ disabled: el.disabled }));

	let nextIdx = -1;
	switch (event.key) {
		case "ArrowDown":
			nextIdx = nextEnabledIndex(items, currentIndex, 1);
			break;
		case "ArrowUp":
			nextIdx = nextEnabledIndex(items, currentIndex, -1);
			break;
		case "Home":
			nextIdx = firstEnabledIndex(items);
			break;
		case "End":
			nextIdx = lastEnabledIndex(items);
			break;
		case "Tab":
			event.preventDefault();
			// area.js has different closeMenu calls for section vs task menu.
			// Choose the right one based on which menu is currently open:
			if (openMenuSectionId) closeMenu(true);
			else if (openMenuTaskId) closeTaskMenu(true);
			return;
		default:
			return;
	}

	event.preventDefault();
	if (nextIdx >= 0) menuItems[nextIdx].focus();
}
```

**Important:** the Tab branch in area.js distinguishes which menu is open (section vs task) and calls the appropriate close. If area.js uses a single `closeMenu` for both (depending on the implementation), simplify accordingly. Read the existing close-handling code in area.js around the Esc handler to mirror it exactly.

### 2.8 — Manual E2E on area view section + task menus

- [ ] In the browser:
  - Navigate to an area (`#area/...` route).
  - Open a section's `⋯` → menu opens, focus on Rename.
  - **ArrowDown** → cycles Rename → Move up → Move down → Delete (or only the rows that exist; boundary moves are omitted, not disabled).
  - **ArrowUp** at top → wraps to last item.
  - **Home / End** jump to first / last.
  - **Tab** closes menu + focuses `⋯`.
  - Repeat for a task's `⋯` menu in the same area.
- [ ] Confirm zero console errors.

### 2.9 — Add the helper + extension to `sidebar.js`

- [ ] In `src/views/sidebar.js`, add the import at top:

```js
import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../utils/menu-keyboard.js";
```

- [ ] Find the existing `docKeyHandler` function (around line 110). Add the helper above it:

```js
function findOpenMenuInSidebar(target) {
	if (!openMenuAreaId) return null;
	const menu = rootEl.querySelector(
		`[data-area-id="${CSS.escape(openMenuAreaId)}"] [role="menu"]`,
	);
	return menu?.contains(target) ? menu : null;
}
```

- [ ] Extend `docKeyHandler` with the arrow-key block (replace `findOpenMenuInToday` with `findOpenMenuInSidebar`):

```js
function docKeyHandler(event) {
	// Existing Esc-close logic stays unchanged.
	// ... existing Esc handling ...

	// NEW: menu keyboard navigation
	const menuEl = findOpenMenuInSidebar(event.target);
	if (!menuEl) return;

	const menuItems = Array.from(
		menuEl.querySelectorAll('[role="menuitem"]'),
	);
	const currentIndex = menuItems.indexOf(event.target);
	const items = menuItems.map((el) => ({ disabled: el.disabled }));

	let nextIdx = -1;
	switch (event.key) {
		case "ArrowDown":
			nextIdx = nextEnabledIndex(items, currentIndex, 1);
			break;
		case "ArrowUp":
			nextIdx = nextEnabledIndex(items, currentIndex, -1);
			break;
		case "Home":
			nextIdx = firstEnabledIndex(items);
			break;
		case "End":
			nextIdx = lastEnabledIndex(items);
			break;
		case "Tab":
			event.preventDefault();
			closeMenu(true);
			return;
		default:
			return;
	}

	event.preventDefault();
	if (nextIdx >= 0) menuItems[nextIdx].focus();
}
```

### 2.10 — Manual E2E on sidebar area menu

- [ ] In the browser:
  - Open a non-Focus area's `⋯` in the sidebar → menu opens, focus on Rename.
  - **ArrowDown** cycles through items, wraps.
  - **Tab** closes menu + focuses `⋯`.
  - Open Focus area's `⋯` (single-item menu — only "Rename"). **ArrowDown** stays on Rename (no-op, no crash).
- [ ] Confirm zero console errors.

### 2.11 — Full regression sweep

- [ ] Run unit tests:
```
npm run test:run
```
Expected: 117 PASS.

- [ ] Run Biome check:
```
npm run check
```
Expected: clean.

- [ ] Manual cross-view sanity (all menus from earlier subtasks still pass):
  - Esc still closes + focuses `⋯` everywhere.
  - Click-outside doesn't steal focus (s3 invariant).
  - Menu auto-focuses first item on open (M5 invariant).

### 2.12 — Stage + propose commit

- [ ] Stage:
```
src/views/section.js
src/views/today.js
src/views/area.js
src/views/sidebar.js
```

Proposed commit message:
```
feat(views): ARIA APG menu arrow-key navigation in today/area/sidebar
```

---

## Task 3 — `formatTaskDeleteMessage` utility (TDD)

**Files:**
- Modify: `src/utils/text.js`
- Modify: `tests/utils/text.test.js`

**Commit message (proposed):**
```
feat(utils): formatTaskDeleteMessage for aggregated task-delete toast
```

**Why:** Pure formatter for the aggregation message ("Task deleted" singular vs "N tasks deleted" plural). TDD'd per pure-function seam.

---

### 3.1 — Add the 3 tests to text.test.js

- [ ] Open `tests/utils/text.test.js`. Update the import line to add `formatTaskDeleteMessage`:

**Before:**
```js
import { capitalizeFirst } from "../../src/utils/text.js";
```

**After:**
```js
import { capitalizeFirst, formatTaskDeleteMessage } from "../../src/utils/text.js";
```

- [ ] Append after the existing `describe("capitalizeFirst", …)` block:

```js
describe("formatTaskDeleteMessage", () => {
	it("returns the singular form for count = 1", () => {
		expect(formatTaskDeleteMessage(1)).toBe("Task deleted");
	});

	it("returns the plural form for count = 2", () => {
		expect(formatTaskDeleteMessage(2)).toBe("2 tasks deleted");
	});

	it("returns the plural form for larger counts", () => {
		expect(formatTaskDeleteMessage(10)).toBe("10 tasks deleted");
	});
});
```

### 3.2 — Verify the 3 tests fail

- [ ] Run:
```
npx vitest run tests/utils/text.test.js
```

Expected: existing capitalizeFirst tests PASS; 3 new tests FAIL ("`formatTaskDeleteMessage` is not a function").

### 3.3 — Implement formatTaskDeleteMessage

- [ ] Open `src/utils/text.js`. Append after the existing `capitalizeFirst` function:

```js
// Aggregated task-delete toast message. Singular for the first deletion,
// plural with a count once a batch has more than one task. The aggregation
// itself lives in the controller; this helper is just the string formatter.
export function formatTaskDeleteMessage(count) {
	if (count === 1) return "Task deleted";
	return `${count} tasks deleted`;
}
```

### 3.4 — Verify all tests pass

- [ ] Run:
```
npx vitest run tests/utils/text.test.js
```
Expected: existing + 3 new PASS.

- [ ] Run full suite:
```
npm run test:run
```
Expected: 120 PASS (117 from Task 1 + 3 new).

### 3.5 — Run Biome check

- [ ] Run:
```
npm run check
```
Expected: clean.

### 3.6 — Stage + propose commit

- [ ] Stage:
```
src/utils/text.js
tests/utils/text.test.js
```

Proposed commit message:
```
feat(utils): formatTaskDeleteMessage for aggregated task-delete toast
```

---

## Task 4 — Toast view API extensions

**Files:**
- Modify: `src/views/toast.js`

**Commit message (proposed):**
```
feat(views): toast.update + isActive + pause/resume API extensions
```

**Why:** Toast view gains: (a) `TASK_DELETE_BATCH_KEY` constant + `key` parameter on `show()` for batch identity, (b) `update()` for in-place message mutation + timer reset, (c) `isActive(key)` query, (d) pause-on-hover-or-focus with resume-from-remaining timer, (e) `aria-live` moved from toast root to message span (fixes SR re-announcement when focus is on Undo), (f) explicit closure-state reset contract.

**No TDD** — this is view-side code with closure state, DOM listeners, and `setTimeout`. Verified manually per project convention.

---

### 4.1 — Rewrite `src/views/toast.js`

- [ ] Replace the entire contents of `src/views/toast.js` with:

```js
// createToastView(rootEl) → { show, update, isActive, destroy }
//
// One toast at a time. show() replaces any existing toast (and its timer).
// update() mutates the active toast's message + resets timer in place.
// isActive(key) returns true iff the active toast matches the given key.
//
// Pause/resume (WCAG 2.2.1): mouseenter OR focusin on the .toast div pauses
// the dismiss timer; resume requires both mouseleave AND focusout.
// Pause/resume are idempotent.
//
// Closure-state reset contract: clearActive() resets EVERY closure variable
// on every exit path (undo / dismiss / replace-on-show / destroy). Without
// the enumeration, stale state (e.g. elapsedAtPause from a prior paused
// toast) leaks into the next show and the resume math goes wrong.
//
// aria-live placement: the live region is the message span only, NOT the
// toast root. With focus on the Undo button (sibling of the message span,
// outside the live region), update() textContent changes still announce
// to screen readers. (Per W3C: focus INSIDE a live region suppresses
// change announcements in some SRs.)

import { escapeHtml } from "../utils/dom.js";

const DEFAULT_DURATION_MS = 5_000;

// Identifies the task-delete aggregation batch. Single source of truth so
// a typo silently disabling aggregation is impossible — controller imports
// this constant rather than hard-coding the string.
export const TASK_DELETE_BATCH_KEY = "task-delete";

export function createToastView(rootEl) {
	let timer = null;
	let timerStartedAt = null;
	let elapsedAtPause = 0;
	let durationMs = null;
	let activeKey = null;
	let activeUndoHandler = null;
	let activeOnDismiss = null;
	let isHovered = false;
	let isFocused = false;

	function clearActive() {
		if (timer) clearTimeout(timer);
		timer = null;
		timerStartedAt = null;
		elapsedAtPause = 0;
		durationMs = null;
		activeKey = null;
		activeUndoHandler = null;
		activeOnDismiss = null;
		isHovered = false;
		isFocused = false;
		rootEl.innerHTML = ""; // detaches .toast div + its listeners
	}

	function pause() {
		if (timer === null) return; // idempotent
		clearTimeout(timer);
		elapsedAtPause += Date.now() - timerStartedAt;
		timer = null;
		timerStartedAt = null;
	}

	function resume() {
		if (timer !== null) return; // idempotent
		if (durationMs === null) return; // no active toast
		const remainingMs = Math.max(0, durationMs - elapsedAtPause);
		timerStartedAt = Date.now();
		timer = setTimeout(onTimerExpire, remainingMs);
	}

	function onTimerExpire() {
		const onDismiss = activeOnDismiss;
		clearActive();
		if (onDismiss) onDismiss();
	}

	function attachInteractionListeners(toastEl) {
		toastEl.addEventListener("mouseenter", () => {
			isHovered = true;
			pause();
		});
		toastEl.addEventListener("mouseleave", () => {
			isHovered = false;
			if (!isFocused) resume();
		});
		toastEl.addEventListener("focusin", () => {
			isFocused = true;
			pause();
		});
		toastEl.addEventListener("focusout", () => {
			isFocused = false;
			if (!isHovered) resume();
		});
	}

	function show({ message, onUndo, onDismiss, durationMs: d, key } = {}) {
		// Fire prior toast's onDismiss before replacing (so its closure state
		// is committed — e.g. taskDeleteBatch in controller clears).
		const priorOnDismiss = activeOnDismiss;
		clearActive();
		if (priorOnDismiss) priorOnDismiss();

		const dur = d ?? DEFAULT_DURATION_MS;
		durationMs = dur;
		activeKey = key ?? null;
		activeOnDismiss = onDismiss ?? null;

		rootEl.innerHTML = `
			<div class="toast">
				<span class="toast__message" role="status" aria-live="polite">${escapeHtml(message ?? "")}</span>
				<button class="toast__undo" type="button">Undo</button>
			</div>
		`;

		const toastEl = rootEl.querySelector(".toast");
		const undoBtn = rootEl.querySelector(".toast__undo");

		activeUndoHandler = () => {
			clearActive();
			if (onUndo) onUndo();
		};
		undoBtn.addEventListener("click", activeUndoHandler, { once: true });

		attachInteractionListeners(toastEl);

		timerStartedAt = Date.now();
		timer = setTimeout(onTimerExpire, dur);
	}

	function update({ message, durationMs: d } = {}) {
		if (durationMs === null) return; // no-op when no active toast
		const messageEl = rootEl.querySelector(".toast__message");
		if (messageEl) messageEl.textContent = message ?? "";

		// Reset timer state for the fresh duration.
		const dur = d ?? DEFAULT_DURATION_MS;
		durationMs = dur;
		elapsedAtPause = 0;
		if (timer !== null) {
			// Running: restart fresh.
			clearTimeout(timer);
			timerStartedAt = Date.now();
			timer = setTimeout(onTimerExpire, dur);
		}
		// If paused: leave timer null; resume() will use the new durationMs
		// with elapsedAtPause=0 = full fresh window on un-hover.
	}

	function isActive(key) {
		return activeKey !== null && activeKey === key;
	}

	return {
		show,
		update,
		isActive,
		destroy() {
			clearActive();
		},
	};
}
```

### 4.2 — Run the full test suite

- [ ] Run:
```
npm run test:run
```

Expected: 120 PASS (no toast-specific unit tests; we just want to verify nothing else broke).

### 4.3 — Run Biome check

- [ ] Run:
```
npm run check
```
Expected: clean. (If you used double-quotes inside the template literal where Biome prefers single, fix to match — the existing toast.js uses backtick template literals so this should be fine.)

### 4.4 — Manual E2E: replace-and-commit (current behavior preserved)

- [ ] In the browser (dev server running):
  - Delete a task → toast "Task deleted" appears, Undo button visible.
  - Wait 5s → toast dismisses; task stays deleted.
- [ ] Verify: zero console errors. The toast HTML now wraps the message in `<span class="toast__message" role="status" aria-live="polite">`.

### 4.5 — Manual E2E: pause on hover

- [ ] Delete a task → toast appears.
- [ ] Within 5s, hover the toast → keep hovering for 10s → toast stays visible (timer paused).
- [ ] Mouse-leave → timer resumes from where it left off; toast dismisses after the remaining time.
- [ ] Approximate check: if you hovered at ~2s, mouse-leave → toast dismisses ~3s later (5 - 2 = 3 remaining).

If the toast dismisses while you're still hovering, the pause logic is broken — re-check `attachInteractionListeners` is being called inside `show()`.

### 4.6 — Manual E2E: pause on keyboard focus

- [ ] Delete a task → toast appears.
- [ ] Press Tab repeatedly until focus lands on the Undo button (the toast's tabbable child).
- [ ] Wait 10s with focus on Undo → toast stays visible.
- [ ] Shift+Tab away → timer resumes.

### 4.7 — Manual E2E: idempotency

- [ ] Hover, then focus, then hover again → pause stays paused (idempotent).
- [ ] Move mouse out, focus out (in either order) → timer resumes (single resume call).
- [ ] No console errors.

### 4.8 — Manual E2E: cascade-delete unchanged

- [ ] Cascade-delete a section (with tasks) → toast shows `'<section name>' and N tasks deleted` for 8s (CASCADE_TOAST_MS).
- [ ] Click Undo → section + its tasks restored.
- [ ] Repeat for area cascade-delete.

### 4.9 — Manual E2E: in-place update (proves `update()` works)

This requires a controller-side aggregation to test. Defer until Task 5 lands. For now, you can manually exercise `update()` via DevTools console:

- [ ] After deleting a task (toast visible), in DevTools console:
```js
// Grab the controller's toast instance — accessible via window if exposed,
// otherwise via the rootEl reference. Simplest: just probe the DOM.
document.querySelector(".toast__message").textContent
// Should read "Task deleted"
```

- [ ] Real `update()` E2E happens in Task 5's verification.

### 4.10 — Stage + propose commit

- [ ] Stage:
```
src/views/toast.js
```

Proposed commit message:
```
feat(views): toast.update + isActive + pause/resume API extensions
```

---

## Task 5 — Controller task-delete aggregation

**Files:**
- Modify: `src/controller.js`

**Commit message (proposed):**
```
feat(controller): aggregate sequential task deletes into batch toast
```

**Why:** Wires Task 3's pure formatter + Task 4's new toast API into a controller-scoped batch. Single task delete shows "Task deleted"; subsequent deletes within the 5s window grow the batch ("2 tasks deleted", "3 tasks deleted", …) with the timer reset on each addition. Undo restores all in reverse insertion order. Cascade deletes (section + area) keep their current behavior — they're not part of aggregation.

**No TDD** — view-side controller wiring. Verified manually.

---

### 5.1 — Update imports in `src/controller.js`

- [ ] At the top of `src/controller.js`, update the toast import:

**Before:**
```js
import { createToastView } from "./views/toast.js";
```

**After:**
```js
import { createToastView, TASK_DELETE_BATCH_KEY } from "./views/toast.js";
```

- [ ] Add the text utility import (or extend an existing import line):
```js
import { formatTaskDeleteMessage } from "./utils/text.js";
```

### 5.2 — Add `taskDeleteBatch` closure variable + `handleTaskDelete` helper

- [ ] Inside `createController({ models, els })`, near the top with the other closure variables (`let sidebar = null`, etc.), add:

```js
let taskDeleteBatch = null; // null | { tasks: Array<TaskSnapshot> }
```

- [ ] Also inside `createController`, after `buildState` / `applyState` / `mountMainView` definitions but BEFORE the view-mount callbacks, add the helper:

```js
function handleTaskDelete(task) {
	tasks.remove(task.id);

	if (toast.isActive(TASK_DELETE_BATCH_KEY)) {
		taskDeleteBatch.tasks.push(task);
		toast.update({
			message: formatTaskDeleteMessage(taskDeleteBatch.tasks.length),
			durationMs: 5000,
		});
	} else {
		taskDeleteBatch = { tasks: [task] };
		toast.show({
			message: formatTaskDeleteMessage(1),
			key: TASK_DELETE_BATCH_KEY,
			durationMs: 5000,
			onUndo: () => {
				const batch = taskDeleteBatch;
				taskDeleteBatch = null;
				for (const t of [...batch.tasks].reverse()) {
					tasks.restore(t);
				}
			},
			onDismiss: () => {
				taskDeleteBatch = null;
			},
		});
	}
}
```

### 5.3 — Replace the inline `onDelete` in the today view callback

- [ ] Find the existing today-view mount around line 75 of `src/controller.js`. The current `onDelete` looks like:

```js
onDelete: (taskData) => {
	tasks.remove(taskData.id);
	toast.show({
		message: "Task deleted",
		onUndo: () => tasks.restore(taskData),
	});
},
```

- [ ] Replace with:

```js
onDelete: (task) => handleTaskDelete(task),
```

### 5.4 — Replace the inline `onDeleteTask` in the area view callback

- [ ] Find the area-view mount around line 155. The current `onDeleteTask` looks like:

```js
onDeleteTask: (task) => {
	tasks.remove(task.id);
	toast.show({
		message: "Task deleted",
		onUndo: () => tasks.restore(task),
	});
},
```

- [ ] Replace with:

```js
onDeleteTask: (task) => handleTaskDelete(task),
```

### 5.5 — Run the full test suite

- [ ] Run:
```
npm run test:run
```
Expected: 120 PASS. (Unit tests don't cover controller — they cover model + utilities.)

### 5.6 — Run Biome check

- [ ] Run:
```
npm run check
```
Expected: clean.

### 5.7 — Manual E2E: single delete (regression check)

- [ ] In the browser:
  - Delete a single task in today view → toast "Task deleted" appears.
  - Click Undo within 5s → task restored.
  - Repeat with auto-dismiss (don't click Undo, wait 5s) → task stays deleted.
- [ ] Repeat in area view (delete a single task within a section).
- [ ] Zero console errors.

### 5.8 — Manual E2E: aggregation (today view)

- [ ] In today view, capture 3 tasks (call them A, B, C). Wait a moment so they're persisted.
- [ ] Delete A → toast "Task deleted".
- [ ] Within 5s, delete B → toast updates **in place** to "2 tasks deleted"; timer resets (you have 5s from now).
- [ ] Within 5s, delete C → "3 tasks deleted".
- [ ] Click Undo → all 3 restored. The order doesn't strictly matter visually but the spec says reverse-insertion (C first, then B, then A).
- [ ] Verify via DevTools (Application → IndexedDB → ignite-db → tasks): all 3 tasks present with `deletedAt: null` (or whatever the soft-delete field is).

### 5.9 — Manual E2E: aggregation across views (proves controller-scope batch)

- [ ] Capture 1 task each in: today view, and a section under an area.
- [ ] Delete the task from today view → toast "Task deleted".
- [ ] Navigate to the area view via sidebar (hash change).
- [ ] Within 5s of the first delete, delete the task in the area view → toast updates to "2 tasks deleted".
- [ ] Click Undo → both restored.

This proves `taskDeleteBatch` lives in controller scope (survives route changes), not view scope.

### 5.10 — Manual E2E: cascade interaction

- [ ] Delete a task → toast "Task deleted" (batch of 1).
- [ ] Within 5s, cascade-delete a section (Delete on the section's `⋯` menu) → cascade toast replaces the batch toast: `'<section>' and N tasks deleted`, 8s duration.
- [ ] Verify the batched task can no longer be undone (cascade replaced the batch and the batch's `onDismiss` fired → `taskDeleteBatch = null`).
- [ ] Cascade Undo restores the section + its tasks (cascade undo unchanged).

### 5.11 — Manual E2E: pause + aggregation

- [ ] Delete task A → toast "Task deleted".
- [ ] Hover the toast → timer pauses.
- [ ] While still hovering, delete task B from the same view → toast updates to "2 tasks deleted" (batch grew). Timer stays paused.
- [ ] Mouse-leave → timer starts a fresh 5s window with the new "2 tasks deleted" message.
- [ ] Wait it out — both stay deleted, or Undo restores both.

### 5.12 — Stage + propose commit

- [ ] Stage:
```
src/controller.js
```

Proposed commit message:
```
feat(controller): aggregate sequential task deletes into batch toast
```

---

## Final acceptance

After all 5 tasks committed:

- [ ] `npm run test:run` → 120 PASS, 0 FAIL.
- [ ] `npm run check` → Biome clean.
- [ ] All Task 2-5 manual E2E checkpoints have passed in a real browser.
- [ ] Zero console errors during any E2E flow.
- [ ] s2/s3/M5 invariants preserved:
  - Click-outside doesn't steal focus to `⋯`.
  - Esc closes menu + focuses `⋯`.
  - Menu auto-focuses first item on open.
  - Cascade-undo flows work as in M5.
  - `isRendering` blur-guard intact (no rename input in menus; no interaction).
  - Boundary moves omitted, not disabled (s3).
- [ ] Tree clean (no uncommitted work).
- [ ] Memory log entry added to `~/.claude/projects/.../memory/MEMORY.md` summarizing what shipped (which commits, test count, any deviations).

---

## Spec-coverage self-review

Spec sections vs implementation:

| Spec section | Covered by |
|---|---|
| Section 1 — `TASK_DELETE_BATCH_KEY` constant | Task 4.1 (toast.js export) |
| Section 1 — `show({ key })` | Task 4.1 |
| Section 1 — `update({ message, durationMs })` | Task 4.1 |
| Section 1 — `isActive(key)` | Task 4.1 |
| Section 1 — Toast template structure (aria-live on span) | Task 4.1 |
| Section 1 — Closure state | Task 4.1 |
| Section 1 — Pause/resume idempotent | Task 4.1 (`pause()` / `resume()`) |
| Section 1 — Listener attachment on `.toast` div | Task 4.1 (`attachInteractionListeners`) |
| Section 1 — `clearActive()` reset contract | Task 4.1 (`clearActive`) |
| Section 1 — Controller `taskDeleteBatch` scope | Task 5.2 |
| Section 1 — `handleTaskDelete` extraction | Task 5.2 |
| Section 1 — `formatTaskDeleteMessage` | Task 3.3 |
| Section 2 — `nextEnabledIndex` / `firstEnabledIndex` / `lastEnabledIndex` | Task 1 |
| Section 2 — `tabindex="-1"` on menuitems | Task 2.1 / 2.2 / 2.3 |
| Section 2 — Arrow / Home / End / Tab keys | Task 2.5 / 2.7 / 2.9 |
| Section 2 — `findOpenMenuContainingTarget` with `.contains()` | Task 2.5 / 2.7 / 2.9 |
| Section 2 — Trigger ARIA (already done) | No task needed |
| Section 2 — Arrow-key focus loss defensive note | Documented in spec; no implementation |
| Known limitations (6 items) | Documented in spec; no implementation |
| Testing — TDD via Vitest | Task 1 (menu-keyboard) + Task 3 (text) |
| Testing — Manual E2E | Task 2.4–2.11, 4.4–4.9, 5.7–5.11 |
| Rollout — 5 atomic commits | Tasks 1, 2, 3, 4, 5 (one commit each) |

**Coverage check:** every spec requirement maps to a task. No gaps.
