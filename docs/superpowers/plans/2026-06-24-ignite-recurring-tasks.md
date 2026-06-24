# Recurring Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user set/edit a repeat rule (daily/weekly/monthly/yearly, each with an "every N" interval) on a task via a dialog opened from the ⋯ menu, and make completing a recurring task advance it to its next occurrence — stamping last-done + a count — instead of checking it off.

**Architecture:** Five woven layers, smallest-risk first. (1) The pure `recurrence.js` engine gains an optional `interval`. (2) Two new pure label helpers (`time.js`, `text.js`). (3) The `tasks.js` model gains two history fields + `completeOccurrence`. (4) A new controller-owned modal view `recurrence-dialog.js` reuses the mobile-drawer `inert`/focus split. (5) Menus get a "Repeat…" item and the badge gets a real label. TDD on the four pure seams (engine, two helpers, model); views verified manually via Claude Preview MCP (project convention — no JSDOM).

**Tech Stack:** Vanilla JS (ES modules), MVC, IndexedDB, Vitest + fake-indexeddb, Biome, Vite.

---

## Conventions for the executor (read first)

- **Commits:** project convention is **no `Co-Authored-By` trailer** and **no Claude attribution** (CLAUDE.md). Malin normally commits via GitHub Desktop — treat each "Commit" step as *stage these files + use this message*; if running headless, commit directly with the given message (no attribution trailer).
- **Test runner:** `npm run test:run` runs the whole suite once; `npx vitest run <file>` runs one file. The Stop hook also runs `npm test` on turn-finish.
- **Do NOT touch** `base.css` or anything under `design-system/` (read-only foundation).
- **Stylesheet location:** app CSS is **`main.css` at the repo root** (NOT `src/styles/main.css` as the spec's table says). Design tokens live in `main.css` `:root`: `--color-bg #0f0f10`, `--color-bg-elevated #18181b`, `--color-bg-hover`, `--color-text #e8e8ea`, `--color-text-muted #9a9aa3`, `--color-border #1f1f22`, `--color-accent #f56b0a`, `--color-overdue #c94a4a`, `--main-padding 1.5rem`, `--radius 6px`, `--capture-h`. Use only these — do not invent tokens.
- **No DB migration:** `recurrence`, `dueAt`, `lastCompletedAt`, `completedCount` are NOT IndexedDB indexes (only `sectionId`, `dueAt`, `completed`, `starred` are). Storing an object in `recurrence` is fine (structured clone). Old persisted tasks lack the two new fields; reads tolerate that via `?? 0` / `null`. Leave `CURRENT_VERSION = 1`.
- **Spec:** `docs/superpowers/specs/2026-06-24-ignite-recurring-tasks-design.md` — invariants 1–17 are the contract. This plan implements them; cross-references are noted inline as `(inv. N)`.

---

## File Structure

| File | New/Mod | Responsibility |
|---|---|---|
| `src/model/recurrence.js` | Mod | Pure engine. Add optional `interval` (coerced to int ≥1) across all four rule types; `nextWeekly` honours interval. |
| `tests/unit/recurrence.test.js` | Mod | Interval cases + back-compat. |
| `src/utils/time.js` | Mod | Add `formatOccurrenceLabel(dueAtIso, now)` — date-only short label (no time-of-day). |
| `tests/utils/time.test.js` | Mod | Cases for the new label. |
| `src/utils/text.js` | Mod | Add `describeRecurrence(rule)` — human cadence text. |
| `tests/utils/text.test.js` | Mod | Cases for the new helper. |
| `src/model/tasks.js` | Mod | `lastCompletedAt` + `completedCount` defaults + storage passthrough; `completeOccurrence(id, now)`. |
| `tests/unit/tasks.test.js` | Mod | `completeOccurrence` + field defaults. |
| `src/app.js` | Mod | Append `#repeat-dialog-root`; pass `repeatDialogRoot` in `els`. |
| `src/views/recurrence-dialog.js` | **New** | The modal editor component. Render-once-per-open; owns form state + internal focus/Esc/backdrop. |
| `main.css` | Mod | Dialog backdrop + panel (mobile bottom-sheet / desktop centered) + controls. |
| `src/views/task.js` | Mod | `⟲` badge → `role="img"` + meaningful `aria-label`. |
| `src/views/section.js` | Mod | "Repeat…" item in the task action menu (area surface). |
| `src/views/area.js` | Mod | `open-repeat` handler + `focusTaskMenu(taskId)` method + `onOpenRepeatEditor` callback. |
| `src/views/today.js` | Mod | "Repeat…" item + `open-repeat` handler + `focusTaskMenu(taskId)` method. |
| `src/controller.js` | Mod | Dialog lifecycle, `repeatEditorTaskId`, open/close/save/remove, `handleToggleComplete` (recurring branch + re-entry guard), `COMPLETE_TOAST_MS`. |

---

## Task 1: Engine — `interval` support

**Files:**
- Modify: `src/model/recurrence.js`
- Test: `tests/unit/recurrence.test.js`

Implements inv. 3 (interval defaults to 1; existing 10 tests stay green) and inv. 15 (engine coerces `interval` to an integer ≥1 so the model's no-backlog loop can never hang).

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/recurrence.test.js`:

```js
describe("nextOccurrence — interval", () => {
	it("daily every N advances by N days, preserving time-of-day", () => {
		const from = new Date("2026-04-20T09:30:00");
		const next = nextOccurrence({ type: "daily", interval: 3 }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-04-23T09:30:00").toISOString(),
		);
	});

	it("weekly every 2 weeks jumps to the next on-week (single weekday)", () => {
		// Mon 2026-04-20, [Mon], interval 2 → Mon +14 = 2026-05-04
		const from = new Date("2026-04-20T09:00:00");
		const next = nextOccurrence(
			{ type: "weekly", interval: 2, weekdays: [1] },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2026-05-04T09:00:00").toISOString(),
		);
	});

	it("weekly every 2 weeks from a mid-week selected day jumps +12 to the on-week start", () => {
		// Wed 2026-04-22, [Mon,Wed], interval 2 → Mon two weeks out = 2026-05-04 (+12)
		const from = new Date("2026-04-22T09:00:00");
		const next = nextOccurrence(
			{ type: "weekly", interval: 2, weekdays: [1, 3] },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2026-05-04T09:00:00").toISOString(),
		);
	});

	it("weekly interval still picks a later same-week day before jumping", () => {
		// Mon 2026-04-20, [Mon,Wed], interval 2 → Wed THIS week (same-week wins)
		const from = new Date("2026-04-20T09:00:00");
		const next = nextOccurrence(
			{ type: "weekly", interval: 2, weekdays: [1, 3] },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2026-04-22T09:00:00").toISOString(),
		);
	});

	it("monthly every 2 months, clamping short target months", () => {
		// Dec 31 2026, interval 2 → Feb 2027 → clamp to 28
		const from = new Date("2026-12-31T10:00:00");
		const next = nextOccurrence({ type: "monthly", interval: 2, day: 31 }, from);
		expect(next.toISOString()).toBe(
			new Date("2027-02-28T10:00:00").toISOString(),
		);
	});

	it("yearly every 2 years", () => {
		const from = new Date("2026-04-07T09:00:00");
		const next = nextOccurrence(
			{ type: "yearly", interval: 2, month: 4, day: 7 },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2028-04-07T09:00:00").toISOString(),
		);
	});

	it("treats absent / zero / negative / fractional interval as 1 (back-compat + robustness)", () => {
		const from = new Date("2026-04-20T09:30:00");
		const expected = new Date("2026-04-21T09:30:00").toISOString();
		expect(nextOccurrence({ type: "daily" }, from).toISOString()).toBe(expected);
		expect(
			nextOccurrence({ type: "daily", interval: 0 }, from).toISOString(),
		).toBe(expected);
		expect(
			nextOccurrence({ type: "daily", interval: -5 }, from).toISOString(),
		).toBe(expected);
		expect(
			nextOccurrence({ type: "daily", interval: 1.9 }, from).toISOString(),
		).toBe(expected);
	});
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/unit/recurrence.test.js`
Expected: the 7 new assertions FAIL (interval ignored → daily returns +1 not +3, etc.); the original 10 still PASS.

- [ ] **Step 3: Rewrite `src/model/recurrence.js`** to honour interval. Replace the whole file with:

```js
// Pure functions. No I/O. Given a recurrence rule and a reference date,
// returns the next Date the task should fire (strictly after fromDate).
//
// Rule shapes (interval optional, defaults to 1; coerced to an integer >= 1):
//   { type: "daily",   interval }
//   { type: "weekly",  interval, weekdays: [0..6] }  // 0 = Sunday
//   { type: "monthly", interval, day: 1..31 }        // clamped to last day of target month
//   { type: "yearly",  interval, month: 1..12, day: 1..31 }

export function nextOccurrence(rule, fromDate) {
	const interval = coerceInterval(rule.interval);
	switch (rule.type) {
		case "daily":
			return addDays(fromDate, interval);
		case "weekly":
			return nextWeekday(fromDate, rule.weekdays, interval);
		case "monthly":
			return nextMonth(fromDate, rule.day, interval);
		case "yearly":
			return nextYear(fromDate, rule.month, rule.day, interval);
		default:
			throw new Error(`Unknown recurrence type: ${rule.type}`);
	}
}

// An interval is always an integer >= 1. Absent / 0 / negative / fractional /
// non-numeric all collapse to 1. This keeps back-compat AND guarantees the
// model's no-backlog `while (next <= now)` loop strictly advances (inv. 15).
function coerceInterval(n) {
	const i = Math.floor(Number(n));
	return Number.isFinite(i) && i >= 1 ? i : 1;
}

function addDays(d, n) {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}

function nextWeekday(from, weekdays, interval) {
	if (!Array.isArray(weekdays) || weekdays.length === 0) {
		throw new Error("weekly recurrence requires weekdays[]");
	}
	const sorted = [...new Set(weekdays)].sort((a, b) => a - b); // 0..6 asc
	const fromDay = from.getDay();
	// Another selected weekday LATER this same week? Take it (interval-agnostic).
	const later = sorted.find((d) => d > fromDay);
	if (later !== undefined) return addDays(from, later - fromDay);
	// Else jump `interval` weeks to the next on-week; take its first selected day.
	return addDays(from, interval * 7 - fromDay + sorted[0]);
}

function nextMonth(from, targetDay, interval) {
	const year = from.getFullYear();
	const month = from.getMonth() + interval;
	const lastDayOfTargetMonth = new Date(year, month + 1, 0).getDate();
	const day = Math.min(targetDay, lastDayOfTargetMonth);
	return new Date(
		year,
		month,
		day,
		from.getHours(),
		from.getMinutes(),
		from.getSeconds(),
		from.getMilliseconds(),
	);
}

function nextYear(from, ruleMonth1Based, targetDay, interval) {
	const year = from.getFullYear() + interval;
	const monthIndex = ruleMonth1Based - 1;
	const lastDayOfThatMonth = new Date(year, monthIndex + 1, 0).getDate();
	const day = Math.min(targetDay, lastDayOfThatMonth);
	return new Date(
		year,
		monthIndex,
		day,
		from.getHours(),
		from.getMinutes(),
		from.getSeconds(),
		from.getMilliseconds(),
	);
}
```

- [ ] **Step 4: Run the full recurrence suite to verify all pass**

Run: `npx vitest run tests/unit/recurrence.test.js`
Expected: PASS — all 17 (10 original + 7 new).

- [ ] **Step 5: Commit**

```bash
git add src/model/recurrence.js tests/unit/recurrence.test.js
git commit -m "feat(recurrence): honour optional interval across all cadences"
```

---

## Task 2: Time util — `formatOccurrenceLabel`

**Files:**
- Modify: `src/utils/time.js`
- Test: `tests/utils/time.test.js`

A date-only short label ("Today" / "Tomorrow" / "Wed" / "Jul 6") for the completion toast ("Done · next …") and the badge label. Distinct from `formatTimeLabel`, which appends time-of-day ("· 14:30") — wrong for date-only midnight `dueAt`s (Plan flag in spec §Plan-phase flags).

- [ ] **Step 1: Write the failing tests** — append to `tests/utils/time.test.js`. Add `formatOccurrenceLabel` to the existing import at the top of the file:

```js
import {
	formatOccurrenceLabel,
	formatTimeLabel,
	groupTasksForToday,
	pickNextTask,
} from "../../src/utils/time.js";
```

Then append:

```js
describe("formatOccurrenceLabel", () => {
	const NOW = new Date("2026-04-28T14:00:00"); // Tue

	it("returns 'Today' for a dueAt on the same day", () => {
		expect(formatOccurrenceLabel("2026-04-28T00:00:00", NOW)).toBe("Today");
	});

	it("returns 'Tomorrow' for the next day", () => {
		expect(formatOccurrenceLabel("2026-04-29T00:00:00", NOW)).toBe("Tomorrow");
	});

	it("returns the short weekday for 2–6 days out", () => {
		// 2026-05-01 is a Friday, 3 days after Tue 2026-04-28
		expect(formatOccurrenceLabel("2026-05-01T00:00:00", NOW)).toBe("Fri");
	});

	it("returns 'Mon D' for a week or more out", () => {
		expect(formatOccurrenceLabel("2026-07-06T00:00:00", NOW)).toBe("Jul 6");
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/utils/time.test.js`
Expected: FAIL — `formatOccurrenceLabel is not a function` (import undefined).

- [ ] **Step 3: Implement** — in `src/utils/time.js`, add this export immediately after `formatTimeLabel` (it reuses the module-level `isSameDay`, `startOfDay`, `ONE_DAY_MS`, `SHORT_WEEKDAY`, `SHORT_MONTH`):

```js
// Date-only label for a recurrence's next occurrence — no time-of-day, since
// recurring dueAts are stored at local midnight. Used by the completion toast
// ("Done · next Jul 6") and the ⟲ badge aria-label.
export function formatOccurrenceLabel(dueAtIso, now) {
	const due = new Date(dueAtIso);
	if (isSameDay(due, now)) return "Today";

	const tomorrow = new Date(startOfDay(now).getTime() + ONE_DAY_MS);
	if (isSameDay(due, tomorrow)) return "Tomorrow";

	const dayDelta = Math.floor(
		(startOfDay(due).getTime() - startOfDay(now).getTime()) / ONE_DAY_MS,
	);
	if (dayDelta > 0 && dayDelta < 7) return SHORT_WEEKDAY[due.getDay()];

	return `${SHORT_MONTH[due.getMonth()]} ${due.getDate()}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/utils/time.test.js`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/utils/time.js tests/utils/time.test.js
git commit -m "feat(time): add date-only formatOccurrenceLabel for recurrence"
```

---

## Task 3: Text util — `describeRecurrence`

**Files:**
- Modify: `src/utils/text.js`
- Test: `tests/utils/text.test.js`

Human cadence text ("daily" / "every 2 weeks") for the save/remove confirmation toast (inv. 16) and the badge label (inv. 17).

- [ ] **Step 1: Write the failing tests** — add `describeRecurrence` to the import in `tests/utils/text.test.js`:

```js
import {
	capitalizeFirst,
	describeRecurrence,
	formatTaskDeleteMessage,
} from "../../src/utils/text.js";
```

Then append:

```js
describe("describeRecurrence", () => {
	it("returns the bare adverb when interval is 1 or absent", () => {
		expect(describeRecurrence({ type: "daily" })).toBe("daily");
		expect(describeRecurrence({ type: "weekly", interval: 1 })).toBe("weekly");
		expect(describeRecurrence({ type: "monthly" })).toBe("monthly");
		expect(describeRecurrence({ type: "yearly", interval: 1 })).toBe("yearly");
	});

	it("returns 'every N units' (pluralised) for interval > 1", () => {
		expect(describeRecurrence({ type: "daily", interval: 2 })).toBe(
			"every 2 days",
		);
		expect(describeRecurrence({ type: "weekly", interval: 2 })).toBe(
			"every 2 weeks",
		);
		expect(describeRecurrence({ type: "monthly", interval: 3 })).toBe(
			"every 3 months",
		);
		expect(describeRecurrence({ type: "yearly", interval: 5 })).toBe(
			"every 5 years",
		);
	});

	it("returns '' for a null or unknown rule (defensive)", () => {
		expect(describeRecurrence(null)).toBe("");
		expect(describeRecurrence({ type: "garbage" })).toBe("");
		expect(describeRecurrence(undefined)).toBe("");
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/utils/text.test.js`
Expected: FAIL — `describeRecurrence is not a function`.

- [ ] **Step 3: Implement** — append to `src/utils/text.js`:

```js
// Human-readable cadence text for a recurrence rule. "daily" / "every 2 weeks".
// Returns "" for a null / unknown rule so callers can interpolate safely.
const RECURRENCE_ADVERB = {
	daily: "daily",
	weekly: "weekly",
	monthly: "monthly",
	yearly: "yearly",
};
const RECURRENCE_UNIT = {
	daily: "day",
	weekly: "week",
	monthly: "month",
	yearly: "year",
};

export function describeRecurrence(rule) {
	if (!rule || typeof rule !== "object") return "";
	const unit = RECURRENCE_UNIT[rule.type];
	if (!unit) return "";
	const interval =
		Number.isInteger(rule.interval) && rule.interval >= 1 ? rule.interval : 1;
	if (interval === 1) return RECURRENCE_ADVERB[rule.type];
	return `every ${interval} ${unit}s`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/utils/text.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/text.js tests/utils/text.test.js
git commit -m "feat(text): add describeRecurrence cadence label helper"
```

---

## Task 4: Model — history fields + `completeOccurrence`

**Files:**
- Modify: `src/model/tasks.js`
- Test: `tests/unit/tasks.test.js`

Implements inv. 1 (a recurring task never persists `completed:true` — completion advances it), inv. 2 (one `db.put` + one `notify`, next date via the pure engine + no-backlog loop).

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/tasks.test.js`:

```js
describe("createTaskModel — recurrence fields", () => {
	it("defaults lastCompletedAt:null and completedCount:0 on create", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "T" });
		expect(t.lastCompletedAt).toBeNull();
		expect(t.completedCount).toBe(0);
	});

	it("round-trips the two fields through storage uncoerced", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "T" });
		await model.update(t.id, {
			lastCompletedAt: "2026-05-01T10:00:00.000Z",
			completedCount: 4,
		});
		const [reread] = await model.listBySection("s1");
		expect(reread.lastCompletedAt).toBe("2026-05-01T10:00:00.000Z");
		expect(reread.completedCount).toBe(4);
	});
});

describe("createTaskModel — completeOccurrence", () => {
	const dailyRule = { type: "daily", interval: 1 };

	it("advances dueAt via the engine, stamps last-done, bumps count, stays unchecked, notifies once", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "Water plants",
			recurrence: dailyRule,
			dueAt: "2026-05-01T09:00:00.000Z",
		});

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		const now = new Date("2026-05-01T12:00:00.000Z");
		await model.completeOccurrence(t.id, now);

		const [got] = await model.listBySection("s1");
		expect(got.dueAt).toBe(new Date("2026-05-02T09:00:00.000Z").toISOString());
		expect(got.lastCompletedAt).toBe(now.toISOString());
		expect(got.completedCount).toBe(1);
		expect(got.completed).toBe(false);
		expect(calls).toEqual(["notified"]); // single notify
	});

	it("no-backlog: a badly stale dueAt advances to the first future occurrence", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "Stale daily",
			recurrence: dailyRule,
			dueAt: "2026-01-01T09:00:00.000Z",
		});
		const now = new Date("2026-01-05T12:00:00.000Z");
		await model.completeOccurrence(t.id, now);
		const [got] = await model.listBySection("s1");
		expect(new Date(got.dueAt).getTime()).toBeGreaterThan(now.getTime());
		expect(got.dueAt).toBe(new Date("2026-01-06T09:00:00.000Z").toISOString());
	});

	it("anchors on `now` when dueAt is null", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "No date",
			recurrence: dailyRule,
			dueAt: null,
		});
		const now = new Date("2026-05-10T08:00:00.000Z");
		await model.completeOccurrence(t.id, now);
		const [got] = await model.listBySection("s1");
		expect(new Date(got.dueAt).getTime()).toBeGreaterThan(now.getTime());
	});

	it("throws 'is not recurring' for a non-recurring task", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Plain" });
		await expect(model.completeOccurrence(t.id, new Date())).rejects.toThrow(
			/is not recurring/i,
		);
	});

	it("throws 'Task not found' for a missing id", async () => {
		const { model } = await freshModel();
		await expect(
			model.completeOccurrence("nope-id", new Date()),
		).rejects.toThrow(/Task not found/);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/tasks.test.js`
Expected: FAIL — `completeOccurrence is not a function`; the two default-field assertions fail (`undefined` not `null`/`0`).

- [ ] **Step 3: Implement.** Three edits to `src/model/tasks.js`:

**3a.** Add the engine import at the top (after the existing imports):

```js
import { uuid } from "../utils/id.js";
import { capitalizeFirst } from "../utils/text.js";
import { nextOccurrence } from "./recurrence.js";
```

**3b.** In the JSDoc contract block at the top, add `completeOccurrence` to the `TaskModel` listing (after `toggleCompleted`):

```js
//   toggleCompleted(id) → Promise<Task>,
//   completeOccurrence(id, now?) → Promise<void>,  // recurring: advance + stamp, never persists completed
```

**3c.** In `create()`, add the two fields to the `task` object (after `recurrence,`):

```js
				dueAt,
				recurrence,
				lastCompletedAt: null,
				completedCount: 0,
				leadTime,
```

**3d.** Add the `completeOccurrence` method. Place it immediately after `toggleCompleted` (before `remove`):

```js
		async completeOccurrence(id, now = new Date()) {
			const stored = await db.get("tasks", id);
			if (!stored) throw new Error(`Task not found: ${id}`);
			const task = fromStorage(stored);
			if (!task.recurrence) throw new Error(`Task is not recurring: ${id}`);

			// No-backlog: advance from the schedule, but never land on/before `now`.
			// Bounded — the engine coerces interval >= 1 so each step strictly
			// advances; the break is a belt-and-braces guard against a non-advancing
			// rule (imported / dev-tools data) so the loop can never hang (inv. 15).
			const anchor = task.dueAt ? new Date(task.dueAt) : now;
			let next = nextOccurrence(task.recurrence, anchor);
			while (next <= now) {
				const advanced = nextOccurrence(task.recurrence, next);
				if (advanced <= next) break;
				next = advanced;
			}

			const updated = {
				...task,
				dueAt: next.toISOString(),
				lastCompletedAt: now.toISOString(),
				completedCount: (task.completedCount ?? 0) + 1,
				completed: false, // a recurring task NEVER persists completed — it advances (inv. 1)
			};
			await db.put("tasks", toStorage(updated)); // one put
			notify(); // one notify (inv. 2)
		},
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/tasks.test.js`
Expected: PASS (existing + new).

- [ ] **Step 5: Run the FULL suite** (the model is shared)

Run: `npm run test:run`
Expected: PASS — all files green.

- [ ] **Step 6: Commit**

```bash
git add src/model/tasks.js tests/unit/tasks.test.js
git commit -m "feat(tasks): completeOccurrence advances recurring tasks + history fields"
```

---

## Task 5: Bootstrap — `#repeat-dialog-root`

**Files:**
- Modify: `src/app.js`

A body-level root for the dialog (mirrors `toastRoot`) so its backdrop sits OUTSIDE every `inert` subtree (inv. 6).

- [ ] **Step 1: Add the root and pass it in `els`.** In `src/app.js`, after the `toastRoot` block:

```js
	const toastRoot = document.createElement("div");
	toastRoot.id = "toast-root";
	document.body.appendChild(toastRoot);

	const repeatDialogRoot = document.createElement("div");
	repeatDialogRoot.id = "repeat-dialog-root";
	document.body.appendChild(repeatDialogRoot);
```

Then add it to the `els` object passed to `createController`:

```js
			mainRoot: document.getElementById("main-root"),
			toastRoot,
			repeatDialogRoot,
		},
```

- [ ] **Step 2: Verify the suite is unaffected**

Run: `npm run test:run`
Expected: PASS (no test touches app.js wiring).

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat(app): add #repeat-dialog-root mount point"
```

---

## Task 6: Dialog component — `recurrence-dialog.js`

**Files:**
- Create: `src/views/recurrence-dialog.js`

Render-once-per-open modal editor (inv. 5). Owns form state in its closure + internal focus + Esc/backdrop close; the CONTROLLER owns `inert` and focus restoration. Validation gates Save (inv. 4). Build rule from controls; date is the single source for monthly `day` / yearly `month`+`day`; chips are the single source for weekly `weekdays` (inv. 10).

- [ ] **Step 1: Create the file** with this exact content:

```js
// createRecurrenceDialog(rootEl, { onSave, onRemove, onClose })
//   → { open(task), close(), destroy() }
//
// A modal repeat-rule editor. Render-once-per-open: open(task) seeds form state
// from the task and writes the panel HTML; the panel is NEVER re-rendered by the
// app's applyState, so a 60s tick or model-notify under the dialog can't wipe an
// in-progress form (the reason a dialog beat an inline editor — inv. 5).
//
// The dialog owns its form state + internal focus + Esc/backdrop close. The
// CONTROLLER owns background `inert` and focus restoration to the task's ⋯
// (mirrors the mobile-drawer split — inv. 6).
//
//   onSave({ taskId, recurrence, dueAt }) — a valid rule was built + confirmed
//   onRemove({ taskId })                  — an existing rule was cleared
//   onClose()                             — dismissed (Cancel / Esc / backdrop)

import { escapeHtml } from "../utils/dom.js";

const CADENCES = [
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
	{ value: "yearly", label: "Yearly" },
];
// 0 = Sunday (matches Date.getDay()). Single visible letter; full name for SRs.
const WEEKDAYS = [
	{ value: 0, short: "S", name: "Sunday" },
	{ value: 1, short: "M", name: "Monday" },
	{ value: 2, short: "T", name: "Tuesday" },
	{ value: 3, short: "W", name: "Wednesday" },
	{ value: 4, short: "T", name: "Thursday" },
	{ value: 5, short: "F", name: "Friday" },
	{ value: 6, short: "S", name: "Saturday" },
];
const UNIT = {
	daily: "day",
	weekly: "week",
	monthly: "month",
	yearly: "year",
};

function pad2(n) {
	return String(n).padStart(2, "0");
}

export function createRecurrenceDialog(rootEl, { onSave, onRemove, onClose }) {
	// Form state — lives in this closure, never in the model.
	let taskId = null;
	let taskTitle = "";
	let wasRecurring = false;
	let cadence = "daily";
	let interval = 1;
	let weekdays = new Set();
	let dateStr = ""; // YYYY-MM-DD

	let formHandler = null;
	let keyHandler = null;

	function open(task) {
		taskId = task.id;
		taskTitle = task.title ?? "";
		wasRecurring = !!task.recurrence;

		const seed = task.dueAt ? new Date(task.dueAt) : new Date();
		dateStr = `${seed.getFullYear()}-${pad2(seed.getMonth() + 1)}-${pad2(seed.getDate())}`;

		const rule = task.recurrence;
		cadence = rule?.type ?? "daily";
		interval =
			Number.isInteger(rule?.interval) && rule.interval >= 1
				? rule.interval
				: 1;
		// Default the chips to the start date's weekday so the default flow is
		// self-consistent (spec Plan flag: weekly default).
		weekdays = new Set(
			Array.isArray(rule?.weekdays) && rule.weekdays.length
				? rule.weekdays
				: [seed.getDay()],
		);

		rootEl.innerHTML = render();
		wire();
		syncWeekdayVisibility();
		syncValidity();
		// Open focus → the cadence control (first radio).
		rootEl.querySelector(".repeat-cadence__input")?.focus();
	}

	function close() {
		if (formHandler) {
			rootEl.removeEventListener("change", formHandler);
			rootEl.removeEventListener("input", formHandler);
			rootEl.removeEventListener("click", formHandler);
		}
		if (keyHandler) document.removeEventListener("keydown", keyHandler);
		formHandler = null;
		keyHandler = null;
		rootEl.innerHTML = ""; // detaches the panel
		taskId = null;
	}

	function render() {
		const cadenceInputs = CADENCES.map(
			(c) => `
			<label class="repeat-cadence__option">
				<input class="repeat-cadence__input" type="radio" name="repeat-cadence"
					value="${c.value}" ${c.value === cadence ? "checked" : ""} />
				<span>${c.label}</span>
			</label>`,
		).join("");

		const chips = WEEKDAYS.map(
			(d) => `
			<button type="button" class="repeat-weekday" data-action="toggle-weekday"
				data-weekday="${d.value}" aria-pressed="${weekdays.has(d.value)}"
				aria-label="${d.name}">${d.short}</button>`,
		).join("");

		const removeBtn = wasRecurring
			? `<button type="button" class="repeat-btn repeat-btn--remove" data-action="repeat-remove">Remove repeat</button>`
			: "";

		return `
			<div class="repeat-backdrop" data-action="repeat-backdrop">
				<div class="repeat-panel" role="dialog" aria-modal="true" aria-labelledby="repeat-heading">
					<h2 class="repeat-panel__heading" id="repeat-heading">Repeat — ${escapeHtml(taskTitle)}</h2>

					<fieldset class="repeat-fieldset">
						<legend class="repeat-fieldset__legend">Repeats</legend>
						<div class="repeat-cadence" role="radiogroup" aria-label="Cadence">${cadenceInputs}</div>
					</fieldset>

					<div class="repeat-field repeat-field--interval">
						<label for="repeat-interval">Every</label>
						<input class="repeat-input repeat-input--interval" id="repeat-interval"
							type="number" min="1" step="1" inputmode="numeric" value="${interval}" />
						<span class="repeat-field__unit" data-role="interval-unit">${unitLabel()}</span>
					</div>

					<fieldset class="repeat-fieldset" data-role="weekdays">
						<legend class="repeat-fieldset__legend">Days of the week</legend>
						<div class="repeat-weekdays">${chips}</div>
					</fieldset>

					<div class="repeat-field">
						<label for="repeat-date" data-role="date-label">${dateLabel()}</label>
						<input class="repeat-input" id="repeat-date" type="date" value="${escapeHtml(dateStr)}" />
					</div>

					<footer class="repeat-footer">
						${removeBtn}
						<button type="button" class="repeat-btn" data-action="repeat-cancel">Cancel</button>
						<button type="button" class="repeat-btn repeat-btn--primary" data-action="repeat-save">Save</button>
					</footer>
				</div>
			</div>
		`;
	}

	function unitLabel() {
		const u = UNIT[cadence];
		return interval > 1 ? `${u}s` : u;
	}
	function dateLabel() {
		return cadence === "weekly" ? "Starting" : "Next date";
	}

	function wire() {
		// One handler for change + input + click, routed by target. Idempotent
		// (re-reads values), so binding it to multiple event types is safe.
		formHandler = (event) => {
			const t = event.target;

			if (event.type === "click") {
				const actionEl = t.closest("[data-action]");
				const action = actionEl?.dataset?.action;
				if (!action) return;
				// Backdrop closes only when the click is the backdrop itself, not a
				// bubbled click from inside the panel.
				if (action === "repeat-backdrop") {
					if (t === actionEl) onClose();
					return;
				}
				if (action === "toggle-weekday") {
					const day = Number(actionEl.dataset.weekday);
					if (weekdays.has(day)) weekdays.delete(day);
					else weekdays.add(day);
					actionEl.setAttribute("aria-pressed", String(weekdays.has(day)));
					syncValidity();
					return;
				}
				if (action === "repeat-save") {
					if (isValid()) {
						onSave({ taskId, recurrence: buildRule(), dueAt: buildDueAt() });
					}
					return;
				}
				if (action === "repeat-remove") {
					onRemove({ taskId });
					return;
				}
				if (action === "repeat-cancel") onClose();
				return;
			}

			// change / input
			if (t.name === "repeat-cadence") {
				cadence = t.value;
				syncWeekdayVisibility();
				syncUnit();
				syncDateLabel();
				syncValidity();
			} else if (t.id === "repeat-interval") {
				const n = Math.floor(Number(t.value));
				interval = Number.isFinite(n) ? n : 0; // raw; isValid() rejects < 1
				if (event.type === "change") {
					// Clamp + reflect on blur only — never fight mid-typing.
					if (interval < 1) interval = 1;
					t.value = String(interval);
				}
				syncUnit();
				syncValidity();
			} else if (t.id === "repeat-date") {
				dateStr = t.value;
				syncValidity();
			}
		};
		rootEl.addEventListener("change", formHandler);
		rootEl.addEventListener("input", formHandler);
		rootEl.addEventListener("click", formHandler);

		// Esc closes — on document because focus may sit on any control.
		keyHandler = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		};
		document.addEventListener("keydown", keyHandler);
	}

	function syncWeekdayVisibility() {
		const field = rootEl.querySelector('[data-role="weekdays"]');
		if (field) field.hidden = cadence !== "weekly";
	}
	function syncUnit() {
		const el = rootEl.querySelector('[data-role="interval-unit"]');
		if (el) el.textContent = unitLabel();
	}
	function syncDateLabel() {
		const el = rootEl.querySelector('[data-role="date-label"]');
		if (el) el.textContent = dateLabel();
	}
	function syncValidity() {
		const saveBtn = rootEl.querySelector('[data-action="repeat-save"]');
		if (saveBtn) saveBtn.disabled = !isValid();
	}

	function isValid() {
		if (!dateStr) return false;
		if (interval < 1) return false;
		if (cadence === "weekly" && weekdays.size === 0) return false;
		return true;
	}

	function buildDueAt() {
		const [y, m, d] = dateStr.split("-").map(Number);
		return new Date(y, m - 1, d).toISOString(); // local midnight
	}

	function buildRule() {
		const [y, m, d] = dateStr.split("-").map(Number);
		const date = new Date(y, m - 1, d);
		if (cadence === "daily") return { type: "daily", interval };
		if (cadence === "weekly") {
			return {
				type: "weekly",
				interval,
				weekdays: [...weekdays].sort((a, b) => a - b),
			};
		}
		if (cadence === "monthly") {
			return { type: "monthly", interval, day: date.getDate() };
		}
		return {
			type: "yearly",
			interval,
			month: date.getMonth() + 1,
			day: date.getDate(),
		};
	}

	return {
		open,
		close,
		destroy() {
			close();
		},
	};
}
```

- [ ] **Step 2: Lint the new file**

Run: `npx biome check src/views/recurrence-dialog.js`
Expected: no errors (format clean). If Biome reports formatting, run `npx biome check --write src/views/recurrence-dialog.js`.

- [ ] **Step 3: Verify the suite is unaffected**

Run: `npm run test:run`
Expected: PASS (no importer yet — the file is standalone until Task 10).

- [ ] **Step 4: Commit**

```bash
git add src/views/recurrence-dialog.js
git commit -m "feat(views): recurrence-dialog editor component"
```

---

## Task 7: Dialog CSS

**Files:**
- Modify: `main.css`

Mobile-first bottom sheet (≤767px) / centered dialog (≥768px). Tokens only. ≥44px touch targets on chips + buttons (inv. 17). Enter animation gated behind `prefers-reduced-motion` (inv. 17). Selected chip = accent bg + dark text (AA). `base.css` / `design-system/` untouched.

- [ ] **Step 1: Append to the END of `main.css`** (after the `body.is-drawer-open #scrim` block — appending at end is safe here because these are all-new selectors with no state-override specificity conflict; Biome `noDescendingSpecificity` is not tripped because no later rule has lower specificity than an earlier same-target rule):

```css

/* ================================================================= */
/* Recurrence dialog — controller-owned modal repeat editor.          */
/* Mobile-first: bottom sheet. >=768px: centered dialog. Background    */
/* `inert` is set by the controller; this is pure presentation.        */
/* ================================================================= */
.repeat-backdrop {
	position: fixed;
	inset: 0;
	z-index: 200; /* above toast (100), scrim (80) */
	background: rgba(0, 0, 0, 0.5);
	display: flex;
	align-items: flex-end; /* bottom sheet on mobile */
	justify-content: center;
}
.repeat-panel {
	width: 100%;
	max-height: 90vh;
	overflow-y: auto;
	background: var(--color-bg-elevated);
	border: 1px solid var(--color-border);
	border-radius: var(--radius) var(--radius) 0 0;
	padding: 1rem;
	padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
	display: flex;
	flex-direction: column;
	gap: 1rem;
	box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.5);
	animation: repeat-sheet-in 200ms ease;
}
@keyframes repeat-sheet-in {
	from {
		transform: translateY(100%);
	}
	to {
		transform: translateY(0);
	}
}
.repeat-panel__heading {
	margin: 0;
	font-size: 1.1rem;
}
.repeat-fieldset {
	border: 0;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}
.repeat-fieldset__legend {
	padding: 0;
	font-size: 0.85rem;
	color: var(--color-text-muted);
}
.repeat-cadence {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}
.repeat-cadence__option {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	min-block-size: 44px;
	padding-inline: 0.4rem;
	cursor: pointer;
}
.repeat-cadence__input {
	inline-size: 1.1rem;
	block-size: 1.1rem;
	accent-color: var(--color-accent);
}
.repeat-field {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}
.repeat-field--interval {
	flex-flow: row wrap;
	align-items: center;
	gap: 0.5rem;
}
.repeat-field label {
	font-size: 0.85rem;
	color: var(--color-text-muted);
}
.repeat-field__unit {
	color: var(--color-text-muted);
}
.repeat-input {
	min-block-size: 44px;
	padding: 0.5rem;
	background: var(--color-bg);
	color: var(--color-text);
	border: 1px solid var(--color-border);
	border-radius: var(--radius);
	font: inherit;
}
.repeat-input--interval {
	inline-size: 5rem;
}
.repeat-input:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}
.repeat-weekdays {
	display: flex;
	flex-wrap: wrap;
	gap: 0.35rem;
}
.repeat-weekday {
	min-inline-size: 44px;
	min-block-size: 44px;
	border: 1px solid var(--color-border);
	background: var(--color-bg);
	color: var(--color-text);
	border-radius: var(--radius);
	cursor: pointer;
	font: inherit;
}
.repeat-weekday[aria-pressed="true"] {
	background: var(--color-accent);
	color: var(--color-bg); /* dark text on orange ≈ AA */
	border-color: var(--color-accent);
}
.repeat-weekday:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}
.repeat-footer {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	justify-content: flex-end;
	align-items: center;
}
.repeat-btn {
	min-block-size: 44px;
	padding: 0.5rem 1rem;
	border: 1px solid var(--color-border);
	border-radius: var(--radius);
	background: var(--color-bg);
	color: var(--color-text);
	font: inherit;
	cursor: pointer;
}
.repeat-btn--primary {
	background: var(--color-accent);
	color: var(--color-bg);
	border-color: var(--color-accent);
}
.repeat-btn--remove {
	margin-inline-end: auto; /* push Remove to the left of Cancel/Save */
	color: var(--color-overdue);
}
.repeat-btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
.repeat-btn:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}

/* Reduced motion: no slide-in. */
@media (prefers-reduced-motion: reduce) {
	.repeat-panel {
		animation: none;
	}
}

/* Desktop / tablet: centered dialog instead of a bottom sheet. */
@media (min-width: 768px) {
	.repeat-backdrop {
		align-items: center;
	}
	.repeat-panel {
		inline-size: 420px;
		max-inline-size: 92vw;
		border-radius: var(--radius);
		animation: none;
	}
}
```

- [ ] **Step 2: Lint the stylesheet** (catches `noDescendingSpecificity` etc.)

Run: `npx biome check main.css`
Expected: no errors. If formatting flagged: `npx biome check --write main.css`.

- [ ] **Step 3: Commit**

```bash
git add main.css
git commit -m "feat(css): recurrence dialog (mobile sheet / desktop dialog)"
```

---

## Task 8: Badge — meaningful `aria-label`

**Files:**
- Modify: `src/views/task.js`

The `⟲` badge becomes `role="img"` with an `aria-label` (cadence + next date) so it's no longer purely decorative (inv. 17). Glyph unchanged.

- [ ] **Step 1: Extend the imports** at the top of `src/views/task.js`:

```js
import { escapeHtml } from "../utils/dom.js";
import { describeRecurrence } from "../utils/text.js";
import { formatOccurrenceLabel, formatTimeLabel } from "../utils/time.js";
```

- [ ] **Step 2: Replace the `recurring` badge line.** Change:

```js
	const recurring = task.recurrence
		? '<span class="task__recurring" aria-hidden="true">⟲</span>'
		: "";
```

to:

```js
	const recurring = task.recurrence
		? `<span class="task__recurring" role="img" aria-label="${escapeHtml(recurrenceBadgeLabel(task, now))}">⟲</span>`
		: "";
```

- [ ] **Step 3: Add the label helper** at the bottom of `src/views/task.js` (module scope, after `renderRenameRow`):

```js
// "Repeats every 2 weeks; next Jul 6" — the badge's accessible name. Omits the
// "next" clause when the task has no dueAt (defensive; a saved rule always has one).
function recurrenceBadgeLabel(task, now) {
	const cadence = describeRecurrence(task.recurrence);
	const base = `Repeats ${cadence}`;
	return task.dueAt
		? `${base}; next ${formatOccurrenceLabel(task.dueAt, now)}`
		: base;
}
```

- [ ] **Step 4: Verify the suite is unaffected**

Run: `npm run test:run`
Expected: PASS (no JSDOM view tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/task.js
git commit -m "feat(task): label the recurrence badge for screen readers"
```

---

## Task 9: Menus — "Repeat…" item + `open-repeat` + `focusTaskMenu`

**Files:**
- Modify: `src/views/section.js` (area-surface menu markup)
- Modify: `src/views/area.js` (`open-repeat` handler + `focusTaskMenu` method)
- Modify: `src/views/today.js` (menu markup + `open-repeat` handler + `focusTaskMenu` method)

"Repeat…" sits before Delete in both task menus (inv. 9). The handler resets `taskMenuMode="actions"`, closes the menu via `doRender()` (touches a non-inert list — runs BEFORE the controller sets `inert`), then calls `callbacks.onOpenRepeatEditor`. `focusTaskMenu(taskId)` sets the pending-focus flag the controller consumes after a save/remove re-render (inv. 14). The menu item carries `aria-haspopup="dialog"` (inv. 17).

> Uses `callbacks.onOpenRepeatEditor?.(...)` (optional chaining) so this commit is safe before Task 10 wires the callback.

- [ ] **Step 1: `section.js` — add the "Repeat…" item.** In `renderTaskRowWithMenu`, change the actions-face return (the `row.replace("</li>", ...)` block) to insert a Repeat item before Delete:

```js
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="rename-task"
				role="menuitem" tabindex="-1">Rename</button>
			${moveUpItem}
			${moveDownItem}
			${moveToItem}
			<button class="task-menu__item" type="button" data-action="open-repeat"
				role="menuitem" tabindex="-1" aria-haspopup="dialog">Repeat…</button>
			<button class="task-menu__item" type="button" data-action="delete-task"
				role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
```

- [ ] **Step 2: `area.js` — add the `open-repeat` action handler.** Inside the `bindActions(rootEl, { ... })` map, add (e.g. immediately after the `"delete-task"` handler):

```js
		"open-repeat": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			openTaskMenuId = null;
			taskMenuMode = "actions"; // reset (move-picker invariant)
			doRender(); // close the menu visually BEFORE the controller sets inert
			callbacks.onOpenRepeatEditor?.(t.id);
		},
```

- [ ] **Step 3: `area.js` — add `focusTaskMenu` to the returned object.** In the `return { render(state) {...}, enterRename(...) {...}, destroy() {...} }`, add a method (e.g. after `enterRename`):

```js
		// Controller hook: after a Save/Remove re-render, restore focus to this
		// task's ⋯. Sets the pending flag only — the model-notify re-render (or the
		// controller's applyState on Cancel/Esc) consumes it via doRender's
		// pendingFocusTaskId lookup. Mirrors the move-handler focus pattern (inv. 14).
		focusTaskMenu(taskId) {
			pendingFocusTaskId = taskId;
		},
```

- [ ] **Step 4: `today.js` — add the "Repeat…" item.** In `renderTaskRowWithMenu`, change the actions-face return to insert Repeat before Delete:

```js
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="rename-task" role="menuitem" tabindex="-1">Rename</button>
			${moveToItem}
			<button class="task-menu__item" type="button" data-action="open-repeat" role="menuitem" tabindex="-1" aria-haspopup="dialog">Repeat…</button>
			<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
```

- [ ] **Step 5: `today.js` — add the `open-repeat` handler.** Inside `bindActions(rootEl, { ... })`, add after `"delete-task"`:

```js
		"open-repeat": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			openMenuTaskId = null; // today.js names it openMenuTaskId
			taskMenuMode = "actions";
			doRender();
			callbacks.onOpenRepeatEditor?.(t.id);
		},
```

- [ ] **Step 6: `today.js` — add `focusTaskMenu` to the returned object.** In the `return { render(state) {...}, destroy() {...} }`, add after `render`:

```js
		focusTaskMenu(taskId) {
			pendingFocusTaskId = taskId;
		},
```

- [ ] **Step 7: Lint + suite**

Run: `npx biome check src/views/section.js src/views/area.js src/views/today.js && npm run test:run`
Expected: lint clean; suite PASS.

- [ ] **Step 8: Commit**

```bash
git add src/views/section.js src/views/area.js src/views/today.js
git commit -m "feat(views): Repeat… menu item + focusTaskMenu focus hook"
```

---

## Task 10: Controller — wire it all together

**Files:**
- Modify: `src/controller.js`

Implements: dialog construction/teardown; `repeatEditorTaskId` transient state (inv. 5); `openRecurrenceEditor`/`closeRecurrenceEditor` owning `inert` on exactly `[topbarRoot, sidebarRoot, mainEl, toastRoot]` (inv. 6); `handleToggleComplete` with the recurring branch + re-entry guard (inv. 13) + `/not found/i` swallow (inv. 7); save/remove via `tasks.update` + confirmation toast (inv. 16); focus restoration via `focusTaskMenu` (inv. 14); `closeRecurrenceEditor` first in `stop()` and in `onHashChange` (inv. 11).

- [ ] **Step 1: Extend the imports** at the top of `src/controller.js`:

```js
import { FOCUS_DEFAULT_SECTION_ID, FOCUS_ID } from "./model/areas.js";
import { describeRecurrence, formatTaskDeleteMessage } from "./utils/text.js";
import { formatOccurrenceLabel } from "./utils/time.js";
import { createAreaView } from "./views/area.js";
import { createCaptureView } from "./views/capture.js";
import { createRecurrenceDialog } from "./views/recurrence-dialog.js";
import { createSidebarView } from "./views/sidebar.js";
import { createToastView, TASK_DELETE_BATCH_KEY } from "./views/toast.js";
import { createTodayView } from "./views/today.js";
import { createTopbarView } from "./views/topbar.js";
```

- [ ] **Step 2: Add the toast-duration constant** near the other `*_MS` constants (after `MOVE_TOAST_MS`):

```js
// Completing a recurring task is reversible (Undo restores the prior schedule)
// — same 5s urgency as a move/single-delete.
const COMPLETE_TOAST_MS = 5_000;
```

- [ ] **Step 3: Destructure `repeatDialogRoot`** from `els`:

```js
	const {
		sidebarRoot,
		topbarRoot,
		scrimEl,
		mainEl,
		captureRoot,
		mainRoot,
		toastRoot,
		repeatDialogRoot,
	} = els;
```

- [ ] **Step 4: Add the new transient state** alongside the other `let` declarations (after `drawerMqHandler`):

```js
	let recurrenceDialog = null;
	let repeatEditorTaskId = null; // transient UI state — NOT a model field (inv. 5)
	const completing = new Set(); // task ids mid-completion (re-entry guard, inv. 13)
```

- [ ] **Step 5: Add `handleToggleComplete`.** Place it after `applyState` (before `handleTaskDelete`):

```js
	async function handleToggleComplete(id) {
		// Re-entry guard (inv. 13): a fast double-click/tap must advance a recurring
		// task exactly once. Added synchronously at the top so two queued activations
		// can't both pass before either marks the id. Coalescing a genuine
		// double-fire to one toggle is also the right behaviour for plain tasks.
		if (completing.has(id)) return;
		completing.add(id);
		try {
			const task = (await tasks.list()).find((t) => t.id === id);
			if (!task) return; // race: already gone
			// Non-recurring, or un-checking a (defensively) completed one → unchanged.
			if (!task.recurrence || task.completed) {
				await tasks.toggleCompleted(id);
				return;
			}
			const snapshot = {
				dueAt: task.dueAt,
				lastCompletedAt: task.lastCompletedAt,
				completedCount: task.completedCount,
			};
			try {
				await tasks.completeOccurrence(id);
			} catch (err) {
				if (/not found/i.test(err.message)) return; // cascade race (inv. 7)
				throw err;
			}
			const updated = (await tasks.list()).find((t) => t.id === id);
			toast.show({
				message: `Done · next ${formatOccurrenceLabel(updated.dueAt, new Date())}`,
				durationMs: COMPLETE_TOAST_MS,
				onUndo: async () => {
					try {
						await tasks.update(id, snapshot); // restore date, stamp, count
					} catch (err) {
						if (/not found/i.test(err.message)) return;
						throw err;
					}
				},
			});
		} finally {
			completing.delete(id);
		}
	}
```

- [ ] **Step 6: Add the dialog open/close + save/remove functions.** Place them after `closeDrawer` (before `onHashChange`):

```js
	async function openRecurrenceEditor(taskId) {
		const task = (await tasks.list()).find((t) => t.id === taskId);
		if (!task) return; // deleted between menu render and click (inv. 14)
		repeatEditorTaskId = taskId;
		document.body.classList.add("is-repeat-open"); // scroll-lock (CSS)
		// Background inert → focus contained in the dialog, AT ignores it. The
		// dialog root + backdrop are body children, outside every inert subtree.
		for (const el of [topbarRoot, sidebarRoot, mainEl, toastRoot]) {
			el.inert = true;
		}
		recurrenceDialog.open(task);
	}

	// rerender=true forces a consuming render for no-model-change closes
	// (Cancel / Esc / backdrop). Save/Remove pass false, then their tasks.update
	// notify provides the consuming render. Either way the pending-focus flag set
	// here is consumed by the view's doRender (inv. 14).
	function closeRecurrenceEditor({ rerender = true } = {}) {
		if (!repeatEditorTaskId) return;
		const taskId = repeatEditorTaskId;
		repeatEditorTaskId = null;
		recurrenceDialog.close();
		document.body.classList.remove("is-repeat-open");
		for (const el of [topbarRoot, sidebarRoot, mainEl, toastRoot]) {
			el.inert = false;
		}
		currentMainView?.focusTaskMenu?.(taskId); // best-effort on route change
		if (rerender) applyState();
	}

	async function onSaveRecurrence({ taskId, recurrence, dueAt }) {
		closeRecurrenceEditor({ rerender: false }); // clears inert + sets focus flag
		try {
			await tasks.update(taskId, { recurrence, dueAt }); // notify → render consumes flag
		} catch (err) {
			if (/not found/i.test(err.message)) return; // cascade race (inv. 7)
			throw err;
		}
		toast.show({
			message: `Repeats ${describeRecurrence(recurrence)}`,
			durationMs: COMPLETE_TOAST_MS,
		});
	}

	async function onRemoveRecurrence({ taskId }) {
		closeRecurrenceEditor({ rerender: false });
		try {
			await tasks.update(taskId, { recurrence: null }); // dueAt kept (inv. 4)
		} catch (err) {
			if (/not found/i.test(err.message)) return;
			throw err;
		}
		toast.show({ message: "Repeat removed", durationMs: COMPLETE_TOAST_MS });
	}
```

- [ ] **Step 7: Swap the two `onToggleComplete` wirings to `handleToggleComplete` and add the `onOpenRepeatEditor` callback.**

In `mountMainView` (the Today branch), change:

```js
			currentMainView = createTodayView(mainRoot, {
				onToggleComplete: (id) => tasks.toggleCompleted(id),
```

to:

```js
			currentMainView = createTodayView(mainRoot, {
				onToggleComplete: handleToggleComplete,
```

and add the callback to that same Today options object (e.g. after `onMoveTaskToSection: handleMoveTaskToSection,`):

```js
				onMoveTaskToSection: handleMoveTaskToSection,
				onOpenRepeatEditor: openRecurrenceEditor,
			});
```

In `areaCallbacks()`, change:

```js
			onToggleComplete: (id) => tasks.toggleCompleted(id),
```

to:

```js
			onToggleComplete: handleToggleComplete,
			onOpenRepeatEditor: openRecurrenceEditor,
```

- [ ] **Step 8: Close the dialog on route change.** In `onHashChange`, add the close as the first line after `closeDrawer()`:

```js
	function onHashChange() {
		closeDrawer(); // close on ALL route changes incl. browser back/forward
		closeRecurrenceEditor({ rerender: false }); // route change closes the dialog (inv. 11)
		currentRoute = parseHash(window.location.hash);
		mountMainView(currentRoute);
		applyState();
	}
```

- [ ] **Step 9: Construct the dialog in `start()`.** After `toast = createToastView(toastRoot);`, add:

```js
		recurrenceDialog = createRecurrenceDialog(repeatDialogRoot, {
			onSave: onSaveRecurrence,
			onRemove: onRemoveRecurrence,
			onClose: () => closeRecurrenceEditor({ rerender: true }),
		});
```

- [ ] **Step 10: Tear down in `stop()`.** Make `closeRecurrenceEditor` the first line (mirrors `closeDrawer`), and destroy + null the dialog among the teardowns:

```js
	function stop() {
		closeRecurrenceEditor({ rerender: false }); // clears inert + is-repeat-open first (inv. 11)
		closeDrawer(); // clears is-drawer-open, inert, scroll-lock, dialog ARIA in one place
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
		recurrenceDialog?.destroy();
		currentMainView = null;
		capture = null;
		sidebar = null;
		topbar = null;
		toast = null;
		recurrenceDialog = null;
		drawerOpen = false;
	}
```

- [ ] **Step 11: Lint + full suite**

Run: `npx biome check src/controller.js && npm run test:run`
Expected: lint clean; suite PASS (143 + the new unit cases).

- [ ] **Step 12: Commit**

```bash
git add src/controller.js
git commit -m "feat(controller): wire recurrence dialog + advancing completion"
```

---

## Task 11: Manual E2E verification (Claude Preview MCP)

**Files:** none (verification only).

No JSDOM view tests by project convention — verify the wired feature in-browser. Use the `ignite-dev` launch config (`npm run dev`, :5173). Memory note: `preview_click` can silently no-op — fall back to a dispatched `MouseEvent({bubbles:true, detail:1})` for delegated handlers, but use a real `preview_click` (proven non-no-op) for focus/selection assertions. Re-query the DOM after every re-render (refs go stale).

- [ ] **Step 1: Build + boot.** Run `npm run build` (must succeed — the deploy workflow gates on it) then start the dev preview. Confirm no console errors on load.

- [ ] **Step 2: Open the editor from both surfaces.** On an Area page, open a task ⋯ → "Repeat…" → the dialog appears with cadence/interval/date controls. Repeat from the Today view's task ⋯. Confirm the weekday chips show only when "Weekly" is selected.

- [ ] **Step 3: Save each cadence.** For one task: set Daily every 2 → Save → `⟲` badge appears; reopen → fields show every 2 days. Set Weekly with two weekdays + interval 2 → Save. Set Monthly, Yearly. Confirm a "Repeats …" toast each time and the badge's `aria-label` (inspect) reads e.g. "Repeats every 2 weeks; next …".

- [ ] **Step 4: Validation gating.** Weekly with all weekday chips off → Save disabled. Clear the date → Save disabled. Type 0 into interval and blur → clamps to 1.

- [ ] **Step 5: Advancing completion.** Check a recurring task's checkbox → it stays unchecked, `dueAt` advances (badge/time label updates), toast "Done · next …". Click Undo → date/stamp/count restored (reopen the editor or inspect IndexedDB to confirm `completedCount` went back). Verify a non-recurring task still completes normally (gets checked / leaves the active list).

- [ ] **Step 6: Remove repeat.** Open the editor on a recurring task → "Remove repeat" → badge gone, toast "Repeat removed", and the task keeps its due date (still shows a time label).

- [ ] **Step 7: A11y / modality.** With the dialog open: Tab cannot reach the background (it's `inert`); Esc closes; backdrop click closes; on close, focus returns to the task's ⋯. Confirm the dialog has `role="dialog"`/`aria-modal="true"` and the heading is its label (inspect). Probe `document.activeElement` after close to confirm focus on the ⋯ (more reliable than a screenshot per memory).

- [ ] **Step 8: Mobile sheet.** `preview_resize` to 375px → the dialog is a bottom sheet, not hidden behind the fixed capture bar; chips/buttons are ≥44px.

- [ ] **Step 9: No console errors** throughout. Capture one screenshot of the open dialog (mobile) for the record; if `preview_screenshot` hangs (known flake), rely on DOM probes instead.

- [ ] **Step 10: Final gates + commit (docs/memory only if anything changed).**

Run: `npm run test:run && npx biome check . && npm run build`
Expected: all green. If E2E surfaced a fix, make it in the relevant source file, re-verify, and commit with a descriptive message.

---

## Self-Review (performed against the spec)

**Spec coverage** — every architecture-table row and invariant maps to a task:

| Spec item | Task |
|---|---|
| Engine `interval` + `nextWeekly` (inv. 3, 15) | 1 |
| `formatOccurrenceLabel` reuse (Plan flag) | 2 |
| `describeRecurrence` for toast/badge (inv. 16, 17) | 3 |
| Model fields + `completeOccurrence` (inv. 1, 2) | 4 |
| `#repeat-dialog-root` bootstrap | 5 |
| Dialog component, render-once, validation, build-rule (inv. 4, 5, 10) | 6 |
| Dialog CSS, mobile sheet, reduced-motion, 44px, AA (inv. 17) | 7 |
| Badge `role="img"` + label (inv. 17) | 8 |
| "Repeat…" item + `open-repeat` + `focusTaskMenu` (inv. 9, 14) | 9 |
| Controller: inert split, handleToggleComplete + re-entry guard, save/remove + toast, `/not found/i` swallow, close-first ordering (inv. 6, 7, 11, 13, 16) | 10 |
| Manual E2E across all edge cases | 11 |

**Corrections folded in (where the codebase differed from the spec's assumptions):**
- CSS is `main.css` at the repo root, **not** `src/styles/main.css`. (Conventions block + Task 7.)
- Time-helper tests live in `tests/utils/time.test.js`, text in `tests/utils/text.test.js` (NOT `tests/unit/`). (Tasks 2–3.)
- `tasks.js` did not previously import `recurrence.js`; the import is added explicitly (Task 4, step 3a).
- No DB version bump — the new fields/object-rule aren't indexed. (Conventions block.)
- Focus-restoration (inv. 14): resolved to a single `focusTaskMenu(taskId)` flag-setter on each main view, consumed by the model-notify render (Save/Remove) or `applyState()` (Cancel/Esc) — avoids a stale direct `.focus()` after the re-render replaces the ⋯ button.

**Type/name consistency:** `focusTaskMenu` (both views) ↔ `currentMainView.focusTaskMenu` (controller); `onOpenRepeatEditor` (both view callback sets) ↔ `openRecurrenceEditor` (controller); `repeatDialogRoot` (app.js els ↔ controller destructure); `onSave/onRemove/onClose` (dialog) ↔ `onSaveRecurrence/onRemoveRecurrence/closeRecurrenceEditor` (controller construction). `completeOccurrence(id, now)` signature matches between model (Task 4) and caller (Task 10). `describeRecurrence`/`formatOccurrenceLabel` signatures match between definition (Tasks 2–3) and callers (Tasks 8, 10).

**No placeholders:** every code step shows complete code; every run step has an exact command + expected result.
