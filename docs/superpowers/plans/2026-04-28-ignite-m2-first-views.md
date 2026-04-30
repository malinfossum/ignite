# Ignite Milestone 2 — First Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the M1 data layer into a usable app — sidebar, capture bar, Today view (NEXT card + groups), task row with check/star/delete + undo toast, hash router scaffold, and a 60s clock tick — all consistent with mobile-first CSS and a clean MVC.

**Architecture:** Pure-function seam in `src/utils/time.js` (TDD-tested). Every view is a factory `createXView(rootEl, deps) → { render(state), destroy() }` that does full innerHTML rerenders. Controller assembles `state = { areas, sections, tasks, settings, now }` from model snapshots, subscribes to all model `notify`s, owns hash routing and the 60s tick, and wires user actions through callback props rather than letting views talk to models directly. CSS handles the collapsed-sidebar swap via a `body.is-sidebar-collapsed` class — no JS layout math.

**Tech Stack:** Vanilla ES modules, Vite 8, Vitest, fake-indexeddb (already configured in M1). No new dependencies.

**Preconditions:**
- Branch `main` at `209187a` (`refactor(css): flip layout to mobile-first`).
- 44/44 unit tests passing under `npm run test:run`.
- Biome clean under `npx biome check .`.
- M1 source files unchanged from their last committed state.

**Out of scope for M2:** Area view + sections, `+ New area`, Settings link, inline rename, date picker, reminder scheduling, Service Worker, PWA polish, 12-hour time setting UI, critical-task glyph.

**Source of truth:** `docs/superpowers/specs/2026-04-28-ignite-m2-first-views-design.md` (and the parent `2026-04-20-ignite-design.md`).

---

## File Structure

**Create:**
- `src/utils/time.js` — pure: `pickNextTask`, `groupTasksForToday`, `formatTimeLabel` + private helpers
- `tests/utils/time.test.js` — ~12-15 tests for the three exports
- `src/utils/dom.js` — `bindActions(rootEl, actionMap) → unbind`
- `src/views/task.js` — `renderTaskRow(task, { now }) → string`
- `src/views/sidebar.js` — `createSidebarView(rootEl, { onToggleCollapse })`
- `src/views/capture.js` — `createCaptureView(rootEl, { onSubmit })`
- `src/views/toast.js` — `createToastView(rootEl) → { show, destroy }`
- `src/views/today.js` — `createTodayView(rootEl, { onToggleComplete, onToggleStar, onDelete })`
- `src/controller.js` — `createController({ models, els, showToast }) → { start, stop }`

**Modify:**
- `src/model/areas.js` — extend `ensureFocus` to also seed the Focus default section; export `FOCUS_DEFAULT_SECTION_ID`
- `src/model/tasks.js` — add `restore(taskData)` mutator
- `src/model/settings.js` — add `sidebarCollapsed: false` to `DEFAULTS`; new wrapper `setSidebarCollapsed(value)`
- `tests/unit/areas.test.js` — add tests for the default-section seed
- `tests/unit/tasks.test.js` — add tests for `restore`
- `tests/unit/settings.test.js` — add tests for `setSidebarCollapsed`
- `src/app.js` — wire the controller; drop the M1 `console.log` and `window.ignite` lines (both already marked "drop in M2")
- `main.css` — add styles for capture, today, sidebar items, task row, `…` menu, toast, empty state, collapsed-sidebar swap

**Untouched:** `index.html`, `base.css`, `src/main.js`, `src/utils/id.js`, `src/model/db.js`, `src/model/sections.js`, `src/model/recurrence.js`, `vite.config.js`, `vitest.config.js`, `tests/setup.js`, all M1 model files except the three above.

One file = one responsibility. Views never import models. Models never touch the DOM. The controller is the only file that wires both.

---

## Ground Rules for the Executor

1. **TDD where the seam is pure.** `time.js` and the three model edits each get failing tests first, then implementation, then green. Views and the controller are verified manually (per Q1 lock) — no JSDOM in M2.
2. **Ask Malin before each commit. Never run `git commit` or `git push` from the shell.** Propose the message; she commits via GitHub Desktop. (See `feedback_git_push_tooling.md`.)
3. **Explain the *why* before code on every new task.** Malin is in learning mode for this project — name the new concept (event delegation, CSS grid swap, AbortController, etc.) the first time it appears. (See `feedback_learning_mode_ignite.md`.)
4. **Do not edit `base.css`.**
5. **Never add `Co-Authored-By` to commit messages.** Malin commits as the sole author.
6. **If a step surprises you, stop and ask.** Do not silently restructure.

---

## Task 1 — Pure-function seam: `src/utils/time.js`

**Why:** The Today view's logic — what counts as overdue, what groups a task lands in, what "in 45 min" should display — must be deterministic and unit-testable so we can iterate on it without staging fake DOM. Per Q1 lock, this is the *only* TDD slice in M2. All functions take `now` as an explicit parameter so tests pass a fixed `Date` and the production controller passes `new Date()`.

**New concepts to call out for Malin:**
- *Pure function* — same inputs → same output, no side effects (no `Date.now()`, no DOM, no I/O). Easy to test, easy to reason about.
- *Test fixtures* — fixed `Date` objects (`new Date("2026-04-28T14:00:00")`) used as `now` so the same test gives the same result every run.

**Files:**
- Create: `src/utils/time.js`
- Create: `tests/utils/time.test.js`

- [ ] **Step 1: Write failing tests for `formatTimeLabel`**

Create `tests/utils/time.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
	formatTimeLabel,
	groupTasksForToday,
	pickNextTask,
} from "../../src/utils/time.js";

const NOW = new Date("2026-04-28T14:00:00");
// Helper: build a task with sensible defaults.
const task = (overrides) => ({
	id: "t1",
	sectionId: "focus-default",
	title: "Test task",
	notes: "",
	completed: false,
	starred: false,
	critical: false,
	dueAt: null,
	recurrence: null,
	leadTime: 0,
	scheduledTags: [],
	createdAt: "2026-04-28T08:00:00.000Z",
	order: 0,
	...overrides,
});

describe("formatTimeLabel", () => {
	it("returns 'now' for dueAt within the next minute", () => {
		const dueAt = new Date(NOW.getTime() + 30_000).toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("now");
	});

	it("returns 'in N min' for dueAt within the next hour", () => {
		const dueAt = new Date(NOW.getTime() + 45 * 60_000).toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("in 45 min");
	});

	it("returns the time of day for dueAt later today (24h)", () => {
		const dueAt = new Date("2026-04-28T18:30:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("18:30");
	});

	it("returns 'was HH:MM' for dueAt earlier today", () => {
		const dueAt = new Date("2026-04-28T09:00:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("was 09:00");
	});

	it("returns 'Tomorrow HH:MM' for dueAt tomorrow", () => {
		const dueAt = new Date("2026-04-29T09:00:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("Tomorrow 09:00");
	});

	it("returns 'Ddd HH:MM' for dueAt within the next 7 days", () => {
		const dueAt = new Date("2026-05-01T09:00:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("Fri 09:00");
	});

	it("returns 'Mon DD · HH:MM' for dueAt beyond 7 days", () => {
		const dueAt = new Date("2026-05-15T09:00:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("May 15 · 09:00");
	});

	it("respects 12-hour format when requested", () => {
		const dueAt = new Date("2026-04-28T18:30:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW, "12h")).toBe("6:30 PM");
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/utils/time.test.js`
Expected: FAIL — `Failed to resolve import "../../src/utils/time.js"`.

- [ ] **Step 3: Write failing tests for `groupTasksForToday`**

Append to `tests/utils/time.test.js`:

```js
describe("groupTasksForToday", () => {
	it("partitions tasks into overdue, today, and starred", () => {
		const tasks = [
			task({ id: "a", dueAt: "2026-04-27T09:00:00.000Z" }),     // overdue (yesterday)
			task({ id: "b", dueAt: "2026-04-28T18:00:00.000Z" }),     // today
			task({ id: "c", starred: true, dueAt: null }),            // starred undated
			task({ id: "d", dueAt: "2026-05-10T09:00:00.000Z" }),     // future, ignored
		];
		const result = groupTasksForToday(tasks, NOW);
		expect(result.overdue.map((t) => t.id)).toEqual(["a"]);
		expect(result.today.map((t) => t.id)).toEqual(["b"]);
		expect(result.starred.map((t) => t.id)).toEqual(["c"]);
	});

	it("excludes completed tasks from every group", () => {
		const tasks = [
			task({ id: "a", completed: true, dueAt: "2026-04-27T09:00:00.000Z" }),
			task({ id: "b", completed: true, dueAt: "2026-04-28T18:00:00.000Z" }),
			task({ id: "c", completed: true, starred: true }),
		];
		const result = groupTasksForToday(tasks, NOW);
		expect(result.overdue).toEqual([]);
		expect(result.today).toEqual([]);
		expect(result.starred).toEqual([]);
	});

	it("keeps same-day past-due tasks in Today (with 'was' label), not Overdue", () => {
		const tasks = [task({ id: "a", dueAt: "2026-04-28T09:00:00.000Z" })];
		const result = groupTasksForToday(tasks, NOW);
		expect(result.overdue).toEqual([]);
		expect(result.today.map((t) => t.id)).toEqual(["a"]);
	});

	it("sorts today by dueAt ascending and starred by order ascending", () => {
		const tasks = [
			task({ id: "b", dueAt: "2026-04-28T18:00:00.000Z" }),
			task({ id: "a", dueAt: "2026-04-28T16:00:00.000Z" }),
			task({ id: "z", starred: true, order: 2 }),
			task({ id: "y", starred: true, order: 0 }),
		];
		const result = groupTasksForToday(tasks, NOW);
		expect(result.today.map((t) => t.id)).toEqual(["a", "b"]);
		expect(result.starred.map((t) => t.id)).toEqual(["y", "z"]);
	});
});
```

- [ ] **Step 4: Write failing tests for `pickNextTask`**

Append to `tests/utils/time.test.js`:

```js
describe("pickNextTask", () => {
	it("picks the earliest upcoming time-dated task", () => {
		const tasks = [
			task({ id: "a", dueAt: "2026-04-28T18:00:00.000Z" }),
			task({ id: "b", dueAt: "2026-04-28T16:00:00.000Z" }),
		];
		expect(pickNextTask(tasks, NOW)?.id).toBe("b");
	});

	it("falls back to oldest overdue when nothing is upcoming", () => {
		const tasks = [
			task({ id: "a", dueAt: "2026-04-26T09:00:00.000Z" }),
			task({ id: "b", dueAt: "2026-04-27T09:00:00.000Z" }),
		];
		expect(pickNextTask(tasks, NOW)?.id).toBe("a");
	});

	it("falls back to first starred undated when nothing is dated", () => {
		const tasks = [
			task({ id: "a", starred: true, order: 2 }),
			task({ id: "b", starred: true, order: 0 }),
		];
		expect(pickNextTask(tasks, NOW)?.id).toBe("b");
	});

	it("returns null on empty input", () => {
		expect(pickNextTask([], NOW)).toBeNull();
	});

	it("ignores completed tasks", () => {
		const tasks = [
			task({ id: "a", completed: true, dueAt: "2026-04-28T18:00:00.000Z" }),
			task({ id: "b", starred: true, order: 0 }),
		];
		expect(pickNextTask(tasks, NOW)?.id).toBe("b");
	});
});
```

- [ ] **Step 5: Run to confirm 17 failures**

Run: `npm run test:run -- tests/utils/time.test.js`
Expected: All tests fail with the same import error (file doesn't exist yet).

- [ ] **Step 6: Implement `src/utils/time.js`**

Create `src/utils/time.js`:

```js
// Pure helpers for time-based view logic. No DOM, no globals — `now` always
// arrives as a parameter so tests are deterministic.

const ONE_MIN = 60_000;
const ONE_DAY_MS = 24 * 60 * 60_000;
const SHORT_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTH = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function startOfDay(date) {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

function isSameDay(a, b) {
	return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function pad2(n) {
	return n.toString().padStart(2, "0");
}

function formatHM(date, format) {
	if (format === "12h") {
		const h24 = date.getHours();
		const period = h24 >= 12 ? "PM" : "AM";
		const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
		return `${h12}:${pad2(date.getMinutes())} ${period}`;
	}
	return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatTimeLabel(dueAtIso, now, format = "24h") {
	const due = new Date(dueAtIso);
	const diffMs = due.getTime() - now.getTime();

	if (diffMs >= 0 && diffMs < ONE_MIN) return "now";
	if (diffMs > 0 && diffMs < 60 * ONE_MIN) {
		return `in ${Math.round(diffMs / ONE_MIN)} min`;
	}

	if (isSameDay(due, now)) {
		const hm = formatHM(due, format);
		return diffMs < 0 ? `was ${hm}` : hm;
	}

	const tomorrow = new Date(startOfDay(now).getTime() + ONE_DAY_MS);
	if (isSameDay(due, tomorrow)) return `Tomorrow ${formatHM(due, format)}`;

	const dayDelta = Math.floor(
		(startOfDay(due).getTime() - startOfDay(now).getTime()) / ONE_DAY_MS,
	);
	if (dayDelta > 0 && dayDelta < 7) {
		return `${SHORT_WEEKDAY[due.getDay()]} ${formatHM(due, format)}`;
	}

	return `${SHORT_MONTH[due.getMonth()]} ${due.getDate()} · ${formatHM(due, format)}`;
}

export function groupTasksForToday(tasks, now) {
	const startToday = startOfDay(now).getTime();
	const startTomorrow = startToday + ONE_DAY_MS;

	const overdue = [];
	const today = [];
	const starred = [];

	for (const t of tasks) {
		if (t.completed) continue;
		if (t.dueAt) {
			const due = new Date(t.dueAt).getTime();
			if (due < startToday) overdue.push(t);
			else if (due < startTomorrow) today.push(t);
		} else if (t.starred) {
			starred.push(t);
		}
	}

	overdue.sort(byDueAtAsc);
	today.sort(byDueAtAsc);
	starred.sort((a, b) => a.order - b.order);

	return { overdue, today, starred };
}

export function pickNextTask(tasks, now) {
	const active = tasks.filter((t) => !t.completed);
	const dated = active
		.filter((t) => t.dueAt)
		.sort(byDueAtAsc);
	const upcoming = dated.find((t) => new Date(t.dueAt).getTime() > now.getTime());
	if (upcoming) return upcoming;

	const overdue = dated.find((t) => new Date(t.dueAt).getTime() <= now.getTime());
	if (overdue) return overdue;

	const starred = active
		.filter((t) => t.starred && !t.dueAt)
		.sort((a, b) => a.order - b.order);
	return starred[0] ?? null;
}

function byDueAtAsc(a, b) {
	return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}
```

- [ ] **Step 7: Run to confirm green**

Run: `npm run test:run -- tests/utils/time.test.js`
Expected: 17 passed.

- [ ] **Step 8: Run the full suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: 61 tests passed (44 from M1 + 17 new), Biome clean.

- [ ] **Step 9: Propose commit to Malin**

Proposed message:

```
feat(utils): add time.js — pickNextTask, groupTasksForToday, formatTimeLabel
```

Files staged: `src/utils/time.js`, `tests/utils/time.test.js`. Wait for her commit via GitHub Desktop before moving on.

---

## Task 2 — Focus default-section seed

**Why:** `tasks.create()` requires a `sectionId`. M1 seeds the Focus area but no section inside it, so the capture bar would have nowhere to put a new task. M2 closes this by extending the existing idempotent seed.

**Files:**
- Modify: `src/model/areas.js`
- Modify: `tests/unit/areas.test.js`

- [ ] **Step 1: Add failing tests to `tests/unit/areas.test.js`**

The existing test file uses a `freshModel()` helper plus `afterEach` cleanup
of `openHandles`. Your new tests must use the same pattern so DB handles
don't leak.

First, update the import line at the top of the file from:

```js
import { createAreaModel } from "../../src/model/areas.js";
```

to:

```js
import {
	createAreaModel,
	FOCUS_DEFAULT_SECTION_ID,
} from "../../src/model/areas.js";
```

Then, at the bottom of the file (outside the existing `describe`), add:

```js
describe("Focus default section seed", () => {
	it("seeds the default Focus section with a stable id on first construction", async () => {
		const { db } = await freshModel();
		const section = await db.get("sections", FOCUS_DEFAULT_SECTION_ID);
		expect(section).toBeDefined();
		expect(section.areaId).toBe("focus");
	});

	it("does not duplicate the default section on re-construction", async () => {
		const { db } = await freshModel();
		await createAreaModel(db);
		const all = await db.getAll("sections");
		const focusSections = all.filter((s) => s.areaId === "focus");
		expect(focusSections).toHaveLength(1);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/areas.test.js`
Expected: FAIL — `FOCUS_DEFAULT_SECTION_ID` is `undefined` (not yet exported).

- [ ] **Step 3: Update `src/model/areas.js`**

Replace the file's top-of-module section so it reads:

```js
import { uuid } from "../utils/id.js";

const FOCUS_ID = "focus";
export const FOCUS_DEFAULT_SECTION_ID = "focus-default";

const FOCUS_DEFAULTS = {
	id: FOCUS_ID,
	name: "Focus",
	icon: "🔥",
	critical: false,
	order: 0,
};

const FOCUS_DEFAULT_SECTION = {
	id: FOCUS_DEFAULT_SECTION_ID,
	areaId: FOCUS_ID,
	name: "",
	collapsed: false,
	order: 0,
};
```

Then change `ensureFocus`:

```js
async function ensureFocus(db) {
	const existing = await db.get("areas", FOCUS_ID);
	if (!existing) await db.put("areas", { ...FOCUS_DEFAULTS });
	const existingSection = await db.get("sections", FOCUS_DEFAULT_SECTION_ID);
	if (!existingSection) await db.put("sections", { ...FOCUS_DEFAULT_SECTION });
}
```

- [ ] **Step 4: Run to confirm green**

Run: `npm run test:run -- tests/unit/areas.test.js`
Expected: existing area tests still pass + 2 new tests pass.

- [ ] **Step 5: Run the full suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: all green.

- [ ] **Step 6: Propose commit**

Proposed message:

```
feat(model): seed Focus default section on first boot
```

Files staged: `src/model/areas.js`, `tests/unit/areas.test.js`. Wait for Malin to commit.

---

## Task 3 — `tasks.restore(taskData)` mutator

**Why:** Delete-with-undo needs to re-insert the exact task that was removed, with its original `id`. `tasks.create()` always generates a fresh `uuid()`, so it can't be reused — we add a sibling mutator that does a direct `db.put` and notifies subscribers.

**Files:**
- Modify: `src/model/tasks.js`
- Modify: `tests/unit/tasks.test.js`

- [ ] **Step 1: Add failing tests to `tests/unit/tasks.test.js`**

The existing test file uses the same `freshModel()` + `afterEach` pattern
as `areas.test.js`. The `tasks` model doesn't enforce that `sectionId`
references a real section (existing tests use `"s1"`), so we don't need
`createAreaModel` here — any string works.

At the bottom of the file (outside any existing `describe`), add:

```js
describe("createTaskModel — restore", () => {
	it("re-inserts a deleted task with the same id and fields", async () => {
		const { model } = await freshModel();
		const original = await model.create({
			sectionId: "s1",
			title: "Buy bread",
			starred: true,
		});
		await model.remove(original.id);
		await model.restore(original);
		const list = await model.list();
		expect(list).toHaveLength(1);
		expect(list[0].id).toBe(original.id);
		expect(list[0].title).toBe("Buy bread");
		expect(list[0].starred).toBe(true);
	});

	it("notifies subscribers", async () => {
		const { model } = await freshModel();
		const original = await model.create({ sectionId: "s1", title: "x" });
		await model.remove(original.id);

		const calls = [];
		model.subscribe(() => calls.push("notified"));
		await model.restore(original);
		expect(calls).toEqual(["notified"]);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/tasks.test.js`
Expected: FAIL — `tasks.restore is not a function`.

- [ ] **Step 3: Add the `restore` mutator to `src/model/tasks.js`**

Inside the returned object from `createTaskModel`, after `remove`, add:

```js
async restore(taskData) {
    await db.put("tasks", toStorage(taskData));
    notify();
    return taskData;
},
```

The `toStorage` helper at the bottom of the file already converts boolean fields back to 0/1, so passing a fully-shaped task object Just Works.

- [ ] **Step 4: Run to confirm green**

Run: `npm run test:run -- tests/unit/tasks.test.js`
Expected: existing tests + 2 new pass.

- [ ] **Step 5: Run the full suite + Biome**

Run: `npm run test:run && npx biome check .`

- [ ] **Step 6: Propose commit**

Proposed message:

```
feat(model): add tasks.restore(taskData) for delete undo
```

Files staged: `src/model/tasks.js`, `tests/unit/tasks.test.js`.

---

## Task 4 — `settings.sidebarCollapsed` field + setter

**Why:** The collapsible-sidebar UX needs a persisted boolean so the state survives reloads. We add the field to `DEFAULTS` for fresh installs and use a `?? false` read-tolerance so records seeded under M1 keep working without a migration. The thin `setSidebarCollapsed(value)` wrapper makes intent clearer at call sites than the generic `update({ sidebarCollapsed: ... })`.

**Files:**
- Modify: `src/model/settings.js`
- Modify: `tests/unit/settings.test.js`

- [ ] **Step 1: Add failing tests to `tests/unit/settings.test.js`**

The existing test file uses the same `freshModel()` + `afterEach` pattern.
At the bottom of the file (outside any existing `describe`), add:

```js
describe("createSettingsModel — sidebarCollapsed", () => {
	it("defaults to false on a fresh install", async () => {
		const { model } = await freshModel();
		const current = await model.get();
		expect(current.sidebarCollapsed).toBe(false);
	});

	it("persists via setSidebarCollapsed and notifies", async () => {
		const { model } = await freshModel();

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.setSidebarCollapsed(true);
		expect(calls).toEqual(["notified"]);

		const after = await model.get();
		expect(after.sidebarCollapsed).toBe(true);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/settings.test.js`
Expected: FAIL — `sidebarCollapsed` is `undefined`, `setSidebarCollapsed is not a function`.

- [ ] **Step 3: Update `src/model/settings.js`**

Add `sidebarCollapsed: false` to `DEFAULTS`:

```js
const DEFAULTS = {
	id: SETTINGS_ID,
	quietStart: 23,
	quietEnd: 7,
	lastKnownPermission: "default",
	lastView: "#today",
	sidebarCollapsed: false,
};
```

Add a `setSidebarCollapsed` method to the returned object, after `update`:

```js
async setSidebarCollapsed(value) {
    return this.update({ sidebarCollapsed: !!value });
},
```

- [ ] **Step 4: Run to confirm green**

Run: `npm run test:run -- tests/unit/settings.test.js`

- [ ] **Step 5: Run the full suite + Biome**

Run: `npm run test:run && npx biome check .`

- [ ] **Step 6: Propose commit**

Proposed message:

```
feat(model): add settings.sidebarCollapsed + setter
```

Files staged: `src/model/settings.js`, `tests/unit/settings.test.js`.

---

## Task 5 — `bindActions` helper (`src/utils/dom.js`)

**Why:** Every interactive element in M2 carries a `data-action="..."` attribute (e.g. `data-action="toggle-complete"`). One delegated click handler on the view's root element dispatches those into a callback map. This avoids re-attaching listeners after every full-innerHTML rerender — critical because views in M2 *do* rerender via full innerHTML.

**New concept to call out for Malin:** *Event delegation.* Instead of putting a listener on every button, you put one listener on a parent and ask the event "what got clicked?". Saves work and survives re-renders. `e.target.closest("[data-action]")` walks up the DOM from the clicked element until it finds an action-tagged ancestor.

This file is verified manually (no JSDOM) — Malin will confirm it works once views start using it.

**Files:**
- Create: `src/utils/dom.js`

- [ ] **Step 1: Create `src/utils/dom.js`**

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
```

- [ ] **Step 2: Biome check**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 3: Run the full suite (sanity)**

Run: `npm run test:run`
Expected: all green (this file has no tests, but we want to confirm nothing else broke).

- [ ] **Step 4: Propose commit**

Proposed message:

```
feat(utils): add bindActions click delegation helper
```

Files staged: `src/utils/dom.js`.

---

## Task 6 — Shared task row template (`src/views/task.js`)

**Why:** Task rows appear in the NEXT card and three Today groups today, and in Area view in M3. One template function keeps the markup consistent. It returns a string (not a DOM node) because the parent view does `innerHTML = ...` from a template assembly. We escape any user-typed text — task titles can contain `<script>`, and innerHTML would execute it. New concept: *XSS via innerHTML.*

This file is verified manually.

**Files:**
- Create: `src/views/task.js`

- [ ] **Step 1: Create `src/views/task.js`**

```js
// Renders one task row. Returned as a string so the parent template can
// concatenate. Always escape user-provided fields before interpolating —
// titles can contain `<` and would otherwise execute as HTML.

import { formatTimeLabel } from "../utils/time.js";

export function renderTaskRow(task, { now } = { now: new Date() }) {
	const checked = task.completed ? "checked" : "";
	const starredAttr = task.starred ? 'aria-pressed="true"' : 'aria-pressed="false"';
	const starGlyph = task.starred ? "★" : "☆";
	const recurring = task.recurrence ? '<span class="task__recurring" aria-hidden="true">⟲</span>' : "";
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
			<button class="task__menu-btn" type="button" data-action="open-menu" aria-haspopup="menu">⋯</button>
		</li>
	`;
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
```

- [ ] **Step 2: Biome check**

Run: `npx biome check .`

- [ ] **Step 3: Propose commit**

Proposed message:

```
feat(views): add shared renderTaskRow template
```

Files staged: `src/views/task.js`.

---

## Task 7 — Sidebar view (`src/views/sidebar.js`)

**Why:** The sidebar is always-on; same template renders in both expanded and collapsed states (CSS does the visual swap via `body.is-sidebar-collapsed`). M2 contents per Q5 lock: only the toggle button + an areas list with active-task counts. No `+ New area`, no Settings link.

The active-task count joins through sections (tasks reference `sectionId`, not `areaId`).

**Files:**
- Create: `src/views/sidebar.js`

- [ ] **Step 1: Create `src/views/sidebar.js`**

```js
// createSidebarView(rootEl, { onToggleCollapse }) → { render(state), destroy() }
//
// Renders a toggle button + the areas list with active-task counts.
// CSS owns the expanded/collapsed visual; the template is the same in both.

import { bindActions } from "../utils/dom.js";

export function createSidebarView(rootEl, { onToggleCollapse }) {
	const unbind = bindActions(rootEl, {
		"toggle-sidebar": () => onToggleCollapse(),
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
	const items = state.areas
		.slice()
		.sort((a, b) => a.order - b.order)
		.map((area) => renderAreaItem(area, state))
		.join("");

	return `
		<button class="sidebar__toggle" type="button" data-action="toggle-sidebar" aria-label="Toggle sidebar">
			<span class="sidebar__toggle-glyph" aria-hidden="true">≡</span>
		</button>
		<ul class="sidebar__areas">${items}</ul>
	`;
}

function renderAreaItem(area, state) {
	const sectionIds = new Set(
		state.sections.filter((s) => s.areaId === area.id).map((s) => s.id),
	);
	const count = state.tasks.filter(
		(t) => sectionIds.has(t.sectionId) && !t.completed,
	).length;

	return `
		<li class="sidebar__area" data-area-id="${escapeHtml(area.id)}">
			<span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
			<span class="sidebar__name">${escapeHtml(area.name)}</span>
			<span class="sidebar__count">${count}</span>
		</li>
	`;
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
```

- [ ] **Step 2: Biome check**

Run: `npx biome check .`

- [ ] **Step 3: Propose commit**

Proposed message:

```
feat(views): add sidebar view (areas list + collapse toggle)
```

Files staged: `src/views/sidebar.js`.

---

## Task 8 — Capture bar view (`src/views/capture.js`)

**Why:** Title-only input; Enter creates an undated, starred task in Focus's default section (Q3 lock). We use a `<form>` so Enter handling is native (`submit` event). The capture view never re-renders itself — it mounts once and stays put — so typing focus is preserved across model notifies. (The Today view re-renders only `#today-root`, never `#capture-root`.)

**Files:**
- Create: `src/views/capture.js`

- [ ] **Step 1: Create `src/views/capture.js`**

```js
// createCaptureView(rootEl, { onSubmit }) → { destroy() }
//
// onSubmit(title: string) is called for non-empty trimmed input.
// Mounts once, never re-renders — preserves the input cursor across
// model notifies and route changes.

export function createCaptureView(rootEl, { onSubmit }) {
	rootEl.innerHTML = `
		<form class="capture__form" autocomplete="off">
			<input
				class="capture__input"
				type="text"
				name="title"
				placeholder="What's next?"
				aria-label="Capture a new task"
			/>
		</form>
	`;

	const form = rootEl.querySelector(".capture__form");
	const input = rootEl.querySelector(".capture__input");

	const handler = (event) => {
		event.preventDefault();
		const value = input.value.trim();
		if (!value) return;
		onSubmit(value);
		input.value = "";
		input.focus();
	};
	form.addEventListener("submit", handler);

	return {
		destroy() {
			form.removeEventListener("submit", handler);
			rootEl.innerHTML = "";
		},
	};
}
```

- [ ] **Step 2: Biome check**

Run: `npx biome check .`

- [ ] **Step 3: Propose commit**

Proposed message:

```
feat(views): add capture bar view
```

Files staged: `src/views/capture.js`.

---

## Task 9 — Toast view (`src/views/toast.js`)

**Why:** Delete-with-undo shows a 5-second toast. Single toast at a time — a new `show()` replaces any existing one (Q4 lock: no queueing in M2). Toast owns its own timer, undo/dismiss callbacks, and DOM. Controller will pass `toast.show` as the `onDelete` callback's tail action.

**Files:**
- Create: `src/views/toast.js`

- [ ] **Step 1: Create `src/views/toast.js`**

```js
// createToastView(rootEl) → { show({ message, onUndo, onDismiss }), destroy() }
//
// One toast at a time. show() replaces any existing toast (and its timer).
// The toast auto-dismisses after 5 seconds, calling onDismiss if provided.

const DURATION_MS = 5_000;

export function createToastView(rootEl) {
	let timer = null;
	let activeUndoHandler = null;

	function clearActive() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		activeUndoHandler = null;
		rootEl.innerHTML = "";
	}

	function show({ message, onUndo, onDismiss } = {}) {
		clearActive();

		rootEl.innerHTML = `
			<div class="toast" role="status" aria-live="polite">
				<span class="toast__message">${escapeHtml(message ?? "")}</span>
				<button class="toast__undo" type="button">Undo</button>
			</div>
		`;
		const undoBtn = rootEl.querySelector(".toast__undo");

		activeUndoHandler = () => {
			if (timer) clearTimeout(timer);
			timer = null;
			activeUndoHandler = null;
			rootEl.innerHTML = "";
			if (onUndo) onUndo();
		};
		undoBtn.addEventListener("click", activeUndoHandler, { once: true });

		timer = setTimeout(() => {
			timer = null;
			activeUndoHandler = null;
			rootEl.innerHTML = "";
			if (onDismiss) onDismiss();
		}, DURATION_MS);
	}

	return {
		show,
		destroy() {
			clearActive();
		},
	};
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
```

- [ ] **Step 2: Biome check**

Run: `npx biome check .`

- [ ] **Step 3: Propose commit**

Proposed message:

```
feat(views): add toast view (single-slot, auto-dismiss)
```

Files staged: `src/views/toast.js`.

---

## Task 10 — Today view (`src/views/today.js`)

**Why:** The big one. NEXT card + three groups (Overdue / Today / Starred). Re-renders only `#today-root`. Owns the inline `…` menu for delete (one menu surface in M2 — closure-tracked `openMenuTaskId`). Captures full task snapshot before delete so the controller's undo path has it.

**Files:**
- Create: `src/views/today.js`

- [ ] **Step 1: Create `src/views/today.js`**

```js
// createTodayView(rootEl, { onToggleComplete, onToggleStar, onDelete })
//   → { render(state), destroy() }
//
// state expected: { tasks, sections, areas, settings, now }
// onDelete receives the full task object so the controller can restore it.

import {
	groupTasksForToday,
	pickNextTask,
} from "../utils/time.js";
import { renderTaskRow } from "./task.js";
import { bindActions } from "../utils/dom.js";

export function createTodayView(rootEl, callbacks) {
	let lastState = null;
	let openMenuTaskId = null;

	const closeMenu = () => {
		openMenuTaskId = null;
		if (lastState) doRender();
	};

	const docClickHandler = (event) => {
		if (!openMenuTaskId) return;
		if (rootEl.contains(event.target)) return;
		closeMenu();
	};
	const docKeyHandler = (event) => {
		if (event.key === "Escape") closeMenu();
	};
	document.addEventListener("click", docClickHandler);
	document.addEventListener("keydown", docKeyHandler);

	const taskFromEvent = (actionEl) => {
		const li = actionEl.closest("[data-id]");
		if (!li || !lastState) return null;
		return lastState.tasks.find((t) => t.id === li.dataset.id) ?? null;
	};

	const unbind = bindActions(rootEl, {
		"toggle-complete": (event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (t) callbacks.onToggleComplete(t.id);
		},
		"toggle-star": (event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (t) callbacks.onToggleStar(t.id, t.starred);
		},
		"open-menu": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			openMenuTaskId = openMenuTaskId === t.id ? null : t.id;
			doRender();
		},
		"delete-task": (event, actionEl) => {
			const t = taskFromEvent(actionEl);
			openMenuTaskId = null;
			if (t) callbacks.onDelete(t);
		},
	});

	function doRender() {
		if (!lastState) return;
		rootEl.innerHTML = template(lastState, openMenuTaskId);
	}

	return {
		render(state) {
			lastState = state;
			doRender();
		},
		destroy() {
			unbind();
			document.removeEventListener("click", docClickHandler);
			document.removeEventListener("keydown", docKeyHandler);
			rootEl.innerHTML = "";
			lastState = null;
			openMenuTaskId = null;
		},
	};
}

function template(state, openMenuTaskId) {
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

	return `
		${next ? renderNextCard(next, state.now, openMenuTaskId) : ""}
		${renderGroup("Overdue", "group--overdue", overdue, state.now, openMenuTaskId, true)}
		${renderGroup("Today", "group--today", today, state.now, openMenuTaskId, true)}
		${renderGroup("Starred", "group--starred", starred, state.now, openMenuTaskId, false)}
	`;
}

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

function renderGroup(heading, modifierClass, tasks, now, openMenuTaskId, showCount) {
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

function renderTaskRowWithMenu(task, now, openMenuTaskId) {
	const row = renderTaskRow(task, { now });
	if (openMenuTaskId !== task.id) return row;
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

- [ ] **Step 2: Biome check**

Run: `npx biome check .`

- [ ] **Step 3: Propose commit**

Proposed message:

```
feat(views): add Today view (NEXT card + groups + delete menu)
```

Files staged: `src/views/today.js`.

---

## Task 11 — Controller (`src/controller.js`)

**Why:** Wires everything. Owns hash routing, mount sequence, model subscriptions, the 60s tick, and the orchestration of delete + undo. Views never see models — they receive callbacks. The controller is the only file that imports both views and models.

**New concept to call out for Malin:** *Hash routing.* A "hash" is everything after `#` in a URL. `#today` and `#area/abc` are two different hashes. The browser fires a `hashchange` event when it changes. We use this for navigation without a server — pure client-side routing.

**Files:**
- Create: `src/controller.js`

- [ ] **Step 1: Create `src/controller.js`**

```js
// createController({ models, els }) → { start(), stop() }
//
// Wires sidebar (always-on), capture (always-on), main view (route-driven),
// toast (orchestrated by controller for delete-undo). Subscribes to all
// model notifies; rebuilds state and re-renders sidebar + currentMainView.
// Owns the 60s clock tick that calls currentMainView.render(state) only.

import { FOCUS_DEFAULT_SECTION_ID } from "./model/areas.js";
import { createCaptureView } from "./views/capture.js";
import { createSidebarView } from "./views/sidebar.js";
import { createTodayView } from "./views/today.js";
import { createToastView } from "./views/toast.js";

const TICK_MS = 60_000;

export function parseHash(hash) {
	const raw = (hash || "").replace(/^#/, "");
	if (raw === "" || raw === "today") return { name: "today" };
	const areaMatch = raw.match(/^area\/(.+)$/);
	if (areaMatch) return { name: "area", id: areaMatch[1] };
	return { name: "today" };
}

export function createController({ models, els }) {
	const { areas, sections, tasks, settings } = models;
	const { sidebarRoot, captureRoot, todayRoot, toastRoot } = els;

	let sidebar = null;
	let capture = null;
	let toast = null;
	let currentMainView = null;
	let tickHandle = null;
	let unsubs = [];

	async function buildState() {
		const [areaList, sectionList, taskList, settingsRecord] = await Promise.all([
			areas.list(),
			sections.list(),
			tasks.list(),
			settings.get(),
		]);
		return {
			areas: areaList,
			sections: sectionList,
			tasks: taskList,
			settings: settingsRecord,
			now: new Date(),
		};
	}

	async function applyState() {
		const state = await buildState();
		document.body.classList.toggle(
			"is-sidebar-collapsed",
			!!(state.settings.sidebarCollapsed ?? false),
		);
		sidebar?.render(state);
		currentMainView?.render(state);
	}

	function mountMainView(name) {
		// M2: only "today" is wired. Everything else falls back to today.
		currentMainView?.destroy();
		currentMainView = null;

		// All recognized routes use the same #today-root container in M2.
		const rootMap = { today: todayRoot };
		const root = rootMap[name] ?? todayRoot;

		currentMainView = createTodayView(root, {
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
	}

	function onHashChange() {
		const route = parseHash(window.location.hash);
		mountMainView(route.name);
		applyState();
	}

	function start() {
		// Mount toast (above main).
		toast = createToastView(toastRoot);

		// Mount sidebar (always-on).
		sidebar = createSidebarView(sidebarRoot, {
			onToggleCollapse: async () => {
				const current = await settings.get();
				await settings.setSidebarCollapsed(!(current.sidebarCollapsed ?? false));
			},
		});

		// Mount capture (always-on inside <main>).
		capture = createCaptureView(captureRoot, {
			onSubmit: (title) =>
				tasks.create({
					sectionId: FOCUS_DEFAULT_SECTION_ID,
					title,
					starred: true,
				}),
		});

		// Subscribe to model notifies.
		unsubs.push(
			areas.subscribe(applyState),
			sections.subscribe(applyState),
			tasks.subscribe(applyState),
			settings.subscribe(applyState),
		);

		// Initial route + render.
		const route = parseHash(window.location.hash);
		mountMainView(route.name);
		applyState();

		// Hash router.
		window.addEventListener("hashchange", onHashChange);

		// 60s tick — re-renders only the current main view.
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

- [ ] **Step 2: Biome check**

Run: `npx biome check .`

- [ ] **Step 3: Propose commit**

Proposed message:

```
feat(controller): wire sidebar, capture, today, toast + hash routing + tick
```

Files staged: `src/controller.js`.

---

## Task 12 — Boot the controller from `src/app.js`

**Why:** `app.js` constructs models in M1. M2 adds: build the DOM scaffolding inside `<main>` and `<body>`, construct the controller, call `start()`. Drops the M1 sanity log and `window.ignite` DevTools handle (both already marked "drop in M2" in the source).

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Replace `src/app.js`**

```js
// app.js — application wiring.
// M2: builds DOM scaffolding, constructs models, hands off to the controller.

import { createController } from "./controller.js";
import { createAreaModel } from "./model/areas.js";
import { openDB } from "./model/db.js";
import { createSectionModel } from "./model/sections.js";
import { createSettingsModel } from "./model/settings.js";
import { createTaskModel } from "./model/tasks.js";

async function boot() {
	const db = await openDB();
	const areas = await createAreaModel(db);
	const sections = await createSectionModel(db);
	const tasks = await createTaskModel(db);
	const settings = await createSettingsModel(db);

	const sidebarRoot = document.getElementById("sidebar");
	const mainEl = document.getElementById("main");

	mainEl.innerHTML = `
		<section class="capture" id="capture-root"></section>
		<section class="today" id="today-root"></section>
	`;

	const toastRoot = document.createElement("div");
	toastRoot.id = "toast-root";
	document.body.appendChild(toastRoot);

	const controller = createController({
		models: { areas, sections, tasks, settings },
		els: {
			sidebarRoot,
			captureRoot: document.getElementById("capture-root"),
			todayRoot: document.getElementById("today-root"),
			toastRoot,
		},
	});
	controller.start();
}

boot().catch((err) => {
	console.error("Ignite failed to boot:", err);
});
```

- [ ] **Step 2: Run dev server, smoke-test in browser**

Run: `npm run dev`
Open the printed localhost URL in Brave/Chrome. Expected:
- Sidebar shows "🔥 Focus 0" with a `≡` toggle button (toggle hidden on mobile <768px, visible on tablet+).
- `<main>` shows the empty state ("You're clear. Nice.") since there are no tasks.
- DevTools console: no errors except possibly a favicon 404 (cosmetic, accepted).

If anything fails, stop dev server, fix, re-test.

- [ ] **Step 3: Run the full suite + Biome**

Run: `npm run test:run && npx biome check .`
Expected: all green. (No new tests; just a sanity check that nothing else broke.)

- [ ] **Step 4: Propose commit**

Proposed message:

```
feat(app): boot the M2 controller; drop M1 DevTools handles
```

Files staged: `src/app.js`.

---

## Task 13 — CSS pass (`main.css`)

**Why:** Now the views exist and are wired, but the page looks raw. This task adds styling for everything M2 introduces, plus the collapsed-sidebar grid swap.

We extend `main.css` (do not touch `base.css`). Mobile-first per Malin's project standards: baseline styles target the smallest screen; `@media (min-width: 768px)` layers on tablet+ adjustments.

**Files:**
- Modify: `main.css`

- [ ] **Step 1: Replace `main.css` contents**

```css
/* main.css — Ignite app styles.
   App-specific layout and components live here.
   Shared foundation lives in base.css. */

:root {
	--color-bg: #0f0f10;
	--color-bg-elevated: #18181b;
	--color-text: #e8e8ea;
	--color-text-muted: #9a9aa3;
	--color-border: #1f1f22;
	--color-accent: #f56b0a;
	--color-overdue: #c94a4a;

	--sidebar-width: 240px;
	--sidebar-rail-width: 48px;
	--main-padding: 1.5rem;
	--radius: 6px;
}

/* Mobile baseline: stacked layout. */
body {
	display: grid;
	grid-template-columns: 1fr;
	min-height: 100vh;
}

#sidebar {
	border-bottom: 1px solid var(--color-border);
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

#main {
	padding: var(--main-padding);
	display: flex;
	flex-direction: column;
	gap: 1.5rem;
}

/* Tablet and up: side-by-side layout. */
@media (min-width: 768px) {
	body {
		grid-template-columns: var(--sidebar-width) 1fr;
		transition: grid-template-columns 200ms ease;
	}
	body.is-sidebar-collapsed {
		grid-template-columns: var(--sidebar-rail-width) 1fr;
	}

	#sidebar {
		border-right: 1px solid var(--color-border);
		border-bottom: none;
	}

	body.is-sidebar-collapsed .sidebar__name,
	body.is-sidebar-collapsed .sidebar__count {
		display: none;
	}
}

/* --- Sidebar --- */
.sidebar__toggle {
	background: none;
	border: 1px solid var(--color-border);
	color: var(--color-text-muted);
	border-radius: var(--radius);
	width: 32px;
	height: 32px;
	cursor: pointer;
	align-self: flex-start;
}
.sidebar__toggle:hover {
	color: var(--color-text);
	border-color: var(--color-text-muted);
}
/* Mobile: hide the toggle entirely — collapse is desktop-only behavior. */
@media (max-width: 767px) {
	.sidebar__toggle {
		display: none;
	}
}

.sidebar__areas {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}
.sidebar__area {
	display: grid;
	grid-template-columns: 1.5rem 1fr auto;
	gap: 0.5rem;
	align-items: center;
	padding: 0.4rem 0.5rem;
	border-radius: var(--radius);
	color: var(--color-text-muted);
}
.sidebar__area:hover {
	background: var(--color-bg-elevated);
	color: var(--color-text);
}
.sidebar__count {
	font-variant-numeric: tabular-nums;
	color: var(--color-text-muted);
	font-size: 0.85rem;
}

/* --- Capture --- */
.capture__form {
	display: flex;
}
.capture__input {
	flex: 1;
	background: var(--color-bg-elevated);
	color: var(--color-text);
	border: 1px solid var(--color-border);
	border-radius: var(--radius);
	padding: 0.6rem 0.75rem;
	font: inherit;
}
.capture__input::placeholder {
	color: var(--color-text-muted);
}
.capture__input:focus {
	outline: none;
	border-color: var(--color-accent);
}

/* --- NEXT card --- */
.next-card {
	background: var(--color-bg-elevated);
	border: 1px solid var(--color-border);
	border-left: 3px solid var(--color-accent);
	border-radius: var(--radius);
	padding: 1rem;
}
.next-card__label {
	margin: 0 0 0.5rem;
	font-size: 0.7rem;
	letter-spacing: 0.12em;
	color: var(--color-accent);
	text-transform: uppercase;
}
.next-card__list {
	list-style: none;
	margin: 0;
	padding: 0;
}

/* --- Groups --- */
.group__heading {
	margin: 0 0 0.5rem;
	font-size: 0.85rem;
	color: var(--color-text-muted);
	text-transform: uppercase;
	letter-spacing: 0.08em;
}
.group--overdue .group__heading {
	color: var(--color-overdue);
}
.group__list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

/* --- Task row --- */
.task {
	position: relative;
	display: grid;
	grid-template-columns: auto 1fr auto auto auto auto;
	gap: 0.6rem;
	align-items: center;
	padding: 0.5rem 0.6rem;
	border-radius: var(--radius);
}
.task:hover {
	background: var(--color-bg-elevated);
}
.task__check {
	accent-color: var(--color-accent);
	width: 1rem;
	height: 1rem;
	cursor: pointer;
}
.task__title {
	color: var(--color-text);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.task__star,
.task__menu-btn {
	background: none;
	border: none;
	color: var(--color-text-muted);
	cursor: pointer;
	padding: 0.25rem 0.4rem;
	border-radius: var(--radius);
	font-size: 1rem;
}
.task__star[aria-pressed="true"] {
	color: var(--color-accent);
}
.task__star:hover,
.task__menu-btn:hover {
	color: var(--color-text);
	background: var(--color-bg);
}
.task__time-label,
.task__recurring {
	color: var(--color-text-muted);
	font-size: 0.85rem;
}

/* --- Task `…` menu --- */
/* Anchored to the row via the row's position: relative + this absolute. */
.task-menu {
	position: absolute;
	right: 0.5rem;
	top: 100%;
	z-index: 10;
	margin-top: 0.25rem;
	background: var(--color-bg-elevated);
	border: 1px solid var(--color-border);
	border-radius: var(--radius);
	padding: 0.25rem;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	min-width: 8rem;
}
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
.task-menu__item:hover {
	background: var(--color-bg);
}

/* --- Toast --- */
#toast-root {
	position: fixed;
	left: 0;
	right: 0;
	bottom: 1rem;
	display: flex;
	justify-content: center;
	pointer-events: none;
	z-index: 100;
}
.toast {
	background: var(--color-bg-elevated);
	color: var(--color-text);
	border: 1px solid var(--color-border);
	border-radius: var(--radius);
	padding: 0.6rem 0.75rem;
	display: flex;
	gap: 1rem;
	align-items: center;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	pointer-events: auto;
}
.toast__undo {
	background: none;
	border: none;
	color: var(--color-accent);
	cursor: pointer;
	font: inherit;
	padding: 0.2rem 0.4rem;
}
.toast__undo:hover {
	text-decoration: underline;
}

/* --- Empty state --- */
.empty {
	color: var(--color-text-muted);
	font-style: italic;
	padding: 2rem 0;
	text-align: center;
}
```

- [ ] **Step 2: Restart dev server, visual smoke-test**

Run: `npm run dev` (kill the previous if still running)
Open in browser. Expected:
- Sidebar shows the 🔥 icon, "Focus", count "0".
- Capture input has dark background and orange focus ring.
- Empty-state line is centered, italic, muted gray.
- On desktop ≥768px: clicking the `≡` toggle collapses the sidebar to a 48px rail.
- On mobile <768px: toggle button hidden; sidebar stacks above main.

- [ ] **Step 3: Biome check**

Run: `npx biome check .`
(Biome formats CSS too.)

- [ ] **Step 4: Propose commit**

Proposed message:

```
style: add CSS for capture, today, task row, menu, toast, collapsed sidebar
```

Files staged: `main.css`.

---

## Task 14 — Manual end-to-end verification

**Why:** Per Q1 lock, the rendering layer is verified manually. This task runs the 9-step checklist from the M2 design spec end-to-end in a real browser, fixes any gaps, and locks the milestone.

No commit unless gaps require code changes — in which case, fix + commit per the same workflow.

- [ ] **Step 1: Confirm clean baseline**

Run: `npm run test:run && npx biome check .`
Expected: all green. If not, fix before continuing.

- [ ] **Step 2: Start dev server**

Run: `npm run dev`
Open the printed URL in Brave (Chromium — IndexedDB has no quirks here).

- [ ] **Step 3: Walk the 9-step manual checklist**

In order, with browser DevTools open (Console + Application > IndexedDB):

1. **Boot:** Sidebar shows "🔥 Focus 0". Main shows "You're clear. Nice." No console errors except a possible favicon 404.
2. **Capture:** Type "Buy bread" in the capture input, press Enter. The task appears in the Starred group (since it's undated + starred). Capture input clears and keeps focus.
3. **Persist:** Hard reload (Ctrl+Shift+R). The task is still there.
4. **Delete + toast:** Click the `⋯` button on the task → menu appears below → click Delete. The task disappears immediately. A toast appears at the bottom of the screen with an Undo button.
5. **Undo within 5s:** Click Undo before the toast fades. The task reappears in its original position.
6. **Delete + ignore:** Delete the task again. Wait 5+ seconds. Toast fades. Task stays gone.
7. **Sidebar collapse:** Resize the window ≥768px wide. Click the `≡` toggle. Sidebar collapses to a 48px rail. Reload. Sidebar is still collapsed.
8. **Mobile:** Resize the window <768px wide. Sidebar stacks above the main area. The `≡` toggle is hidden. Sidebar layout looks correct.
9. **Tick + fallback route:** In DevTools > Application > IndexedDB > Ignite > tasks, manually edit a task's `dueAt` to an ISO datetime ~30s in the future. Wait 60s. The Today view's time label updates on the next tick (e.g. shows "in 1 min"). Then navigate to `http://localhost:5173/#anything-else` — Today view stays visible (fallback to `today` route).

If any step fails, stop, diagnose, fix, and re-run from Step 1 of *this* task. Each fix is its own commit per the workflow above.

- [ ] **Step 4: Final summary**

When all 9 steps pass and the suite + Biome are still green, M2 is complete. Tell Malin:
- Tests: 61 passing (44 from M1 + 17 from time.js).
- Commits: ~13 atomic commits past `209187a`.
- Done-criteria from spec all met.
- Suggest next session: M3 brainstorm (Area view + sections).
