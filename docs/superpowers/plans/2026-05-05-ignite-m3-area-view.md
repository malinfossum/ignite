# Ignite Milestone 3 — Area View + Section CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Area view, make `#area/focus` a real route, add full CRUD for sections inside Focus (create, rename, delete-with-cascade-undo, reorder, collapse), keep the seed `focus-default` undeletable, and apply security/accessibility discipline (shared `escapeHtml`, keyboard-reachable section headers, focus management, 44×44 px touch targets, 8s undo timer for cascade).

**Architecture:** Pure-function seam in `src/utils/sections.js` (`reorderSections` — TDD-tested). Two new view factories — `createSectionView` renders one section (header, menu, body, add-task, optional rename input), `createAreaView` composes them inside an area shell. Controller adds an `area` route to its mount table, toggles a `body.is-area-route` class to hide the capture bar, owns rename trigger memorisation + focus return, and orchestrates the cascade-delete + undo path with a per-toast `durationMs` of 8 s. `escapeHtml` is promoted from three duplicated copies into `src/utils/dom.js`; a sibling `bindKeys` helper handles delegated `keydown` (Esc → cancel rename / close menu) without disturbing M2's click-only `bindActions`.

**Tech Stack:** Vanilla ES modules, Vite 8, Vitest, fake-indexeddb (already configured in M1/M2). No new dependencies.

**Preconditions:**
- Branch `main` at `d5d8712` (`style: add CSS for capture, today, task row, menu, toast, collapsed sidebar`).
- 67/67 unit tests passing under `npm run test:run`.
- Biome clean under `npx biome check .`.
- M1 + M2 source files unchanged from their last committed state.

**Out of scope for M3:** `+ New area`, area rename/delete, move-task-between-sections (drag or menu), date picker / time / recurrence UI on tasks, reminder scheduling, Service Worker, PWA polish, section drag-to-reorder, Settings link, full arrow-key navigation inside section menu (Tab cycling is acceptable for AA), toast queueing for sequential deletes, pause-toast-timer-on-focus.

**Source of truth:** `docs/superpowers/specs/2026-05-05-ignite-m3-area-view-design.md` (and the parent `2026-04-20-ignite-design.md`).

---

## File Structure

**Create:**
- `src/utils/sections.js` — pure: `reorderSections(sections, sectionId, direction) → Section[]`
- `tests/utils/sections.test.js` — 5 tests for `reorderSections`
- `src/views/section.js` — `renderSection(section, { tasks, openMenuId, renamingId, isFirst, isLast, isUndeletable, now }) → string`
- `src/views/area.js` — `createAreaView(rootEl, { areaId, callbacks }) → { render(state), destroy() }`

**Modify:**
- `src/utils/dom.js` — promote `escapeHtml` here as the canonical helper; add `bindKeys(rootEl, keyMap) → unbind`
- `src/views/task.js` — drop the local `escapeHtml`; import from `utils/dom.js`
- `src/views/toast.js` — drop the local `escapeHtml`; import from `utils/dom.js`; add optional `durationMs` parameter to `show()` (defaults to 5000)
- `src/views/sidebar.js` — drop the local `escapeHtml`; import from `utils/dom.js`. Wordmark becomes a clickable button (`data-action="go-today"`); each area row becomes a `<button>` (`data-action="open-area"`); `aria-current="page"` and `is-active` reflect `state.route`
- `src/model/sections.js` — add `setCollapsed(id, value)`, `rename(id, name)`, `swapOrder(idA, idB)`, `restore(snapshot)`, `removeMany(ids)`
- `src/model/tasks.js` — add `removeMany(ids)`, `restoreMany(snapshots)`
- `src/model/areas.js` — `ensureFocus` migrates the empty seed name (`""`) to `"Tasks"` on boot
- `src/controller.js` — add `area` to the mount table; toggle `body.is-area-route` from `applyState`; new `onHashChange` already exists (broaden semantics); orchestrate section CRUD callbacks; track rename trigger element + restore focus on commit/cancel/destroy; cascade delete + undo flow; pass `route` into state
- `src/app.js` — rename the route-swappable child from `#today-root` to `#main-root` (single shared root for Today and Area); pass `mainRoot` to controller
- `tests/unit/sections.test.js` — add tests for the 5 new mutators
- `tests/unit/tasks.test.js` — add tests for `removeMany` and `restoreMany`
- `tests/unit/areas.test.js` — add tests for the empty-seed-name migration
- `main.css` — area shell, section header (toggle button + chevron + menu trigger + rename input), section body, per-section add-task, area footer add-section, menu dropdown styling, touch-target minimums, `:focus-visible` outlines, `prefers-reduced-motion` overrides, `body.is-area-route #capture-root { display: none; }`

**Untouched:** `index.html` (the `<main>` shell stays as `<main id="main">`; the `#capture-root` + `#main-root` siblings are still injected by `app.js`), `base.css`, `src/main.js`, `src/utils/id.js`, `src/utils/time.js`, `src/model/db.js`, `src/model/recurrence.js`, `src/model/settings.js`, `src/views/capture.js`, `src/views/today.js`, `vite.config.js`, `vitest.config.js`, `tests/setup.js`, all M1 + M2 model/view files except those listed above.

One file = one responsibility. Views never import models. Models never touch the DOM. The controller is the only file that wires both.

---

## Ground Rules for the Executor

1. **TDD where the seam is pure.** `reorderSections` (Task 2) and the model mutators (Tasks 3-5) each get failing tests first, then implementation, then green. Views and the controller are verified manually (per spec lock) — no JSDOM in M3.
2. **Ask Malin before each commit. Never run `git commit` or `git push` from the shell.** Propose the message; she commits via GitHub Desktop. **Never add `Co-Authored-By` to commit messages.** Malin commits as the sole author.
3. **Explain the *why* before code on every new task.** Malin is in learning mode for this project — name the new concept (event delegation extension, focus management, ARIA `aria-current`, prefers-reduced-motion media query, etc.) the first time it appears.
4. **Do not edit `base.css`.** Do not edit `design-system/`. CSS lives in `main.css`.
5. **If a step surprises you, stop and ask.** Do not silently restructure.
6. **Promote, don't fork.** Three files currently duplicate `escapeHtml`. Task 1 promotes it; later tasks must import from `utils/dom.js`, never copy.

---

## Task 1 — Promote `escapeHtml` and add `bindKeys` to `src/utils/dom.js`

**Why:** Three view files (`task.js`, `toast.js`, `sidebar.js`) currently duplicate the same `escapeHtml` helper. M3 adds two more views (`section.js`, `area.js`) that need it. Five copies of the same function is a maintenance trap — the next time someone tightens the escape (e.g. adds backtick handling), four files will drift. Promote the canonical version into `utils/dom.js` and have everyone import it.

`bindKeys` is a sibling helper to `bindActions`. M2's `bindActions` only delegates click events. M3 needs delegated `keydown` for two cases:
- Esc on the rename `<input>` → cancel rename
- Esc anywhere inside an open section menu → close menu

Rather than overload `bindActions` (and churn all M2 callers), add a small parallel helper that does for `keydown` what `bindActions` does for `click` — match by `data-action`, dispatch to handlers in a map.

**New concepts to call out for Malin:**
- *Idempotent handler* — keydown fires repeatedly while a key is held (`event.repeat === true`). Handlers must be safe to run twice in a row. Both M3 handlers (cancel rename, close menu) clear state — repeated calls are no-ops, so we don't need to filter `event.repeat`.
- *Re-export vs duplicate* — when the same helper is needed in many files, *one* canonical implementation lives in a shared module and everyone else imports it.

**Files:**
- Modify: `src/utils/dom.js`
- Modify: `src/views/task.js`
- Modify: `src/views/toast.js`
- Modify: `src/views/sidebar.js`

- [ ] **Step 1: Add `escapeHtml` and `bindKeys` to `src/utils/dom.js`**

Replace the entire contents of `src/utils/dom.js` with:

```js
// Delegated click dispatcher.
// Usage:
//   const unbind = bindActions(rootEl, {
//     "toggle-complete": (e, actionEl) => { ... },
//     "open-menu":       (e, actionEl) => { ... },
//   });
//   ...later: unbind();
//
// Any element with `data-action="<key>"` inside `rootEl` will dispatch on click.
// Returns an unbind function so views can clean up in destroy().

export function bindActions(rootEl, actionMap) {
	const handler = (event) => {
		const actionEl = event.target.closest("[data-action]");
		if (!actionEl || !rootEl.contains(actionEl)) return;
		const fn = actionMap[actionEl.dataset.action];
		if (fn) fn(event, actionEl);
	};
	rootEl.addEventListener("click", handler);
	return () => rootEl.removeEventListener("click", handler);
}

// Delegated keydown dispatcher.
// Usage:
//   const unbind = bindKeys(rootEl, {
//     Escape: (event, actionEl) => { ... },
//     Enter:  (event, actionEl) => { ... },
//   });
//
// Looks up event.key in the map. actionEl is the closest [data-action]
// ancestor of event.target, or rootEl itself if none. Handlers MUST be
// idempotent — keydown fires repeatedly while a key is held.

export function bindKeys(rootEl, keyMap) {
	const handler = (event) => {
		const fn = keyMap[event.key];
		if (!fn) return;
		const actionEl =
			event.target.closest("[data-action]") ?? rootEl;
		if (!rootEl.contains(actionEl) && actionEl !== rootEl) return;
		fn(event, actionEl);
	};
	rootEl.addEventListener("keydown", handler);
	return () => rootEl.removeEventListener("keydown", handler);
}

// HTML-escape a string for safe interpolation inside template literals
// that get assigned to innerHTML. Always pass user-provided strings
// (titles, names, notes) through this before interpolating.

export function escapeHtml(s) {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
```

Note `escapeHtml` accepts `null`/`undefined` via `?? ""` — protects against future callers passing optional fields without an explicit fallback.

- [ ] **Step 2: Drop the local `escapeHtml` in `src/views/task.js` and import the canonical one**

In `src/views/task.js`, change the import line at the top to:

```js
import { escapeHtml } from "../utils/dom.js";
import { formatTimeLabel } from "../utils/time.js";
```

Then delete the local `escapeHtml` function at the bottom of the file (lines 32-39 in the current file).

- [ ] **Step 3: Drop the local `escapeHtml` in `src/views/toast.js` and import the canonical one**

In `src/views/toast.js`, add at the top:

```js
import { escapeHtml } from "../utils/dom.js";
```

Then delete the local `escapeHtml` function at the bottom (lines 57-64 in the current file).

- [ ] **Step 4: Drop the local `escapeHtml` in `src/views/sidebar.js` and import the canonical one**

In `src/views/sidebar.js`, change the import line at the top to:

```js
import { bindActions, escapeHtml } from "../utils/dom.js";
```

Then delete the local `escapeHtml` function at the bottom (lines 56-63 in the current file).

- [ ] **Step 5: Run the full suite to verify nothing broke**

Run: `npm run test:run`
Expected: all 67 tests still pass — refactor only, no behaviour change.

- [ ] **Step 6: Run Biome**

Run: `npx biome check .`
Expected: clean. Fix any import-sort or formatting nits Biome flags.

- [ ] **Step 7: Propose commit**

Proposed message:

```
refactor(utils): promote escapeHtml; add bindKeys for keydown delegation
```

Files staged: `src/utils/dom.js`, `src/views/task.js`, `src/views/toast.js`, `src/views/sidebar.js`.

---

## Task 2 — Pure-function seam: `src/utils/sections.js`

**Why:** Section reorder is the one place in M3 where off-by-one bugs hide silently. `reorderSections` is small, deterministic, and a perfect candidate for TDD. Per the spec, this is the only TDD slice in M3 outside the model mutators.

`reorderSections` returns a *new* array (no mutation) with the section's `order` value swapped with its immediate neighbour in the area-sorted-by-order list. Edge cases: at the top, "up" is a no-op; at the bottom, "down" is a no-op.

**New concepts to call out for Malin:**
- *Stable sort by `order`* — `Array.prototype.sort` with a numeric comparator is stable. Two sections with the same `order` keep their relative insertion order — that's why the cascade-undo path in Task 12 can write back the original `order` verbatim without worrying about ghost ordering.
- *Pure function* — same input → same output, no side effects, no `Date.now()`, no DB, no DOM. Easy to test, easy to reason about (M2 reminder).

**Files:**
- Create: `src/utils/sections.js`
- Create: `tests/utils/sections.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/sections.test.js`:

```js
import { describe, expect, it } from "vitest";
import { reorderSections } from "../../src/utils/sections.js";

const make = (id, order) => ({ id, areaId: "focus", name: id, order });

describe("reorderSections", () => {
	it("moves a middle section up by swapping order with its predecessor", () => {
		const input = [make("a", 0), make("b", 1), make("c", 2)];
		const out = reorderSections(input, "b", "up");
		const byId = Object.fromEntries(out.map((s) => [s.id, s.order]));
		expect(byId).toEqual({ a: 1, b: 0, c: 2 });
	});

	it("moves a middle section down by swapping order with its successor", () => {
		const input = [make("a", 0), make("b", 1), make("c", 2)];
		const out = reorderSections(input, "b", "down");
		const byId = Object.fromEntries(out.map((s) => [s.id, s.order]));
		expect(byId).toEqual({ a: 0, b: 2, c: 1 });
	});

	it("returns the input unchanged when moving the first section up (no-op)", () => {
		const input = [make("a", 0), make("b", 1)];
		const out = reorderSections(input, "a", "up");
		expect(out.map((s) => s.order)).toEqual([0, 1]);
		expect(out.map((s) => s.id)).toEqual(["a", "b"]);
	});

	it("returns the input unchanged when moving the last section down (no-op)", () => {
		const input = [make("a", 0), make("b", 1)];
		const out = reorderSections(input, "b", "down");
		expect(out.map((s) => s.order)).toEqual([0, 1]);
		expect(out.map((s) => s.id)).toEqual(["a", "b"]);
	});

	it("swaps correctly when order values are non-contiguous", () => {
		// Defensive: tied/non-contiguous orders could happen after a restore.
		const input = [make("a", 0), make("b", 5), make("c", 10)];
		const out = reorderSections(input, "b", "down");
		const byId = Object.fromEntries(out.map((s) => [s.id, s.order]));
		expect(byId).toEqual({ a: 0, b: 10, c: 5 });
	});

	it("does not mutate the input array", () => {
		const input = [make("a", 0), make("b", 1)];
		const snapshot = input.map((s) => ({ ...s }));
		reorderSections(input, "a", "down");
		expect(input).toEqual(snapshot);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/utils/sections.test.js`
Expected: FAIL — `Failed to resolve import "../../src/utils/sections.js"`.

- [ ] **Step 3: Implement `reorderSections`**

Create `src/utils/sections.js`:

```js
// Pure helper: returns a new sections array with the target section's
// `order` value swapped with its immediate neighbour (sorted by `order`).
// At an edge ("up" on the first, "down" on the last) it returns the
// input unchanged. Handles non-contiguous order values defensively.
//
// direction: "up" | "down"

export function reorderSections(sections, sectionId, direction) {
	const sorted = [...sections].sort((a, b) => a.order - b.order);
	const idx = sorted.findIndex((s) => s.id === sectionId);
	if (idx === -1) return sections;

	const neighbourIdx = direction === "up" ? idx - 1 : idx + 1;
	if (neighbourIdx < 0 || neighbourIdx >= sorted.length) return sections;

	const target = sorted[idx];
	const neighbour = sorted[neighbourIdx];

	// Return a NEW array (no mutation). Other sections are unchanged.
	return sections.map((s) => {
		if (s.id === target.id) return { ...s, order: neighbour.order };
		if (s.id === neighbour.id) return { ...s, order: target.order };
		return s;
	});
}
```

- [ ] **Step 4: Run to confirm green**

Run: `npm run test:run -- tests/utils/sections.test.js`
Expected: 6 tests pass.

(There are 6 tests listed above; the spec said "≈ 5" — the immutability test is a defensive bonus that costs 4 lines.)

- [ ] **Step 5: Run the full suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: 73 tests passing, Biome clean.

- [ ] **Step 6: Propose commit**

Proposed message:

```
feat(utils): add reorderSections pure helper + tests
```

Files staged: `src/utils/sections.js`, `tests/utils/sections.test.js`.

---

## Task 3 — Section model mutators (TDD)

**Why:** The area view and controller need five new mutators on the section model:

- `setCollapsed(id, value)` — toggle a section's collapse state and persist
- `rename(id, name)` — change a section's name; trim; reject empty
- `swapOrder(idA, idB)` — atomically swap two sections' `order` values (used by reorder)
- `restore(snapshot)` — write a previously-deleted section back with its original `id` and `order` (used by cascade-undo)
- `removeMany(ids)` — delete multiple sections (kept thin; cascade-delete uses it for symmetry with `tasks.removeMany`, and it future-proofs bulk-delete UX)

The existing `update(id, patch)` covers most of these conceptually, but we expose intention-revealing wrappers — calling `sections.rename(id, "Routines")` reads better than `sections.update(id, { name: "Routines" })`, and the test for "what does rename do?" doesn't have to know `update` exists.

**New concepts to call out for Malin:**
- *Intention-revealing methods* — wrapping `update({ collapsed: true })` as `setCollapsed(id, true)` makes calling code self-documenting and lets the model enforce specific rules per intent later (e.g. `rename` trims and rejects empty; `update` doesn't).
- *Direct `db.put` for restore* — same trick as `tasks.restore` from M2: bypass the create path so the original `id` and `order` are preserved.
- *Atomic swap* — `swapOrder` does both writes inside a single notify so subscribers see the new state once, not twice.

**Files:**
- Modify: `src/model/sections.js`
- Modify: `tests/unit/sections.test.js`

- [ ] **Step 1: Add failing tests to `tests/unit/sections.test.js`**

Append at the bottom of the file (outside any existing `describe`):

```js
describe("createSectionModel — setCollapsed", () => {
	it("flips the collapsed flag and notifies", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Daily" });
		expect(s.collapsed).toBe(false);

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.setCollapsed(s.id, true);
		const [stored] = await model.listByArea("focus");
		expect(stored.collapsed).toBe(true);
		expect(calls).toEqual(["notified"]);
	});
});

describe("createSectionModel — rename", () => {
	it("trims and updates the name", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Old" });
		await model.rename(s.id, "  Routines  ");
		const [stored] = await model.listByArea("focus");
		expect(stored.name).toBe("Routines");
	});

	it("rejects empty / whitespace-only names", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Old" });
		await expect(model.rename(s.id, "")).rejects.toThrow(/empty/i);
		await expect(model.rename(s.id, "   ")).rejects.toThrow(/empty/i);
		const [stored] = await model.listByArea("focus");
		expect(stored.name).toBe("Old");
	});
});

describe("createSectionModel — swapOrder", () => {
	it("swaps order values between two sections in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ areaId: "focus", name: "A" });
		const b = await model.create({ areaId: "focus", name: "B" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.swapOrder(a.id, b.id);
		const list = await model.listByArea("focus");
		expect(list[0].id).toBe(b.id);
		expect(list[1].id).toBe(a.id);
		expect(calls).toEqual(["notified"]); // single notify
	});
});

describe("createSectionModel — restore", () => {
	it("re-inserts a deleted section with the same id and order", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Daily" });
		await model.remove(s.id);
		await model.restore(s);
		const list = await model.listByArea("focus");
		expect(list).toHaveLength(1);
		expect(list[0].id).toBe(s.id);
		expect(list[0].order).toBe(s.order);
		expect(list[0].name).toBe("Daily");
	});

	it("notifies subscribers", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "x" });
		await model.remove(s.id);

		const calls = [];
		model.subscribe(() => calls.push("notified"));
		await model.restore(s);
		expect(calls).toEqual(["notified"]);
	});
});

describe("createSectionModel — removeMany", () => {
	it("deletes multiple sections in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ areaId: "focus", name: "A" });
		const b = await model.create({ areaId: "focus", name: "B" });
		await model.create({ areaId: "focus", name: "C" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.removeMany([a.id, b.id]);
		const list = await model.listByArea("focus");
		expect(list.map((s) => s.name)).toEqual(["C"]);
		expect(calls).toEqual(["notified"]); // single notify, not two
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/sections.test.js`
Expected: FAIL — multiple `... is not a function` errors.

- [ ] **Step 3: Add the new mutators to `src/model/sections.js`**

Inside the returned object from `createSectionModel`, after `remove`, add:

```js
async setCollapsed(id, value) {
	const existing = await db.get("sections", id);
	if (!existing) throw new Error(`Section not found: ${id}`);
	await db.put("sections", { ...existing, collapsed: !!value });
	notify();
},

async rename(id, name) {
	const trimmed = String(name ?? "").trim();
	if (!trimmed) throw new Error("rename(section): name cannot be empty");
	const existing = await db.get("sections", id);
	if (!existing) throw new Error(`Section not found: ${id}`);
	await db.put("sections", { ...existing, name: trimmed });
	notify();
},

async swapOrder(idA, idB) {
	const [a, b] = await Promise.all([
		db.get("sections", idA),
		db.get("sections", idB),
	]);
	if (!a) throw new Error(`Section not found: ${idA}`);
	if (!b) throw new Error(`Section not found: ${idB}`);
	await Promise.all([
		db.put("sections", { ...a, order: b.order }),
		db.put("sections", { ...b, order: a.order }),
	]);
	notify(); // single notify after both writes
},

async restore(snapshot) {
	await db.put("sections", { ...snapshot });
	notify();
	return snapshot;
},

async removeMany(ids) {
	await Promise.all(ids.map((id) => db.delete("sections", id)));
	notify(); // single notify after all deletes
},
```

Update the doc comment at the top of `createSectionModel` to list the new methods:

```js
// SectionModel = {
//   subscribe(fn) → unsubscribe,
//   list() → Promise<Section[]>,
//   listByArea(areaId) → Promise<Section[]>,  // ordered by `order`
//   create({ areaId, name, collapsed? }) → Promise<Section>,
//   update(id, patch) → Promise<Section>,
//   remove(id) → Promise<void>,
//   removeMany(ids) → Promise<void>,
//   setCollapsed(id, value) → Promise<void>,
//   rename(id, name) → Promise<void>,
//   swapOrder(idA, idB) → Promise<void>,
//   restore(snapshot) → Promise<Section>,
// }
```

- [ ] **Step 4: Run to confirm green**

Run: `npm run test:run -- tests/unit/sections.test.js`
Expected: existing tests + 7 new tests pass.

- [ ] **Step 5: Run the full suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: 80 tests passing, Biome clean.

- [ ] **Step 6: Propose commit**

Proposed message:

```
feat(model): add section mutators (setCollapsed, rename, swapOrder, restore, removeMany)
```

Files staged: `src/model/sections.js`, `tests/unit/sections.test.js`.

---

## Task 4 — Task model: `removeMany` and `restoreMany` (TDD)

**Why:** Cascade delete (Task 12) needs to delete all tasks in a section in one go, and undo needs to restore them in one go. Single-write `tasks.remove` and `tasks.restore` exist from M2; the bulk variants are thin loops that issue one `notify` after the batch — keeps the UI from blinking through N intermediate states during cascade-undo.

**New concepts to call out for Malin:**
- *One notify per logical operation* — bulk delete should look atomic to subscribers. Multiple notifies during cascade-undo would re-render the area view N times for no reason and could briefly show a half-restored section.

**Files:**
- Modify: `src/model/tasks.js`
- Modify: `tests/unit/tasks.test.js`

- [ ] **Step 1: Add failing tests to `tests/unit/tasks.test.js`**

Append at the bottom of the file:

```js
describe("createTaskModel — removeMany", () => {
	it("deletes multiple tasks in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ sectionId: "s1", title: "A" });
		const b = await model.create({ sectionId: "s1", title: "B" });
		const c = await model.create({ sectionId: "s1", title: "C" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.removeMany([a.id, b.id]);
		const list = await model.list();
		expect(list.map((t) => t.id)).toEqual([c.id]);
		expect(calls).toEqual(["notified"]);
	});
});

describe("createTaskModel — restoreMany", () => {
	it("re-inserts multiple tasks with original ids in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ sectionId: "s1", title: "A", starred: true });
		const b = await model.create({ sectionId: "s1", title: "B" });
		await model.removeMany([a.id, b.id]);

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.restoreMany([a, b]);
		const list = await model.list();
		expect(list).toHaveLength(2);
		expect(list.find((t) => t.id === a.id).starred).toBe(true);
		expect(list.find((t) => t.id === b.id).title).toBe("B");
		expect(calls).toEqual(["notified"]);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/tasks.test.js`
Expected: FAIL — `removeMany is not a function`, `restoreMany is not a function`.

- [ ] **Step 3: Add the new mutators to `src/model/tasks.js`**

Inside the returned object, after the existing `restore`, add:

```js
async removeMany(ids) {
	await Promise.all(ids.map((id) => db.delete("tasks", id)));
	notify();
},

async restoreMany(snapshots) {
	await Promise.all(
		snapshots.map((snap) => db.put("tasks", toStorage(snap))),
	);
	notify();
},
```

- [ ] **Step 4: Run to confirm green**

Run: `npm run test:run -- tests/unit/tasks.test.js`
Expected: existing tests + 2 new tests pass.

- [ ] **Step 5: Run the full suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: 82 tests passing, Biome clean.

- [ ] **Step 6: Propose commit**

Proposed message:

```
feat(model): add tasks.removeMany + restoreMany for cascade undo
```

Files staged: `src/model/tasks.js`, `tests/unit/tasks.test.js`.

---

## Task 5 — Areas model: first-boot rename migration for `focus-default`

**Why:** M2 seeded the `focus-default` section with `name: ""` because Today doesn't render section headings. M3's Area view *does* render headings, so the empty name has to become something. Per the spec (Q6), the section is undeletable and starts as `"Tasks"` after the first M3 boot.

The migration is one-shot in practice — the rename UX (Q9) treats empty input as cancel, so a user can never re-empty the name. We don't need a `_migrationDone` flag.

**New concepts to call out for Malin:**
- *Idempotent migration* — `ensureFocus` already runs every boot. Adding "if name is empty, set to default" extends the same idempotent contract: same input → same output. After the first M3 boot, the section name is `"Tasks"` (or whatever the user renamed it to), and the migration check is a no-op.

**Files:**
- Modify: `src/model/areas.js`
- Modify: `tests/unit/areas.test.js`

- [ ] **Step 1: Add failing tests to `tests/unit/areas.test.js`**

Read the existing file first to find the right `describe` block. Append a new `describe` at the bottom:

```js
describe("ensureFocus — section name migration", () => {
	it("renames the focus-default section from empty to 'Tasks' on boot", async () => {
		// Simulate an M2 record: Focus area + focus-default section with name "".
		const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
		try {
			await db.put("areas", { id: "focus", name: "Focus", icon: "🔥", critical: false, order: 0 });
			await db.put("sections", { id: "focus-default", areaId: "focus", name: "", collapsed: false, order: 0 });

			await createAreaModel(db);

			const section = await db.get("sections", "focus-default");
			expect(section.name).toBe("Tasks");
		} finally {
			db.close();
		}
	});

	it("does not overwrite a renamed focus-default section", async () => {
		const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
		try {
			await db.put("areas", { id: "focus", name: "Focus", icon: "🔥", critical: false, order: 0 });
			await db.put("sections", { id: "focus-default", areaId: "focus", name: "Inbox", collapsed: false, order: 0 });

			await createAreaModel(db);

			const section = await db.get("sections", "focus-default");
			expect(section.name).toBe("Inbox");
		} finally {
			db.close();
		}
	});

	it("seeds focus-default with name 'Tasks' on a fresh DB", async () => {
		const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
		try {
			await createAreaModel(db);
			const section = await db.get("sections", "focus-default");
			expect(section.name).toBe("Tasks");
		} finally {
			db.close();
		}
	});
});
```

If `openDB` and `createAreaModel` aren't already imported at the top of the file, add them:

```js
import { openDB } from "../../src/model/db.js";
import { createAreaModel } from "../../src/model/areas.js";
```

- [ ] **Step 2: Run to confirm the third test fails (or all three, depending on order)**

Run: `npm run test:run -- tests/unit/areas.test.js`
Expected: FAIL — the `Tasks` rename doesn't happen yet, so the migration tests fail. The seed test may also fail because `FOCUS_DEFAULT_SECTION.name` is currently `""`.

- [ ] **Step 3: Update the seed default + migration in `src/model/areas.js`**

Change `FOCUS_DEFAULT_SECTION.name` from `""` to `"Tasks"`:

```js
const FOCUS_DEFAULT_SECTION = {
	id: FOCUS_DEFAULT_SECTION_ID,
	areaId: FOCUS_ID,
	name: "Tasks",
	collapsed: false,
	order: 0,
};
```

Update `ensureFocus` to migrate any existing record with `name === ""`:

```js
async function ensureFocus(db) {
	const existing = await db.get("areas", FOCUS_ID);
	if (!existing) await db.put("areas", { ...FOCUS_DEFAULTS });
	const existingSection = await db.get("sections", FOCUS_DEFAULT_SECTION_ID);
	if (!existingSection) {
		await db.put("sections", { ...FOCUS_DEFAULT_SECTION });
	} else if (existingSection.name === "") {
		// M2 → M3 migration: empty seed name → "Tasks".
		await db.put("sections", { ...existingSection, name: "Tasks" });
	}
}
```

- [ ] **Step 4: Run to confirm green**

Run: `npm run test:run -- tests/unit/areas.test.js`
Expected: all areas tests pass (existing + 3 new).

- [ ] **Step 5: Run the full suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: 85 tests passing, Biome clean.

- [ ] **Step 6: Propose commit**

Proposed message:

```
feat(model): rename focus-default seed to "Tasks" with M2 migration
```

Files staged: `src/model/areas.js`, `tests/unit/areas.test.js`.

---

## Task 6 — Toast view: optional `durationMs` parameter

**Why:** Cascade-delete carries higher stakes than single-task delete (1-12 task snapshots in flight), and keyboard / screen-reader users need more time to tab to the Undo button. M3 lets the controller pass `durationMs: 8000` for section deletes; task deletes still use the default 5 s.

**New concepts to call out for Malin:**
- *Backwards-compatible API extension* — adding an optional parameter with a default keeps every existing caller working. The signature is the same shape; nobody has to change anything they're already doing.

**Files:**
- Modify: `src/views/toast.js`

- [ ] **Step 1: Update `show()` to accept `durationMs`**

In `src/views/toast.js`, change the constant + `show` signature so the per-call duration overrides the default:

Replace:

```js
const DURATION_MS = 5_000;
```

with:

```js
const DEFAULT_DURATION_MS = 5_000;
```

Replace the `show` function signature:

```js
function show({ message, onUndo, onDismiss, durationMs } = {}) {
```

And the timer line:

```js
timer = setTimeout(() => {
	timer = null;
	activeUndoHandler = null;
	rootEl.innerHTML = "";
	if (onDismiss) onDismiss();
}, durationMs ?? DEFAULT_DURATION_MS);
```

Update the comment block at the top of the file:

```js
// createToastView(rootEl) → { show({ message, onUndo, onDismiss, durationMs }), destroy() }
//
// One toast at a time. show() replaces any existing toast (and its timer).
// The toast auto-dismisses after `durationMs` (default 5000 ms), calling
// onDismiss if provided. Pass a longer durationMs for high-stakes undos
// (e.g. cascade delete) where keyboard / screen-reader users need more
// time to reach the Undo button.
```

- [ ] **Step 2: Run the full suite to verify nothing broke**

Run: `npm run test:run`
Expected: all 85 tests still pass — backwards-compatible change, no existing caller passed `durationMs`.

- [ ] **Step 3: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 4: Propose commit**

Proposed message:

```
feat(views): toast.show accepts optional durationMs (default 5s)
```

Files staged: `src/views/toast.js`.

---

## Task 7 — Section view (`src/views/section.js`)

**Why:** The Area view composes itself out of section blocks. Each block has the same structure: header (toggle button + chevron + title + menu trigger) → optional menu dropdown → body (task list + add-task button). Pulling it into its own template file keeps the area view file from ballooning past 200 lines.

This is a *string-template* file like `task.js` — pure, no events, no closure. It returns the HTML as a string for the area view to concatenate. Event wiring happens in the area view (Task 8). State that drives appearance — open menu id, renaming id, edge flags — comes in as parameters.

**New concepts to call out for Malin:**
- *Template module* — same pattern as `renderTaskRow` from M2: a pure function that turns one record into a string. No events. The parent (area view) wires events on the parent root via `bindActions`.
- *Conditional rendering through inline ternaries* — `${condition ? thisHtml : ""}` is the entire branching mechanism in template literals. Keep templates branch-light.
- *Edge flags* — `isFirst` and `isLast` are passed in (not computed inside) so the Move up/down buttons can render `disabled` without the section template having to know about its siblings.

**Files:**
- Create: `src/views/section.js`

- [ ] **Step 1: Create the file**

Create `src/views/section.js`:

```js
// renderSection(opts) → string
//
// Pure template. Renders one section's HTML for the area view to
// concatenate. Event wiring lives in createAreaView; this file only
// produces markup.
//
// opts:
//   section          - the section record
//   tasks            - tasks in this section (already filtered + sorted)
//   isUndeletable    - true for focus-default; suppresses Delete in menu
//   isFirst, isLast  - edge flags for Move up/down disabled state
//   openMenuId       - section id whose menu is currently open, or null
//   renamingId       - section id currently in rename mode, or null
//   now              - Date used by renderTaskRow for time labels

import { escapeHtml } from "../utils/dom.js";
import { renderTaskRow } from "./task.js";

export function renderSection({
	section,
	tasks,
	isUndeletable,
	isFirst,
	isLast,
	openMenuId,
	renamingId,
	now,
}) {
	const isOpen = openMenuId === section.id;
	const isRenaming = renamingId === section.id;
	const collapsed = !!section.collapsed;

	const header = isRenaming
		? renderRenameHeader(section)
		: renderHeader(section, collapsed, isOpen);

	const menu = isOpen && !isRenaming
		? renderMenu({ isFirst, isLast, isUndeletable })
		: "";

	const body = renderBody(section, tasks, now);

	return `
		<section
			class="section"
			data-section-id="${escapeHtml(section.id)}"
			data-collapsed="${collapsed}">
			${header}
			${menu}
			${body}
		</section>
	`;
}

function renderHeader(section, collapsed, isOpen) {
	const chevronGlyph = collapsed ? "▸" : "▾";
	return `
		<header class="section__header">
			<button
				type="button"
				class="section__toggle"
				data-action="toggle-section"
				aria-expanded="${!collapsed}">
				<span class="section__chevron" aria-hidden="true">${chevronGlyph}</span>
				<span class="section__title">${escapeHtml(section.name)}</span>
			</button>
			<button
				type="button"
				class="section__menu-btn"
				data-action="open-section-menu"
				aria-haspopup="menu"
				aria-expanded="${isOpen}">⋯</button>
		</header>
	`;
}

function renderRenameHeader(section) {
	const collapsed = !!section.collapsed;
	const chevronGlyph = collapsed ? "▸" : "▾";
	return `
		<header class="section__header section__header--editing">
			<span class="section__chevron" aria-hidden="true">${chevronGlyph}</span>
			<input
				type="text"
				class="section__rename-input"
				value="${escapeHtml(section.name)}"
				data-action="commit-rename"
				data-section-id="${escapeHtml(section.id)}"
				autofocus />
		</header>
	`;
}

function renderMenu({ isFirst, isLast, isUndeletable }) {
	const upDisabled = isFirst ? "disabled" : "";
	const downDisabled = isLast ? "disabled" : "";
	const deleteItem = isUndeletable
		? ""
		: `<li role="none">
				<button role="menuitem" type="button" class="section-menu__item"
					data-action="delete-section">Delete</button>
			</li>`;
	return `
		<ul class="section-menu" role="menu">
			<li role="none">
				<button role="menuitem" type="button" class="section-menu__item"
					data-action="rename-section">Rename</button>
			</li>
			<li role="none">
				<button role="menuitem" type="button" class="section-menu__item"
					data-action="move-up" ${upDisabled}>Move up</button>
			</li>
			<li role="none">
				<button role="menuitem" type="button" class="section-menu__item"
					data-action="move-down" ${downDisabled}>Move down</button>
			</li>
			${deleteItem}
		</ul>
	`;
}

function renderBody(section, tasks, now) {
	const rows = tasks.map((t) => renderTaskRow(t, { now })).join("");
	return `
		<div class="section__body">
			<ul class="section__tasks">${rows}</ul>
			<button
				type="button"
				class="section__add-task"
				data-action="add-task"
				data-section-id="${escapeHtml(section.id)}">＋ Add task</button>
		</div>
	`;
}
```

The `data-collapsed` attribute on the outer `<section>` is the CSS hook (Task 13). Hiding `.section__body` + rotating the chevron is done in CSS, not by branching the template — keeps the template branch-free and the visual swap a one-line CSS rule.

- [ ] **Step 2: Sanity-check by importing in a scratch run**

No tests for this file (per spec — views are manually verified). But verify it parses by running:

Run: `npm run test:run`
Expected: 85 tests still pass. The file isn't imported anywhere yet, so this is a syntax check via Vitest's module loader (which doesn't load it) — really only `npx biome check .` will catch issues at this point.

- [ ] **Step 3: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 4: Propose commit**

Proposed message:

```
feat(views): add renderSection template (header, menu, body, rename input)
```

Files staged: `src/views/section.js`.

---

## Task 8 — Area view (`src/views/area.js`)

**Why:** The view that renders `#area/:id`. Composes a sequence of `renderSection` calls inside an area shell, plus the `＋ New section` footer button. Owns its closure state (`openMenuId`, `renamingId`) the same way `today.js` owns `openMenuTaskId`. The controller passes section CRUD callbacks; the view only fires them.

The view also handles the **destroy-commit** rule for in-flight rename: if `renamingId` is set when `destroy()` runs (e.g. the user navigated away mid-rename), the view reads the current input value, trims it, and if non-empty calls the rename callback before tearing down. Predictable, prevents lost work.

**New concepts to call out for Malin:**
- *Closure state per view instance* — `openMenuId` and `renamingId` aren't in the model. They're transient UI state that lives in the view's closure and gets reset on `destroy()`. Same pattern as `today.js` from M2.
- *Destroy-commit* — lifecycle hooks shouldn't silently lose user work. When the view is unmounted while the user is mid-rename, we read the input value and commit it before tearing down.
- *Element-not-found guard* — `state.areas.find((a) => a.id === areaId)` can return undefined (typo in URL hash, deleted area, etc.). Render a friendly empty-state instead of letting the template crash.

**Files:**
- Create: `src/views/area.js`

- [ ] **Step 1: Create the file**

Create `src/views/area.js`:

```js
// createAreaView(rootEl, { areaId, callbacks }) → { render(state), destroy(), enterRename(id) }
//
// Renders one area page: title, sections list, "＋ New section" footer.
// Closure state: openMenuId, renamingId, lastTriggerEl (for focus return).
//
// callbacks:
//   onAddSection({ areaId })
//   onAddTask({ sectionId })
//   onToggleSection({ sectionId, collapsed })
//   onCommitRename({ sectionId, name })   - empty/whitespace ⇒ cancel
//   onMoveUp({ sectionId })
//   onMoveDown({ sectionId })
//   onDeleteSection({ sectionId })
//   onToggleComplete(taskId)
//   onToggleStar(taskId, currentStarred)

import { bindActions, bindKeys, escapeHtml } from "../utils/dom.js";
import { renderSection } from "./section.js";

export function createAreaView(rootEl, { areaId, callbacks }) {
	let lastState = null;
	let openMenuId = null;
	let renamingId = null;
	let lastTriggerEl = null;

	const closeMenu = () => {
		if (!openMenuId) return;
		const trigger = lastTriggerEl;
		openMenuId = null;
		doRender();
		trigger?.focus();
	};

	const cancelRename = () => {
		if (!renamingId) return;
		const trigger = lastTriggerEl;
		renamingId = null;
		doRender();
		trigger?.focus();
	};

	const docClickHandler = (event) => {
		if (!openMenuId) return;
		if (rootEl.contains(event.target)) return;
		closeMenu();
	};
	document.addEventListener("click", docClickHandler);

	const sectionFromEvent = (actionEl) => {
		const sectionEl = actionEl.closest("[data-section-id]");
		if (!sectionEl || !lastState) return null;
		return lastState.sections.find(
			(s) => s.id === sectionEl.dataset.sectionId,
		) ?? null;
	};

	const taskFromEvent = (actionEl) => {
		const taskEl = actionEl.closest("[data-id]");
		if (!taskEl || !lastState) return null;
		return lastState.tasks.find((t) => t.id === taskEl.dataset.id) ?? null;
	};

	const unbindClick = bindActions(rootEl, {
		"add-section": () => callbacks.onAddSection({ areaId }),

		"add-task": (_event, actionEl) => {
			const s = sectionFromEvent(actionEl);
			if (s) callbacks.onAddTask({ sectionId: s.id });
		},

		"toggle-section": (_event, actionEl) => {
			const s = sectionFromEvent(actionEl);
			if (s) callbacks.onToggleSection({ sectionId: s.id, collapsed: !s.collapsed });
		},

		"open-section-menu": (event, actionEl) => {
			event.stopPropagation();
			const s = sectionFromEvent(actionEl);
			if (!s) return;
			if (openMenuId === s.id) {
				closeMenu();
				return;
			}
			openMenuId = s.id;
			lastTriggerEl = actionEl;
			doRender();
		},

		"rename-section": (_event, actionEl) => {
			const s = sectionFromEvent(actionEl);
			if (!s) return;
			// lastTriggerEl was captured when the menu opened — we want to
			// return focus to that ⋯ button after rename commit/cancel.
			openMenuId = null;
			renamingId = s.id;
			doRender();
		},

		"commit-rename": (_event, actionEl) => {
			// click delegation also fires this on blur via the handler at
			// the bottom of doRender (we listen to blur on the input).
			commitRenameFromInput(actionEl);
		},

		"move-up": (_event, actionEl) => {
			const s = sectionFromEvent(actionEl);
			openMenuId = null;
			if (s) callbacks.onMoveUp({ sectionId: s.id });
		},

		"move-down": (_event, actionEl) => {
			const s = sectionFromEvent(actionEl);
			openMenuId = null;
			if (s) callbacks.onMoveDown({ sectionId: s.id });
		},

		"delete-section": (_event, actionEl) => {
			const s = sectionFromEvent(actionEl);
			openMenuId = null;
			if (s) callbacks.onDeleteSection({ sectionId: s.id });
		},

		"toggle-complete": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (t) callbacks.onToggleComplete(t.id);
		},

		"toggle-star": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (t) callbacks.onToggleStar(t.id, t.starred);
		},
	});

	const unbindKeys = bindKeys(rootEl, {
		Escape: () => {
			if (renamingId) {
				cancelRename();
				return;
			}
			if (openMenuId) {
				closeMenu();
			}
		},
		Enter: (event, actionEl) => {
			if (
				renamingId &&
				actionEl?.dataset?.action === "commit-rename"
			) {
				event.preventDefault(); // prevent form-like default
				commitRenameFromInput(actionEl);
			}
		},
	});

	function commitRenameFromInput(inputEl) {
		const id = inputEl?.dataset?.sectionId ?? renamingId;
		if (!id) return;
		const value = (inputEl?.value ?? "").trim();
		const trigger = lastTriggerEl;
		renamingId = null;
		if (value) {
			callbacks.onCommitRename({ sectionId: id, name: value });
		} else {
			doRender();
		}
		trigger?.focus();
	}

	// Blur on the rename input also commits. We re-attach this in doRender
	// because the input is removed/re-added across renders.
	function attachBlurOnRenameInput() {
		const input = rootEl.querySelector(".section__rename-input");
		if (!input) return;
		input.addEventListener(
			"blur",
			() => {
				if (renamingId) commitRenameFromInput(input);
			},
			{ once: true },
		);
	}

	function doRender() {
		if (!lastState) return;
		rootEl.innerHTML = template(lastState, areaId, {
			openMenuId,
			renamingId,
		});
		attachBlurOnRenameInput();
		// Focus + select the rename input, if any.
		const input = rootEl.querySelector(".section__rename-input");
		if (input) {
			input.focus();
			input.select();
		}
	}

	return {
		render(state) {
			lastState = state;
			doRender();
		},
		// Public hook for the controller to flip a freshly-created section
		// into rename mode without the view subscribing to model changes.
		enterRename(sectionId) {
			renamingId = sectionId;
			doRender();
		},
		destroy() {
			// Destroy-commit: if a rename is in flight and the input has a
			// non-empty trimmed value, commit it before tearing down so
			// typed work isn't silently lost.
			if (renamingId) {
				const input = rootEl.querySelector(".section__rename-input");
				const value = (input?.value ?? "").trim();
				if (value) {
					callbacks.onCommitRename({ sectionId: renamingId, name: value });
				}
				renamingId = null;
			}
			unbindClick();
			unbindKeys();
			document.removeEventListener("click", docClickHandler);
			rootEl.innerHTML = "";
			lastState = null;
			openMenuId = null;
			lastTriggerEl = null;
		},
	};
}

function template(state, areaId, { openMenuId, renamingId }) {
	const area = state.areas.find((a) => a.id === areaId);
	if (!area) {
		return `
			<section class="area area--not-found">
				<h1 class="area__title">Area not found.</h1>
				<p class="area__not-found-help">
					<a href="#today" class="area__back-link">Back to Today</a>
				</p>
			</section>
		`;
	}

	const sections = state.sections
		.filter((s) => s.areaId === areaId)
		.sort((a, b) => a.order - b.order);

	const tasksBySection = new Map();
	for (const t of state.tasks) {
		if (!t.completed) {
			const list = tasksBySection.get(t.sectionId) ?? [];
			list.push(t);
			tasksBySection.set(t.sectionId, list);
		}
	}
	for (const list of tasksBySection.values()) {
		list.sort((a, b) => a.order - b.order);
	}

	const sectionHtml = sections
		.map((s, i) =>
			renderSection({
				section: s,
				tasks: tasksBySection.get(s.id) ?? [],
				isUndeletable: s.id === "focus-default",
				isFirst: i === 0,
				isLast: i === sections.length - 1,
				openMenuId,
				renamingId,
				now: state.now,
			}),
		)
		.join("");

	const titleHtml = area.name
		? `<h1 class="area__title">${escapeHtml(area.name)}</h1>`
		: "";

	return `
		<section class="area" data-area-id="${escapeHtml(area.id)}">
			<header class="area__header">${titleHtml}</header>
			<div class="area__sections">${sectionHtml}</div>
			<footer class="area__footer">
				<button type="button" class="area__add-section" data-action="add-section">＋ New section</button>
			</footer>
		</section>
	`;
}
```

`escapeHtml` is the canonical helper from Task 1's promotion — same function the other view files use.

- [ ] **Step 2: Run the suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: 85 tests still pass; Biome clean.

- [ ] **Step 3: Propose commit**

Proposed message:

```
feat(views): add createAreaView with section CRUD wiring + rename lifecycle
```

Files staged: `src/views/area.js`.

---

## Task 9 — Sidebar view: clickable wordmark, Focus button, `aria-current`

**Why:** M2's sidebar is non-interactive (Focus row is a `<li>` with no role). M3 makes the sidebar a navigation surface: the wordmark routes to Today, each area row routes to its area page. `aria-current="page"` reflects which one is active.

**New concepts to call out for Malin:**
- *`aria-current="page"`* — screen-reader way to say "this is the page you're on right now". Without it, a sighted user sees a highlighted active item but a screen-reader user can't tell.
- *Buttons over `<li>` for clickable rows* — `<li>` isn't a focusable, activatable element. Wrapping the content in a `<button>` (or making the `<li>` contain one) gives keyboard navigation and screen-reader semantics for free.

**Files:**
- Modify: `src/views/sidebar.js`

- [ ] **Step 1: Update the sidebar to accept `route` and render interactive items**

Replace the contents of `src/views/sidebar.js`:

```js
// createSidebarView(rootEl, { onToggleCollapse, onGoToday, onOpenArea })
//   → { render(state), destroy() }
//
// state expected: { areas, sections, tasks, settings, route, now }
// route:
//   { name: "today" }            → wordmark gets aria-current="page"
//   { name: "area", id: "..." }  → matching area row gets aria-current="page"
//
// Renders the wordmark, the toggle button, and the areas list.
// CSS owns the expanded/collapsed visual; the template is the same in both.

import { bindActions, escapeHtml } from "../utils/dom.js";

export function createSidebarView(
	rootEl,
	{ onToggleCollapse, onGoToday, onOpenArea },
) {
	const unbind = bindActions(rootEl, {
		"toggle-sidebar": () => onToggleCollapse(),
		"go-today": () => onGoToday(),
		"open-area": (_event, actionEl) => {
			const id = actionEl.dataset.id;
			if (id) onOpenArea(id);
		},
	});

	return {
		render(state) {
			rootEl.innerHTML = template(state);
		},
		destroy() {
			unbind();
			rootEl.innerHTML = "";
		},
	};
}

function template(state) {
	const route = state.route ?? { name: "today" };
	const todayActive = route.name === "today";
	const wordmarkAria = todayActive ? 'aria-current="page"' : "";
	const wordmarkActive = todayActive ? "is-active" : "";

	const items = state.areas
		.slice()
		.sort((a, b) => a.order - b.order)
		.map((area) => renderAreaItem(area, state, route))
		.join("");

	return `
		<button class="sidebar__home ${wordmarkActive}" type="button"
			data-action="go-today" ${wordmarkAria}>Ignite</button>
		<button class="sidebar__toggle" type="button"
			data-action="toggle-sidebar" aria-label="Toggle sidebar">
			<span class="sidebar__toggle-glyph" aria-hidden="true">≡</span>
		</button>
		<ul class="sidebar__areas">${items}</ul>
	`;
}

function renderAreaItem(area, state, route) {
	const sectionIds = new Set(
		state.sections.filter((s) => s.areaId === area.id).map((s) => s.id),
	);
	const count = state.tasks.filter(
		(t) => sectionIds.has(t.sectionId) && !t.completed,
	).length;

	const active = route.name === "area" && route.id === area.id;
	const aria = active ? 'aria-current="page"' : "";
	const activeClass = active ? "is-active" : "";

	return `
		<li class="sidebar__area-row" data-area-id="${escapeHtml(area.id)}">
			<button type="button" class="sidebar__area ${activeClass}"
				data-action="open-area" data-id="${escapeHtml(area.id)}" ${aria}>
				<span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
				<span class="sidebar__name">${escapeHtml(area.name)}</span>
				<span class="sidebar__count">${count}</span>
			</button>
		</li>
	`;
}
```

- [ ] **Step 2: Run the suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: 85 tests still pass; Biome clean.

- [ ] **Step 3: Propose commit**

Proposed message:

```
feat(views): sidebar wordmark + clickable area rows + aria-current
```

Files staged: `src/views/sidebar.js`.

---

## Task 10 — `app.js`: rename `#today-root` to `#main-root`

**Why:** Today and Area both mount inside the same route-swappable child. Calling it `#today-root` was honest in M2 (only Today existed). In M3 we rename it `#main-root` so both views share one shell. `#capture-root` and `#toast-root` are unchanged.

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Rename in `src/app.js`**

In the `mainEl.innerHTML` template, change `#today-root` to `#main-root`. Drop the `today` class:

```js
mainEl.innerHTML = `
	<section class="capture" id="capture-root"></section>
	<section id="main-root"></section>
`;
```

In the controller `els` object, change `todayRoot` to `mainRoot`:

```js
const controller = createController({
	models: { areas, sections, tasks, settings },
	els: {
		sidebarRoot,
		captureRoot: document.getElementById("capture-root"),
		mainRoot: document.getElementById("main-root"),
		toastRoot,
	},
});
```

(The controller signature change happens in Task 11.)

- [ ] **Step 2: Verify the suite + Biome (won't run yet — controller still expects todayRoot)**

This step **will fail** because the controller in main still expects `todayRoot`. That's fine — Task 11 lands the matching change. Skip the test+biome pass here; it'll run at the end of Task 11.

- [ ] **Step 3: Hold the commit until Task 11**

Don't propose a commit yet. Bundle this with Task 11's controller changes — those two files change together and a half-applied rename leaves the app broken.

---

## Task 11 — Controller: routing, area mount, body class, wordmark, focus management

**Why:** The single biggest behavioural file in M3. The controller now:
- Knows two routes (`today`, `area`), with a single `mainRoot` element for both
- Toggles `body.is-area-route` on every `applyState` so the capture bar hides on `#area/:id`
- Wires the new sidebar callbacks (`onGoToday`, `onOpenArea`)
- Builds the area view with all of its CRUD callbacks
- Orchestrates the cascade-delete + undo flow with `durationMs: 8000`
- Passes `route` into `state` so the sidebar can render `aria-current`

This task lands the routing scaffold + area mount + body class + wordmark, but leaves the section CRUD callbacks as **stub functions that just `console.log`** — Task 12 fills them in. Splitting it makes the diff readable and lets the executor manually verify the routing scaffold works in isolation.

**New concepts to call out for Malin:**
- *Single source of truth for route state* — the controller derives `route` from `window.location.hash` once per `applyState` call and threads it through `state`. Views don't read the URL directly.
- *Body-class as a layout switch* — `body.is-area-route` works the same way `body.is-sidebar-collapsed` did in M2: CSS owns the visual swap, JS only toggles the class. No layout math in JS.

**Files:**
- Modify: `src/controller.js`

- [ ] **Step 1: Restructure `createController` to use a mount table and unified main root**

Replace the contents of `src/controller.js`. The diff is large, so write it as a full replacement:

```js
// createController({ models, els }) → { start(), stop() }
//
// Wires sidebar (always-on), capture (always-on; CSS-hidden on area route),
// toast (always-on), and a route-driven main view (Today or Area). Subscribes
// to all model notifies; rebuilds state and re-renders sidebar + currentMainView.
// Owns the 60s clock tick that calls currentMainView.render(state) only.

import { FOCUS_DEFAULT_SECTION_ID } from "./model/areas.js";
import { createAreaView } from "./views/area.js";
import { createCaptureView } from "./views/capture.js";
import { createSidebarView } from "./views/sidebar.js";
import { createToastView } from "./views/toast.js";
import { createTodayView } from "./views/today.js";

const TICK_MS = 60_000;
const CASCADE_TOAST_MS = 8_000;

export function parseHash(hash) {
	const raw = (hash || "").replace(/^#/, "");
	if (raw === "" || raw === "today") return { name: "today" };
	const areaMatch = raw.match(/^area\/(.+)$/);
	if (areaMatch) return { name: "area", id: areaMatch[1] };
	return { name: "today" };
}

export function createController({ models, els }) {
	const { areas, sections, tasks, settings } = models;
	const { sidebarRoot, captureRoot, mainRoot, toastRoot } = els;

	let sidebar = null;
	let capture = null;
	let toast = null;
	let currentMainView = null;
	let currentRoute = { name: "today" };
	let tickHandle = null;
	let unsubs = [];

	async function buildState() {
		const [areaList, sectionList, taskList, settingsRecord] = await Promise.all(
			[areas.list(), sections.list(), tasks.list(), settings.get()],
		);
		return {
			areas: areaList,
			sections: sectionList,
			tasks: taskList,
			settings: settingsRecord,
			route: currentRoute,
			now: new Date(),
		};
	}

	async function applyState() {
		const state = await buildState();
		document.body.classList.toggle(
			"is-sidebar-collapsed",
			!!(state.settings.sidebarCollapsed ?? false),
		);
		document.body.classList.toggle(
			"is-area-route",
			currentRoute.name === "area",
		);
		sidebar?.render(state);
		currentMainView?.render(state);
	}

	function mountMainView(route) {
		currentMainView?.destroy();
		currentMainView = null;

		if (route.name === "today") {
			currentMainView = createTodayView(mainRoot, {
				onToggleComplete: (id) => tasks.toggleCompleted(id),
				onToggleStar: (id, currentStarred) =>
					tasks.update(id, { starred: !currentStarred }),
				onDelete: (taskData) => {
					tasks.remove(taskData.id);
					toast.show({
						message: "Task deleted",
						onUndo: () => tasks.restore(taskData),
					});
				},
			});
			return;
		}

		// route.name === "area"
		currentMainView = createAreaView(mainRoot, {
			areaId: route.id,
			callbacks: areaCallbacks(),
		});
	}

	function areaCallbacks() {
		// STUBS — Task 12 fills these in. Wired now so the area view boots
		// and routing can be manually verified in isolation.
		return {
			onAddSection: ({ areaId }) => {
				console.log("[stub] onAddSection", areaId);
			},
			onAddTask: ({ sectionId }) => {
				console.log("[stub] onAddTask", sectionId);
			},
			onToggleSection: ({ sectionId, collapsed }) => {
				console.log("[stub] onToggleSection", sectionId, collapsed);
			},
			onCommitRename: ({ sectionId, name }) => {
				console.log("[stub] onCommitRename", sectionId, name);
			},
			onMoveUp: ({ sectionId }) => {
				console.log("[stub] onMoveUp", sectionId);
			},
			onMoveDown: ({ sectionId }) => {
				console.log("[stub] onMoveDown", sectionId);
			},
			onDeleteSection: ({ sectionId }) => {
				console.log("[stub] onDeleteSection", sectionId);
			},
			onToggleComplete: (id) => tasks.toggleCompleted(id),
			onToggleStar: (id, currentStarred) =>
				tasks.update(id, { starred: !currentStarred }),
		};
	}

	function onHashChange() {
		currentRoute = parseHash(window.location.hash);
		mountMainView(currentRoute);
		applyState();
	}

	function start() {
		toast = createToastView(toastRoot);

		sidebar = createSidebarView(sidebarRoot, {
			onToggleCollapse: async () => {
				const current = await settings.get();
				await settings.setSidebarCollapsed(
					!(current.sidebarCollapsed ?? false),
				);
			},
			onGoToday: () => {
				window.location.hash = "#today";
			},
			onOpenArea: (id) => {
				window.location.hash = `#area/${id}`;
			},
		});

		capture = createCaptureView(captureRoot, {
			onSubmit: (title) =>
				tasks.create({
					sectionId: FOCUS_DEFAULT_SECTION_ID,
					title,
					starred: true,
				}),
		});

		unsubs.push(
			areas.subscribe(applyState),
			sections.subscribe(applyState),
			tasks.subscribe(applyState),
			settings.subscribe(applyState),
		);

		currentRoute = parseHash(window.location.hash);
		mountMainView(currentRoute);
		applyState();

		window.addEventListener("hashchange", onHashChange);

		tickHandle = setInterval(applyState, TICK_MS);
	}

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

	return { start, stop };
}
```

- [ ] **Step 2: Run the suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: 85 tests still pass. The controller doesn't have unit tests; this step confirms the rest of the codebase (which doesn't depend on these internals) compiles and lints clean.

- [ ] **Step 3: Smoke-test in the browser**

Run: `npm run dev`
- Boot at `/` → Today renders, capture bar visible, sidebar shows wordmark + Focus row.
- Click "Ignite" wordmark → URL shows `#today` (no visible change since already there). Wordmark gets `aria-current="page"`.
- Click Focus row → URL shows `#area/focus`. Capture bar disappears (CSS hides it via `is-area-route`). Area view renders with the "Tasks" section. Wordmark loses active highlight, Focus row gains it.
- Click `＋ New section` → console logs `[stub] onAddSection focus`.
- Click `＋ Add task` → console logs `[stub] onAddTask focus-default`.
- Manually set `location.hash = "#area/does-not-exist"` in DevTools → "Area not found." empty state with "Back to Today" link.
- Reload → state survives.

If any of those fail, stop and ask Malin before continuing.

- [ ] **Step 4: Propose commit (bundles Task 10's `app.js` rename)**

Proposed message:

```
feat(controller): wire area route + body class + sidebar callbacks (CRUD stubs)
```

Files staged: `src/controller.js`, `src/app.js`.

---

## Task 12 — Controller: section CRUD orchestration

**Why:** Replace the seven stub callbacks from Task 11 with the real implementations. This is where the Q5 cascade-delete-with-undo flow lives, where rename writes back to the model, where reorder calls `swapOrder`, and so on.

The controller is the only place that talks to both views and models, so it's the right place for the orchestration. The area view raises intent (e.g. `onDeleteSection`); the controller does the work (capture snapshots, call `removeMany` + `remove`, show the toast with `durationMs: 8000`, wire undo to `restoreMany` + `restore`).

**New concepts to call out for Malin:**
- *Snapshot before mutate* — for undo to work, the controller must read the section + its tasks **before** issuing the deletes. Once the delete returns, `db.get` would give back nothing.
- *Pluralisation in user-facing strings* — `1 task` vs `N tasks`. Tiny but worth getting right; users notice grammatical glitches.

**Files:**
- Modify: `src/controller.js`

- [ ] **Step 1: Replace `areaCallbacks` with the real implementation**

In `src/controller.js`, replace the `areaCallbacks()` function from Task 11 with:

```js
function areaCallbacks() {
	return {
		onAddSection: async ({ areaId }) => {
			// Create with a placeholder name; the area view auto-enters
			// rename mode on the freshly-created section because the next
			// applyState() includes the new section, and the area view's
			// closure state for `renamingId` is set right after. We do
			// that by reading the new section id from the create result,
			// then calling the area view's render — but the controller
			// doesn't have direct access to view closure. Instead, we
			// rely on a small extension: the area view exposes an
			// `enterRename(sectionId)` helper. (See note below.)
			const section = await sections.create({
				areaId,
				name: "New section",
			});
			currentMainView?.enterRename?.(section.id);
		},

		onAddTask: async ({ sectionId }) => {
			await tasks.create({
				sectionId,
				title: "New task",
			});
			// Tasks created from the per-section button are unstarred and
			// undated. They appear in the section's task list; M3 doesn't
			// inline-edit them (deferred per spec — task rename is M4+).
		},

		onToggleSection: async ({ sectionId, collapsed }) => {
			await sections.setCollapsed(sectionId, collapsed);
		},

		onCommitRename: async ({ sectionId, name }) => {
			await sections.rename(sectionId, name);
		},

		onMoveUp: async ({ sectionId }) => {
			await moveSection(sectionId, "up");
		},

		onMoveDown: async ({ sectionId }) => {
			await moveSection(sectionId, "down");
		},

		onDeleteSection: async ({ sectionId }) => {
			const allSections = await sections.list();
			const sectionSnapshot = allSections.find((s) => s.id === sectionId);
			if (!sectionSnapshot) return;
			const taskSnapshots = await tasks.listBySection(sectionId);

			await tasks.removeMany(taskSnapshots.map((t) => t.id));
			await sections.remove(sectionId);

			toast.show({
				message: cascadeMessage(sectionSnapshot.name, taskSnapshots.length),
				durationMs: CASCADE_TOAST_MS,
				onUndo: async () => {
					await sections.restore(sectionSnapshot);
					await tasks.restoreMany(taskSnapshots);
				},
			});
		},

		onToggleComplete: (id) => tasks.toggleCompleted(id),

		onToggleStar: (id, currentStarred) =>
			tasks.update(id, { starred: !currentStarred }),
	};
}

async function moveSection(sectionId, direction) {
	// reorderSections is pure — give it the current sorted area sections,
	// pick the neighbour, swap orders via the model.
	const all = await sections.list();
	const target = all.find((s) => s.id === sectionId);
	if (!target) return;
	const peers = all
		.filter((s) => s.areaId === target.areaId)
		.sort((a, b) => a.order - b.order);
	const idx = peers.findIndex((s) => s.id === sectionId);
	const neighbourIdx = direction === "up" ? idx - 1 : idx + 1;
	if (neighbourIdx < 0 || neighbourIdx >= peers.length) return;
	const neighbour = peers[neighbourIdx];
	await sections.swapOrder(target.id, neighbour.id);
}

function cascadeMessage(name, count) {
	if (count === 0) return `"${name}" deleted`;
	if (count === 1) return `"${name}" and 1 task deleted`;
	return `"${name}" and ${count} tasks deleted`;
}
```

The `currentMainView?.enterRename?.(section.id)` call uses `enterRename`, which was defined in Task 8 — no change to the area view needed here. (The optional chaining means this call is harmless even before the section is mounted; once the area view is current, the call flips it into rename mode for the freshly-created section.)

- [ ] **Step 2: Manual smoke-test in the browser**

Run: `npm run dev`
Walk through:
- Click `＋ New section` → new section appears at the bottom in rename mode, autofocused. Type "Routines", Enter → renamed to Routines.
- Open `⋯` on Routines → menu shows Rename / Move up / Move down / Delete (because Routines is not focus-default).
- Click Move up → swaps with Tasks. Move down on Routines is greyed (it's now last); Move up on Tasks is greyed (it's now first).
- Click Rename on Tasks → input replaces title with "Tasks" pre-selected. Type "Inbox", Enter → renamed.
- Click Delete on Routines → toast "Routines and 0 tasks deleted" (or "X tasks" if any). Click Undo within 8s → section restored.
- Open `⋯` on Inbox (the renamed Tasks) → menu shows Rename / Move up / Move down only; **no Delete**.
- Click section header → body collapses, chevron flips. Reload → state persists.
- Mid-rename, navigate to Today (Ignite wordmark) → if you typed something, it's committed before the view tears down.

If any flow misbehaves, stop and ask.

- [ ] **Step 3: Run the suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: 85 tests still pass; Biome clean.

- [ ] **Step 4: Propose commit**

Proposed message:

```
feat(controller): wire section CRUD + cascade-undo with 8s toast
```

Files staged: `src/controller.js`.

---

## Task 13 — CSS pass for area view, sections, touch targets, focus, motion

**Why:** Until now the area view has been semantically correct but visually unstyled. This task lands all M3 CSS in one pass: area shell, section header (with chevron rotation + collapsed body hide), per-section add-task, area footer add-section, menu dropdown, rename input, touch-target minimums (44×44 px), `:focus-visible` outlines on every new dynamic control, `prefers-reduced-motion` overrides, and `body.is-area-route #capture-root { display: none; }`.

Mobile-first per project convention: baseline styles assume narrow viewport, `@media (min-width: 768px)` and `@media (min-width: 1024px)` layer up.

**New concepts to call out for Malin:**
- *Attribute selector for state* — `[data-collapsed="true"] .section__body { display: none; }` lets the JS template stay branch-free; CSS owns the visual swap.
- *`prefers-reduced-motion`* — users with vestibular sensitivity can opt out of animations OS-wide. Honour it with a media query that disables transitions.
- *Touch target minimum* — `min-block-size: 44px; min-inline-size: 44px;` is the WCAG 2.1 AA target. Padding inside the button can shrink the visual size; the *hit zone* meets minimum.

**Files:**
- Modify: `main.css`

- [ ] **Step 1: Append M3 styles to `main.css`**

Read the existing `main.css` to find the right place — likely append at the bottom under a clearly marked section comment. Append:

```css
/* ----------------------------------------------------------------- */
/* M3 — Area view + sections                                          */
/* ----------------------------------------------------------------- */

/* Hide capture bar on area route — body class flipped by controller */
body.is-area-route #capture-root {
	display: none;
}

/* Area shell */
.area {
	display: flex;
	flex-direction: column;
	gap: 1.25rem;
	padding: var(--main-padding, 1.5rem);
}

.area__header {
	display: flex;
	align-items: baseline;
	gap: 0.75rem;
}

.area__title {
	font-size: 1.5rem;
	font-weight: 600;
	color: var(--text);
	margin: 0;
}

.area--not-found {
	color: var(--text-muted);
}

.area__back-link {
	color: var(--accent);
	text-decoration: underline;
}

.area__sections {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.area__footer {
	margin-top: 0.5rem;
}

.area__add-section {
	background: transparent;
	color: var(--text-muted);
	border: 1px dashed var(--border);
	border-radius: 8px;
	padding: 0.75rem 1rem;
	width: 100%;
	min-block-size: 44px;
	cursor: pointer;
	font: inherit;
	text-align: left;
}
.area__add-section:hover { color: var(--text); border-color: var(--accent); }
.area__add-section:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Section block */
.section {
	background: var(--surface);
	border-radius: 12px;
	border: 1px solid var(--border);
	overflow: hidden;
}

.section__header {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.25rem 0.5rem;
}

.section__toggle {
	flex: 1;
	display: flex;
	align-items: center;
	gap: 0.5rem;
	background: transparent;
	border: 0;
	color: inherit;
	font: inherit;
	text-align: left;
	padding: 0.5rem 0.75rem;
	min-block-size: 44px;
	cursor: pointer;
	border-radius: 6px;
}
.section__toggle:hover { background: var(--surface-hover); }
.section__toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.section__chevron {
	display: inline-block;
	font-size: 0.85rem;
	color: var(--text-muted);
	transition: transform 150ms ease;
}

.section__title {
	font-size: 1rem;
	font-weight: 600;
	color: var(--text);
}

/* Menu trigger */
.section__menu-btn {
	background: transparent;
	border: 0;
	color: var(--text-muted);
	font-size: 1.25rem;
	cursor: pointer;
	padding: 0;
	min-block-size: 44px;
	min-inline-size: 44px;
	border-radius: 6px;
}
.section__menu-btn:hover { color: var(--text); background: var(--surface-hover); }
.section__menu-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Inline rename input */
.section__header--editing {
	padding: 0.25rem 0.5rem;
}
.section__rename-input {
	flex: 1;
	background: var(--surface-elevated, var(--surface));
	color: var(--text);
	border: 1px solid var(--accent);
	border-radius: 6px;
	padding: 0.5rem 0.75rem;
	font: inherit;
	min-block-size: 44px;
}
.section__rename-input:focus { outline: none; }

/* Section body */
.section__body {
	padding: 0 0.5rem 0.75rem;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.section__tasks {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.section__add-task {
	align-self: flex-start;
	background: transparent;
	border: 0;
	color: var(--text-muted);
	font: inherit;
	cursor: pointer;
	padding: 0.5rem 0.75rem;
	min-block-size: 44px;
	border-radius: 6px;
}
.section__add-task:hover { color: var(--text); background: var(--surface-hover); }
.section__add-task:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* Collapsed state — CSS hook on the outer <section> */
.section[data-collapsed="true"] .section__body {
	display: none;
}
.section[data-collapsed="true"] .section__chevron {
	transform: rotate(-90deg);
}

/* Section dropdown menu */
.section-menu {
	position: relative;
	margin: 0 0.5rem;
	list-style: none;
	padding: 0.25rem;
	background: var(--surface-elevated, var(--surface));
	border: 1px solid var(--border);
	border-radius: 8px;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
	display: flex;
	flex-direction: column;
}

.section-menu__item {
	display: block;
	width: 100%;
	background: transparent;
	border: 0;
	color: var(--text);
	font: inherit;
	text-align: left;
	padding: 0.5rem 0.75rem;
	min-block-size: 44px;
	cursor: pointer;
	border-radius: 6px;
}
.section-menu__item:hover:not(:disabled) { background: var(--surface-hover); }
.section-menu__item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.section-menu__item:disabled { color: var(--text-muted); cursor: not-allowed; }

/* Sidebar wordmark + active state */
.sidebar__home {
	background: transparent;
	border: 0;
	color: var(--text);
	font-size: 1.1rem;
	font-weight: 700;
	cursor: pointer;
	padding: 0.75rem 1rem;
	min-block-size: 44px;
	text-align: left;
	width: 100%;
}
.sidebar__home:hover { color: var(--accent); }
.sidebar__home:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sidebar__home.is-active { color: var(--accent); }

/* Sidebar area row buttons */
.sidebar__area {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	width: 100%;
	background: transparent;
	border: 0;
	color: var(--text);
	font: inherit;
	text-align: left;
	padding: 0.5rem 0.75rem;
	min-block-size: 44px;
	cursor: pointer;
	border-radius: 6px;
}
.sidebar__area:hover { background: var(--surface-hover); }
.sidebar__area:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.sidebar__area.is-active { color: var(--accent); background: var(--surface-hover); }

/* Reduced motion: disable chevron rotation animation */
@media (prefers-reduced-motion: reduce) {
	.section__chevron { transition: none; }
}

/* Tablet+ */
@media (min-width: 768px) {
	.area { padding: 2rem; }
}

/* Desktop+ */
@media (min-width: 1024px) {
	.area__title { font-size: 1.75rem; }
}
```

If any of `--surface`, `--surface-hover`, `--surface-elevated`, `--accent`, `--text`, `--text-muted`, `--border` aren't defined in `base.css` / existing `main.css`, **stop and ask Malin** before adding new tokens — `design-system/` is read-only and `base.css` is off-limits.

- [ ] **Step 2: Manual smoke-test in the browser**

Run: `npm run dev`
- Today: capture bar visible.
- Switch to Focus area: capture bar disappears.
- Section block: chevron rotates on collapse; body hides cleanly.
- `⋯` menu: opens below trigger; click outside closes; Esc closes; Tab cycles; focus returns to `⋯` after closing.
- Rename: input fills the header width; `:focus-visible` outline visible if you Tab to it.
- Mobile (DevTools 375px wide): all buttons feel comfortable to tap; `＋ Add task`, `＋ New section`, `⋯`, header — none cramped.
- DevTools → Rendering → "Emulate CSS prefers-reduced-motion" = "reduce" → expand/collapse a section → no chevron rotation animation.

If any visual glitch, stop and ask.

- [ ] **Step 3: Run Biome (CSS-aware) + tests**

Run: `npm run test:run && npx biome check .`
Expected: 85 tests still pass; Biome clean.

- [ ] **Step 4: Propose commit**

Proposed message:

```
style: add CSS for area view, sections, menu, touch targets, reduced-motion
```

Files staged: `main.css`.

---

## Task 14 — Manual end-to-end verification + XSS spot-check

**Why:** The spec defines a 16-step manual checklist and an XSS spot-check. Run them now, end to end, before declaring M3 done.

**Files:** No file changes. This is a verification pass.

- [ ] **Step 1: Run the full automated suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: **≈ 85 tests** passing (M2: 67 + 7 sections + 2 tasks + 3 areas + 6 reorderSections = 85). Biome clean. No console errors during dev.

- [ ] **Step 2: Walk the 16-step manual checklist**

Run `npm run dev`. Open Brave/Chrome desktop + DevTools mobile viewport. Follow these in order:

1. **Boot** — fresh state shows sidebar with clickable "Ignite" wordmark (`aria-current="page"`) and Focus row. Today renders as in M2.
2. **Sidebar Focus click** — routes to `#area/focus`. Capture bar disappears. Wordmark loses active highlight; Focus row gains it (`aria-current="page"`).
3. **Initial Area view content** — shows "Focus" title, one section "Tasks" (the renamed seed), any captured tasks from M2 sit inside it. Below: `＋ New section`.
4. **Wordmark back to Today** — click "Ignite" → routes to `#today`. Capture bar reappears. Sidebar highlights swap back.
5. **Browser back/forward** — back/forward through Today ↔ Focus works without refresh; current view re-renders correctly each time.
6. **Add section** — click `＋ New section` → new section appears at the bottom with name in rename input, autofocused, text selected. Type "Routines", press Enter → committed.
7. **Rename existing section** — open `⋯` on "Tasks" → click Rename → input replaces title with "Tasks" pre-selected. Type "Inbox", Enter → renamed. Switch to Today via wordmark → capture bar still places new tasks into the renamed section (proves id-not-name contract).
8. **Rename → Esc cancels** — open Rename, type junk, Esc → reverts to old name. Focus returns to `⋯`.
9. **Rename → empty cancels** — open Rename, clear input, Enter → reverts to old name (no error).
10. **Reorder** — with 3+ sections: open `⋯` on middle section → Move up swaps with predecessor; Move up on first is greyed; Move down on last is greyed.
11. **Collapse / expand** — click section header → body hides, chevron rotates. `aria-expanded` flips. Hard reload → state persists. Click `⋯` inside header → menu opens, doesn't toggle collapse.
12. **Delete cascade + undo** — section with 3 tasks: open `⋯` → Delete → section + tasks vanish, toast: *"Inbox and 3 tasks deleted"*. Click **Undo** within 8s → section returns at its original `order`, all 3 tasks restored. Repeat, let timer expire → toast dismisses, section stays gone.
13. **`focus-default` is undeletable** — open `⋯` on the renamed-Tasks section → menu shows Rename / Move up / Move down only; **no Delete item**.
14. **Unknown route** — manually set `location.hash = "#area/does-not-exist"` → empty-state in main: *"Area not found."* with link back to Today.
15. **Mobile (<768px)** — sidebar stacks above main. Section header click target is comfortable (≥ 44px). `⋯` reachable. `＋ Add task` doesn't get cut off.
16. **Keyboard-only walk-through** — tab from URL bar:
    - Tab to wordmark, Enter → goes to Today
    - Tab to Focus row, Enter → goes to Focus area
    - Tab through area: section toggle, `⋯`, `＋ Add task`, `＋ New section`
    - Enter on `⋯` → menu opens, focus on Rename. Tab through items. Esc → menu closes, focus returns to `⋯`.
    - Enter on `⋯` → Rename → input focused, text selected. Type. Esc → cancels, focus returns to `⋯`. Repeat with Enter to commit.
    - Enter on `＋ New section` → new section appears in rename mode, input focused.
    - Delete a section → toast announced (aria-live polite). Tab to Undo → Enter → restored.
    - Reload → state survives; no lost focus crash.

If any step fails, stop and report.

- [ ] **Step 3: XSS spot-check on user input**

Type each string below into a section name (rename) AND a task title (capture bar). Verify each renders as **literal text** in the DOM and triggers no JS execution / no broken markup:

- `<img src=x onerror=alert(1)>`
- `<script>alert(1)</script>`
- `"; alert(1); //`
- `<b>bold?</b>`

Inspect the DOM (F12 → Elements) and confirm each character is escaped (`&lt;img …&gt;`, etc.).

- [ ] **Step 4: Console + Biome final clean**

Run: `npm run test:run && npx biome check .`
Browser console after the full walk: zero errors. (Favicon 404 still acceptable.)

- [ ] **Step 5: No commit needed for verification**

This task changes no files. If anything failed during the walk, fix and commit under that fix's own scope. Otherwise, M3 is shippable.

---

## Done-criteria recap

- All tests pass: `npm test` (≈ 85 passing)
- Biome clean: `npx biome check .`
- 16 manual checks pass in real browser (Brave/Chrome desktop + mobile viewport)
- XSS spot-check clean on section name and task title
- No console errors. Favicon 404 still acceptable.
- Git head ≈ 12-14 atomic commits past `d5d8712`. One task = one commit, except Task 10 + Task 11 which bundle (the rename and the controller change land together to keep the tree green).

---

## Open follow-ups (post-M3)

- `+ New area` + sidebar area CRUD (M4-flavoured)
- Move task to another section / area (needs a picker)
- Task date picker / starring inline (M4 prerequisite)
- Drag-to-reorder for sections (Up/Down stays as fallback)
- Toast queueing — currently sequential deletes lose the first snapshot
- Pause toast timer on keyboard focus — improves cascade-undo a11y further
- Full arrow-key navigation in section menu (Tab cycling is M3-acceptable)
- Global keyboard shortcuts (`/`, `n`) using the new `bindKeys` helper
