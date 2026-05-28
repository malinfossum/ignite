# Inline Task Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user rename a task in place — anywhere a task row is shown (today + area views) — via the existing ⋯ menu pattern used for sections and areas. This is the THIRD application of the settled inline-rename pattern (section in area = M3, area in sidebar = M5, task in today + task in area = Phase 2).

**Architecture:** Model gains `async rename(id, title)` mirroring `sections.rename` / `areas.rename`. The shared `renderTaskRow` template (src/views/task.js) learns a rename-mode branch — when `renaming: true`, the `<li>` renders an input-only row. All rename plumbing (closure state, action handlers, post-render focus, destroy-commit) lives in the two parent views (today.js, area.js) independently — **no shared `_rename.js` helper** (v0.2 candidate). today.js gains TWO new lifecycle pieces: `bindKeys` (currently absent — only `bindActions` exists) and `isRendering` try/finally (currently absent — today had no rename state to protect).

**Tech Stack:** Vanilla JavaScript (ES modules), Vite, Vitest, Biome, IndexedDB. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-28-ignite-inline-task-rename-design.md](../specs/2026-05-28-ignite-inline-task-rename-design.md)

**Baseline:** 121/121 tests, HEAD `7d39388`, tree clean.

**Target:** 127/127 tests (+6 model rename tests), 8 atomic commits, all M5 + polish-bundle invariants preserved.

---

## File structure

| Path | Status | Purpose |
|---|---|---|
| `src/model/tasks.js` | Modify | New `async rename(id, title)` method. ~+12 LOC. |
| `tests/unit/tasks.test.js` | Modify | New `describe("createTaskModel — rename", …)` block with 6 tests. ~+50 LOC. |
| `src/views/task.js` | Modify | `renderTaskRow` accepts `renaming` + `pendingRenameValue`; emits input-only `<li>` when `renaming === true`. ~+20 LOC. |
| `src/controller.js` | Modify | `onCommitTaskRename` callback in both view mounts (today + area). Mirrors `onCommitRename` for sections. ~+14 LOC. |
| `src/views/section.js` | Modify | Thread `renamingTaskId` + `pendingRenameTaskValue` through `renderSection` → `renderBody` → `renderTaskRowWithMenu`. Add "Rename" item to task menu. Skip menu injection when row is in rename mode. ~+15 LOC. |
| `src/views/area.js` | Modify | Add task-rename closure state alongside existing section-rename state. New `rename-task` action handler. Cross-type mutual exclusion in `rename-section`. Extend `docKeyHandler` Escape branch. Extend `bindKeys` Enter handler. Extend `doRender` with task-rename input listeners + post-render focus. Extend `destroy` with destroy-commit. Thread state to template. ~+80 LOC. |
| `src/views/today.js` | Modify | Add task-rename closure state (including the NEW `isRendering` + `pendingRenameTaskSelect` vars). Introduce `bindKeys` lifecycle (currently absent). Wrap `doRender` innerHTML in `isRendering` try/finally. New `rename-task` action handler. New commit/cancel functions. Extend `docKeyHandler` Escape branch. Add post-render input listeners + focus block. Update local `renderTaskRowWithMenu` to thread state + add "Rename" menu item. Update `destroy` with destroy-commit + state reset. ~+80 LOC. |
| `main.css` | Modify | New `.task--editing` modifier + `.task__rename-input` rules. Preserves row height. ~+15 LOC. |

**Note on the CSS path:** The spec lists `src/styles/main.css`. The actual file is at `main.css` (repo root) — verified during plan-write. The spec's path is wrong; this plan uses `main.css`.

---

## Task ordering rationale

```
Task 1 — Model (TDD, pure seam) ──────────► tests now 127.
Task 2 — Template (additive, backward-compatible) ► no caller yet uses renaming:true.
Task 3 — Controller wiring (no-op until views call it) ► callbacks exist; views aren't calling.
Task 4 — section.js (thread params, add menu item) ► area view's task ⋯ now shows Rename, but area.js action handler doesn't exist yet → clicking Rename is a no-op.
Task 5 — area.js (closure state + handlers) ► area view rename is FULLY FUNCTIONAL end-to-end.
Task 6 — today.js (closure state + bindKeys + isRendering + handlers) ► today view rename is FULLY FUNCTIONAL.
Task 7 — CSS ► visual polish; no behavior change.
Task 8 — E2E verification via Claude Preview MCP.
```

Each task leaves the codebase in a working state (tests pass; no broken affordances). Atomic commits.

---

## Task 1 — Model: `tasks.rename(id, title)` + 6 tests (TDD)

**Files:**
- Modify: `src/model/tasks.js`
- Modify: `tests/unit/tasks.test.js`

**Commit message (proposed):**
```
feat(model): tasks.rename(id, title) with capitalization + empty-title guard
```

**Why:** Foundational pure-model seam. TDD per project convention (`TDD only on the pure-function seam`). Mirrors `sections.rename` (src/model/sections.js:87-94) and `areas.rename` exactly — capitalizeFirst → empty guard → existence guard → put → notify.

---

### 1.1 — Add the 6 failing tests in one block

- [ ] Open [tests/unit/tasks.test.js](tests/unit/tasks.test.js). At the END of the file (after the existing `describe("createTaskModel — listByArea", …)` block which closes at line 261), append:

```js

describe("createTaskModel — rename", () => {
	it("trims and capitalizes the new title, persists, returns nothing", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Old" });
		const result = await model.rename(t.id, "  buy bread  ");
		expect(result).toBeUndefined();
		const [stored] = await model.listBySection("s1");
		expect(stored.title).toBe("Buy bread");
	});

	it("rejects empty / whitespace-only titles", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Old" });
		await expect(model.rename(t.id, "")).rejects.toThrow(/empty/i);
		await expect(model.rename(t.id, "   ")).rejects.toThrow(/empty/i);
		const [stored] = await model.listBySection("s1");
		expect(stored.title).toBe("Old");
	});

	it("throws Task not found for a missing id", async () => {
		const { model } = await freshModel();
		await expect(model.rename("nope-id", "New")).rejects.toThrow(
			/Task not found/,
		);
	});

	it("preserves all other fields (order, sectionId, starred, completed, dueAt, recurrence)", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "Meeting",
			starred: true,
			dueAt: "2026-06-01T10:00:00.000Z",
			recurrence: "weekly",
			leadTime: 15,
		});
		await model.toggleCompleted(t.id);
		await model.rename(t.id, "renamed");
		const list = await model.list();
		const updated = list.find((x) => x.id === t.id);
		expect(updated.title).toBe("Renamed");
		expect(updated.sectionId).toBe("s1");
		expect(updated.starred).toBe(true);
		expect(updated.completed).toBe(true);
		expect(updated.dueAt).toBe("2026-06-01T10:00:00.000Z");
		expect(updated.recurrence).toBe("weekly");
		expect(updated.leadTime).toBe(15);
		expect(updated.order).toBe(t.order);
	});

	it("notifies subscribers exactly once per rename", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Old" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.rename(t.id, "New");
		expect(calls).toEqual(["notified"]);
	});

	it("does NOT notify on failure (empty title or missing id)", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Old" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await expect(model.rename(t.id, "")).rejects.toThrow();
		await expect(model.rename("nope-id", "Whatever")).rejects.toThrow();
		expect(calls).toEqual([]);
	});
});
```

### 1.2 — Verify all 6 tests fail

- [ ] Run:
```
npx vitest run tests/unit/tasks.test.js
```

Expected: 23 tests total, **6 failing** with `model.rename is not a function` (the existing 17 still pass).

### 1.3 — Implement `rename(id, title)` in `src/model/tasks.js`

- [ ] Open [src/model/tasks.js](src/model/tasks.js). Locate the `async update(id, patch) { … }` block (lines 94-101). Add the `rename` method DIRECTLY AFTER `update`, before `async toggleCompleted` (line 103). Match the surrounding 2-space (tabs in this file — TAB indentation) style.

The full snippet to insert (between `update` and `toggleCompleted`):

```js
		async rename(id, title) {
			const cleaned = capitalizeFirst(title);
			if (!cleaned) throw new Error("rename(task): title cannot be empty");
			const stored = await db.get("tasks", id);
			if (!stored) throw new Error(`Task not found: ${id}`);
			const current = fromStorage(stored);
			const updated = { ...current, title: cleaned };
			await db.put("tasks", toStorage(updated));
			notify();
		},
```

**Notes on choices:**
- `capitalizeFirst(title)` returns `""` for empty / whitespace-only / null input — so the empty check covers all three.
- We re-read via `db.get` + `fromStorage` so the 0/1 → boolean conversion stays consistent with other mutation methods (`update`, `toggleCompleted`).
- Returns `undefined` (no return) — matches `sections.rename` shape exactly. The test expects `toBeUndefined`.
- Throws `Task not found: {id}` — matches the existing `update` / `toggleCompleted` / `swapOrder` shape; the controller swallows by regex match.

### 1.4 — Verify all 6 rename tests now pass

- [ ] Run:
```
npx vitest run tests/unit/tasks.test.js
```

Expected: **23 PASS** (17 existing + 6 new rename).

### 1.5 — Run the full suite

- [ ] Run:
```
npm test -- --run
```

Expected: **127 PASS** (121 baseline + 6 rename). 0 fail.

### 1.6 — Biome check

- [ ] Run:
```
npm run check
```

Expected: clean (no warnings, no errors).

If Biome flags issues, fix them. Common gotchas in this repo: trailing whitespace, missing trailing newline, tab/space mixing.

### 1.7 — Stage + propose commit

- [ ] Stage:
```
src/model/tasks.js
tests/unit/tasks.test.js
```

Proposed commit message:
```
feat(model): tasks.rename(id, title) with capitalization + empty-title guard
```

---

## Task 2 — Template: `renderTaskRow` rename branch

**Files:**
- Modify: `src/views/task.js`

**Commit message (proposed):**
```
feat(views): renderTaskRow rename-mode branch (input-only <li>)
```

**Why:** Adds an additive branch — `renaming: true` swaps the row's children for a single rename input. Backward-compatible: existing callers don't pass `renaming`, get the unchanged row. The fully-shared template means today + area + section all benefit from a single template change.

**Key invariant:** `pendingRenameValue ?? task.title`, NOT `||`. A typed `""` must render an empty input (with the placeholder hinting the committed title); only `null` falls back to the committed title.

**Key invariant:** `escapeHtml` applied to `value`, `aria-label`, `placeholder`, AND `data-id` + `data-task-id`. Titles can contain `<`/`>`/`"` and would break the input attributes or execute as HTML.

**Key invariant:** `data-action="commit-task-rename"` exists on the input ONLY so the view's `bindKeys` Enter handler finds it. There must be NO `commit-task-rename` entry in `bindActions` — wiring it as a click would commit + exit rename on every cursor-positioning tap.

---

### 2.1 — Rewrite `renderTaskRow` to accept `renaming` + `pendingRenameValue`

- [ ] Open [src/views/task.js](src/views/task.js). Replace the entire file content with:

```js
// Renders one task row. Returned as a string so the parent template can
// concatenate. Always escape user-provided fields before interpolating —
// titles can contain `<` and would otherwise execute as HTML.
//
// Options:
//   now                - Date used by formatTimeLabel for the time label.
//   isOpen             - true when this task's ⋯ menu is open (controls
//                        aria-expanded on the menu button).
//   renaming           - true to render input-only rename mode (replaces
//                        checkbox / title / star / ⋯ with a single input).
//                        The <li> still carries data-id so taskFromEvent
//                        lookups resolve.
//   pendingRenameValue - in-progress rename text preserved across re-renders,
//                        or null. Falls back to task.title when null.
//                        MUST be ??, not || — a typed "" renders empty +
//                        placeholder.

import { escapeHtml } from "../utils/dom.js";
import { formatTimeLabel } from "../utils/time.js";

export function renderTaskRow(
	task,
	{ now, isOpen = false, renaming = false, pendingRenameValue = null } = {
		now: new Date(),
	},
) {
	if (renaming) return renderRenameRow(task, pendingRenameValue);

	const checked = task.completed ? "checked" : "";
	const starredAttr = task.starred
		? 'aria-pressed="true"'
		: 'aria-pressed="false"';
	const starGlyph = task.starred ? "★" : "☆";
	const recurring = task.recurrence
		? '<span class="task__recurring" aria-hidden="true">⟲</span>'
		: "";
	const timeLabel = task.dueAt
		? `<span class="task__time-label">${escapeHtml(formatTimeLabel(task.dueAt, now))}</span>`
		: "";

	return `
		<li class="task" data-id="${escapeHtml(task.id)}">
			<input type="checkbox" class="task__check" data-action="toggle-complete" ${checked} />
			<span class="task__title">${escapeHtml(task.title)}</span>
			<button class="task__star" type="button" data-action="toggle-star" ${starredAttr}>${starGlyph}</button>
			${recurring}
			${timeLabel}
			<button class="task__menu-btn" type="button" data-action="open-menu"
				aria-haspopup="menu"
				aria-expanded="${isOpen}"
				aria-label="Task options: ${escapeHtml(task.title)}">⋯</button>
		</li>
	`;
}

function renderRenameRow(task, pendingRenameValue) {
	// pendingRenameValue ?? task.title: a `""` value renders an empty box
	// (`"" ?? x === ""`) with the placeholder hinting the committed title;
	// `null` (menu rename) prefills the committed title. Must be ??, not ||.
	const renameValue = pendingRenameValue ?? task.title;
	return `
		<li class="task task--editing" data-id="${escapeHtml(task.id)}">
			<input type="text"
				class="task__rename-input"
				value="${escapeHtml(renameValue)}"
				data-action="commit-task-rename"
				data-task-id="${escapeHtml(task.id)}"
				aria-label="Rename task: ${escapeHtml(task.title)}"
				placeholder="${escapeHtml(task.title)}"
				autofocus />
		</li>
	`;
}
```

### 2.2 — Run the full suite (regression check)

- [ ] Run:
```
npm test -- --run
```

Expected: **127 PASS**. The view template isn't unit-tested directly, but adding a new optional branch should not affect any existing code path (callers without `renaming` get the unchanged row).

### 2.3 — Biome check

- [ ] Run:
```
npm run check
```

Expected: clean.

### 2.4 — Stage + propose commit

- [ ] Stage:
```
src/views/task.js
```

Proposed commit message:
```
feat(views): renderTaskRow rename-mode branch (input-only <li>)
```

---

## Task 3 — Controller: `onCommitTaskRename` wired into both view mounts

**Files:**
- Modify: `src/controller.js`

**Commit message (proposed):**
```
feat(controller): onCommitTaskRename callback (today + area mounts)
```

**Why:** Both today and area views will dispatch a commit callback when the user finishes typing (Enter, blur, or destroy-commit). The controller wires it into the corresponding model method with a cascade-race swallow — matches the `onCommitRename` shape used for sections.

**Key invariant:** The catch MUST match `/Task not found/` regex (NOT a string compare or instanceof) — that's the contract the model throws and the controller must match it exactly. Mirrors `onCommitRename` for sections (controller.js:132-143) and `onCommitAreaRename` for areas (controller.js:290-299).

---

### 3.1 — Add `onCommitTaskRename` to the today view mount

- [ ] Open [src/controller.js](src/controller.js). Locate `mountMainView` (around line 97). The today branch currently looks like:

```js
if (route.name === "today") {
	currentMainView = createTodayView(mainRoot, {
		onToggleComplete: (id) => tasks.toggleCompleted(id),
		onToggleStar: (id, currentStarred) =>
			tasks.update(id, { starred: !currentStarred }),
		onDelete: (task) => handleTaskDelete(task),
	});
	return;
}
```

Add `onCommitTaskRename` AFTER `onDelete`. The full block becomes:

```js
if (route.name === "today") {
	currentMainView = createTodayView(mainRoot, {
		onToggleComplete: (id) => tasks.toggleCompleted(id),
		onToggleStar: (id, currentStarred) =>
			tasks.update(id, { starred: !currentStarred }),
		onDelete: (task) => handleTaskDelete(task),
		onCommitTaskRename: async ({ taskId, name }) => {
			try {
				await tasks.rename(taskId, name);
			} catch (err) {
				// Race: task was cascade-deleted (e.g., section/area cascade fired
				// while mid-rename, or destroy-commit raced cascade). Drop silently —
				// toast undo restores the task with its pre-rename title; typed text
				// is lost. Mirrors onCommitRename for sections.
				if (/Task not found/.test(err.message)) return;
				throw err;
			}
		},
	});
	return;
}
```

### 3.2 — Add `onCommitTaskRename` to `areaCallbacks()`

- [ ] In the same file, locate `areaCallbacks()` (line 118). After the existing `onCommitRename` block (lines 132-143), add a new `onCommitTaskRename`:

```js
onCommitTaskRename: async ({ taskId, name }) => {
	try {
		await tasks.rename(taskId, name);
	} catch (err) {
		// Race: task cascade-deleted mid-rename. Drop silently — toast
		// undo restores the task with its pre-rename title; typed text is
		// lost. Mirrors onCommitRename above.
		if (/Task not found/.test(err.message)) return;
		throw err;
	}
},
```

Insert it BETWEEN `onCommitRename` (closes around line 143) and `onMoveUp` (starts line 145). The block should read:

```js
onCommitRename: async ({ sectionId, name }) => {
	try {
		await sections.rename(sectionId, name);
	} catch (err) {
		if (/Section not found/.test(err.message)) return;
		throw err;
	}
},

onCommitTaskRename: async ({ taskId, name }) => {
	try {
		await tasks.rename(taskId, name);
	} catch (err) {
		if (/Task not found/.test(err.message)) return;
		throw err;
	}
},

onMoveUp: async ({ sectionId }) => {
	await moveSection(sectionId, "up");
},
```

(The existing `onCommitRename` keeps its existing inline comments — only the new block is shown without the long comments for brevity here.)

### 3.3 — Run the full suite

- [ ] Run:
```
npm test -- --run
```

Expected: **127 PASS**. (Controller isn't unit-tested; views can't yet call the new callback so no behavior change.)

### 3.4 — Biome check

- [ ] Run:
```
npm run check
```

Expected: clean.

### 3.5 — Stage + propose commit

- [ ] Stage:
```
src/controller.js
```

Proposed commit message:
```
feat(controller): onCommitTaskRename callback (today + area mounts)
```

---

## Task 4 — section.js: thread rename state + add "Rename" task menu item

**Files:**
- Modify: `src/views/section.js`

**Commit message (proposed):**
```
feat(views): thread task-rename state through section template; Rename menu item
```

**Why:** Area view's task ⋯ menu is rendered by section.js (the internal `renderTaskRowWithMenu`). Adding "Rename" to that menu + threading the rename state to `renderTaskRow` is one cohesive section.js change. After this task, area.js will be able to see Rename in the menu — but clicking it is a no-op until Task 5 wires the action handler.

**Key invariants preserved:**
- Boundary-move OMISSION (not greying) intact.
- "Rename" is FIRST in menu (per spec §"Task ⋯ menu — new 'Rename' item"); "Delete" stays LAST.
- All menu items get `role="menuitem" tabindex="-1"` (mirrors polish bundle / ARIA APG).
- When `renaming === true`, the menu injection is skipped entirely — the rename input REPLACES the row's children (mutually exclusive).

---

### 4.1 — Update `renderSection` signature to accept new params

- [ ] Open [src/views/section.js](src/views/section.js). Update the JSDoc comment block (lines 1-17) to mention the two new opts:

Replace the existing comment block at the top of the file with:

```js
// renderSection(opts) → string
//
// Pure template. Renders one section's HTML for the area view to
// concatenate. Event wiring lives in createAreaView; this file only
// produces markup.
//
// opts:
//   section                - the section record
//   tasks                  - tasks in this section (already filtered + sorted)
//   isUndeletable          - true for focus-default; suppresses Delete in menu
//   isFirst, isLast        - edge flags for Move up/down disabled state
//   openMenuId             - section id whose menu is currently open, or null
//   renamingId             - section id currently in rename mode, or null
//   openTaskMenuId         - task id whose ⋯ menu is currently open, or null
//   pendingRenameValue     - in-progress section-rename text (survives re-renders), or null
//   renamingTaskId         - task id currently in rename mode, or null
//   pendingRenameTaskValue - in-progress task-rename text (survives re-renders), or null
//   now                    - Date used by renderTaskRow for time labels
```

### 4.2 — Update the `renderSection` function signature

- [ ] In the same file, update the `renderSection` function signature (lines 21-32). The current signature:

```js
export function renderSection({
	section,
	tasks,
	isUndeletable,
	isFirst,
	isLast,
	openMenuId,
	renamingId,
	openTaskMenuId,
	pendingRenameValue,
	now,
}) {
```

Replace with:

```js
export function renderSection({
	section,
	tasks,
	isUndeletable,
	isFirst,
	isLast,
	openMenuId,
	renamingId,
	openTaskMenuId,
	pendingRenameValue,
	renamingTaskId,
	pendingRenameTaskValue,
	now,
}) {
```

### 4.3 — Thread the new params to `renderBody`

- [ ] In the same file, locate the `renderBody` call inside `renderSection` (line 44). Currently:

```js
const body = renderBody(tasks, now, openTaskMenuId);
```

Replace with:

```js
const body = renderBody(tasks, now, openTaskMenuId, renamingTaskId, pendingRenameTaskValue);
```

### 4.4 — Update `renderBody` to accept and thread the new params

- [ ] Replace the existing `renderBody` function (lines 138-154):

```js
function renderBody(tasks, now, openTaskMenuId) {
	const rows = tasks
		.map((t, i) =>
			renderTaskRowWithMenu(t, {
				now,
				isFirst: i === 0,
				isLast: i === tasks.length - 1,
				openTaskMenuId,
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

With:

```js
function renderBody(
	tasks,
	now,
	openTaskMenuId,
	renamingTaskId,
	pendingRenameTaskValue,
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

### 4.5 — Update `renderTaskRowWithMenu` to handle rename mode + add Rename menu item

- [ ] Replace the existing `renderTaskRowWithMenu` function at the bottom of the file (lines 156-178):

```js
function renderTaskRowWithMenu(task, { now, isFirst, isLast, openTaskMenuId }) {
	const isOpen = openTaskMenuId === task.id;
	const row = renderTaskRow(task, { now, isOpen });
	if (!isOpen) return row;
	// Boundary moves are OMITTED (not greyed) — mirrors the section + area menus.
	const moveUpItem = isFirst
		? ""
		: `<button class="task-menu__item" type="button" data-action="move-task-up"
				role="menuitem" tabindex="-1">Move up</button>`;
	const moveDownItem = isLast
		? ""
		: `<button class="task-menu__item" type="button" data-action="move-task-down"
				role="menuitem" tabindex="-1">Move down</button>`;
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			${moveUpItem}
			${moveDownItem}
			<button class="task-menu__item" type="button" data-action="delete-task"
				role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
}
```

With:

```js
function renderTaskRowWithMenu(
	task,
	{ now, isFirst, isLast, openTaskMenuId, renamingTaskId, pendingRenameTaskValue },
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
	// Boundary moves are OMITTED (not greyed) — mirrors the section + area menus.
	const moveUpItem = isFirst
		? ""
		: `<button class="task-menu__item" type="button" data-action="move-task-up"
				role="menuitem" tabindex="-1">Move up</button>`;
	const moveDownItem = isLast
		? ""
		: `<button class="task-menu__item" type="button" data-action="move-task-down"
				role="menuitem" tabindex="-1">Move down</button>`;
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="rename-task"
				role="menuitem" tabindex="-1">Rename</button>
			${moveUpItem}
			${moveDownItem}
			<button class="task-menu__item" type="button" data-action="delete-task"
				role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
}
```

### 4.6 — Run the full suite

- [ ] Run:
```
npm test -- --run
```

Expected: **127 PASS**. (section.js still produces valid markup; area.js doesn't pass the new params yet so the rename branch is never triggered.)

### 4.7 — Biome check

- [ ] Run:
```
npm run check
```

Expected: clean.

### 4.8 — Stage + propose commit

- [ ] Stage:
```
src/views/section.js
```

Proposed commit message:
```
feat(views): thread task-rename state through section template; Rename menu item
```

---

## Task 5 — area.js: task-rename closure state + handlers + cross-type exclusion

**Files:**
- Modify: `src/views/area.js`

**Commit message (proposed):**
```
feat(views): inline task rename in area view
```

**Why:** After this task, area view's task rename is FULLY FUNCTIONAL end-to-end (click ⋯ → Rename → edit → Enter/Esc/blur → committed/cancelled). Grafts the M5 section-rename pattern (which already lives in this file) onto a parallel task-rename track.

**Key invariants (lifted verbatim from M5 + the spec § Invariants):**
1. `isRendering` try/finally wraps the innerHTML rewrite (already in place — extend, don't replicate).
2. Blur listener returns early if `isRendering` (mirrors section-rename pattern; required for 60s tick + unrelated model notifies).
3. `pendingRenameTaskValue ?? task.title` in template, NOT `||`. (Handled in Task 2; verify the chain.)
4. NO `commit-task-rename` entry in `bindActions` — Enter handler in `bindKeys` ONLY.
5. **Cross-type mutual exclusion**: `rename-task` MUST null section-rename state (`renamingId`, `pendingRenameValue`, `pendingRenameSelect`). Symmetric: `rename-section` MUST null all three task-rename vars (`renamingTaskId`, `pendingRenameTaskValue`, `pendingRenameTaskSelect`). Bidirectional.
6. `pendingFocusTaskId` set BEFORE doRender / before the async model.rename. Post-render lookup uses it, then nulls it.
7. Destroy-commit runs BEFORE listener unbinding. If a rename is in flight with a non-empty trimmed value, commit it.
8. Escape branch precedence: `renamingId` > `renamingTaskId` > `openMenuId` > `openTaskMenuId`. (Each `return`s after firing.)

---

### 5.1 — Add task-rename closure vars

- [ ] Open [src/views/area.js](src/views/area.js). Locate the closure state block (lines 62-73):

```js
export function createAreaView(rootEl, { areaId, callbacks }) {
	let lastState = null;
	let openMenuId = null;
	let openTaskMenuId = null;
	let renamingId = null;
	let pendingFocusSectionId = null;
	let pendingMenuFocusSectionId = null;
	let pendingRenameSelect = false;
	let pendingFocusTaskId = null;
	let pendingMenuFocusTaskId = null;
	let pendingRenameValue = null;
	let isRendering = false;
```

Add `renamingTaskId`, `pendingRenameTaskValue`, `pendingRenameTaskSelect` AFTER `pendingRenameValue`. The block becomes:

```js
export function createAreaView(rootEl, { areaId, callbacks }) {
	let lastState = null;
	let openMenuId = null;
	let openTaskMenuId = null;
	let renamingId = null;
	let pendingFocusSectionId = null;
	let pendingMenuFocusSectionId = null;
	let pendingRenameSelect = false;
	let pendingFocusTaskId = null;
	let pendingMenuFocusTaskId = null;
	let pendingRenameValue = null;
	let renamingTaskId = null;
	let pendingRenameTaskValue = null;
	let pendingRenameTaskSelect = false;
	let isRendering = false;
```

### 5.2 — Update the JSDoc closure-state comment to document the new vars

- [ ] Update the closure-state JSDoc comment (lines 3-39). Find the line:

```js
//   pendingRenameValue     - in-progress rename text, preserved across
//                            re-renders (60s tick, unrelated notifies) so
//                            typing isn't lost. "" on create (empty box),
//                            null on menu rename (prefill committed name).
//   isRendering            - true during the innerHTML rewrite; the blur
//                            listener checks it to ignore the synthetic blur
//                            fired when the focused input is detached.
```

Insert the three new var docs BETWEEN `pendingRenameValue` and `isRendering`:

```js
//   pendingRenameValue     - in-progress rename text, preserved across
//                            re-renders (60s tick, unrelated notifies) so
//                            typing isn't lost. "" on create (empty box),
//                            null on menu rename (prefill committed name).
//   renamingTaskId         - task id currently in rename mode, or null.
//                            Parallel to renamingId (sections), with full
//                            cross-type mutual exclusion in rename-task /
//                            rename-section action handlers.
//   pendingRenameTaskValue - in-progress task-rename text, preserved across
//                            re-renders. null on menu rename (prefill
//                            committed title). Must read with ??, not ||.
//   pendingRenameTaskSelect - true when entering task rename; on the next
//                            render the input is .focus()'d AND .select()'d.
//                            Cleared after one render so subsequent re-renders
//                            (60s tick) preserve cursor position.
//   isRendering            - true during the innerHTML rewrite; the blur
//                            listener checks it to ignore the synthetic blur
//                            fired when the focused input is detached.
//                            (Shared between section-rename and task-rename;
//                            one rewrite guards both.)
```

### 5.3 — Add `cancelTaskRename` function

- [ ] Locate the existing `cancelRename` function (lines 92-98):

```js
const cancelRename = () => {
	if (!renamingId) return;
	pendingFocusSectionId = renamingId;
	renamingId = null;
	pendingRenameValue = null;
	doRender();
};
```

AFTER it (before `docClickHandler` at line 100), add `cancelTaskRename`:

```js
const cancelTaskRename = () => {
	if (!renamingTaskId) return;
	pendingFocusTaskId = renamingTaskId;
	renamingTaskId = null;
	pendingRenameTaskValue = null;
	doRender();
};
```

### 5.4 — Extend `docKeyHandler` Escape branch (precedence: section-rename > task-rename > section-menu > task-menu)

- [ ] Locate the existing Escape branch in `docKeyHandler` (lines 129-143):

```js
const docKeyHandler = (event) => {
	if (event.key === "Escape") {
		if (renamingId) {
			cancelRename();
			return;
		}
		if (openMenuId) {
			closeMenu();
			return;
		}
		if (openTaskMenuId) {
			closeTaskMenu();
		}
		return;
	}
```

Replace the Escape `if` block with the 4-way precedence:

```js
const docKeyHandler = (event) => {
	if (event.key === "Escape") {
		if (renamingId) {
			cancelRename();
			return;
		}
		if (renamingTaskId) {
			cancelTaskRename();
			return;
		}
		if (openMenuId) {
			closeMenu();
			return;
		}
		if (openTaskMenuId) {
			closeTaskMenu();
		}
		return;
	}
```

(The rest of `docKeyHandler` — the arrow/Home/End/Tab branches starting at line 145 — is unchanged.)

### 5.5 — Update `rename-section` action handler for cross-type mutual exclusion

- [ ] Locate the existing `rename-section` action handler (lines 225-233):

```js
"rename-section": (_event, actionEl) => {
	const s = sectionFromEvent(actionEl);
	if (!s) return;
	openMenuId = null;
	renamingId = s.id;
	pendingRenameSelect = true;
	pendingRenameValue = null; // menu rename → prefill committed name
	doRender();
},
```

Replace with (adding 3 lines for cross-type mutual exclusion):

```js
"rename-section": (_event, actionEl) => {
	const s = sectionFromEvent(actionEl);
	if (!s) return;
	openMenuId = null;
	renamingId = s.id;
	pendingRenameSelect = true;
	pendingRenameValue = null; // menu rename → prefill committed name
	// Cross-type mutual exclusion — null task-rename state too.
	// If the user picks Rename on section X while task Y is renaming,
	// Y's typed value is silently discarded and X enters rename.
	renamingTaskId = null;
	pendingRenameTaskValue = null;
	pendingRenameTaskSelect = false;
	doRender();
},
```

### 5.6 — Add `rename-task` action handler

- [ ] Locate the `open-menu` action handler for tasks (lines 278-295). The new `rename-task` handler should be inserted AFTER `open-menu` and BEFORE `move-task-up` (which starts around line 297).

After the closing `},` of `open-menu`, add:

```js
"rename-task": (_event, actionEl) => {
	const t = taskFromEvent(actionEl);
	if (!t) return;
	openTaskMenuId = null;
	renamingTaskId = t.id;
	pendingRenameTaskSelect = true;
	pendingRenameTaskValue = null; // menu rename → prefill committed title
	// Cross-type mutual exclusion — null section-rename state.
	renamingId = null;
	pendingRenameValue = null;
	pendingRenameSelect = false;
	doRender();
},
```

### 5.7 — Extend `bindKeys` Enter handler to dispatch on `commit-task-rename`

- [ ] Locate the existing `bindKeys` block (lines 322-329):

```js
const unbindKeys = bindKeys(rootEl, {
	Enter: (event, actionEl) => {
		if (renamingId && actionEl?.dataset?.action === "commit-rename") {
			event.preventDefault(); // prevent form-like default
			commitRenameFromInput(actionEl);
		}
	},
});
```

Replace with:

```js
const unbindKeys = bindKeys(rootEl, {
	Enter: (event, actionEl) => {
		if (renamingId && actionEl?.dataset?.action === "commit-rename") {
			event.preventDefault(); // prevent form-like default
			commitRenameFromInput(actionEl);
			return;
		}
		if (
			renamingTaskId &&
			actionEl?.dataset?.action === "commit-task-rename"
		) {
			event.preventDefault();
			commitTaskRenameFromInput(actionEl);
		}
	},
});
```

### 5.8 — Add `commitTaskRenameFromInput` function

- [ ] Locate the existing `commitRenameFromInput` function (lines 331-345):

```js
function commitRenameFromInput(inputEl) {
	const id = inputEl?.dataset?.sectionId ?? renamingId;
	if (!id) return;
	const value = (inputEl?.value ?? "").trim();
	renamingId = null;
	pendingFocusSectionId = id;
	pendingRenameValue = null;
	if (value) {
		callbacks.onCommitRename({ sectionId: id, name: value });
		// Model write is async; the model-notify-driven re-render will
		// pick up pendingFocusSectionId and focus the new ⋯ button.
	} else {
		doRender(); // empty/cancel — re-render now to consume the flag
	}
}
```

AFTER it (before `function doRender()` at line 347), add the task variant:

```js
function commitTaskRenameFromInput(inputEl) {
	const id = inputEl?.dataset?.taskId ?? renamingTaskId;
	if (!id) return;
	const value = (inputEl?.value ?? "").trim();
	renamingTaskId = null;
	pendingFocusTaskId = id;
	pendingRenameTaskValue = null;
	if (value) {
		callbacks.onCommitTaskRename({ taskId: id, name: value });
		// Model write is async; the model-notify-driven re-render picks up
		// pendingFocusTaskId and focuses the renamed task's ⋯ button.
	} else {
		doRender(); // empty/cancel — re-render now to consume the flag
	}
}
```

### 5.9 — Thread new state into the `template()` call inside `doRender`

- [ ] Locate the `doRender` template call (lines 351-357):

```js
isRendering = true;
try {
	rootEl.innerHTML = template(lastState, areaId, {
		openMenuId,
		renamingId,
		openTaskMenuId,
		pendingRenameValue,
	});
} finally {
```

Replace the template-call object with (add two new fields):

```js
isRendering = true;
try {
	rootEl.innerHTML = template(lastState, areaId, {
		openMenuId,
		renamingId,
		openTaskMenuId,
		pendingRenameValue,
		renamingTaskId,
		pendingRenameTaskValue,
	});
} finally {
```

### 5.10 — Add task-rename input listeners + post-render focus block in `doRender`

- [ ] Locate the existing section-rename input block in `doRender` (lines 368-391):

```js
const input = rootEl.querySelector(".section__rename-input");
if (input) {
	input.addEventListener("input", (e) => {
		pendingRenameValue = e.target.value;
	});
	input.addEventListener(
		"blur",
		() => {
			if (isRendering) return;
			if (renamingId) commitRenameFromInput(input);
		},
		{ once: true },
	);

	// Only select() on first render after entering rename mode.
	// Subsequent re-renders preserve cursor.
	if (pendingRenameSelect) {
		input.focus();
		input.select();
		pendingRenameSelect = false;
	} else if (document.activeElement !== input) {
		input.focus();
	}
}
```

AFTER this block (before the `if (pendingFocusSectionId)` post-render lookup block at line 397), add the parallel task-rename block:

```js
// Re-attach task-rename input listeners. Same pattern as section-rename:
// pendingRenameTaskValue mirrors typing; blur commits but only for
// user-initiated blur (isRendering guards the synthetic blur on detach).
const taskRenameInput = rootEl.querySelector(".task__rename-input");
if (taskRenameInput) {
	taskRenameInput.addEventListener("input", (e) => {
		pendingRenameTaskValue = e.target.value;
	});
	taskRenameInput.addEventListener(
		"blur",
		() => {
			if (isRendering) return;
			if (renamingTaskId) commitTaskRenameFromInput(taskRenameInput);
		},
		{ once: true },
	);

	if (pendingRenameTaskSelect) {
		taskRenameInput.focus();
		taskRenameInput.select();
		pendingRenameTaskSelect = false;
	} else if (document.activeElement !== taskRenameInput) {
		taskRenameInput.focus();
	}
}
```

### 5.11 — Update `destroy()` for task-rename destroy-commit + state reset

- [ ] Locate the existing `destroy()` function (lines 450-478):

```js
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
	document.removeEventListener("keydown", docKeyHandler);
	rootEl.innerHTML = "";
	lastState = null;
	openMenuId = null;
	openTaskMenuId = null;
	pendingFocusSectionId = null;
	pendingFocusTaskId = null;
	pendingMenuFocusSectionId = null;
	pendingMenuFocusTaskId = null;
	pendingRenameSelect = false;
	pendingRenameValue = null;
	isRendering = false;
},
```

Replace with (add task destroy-commit BEFORE listener unbinding; add task state to final reset block):

```js
destroy() {
	// Destroy-commit: if a section rename is in flight and the input has
	// a non-empty trimmed value, commit it before tearing down.
	if (renamingId) {
		const input = rootEl.querySelector(".section__rename-input");
		const value = (input?.value ?? "").trim();
		if (value) {
			callbacks.onCommitRename({ sectionId: renamingId, name: value });
		}
		renamingId = null;
	}
	// Destroy-commit: same for an in-flight task rename. Order doesn't
	// matter (different inputs, different IDs); both fire BEFORE
	// listener unbinding so the typed value isn't lost.
	if (renamingTaskId) {
		const input = rootEl.querySelector(".task__rename-input");
		const value = (input?.value ?? "").trim();
		if (value) {
			callbacks.onCommitTaskRename({ taskId: renamingTaskId, name: value });
		}
		renamingTaskId = null;
	}
	unbindClick();
	unbindKeys();
	document.removeEventListener("click", docClickHandler);
	document.removeEventListener("keydown", docKeyHandler);
	rootEl.innerHTML = "";
	lastState = null;
	openMenuId = null;
	openTaskMenuId = null;
	pendingFocusSectionId = null;
	pendingFocusTaskId = null;
	pendingMenuFocusSectionId = null;
	pendingMenuFocusTaskId = null;
	pendingRenameSelect = false;
	pendingRenameValue = null;
	pendingRenameTaskValue = null;
	pendingRenameTaskSelect = false;
	isRendering = false;
},
```

### 5.12 — Update `template()` function signature to accept + thread new params

- [ ] Locate the `template()` function declaration at the bottom (lines 481-484):

```js
function template(
	state,
	areaId,
	{ openMenuId, renamingId, openTaskMenuId, pendingRenameValue },
) {
```

Replace with:

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

### 5.13 — Thread new params into the `renderSection` call inside `template()`

- [ ] Locate the `renderSection` call inside `template()` (lines 514-529):

```js
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
			now: state.now,
		}),
	)
	.join("");
```

Replace with (add `renamingTaskId` and `pendingRenameTaskValue` to the object):

```js
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

### 5.14 — Run the full suite

- [ ] Run:
```
npm test -- --run
```

Expected: **127 PASS**. (No JSDOM tests for views; this is a structural change.)

### 5.15 — Biome check

- [ ] Run:
```
npm run check
```

Expected: clean.

### 5.16 — Stage + propose commit

- [ ] Stage:
```
src/views/area.js
```

Proposed commit message:
```
feat(views): inline task rename in area view
```

---

## Task 6 — today.js: task-rename plumbing + introduce `bindKeys` + `isRendering`

**Files:**
- Modify: `src/views/today.js`

**Commit message (proposed):**
```
feat(views): inline task rename in today view
```

**Why:** Today view has historically had only `bindActions` and no `isRendering` guard because there was no rename state to protect. Phase 2 introduces BOTH lifecycle pieces:
- `bindKeys` for the Enter handler (no Esc — Esc lives on document because of innerHTML-detach behavior).
- `isRendering` try/finally around the innerHTML rewrite, paired with a blur listener early-return.

These are NOT optional. Without `isRendering`, the synthetic blur fired when innerHTML detaches the focused input would commit + exit rename on every 60s tick. The polish-bundle E2E confirms this hazard is real.

**Key invariants (mirrors Task 5; today-specific differences noted):**
- today.js menu has `[Rename, Delete]` only — no Move up/down (today is a sorted view).
- No `renamingId` (section rename) — today has only task-rename.
- No `pendingMenuFocusSectionId` — today has only task menus.
- No `enterRename` public method — only area's `+ New section` triggers post-create rename, not today.
- The local `renderTaskRowWithMenu` (today.js:231) is distinct from section.js's; it lives in today.js and needs its own threading.

---

### 6.1 — Extend imports to include `bindKeys`

- [ ] Open [src/views/today.js](src/views/today.js). Replace line 7:

```js
import { bindActions } from "../utils/dom.js";
```

With:

```js
import { bindActions, bindKeys } from "../utils/dom.js";
```

### 6.2 — Add new closure-state vars + JSDoc updates

- [ ] Locate the closure-state block (lines 16-23):

```js
export function createTodayView(rootEl, callbacks) {
	let lastState = null;
	let openMenuTaskId = null;
	let pendingFocusTaskId = null;
	// Set in open-menu when event.detail === 0 (keyboard activation): after
	// the next render, focus the first [role="menuitem"] inside this task's
	// menu. Mirrors pendingMenuFocusTaskId in area.js / sidebar.js.
	let pendingMenuFocusTaskId = null;
```

Replace with (add four new vars + a brief comment block for each):

```js
export function createTodayView(rootEl, callbacks) {
	let lastState = null;
	let openMenuTaskId = null;
	let pendingFocusTaskId = null;
	// Set in open-menu when event.detail === 0 (keyboard activation): after
	// the next render, focus the first [role="menuitem"] inside this task's
	// menu. Mirrors pendingMenuFocusTaskId in area.js / sidebar.js.
	let pendingMenuFocusTaskId = null;
	// Inline task rename — mirrors area.js / sidebar.js patterns:
	//   renamingTaskId          - task id in rename mode, or null
	//   pendingRenameTaskValue  - in-progress text; survives 60s ticks. ?? not ||.
	//   pendingRenameTaskSelect - true on first render after enter → focus+select
	//   isRendering             - true during innerHTML rewrite; blur-listener
	//                             early-returns to ignore the synthetic blur
	//                             fired when the focused input is detached.
	let renamingTaskId = null;
	let pendingRenameTaskValue = null;
	let pendingRenameTaskSelect = false;
	let isRendering = false;
```

### 6.3 — Extend `docKeyHandler` Escape branch with rename precedence

- [ ] Locate the existing Escape branch (lines 49-53):

```js
const docKeyHandler = (event) => {
	if (event.key === "Escape") {
		closeMenu();
		return;
	}
```

Replace with (rename precedence: rename > menu):

```js
const docKeyHandler = (event) => {
	if (event.key === "Escape") {
		if (renamingTaskId) {
			cancelTaskRename();
			return;
		}
		closeMenu();
		return;
	}
```

(`cancelTaskRename` is defined in step 6.4.)

### 6.4 — Add `cancelTaskRename` function

- [ ] Locate the existing `closeMenu` function (lines 28-33):

```js
const closeMenu = (returnFocus = true) => {
	if (!openMenuTaskId) return;
	if (returnFocus) pendingFocusTaskId = openMenuTaskId;
	openMenuTaskId = null;
	doRender();
};
```

AFTER `closeMenu`, BEFORE `docClickHandler` at line 35, add:

```js
const cancelTaskRename = () => {
	if (!renamingTaskId) return;
	pendingFocusTaskId = renamingTaskId;
	renamingTaskId = null;
	pendingRenameTaskValue = null;
	doRender();
};
```

### 6.5 — Add `rename-task` action handler in `bindActions`

- [ ] Locate the existing `bindActions` block (lines 96-127). After the `open-menu` handler (closes around line 121), BEFORE `delete-task` (starts line 122), insert:

```js
"rename-task": (_event, actionEl) => {
	const t = taskFromEvent(actionEl);
	if (!t) return;
	openMenuTaskId = null;
	renamingTaskId = t.id;
	pendingRenameTaskSelect = true;
	pendingRenameTaskValue = null; // menu rename → prefill committed title
	doRender();
},
```

The full `bindActions` block becomes (showing the surroundings so the engineer can confirm placement):

```js
const unbind = bindActions(rootEl, {
	"toggle-complete": (_event, actionEl) => {
		const t = taskFromEvent(actionEl);
		if (t) callbacks.onToggleComplete(t.id);
	},
	"toggle-star": (_event, actionEl) => {
		const t = taskFromEvent(actionEl);
		if (t) callbacks.onToggleStar(t.id, t.starred);
	},
	"open-menu": (event, actionEl) => {
		event.stopPropagation();
		const t = taskFromEvent(actionEl);
		if (!t) return;
		if (openMenuTaskId === t.id) {
			closeMenu();
			return;
		}
		openMenuTaskId = t.id;
		// Keyboard activations (Enter/Space) report event.detail === 0;
		// on keyboard-open move focus to the first menu item. Mouse users
		// (detail >= 1) keep focus on ⋯. Mirrors area.js / sidebar.js.
		if (event.detail === 0) {
			pendingMenuFocusTaskId = t.id;
		}
		doRender();
	},
	"rename-task": (_event, actionEl) => {
		const t = taskFromEvent(actionEl);
		if (!t) return;
		openMenuTaskId = null;
		renamingTaskId = t.id;
		pendingRenameTaskSelect = true;
		pendingRenameTaskValue = null; // menu rename → prefill committed title
		doRender();
	},
	"delete-task": (_event, actionEl) => {
		const t = taskFromEvent(actionEl);
		openMenuTaskId = null;
		if (t) callbacks.onDelete(t);
	},
});
```

### 6.6 — Add `bindKeys` block + `commitTaskRenameFromInput` function

- [ ] Locate the end of the `bindActions` block (line 127, the closing `});`). IMMEDIATELY AFTER it, BEFORE `function doRender()` at line 129, insert two things:

First, the `bindKeys` block:

```js
const unbindKeys = bindKeys(rootEl, {
	Enter: (event, actionEl) => {
		if (
			renamingTaskId &&
			actionEl?.dataset?.action === "commit-task-rename"
		) {
			event.preventDefault();
			commitTaskRenameFromInput(actionEl);
		}
	},
});
```

Then, the commit helper (immediately after `bindKeys`):

```js
function commitTaskRenameFromInput(inputEl) {
	const id = inputEl?.dataset?.taskId ?? renamingTaskId;
	if (!id) return;
	const value = (inputEl?.value ?? "").trim();
	renamingTaskId = null;
	pendingFocusTaskId = id;
	pendingRenameTaskValue = null;
	if (value) {
		callbacks.onCommitTaskRename({ taskId: id, name: value });
		// Model write is async; the model-notify-driven re-render picks up
		// pendingFocusTaskId and focuses the renamed task's ⋯ button.
	} else {
		doRender(); // empty/cancel — re-render now to consume the flag
	}
}
```

### 6.7 — Wrap `doRender` innerHTML in `isRendering` try/finally + add input listeners

- [ ] Replace the entire existing `doRender` function (lines 129-155):

```js
function doRender() {
	if (!lastState) return;
	rootEl.innerHTML = template(lastState, openMenuTaskId);

	// Post-render lookup: focus the task's ⋯ button by data-attribute.
	// Captured element refs go stale across innerHTML rewrites, so we
	// query the freshly-rendered DOM. Mirrors area.js's pendingFocusTaskId.
	if (pendingFocusTaskId) {
		const trigger = rootEl.querySelector(
			`[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
		);
		trigger?.focus();
		pendingFocusTaskId = null;
	}

	// Post-render lookup: when the task menu was opened via keyboard,
	// move focus to its first menu item. :not([disabled]) is a defensive
	// guard — .focus() on a disabled button is a silent no-op that drops
	// focus to <body>. Mirrors area.js / sidebar.js.
	if (pendingMenuFocusTaskId) {
		const firstItem = rootEl.querySelector(
			`[data-id="${CSS.escape(pendingMenuFocusTaskId)}"] [role="menu"] [role="menuitem"]:not([disabled])`,
		);
		firstItem?.focus();
		pendingMenuFocusTaskId = null;
	}
}
```

With:

```js
function doRender() {
	if (!lastState) return;

	isRendering = true;
	try {
		rootEl.innerHTML = template(
			lastState,
			openMenuTaskId,
			renamingTaskId,
			pendingRenameTaskValue,
		);
	} finally {
		// try/finally so a defensive template throw can't strand
		// isRendering=true and silently swallow all future blur-commits.
		isRendering = false;
	}

	// Re-attach task-rename input listeners on the NEW input (recreated
	// each render). pendingRenameTaskValue mirrors typing so it survives
	// re-renders; blur commits but skips the synthetic blur fired when
	// an innerHTML rewrite detaches the input.
	const taskRenameInput = rootEl.querySelector(".task__rename-input");
	if (taskRenameInput) {
		taskRenameInput.addEventListener("input", (e) => {
			pendingRenameTaskValue = e.target.value;
		});
		taskRenameInput.addEventListener(
			"blur",
			() => {
				if (isRendering) return;
				if (renamingTaskId) commitTaskRenameFromInput(taskRenameInput);
			},
			{ once: true },
		);

		// Only select() on first render after entering rename mode.
		// Subsequent re-renders (60s tick, unrelated notifies) preserve cursor.
		if (pendingRenameTaskSelect) {
			taskRenameInput.focus();
			taskRenameInput.select();
			pendingRenameTaskSelect = false;
		} else if (document.activeElement !== taskRenameInput) {
			taskRenameInput.focus();
		}
	}

	// Post-render lookup: focus the task's ⋯ button by data-attribute.
	// Captured element refs go stale across innerHTML rewrites, so we
	// query the freshly-rendered DOM. Mirrors area.js's pendingFocusTaskId.
	if (pendingFocusTaskId) {
		const trigger = rootEl.querySelector(
			`[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
		);
		trigger?.focus();
		pendingFocusTaskId = null;
	}

	// Post-render lookup: when the task menu was opened via keyboard,
	// move focus to its first menu item. :not([disabled]) is a defensive
	// guard — .focus() on a disabled button is a silent no-op that drops
	// focus to <body>. Mirrors area.js / sidebar.js.
	if (pendingMenuFocusTaskId) {
		const firstItem = rootEl.querySelector(
			`[data-id="${CSS.escape(pendingMenuFocusTaskId)}"] [role="menu"] [role="menuitem"]:not([disabled])`,
		);
		firstItem?.focus();
		pendingMenuFocusTaskId = null;
	}
}
```

### 6.8 — Update `destroy()` with destroy-commit + state reset + `unbindKeys`

- [ ] Locate the existing `destroy()` (lines 162-172):

```js
destroy() {
	unbind();
	document.removeEventListener("click", docClickHandler);
	document.removeEventListener("keydown", docKeyHandler);
	rootEl.innerHTML = "";
	lastState = null;
	openMenuTaskId = null;
	pendingFocusTaskId = null;
	pendingMenuFocusTaskId = null;
},
```

Replace with:

```js
destroy() {
	// Destroy-commit: if a task rename is in flight and the input has
	// a non-empty trimmed value, commit it BEFORE listener unbinding so
	// the typed value isn't silently lost on route change.
	if (renamingTaskId) {
		const input = rootEl.querySelector(".task__rename-input");
		const value = (input?.value ?? "").trim();
		if (value) {
			callbacks.onCommitTaskRename({ taskId: renamingTaskId, name: value });
		}
		renamingTaskId = null;
	}
	unbind();
	unbindKeys();
	document.removeEventListener("click", docClickHandler);
	document.removeEventListener("keydown", docKeyHandler);
	rootEl.innerHTML = "";
	lastState = null;
	openMenuTaskId = null;
	pendingFocusTaskId = null;
	pendingMenuFocusTaskId = null;
	pendingRenameTaskValue = null;
	pendingRenameTaskSelect = false;
	isRendering = false;
},
```

### 6.9 — Update `template()` signature to accept rename state

- [ ] Locate the `template()` function declaration (line 175):

```js
function template(state, openMenuTaskId) {
```

Replace with:

```js
function template(state, openMenuTaskId, renamingTaskId, pendingRenameTaskValue) {
```

### 6.10 — Thread rename state through template helpers (`renderNextCard`, `renderGroup`, `renderTaskRowWithMenu`)

- [ ] Locate the body of `template()` (lines 175-197). The current rendering chain calls `renderNextCard(next, state.now, openMenuTaskId)` and `renderGroup(…, openMenuTaskId, …)`. All four `renderTaskRowWithMenu` call sites need the new state.

Replace lines 191-196 (the return statement of `template()`):

```js
return `
	${next ? renderNextCard(next, state.now, openMenuTaskId) : ""}
	${renderGroup("Overdue", "group--overdue", overdue, state.now, openMenuTaskId, true)}
	${renderGroup("Today", "group--today", today, state.now, openMenuTaskId, true)}
	${renderGroup("Starred", "group--starred", starred, state.now, openMenuTaskId, false)}
`;
```

With:

```js
return `
	${next ? renderNextCard(next, state.now, openMenuTaskId, renamingTaskId, pendingRenameTaskValue) : ""}
	${renderGroup("Overdue", "group--overdue", overdue, state.now, openMenuTaskId, true, renamingTaskId, pendingRenameTaskValue)}
	${renderGroup("Today", "group--today", today, state.now, openMenuTaskId, true, renamingTaskId, pendingRenameTaskValue)}
	${renderGroup("Starred", "group--starred", starred, state.now, openMenuTaskId, false, renamingTaskId, pendingRenameTaskValue)}
`;
```

### 6.11 — Update `renderNextCard` to accept + thread the new params

- [ ] Replace the existing `renderNextCard` (lines 199-208):

```js
function renderNextCard(task, now, openMenuTaskId) {
	return `
		<article class="next-card">
			<h2 class="next-card__label">NEXT</h2>
			<ul class="next-card__list">
				${renderTaskRowWithMenu(task, now, openMenuTaskId)}
			</ul>
		</article>
	`;
}
```

With:

```js
function renderNextCard(task, now, openMenuTaskId, renamingTaskId, pendingRenameTaskValue) {
	return `
		<article class="next-card">
			<h2 class="next-card__label">NEXT</h2>
			<ul class="next-card__list">
				${renderTaskRowWithMenu(task, now, openMenuTaskId, renamingTaskId, pendingRenameTaskValue)}
			</ul>
		</article>
	`;
}
```

### 6.12 — Update `renderGroup` to accept + thread the new params

- [ ] Replace the existing `renderGroup` (lines 210-229):

```js
function renderGroup(
	heading,
	modifierClass,
	tasks,
	now,
	openMenuTaskId,
	showCount,
) {
	if (tasks.length === 0) return "";
	const headingText = showCount ? `${heading} (${tasks.length})` : heading;
	const rows = tasks
		.map((t) => renderTaskRowWithMenu(t, now, openMenuTaskId))
		.join("");
	return `
		<section class="group ${modifierClass}">
			<h3 class="group__heading">${headingText}</h3>
			<ul class="group__list">${rows}</ul>
		</section>
	`;
}
```

With:

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

### 6.13 — Update `renderTaskRowWithMenu` to handle rename mode + add Rename menu item

- [ ] Replace the existing `renderTaskRowWithMenu` at the end of the file (lines 231-245):

```js
function renderTaskRowWithMenu(task, now, openMenuTaskId) {
	const isOpen = openMenuTaskId === task.id;
	const row = renderTaskRow(task, { now, isOpen });
	if (!isOpen) return row;
	// Inject the menu inside the <li> as its last child. The <li> is set to
	// position: relative in CSS, so the menu's absolute positioning anchors
	// against the row. (Putting it after </li> would make it a direct child
	// of <ul>, which is invalid HTML.)
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
}
```

With:

```js
function renderTaskRowWithMenu(
	task,
	now,
	openMenuTaskId,
	renamingTaskId,
	pendingRenameTaskValue,
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
	// Inject the menu inside the <li> as its last child. The <li> is set to
	// position: relative in CSS, so the menu's absolute positioning anchors
	// against the row. (Putting it after </li> would make it a direct child
	// of <ul>, which is invalid HTML.)
	// Today menu: [Rename, Delete]. No Move up/down — today is a sorted view,
	// not a manual order.
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="rename-task" role="menuitem" tabindex="-1">Rename</button>
			<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
}
```

### 6.14 — Run the full suite

- [ ] Run:
```
npm test -- --run
```

Expected: **127 PASS**.

### 6.15 — Biome check

- [ ] Run:
```
npm run check
```

Expected: clean.

### 6.16 — Stage + propose commit

- [ ] Stage:
```
src/views/today.js
```

Proposed commit message:
```
feat(views): inline task rename in today view
```

---

## Task 7 — CSS: `.task--editing` + `.task__rename-input`

**Files:**
- Modify: `main.css`

**Commit message (proposed):**
```
feat(styles): .task--editing + .task__rename-input rules
```

**Why:** Visual polish — preserves row height during rename so other rows don't shift; gives the input a focused-accent border consistent with `.section__rename-input` and `.sidebar__rename-input`. The base.css file is untouched (per project convention: never touch base.css).

**Key invariants:**
- `.task--editing` overrides the grid layout to single-column (the input takes the full row width since checkbox / star / ⋯ are removed).
- `.task__rename-input` mirrors `.section__rename-input` styling (border accent, padding, font inherit, min-block-size 44px for touch targets).
- Mobile-first: baseline rules target small screens; no `min-width` media queries needed because the rename input has no breakpoint-specific behavior.

---

### 7.1 — Append the new rules at the END of main.css

- [ ] Open [main.css](main.css). Scroll to the END of the file (after the last existing rule — currently the `body.is-sidebar-collapsed` block at lines 736-742).

After the closing `}` of the last rule (line 742), append:

```css

/* --- Inline task rename --- */
/* When a task row is in rename mode, the <li> renders an input-only child.
   Override the grid layout so the input takes the full row width
   (checkbox / star / ⋯ are not rendered during rename — mutually exclusive
   with menu state). Row height is preserved by min-block-size on the input
   matching .task baseline padding so neighbours don't shift. */
.task--editing {
	display: block;
	padding: 0.5rem 0.6rem;
}
.task--editing:hover {
	background: transparent; /* no hover bg during rename — focus border is the affordance */
}
.task__rename-input {
	width: 100%;
	background: var(--color-bg-elevated);
	color: var(--color-text);
	border: 1px solid var(--color-accent);
	border-radius: var(--radius);
	padding: 0.5rem 0.75rem;
	font: inherit;
	min-block-size: 44px;
}
.task__rename-input:focus {
	outline: none;
}
```

**Why each rule:**
- `.task--editing { display: block }` — the base `.task` is a 6-column grid; switching to block lets the input fill the row naturally.
- `.task--editing:hover` — kills the `.task:hover` bg highlight during rename (visual noise; the accent border + focus state are the affordances).
- `.task__rename-input` — mirrors `.section__rename-input` (lines 465-477) and `.sidebar__rename-input` (lines 694-707). Same border-accent, same 44px touch target.

### 7.2 — Biome check

- [ ] Run:
```
npm run check
```

Expected: clean. (Biome lints JS by default in this repo; CSS may or may not be covered — verify by running. If Biome flags ordering issues like `noDescendingSpecificity`, those need to be fixed.)

### 7.3 — Run the full suite (defensive — CSS changes shouldn't affect tests)

- [ ] Run:
```
npm test -- --run
```

Expected: **127 PASS**.

### 7.4 — Stage + propose commit

- [ ] Stage:
```
main.css
```

Proposed commit message:
```
feat(styles): .task--editing + .task__rename-input rules
```

---

## Task 8 — E2E verification via Claude Preview MCP

**Files:** No file edits. Verification only.

**Commit:** None. (If issues are found, reopen the relevant Task and commit fixes separately.)

**Why:** Per the polish-bundle workflow: real-browser E2E across the full test matrix from the spec. Confirms the rename feature works in both views, all keyboard paths, all edge cases, and that NO existing M1-M5 + polish-bundle invariants regressed.

**Setup:** The dev server is launched via `.claude/launch.json` (gitignored) and the Claude Preview MCP. Use `preview_start name:"ignite-dev"` if not already running.

**Important per memory:** `preview_click` can silently no-op (s2 lesson). If a click doesn't behave as expected, fall back to synthetic dispatch via `preview_eval`:
```js
el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })) // 0 = keyboard
```
And the multi-eval time-window lesson: any test relying on the 5s toast aggregation window must be in ONE `preview_eval` (cross-eval delays are non-deterministic).

---

### 8.1 — Start the dev server + verify boot

- [ ] Use `mcp__Claude_Preview__preview_start` with `name: "ignite-dev"`. Wait for it to be ready.
- [ ] `preview_console_logs` — expected: no errors at boot.
- [ ] `preview_snapshot` — expected: today view renders, focus area visible in sidebar.

### 8.2 — Area view: full rename flow (happy path)

- [ ] Navigate to a non-empty section in the focus area (or any area with a task). If empty, capture a task first via the capture bar.
- [ ] Open the task's ⋯ menu (click). Verify the menu shows: `[Rename, Move up?, Move down?, Delete]` (Move items omitted if first/last; Rename is FIRST; Delete is LAST).
- [ ] Click "Rename". Verify:
  - The task row now shows a text input with the committed title selected.
  - `.task--editing` class is on the `<li>`.
  - The checkbox / star / ⋯ are gone.
  - Focus is on the input.
- [ ] Type a new title (replacing the selected text). Press Enter.
- [ ] Verify:
  - The row reappears with the new title, capitalized (first letter uppercase, rest verbatim).
  - Focus is on the row's ⋯ button (`pendingFocusTaskId` flow).
  - No console errors.
  - IndexedDB has the new title (verify via `preview_eval` querying tasks store).

### 8.3 — Area view: Esc cancels (typed value discarded)

- [ ] Open ⋯ → Rename on another task.
- [ ] Type some text (DON'T press Enter).
- [ ] Press Esc.
- [ ] Verify:
  - Row restored with the ORIGINAL title (typed text discarded).
  - Focus on ⋯.

### 8.4 — Area view: empty commit (Enter on cleared input) cancels

- [ ] Open ⋯ → Rename.
- [ ] Clear the input completely (Ctrl-A, Delete).
- [ ] Press Enter.
- [ ] Verify:
  - Row restored with the ORIGINAL title.
  - Model NOT written (controller's commitTaskRenameFromInput short-circuits on empty).
  - Focus on ⋯.

### 8.5 — Area view: blur (click outside) commits non-empty value

- [ ] Open ⋯ → Rename.
- [ ] Type a new title.
- [ ] Click into the capture input (or any element outside the row).
- [ ] Verify:
  - Row updated with the new title.
  - Focus is on whatever was clicked (NOT on ⋯ — click-outside blur commits but doesn't steal focus back).

### 8.6 — Area view: 60s tick preserves typing (isRendering blur-guard)

- [ ] Temporarily lower `TICK_MS` in [src/controller.js](src/controller.js) to `5000` (5s):

```js
const TICK_MS = 5_000; // TEMP for E2E; revert before commit
```

- [ ] Save. Dev server reloads.
- [ ] Open ⋯ → Rename. Type half a new title. **WAIT 6 seconds** (tick fires).
- [ ] Verify:
  - The rename input is STILL in rename mode (didn't auto-commit).
  - The typed text is still in the input.
  - The cursor is preserved at its position (not select-all'd by `pendingRenameTaskSelect` — that flag was cleared after the first render).
- [ ] Press Enter. Verify the typed title is committed.
- [ ] **REVERT** `TICK_MS` to `60_000`:

```js
const TICK_MS = 60_000;
```

### 8.7 — Area view: cross-type mutual exclusion (section ↔ task)

- [ ] Click a section's ⋯ → Rename. Don't commit; the section header is now an input.
- [ ] Click a task's ⋯ in the SAME section → Rename.
- [ ] Verify:
  - The section's rename is silently discarded.
  - The task's row is now an input.
  - No console errors.
- [ ] Reverse: click a task's ⋯ → Rename (the same or a different task). Then click the section's ⋯ → Rename.
- [ ] Verify:
  - The task's rename is silently discarded.
  - The section header is an input.

### 8.8 — Area view: destroy-commit on route change

- [ ] Open ⋯ → Rename on a task. Type a new title (don't commit).
- [ ] Click "Today" in the sidebar to navigate (`#today` hash change).
- [ ] Verify:
  - Hash changes; today view renders.
  - Navigate back to the area.
  - The task has the NEW title (destroy-commit fired before unbind).

### 8.9 — Today view: full rename flow

- [ ] Click "Today" (or navigate to `#today`).
- [ ] Pick a task in the Overdue, Today, Starred, or NEXT group.
- [ ] Open ⋯ → Rename. Verify menu is `[Rename, Delete]` (NO Move up/down — today is sorted).
- [ ] Type a new title. Press Enter.
- [ ] Verify:
  - Title updated + capitalized.
  - Focus on ⋯.

### 8.10 — Today view: NEXT card rename

- [ ] In today view, identify the NEXT card task (top, orange-left-border).
- [ ] Open ⋯ → Rename.
- [ ] Verify:
  - The input renders inside the NEXT card wrapper.
  - The "NEXT" label is still visible above the input.
  - No layout breakage (CSS quirk flagged in spec — verify visually).
- [ ] Commit a new title. Verify it sticks.

### 8.11 — Today view: 60s tick preserves typing

- [ ] Lower `TICK_MS` again (5000).
- [ ] In today view, open ⋯ → Rename. Type half. Wait 6s.
- [ ] Verify: still in rename mode, text intact. Press Enter to commit.
- [ ] **REVERT** `TICK_MS` to 60_000.

### 8.12 — Today view: Esc / empty / blur paths (same as area)

- [ ] Esc cancels.
- [ ] Empty Enter cancels.
- [ ] Blur (click capture bar) commits non-empty.

### 8.13 — Today view: destroy-commit on route change

- [ ] Open ⋯ → Rename. Type. Click an area in the sidebar.
- [ ] Verify the rename committed on the way out.

### 8.14 — Cross-view: open in today, commit-by-blur via clicking sidebar

- [ ] In today, open ⋯ → Rename. Type new title.
- [ ] Click "Focus" (or any area) in the sidebar. Focus changes; the rename input loses focus → blur fires.
- [ ] Verify the commit happened (model write before/during destroy).

### 8.15 — Cascade race: cascade-delete parent section mid-rename

- [ ] In an area, pick a non-Focus section with at least one task.
- [ ] Open the task's ⋯ → Rename. Type something (don't commit).
- [ ] Now use the section's ⋯ → Delete.
- [ ] Verify:
  - The section's cascade toast appears.
  - The rename input is gone (the row was removed).
  - No console error (the `Task not found` is swallowed by the controller's onCommitTaskRename catch).
- [ ] Click Undo on the cascade toast. The section + tasks restore with their PRE-RENAME titles (typed text is lost — by design, documented in spec).

### 8.16 — Cascade race: cascade-delete parent area mid-rename

- [ ] In a NON-focus area, open a task's ⋯ → Rename. Type.
- [ ] Open the area's ⋯ in the sidebar → Delete.
- [ ] Verify:
  - `deleteAreaCascade` redirects to `#today` FIRST (the area page would otherwise flash "not found").
  - Area-view destroy-commit fires → typed value commits.
  - BUT, the cascade then deletes the task. Net effect: the rename's model write may race the cascade.
  - **Acceptable outcomes:** (a) the toast Undo restores the task with its PRE-rename title (rename was lost), OR (b) it restores with the renamed title (rename won the race). Either is fine — no console error in either case.

### 8.17 — A11y: keyboard menu nav → Rename → input has aria-label

- [ ] Tab to a task's ⋯ button.
- [ ] Press Enter (keyboard open). Menu opens; focus on first menuitem (Rename).
- [ ] Press Enter. Verify:
  - Rename input appears.
  - Focus is on the input.
  - The input has `aria-label="Rename task: <committed title>"`.
- [ ] Press Esc. Focus returns to ⋯.

### 8.18 — A11y: Tab in rename input commits + closes mode (NOT the menu-Tab)

- [ ] Enter rename. Type new title.
- [ ] Press Tab.
- [ ] Verify:
  - Focus moves to the next focusable element (capture bar, or next ⋯).
  - The blur listener fired → committed the new title.
  - The row is no longer in rename mode.

### 8.19 — Smoke: no regressions in toast aggregation (polish-bundle)

- [ ] In today, delete 3 tasks within 5s of each other.
- [ ] Verify toast aggregates to "3 tasks deleted".
- [ ] Click Undo → all 3 restored.
- [ ] (Sanity check that Task 5's controller-scoped batch wasn't broken.)

### 8.20 — Smoke: no regressions in section / area rename

- [ ] Rename a section. Verify works.
- [ ] Rename an area. Verify works.
- [ ] Both should behave identically to pre-Phase-2.

### 8.21 — Final regression sweep

- [ ] `preview_console_logs` — expected: ZERO errors across all the above flows.
- [ ] `preview_network` — expected: no failed requests (no remote network in this app, but the file watch should be live without 404s).
- [ ] Run `npm test -- --run` one final time → **127 PASS**.
- [ ] Run `npm run check` → clean.
- [ ] `git status` → only the 7 changed files staged across the 7 task commits.

### 8.22 — If any test in 8.2-8.20 fails

- [ ] Identify the offending Task (1-7).
- [ ] Re-open that Task. Fix.
- [ ] Stage + commit as a SEPARATE atomic commit with a clear message (e.g., `fix(views): preserve focus on Esc during task rename in today view`).
- [ ] Re-run the failing E2E scenario.
- [ ] Re-run the full suite.

---

## Final acceptance

After all 7 implementation tasks committed + Task 8 verified:

- [ ] `npm test -- --run` → **127 PASS**, 0 fail.
- [ ] `npm run check` → Biome clean.
- [ ] All 21 Task 8 E2E checkpoints have passed in a real browser via Claude Preview MCP.
- [ ] Zero console errors during any E2E flow.
- [ ] All M5 + polish-bundle invariants preserved:
  - `isRendering` blur-guard intact in both today + area + sidebar.
  - Boundary moves omitted (not greyed) in all three menus.
  - Click-outside doesn't steal focus to ⋯ (menus and rename inputs).
  - Esc closes rename > menu (precedence).
  - Cross-type mutual exclusion bidirectional (section ↔ task in area).
  - Cascade swallow path silent (no console error on race).
  - 60s tick preserves typing in all three rename surfaces (section, area, task).
- [ ] Git log shows 7 atomic feat/feat commits (model → template → controller → section thread → area → today → CSS).
- [ ] Tree clean (no uncommitted work after the 7th commit).
- [ ] Memory log entry appended to MEMORY.md summarizing what shipped (commits, test count, any deviations from this plan).

---

## Spec-coverage self-review

Spec sections vs implementation:

| Spec section | Covered by |
|---|---|
| Approach A+C (shared template + per-view plumbing) | Task 2 (template) + Tasks 5+6 (per-view plumbing) |
| Architecture — Model `async rename` | Task 1 |
| Architecture — View `renderTaskRow` rename branch | Task 2 |
| Architecture — `section.js` threading + menu item | Task 4 |
| Architecture — `today.js` plumbing | Task 6 |
| Architecture — `area.js` plumbing | Task 5 |
| Architecture — Controller `onCommitTaskRename` | Task 3 |
| Architecture — CSS `.task--editing` + `.task__rename-input` | Task 7 |
| Template — `renderTaskRow` rename branch + invariants (??, escapeHtml on all 4 attrs, no commit-task-rename click action, task--editing modifier, autofocus) | Task 2 |
| State machine — `renamingTaskId` / `pendingRenameTaskValue` / `pendingRenameTaskSelect` / `pendingFocusTaskId` / `isRendering` | Tasks 5 (area) + 6 (today) |
| Actions — `rename-task` (both views) | Tasks 5.6 (area) + 6.5 (today) |
| Actions — `commit-task-rename` (NO click action) | Tasks 5.7 (Enter handler) + 6.6 (Enter handler) |
| Actions — `rename-section` extension (cross-type mutual exclusion) | Task 5.5 |
| Actions — today.js NEW `bindKeys` lifecycle | Task 6.1 (import) + 6.6 (bindKeys block) + 6.8 (unbindKeys in destroy) |
| Actions — `cancelTaskRename` | Tasks 5.3 + 6.4 |
| Actions — `commitTaskRenameFromInput` | Tasks 5.8 + 6.6 |
| `docKeyHandler` Escape extensions | Tasks 5.4 + 6.3 |
| `doRender` extensions (innerHTML wrap + input listeners + post-render focus) | Tasks 5.10 (area) + 6.7 (today) |
| `destroy()` extensions (destroy-commit + state reset) | Tasks 5.11 + 6.8 |
| Controller wiring (`onCommitTaskRename` in both mounts + cascade-race swallow) | Task 3 |
| Task ⋯ menu — Rename first, Delete last | Tasks 4.5 (area via section.js) + 6.13 (today) |
| Edge cases — 60s tick mid-rename | Task 8.6 + 8.11 (E2E) |
| Edge cases — model-deleted, section/area cascade | Tasks 8.15 + 8.16 (E2E) |
| Edge cases — Route change mid-rename (destroy-commit) | Tasks 8.8 + 8.13 (E2E) |
| Edge cases — Esc / Enter / blur / click inside input | Tasks 8.3 + 8.4 + 8.5 + 8.18 (E2E) |
| Edge cases — Cross-type rename hijack | Task 8.7 (E2E) |
| Edge cases — NEXT card in today | Task 8.10 (E2E) |
| Edge cases — Title containing markup | Task 2 (escapeHtml chain, verified visually in 8.2) |
| Edge cases — Empty / whitespace title | Tasks 1.1 (test) + 8.4 (E2E) |
| Invariants 1-10 (lifted from M5) | Tasks 5 + 6 — each plan step calls out the invariant it preserves |
| Files touched — 8 paths, ~252 LOC | Task ordering covers each file; spec's `src/styles/main.css` corrected to `main.css` |
| Testing — Unit (6 new task-rename tests) | Task 1 |
| Testing — Manual / Claude Preview MCP E2E | Task 8 (22 sub-steps mirroring spec's test matrix) |
| Out of scope (v0.2 candidates) | NOT covered (correctly) |

**Coverage check:** every spec requirement maps to a task. No gaps.

**Placeholder scan:** No `TBD`, `TODO`, "fill in details", or vague "add error handling" — every step contains exact code.

**Type / signature consistency check:**
- `tasks.rename(id, title)` is the model signature used in Task 1 (definition), Task 3 (controller call), Tasks 5.8 + 6.6 (view's `onCommitTaskRename` callback passes `{ taskId, name }` which the controller maps to `tasks.rename(taskId, name)`).
- `onCommitTaskRename({ taskId, name })` is the consistent callback shape across:
  - Task 3 (controller declaration in both view mounts)
  - Tasks 5.8 + 5.11 (area.js calls)
  - Tasks 6.6 + 6.8 (today.js calls)
- `renderTaskRow(task, { now, isOpen, renaming, pendingRenameValue })` signature is consistent across:
  - Task 2 (definition)
  - Task 4.5 (section.js `renderTaskRowWithMenu` calls with `renaming: true, pendingRenameValue: pendingRenameTaskValue`)
  - Task 6.13 (today.js `renderTaskRowWithMenu` calls with same pattern)
- Closure-var names (`renamingTaskId`, `pendingRenameTaskValue`, `pendingRenameTaskSelect`, `pendingFocusTaskId`, `isRendering`) are identical across area.js (Task 5) and today.js (Task 6). No drift.
