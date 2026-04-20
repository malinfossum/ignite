# Ignite Milestone 1 — Scaffold + Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure data layer — IndexedDB wrapper, model factories (areas / sections / tasks / settings), recurrence pure functions, Focus-area seed — all under unit test, with no UI code yet.

**Architecture:** Model-only slice of the Ignite MVC. Vanilla ES modules under `src/model/` and `src/utils/`. Model factories return `{ subscribe, ... CRUD ... }` using the subscribe/notify pattern from Malin's CLAUDE.md. `recurrence.js` is side-effect-free. `db.js` is a thin promise wrapper over IndexedDB. No DOM, no Service Worker, no routing.

**Tech Stack:** Vanilla JS (ES modules), Vite 8.0.9, IndexedDB. New this milestone: Vitest (unit test runner) + fake-indexeddb (Node polyfill for IDB in tests).

**Preconditions:**
- Scaffold committed (`2769640` on `main`).
- `npm run build` and `npx biome check .` are green.
- No `src/model/`, `src/utils/`, or `tests/` directory exists yet.
- Malin's CLAUDE.md rules apply: **ask before installing any package, ask before every git commit, never touch `base.css`.**

**Out of scope for M1:** Any view, controller, Service Worker, notification scheduling, routing, CSS. Those are Milestones 2+.

**Source of truth:** `docs/superpowers/specs/2026-04-20-ignite-design.md`.

---

## File Structure

**Create:**
- `vitest.config.js` — test runner config
- `tests/setup.js` — loads `fake-indexeddb/auto` before each test file
- `tests/unit/id.test.js`
- `src/utils/id.js` — `uuid()` wrapper around `crypto.randomUUID()`
- `tests/unit/recurrence.test.js`
- `src/model/recurrence.js` — pure `nextOccurrence(rule, fromDate)` for daily / weekly / monthly / yearly
- `tests/unit/db.test.js`
- `src/model/db.js` — `openDB(name?)` returning a promise wrapper with `get / getAll / getByIndex / put / delete / close`
- `tests/unit/areas.test.js`
- `src/model/areas.js` — `createAreaModel(db)`; seeds Focus; blocks deleting Focus
- `tests/unit/sections.test.js`
- `src/model/sections.js` — `createSectionModel(db)`
- `tests/unit/tasks.test.js`
- `src/model/tasks.js` — `createTaskModel(db)`
- `tests/unit/settings.test.js`
- `src/model/settings.js` — `createSettingsModel(db)` (singleton record `id: "app"`)

**Modify:**
- `package.json` — add `vitest` + `fake-indexeddb` devDeps, add `test` and `test:run` scripts
- `src/app.js` — wire up `openDB` + model construction, log a sanity line confirming Focus seeded

One file = one responsibility. Each model file stays under ~100 lines. All cross-model logic (e.g. inheriting `area.critical` onto a new task) lives in the controller in M2, not here.

---

## Ground Rules for the Executor

1. **TDD, always.** Write the failing test → run it → implement → run it green → commit. No exceptions.
2. **Ask Malin before every `npm install` and every `git commit`.** Her CLAUDE.md is explicit about this. The plan shows the exact command; you propose, she approves, then you run.
3. **Explain the *why* when implementing, not just the *what*.** Malin is an active student.
4. **Do not edit `base.css`.**
5. **If a step surprises you, stop and ask.** Do not silently restructure.

---

## Task 1 — Install Vitest + fake-indexeddb, add config

**Why:** Milestone 1 is entirely about testable pure logic and a thin IDB wrapper. Tests run in Node (fast, deterministic) via Vitest. `fake-indexeddb/auto` replaces `globalThis.indexedDB` with an in-memory implementation so we can unit-test the data layer without a browser.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`
- Create: `tests/setup.js`

(No `biome.json` edit needed — the existing config formats everything except `dist/` and `node_modules/`.)

- [ ] **Step 1: Propose install to Malin, wait for approval**

Say to Malin:
> I need to add two dev dependencies: `vitest` (test runner, pairs natively with Vite) and `fake-indexeddb` (in-memory IndexedDB for Node tests). Command: `npm install --save-dev vitest fake-indexeddb`. OK to run?

Do not proceed until she confirms.

- [ ] **Step 2: Install the packages (after approval)**

Run: `npm install --save-dev vitest fake-indexeddb`
Expected: `package.json` updated, `package-lock.json` updated, no errors.

- [ ] **Step 3: Add test scripts to `package.json`**

Edit the `"scripts"` block so it reads:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "format": "biome format --write .",
  "lint": "biome lint .",
  "check": "biome check .",
  "test": "vitest",
  "test:run": "vitest run"
}
```

`vitest` (default) runs in watch mode during dev. `vitest run` is the one-shot for CI / sanity checks.

- [ ] **Step 4: Create `vitest.config.js`**

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["./tests/setup.js"],
		include: ["tests/**/*.test.js"],
	},
});
```

- [ ] **Step 5: Create `tests/setup.js`**

```js
// Polyfills browser IndexedDB in the Node test environment.
// Loaded once per test file before the test body runs.
import "fake-indexeddb/auto";
```

- [ ] **Step 6: Sanity-check — run vitest with zero tests**

Run: `npm run test:run`
Expected: Vitest exits with "No test files found" (or similar) but no error — config parses cleanly.

- [ ] **Step 7: Verify Biome still passes**

Run: `npx biome check .`
Expected: no errors. If Biome flags `tests/setup.js` or `vitest.config.js`, run `npx biome format --write .` to fix, then `npx biome check .` again.

- [ ] **Step 8: Propose commit to Malin, wait for approval, then commit**

Proposed message:
```
chore: add vitest + fake-indexeddb for unit tests
```

On approval, run:
```bash
git add package.json package-lock.json vitest.config.js tests/setup.js
git commit -m "chore: add vitest + fake-indexeddb for unit tests"
```

---

## Task 2 — UUID helper (`src/utils/id.js`)

**Why:** Every record (area, section, task) needs a stable id. `crypto.randomUUID()` is built into modern browsers and Node 19+, so we wrap it in a one-liner for a single import path.

**Files:**
- Create: `src/utils/id.js`
- Create: `tests/unit/id.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/id.test.js`:

```js
import { describe, expect, it } from "vitest";
import { uuid } from "../../src/utils/id.js";

describe("uuid", () => {
	it("returns a string matching the standard UUID shape", () => {
		expect(uuid()).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
	});

	it("returns a different value on each call", () => {
		expect(uuid()).not.toBe(uuid());
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/id.test.js`
Expected: FAIL — `Failed to resolve import "../../src/utils/id.js"`.

- [ ] **Step 3: Implement `src/utils/id.js`**

```js
// Thin wrapper so every caller imports from one place.
// Swap-able later if we ever need a custom id format.
export function uuid() {
	return crypto.randomUUID();
}
```

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/id.test.js`
Expected: 2 passed.

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): add uuid helper
```

On approval:
```bash
git add src/utils/id.js tests/unit/id.test.js
git commit -m "feat(model): add uuid helper"
```

---

## Task 3 — Recurrence: daily

**Why:** Recurrence math is the only non-trivial pure logic in the model layer. Isolating it in one file with no I/O lets us unit-test every edge case cheaply. We build it one rule at a time (daily → weekly → monthly → yearly) so each commit covers one behavior.

**Files:**
- Create: `src/model/recurrence.js`
- Create: `tests/unit/recurrence.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/recurrence.test.js`:

```js
import { describe, expect, it } from "vitest";
import { nextOccurrence } from "../../src/model/recurrence.js";

describe("nextOccurrence — daily", () => {
	it("advances the date by one day, preserving time-of-day", () => {
		const from = new Date("2026-04-20T09:30:00");
		const next = nextOccurrence({ type: "daily" }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-04-21T09:30:00").toISOString(),
		);
	});

	it("rolls over month boundaries", () => {
		const from = new Date("2026-04-30T08:00:00");
		const next = nextOccurrence({ type: "daily" }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-05-01T08:00:00").toISOString(),
		);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/recurrence.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement minimum — just daily**

Create `src/model/recurrence.js`:

```js
// Pure functions. No I/O. Given a recurrence rule and a reference date,
// returns the next Date the task should fire. Model factories call this
// on complete-of-recurring-task to roll the dueAt forward.

export function nextOccurrence(rule, fromDate) {
	switch (rule.type) {
		case "daily":
			return addDays(fromDate, 1);
		default:
			throw new Error(`Unknown recurrence type: ${rule.type}`);
	}
}

function addDays(d, n) {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}
```

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/recurrence.test.js`
Expected: 2 passed.

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): recurrence — daily
```

On approval:
```bash
git add src/model/recurrence.js tests/unit/recurrence.test.js
git commit -m "feat(model): recurrence — daily"
```

---

## Task 4 — Recurrence: weekly

**Why:** Weekly has to pick the *next* weekday in the configured set. The tricky case: today is in the set — we must still advance to the next matching day, never return today.

**Files:**
- Modify: `src/model/recurrence.js`
- Modify: `tests/unit/recurrence.test.js`

- [ ] **Step 1: Add failing tests to `tests/unit/recurrence.test.js`**

Append at the bottom of the file:

```js
describe("nextOccurrence — weekly", () => {
	// JS Date.getDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
	it("picks the next weekday in the list (simple case)", () => {
		// Mon 2026-04-20, rule = Mon/Wed/Fri → Wed 2026-04-22
		const from = new Date("2026-04-20T09:00:00");
		const next = nextOccurrence(
			{ type: "weekly", weekdays: [1, 3, 5] },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2026-04-22T09:00:00").toISOString(),
		);
	});

	it("wraps across the week", () => {
		// Fri 2026-04-24, rule = Mon → Mon 2026-04-27
		const from = new Date("2026-04-24T09:00:00");
		const next = nextOccurrence({ type: "weekly", weekdays: [1] }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-04-27T09:00:00").toISOString(),
		);
	});

	it("never returns the same day even if today is in the list", () => {
		// Mon 2026-04-20, rule = Mon/Wed → must advance to Wed
		const from = new Date("2026-04-20T09:00:00");
		const next = nextOccurrence(
			{ type: "weekly", weekdays: [1, 3] },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2026-04-22T09:00:00").toISOString(),
		);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/recurrence.test.js`
Expected: 3 failures — "Unknown recurrence type: weekly".

- [ ] **Step 3: Implement weekly**

Replace `src/model/recurrence.js` with:

```js
// Pure functions. No I/O. Given a recurrence rule and a reference date,
// returns the next Date the task should fire.

export function nextOccurrence(rule, fromDate) {
	switch (rule.type) {
		case "daily":
			return addDays(fromDate, 1);
		case "weekly":
			return nextWeekday(fromDate, rule.weekdays);
		default:
			throw new Error(`Unknown recurrence type: ${rule.type}`);
	}
}

function addDays(d, n) {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}

function nextWeekday(from, weekdays) {
	if (!Array.isArray(weekdays) || weekdays.length === 0) {
		throw new Error("weekly recurrence requires weekdays[]");
	}
	for (let i = 1; i <= 7; i++) {
		const candidate = addDays(from, i);
		if (weekdays.includes(candidate.getDay())) return candidate;
	}
	// Unreachable: 7 consecutive days cover every weekday.
	throw new Error("weekly recurrence has no valid weekdays");
}
```

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/recurrence.test.js`
Expected: 5 passed.

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): recurrence — weekly
```

On approval:
```bash
git add src/model/recurrence.js tests/unit/recurrence.test.js
git commit -m "feat(model): recurrence — weekly"
```

---

## Task 5 — Recurrence: monthly (with day-of-month clamp)

**Why:** "Same day next month" is undefined when the next month is shorter (e.g. Jan 31 → Feb). Spec says clamp to the last day of the target month.

**Files:**
- Modify: `src/model/recurrence.js`
- Modify: `tests/unit/recurrence.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/recurrence.test.js`:

```js
describe("nextOccurrence — monthly", () => {
	it("returns the same day of the next month", () => {
		const from = new Date("2026-04-15T10:00:00");
		const next = nextOccurrence({ type: "monthly", day: 15 }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-05-15T10:00:00").toISOString(),
		);
	});

	it("clamps to last day when target month is shorter", () => {
		// Jan 31 → Feb 28 (non-leap year)
		const from = new Date("2027-01-31T10:00:00");
		const next = nextOccurrence({ type: "monthly", day: 31 }, from);
		expect(next.toISOString()).toBe(
			new Date("2027-02-28T10:00:00").toISOString(),
		);
	});

	it("rolls over the year boundary", () => {
		const from = new Date("2026-12-10T10:00:00");
		const next = nextOccurrence({ type: "monthly", day: 10 }, from);
		expect(next.toISOString()).toBe(
			new Date("2027-01-10T10:00:00").toISOString(),
		);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/recurrence.test.js`
Expected: 3 new failures.

- [ ] **Step 3: Implement monthly**

Replace `src/model/recurrence.js` with:

```js
// Pure functions. No I/O. Given a recurrence rule and a reference date,
// returns the next Date the task should fire.

export function nextOccurrence(rule, fromDate) {
	switch (rule.type) {
		case "daily":
			return addDays(fromDate, 1);
		case "weekly":
			return nextWeekday(fromDate, rule.weekdays);
		case "monthly":
			return nextMonth(fromDate, rule.day);
		default:
			throw new Error(`Unknown recurrence type: ${rule.type}`);
	}
}

function addDays(d, n) {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}

function nextWeekday(from, weekdays) {
	if (!Array.isArray(weekdays) || weekdays.length === 0) {
		throw new Error("weekly recurrence requires weekdays[]");
	}
	for (let i = 1; i <= 7; i++) {
		const candidate = addDays(from, i);
		if (weekdays.includes(candidate.getDay())) return candidate;
	}
	throw new Error("weekly recurrence has no valid weekdays");
}

function nextMonth(from, targetDay) {
	// JS Date normalizes month values > 11 into the following year.
	const year = from.getFullYear();
	const month = from.getMonth() + 1;
	const lastDayOfNextMonth = new Date(year, month + 1, 0).getDate();
	const day = Math.min(targetDay, lastDayOfNextMonth);
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
```

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/recurrence.test.js`
Expected: 8 passed.

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): recurrence — monthly with day-of-month clamp
```

On approval:
```bash
git add src/model/recurrence.js tests/unit/recurrence.test.js
git commit -m "feat(model): recurrence — monthly with day-of-month clamp"
```

---

## Task 6 — Recurrence: yearly (with Feb 29 → Feb 28 clamp)

**Why:** Same shape as monthly — clamp when the target date doesn't exist in the next year (Feb 29 in a non-leap year).

**Note:** Rule stores `month` as 1-indexed (April = 4) for human readability. JS Date uses 0-indexed internally. The translation happens inside `nextYear` only.

**Files:**
- Modify: `src/model/recurrence.js`
- Modify: `tests/unit/recurrence.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/recurrence.test.js`:

```js
describe("nextOccurrence — yearly", () => {
	it("returns the same month+day next year", () => {
		const from = new Date("2026-04-07T09:00:00");
		const next = nextOccurrence(
			{ type: "yearly", month: 4, day: 7 },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2027-04-07T09:00:00").toISOString(),
		);
	});

	it("clamps Feb 29 to Feb 28 in non-leap years", () => {
		// 2028 is a leap year. From Feb 29 2028, next year is 2029 (non-leap)
		// → should clamp to Feb 28.
		const from = new Date("2028-02-29T09:00:00");
		const next = nextOccurrence(
			{ type: "yearly", month: 2, day: 29 },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2029-02-28T09:00:00").toISOString(),
		);
	});

	it("throws on unknown recurrence type", () => {
		expect(() =>
			nextOccurrence({ type: "garbage" }, new Date("2026-04-20")),
		).toThrow(/Unknown recurrence type/);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/recurrence.test.js`
Expected: 2 new failures (the "throws" test already passes, but include it to lock the behavior).

- [ ] **Step 3: Implement yearly**

Replace `src/model/recurrence.js` with:

```js
// Pure functions. No I/O. Given a recurrence rule and a reference date,
// returns the next Date the task should fire.
//
// Rule shapes:
//   { type: "daily" }
//   { type: "weekly", weekdays: [0..6] }   // 0 = Sunday
//   { type: "monthly", day: 1..31 }        // clamped to last day of target month
//   { type: "yearly", month: 1..12, day: 1..31 }

export function nextOccurrence(rule, fromDate) {
	switch (rule.type) {
		case "daily":
			return addDays(fromDate, 1);
		case "weekly":
			return nextWeekday(fromDate, rule.weekdays);
		case "monthly":
			return nextMonth(fromDate, rule.day);
		case "yearly":
			return nextYear(fromDate, rule.month, rule.day);
		default:
			throw new Error(`Unknown recurrence type: ${rule.type}`);
	}
}

function addDays(d, n) {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}

function nextWeekday(from, weekdays) {
	if (!Array.isArray(weekdays) || weekdays.length === 0) {
		throw new Error("weekly recurrence requires weekdays[]");
	}
	for (let i = 1; i <= 7; i++) {
		const candidate = addDays(from, i);
		if (weekdays.includes(candidate.getDay())) return candidate;
	}
	throw new Error("weekly recurrence has no valid weekdays");
}

function nextMonth(from, targetDay) {
	const year = from.getFullYear();
	const month = from.getMonth() + 1;
	const lastDayOfNextMonth = new Date(year, month + 1, 0).getDate();
	const day = Math.min(targetDay, lastDayOfNextMonth);
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

function nextYear(from, ruleMonth1Based, targetDay) {
	const year = from.getFullYear() + 1;
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

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/recurrence.test.js`
Expected: 11 passed.

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): recurrence — yearly with leap-day clamp
```

On approval:
```bash
git add src/model/recurrence.js tests/unit/recurrence.test.js
git commit -m "feat(model): recurrence — yearly with leap-day clamp"
```

---

## Task 7 — IndexedDB wrapper: open + schema v1

**Why:** Raw IndexedDB's callback API is painful. A thin promise wrapper (`openDB`, `get`, `put`, `delete`, `getAll`, `getByIndex`) lets every model look synchronous-ish and hides the version/upgrade dance. Schema (stores + indexes) is defined in one place so it can evolve with a `version` bump later.

**Files:**
- Create: `src/model/db.js`
- Create: `tests/unit/db.test.js`

- [ ] **Step 1: Write failing tests for open + schema**

Create `tests/unit/db.test.js`:

```js
import { afterEach, describe, expect, it } from "vitest";
import { openDB } from "../../src/model/db.js";

// fake-indexeddb is loaded in tests/setup.js. We use a unique db name per
// test so state never leaks between cases.
let openHandles = [];
async function fresh(name = `ignite-test-${crypto.randomUUID()}`) {
	const db = await openDB(name);
	openHandles.push(db);
	return db;
}

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

describe("openDB — schema v1", () => {
	it("creates the four object stores", async () => {
		const db = await fresh();
		const names = Array.from(db.raw.objectStoreNames).sort();
		expect(names).toEqual(["areas", "sections", "settings", "tasks"]);
	});

	it("creates indexes on the tasks store", async () => {
		const db = await fresh();
		const tx = db.raw.transaction("tasks", "readonly");
		const store = tx.objectStore("tasks");
		const indexNames = Array.from(store.indexNames).sort();
		expect(indexNames).toEqual([
			"completed",
			"dueAt",
			"sectionId",
			"starred",
		]);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/db.test.js`
Expected: FAIL — `Failed to resolve import "../../src/model/db.js"`.

- [ ] **Step 3: Implement `openDB` + schema**

Create `src/model/db.js`:

```js
// Thin promise wrapper over IndexedDB. Exposes:
//   openDB(name?) → Promise<DBWrapper>
//   wrapper.get / getAll / getByIndex / put / delete / close / raw
//
// Schema version is baked into `CURRENT_VERSION`. Bump it and extend
// `runUpgrade` when a new store or index is needed later.

const DEFAULT_NAME = "ignite";
const CURRENT_VERSION = 1;

export function openDB(name = DEFAULT_NAME) {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, CURRENT_VERSION);
		req.onupgradeneeded = (event) => {
			runUpgrade(req.result, event.oldVersion);
		};
		req.onsuccess = () => resolve(wrap(req.result));
		req.onerror = () => reject(req.error);
		req.onblocked = () =>
			reject(new Error(`openDB blocked for "${name}"`));
	});
}

function runUpgrade(db, oldVersion) {
	if (oldVersion < 1) {
		db.createObjectStore("areas", { keyPath: "id" });
		db.createObjectStore("sections", { keyPath: "id" });
		const tasks = db.createObjectStore("tasks", { keyPath: "id" });
		tasks.createIndex("sectionId", "sectionId");
		tasks.createIndex("dueAt", "dueAt");
		tasks.createIndex("completed", "completed");
		tasks.createIndex("starred", "starred");
		db.createObjectStore("settings", { keyPath: "id" });
	}
}

function wrap(db) {
	return {
		raw: db,
		close: () => db.close(),
		// CRUD methods added in Task 8.
	};
}
```

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/db.test.js`
Expected: 2 passed.

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): openDB with schema v1
```

On approval:
```bash
git add src/model/db.js tests/unit/db.test.js
git commit -m "feat(model): openDB with schema v1"
```

---

## Task 8 — IndexedDB wrapper: CRUD methods

**Why:** Now that the DB opens with the right schema, the wrapper needs the five methods every model will call: `get`, `getAll`, `getByIndex`, `put`, `delete`. All promise-based.

**Files:**
- Modify: `src/model/db.js`
- Modify: `tests/unit/db.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/db.test.js`:

```js
describe("DBWrapper CRUD", () => {
	it("put then get returns the record", async () => {
		const db = await fresh();
		await db.put("areas", {
			id: "a1",
			name: "Test",
			icon: "",
			critical: false,
			order: 0,
		});
		const read = await db.get("areas", "a1");
		expect(read.name).toBe("Test");
	});

	it("getAll returns every record in a store", async () => {
		const db = await fresh();
		await db.put("areas", {
			id: "a1",
			name: "One",
			icon: "",
			critical: false,
			order: 0,
		});
		await db.put("areas", {
			id: "a2",
			name: "Two",
			icon: "",
			critical: false,
			order: 1,
		});
		const all = await db.getAll("areas");
		expect(all.length).toBe(2);
	});

	it("delete removes a record", async () => {
		const db = await fresh();
		await db.put("areas", {
			id: "a1",
			name: "Test",
			icon: "",
			critical: false,
			order: 0,
		});
		await db.delete("areas", "a1");
		expect(await db.get("areas", "a1")).toBeUndefined();
	});

	it("getByIndex filters records by an indexed field", async () => {
		const db = await fresh();
		await db.put("tasks", {
			id: "t1",
			sectionId: "s1",
			title: "A",
			completed: 0,
			starred: 0,
			createdAt: new Date().toISOString(),
			order: 0,
		});
		await db.put("tasks", {
			id: "t2",
			sectionId: "s2",
			title: "B",
			completed: 0,
			starred: 0,
			createdAt: new Date().toISOString(),
			order: 0,
		});
		const inS1 = await db.getByIndex("tasks", "sectionId", "s1");
		expect(inS1.map((t) => t.id)).toEqual(["t1"]);
	});
});
```

> **Note on `completed`/`starred` values:** IndexedDB indexes can't key on booleans directly — we use `0`/`1` as integer stand-ins throughout the data layer. Models will expose/accept booleans at their public API and convert internally (Task 12).

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/db.test.js`
Expected: 4 failures — `db.put is not a function`.

- [ ] **Step 3: Implement CRUD methods**

Replace `src/model/db.js` with:

```js
// Thin promise wrapper over IndexedDB. Exposes:
//   openDB(name?) → Promise<DBWrapper>
//   wrapper.get(store, id)
//   wrapper.getAll(store)
//   wrapper.getByIndex(store, indexName, value)
//   wrapper.put(store, record)
//   wrapper.delete(store, id)
//   wrapper.close()
//   wrapper.raw       // underlying IDBDatabase — for tests/diagnostics only

const DEFAULT_NAME = "ignite";
const CURRENT_VERSION = 1;

export function openDB(name = DEFAULT_NAME) {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, CURRENT_VERSION);
		req.onupgradeneeded = (event) => {
			runUpgrade(req.result, event.oldVersion);
		};
		req.onsuccess = () => resolve(wrap(req.result));
		req.onerror = () => reject(req.error);
		req.onblocked = () =>
			reject(new Error(`openDB blocked for "${name}"`));
	});
}

function runUpgrade(db, oldVersion) {
	if (oldVersion < 1) {
		db.createObjectStore("areas", { keyPath: "id" });
		db.createObjectStore("sections", { keyPath: "id" });
		const tasks = db.createObjectStore("tasks", { keyPath: "id" });
		tasks.createIndex("sectionId", "sectionId");
		tasks.createIndex("dueAt", "dueAt");
		tasks.createIndex("completed", "completed");
		tasks.createIndex("starred", "starred");
		db.createObjectStore("settings", { keyPath: "id" });
	}
}

function wrap(db) {
	const run = (storeName, mode, fn) =>
		new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, mode);
			const store = tx.objectStore(storeName);
			const req = fn(store);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});

	return {
		raw: db,
		close: () => db.close(),
		get: (store, id) => run(store, "readonly", (s) => s.get(id)),
		getAll: (store) => run(store, "readonly", (s) => s.getAll()),
		getByIndex: (store, indexName, value) =>
			run(store, "readonly", (s) => s.index(indexName).getAll(value)),
		put: (store, record) => run(store, "readwrite", (s) => s.put(record)),
		delete: (store, id) => run(store, "readwrite", (s) => s.delete(id)),
	};
}
```

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/db.test.js`
Expected: 6 passed.

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): db wrapper CRUD (get/getAll/getByIndex/put/delete)
```

On approval:
```bash
git add src/model/db.js tests/unit/db.test.js
git commit -m "feat(model): db wrapper CRUD (get/getAll/getByIndex/put/delete)"
```

---

## Task 9 — Areas model: base CRUD + subscribe/notify

**Why:** This is the first model factory — sets the pattern every other model will copy. `subscribe(fn)` returns an unsubscribe function; every mutator calls `notify()` after the write succeeds. Views in M2 will use `subscribe` to trigger re-render.

**Files:**
- Create: `src/model/areas.js`
- Create: `tests/unit/areas.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/areas.test.js`:

```js
import { afterEach, describe, expect, it } from "vitest";
import { createAreaModel } from "../../src/model/areas.js";
import { openDB } from "../../src/model/db.js";

let openHandles = [];
async function freshModel() {
	const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
	openHandles.push(db);
	return { db, model: await createAreaModel(db) };
}

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

describe("createAreaModel — CRUD", () => {
	it("create adds an area with a uuid, returns the record", async () => {
		const { model } = await freshModel();
		const created = await model.create({ name: "Projects" });
		expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(created.name).toBe("Projects");
	});

	it("list returns all created areas", async () => {
		const { model } = await freshModel();
		await model.create({ name: "Projects" });
		await model.create({ name: "Shopping" });
		const all = await model.list();
		expect(all.map((a) => a.name).sort()).toEqual([
			"Projects",
			"Shopping",
		]);
	});

	it("update patches fields", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "Original" });
		await model.update(a.id, { name: "Renamed" });
		const fetched = (await model.list()).find((x) => x.id === a.id);
		expect(fetched.name).toBe("Renamed");
	});

	it("remove deletes a user area", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "Tmp" });
		await model.remove(a.id);
		const fetched = (await model.list()).find((x) => x.id === a.id);
		expect(fetched).toBeUndefined();
	});
});

describe("createAreaModel — subscribe/notify", () => {
	it("notifies subscribers on create / update / remove", async () => {
		const { model } = await freshModel();
		let calls = 0;
		const unsubscribe = model.subscribe(() => {
			calls++;
		});
		const a = await model.create({ name: "X" });
		await model.update(a.id, { name: "Y" });
		await model.remove(a.id);
		unsubscribe();
		await model.create({ name: "ShouldNotNotify" });
		expect(calls).toBe(3);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/areas.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement areas model (no Focus seed yet)**

Create `src/model/areas.js`:

```js
import { uuid } from "../utils/id.js";

// createAreaModel(db) → Promise<AreaModel>
//
//   AreaModel = {
//     subscribe(fn) → unsubscribe(),
//     list() → Promise<Area[]>,
//     create({ name, icon?, critical? }) → Promise<Area>,
//     update(id, patch) → Promise<Area>,
//     remove(id) → Promise<void>,
//   }
//
// Subscribe/notify pattern: every mutation writes the DB, then notifies.

export async function createAreaModel(db) {
	const listeners = new Set();
	const notify = () => {
		for (const fn of listeners) fn();
	};

	return {
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},

		list() {
			return db.getAll("areas");
		},

		async create({ name, icon = "", critical = false }) {
			const all = await db.getAll("areas");
			const order = all.length;
			const area = { id: uuid(), name, icon, critical, order };
			await db.put("areas", area);
			notify();
			return area;
		},

		async update(id, patch) {
			const existing = await db.get("areas", id);
			if (!existing) throw new Error(`Area not found: ${id}`);
			const updated = { ...existing, ...patch, id: existing.id };
			await db.put("areas", updated);
			notify();
			return updated;
		},

		async remove(id) {
			await db.delete("areas", id);
			notify();
		},
	};
}
```

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/areas.test.js`
Expected: 5 passed. (Focus-seed behavior is intentionally deferred to Task 10 — the tests in this task only check user-created areas, so they pass without the seed.)

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): areas — CRUD + subscribe/notify
```

On approval:
```bash
git add src/model/areas.js tests/unit/areas.test.js
git commit -m "feat(model): areas — CRUD + subscribe/notify"
```

---

## Task 10 — Areas model: Focus seed + undeletable

**Why:** Spec: "The `Focus` area is built-in and always exists. Cannot be deleted." Seed on first construction (idempotent — if Focus already exists, leave it alone). Block `remove("focus")`.

**Files:**
- Modify: `src/model/areas.js`
- Modify: `tests/unit/areas.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/areas.test.js`:

```js
describe("createAreaModel — Focus seed", () => {
	it("seeds the Focus area on first construction", async () => {
		const { model } = await freshModel();
		const all = await model.list();
		const focus = all.find((a) => a.id === "focus");
		expect(focus).toBeDefined();
		expect(focus.name).toBe("Focus");
	});

	it("is idempotent — constructing twice does not duplicate Focus", async () => {
		const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
		openHandles.push(db);
		await createAreaModel(db);
		const model2 = await createAreaModel(db);
		const all = await model2.list();
		const focuses = all.filter((a) => a.id === "focus");
		expect(focuses.length).toBe(1);
	});

	it("refuses to delete the Focus area", async () => {
		const { model } = await freshModel();
		await expect(model.remove("focus")).rejects.toThrow(
			/cannot delete focus/i,
		);
		const stillThere = (await model.list()).find((a) => a.id === "focus");
		expect(stillThere).toBeDefined();
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/areas.test.js`
Expected: 3 new failures.

- [ ] **Step 3: Implement Focus seed + delete guard**

Replace `src/model/areas.js` with:

```js
import { uuid } from "../utils/id.js";

const FOCUS_ID = "focus";
const FOCUS_DEFAULTS = {
	id: FOCUS_ID,
	name: "Focus",
	icon: "🔥",
	critical: false,
	order: 0,
};

export async function createAreaModel(db) {
	const listeners = new Set();
	const notify = () => {
		for (const fn of listeners) fn();
	};

	await ensureFocus(db);

	return {
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},

		list() {
			return db.getAll("areas");
		},

		async create({ name, icon = "", critical = false }) {
			const all = await db.getAll("areas");
			const order = all.length;
			const area = { id: uuid(), name, icon, critical, order };
			await db.put("areas", area);
			notify();
			return area;
		},

		async update(id, patch) {
			const existing = await db.get("areas", id);
			if (!existing) throw new Error(`Area not found: ${id}`);
			const updated = { ...existing, ...patch, id: existing.id };
			await db.put("areas", updated);
			notify();
			return updated;
		},

		async remove(id) {
			if (id === FOCUS_ID) {
				throw new Error("Cannot delete Focus area");
			}
			await db.delete("areas", id);
			notify();
		},
	};
}

async function ensureFocus(db) {
	const existing = await db.get("areas", FOCUS_ID);
	if (!existing) await db.put("areas", { ...FOCUS_DEFAULTS });
}
```

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/areas.test.js`
Expected: 8 passed.

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): seed Focus area, block delete
```

On approval:
```bash
git add src/model/areas.js tests/unit/areas.test.js
git commit -m "feat(model): seed Focus area, block delete"
```

---

## Task 11 — Sections model

**Why:** Sections are owned by areas. API mirrors areas but adds `areaId` as required on create, and a helper `listByArea(areaId)` for the Area view to call later. `collapsed` defaults to `false`.

**Files:**
- Create: `src/model/sections.js`
- Create: `tests/unit/sections.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/sections.test.js`:

```js
import { afterEach, describe, expect, it } from "vitest";
import { openDB } from "../../src/model/db.js";
import { createSectionModel } from "../../src/model/sections.js";

let openHandles = [];
async function freshModel() {
	const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
	openHandles.push(db);
	return { db, model: await createSectionModel(db) };
}

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

describe("createSectionModel", () => {
	it("create persists a section with defaults", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Daily" });
		expect(s.id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(s.areaId).toBe("focus");
		expect(s.name).toBe("Daily");
		expect(s.collapsed).toBe(false);
		expect(typeof s.order).toBe("number");
	});

	it("create requires areaId", async () => {
		const { model } = await freshModel();
		await expect(model.create({ name: "NoArea" })).rejects.toThrow(
			/areaId/i,
		);
	});

	it("listByArea returns only sections in that area, ordered", async () => {
		const { model } = await freshModel();
		const a = await model.create({ areaId: "focus", name: "A" });
		const b = await model.create({ areaId: "focus", name: "B" });
		await model.create({ areaId: "other", name: "C" });
		const focusOnly = await model.listByArea("focus");
		expect(focusOnly.map((s) => s.id)).toEqual([a.id, b.id]);
	});

	it("update patches fields and notifies", async () => {
		const { model } = await freshModel();
		let calls = 0;
		model.subscribe(() => {
			calls++;
		});
		const s = await model.create({ areaId: "focus", name: "Old" });
		await model.update(s.id, { collapsed: true, name: "New" });
		const fetched = (await model.listByArea("focus")).find(
			(x) => x.id === s.id,
		);
		expect(fetched.collapsed).toBe(true);
		expect(fetched.name).toBe("New");
		expect(calls).toBe(2); // create + update
	});

	it("remove deletes and notifies", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Tmp" });
		await model.remove(s.id);
		const fetched = (await model.listByArea("focus")).find(
			(x) => x.id === s.id,
		);
		expect(fetched).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/sections.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement sections model**

Create `src/model/sections.js`:

```js
import { uuid } from "../utils/id.js";

// createSectionModel(db) → Promise<SectionModel>
//
// SectionModel = {
//   subscribe(fn) → unsubscribe,
//   list() → Promise<Section[]>,
//   listByArea(areaId) → Promise<Section[]>  // ordered by `order`
//   create({ areaId, name, collapsed? }) → Promise<Section>,
//   update(id, patch) → Promise<Section>,
//   remove(id) → Promise<void>,
// }

export async function createSectionModel(db) {
	const listeners = new Set();
	const notify = () => {
		for (const fn of listeners) fn();
	};

	return {
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},

		list() {
			return db.getAll("sections");
		},

		async listByArea(areaId) {
			const all = await db.getAll("sections");
			return all
				.filter((s) => s.areaId === areaId)
				.sort((a, b) => a.order - b.order);
		},

		async create({ areaId, name, collapsed = false }) {
			if (!areaId) throw new Error("create(section): areaId is required");
			const siblings = (await db.getAll("sections")).filter(
				(s) => s.areaId === areaId,
			);
			const order = siblings.length;
			const section = { id: uuid(), areaId, name, collapsed, order };
			await db.put("sections", section);
			notify();
			return section;
		},

		async update(id, patch) {
			const existing = await db.get("sections", id);
			if (!existing) throw new Error(`Section not found: ${id}`);
			const updated = { ...existing, ...patch, id: existing.id };
			await db.put("sections", updated);
			notify();
			return updated;
		},

		async remove(id) {
			await db.delete("sections", id);
			notify();
		},
	};
}
```

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/sections.test.js`
Expected: 5 passed.

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): sections — CRUD + listByArea
```

On approval:
```bash
git add src/model/sections.js tests/unit/sections.test.js
git commit -m "feat(model): sections — CRUD + listByArea"
```

---

## Task 12 — Tasks model

**Why:** The main record type. Stores boolean flags as `0`/`1` internally (IndexedDB index limitation), but converts at the model boundary so callers always see booleans. Create accepts all metadata fields but none are required except `sectionId` and `title`.

**Files:**
- Create: `src/model/tasks.js`
- Create: `tests/unit/tasks.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/tasks.test.js`:

```js
import { afterEach, describe, expect, it } from "vitest";
import { openDB } from "../../src/model/db.js";
import { createTaskModel } from "../../src/model/tasks.js";

let openHandles = [];
async function freshModel() {
	const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
	openHandles.push(db);
	return { db, model: await createTaskModel(db) };
}

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

describe("createTaskModel — create", () => {
	it("persists a task with defaults", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Call mom" });
		expect(t.id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(t.title).toBe("Call mom");
		expect(t.completed).toBe(false);
		expect(t.starred).toBe(false);
		expect(t.critical).toBe(false);
		expect(t.dueAt).toBeNull();
		expect(t.recurrence).toBeNull();
		expect(t.leadTime).toBe(0);
		expect(t.scheduledTags).toEqual([]);
		expect(t.notes).toBe("");
		expect(typeof t.createdAt).toBe("string");
	});

	it("requires sectionId and title", async () => {
		const { model } = await freshModel();
		await expect(model.create({ title: "X" })).rejects.toThrow(
			/sectionId/i,
		);
		await expect(model.create({ sectionId: "s1" })).rejects.toThrow(
			/title/i,
		);
	});

	it("accepts explicit metadata on create", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "Meeting",
			starred: true,
			critical: true,
			dueAt: "2026-04-21T10:00:00.000Z",
			leadTime: 15,
			notes: "bring laptop",
		});
		expect(t.starred).toBe(true);
		expect(t.critical).toBe(true);
		expect(t.dueAt).toBe("2026-04-21T10:00:00.000Z");
		expect(t.leadTime).toBe(15);
		expect(t.notes).toBe("bring laptop");
	});
});

describe("createTaskModel — queries", () => {
	it("listBySection returns only that section's tasks, ordered", async () => {
		const { model } = await freshModel();
		const a = await model.create({ sectionId: "s1", title: "A" });
		const b = await model.create({ sectionId: "s1", title: "B" });
		await model.create({ sectionId: "s2", title: "C" });
		const got = await model.listBySection("s1");
		expect(got.map((t) => t.id)).toEqual([a.id, b.id]);
	});

	it("exposes booleans on read even though they are stored as 0/1", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "T",
			starred: true,
		});
		const [reread] = await model.listBySection("s1");
		expect(reread.starred).toBe(true);
		expect(reread.id).toBe(t.id);
	});
});

describe("createTaskModel — update / toggle / remove", () => {
	it("update patches fields", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Old" });
		await model.update(t.id, { title: "New", starred: true });
		const [got] = await model.listBySection("s1");
		expect(got.title).toBe("New");
		expect(got.starred).toBe(true);
	});

	it("toggleCompleted flips the flag", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "T" });
		await model.toggleCompleted(t.id);
		let [got] = await model.listBySection("s1");
		expect(got.completed).toBe(true);
		await model.toggleCompleted(t.id);
		[got] = await model.listBySection("s1");
		expect(got.completed).toBe(false);
	});

	it("remove deletes the task", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "T" });
		await model.remove(t.id);
		expect((await model.listBySection("s1")).length).toBe(0);
	});

	it("notifies subscribers on every mutation", async () => {
		const { model } = await freshModel();
		let calls = 0;
		model.subscribe(() => {
			calls++;
		});
		const t = await model.create({ sectionId: "s1", title: "T" });
		await model.update(t.id, { title: "U" });
		await model.toggleCompleted(t.id);
		await model.remove(t.id);
		expect(calls).toBe(4);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/tasks.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement tasks model**

Create `src/model/tasks.js`:

```js
import { uuid } from "../utils/id.js";

// createTaskModel(db) → Promise<TaskModel>
//
// TaskModel = {
//   subscribe(fn) → unsubscribe,
//   list() → Promise<Task[]>,
//   listBySection(sectionId) → Promise<Task[]>   // ordered by `order`
//   create({ sectionId, title, ...optional }) → Promise<Task>,
//   update(id, patch) → Promise<Task>,
//   toggleCompleted(id) → Promise<Task>,
//   remove(id) → Promise<void>,
// }
//
// Storage note: IndexedDB can't index booleans. We persist `completed` and
// `starred` as 0/1 and convert at the model boundary, so public API always
// uses true/false.

const BOOL_FIELDS = ["completed", "starred", "critical"];

export async function createTaskModel(db) {
	const listeners = new Set();
	const notify = () => {
		for (const fn of listeners) fn();
	};

	return {
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},

		async list() {
			const rows = await db.getAll("tasks");
			return rows.map(fromStorage);
		},

		async listBySection(sectionId) {
			const rows = await db.getByIndex("tasks", "sectionId", sectionId);
			return rows.map(fromStorage).sort((a, b) => a.order - b.order);
		},

		async create({
			sectionId,
			title,
			notes = "",
			starred = false,
			critical = false,
			dueAt = null,
			recurrence = null,
			leadTime = 0,
		}) {
			if (!sectionId) throw new Error("create(task): sectionId is required");
			if (!title) throw new Error("create(task): title is required");
			const siblings = await db.getByIndex(
				"tasks",
				"sectionId",
				sectionId,
			);
			const order = siblings.length;
			const task = {
				id: uuid(),
				sectionId,
				title,
				notes,
				completed: false,
				starred,
				critical,
				dueAt,
				recurrence,
				leadTime,
				scheduledTags: [],
				createdAt: new Date().toISOString(),
				order,
			};
			await db.put("tasks", toStorage(task));
			notify();
			return task;
		},

		async update(id, patch) {
			const stored = await db.get("tasks", id);
			if (!stored) throw new Error(`Task not found: ${id}`);
			const merged = { ...fromStorage(stored), ...patch, id };
			await db.put("tasks", toStorage(merged));
			notify();
			return merged;
		},

		async toggleCompleted(id) {
			const stored = await db.get("tasks", id);
			if (!stored) throw new Error(`Task not found: ${id}`);
			const current = fromStorage(stored);
			const updated = { ...current, completed: !current.completed };
			await db.put("tasks", toStorage(updated));
			notify();
			return updated;
		},

		async remove(id) {
			await db.delete("tasks", id);
			notify();
		},
	};
}

function toStorage(task) {
	const out = { ...task };
	for (const f of BOOL_FIELDS) out[f] = task[f] ? 1 : 0;
	return out;
}

function fromStorage(row) {
	const out = { ...row };
	for (const f of BOOL_FIELDS) out[f] = row[f] === 1;
	return out;
}
```

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/tasks.test.js`
Expected: 9 passed.

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): tasks — CRUD + toggleCompleted + bool↔int coercion
```

On approval:
```bash
git add src/model/tasks.js tests/unit/tasks.test.js
git commit -m "feat(model): tasks — CRUD + toggleCompleted + bool↔int coercion"
```

---

## Task 13 — Settings model (singleton)

**Why:** There's exactly one settings record, keyed by `id: "app"`. The model hides that detail and offers `get()` / `update(patch)`. Defaults come from the spec (quiet hours 23→7, `lastKnownPermission: "default"`, `lastView: "#today"`).

**Files:**
- Create: `src/model/settings.js`
- Create: `tests/unit/settings.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/settings.test.js`:

```js
import { afterEach, describe, expect, it } from "vitest";
import { openDB } from "../../src/model/db.js";
import { createSettingsModel } from "../../src/model/settings.js";

let openHandles = [];
async function freshModel() {
	const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
	openHandles.push(db);
	return { db, model: await createSettingsModel(db) };
}

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

describe("createSettingsModel", () => {
	it("seeds default settings on first construction", async () => {
		const { model } = await freshModel();
		const s = await model.get();
		expect(s.id).toBe("app");
		expect(s.quietStart).toBe(23);
		expect(s.quietEnd).toBe(7);
		expect(s.lastKnownPermission).toBe("default");
		expect(s.lastView).toBe("#today");
	});

	it("is idempotent — does not overwrite existing settings", async () => {
		const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
		openHandles.push(db);
		const m1 = await createSettingsModel(db);
		await m1.update({ quietStart: 22 });
		const m2 = await createSettingsModel(db);
		const s = await m2.get();
		expect(s.quietStart).toBe(22);
	});

	it("update patches fields and notifies", async () => {
		const { model } = await freshModel();
		let calls = 0;
		model.subscribe(() => {
			calls++;
		});
		await model.update({ quietEnd: 6, lastView: "#area/focus" });
		const s = await model.get();
		expect(s.quietEnd).toBe(6);
		expect(s.lastView).toBe("#area/focus");
		expect(s.quietStart).toBe(23); // untouched
		expect(calls).toBe(1);
	});
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:run -- tests/unit/settings.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement settings model**

Create `src/model/settings.js`:

```js
// createSettingsModel(db) → Promise<SettingsModel>
//
// SettingsModel = {
//   subscribe(fn) → unsubscribe,
//   get() → Promise<Settings>,
//   update(patch) → Promise<Settings>,
// }
//
// Singleton: one record at id === "app". Seeded with defaults on first boot.

const SETTINGS_ID = "app";
const DEFAULTS = {
	id: SETTINGS_ID,
	quietStart: 23,
	quietEnd: 7,
	lastKnownPermission: "default",
	lastView: "#today",
};

export async function createSettingsModel(db) {
	const listeners = new Set();
	const notify = () => {
		for (const fn of listeners) fn();
	};

	const existing = await db.get("settings", SETTINGS_ID);
	if (!existing) await db.put("settings", { ...DEFAULTS });

	return {
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},

		get() {
			return db.get("settings", SETTINGS_ID);
		},

		async update(patch) {
			const current = await db.get("settings", SETTINGS_ID);
			const updated = { ...current, ...patch, id: SETTINGS_ID };
			await db.put("settings", updated);
			notify();
			return updated;
		},
	};
}
```

- [ ] **Step 4: Run tests — expect green**

Run: `npm run test:run -- tests/unit/settings.test.js`
Expected: 3 passed.

- [ ] **Step 5: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(model): settings — singleton with defaults
```

On approval:
```bash
git add src/model/settings.js tests/unit/settings.test.js
git commit -m "feat(model): settings — singleton with defaults"
```

---

## Task 14 — Wire `src/app.js` to boot the data layer

**Why:** The models are tested in isolation — now wire them into the app boot path so `npm run dev` actually opens the DB, seeds Focus, and confirms everything works end-to-end in a real browser. No views yet; we log to console and call it done.

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Rewrite `src/app.js`**

Replace `src/app.js` with:

```js
// app.js — application wiring.
// M1 milestone: constructs the data layer only. Models are created here
// but not yet consumed by any view — that arrives in M2.

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

	// Sanity log — proves the boot path works. Remove in M2.
	const areaList = await areas.list();
	console.log(
		`Ignite booted. Areas: ${areaList.length} (focus seeded: ${areaList.some(
			(a) => a.id === "focus",
		)}).`,
	);

	// Expose for quick DevTools inspection during M1 — drop in M2.
	window.ignite = { db, areas, sections, tasks, settings };
}

boot().catch((err) => {
	console.error("Ignite failed to boot:", err);
});
```

- [ ] **Step 2: Full test suite — must stay green**

Run: `npm run test:run`
Expected: all tests pass (id + recurrence + db + areas + sections + tasks + settings).

- [ ] **Step 3: Biome check**

Run: `npx biome check .`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean build, no errors.

- [ ] **Step 5: Dev-server smoke test**

Run: `npm run dev`
In the browser at the Vite URL, open DevTools console and verify you see:
```
Ignite booted. Areas: 1 (focus seeded: true).
```
Also: in Application → IndexedDB → `ignite`, the four object stores (`areas`, `sections`, `tasks`, `settings`) are visible, with one record in `areas` (id `focus`) and one record in `settings` (id `app`).

Stop the dev server (Ctrl-C) when verified.

- [ ] **Step 6: Propose commit, then commit**

Proposed:
```
feat(app): boot data layer — openDB, seed Focus, expose models
```

On approval:
```bash
git add src/app.js
git commit -m "feat(app): boot data layer — openDB, seed Focus, expose models"
```

- [ ] **Step 7: Propose push to GitHub (optional — ask Malin)**

Ask Malin: "M1 is complete, green, and committed. Want to push to GitHub now, or hold?"
If yes, she pushes via GitHub Desktop (per her feedback memory — don't try `git push` from here).

---

## Milestone 1 Completion Criteria

All of the following must be true before declaring M1 done:

1. `npm run test:run` — all suites green (expected totals: id 2, recurrence 11, db 6, areas 8, sections 5, tasks 9, settings 3 = **44 passing tests**).
2. `npx biome check .` — no errors or warnings.
3. `npm run build` — completes without errors.
4. `npm run dev` boots the app; DevTools console shows `Ignite booted. Areas: 1 (focus seeded: true).`.
5. IndexedDB in DevTools shows `areas` (1 row: `focus`) and `settings` (1 row: `app`).
6. 14 commits on `main` telling the story, one per task.

## What's Next (M2 Preview — not in scope here)

Sidebar + Today view + quick-capture. First DOM. First subscribe calls from views. First controller.
