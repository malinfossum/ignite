# Ignite v3 — Plan 2: Scheduling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give any task a real due date and an optional time of day, so "no time set" and "due at 00:00" stop being the same thing and the agenda has something true to show.

**Architecture:** One new boolean model field (`hasTime`) rides the existing `BOOL_FIELDS` 0/1 conversion, so no DB version bump. The recurrence dialog becomes a *schedule* dialog: date and time at the top, repeat demoted to an optional section beneath, with a new "Does not repeat" cadence that lets a one-off task carry a date for the first time. A new pure sort puts untimed tasks after timed ones within a day. The recurrence engine is not touched — it already preserves time-of-day.

**Tech Stack:** Vanilla JS (MVC), Vite, Vitest, Biome. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-11-ignite-v3-focus-design.md` — decision D8 and all of §6.

## Global Constraints

- **Mobile-first CSS.** Baseline styles target the phone; layer up with `@media (min-width: 768px)`. No `max-width` queries.
- **`design-system/` is vendored and read-only.** Never hand-edit. All project CSS goes in `main.css` at the repo root (NOT `src/styles/main.css`).
- **Escape every user-authored string** through `escapeHtml` before interpolating into a template literal.
- **≥44×44 px** for every new interactive control. The dialog already holds this line; the new time input must too.
- **No free-text Enter handler is added to the dialog**, so the IME guard does not apply here — this is the documented reason the recurrence dialog was excluded from it. Do not add one.
- **Line endings are LF**, pinned by `.gitattributes`. Do not resolve a Biome complaint by changing Biome.
- **No AI attribution in commit messages.** No `Co-Authored-By`, no "Generated with Claude Code".
- Run `npm run check` (Biome) before every commit. Zero warnings, zero `biome-ignore`.
- Green baseline before starting: **210 tests / 15 files**, Biome clean, build clean.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/model/tasks.js` | modify | `hasTime` joins `BOOL_FIELDS`; `create` defaults it |
| `tests/unit/tasks.test.js` | modify | `hasTime` defaults, persistence, absent-field read |
| `src/utils/time.js` | modify | `sortByDueThenUntimed`; grouping uses it |
| `tests/utils/time.test.js` | modify | Sort contract, `hasTime` label coverage |
| `src/views/task.js` | modify | Row picks the formatter from `hasTime` |
| `src/views/recurrence-dialog.js` | modify | Time field, "Does not repeat", `hasTime` in the save payload |
| `src/views/section.js` | modify | Menu copy: `Repeat…` → `Schedule…` |
| `src/views/today.js` | modify | Menu copy: `Repeat…` → `Schedule…` |
| `src/controller.js` | modify | Persist `hasTime`; toast copy for the no-repeat case |
| `main.css` | modify | Time field layout in the dialog |
| `README.md` | modify | Scheduling is now a feature |

### Three deliberate deviations from the spec, and why

1. **The internal `repeat-*` naming stays.** §6.3 renames the *user-visible* affordance to "Schedule…", and this plan does that. It does **not** rename `recurrence-dialog.js`, the `.repeat-*` CSS classes, `repeatEditorTaskId`, `openRecurrenceEditor`, `body.is-repeat-open`, or the `repeat-heading` id. Renaming them would touch `main.css`, four view files and the controller for zero user-visible gain, in the single most invariant-dense file in the repo. Visible copy changes; identifiers do not.

2. **"Remove repeat" survives alongside "Does not repeat".** Once a `none` cadence exists, the Remove button is a second path to the same state. It is kept because it is an existing shipped affordance with its own controller handler, toast, and `wasRecurring` gating, and deleting it is a UX change §6 does not ask for. It is one click instead of two. **Flagged for Malin — say the word and Task 4 drops it instead.**

3. **The dialog opens on "Does not repeat" for a task with no rule.** Today it pre-selects Daily, which was right when the dialog only existed to create repeats. For a schedule dialog, pre-selecting a repeat on a one-off task would be a trap. `cadence = rule?.type ?? "none"`.

### Two gaps the spec does not cover

**`pickNextTask` treats an untimed task as already overdue.** An untimed task due today is stored at local midnight, so `dueAt > now` is false from 00:01 onward and the "up next" line in Today skips it in favour of anything later today, then reports it under the overdue branch. This is pre-existing, but `hasTime` makes it visible for the first time — before this plan, *every* dated task was midnight, so the behaviour was uniform. **Not fixed here.** `pickNextTask` is Today-view furniture that §3 replaces wholesale in Plan 3, and changing its semantics now would mean re-deriving them again in six tasks' time. Recorded so it is a decision, not an oversight.

**A time cannot be cleared once set, except by clearing the whole schedule.** `<input type="time">` supports an empty value and the plan reads `""` as untimed, so clearing it works — but on a browser whose time picker offers no clear affordance, the keyboard route (select, Delete) is the only one. Accepted: the same is already true of the date field.

### Considered during the stress test and deliberately not fixed

- **The date field's label changes text under a focused input.** `dateLabel()` already swapped between "Starting" and "Next date" on cadence change; `none` adds a third value, "Date". A screen-reader user focused on the input is not re-notified when its accessible name changes. Pre-existing behaviour, one more state — fixing it means an `aria-live` region or a focus-shunt, both worse than the problem.
- **`hasTime: true` with `dueAt: null`.** The model permits it; the dialog can never produce it, since both fields are written in the same `tasks.update`. The row renders no label and the sort treats the epoch as its day. Unreachable through the UI, so not guarded.
- **`timeStr` is reset in `close()` but `dateStr` is not.** Neither strictly needs it — `open()` re-seeds every form variable unconditionally. The reset is kept as cheap defence and the asymmetry is noise, not a bug.
- **Form state is lost on hard reload mid-dialog.** Consistent with §13's stance on capture text: persisting draft input is a bigger idea than it looks, and it is not in scope here.
- **A disabled Save button is not announced when validity flips.** Pre-existing across the whole dialog, unchanged in kind by this plan, and a live region for it would talk over every keystroke.

---

## Task 1: `hasTime` on the model

**Files:**
- Modify: `src/model/tasks.js:29` (`BOOL_FIELDS`), `src/model/tasks.js:64-98` (`create`)
- Test: `tests/unit/tasks.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: every task object carries `hasTime: boolean`. `create({..., hasTime})` accepts it, defaulting `false`. Persisted as `0`/`1`. No DB version bump.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/tasks.test.js`, inside the existing `describe("createTaskModel — create")` block:

```javascript
	it("defaults hasTime to false", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Call mom" });
		expect(t.hasTime).toBe(false);
	});

	it("accepts hasTime on create and round-trips it as a boolean", async () => {
		const { model } = await freshModel();
		await model.create({ sectionId: "s1", title: "Standup", hasTime: true });
		const [stored] = await model.list();
		expect(stored.hasTime).toBe(true);
	});
```

And add a new top-level block at the end of the file:

```javascript
describe("createTaskModel — hasTime migration", () => {
	it("reads a row written before hasTime existed as false", async () => {
		const { db, model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Legacy" });
		// Simulate a pre-hasTime row: the field simply is not there.
		const row = await db.get("tasks", t.id);
		delete row.hasTime;
		await db.put("tasks", row);

		const [read] = await model.list();
		expect(read.hasTime).toBe(false);
	});

	it("survives an update that does not mention hasTime", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "Standup",
			hasTime: true,
		});
		await model.rename(t.id, "Standup, moved");
		const [read] = await model.list();
		expect(read.hasTime).toBe(true);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:run -- tests/unit/tasks.test.js
```

Expected: FAIL. The first two report `undefined` where `false`/`true` was expected; the migration test passes only by accident (`undefined !== 1` → `false`) — confirm the *first two* fail before continuing.

- [ ] **Step 3: Add the field**

In `src/model/tasks.js`, line 29:

```javascript
const BOOL_FIELDS = ["completed", "starred", "critical", "hasTime"];
```

In `create`'s destructured parameters (after `dueAt = null,`):

```javascript
			hasTime = false,
```

And in the `task` object literal, immediately after `dueAt,`:

```javascript
				hasTime,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:run -- tests/unit/tasks.test.js
```

Expected: PASS, all four new tests green.

- [ ] **Step 5: Run the full suite — nothing else may move**

```bash
npm run test:run
```

Expected: 214 passed. The 210 baseline plus 4.

- [ ] **Step 6: Commit**

```bash
git add src/model/tasks.js tests/unit/tasks.test.js
git commit -m "feat(tasks): add hasTime, distinguishing an untimed date from midnight"
```

---

## Task 2: Untimed tasks sort last within a day

**Files:**
- Modify: `src/utils/time.js:91-115` (`groupTasksForToday`), `:136-138` (`byDueAtAsc`)
- Test: `tests/utils/time.test.js`

**Interfaces:**
- Consumes: `task.hasTime` from Task 1.
- Produces: `sortByDueThenUntimed(tasks)` — exported from `src/utils/time.js`. Returns a **new** array ordered by calendar day ascending, then timed-before-untimed **within each day**, then by clock time, then by `createdAt` ascending. Does not mutate its argument.

**The day comparison comes first, and that is not decoration.** §6.2 scopes the untimed-last rule to *within a day*. `groupTasksForToday` applies this sort to **two** buckets: `today`, which is one day, and `overdue`, which can span weeks. Sorting `overdue` on the naive timed-first rule would push an untimed task from three weeks ago below this morning's 09:00 — the oldest thing you have missed, buried under the newest. Comparing the day first makes the rule a no-op inside Today and correct inside Overdue, so one comparator serves both buckets.

- [ ] **Step 1: Write the failing tests**

Add `sortByDueThenUntimed` to the import block at the top of `tests/utils/time.test.js`, then append:

```javascript
describe("sortByDueThenUntimed", () => {
	const at = (iso, overrides) =>
		task({ dueAt: new Date(iso).toISOString(), hasTime: true, ...overrides });

	it("orders timed tasks ascending by time", () => {
		const list = [
			at("2026-04-28T16:00:00", { id: "late" }),
			at("2026-04-28T09:00:00", { id: "early" }),
		];
		expect(sortByDueThenUntimed(list).map((t) => t.id)).toEqual([
			"early",
			"late",
		]);
	});

	it("puts untimed tasks after every timed task, whatever the clock says", () => {
		// The untimed task is stored at 00:00 — earlier than both timed tasks.
		// It must still sort last: untimed means "sometime today", not midnight.
		const list = [
			at("2026-04-28T00:00:00", { id: "untimed", hasTime: false }),
			at("2026-04-28T16:00:00", { id: "late" }),
			at("2026-04-28T09:00:00", { id: "early" }),
		];
		expect(sortByDueThenUntimed(list).map((t) => t.id)).toEqual([
			"early",
			"late",
			"untimed",
		]);
	});

	it("breaks ties between untimed peers by createdAt ascending", () => {
		const list = [
			at("2026-04-28T00:00:00", {
				id: "newer",
				hasTime: false,
				createdAt: "2026-04-28T11:00:00.000Z",
			}),
			at("2026-04-28T00:00:00", {
				id: "older",
				hasTime: false,
				createdAt: "2026-04-28T08:00:00.000Z",
			}),
		];
		expect(sortByDueThenUntimed(list).map((t) => t.id)).toEqual([
			"older",
			"newer",
		]);
	});

	it("breaks ties between timed peers at the same minute by createdAt", () => {
		const list = [
			at("2026-04-28T09:00:00", {
				id: "newer",
				createdAt: "2026-04-28T11:00:00.000Z",
			}),
			at("2026-04-28T09:00:00", {
				id: "older",
				createdAt: "2026-04-28T08:00:00.000Z",
			}),
		];
		expect(sortByDueThenUntimed(list).map((t) => t.id)).toEqual([
			"older",
			"newer",
		]);
	});

	it("orders by calendar day before applying the untimed rule", () => {
		// The untimed-last rule is scoped to a single day. Across days, an older
		// untimed task must still sort above a newer timed one — otherwise the
		// oldest thing you have missed sits at the bottom of Overdue.
		const list = [
			at("2026-04-28T09:00:00", { id: "today-timed" }),
			at("2026-04-07T00:00:00", { id: "three-weeks-ago", hasTime: false }),
		];
		expect(sortByDueThenUntimed(list).map((t) => t.id)).toEqual([
			"three-weeks-ago",
			"today-timed",
		]);
	});

	it("does not mutate its argument", () => {
		const list = [at("2026-04-28T16:00:00"), at("2026-04-28T09:00:00")];
		const before = [...list];
		sortByDueThenUntimed(list);
		expect(list).toEqual(before);
	});
});

describe("groupTasksForToday — untimed ordering", () => {
	it("sorts today's untimed tasks after its timed ones", () => {
		const tasks = [
			task({
				id: "untimed",
				dueAt: new Date("2026-04-28T00:00:00").toISOString(),
				hasTime: false,
			}),
			task({
				id: "timed",
				dueAt: new Date("2026-04-28T18:00:00").toISOString(),
				hasTime: true,
			}),
		];
		expect(groupTasksForToday(tasks, NOW).today.map((t) => t.id)).toEqual([
			"timed",
			"untimed",
		]);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:run -- tests/utils/time.test.js
```

Expected: FAIL with `sortByDueThenUntimed is not a function` (and the grouping test failing on order).

- [ ] **Step 3: Implement the sort and wire it into grouping**

In `src/utils/time.js`, replace the private `byDueAtAsc` at the bottom of the file with the exported sort plus its comparator:

```javascript
// Day ascending; within a day, timed tasks first by clock time, then untimed.
// An untimed task means "sometime that day", not 00:00, so it must not squat at
// the top of its day just because that is where its stored midnight puts it.
//
// The DAY comparison has to come first. This sorts `overdue` as well as `today`,
// and overdue spans many days — without it, an untimed task from three weeks ago
// would sort below this morning's 09:00.
export function sortByDueThenUntimed(tasks) {
	return [...tasks].sort(byDueThenUntimed);
}

function byDueThenUntimed(a, b) {
	const dayDelta =
		startOfDay(new Date(a.dueAt)).getTime() -
		startOfDay(new Date(b.dueAt)).getTime();
	if (dayDelta !== 0) return dayDelta;

	if (a.hasTime !== b.hasTime) return a.hasTime ? -1 : 1;
	if (a.hasTime) {
		const delta = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
		if (delta !== 0) return delta;
	}

	// Explicit tie-break rather than relying on sort stability, which is engine
	// behaviour and not a guarantee — without it the order shuffles between
	// renders as unrelated tasks change. A STRING compare is correct here only
	// because `createdAt` is always `new Date().toISOString()`: UTC, fixed width,
	// so lexicographic order IS chronological. Store a local-format date in that
	// field and this breaks silently.
	return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}
```

`startOfDay` already exists as a private helper at the top of `time.js` — do not add a second one.

Then in `groupTasksForToday`, replace the two `byDueAtAsc` sorts:

```javascript
	const sortedOverdue = sortByDueThenUntimed(overdue);
	const sortedToday = sortByDueThenUntimed(today);
	starred.sort((a, b) => a.order - b.order);

	return { overdue: sortedOverdue, today: sortedToday, starred };
```

Delete the now-unused `overdue.sort(...)` and `today.sort(...)` lines.

`pickNextTask` still needs an ascending-by-`dueAt` comparator for its `dated` list. Keep a private one for it:

```javascript
function byDueAtAsc(a, b) {
	return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:run -- tests/utils/time.test.js
```

Expected: PASS.

- [ ] **Step 5: Run the full suite and Biome**

```bash
npm run test:run && npm run check
```

Expected: 221 passed, Biome clean. If Biome reports `byDueAtAsc` as unused, `pickNextTask` was edited by mistake — revert that part.

- [ ] **Step 6: Commit**

```bash
git add src/utils/time.js tests/utils/time.test.js
git commit -m "feat(time): sort untimed tasks after timed ones within a day"
```

---

## Task 3: The row shows a time only when there is one

**Files:**
- Modify: `src/views/task.js:42-44`
- Test: none — `task.js` is a view. Its formatters are already covered in `tests/utils/time.test.js`.

**Interfaces:**
- Consumes: `task.hasTime`; `formatTimeLabel` and `formatOccurrenceLabel`, both already imported at `src/views/task.js:20`.
- Produces: nothing new.

**Why this is an improvement the moment it lands, not a regression:** today the *only* writer of `dueAt` is `onSaveRecurrence`, which stores local midnight. So every existing dated task currently renders `formatTimeLabel` against midnight and reads `was 00:00`. After this task they read `Today` / `Tomorrow` / `Aug 21`. Nothing can yet set `hasTime: true` — that arrives in Task 4 — so this is strictly a correction until then.

- [ ] **Step 1: Swap the formatter on the time label**

In `src/views/task.js`, replace lines 42-44:

```javascript
	// `hasTime` is what separates "due sometime today" from "due at 00:00" —
	// without it a dateless-but-dated task reads "was 00:00" all afternoon.
	const timeLabel = task.dueAt
		? `<span class="task__time-label">${escapeHtml(
				task.hasTime
					? formatTimeLabel(task.dueAt, now)
					: formatOccurrenceLabel(task.dueAt, now),
			)}</span>`
		: "";
```

- [ ] **Step 2: Verify the suite is untouched and Biome is clean**

```bash
npm run test:run && npm run check
```

Expected: 221 passed, Biome clean.

- [ ] **Step 3: Verify in the browser**

Start the dev server via the Preview MCP config `ignite-dev` (`npm run dev`, :5173). On an existing task with a repeat rule, confirm the row now reads a plain date label (`Today`, `Tomorrow`, or `Aug 21`) rather than `was 00:00`.

- [ ] **Step 4: Commit**

```bash
git add src/views/task.js
git commit -m "fix(task): render a date-only label when a task has no time of day"
```

---

## Task 4: The dialog schedules, and repeat becomes optional

**This is the highest-risk task in the plan.** `recurrence-dialog.js` carries a block of invariants in `memory/invariants.md` under *Recurring tasks → Dialog view*. Re-read that block before editing, and re-verify every item afterwards rather than assuming it survived: validation gates Save; the **date** is the single source for monthly `day` and yearly `month`+`day`; **chips** are the source for weekly `weekdays`; backdrop-click closes only when `event.target === backdrop`; the interval clamps on `change` (blur), never on `input`; the title is escaped in the heading.

**Files:**
- Modify: `src/views/recurrence-dialog.js`
- Modify: `main.css` (the time field's layout)
- Test: none — this is a view. Its pure seams live in `time.js` and `text.js` and are already covered.

**Interfaces:**
- Consumes: `task.dueAt`, `task.hasTime`, `task.recurrence`.
- Produces: the save payload gains one field —
  `onSave({ taskId, recurrence, dueAt, hasTime })`, where `recurrence` is **`null`** when the cadence is `"none"`. `onRemove({ taskId })` is unchanged.

- [ ] **Step 1: Add the `none` cadence and the time state**

In `src/views/recurrence-dialog.js`, prepend to `CADENCES` (line 19):

```javascript
const CADENCES = [
	{ value: "none", label: "Does not repeat" },
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
	{ value: "yearly", label: "Yearly" },
];
```

Add one closure variable beside `dateStr` (line 54):

```javascript
	let dateStr = ""; // YYYY-MM-DD
	let timeStr = ""; // HH:MM, "" = no time of day
```

- [ ] **Step 2: Seed date, time and cadence in `open`**

Replace the seeding block in `open` (lines 64-79):

```javascript
		const seed = task.dueAt ? new Date(task.dueAt) : new Date();
		dateStr = `${seed.getFullYear()}-${pad2(seed.getMonth() + 1)}-${pad2(seed.getDate())}`;
		// Only a task that actually carries a time seeds one. A task stored at
		// local midnight with hasTime false must open with an EMPTY time field,
		// or every save would silently pin it to 00:00.
		timeStr = task.hasTime
			? `${pad2(seed.getHours())}:${pad2(seed.getMinutes())}`
			: "";

		const rule = task.recurrence;
		// A task with no rule opens as non-repeating. Pre-selecting Daily made
		// sense when this dialog only created repeats; in a schedule dialog it
		// would hand every one-off task a repeat it never asked for.
		cadence = rule?.type ?? "none";
		interval =
			Number.isInteger(rule?.interval) && rule.interval >= 1
				? rule.interval
				: 1;
		// Default the chips to the start date's weekday so the default flow is
		// self-consistent.
		weekdays = new Set(
			Array.isArray(rule?.weekdays) && rule.weekdays.length
				? rule.weekdays
				: [seed.getDay()],
		);
```

Then replace the two sync calls after `wire()` (lines 83-84), **and the focus line beneath them** (line 86):

```javascript
		syncRepeatVisibility();
		syncValidity();
		// Open focus → the date field. It is now the first control in the panel
		// and the reason the dialog was opened. The old `.repeat-cadence__input`
		// target sat third after this restructure, and that selector takes the
		// FIRST radio regardless of which is checked — so a weekly task opened
		// with focus parked on "Does not repeat".
		rootEl.querySelector("#repeat-date")?.focus();
```

- [ ] **Step 3: Restructure the panel — date and time first, repeat beneath**

Replace the `return` template inside `render()` (lines 123-157):

```javascript
		return `
			<div class="repeat-backdrop" data-action="repeat-backdrop">
				<div class="repeat-panel" role="dialog" aria-modal="true" aria-labelledby="repeat-heading">
					<h2 class="repeat-panel__heading" id="repeat-heading">Schedule — ${escapeHtml(taskTitle)}</h2>

					<div class="repeat-field repeat-field--when">
						<div class="repeat-field__col">
							<label for="repeat-date" data-role="date-label">${dateLabel()}</label>
							<input class="repeat-input" id="repeat-date" type="date" value="${escapeHtml(dateStr)}" />
						</div>
						<div class="repeat-field__col">
							<label for="repeat-time">Time</label>
							<input class="repeat-input" id="repeat-time" type="time" value="${escapeHtml(timeStr)}" />
						</div>
					</div>

					<fieldset class="repeat-fieldset">
						<legend class="repeat-fieldset__legend">Repeats</legend>
						<div class="repeat-cadence" role="radiogroup" aria-label="Cadence">${cadenceInputs}</div>
					</fieldset>

					<div class="repeat-field repeat-field--interval" data-role="interval">
						<label for="repeat-interval">Every</label>
						<input class="repeat-input repeat-input--interval" id="repeat-interval"
							type="number" min="1" step="1" inputmode="numeric" value="${interval}" />
						<span class="repeat-field__unit" data-role="interval-unit">${unitLabel()}</span>
					</div>

					<fieldset class="repeat-fieldset" data-role="weekdays">
						<legend class="repeat-fieldset__legend">Days of the week</legend>
						<div class="repeat-weekdays">${chips}</div>
					</fieldset>

					<footer class="repeat-footer">
						${removeBtn}
						<button type="button" class="repeat-btn" data-action="repeat-cancel">Cancel</button>
						<button type="button" class="repeat-btn repeat-btn--primary" data-action="repeat-save">Save</button>
					</footer>
				</div>
			</div>
		`;
```

Note what moved: the date field is now **above** the cadence fieldset and shares a row with the new time input; the interval field gained `data-role="interval"` so it can be hidden.

- [ ] **Step 4: Handle the time input and hide repeat controls when `none`**

In `wire()`'s change/input branch, add a clause after the `repeat-date` one (line 223-226):

```javascript
			} else if (t.id === "repeat-date") {
				dateStr = t.value;
				syncValidity();
			} else if (t.id === "repeat-time") {
				timeStr = t.value;
			}
```

`timeStr` deliberately does not call `syncValidity()` — a time is always optional, so it can never invalidate the form.

Replace `syncWeekdayVisibility` (lines 242-245) with one function that owns the whole repeat block:

```javascript
	function syncRepeatVisibility() {
		const repeating = cadence !== "none";
		const intervalField = rootEl.querySelector('[data-role="interval"]');
		if (intervalField) intervalField.hidden = !repeating;
		const weekdayField = rootEl.querySelector('[data-role="weekdays"]');
		if (weekdayField) weekdayField.hidden = !(repeating && cadence === "weekly");
	}
```

Update the cadence branch in `wire()` to call it (line 207-212):

```javascript
			if (t.name === "repeat-cadence") {
				cadence = t.value;
				syncRepeatVisibility();
				syncUnit();
				syncDateLabel();
				syncValidity();
			}
```

- [ ] **Step 5: Update validity, the date label, and the builders**

First add two parsers above `isValid`. **This is not defensive padding — it closes a live crash path.**

`buildDueAt()` is evaluated as an *argument* to `onSave(...)`, so anything it throws propagates out of the Save click handler **before `onSave` runs**, which means before `closeRecurrenceEditor` clears `inert`. The result is a wedged app: the background stays inert, the dialog stays open, and Save looks dead. Only Escape recovers it. `new Date(NaN).toISOString()` throws exactly that `RangeError`, and it is reachable wherever `input[type="date"]` or `[type="time"]` degrades to a plain text input, where free text reaches this code. The date half of this exposure is **pre-existing**; the time field doubles it.

```javascript
	// `input[type=date]` and `[type=time]` constrain their own values, but both
	// degrade to a TEXT input where unsupported — and then `new Date(NaN)` throws
	// RangeError out of `toISOString()`, inside the Save handler, BEFORE
	// `closeRecurrenceEditor` clears `inert`. That wedges the app behind an open
	// dialog. Parse defensively and let `isValid()` gate Save instead.
	function parseDate(value) {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
		if (!m) return null;
		const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
		const date = new Date(y, mo - 1, d);
		// Also rejects 2026-02-31, which Date silently rolls forward into March.
		return date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
	}

	function parseTime(value) {
		const m = /^(\d{2}):(\d{2})/.exec(value ?? "");
		if (!m) return null;
		const hh = Number(m[1]);
		const mm = Number(m[2]);
		return hh <= 23 && mm <= 59 ? { hh, mm } : null;
	}
```

`isValid` (lines 259-264) — a valid date is still always required; a time is optional but must parse if present; interval and weekday rules apply only when repeating:

```javascript
	function isValid() {
		if (!parseDate(dateStr)) return false;
		if (timeStr && !parseTime(timeStr)) return false;
		if (cadence === "none") return true;
		if (interval < 1) return false;
		if (cadence === "weekly" && weekdays.size === 0) return false;
		return true;
	}
```

`dateLabel` (lines 164-166):

```javascript
	function dateLabel() {
		if (cadence === "none") return "Date";
		return cadence === "weekly" ? "Starting" : "Next date";
	}
```

`buildDueAt` (lines 266-269) — midnight stays the untimed representation, so every existing row keeps its meaning:

```javascript
	function buildDueAt() {
		const date = parseDate(dateStr); // non-null: isValid() gates Save
		const time = parseTime(timeStr);
		if (time) date.setHours(time.hh, time.mm, 0, 0);
		return date.toISOString(); // untimed → local midnight, as before
	}
```

`buildRule` (lines 271-291) gains one line at the top and takes its date from the same parser. **The date remains the single source for monthly `day` and yearly `month`+`day` — do not re-derive them from anything else:**

```javascript
	function buildRule() {
		if (cadence === "none") return null;
		const date = parseDate(dateStr); // non-null: isValid() gates Save
		if (cadence === "daily") return { type: "daily", interval };
```

…rest unchanged. `buildRule` and `buildDueAt` each call `parseDate` and so get independent `Date` objects — `buildDueAt`'s `setHours` cannot reach into the rule.

- [ ] **Step 6: Send `hasTime` with the save**

In the `repeat-save` branch of the click handler (lines 192-197):

```javascript
				if (action === "repeat-save") {
					if (isValid()) {
						onSave({
							taskId,
							recurrence: buildRule(),
							dueAt: buildDueAt(),
							hasTime: parseTime(timeStr) !== null,
						});
					}
					return;
				}
```

- [ ] **Step 7: Reset `timeStr` on close**

In `close()`, beside `taskId = null;` (line 99):

```javascript
		taskId = null;
		timeStr = "";
```

- [ ] **Step 8: Lay out the two-column when-row**

In `main.css`, immediately after `.repeat-field--interval` (currently line 1249-1253), so the modifier rules stay together.

Two things the existing CSS already gives you, so do **not** restate them: `.repeat-field` (line 1244) is already `display: flex; flex-direction: column`, and `.repeat-input` (line 1261) already carries `min-block-size: 44px`, so the new time input meets the touch-target rule by inheritance.

This block uses raw rem values rather than `--space-*` tokens, matching every rule around it.

```css
/* Date and time share a row from tablet up. Stacked on a phone, where two
   native pickers side by side would squeeze both. `.repeat-field` is already
   a column flex container — only the row switch and the columns are new. */
.repeat-field--when {
	gap: 0.75rem;
}
.repeat-field__col {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	min-width: 0;
}
@media (min-width: 768px) {
	.repeat-field--when {
		flex-direction: row;
	}
	.repeat-field__col {
		flex: 1 1 0;
	}
}

/* `syncRepeatVisibility` hides these with the `hidden` property, and BOTH set
   `display` — an author `display` beats the UA's `[hidden]` rule whatever the
   specificity. That works today only because `design-system/base/reset.css`
   carries `[hidden] { display: none !important }`, which arrived in the 2.0.1
   sync on 2026-08-13. Restated locally so a future re-sync cannot silently leave
   hidden repeat controls visible AND keyboard-focusable inside a modal. The
   attribute selector outranks the class rule, so no !important is needed. */
.repeat-field[hidden],
.repeat-fieldset[hidden] {
	display: none;
}
```

- [ ] **Step 9: Verify Biome and the suite**

```bash
npm run check && npm run test:run
```

Expected: Biome clean, 221 passed. No test covers this file; a change here must not move the count.

- [ ] **Step 10: Re-verify every dialog invariant in the browser**

This is the step the risk warning exists for. Against `ignite-dev`, walk each one and confirm it still holds:

1. **Save is gated.** Clear the date → Save disabled. Weekly with every chip off → Save disabled. Interval `0` → Save disabled.
2. **Interval clamps on blur, not mid-type.** Type `0` — it stays `0` while focused; tab away → becomes `1`.
3. **The date is the single source for monthly and yearly.** Set the date to the 21st, cadence Monthly, Save; reopen → the rule advanced from day 21.
4. **Chips are the source for weekly.** Pick two weekdays, Save, reopen → both still lit.
5. **Backdrop-click closes only from the backdrop.** Click the panel's dead space → stays open. Click outside it → closes.
6. **Escape closes** from any control, and focus returns to the task's ⋯ button.
7. **The title is escaped** — rename a task to `<img src=x onerror=alert(1)>` and open the dialog; the heading shows the literal text.
8. **New:** cadence `Does not repeat` hides both the interval row and the weekday chips; picking Weekly brings both back. Confirm they are gone from the **tab order** too, not merely invisible — Tab from the cadence radios must reach the footer buttons.
9. **New:** an untimed task opens with an empty time field, not `00:00`.
10. **New:** opening the dialog puts focus on the **date** field, and it does so for a weekly task as well as an unscheduled one.
11. **New:** the crash path is closed. In the console, force a bad value past the native picker and confirm Save is disabled rather than throwing:

```javascript
const t = document.querySelector("#repeat-time");
t.value = "";                      // native inputs reject junk, so go via the property
Object.defineProperty(t, "value", { value: "not a time", configurable: true });
t.dispatchEvent(new Event("input", { bubbles: true }));
document.querySelector('[data-action="repeat-save"]').disabled;  // expect: true
```

Then press Escape and confirm the app is usable — nothing left `inert`, the sidebar and topbar respond.

- [ ] **Step 11: Commit**

```bash
git add src/views/recurrence-dialog.js main.css
git commit -m "feat(schedule): add a time field and a non-repeating cadence to the dialog"
```

---

## Task 5: The controller persists the schedule

**Files:**
- Modify: `src/controller.js:691-703` (`onSaveRecurrence`)
- Modify: `src/views/section.js:276-277`, `src/views/today.js:514` (menu copy)
- Test: none — controller, by project convention.

**Interfaces:**
- Consumes: `onSave({ taskId, recurrence, dueAt, hasTime })` from Task 4.
- Produces: nothing new. `tasks.update` now writes three fields instead of two.

- [ ] **Step 1: Carry `hasTime` into the write and fix the toast**

Replace `onSaveRecurrence` (lines 691-703):

```javascript
	async function onSaveRecurrence({ taskId, recurrence, dueAt, hasTime }) {
		closeRecurrenceEditor({ rerender: false }); // clears inert + sets focus flag
		try {
			// notify → render consumes flag
			await tasks.update(taskId, { recurrence, dueAt, hasTime });
		} catch (err) {
			if (/not found/i.test(err.message)) return; // cascade race
			throw err;
		}
		// A schedule without a repeat is now a valid save, so the toast can no
		// longer assume there is a cadence to describe.
		const message = recurrence
			? `Repeats ${describeRecurrence(recurrence)}`
			: `Due ${hasTime ? formatTimeLabel(dueAt, new Date()) : formatOccurrenceLabel(dueAt, new Date())}`;
		toast.show({ message, durationMs: COMPLETE_TOAST_MS });
	}
```

- [ ] **Step 2: Extend the existing time import**

`src/controller.js:18` already reads `import { formatOccurrenceLabel } from "./utils/time.js";`. **Extend that line — do not add a second import from the same module**, or Biome's `organizeImports` assist will flag it:

```javascript
import { formatOccurrenceLabel, formatTimeLabel } from "./utils/time.js";
```

- [ ] **Step 3: Rename the menu item on both surfaces**

`src/views/section.js:276-277`:

```javascript
			<button class="task-menu__item" type="button" data-action="open-repeat"
				role="menuitem" tabindex="-1" aria-haspopup="dialog">Schedule…</button>
```

`src/views/today.js:514`:

```javascript
			<button class="task-menu__item" type="button" data-action="open-repeat" role="menuitem" tabindex="-1" aria-haspopup="dialog">Schedule…</button>
```

**The `data-action="open-repeat"` value does not change.** It is matched by handlers in `area.js:436` and `today.js:183`, and renaming it would mean touching both for no user-visible gain. Copy changes; identifiers do not.

- [ ] **Step 4: Verify Biome and the suite**

```bash
npm run check && npm run test:run
```

Expected: Biome clean, 221 passed.

- [ ] **Step 5: Verify the round trip in the browser**

Against `ignite-dev`:

1. Open a plain task's ⋯ menu — it reads **Schedule…**.
2. Give it a date and the time `09:00`, cadence *Does not repeat*, Save. The toast reads `Due` plus a time label; the row shows the time.
3. Reload the page. The date **and** the time survive.
4. Reopen the dialog, clear the time field, Save. The row now reads `Today` / `Tomorrow` / a date, with no time.
5. Set a time **and** a weekly repeat, Save, then tick the checkbox to complete an occurrence. The next occurrence keeps the same time of day — the engine already preserves it, and this confirms `hasTime` rode along through `completeOccurrence`.

- [ ] **Step 6: Commit**

```bash
git add src/controller.js src/views/section.js src/views/today.js
git commit -m "feat(schedule): persist a task's time of day and rename the menu entry"
```

---

## Task 6: Full-app verification, docs, and invariants

**Files:**
- Modify: `README.md`
- Modify: `C:\Users\Nugget\.claude\projects\C--Users-Nugget-Documents-Development-GitHub-repos-ignite\memory\invariants.md`

- [ ] **Step 1: Run the full gate**

```bash
npm run check && npm run test:run && npm run build
```

Expected: Biome clean, 221 passed / 15 files, build clean.

- [ ] **Step 2: Verify the untimed-sorts-last rule with real data**

Against `ignite-dev`, in one area on one day, create three tasks: one at 09:00, one at 16:00, one with a date and no time. Confirm Today lists them in that order — the untimed one last, not first.

- [ ] **Step 3: Re-run the a11y pass on the dialog**

The dialog gained a field and a radio option, so its axe-clean status is no longer inherited. Run axe scoped to `.repeat-panel` (the documented artifact: `page-has-heading-one` and `landmark-one-main` fire on the inert background under the dialog and are not real defects). Expected: zero violations, zero contrast failures.

Confirm by hand that the new time input is ≥44px tall and that its `<label for="repeat-time">` associates — tab to it and check a screen reader announces "Time".

- [ ] **Step 4: Update the README**

Add scheduling to the feature list, and remove it from the roadmap if it is listed there. Read the surrounding lines first and match their voice — short, plain, no marketing.

- [ ] **Step 5: Record the new invariants**

Append to `memory/invariants.md`, after the *Ignite v3 Plan 1* block:

```markdown
## Ignite v3 Plan 2 — scheduling (2026-08-13)

- **`hasTime` is the only thing separating "due sometime today" from "due at 00:00".** Untimed tasks are stored at LOCAL MIDNIGHT, the same as every pre-v3 `dueAt`. `task.js` picks `formatTimeLabel` vs `formatOccurrenceLabel` from it. Deleting the flag makes every dateless task read `was 00:00` all afternoon again.
- **`sortByDueThenUntimed` compares the CALENDAR DAY first.** The untimed-last rule is scoped to a single day, and this sort runs over `overdue` — which spans weeks — as well as `today`. Drop the day comparison and an untimed task from three weeks ago sorts below this morning's 09:00.
- **`sortByDueThenUntimed` must not fall back to sort stability.** Untimed peers tie-break on `createdAt` ascending, explicitly — stability is engine behaviour, not a guarantee, and without the tie-break the day's order shuffles between renders as unrelated tasks change. The **string** compare is correct only because `createdAt` is always `new Date().toISOString()` (UTC, fixed width). A local-format value in that field breaks it silently.
- **`buildDueAt` runs as an ARGUMENT to `onSave`, so anything it throws fires before `closeRecurrenceEditor` clears `inert`** — wedging the app behind an open dialog that only Escape recovers. This is why `parseDate`/`parseTime` exist and why `isValid()` gates on them rather than trusting the native pickers: both inputs degrade to plain text where unsupported.
- **The dialog's hidden fields carry a local `[hidden] { display: none }` rule in `main.css`.** `.repeat-field` and `.repeat-fieldset` both set `display`, which beats the UA's `[hidden]`. The design-system reset covers this since 2.0.1, but a re-sync must not be able to silently leave hidden repeat controls visible AND keyboard-focusable inside a modal.
- **Open focus goes to `#repeat-date`, not `.repeat-cadence__input`.** That selector returns the first radio whatever is checked, so it parked a weekly task's focus on "Does not repeat" and skipped the two fields above it.
- **The dialog's internal namespace stays `repeat-*`** — `recurrence-dialog.js`, `.repeat-*` CSS, `repeatEditorTaskId`, `body.is-repeat-open`, `data-action="open-repeat"`. Only the user-visible copy says "Schedule". This is deliberate; do not "finish" the rename.
- **`cadence === "none"` returns `null` from `buildRule()`**, and `onSaveRecurrence` must therefore never assume a cadence exists — its toast branches on it. `isValid()` still requires a date in every branch.
- **A task with `hasTime: false` must open the dialog with an EMPTY time field**, never `00:00` — seeding it from the stored midnight would silently pin the task to midnight on the next save.
- **Known, accepted:** `pickNextTask` treats an untimed task as already overdue from 00:01 (its stored midnight is behind `now`). Pre-existing and uniform before `hasTime` existed. Left for Plan 3, which replaces the function.
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: describe scheduling in the README"
```

- [ ] **Step 7: Open the PR**

`main` is protected — this lands via PR, and CI (`verify`) must be green before merge.

```bash
git push -u origin feat/ignite-v3-scheduling
```

---

## Self-Review

**Spec coverage.** §6.1 `hasTime` → Task 1, including the no-migration claim, which Task 1 proves with a test that deletes the field from a stored row. §6.2 sorting, both the untimed rule and the `createdAt` tie-break → Task 2. §6.3 editor, *Repeat…* → *Schedule…* with date and time on top and repeat beneath → Tasks 4 and 5. D8 "editable on any task" → Task 4's `none` cadence, which is what makes a one-off task datable; this is the part of §6 that is easy to miss, because §6 describes it only as a finding ("a one-off task cannot be given a date at all") rather than as a requirement. §9's `hasTime` coverage of the two formatters → Task 2's grouping test plus Task 3's browser check; the formatters themselves are unchanged, so they need no new unit tests beyond the ones asserting which is chosen.

**Not in this plan, by design:** `groupTasksForFocus`, `formatDayGreeting`, `summariseDay`, `areaForTask` — all Plan 3 (§3, §7). The recurrence engine — verified untouched-by-necessity in the spec's stress test.

**Placeholder scan.** No TBDs. Every code step carries the actual code. Every browser check names what to look at and what should be true.

**Type consistency.** `hasTime` is boolean everywhere: `BOOL_FIELDS` (Task 1) → `sortByDueThenUntimed` (Task 2) → `task.js` (Task 3) → the `onSave` payload (Task 4) → `tasks.update` (Task 5). `sortByDueThenUntimed` is spelled identically in Tasks 2 and 6. `recurrence: null` is produced in Task 4 and consumed in Task 5.

**Test-count arithmetic:** 210 baseline → 214 after Task 1 (+4) → 221 after Task 2 (+7) → 221 through Task 6. Tasks 3, 4 and 5 touch views and the controller, which have no unit coverage by design.

**Stress test (2026-08-13).** Five findings folded in: the day-first comparator (§6.2 scopes untimed-last to a single day, and this sort also runs over the multi-day Overdue bucket); `parseDate`/`parseTime` closing a `RangeError` path that wedges the app behind an inert background; open-focus moved to the date field; the `[hidden]` rule restated locally so the dialog does not depend on a design-system rule for correctness; and the `createdAt` string-compare documented. Security and privacy passes were clean — escaping is preserved at every interpolation site, `hasTime` is coerced to a real boolean by `BOOL_FIELDS` so imported data cannot smuggle a truthy non-boolean, and nothing here adds a network call.
