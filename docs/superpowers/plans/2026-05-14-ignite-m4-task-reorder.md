# M4 — Task reorder via ⋯ menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Move up / Move down to the task ⋯ menu in area view, mirroring the M3 section-reorder pattern, with a critical "filter peers to incomplete" fix and a small a11y bump on the existing task `⋯` trigger.

**Architecture:** Add `tasks.swapOrder` to the model (parallel to `sections.swapOrder`). Controller helper `moveTask(taskId, direction)` finds the visible (incomplete) neighbour and calls `swapOrder`. View work: `renderTaskRow` gains an `isOpen` param so `.task__menu-btn` can emit `aria-expanded` and `aria-label`; `section.js` renders the new menu items; `area.js` wires actions + post-render focus via a new `pendingFocusTaskId` closure flag; `today.js` threads its menu state through so the new `aria-expanded` doesn't lie. CSS gains one rule for touch-target compliance.

**Tech Stack:** Vanilla JS (no framework, no TypeScript), vitest for unit tests, Biome for lint/format, IndexedDB for persistence, MVC architecture.

**Spec:** [docs/superpowers/specs/2026-05-14-ignite-m4-task-reorder-design.md](../specs/2026-05-14-ignite-m4-task-reorder-design.md)

**Test count at end:** 93 (was 91).

**Commit convention:** Malin commits via GitHub Desktop. Each task ends with a "Stage and commit" step that proposes message + files; the executing agent must NOT run `git commit` directly. Stop at each commit step and wait for Malin.

---

## File Structure

| File | Touched | Responsibility |
|------|---------|----------------|
| `src/model/tasks.js` | Modify | Add `swapOrder(idA, idB)` method; expand JSDoc with public API list |
| `tests/unit/tasks.test.js` | Modify | Add `describe("createTaskModel — swapOrder")` with 2 tests |
| `src/controller.js` | Modify | Add `moveTask(taskId, direction)` helper; wire `onMoveTaskUp`/`onMoveTaskDown` callbacks |
| `src/views/task.js` | Modify | `renderTaskRow` accepts `isOpen`, emits `aria-expanded` and `aria-label` |
| `src/views/today.js` | Modify | Thread `openMenuTaskId` into `renderTaskRow` via local `renderTaskRowWithMenu` |
| `src/views/section.js` | Modify | Thread `isFirst`/`isLast`/`isOpen` into local `renderTaskRowWithMenu`; render Move up / Move down / Delete |
| `src/views/area.js` | Modify | Add `pendingFocusTaskId` closure flag, `move-task-up`/`move-task-down` actions, post-render lookup; update callback JSDoc |
| `main.css` | Modify | `.task-menu__item { min-block-size: 44px; }` |

---

## Task 1 — Model: `tasks.swapOrder` (TDD)

**Files:**
- Modify: `tests/unit/tasks.test.js` (append new describe block)
- Modify: `src/model/tasks.js`

- [ ] **Step 1.1: Write the two failing tests**

Append to the bottom of `tests/unit/tasks.test.js`:

```js
describe("createTaskModel — swapOrder", () => {
	it("swaps order values between two tasks in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ sectionId: "s1", title: "A" });
		const b = await model.create({ sectionId: "s1", title: "B" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.swapOrder(a.id, b.id);
		const list = await model.listBySection("s1");
		expect(list[0].id).toBe(b.id);
		expect(list[1].id).toBe(a.id);
		expect(calls).toEqual(["notified"]); // single notify
	});

	it("throws when either task id is missing", async () => {
		const { model } = await freshModel();
		await expect(model.swapOrder("nope-a", "nope-b")).rejects.toThrow(
			/Task not found/,
		);
		const a = await model.create({ sectionId: "s1", title: "A" });
		await expect(model.swapOrder(a.id, "nope-b")).rejects.toThrow(
			/Task not found/,
		);
	});
});
```

- [ ] **Step 1.2: Run the new tests to verify they fail**

Run: `npx vitest run tests/unit/tasks.test.js`
Expected: 2 tests fail with `TypeError: model.swapOrder is not a function` (or similar). All previously-passing tests still pass.

- [ ] **Step 1.3: Implement `swapOrder` in the model**

In `src/model/tasks.js`, add this method to the returned object (place it after `removeMany`, before the closing `};` of `createTaskModel`):

```js
async swapOrder(idA, idB) {
	const [a, b] = await Promise.all([
		db.get("tasks", idA),
		db.get("tasks", idB),
	]);
	if (!a) throw new Error(`Task not found: ${idA}`);
	if (!b) throw new Error(`Task not found: ${idB}`);
	await Promise.all([
		db.put("tasks", { ...a, order: b.order }),
		db.put("tasks", { ...b, order: a.order }),
	]);
	notify(); // single notify after both writes
},
```

Note: the `a` and `b` records come straight from IDB storage and are written back directly — no `fromStorage`/`toStorage` round-trip needed because we're only changing the `order` field (a number that isn't in the `BOOL_FIELDS` conversion list).

- [ ] **Step 1.4: Update the JSDoc header to include a public API list (parallel to sections.js)**

Replace the JSDoc at the top of `src/model/tasks.js` (lines 1-10 — the `// createTaskModel(db) → Promise<TaskModel>` block and the storage note) with:

```js
// createTaskModel(db) → Promise<TaskModel>
//
// TaskModel = {
//   subscribe(fn) → unsubscribe,
//   list() → Promise<Task[]>,
//   listBySection(sectionId) → Promise<Task[]>,  // ordered by `order`
//   create({ sectionId, title, ...metadata }) → Promise<Task>,
//   update(id, patch) → Promise<Task>,
//   toggleCompleted(id) → Promise<Task>,
//   remove(id) → Promise<void>,
//   removeMany(ids) → Promise<void>,
//   swapOrder(idA, idB) → Promise<void>,
//   restore(snapshot) → Promise<Task>,
//   restoreMany(snapshots) → Promise<void>,
// }
//
// Storage note: IndexedDB can't index booleans. We persist `completed`,
// `starred`, and `critical` as 0/1 and convert at the model boundary, so the
// public API always uses true/false.
```

- [ ] **Step 1.5: Run the full test suite**

Run: `npm test`
Expected: 93 tests passing (91 previous + 2 new).

- [ ] **Step 1.6: Run Biome**

Run: `npx biome check .`
Expected: "Checked 39 files in Xms. No fixes applied." — i.e. clean.

- [ ] **Step 1.7: Stage and commit (Malin via GitHub Desktop)**

Files to stage: `src/model/tasks.js`, `tests/unit/tasks.test.js`.

Proposed commit message:

```
feat(model): add tasks.swapOrder + JSDoc API list
```

Stop here. Wait for Malin to commit before proceeding.

---

## Task 2 — Controller: `moveTask` helper + callback wiring

**Files:**
- Modify: `src/controller.js`

- [ ] **Step 2.1: Add the `moveTask` helper**

Find `moveSection` in `src/controller.js` (lines 153-165). Immediately after it (after the closing `}` of `moveSection`), insert:

```js
async function moveTask(taskId, direction) {
	const allTasks = await tasks.list();
	const target = allTasks.find((t) => t.id === taskId);
	if (!target) return;
	const peers = (await tasks.listBySection(target.sectionId)).filter(
		(t) => !t.completed,
	); // already sorted by order in listBySection
	const idx = peers.findIndex((t) => t.id === taskId);
	const neighbourIdx = direction === "up" ? idx - 1 : idx + 1;
	if (neighbourIdx < 0 || neighbourIdx >= peers.length) return;
	const neighbour = peers[neighbourIdx];
	await tasks.swapOrder(target.id, neighbour.id);
}
```

**Critical:** the `.filter((t) => !t.completed)` line is the key difference from `moveSection`. The area view shows only incomplete tasks; without this filter, a click could swap with a hidden completed task and produce no visible change. Do not omit it.

- [ ] **Step 2.2: Wire the two new callbacks into `areaCallbacks`**

Find the `areaCallbacks` function in `src/controller.js`. After the `onMoveDown` callback (around line 115-117), and before `onDeleteSection`, insert:

```js
onMoveTaskUp: async ({ taskId }) => {
	await moveTask(taskId, "up");
},

onMoveTaskDown: async ({ taskId }) => {
	await moveTask(taskId, "down");
},
```

- [ ] **Step 2.3: Run the full test suite**

Run: `npm test`
Expected: 93 passing. No new tests in this task — controller is verified manually later.

- [ ] **Step 2.4: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 2.5: Stage and commit**

Files: `src/controller.js`.

Proposed commit message:

```
feat(controller): wire moveTask with !completed peer filter
```

Stop here. Wait for Malin to commit.

---

## Task 3 — View: `renderTaskRow` a11y signature + today.js threading

**Files:**
- Modify: `src/views/task.js`
- Modify: `src/views/today.js`

This task changes a function signature and updates one caller. Both files must change together so the codebase is never in a state where `aria-expanded` lies.

- [ ] **Step 3.1: Update `renderTaskRow` signature and ⋯ button markup**

Replace the entire `src/views/task.js` with:

```js
// Renders one task row. Returned as a string so the parent template can
// concatenate. Always escape user-provided fields before interpolating —
// titles can contain `<` and would otherwise execute as HTML.

import { escapeHtml } from "../utils/dom.js";
import { formatTimeLabel } from "../utils/time.js";

export function renderTaskRow(task, { now, isOpen = false } = { now: new Date() }) {
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
```

Changes vs the previous version:
- `isOpen = false` added to the options destructure (defaults make this non-breaking).
- `.task__menu-btn` gains `aria-expanded="${isOpen}"` and `aria-label="Task options: ${escapeHtml(task.title)}"`.

- [ ] **Step 3.2: Update today.js's `renderTaskRowWithMenu` to pass `isOpen`**

In `src/views/today.js`, find the `renderTaskRowWithMenu` function (lines 137-150). Replace it with:

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
			<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem">Delete</button>
		</div></li>`,
	);
}
```

Changes vs the previous version: computes `isOpen` once and passes it through to `renderTaskRow`, and uses it as the menu-injection guard.

- [ ] **Step 3.3: Run the test suite**

Run: `npm test`
Expected: 93 passing (no behaviour change; signature defaults keep tests green).

- [ ] **Step 3.4: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 3.5: Stage and commit**

Files: `src/views/task.js`, `src/views/today.js`.

Proposed commit message:

```
feat(views): add aria-expanded + aria-label to task ⋯ button
```

Stop here. Wait for Malin to commit.

---

## Task 4 — View: section.js task menu expansion

**Files:**
- Modify: `src/views/section.js`

- [ ] **Step 4.1: Update `renderBody` to thread `isFirst`/`isLast`/`isOpen` into the row helper**

In `src/views/section.js`, find `renderBody` (lines 124-133). Replace it with:

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

`isFirst`/`isLast` are computed against the **already-filtered, already-sorted** incomplete tasks array passed in by `renderSection` (see [section.js:42](../../src/views/section.js#L42) and area.js's `tasksBySection` filter). This matches what the user sees and is what the spec calls "the visible list".

- [ ] **Step 4.2: Update `renderTaskRowWithMenu` to accept the new opts and render the expanded menu**

Find `renderTaskRowWithMenu` (lines 135-144 — the one in `section.js`, not `today.js`). Replace it with:

```js
function renderTaskRowWithMenu(task, { now, isFirst, isLast, openTaskMenuId }) {
	const isOpen = openTaskMenuId === task.id;
	const row = renderTaskRow(task, { now, isOpen });
	if (!isOpen) return row;
	const upDisabled = isFirst ? "disabled" : "";
	const downDisabled = isLast ? "disabled" : "";
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="move-task-up"
				role="menuitem" ${upDisabled}>Move up</button>
			<button class="task-menu__item" type="button" data-action="move-task-down"
				role="menuitem" ${downDisabled}>Move down</button>
			<button class="task-menu__item" type="button" data-action="delete-task"
				role="menuitem">Delete</button>
		</div></li>`,
	);
}
```

Changes vs the previous version:
- Signature: `(task, { now, isFirst, isLast, openTaskMenuId })` instead of `(task, now, openTaskMenuId)`.
- Computes `isOpen` and threads it into `renderTaskRow` (for `aria-expanded`).
- Menu HTML now has three buttons: Move up (disabled at top), Move down (disabled at bottom), Delete.

- [ ] **Step 4.3: Run the test suite**

Run: `npm test`
Expected: 93 passing (no behaviour change yet — area.js isn't wired to handle the new actions).

- [ ] **Step 4.4: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 4.5: Stage and commit**

Files: `src/views/section.js`.

Proposed commit message:

```
feat(area): render Move up/down in task ⋯ menu
```

Stop here. Wait for Malin to commit.

---

## Task 5 — View: area.js action wiring + post-render focus

**Files:**
- Modify: `src/views/area.js`

- [ ] **Step 5.1: Update the closure-state JSDoc at the top of `area.js`**

In `src/views/area.js`, find the JSDoc block starting at line 1 (the `createAreaView(...)` doc). Update the "Closure state" comment to add `pendingFocusTaskId`. Specifically, find:

```js
//   pendingRenameSelect    - true when entering rename; on the next render
//                            the input is .focus()-ed AND .select()-ed.
//                            Cleared after that one render so subsequent
//                            re-renders (60s tick, unrelated notifies)
//                            preserve cursor position.
```

After that block (before the `// We do NOT capture...` paragraph), add:

```js
//   pendingFocusTaskId     - mirror of pendingFocusSectionId for task rows.
//                            After the next render, look up the task's
//                            ⋯ button by data-id and focus it. Used for
//                            Move up / Move down focus return.
```

Then in the "callbacks:" list further down, after `onMoveDown({ sectionId })`, add:

```js
//   onMoveTaskUp({ taskId })
//   onMoveTaskDown({ taskId })
```

- [ ] **Step 5.2: Add the `pendingFocusTaskId` closure flag**

Find the closure-state declarations at the top of `createAreaView` (around lines 42-48). After `let pendingRenameSelect = false;`, add:

```js
let pendingFocusTaskId = null;
```

- [ ] **Step 5.3: Add the two new action handlers**

In the `bindActions` block, find the existing `"delete-task"` handler (around lines 204-208). Immediately before it, insert:

```js
"move-task-up": (_event, actionEl) => {
	const t = taskFromEvent(actionEl);
	openTaskMenuId = null;
	if (t) {
		pendingFocusTaskId = t.id;
		callbacks.onMoveTaskUp({ taskId: t.id });
	}
},

"move-task-down": (_event, actionEl) => {
	const t = taskFromEvent(actionEl);
	openTaskMenuId = null;
	if (t) {
		pendingFocusTaskId = t.id;
		callbacks.onMoveTaskDown({ taskId: t.id });
	}
},
```

Note: these handlers do NOT call `doRender()` themselves. They set state, dispatch the callback, and rely on the model notify (triggered by `tasks.swapOrder` in the controller) to drive the re-render. This mirrors how `"move-up"` / `"move-down"` work for sections.

- [ ] **Step 5.4: Add the post-render focus-return lookup**

In `doRender`, find the existing `pendingFocusSectionId` block (around lines 275-281):

```js
if (pendingFocusSectionId) {
	const trigger = rootEl.querySelector(
		`[data-section-id="${CSS.escape(pendingFocusSectionId)}"] .section__menu-btn`,
	);
	trigger?.focus();
	pendingFocusSectionId = null;
}
```

Immediately after that block (before the `pendingMenuFocusSectionId` block), insert:

```js
if (pendingFocusTaskId) {
	const trigger = rootEl.querySelector(
		`[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
	);
	trigger?.focus();
	pendingFocusTaskId = null;
}
```

- [ ] **Step 5.5: Clear the flag in `destroy`**

Find the `destroy` method's flag-reset block (around lines 322-328). After `pendingFocusSectionId = null;`, add:

```js
pendingFocusTaskId = null;
```

- [ ] **Step 5.6: Run the test suite**

Run: `npm test`
Expected: 93 passing.

- [ ] **Step 5.7: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 5.8: Stage and commit**

Files: `src/views/area.js`.

Proposed commit message:

```
feat(area): wire Move up/down for tasks with focus return
```

Stop here. Wait for Malin to commit.

---

## Task 6 — CSS: touch-target fix on `.task-menu__item`

**Files:**
- Modify: `main.css`

- [ ] **Step 6.1: Add `min-block-size` to `.task-menu__item`**

In `main.css`, find `.task-menu__item` (currently around lines 249-263). The current rule is:

```css
.task-menu__item {
	display: block;
	width: 100%;
	background: none;
	border: none;
	color: var(--color-text);
	text-align: left;
	padding: 0.4rem 0.6rem;
	border-radius: var(--radius);
	cursor: pointer;
	font: inherit;
}
```

Add `min-block-size: 44px;` as the last property before the closing brace:

```css
.task-menu__item {
	display: block;
	width: 100%;
	background: none;
	border: none;
	color: var(--color-text);
	text-align: left;
	padding: 0.4rem 0.6rem;
	border-radius: var(--radius);
	cursor: pointer;
	font: inherit;
	min-block-size: 44px;
}
```

- [ ] **Step 6.2: Run Biome (no tests change)**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 6.3: Stage and commit**

Files: `main.css`.

Proposed commit message:

```
style(css): raise .task-menu__item touch target to 44px
```

Stop here. Wait for Malin to commit.

---

## Task 7 — Manual end-to-end verification

**No code changes. Verify the feature works in a real browser.**

- [ ] **Step 7.1: Start the dev server**

Run: `npm run dev`
Expected: Vite ready on `http://localhost:5173` (or 5174 if 5173 is busy).

- [ ] **Step 7.2: Open the app in the browser**

Navigate to the local URL printed by Vite. Use Today view first to land on a known starting state.

- [ ] **Step 7.3: Set up the test data**

In Today view, capture 4 tasks via the capture bar: "A", "B", "C", "D". They all land in the seed area's "Tasks" section (focus-default).

Navigate to `#area/focus-default` (click the area in the sidebar, or change the URL).

You should see one section "Tasks" containing A, B, C, D in capture order.

- [ ] **Step 7.4: Verify Move up/down with all incomplete**

For each scenario, expect the corresponding result and focus state.

| Action | Expected visual | Expected focus |
|--------|-----------------|----------------|
| Click ⋯ on B → Move up | Order becomes A→? wait, B moves above A → [B, A, C, D] | ⋯ button on B (now top row) |
| Click ⋯ on A (which was second, now top) → Move up | Move up is `disabled` | n/a |
| Click ⋯ on C → Move down | [B, A, D, C] | ⋯ button on C |
| Click ⋯ on the new bottom task → Move down | `disabled` | n/a |

Re-order back to A, B, C, D by manually clicking Move up / Move down as needed before the next step.

- [ ] **Step 7.5: Verify the !completed peer filter**

Check off task B (the second one) — it's now `completed` and disappears from the area view. Visible: [A, C, D].

Click ⋯ on C → Move up. Expected: visible order becomes [C, A, D]. (Not "no visible change" — that would mean the filter is missing.)

Open DevTools → Application → IndexedDB → ignite → tasks. Verify the underlying `order` field of A and C swapped. Verify B's `order` is still in between (no longer the swap target).

- [ ] **Step 7.6: Verify a11y on the task ⋯ button**

Open DevTools → Accessibility panel. Click on the ⋯ button of a task. Verify:
- Role: button
- Name: "Task options: <task title>"
- `aria-expanded`: false
- `aria-haspopup`: menu

Click the ⋯ button (open the menu). Verify `aria-expanded` flips to `true`. Close menu. Back to `false`.

- [ ] **Step 7.7: Verify a11y on today.js (regression check for Task 3)**

Navigate back to `#today`. Click ⋯ on a task there. Verify the same `aria-expanded` toggle behaviour.

- [ ] **Step 7.8: Verify touch target on `.task-menu__item`**

Open a task ⋯ menu in area view. In DevTools, inspect a menu item. Computed height should be ≥ 44 px.

- [ ] **Step 7.9: Verify section reorder still works (M3 regression check)**

In the area view, click ⋯ on the "Tasks" section header. The menu opens with Rename, Move up (disabled), Move down (disabled — only one section), Delete (hidden — focus-default is undeletable).

Create a second section ("Backlog") via the area footer. Now both sections have Move up / Move down enabled at the appropriate edges. Verify Move up swaps section order.

- [ ] **Step 7.10: Verify keyboard accessibility**

Close all menus. Tab through the area view. Verify:
- ⋯ button on a task is reachable via Tab.
- Pressing Enter on the ⋯ button opens the menu.
- Tabbing inside the menu visits Move up → Move down → Delete (skipping any `disabled`).
- Pressing Enter on Move up triggers the move and returns focus to the ⋯ button.
- Esc closes the menu.

- [ ] **Step 7.11: Verify mobile narrow-window layout**

Resize the window below 768 px. The sidebar stacks above main. The task ⋯ menu should still open inside the row and not overflow horizontally. Move up / Move down menu items should still measure ≥ 44 px tall.

- [ ] **Step 7.12: Stop the dev server**

In the terminal running `npm run dev`, press Ctrl+C.

- [ ] **Step 7.13: Update memory**

If everything passes: ready to update `MEMORY.md` with the M4 entry (Malin will do this via `/wrap` skill at end of session, or you can append it now per project convention — defer to Malin's flow).

No commit in this task (no code changes). If a visual issue surfaces during the walkthrough, file a follow-up or fix inline and add an extra commit.

---

## Self-Review (checklist run after writing the plan)

**Spec coverage:**

| Spec requirement | Task |
|------------------|------|
| `tasks.swapOrder(idA, idB)` model method | Task 1 |
| Public-API JSDoc update for tasks.js | Task 1.4 |
| 2 new tests on `tasks.swapOrder` | Task 1.1 |
| Controller `moveTask` with `!completed` peer filter | Task 2 |
| `onMoveTaskUp` / `onMoveTaskDown` callbacks | Task 2.2 |
| `renderTaskRow` accepts `isOpen`, emits `aria-expanded` + `aria-label` | Task 3.1 |
| today.js threads `openMenuTaskId` so aria-expanded doesn't lie | Task 3.2 |
| section.js renders Move up / Move down / Delete with disabled edges | Task 4 |
| section.js computes `isFirst`/`isLast` from visible (incomplete) list | Task 4.1 |
| area.js `pendingFocusTaskId` closure flag + post-render lookup | Task 5 |
| area.js `move-task-up` / `move-task-down` actions | Task 5.3 |
| Cleanup of `pendingFocusTaskId` in destroy | Task 5.5 |
| CSS `.task-menu__item { min-block-size: 44px }` | Task 6 |
| Done criteria: tests + biome + browser walk + section regression | Task 7 |
| Known limitations (60s tick race, no kb-open focus, no SR live) | Spec only — no task needed |

All spec items mapped to tasks. ✓

**Placeholder scan:** No TBD/TODO/"similar to above"/etc. Every step shows complete code or exact commands. ✓

**Type consistency check:**
- `swapOrder(idA, idB)` signature consistent across Task 1.3 (model) and Task 2.1 (controller call).
- `renderTaskRow(task, { now, isOpen })` consistent across Task 3.1 (definition), Task 3.2 (today.js caller), Task 4.2 (section.js caller).
- `renderTaskRowWithMenu` signature: today.js's stays `(task, now, openMenuTaskId)`; section.js's becomes `(task, { now, isFirst, isLast, openTaskMenuId })`. Each file is internally consistent — they are independent helpers.
- `pendingFocusTaskId` consistently declared, set, consumed in `doRender`, and cleared in `destroy`.
- Action names `move-task-up` / `move-task-down` consistent in section.js (rendered) and area.js (handled).
- Callback names `onMoveTaskUp` / `onMoveTaskDown` consistent in area.js (called) and controller.js (defined).

All consistent. ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-ignite-m4-task-reorder.md`. Two execution options:

**1. Subagent-Driven (recommended — same as M3)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Memory notes M3 was executed this way successfully.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
