# Move Task Between Sections (M6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user move a task to any section in any area, from both the area view and the Today view, via a picker that opens as a sub-face of the existing task `⋯` menu.

**Architecture:** One model method (`tasks.moveToSection`, append-only — never reorders peers), one shared pure view unit (`renderMovePicker`), one controller handler (`handleMoveTaskToSection` with toast + Undo, wired into both view mounts), and per-view wiring in `area.js` (via `section.js`) and `today.js`. The picker is itself a `role="menu"`, so it reuses the hardened menu machinery (open/close, arrow-key nav, `isRendering` blur-guard, post-render focus) unchanged.

**Tech Stack:** Vanilla JS (ES modules), MVC, IndexedDB (via `src/model/db.js` wrapper), Vitest (model-seam TDD only), Biome (format + lint), Vite dev server, Claude Preview MCP for E2E.

**Source spec:** [docs/superpowers/specs/2026-05-31-ignite-move-task-between-sections-design.md](../specs/2026-05-31-ignite-move-task-between-sections-design.md) — read its **Invariants** section before starting. This plan implements every invariant; do not simplify them away.

---

## Project conventions (read before executing)

- **Commits:** Do **NOT** run `git commit`. At each task's commit step, **propose** the commit message + the exact files to stage; **Malin commits via GitHub Desktop as sole author** (no `Co-Authored-By` line).
- **TDD only on the pure-function seam.** Task 1 (`moveToSection`) is TDD (red → green). All view/controller tasks are verified manually + Preview MCP E2E (Task 8) — no JSDOM tests.
- **Do not touch** `base.css`, anything in `design-system/`, or `.claude/`. CSS edits go in `main.css` (project root).
- **No silent restructures.** This plan keeps `today.js`'s established positional-arg threading rather than refactoring to an options object (that's a flagged v0.2 candidate). Follow it as written.
- **Biome auto-formats on save** (format hook where `biome.json` exists). Still run `npx biome check .` before committing code/CSS tasks.
- **Test commands:** `npx vitest run tests/unit/tasks.test.js` (single file), `npx vitest run` (full suite). Baseline is **127 tests passing**; this plan adds **7** → **134**.

---

## File Structure

| File | New/Modify | Responsibility |
|---|---|---|
| `src/model/tasks.js` | Modify | Add `async moveToSection(id, targetSectionId)` — validate task + target section, no-op-without-notify if already there, else re-point `sectionId` + append `order = max+1`, `put` + one `notify()`. Update JSDoc contract block. |
| `tests/unit/tasks.test.js` | Modify | New `describe("createTaskModel — moveToSection")`, 7 cases. |
| `src/views/move-picker.js` | **New** | `renderMovePicker({ task, areas, sections }) → string`. Pure template: target sections grouped by area, "← Back" last, empty-picker hint. Imported by `area.js` and `today.js`. |
| `src/views/section.js` | Modify | Thread `taskMenuMode` + `movePickerHtml` + `hasMoveTargets`; add "Move to…" item to the task action menu; inject the picker when in picker mode. |
| `src/views/area.js` | Modify | New closure state (`taskMenuMode`, `pendingFocusMoveSourceSectionId`) + 3 action handlers + `open-menu`/`closeTaskMenu`/`destroy` resets + cross-area focus fallback in `doRender`; compute + thread picker in `template`. Imports `renderMovePicker`. |
| `src/views/today.js` | Modify | New closure state (`taskMenuMode`) + 3 action handlers + `open-menu`/`closeMenu`/`destroy` resets; compute + thread picker (positional) through `template`/`renderNextCard`/`renderGroup`/`renderTaskRowWithMenu`; add "Move to…" item. Imports `renderMovePicker`. |
| `src/controller.js` | Modify | `MOVE_TOAST_MS = 5_000` + shared `handleMoveTaskToSection` (snapshot → move → toast/Undo, swallow `/not found/i`), wired as `onMoveTaskToSection` into both mounts. |
| `main.css` | Modify | `.task-menu--picker` (scroll), `.task-menu__group`, `.task-menu__group-label`, `.task-menu__item--back`. Reuse existing `.task-menu__item:disabled` for the empty hint. |

**Execution order & dependencies:** 1 (model) → 2 (picker view) → 3 (controller) → 4 (`section.js`) → 5 (`area.js`) → 6 (`today.js`) → 7 (CSS) → 8 (E2E). The controller handler (Task 3) lands before the view wiring (Tasks 5–6) so `callbacks.onMoveTaskToSection` always exists when a picker target is clicked. Tasks 4–5 have a non-breaking intermediate state: `section.js` receiving `undefined` for the new params hides "Move to…" and never injects the picker — behaviour is unchanged until `area.js` threads them.

---

### Task 1: Model — `tasks.moveToSection` (TDD)

**Files:**
- Test: `tests/unit/tasks.test.js` (append a new `describe` block)
- Modify: `src/model/tasks.js` (add method after `swapOrder`; add JSDoc line)

- [ ] **Step 1: Write the failing tests**

Append this block to the end of `tests/unit/tasks.test.js` (after the `createTaskModel — rename` describe, before EOF). It reuses the existing `freshModel()` helper and the established `db.put("sections", …)` seeding pattern (see the `listByArea` test):

```js
describe("createTaskModel — moveToSection", () => {
	async function seedSection(db, id, areaId = "a1", order = 0) {
		await db.put("sections", { id, areaId, name: id, order, collapsed: false });
	}

	it("re-points sectionId and appends to the target end, notifying once", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		await seedSection(db, "s2");
		const t = await model.create({ sectionId: "s1", title: "Move me" });
		await model.create({ sectionId: "s2", title: "Existing" }); // order 0 in s2

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		const result = await model.moveToSection(t.id, "s2");
		expect(result).toBeUndefined();

		const inS2 = await model.listBySection("s2");
		const moved = inS2.find((x) => x.id === t.id);
		expect(moved.sectionId).toBe("s2");
		expect(moved.order).toBe(1); // appended after the existing order-0 task
		expect(calls).toEqual(["notified"]); // single notify
	});

	it("is gap-robust: appends max(order)+1, not a colliding value", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		await seedSection(db, "s2");
		// Two tasks in s2, then delete the first → leaves orders [_, 1] (gap at 0).
		const keep0 = await model.create({ sectionId: "s2", title: "Zero" }); // order 0
		const keep1 = await model.create({ sectionId: "s2", title: "One" }); // order 1
		await model.remove(keep0.id); // s2 now has only order 1
		const t = await model.create({ sectionId: "s1", title: "Move me" });

		await model.moveToSection(t.id, "s2");

		const inS2 = await model.listBySection("s2");
		const moved = inS2.find((x) => x.id === t.id);
		expect(moved.order).toBe(2); // max(1)+1, not 1 (no collision with keep1)
		expect(keep1.order).toBe(1);
	});

	it("appends order 0 into an empty target section", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		await seedSection(db, "s2");
		const t = await model.create({ sectionId: "s1", title: "Move me" });

		await model.moveToSection(t.id, "s2");

		const [moved] = await model.listBySection("s2");
		expect(moved.id).toBe(t.id);
		expect(moved.order).toBe(0);
	});

	it("no-ops without notifying when already in the target section", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		const t = await model.create({ sectionId: "s1", title: "Stay" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.moveToSection(t.id, "s1");
		expect(calls).toEqual([]); // no notify, no write
		const [reread] = await model.listBySection("s1");
		expect(reread.order).toBe(t.order); // unchanged
	});

	it("throws Task not found for a missing task id", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s2");
		await expect(model.moveToSection("nope-id", "s2")).rejects.toThrow(
			/Task not found/,
		);
	});

	it("throws Section not found for a missing target section", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		const t = await model.create({ sectionId: "s1", title: "Move me" });
		await expect(model.moveToSection(t.id, "ghost-section")).rejects.toThrow(
			/Section not found/,
		);
	});

	it("preserves every other field on the moved task", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		await seedSection(db, "s2");
		const t = await model.create({
			sectionId: "s1",
			title: "Meeting",
			starred: true,
			critical: true,
			dueAt: "2026-06-01T10:00:00.000Z",
			recurrence: "weekly",
			leadTime: 15,
			notes: "bring laptop",
		});

		await model.moveToSection(t.id, "s2");

		const [moved] = await model.listBySection("s2");
		expect(moved.title).toBe("Meeting");
		expect(moved.starred).toBe(true);
		expect(moved.critical).toBe(true);
		expect(moved.completed).toBe(false);
		expect(moved.dueAt).toBe("2026-06-01T10:00:00.000Z");
		expect(moved.recurrence).toBe("weekly");
		expect(moved.leadTime).toBe(15);
		expect(moved.notes).toBe("bring laptop");
		expect(moved.createdAt).toBe(t.createdAt);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/tasks.test.js -t "moveToSection"`
Expected: FAIL — all 7 cases error with `model.moveToSection is not a function`.

- [ ] **Step 3: Implement `moveToSection`**

In `src/model/tasks.js`, insert this method **after** the `swapOrder` method (which ends at the line `},` following its `notify();`) and **before** `restoreMany`:

```js
		async moveToSection(id, targetSectionId) {
			const stored = await db.get("tasks", id);
			if (!stored) throw new Error(`Task not found: ${id}`);
			const targetSection = await db.get("sections", targetSectionId);
			if (!targetSection)
				throw new Error(`Section not found: ${targetSectionId}`);
			const current = fromStorage(stored);
			// Already there → no-op, no notify (avoids a spurious re-render).
			if (current.sectionId === targetSectionId) return;
			// Append to the target END. max(order)+1 is gap-robust: delete/move
			// can leave holes, so we never reuse a count. This APPENDS and never
			// reorders peers, keeping clear of the M4 !completed reorder invariant.
			const siblings = await db.getByIndex(
				"tasks",
				"sectionId",
				targetSectionId,
			);
			const maxOrder = siblings.reduce((max, t) => Math.max(max, t.order), -1);
			const moved = { ...current, sectionId: targetSectionId, order: maxOrder + 1 };
			await db.put("tasks", toStorage(moved));
			notify();
		},
```

- [ ] **Step 4: Add the JSDoc contract line**

In the contract block at the top of `src/model/tasks.js`, add this line immediately after the `swapOrder(idA, idB) → Promise<void>,` line:

```js
//   moveToSection(id, targetSectionId) → Promise<void>,  // re-points sectionId, appends to target end
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/tasks.test.js -t "moveToSection"`
Expected: PASS — 7 passed.

- [ ] **Step 6: Run the full suite + lint**

Run: `npx vitest run` → Expected: **134 passed**.
Run: `npx biome check .` → Expected: no errors (formatting auto-applied).

- [ ] **Step 7: Propose commit (Malin commits via GitHub Desktop, no Co-Authored-By)**

- Message: `feat(model): tasks.moveToSection — append to target section end`
- Stage: `src/model/tasks.js`, `tests/unit/tasks.test.js`

---

### Task 2: View — `renderMovePicker` (new pure template)

**Files:**
- Create: `src/views/move-picker.js`

- [ ] **Step 1: Create the file**

Write `src/views/move-picker.js`:

```js
// renderMovePicker({ task, areas, sections }) → string
//
// Pure template. Renders the move-target picker as a sub-face of the task
// ⋯ menu: every section in every area EXCEPT the task's current section,
// grouped by area, with a "← Back" row LAST. Shared by area.js (threaded
// through section.js) and today.js.
//
// The returned markup is itself role="menu", so it reuses the views'
// existing menu machinery (findOpenMenu*, arrow-key nav, isRendering blur
// guard, post-render focus) unchanged. Targets are role="menuitem"; the
// group label <p> is NOT a menuitem (arrow-nav skips it) and is
// aria-hidden — the role="group" aria-label already names the area for SRs.
//
// Back is LAST so the "focus first [role=menuitem]" machinery lands on the
// first TARGET when the picker opens, not on Back.
//
// Empty-picker race: "Move to…" is gated upstream by hasMoveTargets, but the
// other sections can be deleted between opening the picker and its re-render.
// If zero target groups remain, render a single DISABLED "No other sections"
// menuitem before Back so the picker is never a bare Back-only dead-end
// (nextEnabledIndex + the :not([disabled]) focus guard skip it).
//
// escapeHtml is applied to area names (group aria-label + visible label),
// section names, AND data-target-section-id — names are user-controlled and
// IDs are escaped as defense-in-depth (matches the rename spec).

import { escapeHtml } from "../utils/dom.js";

export function renderMovePicker({ task, areas, sections }) {
	const currentSectionId = task.sectionId;
	const areasSorted = [...areas].sort((a, b) => a.order - b.order);

	const groups = areasSorted
		.map((area) => {
			const targets = sections
				.filter((s) => s.areaId === area.id && s.id !== currentSectionId)
				.sort((a, b) => a.order - b.order);
			// Skip the area entirely if it has no valid targets.
			if (targets.length === 0) return "";
			const items = targets
				.map(
					(s) =>
						`<button class="task-menu__item" type="button" role="menuitem" tabindex="-1"
							data-action="pick-move-target"
							data-target-section-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`,
				)
				.join("");
			return `
				<div class="task-menu__group" role="group" aria-label="${escapeHtml(area.name)}">
					<p class="task-menu__group-label" aria-hidden="true">${escapeHtml(area.name)}</p>
					${items}
				</div>
			`;
		})
		.join("");

	const emptyHint =
		groups.trim() === ""
			? `<button class="task-menu__item" type="button" role="menuitem" tabindex="-1" disabled>No other sections</button>`
			: "";

	return `
		<div class="task-menu task-menu--picker" role="menu" aria-label="Move to section">
			${groups}
			${emptyHint}
			<button class="task-menu__item task-menu__item--back" type="button" role="menuitem" tabindex="-1"
				data-action="move-picker-back">← Back</button>
		</div>
	`;
}
```

- [ ] **Step 2: Verify it parses + lints**

Run: `npx biome check src/views/move-picker.js`
Expected: no errors (no test — pure template, per the no-JSDOM convention).

- [ ] **Step 3: Propose commit**

- Message: `feat(views): renderMovePicker — grouped move-target picker`
- Stage: `src/views/move-picker.js`

---

### Task 3: Controller — `handleMoveTaskToSection` + `MOVE_TOAST_MS`

**Files:**
- Modify: `src/controller.js`

This is wired into BOTH view mounts via a single shared function (mirrors the existing shared `handleTaskDelete`, which is referenced by both the Today and Area mounts). The handler is harmless until the views call it (Tasks 5–6).

- [ ] **Step 1: Add the duration constant**

In `src/controller.js`, find:

```js
const TICK_MS = 60_000;
const CASCADE_TOAST_MS = 8_000;
```

Replace with:

```js
const TICK_MS = 60_000;
const CASCADE_TOAST_MS = 8_000;
// A move is non-destructive — same urgency as a single-task delete-undo
// (5s), not the 8s cascade window reserved for destructive multi-item ops.
const MOVE_TOAST_MS = 5_000;
```

- [ ] **Step 2: Add the shared handler**

In `src/controller.js`, insert this function immediately **after** the `handleTaskDelete` function (after its closing `}` at the end of the `else { … }` block) and **before** `function mountMainView(route)`:

```js
	async function handleMoveTaskToSection({ taskId, targetSectionId }) {
		// Snapshot BEFORE the move (for undo).
		const snapshot = (await tasks.list()).find((t) => t.id === taskId);
		if (!snapshot) return; // task already gone (race)
		const fromSectionId = snapshot.sectionId;
		const fromOrder = snapshot.order;
		if (fromSectionId === targetSectionId) return; // no-op (also omitted in picker)

		try {
			await tasks.moveToSection(taskId, targetSectionId);
		} catch (err) {
			// Cascade race: task OR target section deleted mid-flow. The
			// triggering deletion fires its own notify → re-render closes the
			// (already-null) menu. Mirrors onCommitRename's swallow.
			if (/not found/i.test(err.message)) return;
			throw err;
		}

		// Friendly "Area › Section" label for the toast.
		const targetSection = (await sections.list()).find(
			(s) => s.id === targetSectionId,
		);
		const targetArea = targetSection
			? (await areas.list()).find((a) => a.id === targetSection.areaId)
			: null;
		const label = !targetSection
			? "section"
			: targetArea
				? `${targetArea.name} › ${targetSection.name}`
				: targetSection.name;

		toast.show({
			message: `Moved to ${label}`,
			durationMs: MOVE_TOAST_MS,
			onUndo: async () => {
				// Exact restore — the move touched only this task (append left
				// peers untouched; the source kept the gap this task vacated).
				try {
					await tasks.update(taskId, {
						sectionId: fromSectionId,
						order: fromOrder,
					});
				} catch (err) {
					if (/not found/i.test(err.message)) return; // task deleted since the move
					throw err;
				}
			},
		});
	}
```

- [ ] **Step 3: Wire into the Today mount**

In `mountMainView`, the `route.name === "today"` branch calls `createTodayView(mainRoot, { … })`. Add this line to that callbacks object, after the `onCommitTaskRename: …` entry (after its closing `},`):

```js
				onMoveTaskToSection: handleMoveTaskToSection,
```

- [ ] **Step 4: Wire into the Area mount**

In `areaCallbacks()`, add the same line. Place it after the `onCommitTaskRename` entry's closing `},` (and before `onMoveUp`):

```js
			onMoveTaskToSection: handleMoveTaskToSection,
```

- [ ] **Step 5: Verify lint + suite still green**

Run: `npx biome check .` → Expected: no errors.
Run: `npx vitest run` → Expected: **134 passed** (controller has no unit tests; this confirms nothing broke).

- [ ] **Step 6: Propose commit**

- Message: `feat(controller): onMoveTaskToSection with toast + undo`
- Stage: `src/controller.js`

---

### Task 4: View — `section.js` threading + "Move to…" + picker injection

**Files:**
- Modify: `src/views/section.js`

`section.js` is a pure template that does NOT import `renderMovePicker` — it receives a pre-rendered `movePickerHtml` string from `area.js` (Task 5). This task adds three params and the rendering logic; until Task 5 threads them, they arrive `undefined` (Move to… hidden, picker never injected — non-breaking).

- [ ] **Step 1: Update the `renderSection` JSDoc + signature**

In the `renderSection` opts doc comment, add these three lines after the `pendingRenameTaskValue` line:

```js
//   taskMenuMode           - 'actions' | 'picker'; sub-face of the open task menu
//   movePickerHtml         - pre-rendered picker string for the open task, or null
//   hasMoveTargets         - true when ≥1 other section exists (gates "Move to…")
```

Then update the `renderSection({ … })` destructure to add `taskMenuMode`, `movePickerHtml`, `hasMoveTargets`. It currently ends:

```js
	renamingTaskId,
	pendingRenameTaskValue,
	now,
}) {
```

Replace with:

```js
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	movePickerHtml,
	hasMoveTargets,
	now,
}) {
```

- [ ] **Step 2: Pass the params into `renderBody`**

`renderSection` calls `renderBody(tasks, now, openTaskMenuId, renamingTaskId, pendingRenameTaskValue)`. Replace that call with:

```js
	const body = renderBody(
		tasks,
		now,
		openTaskMenuId,
		renamingTaskId,
		pendingRenameTaskValue,
		taskMenuMode,
		movePickerHtml,
		hasMoveTargets,
	);
```

- [ ] **Step 3: Update `renderBody` signature + thread into the row renderer**

Replace the whole `renderBody` function with:

```js
function renderBody(
	tasks,
	now,
	openTaskMenuId,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	movePickerHtml,
	hasMoveTargets,
) {
	const rows = tasks
		.map((t, i) =>
			renderTaskRowWithMenu(t, {
				now,
				isFirst: i === 0,
				isLast: i === tasks.length - 1,
				openTaskMenuId,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
				movePickerHtml,
				hasMoveTargets,
			}),
		)
		.join("");
	return `
		<div class="section__body">
			<ul class="section__tasks">${rows}</ul>
		</div>
	`;
}
```

- [ ] **Step 4: Update `renderTaskRowWithMenu` — accept params, inject picker, add "Move to…"**

Replace the whole `renderTaskRowWithMenu` function (the section.js local one) with:

```js
function renderTaskRowWithMenu(
	task,
	{
		now,
		isFirst,
		isLast,
		openTaskMenuId,
		renamingTaskId,
		pendingRenameTaskValue,
		taskMenuMode,
		movePickerHtml,
		hasMoveTargets,
	},
) {
	const isRenaming = renamingTaskId === task.id;
	if (isRenaming) {
		// Rename input replaces the row's children — no menu injection,
		// no checkbox / star / ⋯ . Mutually exclusive with menu state.
		return renderTaskRow(task, {
			now,
			renaming: true,
			pendingRenameValue: pendingRenameTaskValue,
		});
	}

	const isOpen = openTaskMenuId === task.id;
	const row = renderTaskRow(task, { now, isOpen });
	if (!isOpen) return row;

	// Picker face: replace the action menu with the pre-rendered picker.
	if (taskMenuMode === "picker" && movePickerHtml) {
		return row.replace("</li>", `${movePickerHtml}</li>`);
	}

	// Actions face. Boundary moves are OMITTED (not greyed) — mirrors the
	// section + area menus. "Move to…" sits after Move up/down and before
	// Delete (Delete stays last — destructive, hardest to mis-click).
	const moveUpItem = isFirst
		? ""
		: `<button class="task-menu__item" type="button" data-action="move-task-up"
				role="menuitem" tabindex="-1">Move up</button>`;
	const moveDownItem = isLast
		? ""
		: `<button class="task-menu__item" type="button" data-action="move-task-down"
				role="menuitem" tabindex="-1">Move down</button>`;
	const moveToItem = hasMoveTargets
		? `<button class="task-menu__item" type="button" data-action="move-task-to"
				role="menuitem" tabindex="-1" aria-haspopup="menu">Move to…</button>`
		: "";
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="rename-task"
				role="menuitem" tabindex="-1">Rename</button>
			${moveUpItem}
			${moveDownItem}
			${moveToItem}
			<button class="task-menu__item" type="button" data-action="delete-task"
				role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
}
```

> **Note on `aria-haspopup="menu"`:** the spec's inline template wrote `aria-haspopup="true"`; this plan uses `"menu"` to match the three existing trigger sites (`task.js`, `section.js`, `sidebar.js`) and the project's menu-parity convention. The two values are ARIA-equivalent (`true` aliases `menu`).

- [ ] **Step 5: Verify lint**

Run: `npx biome check src/views/section.js` → Expected: no errors.
Run: `npx vitest run` → Expected: **134 passed** (no behavior change yet — params are `undefined` until Task 5).

- [ ] **Step 6: Propose commit**

- Message: `feat(views): section.js threads move picker + "Move to…" item`
- Stage: `src/views/section.js`

---

### Task 5: View — `area.js` state, handlers, focus fallback, picker computation

**Files:**
- Modify: `src/views/area.js`

- [ ] **Step 1: Import `renderMovePicker`**

In `src/views/area.js`, the imports currently end with `import { renderSection } from "./section.js";`. Add below it:

```js
import { renderMovePicker } from "./move-picker.js";
```

- [ ] **Step 2: Add closure state**

Find the closure-state declarations ending:

```js
	let pendingRenameTaskSelect = false;
	let isRendering = false;
```

Replace with:

```js
	let pendingRenameTaskSelect = false;
	let isRendering = false;
	// Sub-face of the open task menu: 'actions' (default) | 'picker'.
	// RESET to 'actions' on every open-menu; destroy resets it too.
	let taskMenuMode = "actions";
	// area.js-only cross-area focus fallback: source sectionId of a moved task.
	// In doRender, if the moved task's ⋯ lookup MISSES (cross-area move → the
	// task left this page), focus the source section's ⋯ instead of dropping
	// focus to <body>.
	let pendingFocusMoveSourceSectionId = null;
```

- [ ] **Step 3: Reset `taskMenuMode` in `closeTaskMenu` (hygiene)**

Find:

```js
	const closeTaskMenu = (returnFocus = true) => {
		if (!openTaskMenuId) return;
		if (returnFocus) pendingFocusTaskId = openTaskMenuId;
		openTaskMenuId = null;
		doRender();
	};
```

Replace with:

```js
	const closeTaskMenu = (returnFocus = true) => {
		if (!openTaskMenuId) return;
		if (returnFocus) pendingFocusTaskId = openTaskMenuId;
		openTaskMenuId = null;
		taskMenuMode = "actions"; // hygiene — next open resets it anyway
		doRender();
	};
```

- [ ] **Step 4: Reset `taskMenuMode` on `open-menu`**

In the `"open-menu"` handler, find:

```js
			// Mutual exclusion with section menu
			openMenuId = null;
			openTaskMenuId = t.id;
			// Keyboard activations report event.detail === 0; on keyboard-open
```

Replace with:

```js
			// Mutual exclusion with section menu
			openMenuId = null;
			openTaskMenuId = t.id;
			taskMenuMode = "actions"; // always open in the actions face
			// Keyboard activations report event.detail === 0; on keyboard-open
```

- [ ] **Step 5: Add the three new action handlers**

In the `bindActions` map, find the `"delete-task"` handler (the last entry):

```js
		"delete-task": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			openTaskMenuId = null;
			if (t) callbacks.onDeleteTask(t);
		},
	});
```

Replace with (adds three handlers before the closing `});`):

```js
		"delete-task": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			openTaskMenuId = null;
			if (t) callbacks.onDeleteTask(t);
		},

		"move-task-to": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (!t) return;
			// Menu already open on this task — just flip its face to the picker.
			taskMenuMode = "picker";
			pendingMenuFocusTaskId = t.id; // focus first target after render
			doRender();
		},

		"pick-move-target": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			const targetSectionId = actionEl?.dataset?.targetSectionId;
			if (!t || !targetSectionId) return;
			openTaskMenuId = null;
			taskMenuMode = "actions"; // reset for next open
			pendingFocusTaskId = t.id; // focus follows the task if still visible
			pendingFocusMoveSourceSectionId = t.sectionId; // cross-area fallback
			callbacks.onMoveTaskToSection({ taskId: t.id, targetSectionId });
			// No doRender() — the model-notify re-render consumes the focus flags
			// (same as move-task-up/down). Self-heal on the swallowed-error path:
			// every moveToSection throw cause is a deletion that fires its own
			// notify → re-render → the (already-null) menu closes.
		},

		"move-picker-back": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (!t) return;
			taskMenuMode = "actions";
			pendingMenuFocusTaskId = t.id; // focus first action item (Rename)
			doRender();
		},
	});
```

- [ ] **Step 6: Add the cross-area focus fallback in `doRender`**

Find the existing `pendingFocusTaskId` block in `doRender`:

```js
		if (pendingFocusTaskId) {
			const trigger = rootEl.querySelector(
				`[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
			);
			trigger?.focus();
			pendingFocusTaskId = null;
		}
```

Replace with:

```js
		if (pendingFocusTaskId) {
			const trigger = rootEl.querySelector(
				`[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
			);
			if (trigger) {
				trigger.focus();
			} else if (pendingFocusMoveSourceSectionId) {
				// Cross-area move: the task left this page. Fall back to the
				// source section's ⋯ so focus doesn't drop to <body>.
				rootEl
					.querySelector(
						`[data-section-id="${CSS.escape(pendingFocusMoveSourceSectionId)}"] .section__menu-btn`,
					)
					?.focus();
			}
			pendingFocusTaskId = null;
			pendingFocusMoveSourceSectionId = null;
		}
```

> The non-move uses of `pendingFocusTaskId` (rename, move-up/down) leave `pendingFocusMoveSourceSectionId` null, so the fallback is inert for them.

- [ ] **Step 7: Reset new state in `destroy`**

Find the reset block at the end of `destroy`:

```js
			pendingRenameTaskValue = null;
			pendingRenameTaskSelect = false;
			isRendering = false;
		},
	};
}
```

Replace with:

```js
			pendingRenameTaskValue = null;
			pendingRenameTaskSelect = false;
			isRendering = false;
			taskMenuMode = "actions";
			pendingFocusMoveSourceSectionId = null;
		},
	};
}
```

- [ ] **Step 8: Thread `taskMenuMode` into the `template` call**

In `doRender`, find the `template(...)` call:

```js
			rootEl.innerHTML = template(lastState, areaId, {
				openMenuId,
				renamingId,
				openTaskMenuId,
				pendingRenameValue,
				renamingTaskId,
				pendingRenameTaskValue,
			});
```

Replace with (add `taskMenuMode,`):

```js
			rootEl.innerHTML = template(lastState, areaId, {
				openMenuId,
				renamingId,
				openTaskMenuId,
				pendingRenameValue,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
			});
```

- [ ] **Step 9: Accept `taskMenuMode` in the `template` signature**

Find the `template` signature destructure:

```js
function template(
	state,
	areaId,
	{
		openMenuId,
		renamingId,
		openTaskMenuId,
		pendingRenameValue,
		renamingTaskId,
		pendingRenameTaskValue,
	},
) {
```

Replace with (add `taskMenuMode,`):

```js
function template(
	state,
	areaId,
	{
		openMenuId,
		renamingId,
		openTaskMenuId,
		pendingRenameValue,
		renamingTaskId,
		pendingRenameTaskValue,
		taskMenuMode,
	},
) {
```

- [ ] **Step 10: Compute `hasMoveTargets` + `movePickerHtml`, thread into `renderSection`**

In `template`, find the task-grouping loop and the `sectionHtml` map:

```js
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
				openTaskMenuId,
				pendingRenameValue,
				renamingTaskId,
				pendingRenameTaskValue,
				now: state.now,
			}),
		)
		.join("");
```

Replace with:

```js
	for (const list of tasksBySection.values()) {
		list.sort((a, b) => a.order - b.order);
	}

	// ≥1 section other than any task's own ⇒ a valid move target exists.
	const hasMoveTargets = state.sections.length > 1;

	// Compute the picker only for the open task in picker mode — guarded so
	// it's skipped on every normal render.
	let movePickerHtml = null;
	if (openTaskMenuId && taskMenuMode === "picker") {
		const openTask = state.tasks.find((t) => t.id === openTaskMenuId);
		if (openTask) {
			movePickerHtml = renderMovePicker({
				task: openTask,
				areas: state.areas,
				sections: state.sections,
			});
		}
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
				openTaskMenuId,
				pendingRenameValue,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
				movePickerHtml,
				hasMoveTargets,
				now: state.now,
			}),
		)
		.join("");
```

- [ ] **Step 11: Verify lint + suite**

Run: `npx biome check .` → Expected: no errors.
Run: `npx vitest run` → Expected: **134 passed**.

- [ ] **Step 12: Propose commit**

- Message: `feat(views): area.js move-task-between-sections picker wiring`
- Stage: `src/views/area.js`

---

### Task 6: View — `today.js` state, handlers, picker computation + threading

**Files:**
- Modify: `src/views/today.js`

> **Memory invariant update:** the prior invariant "Today's task menu has TWO items `[Rename, Delete]` — don't add parity with the area menu" is **superseded by M6** for the Move-to item specifically. Today's menu becomes `[Rename, Move to…, Delete]`. Move up/down remain excluded (Today is a sorted view, not a manual order). This is the settled "both surfaces" scope decision, not accidental parity.

- [ ] **Step 1: Import `renderMovePicker`**

In `src/views/today.js`, the imports end with `import { renderTaskRow } from "./task.js";`. Add below it:

```js
import { renderMovePicker } from "./move-picker.js";
```

- [ ] **Step 2: Add closure state**

Find:

```js
	let renamingTaskId = null;
	let pendingRenameTaskValue = null;
	let pendingRenameTaskSelect = false;
	let isRendering = false;
```

Replace with:

```js
	let renamingTaskId = null;
	let pendingRenameTaskValue = null;
	let pendingRenameTaskSelect = false;
	let isRendering = false;
	// Sub-face of the open task menu: 'actions' (default) | 'picker'.
	// RESET to 'actions' on every open-menu; destroy resets it too.
	let taskMenuMode = "actions";
```

- [ ] **Step 3: Reset `taskMenuMode` in `closeMenu` (hygiene)**

Find:

```js
	const closeMenu = (returnFocus = true) => {
		if (!openMenuTaskId) return;
		if (returnFocus) pendingFocusTaskId = openMenuTaskId;
		openMenuTaskId = null;
		doRender();
	};
```

Replace with:

```js
	const closeMenu = (returnFocus = true) => {
		if (!openMenuTaskId) return;
		if (returnFocus) pendingFocusTaskId = openMenuTaskId;
		openMenuTaskId = null;
		taskMenuMode = "actions"; // hygiene — next open resets it anyway
		doRender();
	};
```

- [ ] **Step 4: Reset `taskMenuMode` on `open-menu`**

In the `"open-menu"` handler, find:

```js
			openMenuTaskId = t.id;
			// Keyboard activations (Enter/Space) report event.detail === 0;
```

Replace with:

```js
			openMenuTaskId = t.id;
			taskMenuMode = "actions"; // always open in the actions face
			// Keyboard activations (Enter/Space) report event.detail === 0;
```

- [ ] **Step 5: Add the three new action handlers**

In the `bindActions` map, find the `"delete-task"` handler (the last entry):

```js
		"delete-task": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			openMenuTaskId = null;
			if (t) callbacks.onDelete(t);
		},
	});
```

Replace with (note: Today's `pick-move-target` has NO source-section fallback — the moved task stays in Today since its starred/due status is unchanged):

```js
		"delete-task": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			openMenuTaskId = null;
			if (t) callbacks.onDelete(t);
		},

		"move-task-to": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (!t) return;
			// Menu already open on this task — just flip its face to the picker.
			taskMenuMode = "picker";
			pendingMenuFocusTaskId = t.id; // focus first target after render
			doRender();
		},

		"pick-move-target": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			const targetSectionId = actionEl?.dataset?.targetSectionId;
			if (!t || !targetSectionId) return;
			openMenuTaskId = null;
			taskMenuMode = "actions"; // reset for next open
			pendingFocusTaskId = t.id; // the task stays in Today; refocus its ⋯
			callbacks.onMoveTaskToSection({ taskId: t.id, targetSectionId });
			// No doRender() — the model-notify re-render consumes the focus flag
			// (same as the area view). Toast is the only visible feedback here.
		},

		"move-picker-back": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (!t) return;
			taskMenuMode = "actions";
			pendingMenuFocusTaskId = t.id; // focus first action item (Rename)
			doRender();
		},
	});
```

- [ ] **Step 6: Thread `taskMenuMode` into the `template` call (in `doRender`)**

Find:

```js
			rootEl.innerHTML = template(
				lastState,
				openMenuTaskId,
				renamingTaskId,
				pendingRenameTaskValue,
			);
```

Replace with:

```js
			rootEl.innerHTML = template(
				lastState,
				openMenuTaskId,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
			);
```

- [ ] **Step 7: Reset `taskMenuMode` in `destroy`**

Find the reset block at the end of `destroy`:

```js
			pendingRenameTaskValue = null;
			pendingRenameTaskSelect = false;
			isRendering = false;
		},
	};
}
```

Replace with:

```js
			pendingRenameTaskValue = null;
			pendingRenameTaskSelect = false;
			isRendering = false;
			taskMenuMode = "actions";
		},
	};
}
```

- [ ] **Step 8: Update `template` — accept `taskMenuMode`, compute picker, thread down**

Replace the whole `template` function with:

```js
function template(
	state,
	openMenuTaskId,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
) {
	const next = pickNextTask(state.tasks, state.now);
	const groups = groupTasksForToday(state.tasks, state.now);
	const visible = (list) => list.filter((t) => t.id !== next?.id);

	const overdue = visible(groups.overdue);
	const today = visible(groups.today);
	const starred = visible(groups.starred);

	const allEmpty =
		!next && overdue.length === 0 && today.length === 0 && starred.length === 0;

	if (allEmpty) {
		return `<p class="empty">You're clear. Nice.</p>`;
	}

	// ≥1 section other than any task's own ⇒ a valid move target exists.
	const hasMoveTargets = state.sections.length > 1;

	// Compute the picker only for the open task in picker mode.
	let movePickerHtml = null;
	if (openMenuTaskId && taskMenuMode === "picker") {
		const openTask = state.tasks.find((t) => t.id === openMenuTaskId);
		if (openTask) {
			movePickerHtml = renderMovePicker({
				task: openTask,
				areas: state.areas,
				sections: state.sections,
			});
		}
	}

	return `
		${next ? renderNextCard(next, state.now, openMenuTaskId, renamingTaskId, pendingRenameTaskValue, taskMenuMode, movePickerHtml, hasMoveTargets) : ""}
		${renderGroup("Overdue", "group--overdue", overdue, state.now, openMenuTaskId, true, renamingTaskId, pendingRenameTaskValue, taskMenuMode, movePickerHtml, hasMoveTargets)}
		${renderGroup("Today", "group--today", today, state.now, openMenuTaskId, true, renamingTaskId, pendingRenameTaskValue, taskMenuMode, movePickerHtml, hasMoveTargets)}
		${renderGroup("Starred", "group--starred", starred, state.now, openMenuTaskId, false, renamingTaskId, pendingRenameTaskValue, taskMenuMode, movePickerHtml, hasMoveTargets)}
	`;
}
```

- [ ] **Step 9: Update `renderNextCard` — accept + thread the three params**

Replace the whole `renderNextCard` function with:

```js
function renderNextCard(
	task,
	now,
	openMenuTaskId,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	movePickerHtml,
	hasMoveTargets,
) {
	return `
		<article class="next-card">
			<h2 class="next-card__label">NEXT</h2>
			<ul class="next-card__list">
				${renderTaskRowWithMenu(task, now, openMenuTaskId, renamingTaskId, pendingRenameTaskValue, taskMenuMode, movePickerHtml, hasMoveTargets)}
			</ul>
		</article>
	`;
}
```

- [ ] **Step 10: Update `renderGroup` — accept + thread the three params**

Replace the whole `renderGroup` function with:

```js
function renderGroup(
	heading,
	modifierClass,
	tasks,
	now,
	openMenuTaskId,
	showCount,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	movePickerHtml,
	hasMoveTargets,
) {
	if (tasks.length === 0) return "";
	const headingText = showCount ? `${heading} (${tasks.length})` : heading;
	const rows = tasks
		.map((t) =>
			renderTaskRowWithMenu(
				t,
				now,
				openMenuTaskId,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
				movePickerHtml,
				hasMoveTargets,
			),
		)
		.join("");
	return `
		<section class="group ${modifierClass}">
			<h3 class="group__heading">${headingText}</h3>
			<ul class="group__list">${rows}</ul>
		</section>
	`;
}
```

- [ ] **Step 11: Update `renderTaskRowWithMenu` — accept params, inject picker, add "Move to…"**

Replace the whole `renderTaskRowWithMenu` function (the today.js local one) with:

```js
function renderTaskRowWithMenu(
	task,
	now,
	openMenuTaskId,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	movePickerHtml,
	hasMoveTargets,
) {
	const isRenaming = renamingTaskId === task.id;
	if (isRenaming) {
		// Rename input replaces the row's children — no menu injection,
		// no checkbox / star / ⋯. Mutually exclusive with menu state.
		return renderTaskRow(task, {
			now,
			renaming: true,
			pendingRenameValue: pendingRenameTaskValue,
		});
	}

	const isOpen = openMenuTaskId === task.id;
	const row = renderTaskRow(task, { now, isOpen });
	if (!isOpen) return row;

	// Picker face: replace the action menu with the pre-rendered picker.
	// The menu injects inside the <li> as its last child (the <li> is
	// position: relative so the absolute menu anchors to the row).
	if (taskMenuMode === "picker" && movePickerHtml) {
		return row.replace("</li>", `${movePickerHtml}</li>`);
	}

	// Actions face. Today menu: [Rename, Move to…, Delete]. No Move up/down —
	// today is a sorted view, not a manual order.
	const moveToItem = hasMoveTargets
		? `<button class="task-menu__item" type="button" data-action="move-task-to" role="menuitem" tabindex="-1" aria-haspopup="menu">Move to…</button>`
		: "";
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="rename-task" role="menuitem" tabindex="-1">Rename</button>
			${moveToItem}
			<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
}
```

- [ ] **Step 12: Verify lint + suite**

Run: `npx biome check .` → Expected: no errors.
Run: `npx vitest run` → Expected: **134 passed**.

- [ ] **Step 13: Propose commit**

- Message: `feat(views): today.js move-task-between-sections picker wiring`
- Stage: `src/views/today.js`

---

### Task 7: CSS — picker styles

**Files:**
- Modify: `main.css` (project root)

Place the new rules immediately **after** the existing `.task-menu__item:disabled` block and **before** `/* --- Toast --- */`. Keeping them beside their `.task-menu` siblings (and before the higher-specificity rules later in the file) avoids the Biome `noDescendingSpecificity` trip documented in project memory.

- [ ] **Step 1: Insert the picker rules**

Find:

```css
/* :disabled is unused today (boundary moves are omitted, not greyed) but kept so
   all three menus stay identical — see .sidebar-menu__item. */
.task-menu__item:disabled {
	color: var(--color-text-muted);
	cursor: not-allowed;
}

/* --- Toast --- */
```

Replace with:

```css
/* :disabled is unused today (boundary moves are omitted, not greyed) but kept so
   all three menus stay identical — see .sidebar-menu__item. The move picker's
   "No other sections" empty-race hint reuses this style. */
.task-menu__item:disabled {
	color: var(--color-text-muted);
	cursor: not-allowed;
}

/* --- Move-to picker (a sub-face of the task `…` menu) --- */
/* Scrolls so a long target list never overflows the viewport or hides behind
   the fixed bottom capture bar. 50vh keeps it clear on small screens. */
.task-menu--picker {
	max-height: 50vh;
	overflow-y: auto;
}
.task-menu__group {
	padding-block: 0.15rem;
}
/* Decorative area label (the role="group" aria-label names the area for SRs).
   --color-text-muted on --color-bg-elevated ≈ 6.3:1 — passes WCAG AA. */
.task-menu__group-label {
	margin: 0;
	padding: 0.25rem 0.6rem 0.1rem;
	font-size: 0.75rem;
	color: var(--color-text-muted);
}
.task-menu__item--back {
	margin-top: 0.15rem;
	border-top: 1px solid var(--color-border);
}

/* --- Toast --- */
```

- [ ] **Step 2: Verify Biome (lint, not just format)**

Run: `npx biome check main.css`
Expected: no errors — specifically no `noDescendingSpecificity` (all new selectors are single-class `(0,1,0)` and sit beside their siblings).

- [ ] **Step 3: Propose commit**

- Message: `feat(styles): .task-menu--picker + group + back styles`
- Stage: `main.css`

---

### Task 8: Manual / Claude Preview MCP E2E verification

**Files:** none (verification only).

No JSDOM view tests (project convention). Verify behavior in the running app. Start the dev server via Preview MCP: `preview_start` name `"ignite-dev"`.

> **Memory caveats for this E2E:**
> - `preview_click` can SILENTLY no-op (reports success, dispatches no DOM click). Probe with a capture-phase document click listener; if it no-ops, fall back to `el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))` (detail 1 = mouse, 0 = keyboard).
> - Multi-step time-windowed checks (the 5s toast) must run inside ONE `preview_eval` with internal `await new Promise(setTimeout)` — wall-clock between separate evals is non-deterministic.
> - IndexedDB is per-origin; the headless preview keeps its own data. Reload to clear artifacts.
> - `preview_screenshot` may hang; `preview_eval` + `document.activeElement` probes are more reliable proof for focus/menu behavior.

- [ ] **Step 1: Full suite + lint gate**

Run: `npx vitest run` → **134 passed**. Run: `npx biome check .` → clean. (Hard gate — do not proceed to manual E2E if either fails.)

- [ ] **Step 2: Area, within-area move**

Open an area with ≥2 sections. Open a task's `⋯` → "Move to…" → pick a sibling section. Verify: the task relocates to the target section; a toast "Moved to Area › Section" appears; focus lands on the moved task's `⋯`. No console errors.

- [ ] **Step 3: Area, cross-area move + Undo**

Move a task to a section in a DIFFERENT area. Verify: the task leaves the current page; toast confirms; focus falls back to the SOURCE section's `⋯` (probe `document.activeElement`). Click Undo → the task returns to its original section AND original position.

- [ ] **Step 4: Focus-out triage (the killer use case)**

From the Focus area, move a captured (starred) task out of `focus-default` into a project section in another area. Verify it works and is no longer listed under Focus.

- [ ] **Step 5: Today move (toast is the only feedback)**

In Today, open a starred task's `⋯` → "Move to…" → pick a section. Verify: the task STAYS in Today (its starred/due status is unchanged) under the same group; the toast is the only visible confirmation; Undo works.

- [ ] **Step 6: "Move to…" omission**

With only `focus-default` present (fresh app / delete other sections), open a task `⋯`. Verify there is NO "Move to…" item (`hasMoveTargets` false).

- [ ] **Step 7: Picker keyboard nav**

Open a task `⋯` via keyboard (Enter), arrow to "Move to…", Enter. Verify: focus enters the picker on the FIRST target. ArrowUp/Down/Home/End cycle the targets (group labels skipped); "← Back" returns to the actions menu (focus on Rename); Esc closes the whole menu; Tab closes the menu and returns focus to the `⋯`.

- [ ] **Step 8: Empty-picker race**

Open the picker on a task; in another path delete every other section (or open with exactly one other section then delete it). Re-render the picker. Verify it shows a disabled "No other sections" item + "← Back" — never a bare Back-only dead-end, no crash.

- [ ] **Step 9: Cascade race on pick**

Open the picker; delete the target section via another path; then pick that (now-stale) target. Verify: the move is swallowed (no crash, no toast), and the menu closes via the deletion's own re-render.

- [ ] **Step 10: NEXT card + escapeHtml**

Move the NEXT card's task in Today (picker injects inside the `<article>`'s `<li>`). Then create a section named `<b>x</b>` and open the picker — verify the name renders as literal text (not bold/executed) in both the picker item and the toast label.

- [ ] **Step 11: Record the result**

Note in the session which checks passed (and any deviations). If all pass, M6 is functionally complete.

---

## Self-Review (completed by plan author)

**Spec coverage** — every architecture-table row and invariant maps to a task:
- Model `moveToSection` (append, no-op-no-notify, throws) → Task 1 (+ Invariants 1, 2, 6-model).
- `renderMovePicker` (grouped, Back last, escape names + id, empty hint, Focus not special) → Task 2 (+ Invariants 5, 10).
- `section.js` thread + Move to… + injection → Task 4 (+ Invariant 4).
- `area.js` state + 3 handlers + open-menu reset + focus fallback + compute/thread → Task 5 (+ Invariants 3, 8, 9).
- `today.js` same (no source-section fallback; menu `[Rename, Move to…, Delete]`) → Task 6 (+ Invariant 11).
- Controller `onMoveTaskToSection` + `MOVE_TOAST_MS` + swallow + undo → Task 3 (+ Invariants 6, 7).
- CSS picker/group/back/disabled-reuse → Task 7.
- Esc one-level, arrow-nav unchanged → no code change needed (reused machinery); verified in Task 8 steps 7-8.
- Edge-case table → Task 8 steps 2-10.

**Placeholder scan:** none — every code step shows complete code; every command shows expected output.

**Type/name consistency:** `taskMenuMode` ('actions'|'picker'), `movePickerHtml` (string|null), `hasMoveTargets` (bool), `pendingFocusMoveSourceSectionId` (area.js only), data-actions `move-task-to` / `pick-move-target` / `move-picker-back`, attribute `data-target-section-id` → `actionEl.dataset.targetSectionId`, callback `onMoveTaskToSection({ taskId, targetSectionId })`, model `moveToSection(id, targetSectionId)`, constant `MOVE_TOAST_MS` — all used consistently across tasks.

**Two deliberate deviations from the spec text (both documented inline):**
1. `aria-haspopup="menu"` instead of the spec's `"true"` — matches the codebase's three existing trigger sites + menu-parity convention (ARIA-equivalent).
2. Controller handler extracted as a shared `handleMoveTaskToSection` (DRY) rather than duplicated inline in both mounts — mirrors the existing shared `handleTaskDelete`.

**Test count:** 7 new cases (spec estimated ~6) → 134 total (spec said 133). Difference is the explicit split of the same-section no-op and gap-robustness into separate cases; behavior coverage is identical-or-greater.
