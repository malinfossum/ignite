# M5 — Area-level CRUD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `＋ New area`, rename, reorder (Move up / Move down), and cascade delete to the sidebar — the area-level analog of the M3 section CRUD pattern.

**Architecture:** The sidebar grows from a stateless renderer (~85 lines) into a stateful view (~280 lines) that mirrors `area.js`'s closure-flag pattern. Model layer gains five new `areas.*` mutators (rename, swapOrder, removeMany, restore, restoreMany), one new method on each of `sections.js` (`restoreMany`) and `tasks.js` (`listByArea`). Controller gains `sidebarCallbacks()` parallel to `areaCallbacks()`, a `moveArea` helper, and a `deleteAreaCascade` that snapshots three layers (area + sections + tasks), redirects-if-active, removes in cascade order, then shows a toast whose undo restores in reverse-cascade order.

**Tech Stack:** Vanilla JS (no framework, no TypeScript), vitest for unit tests, Biome for lint/format, IndexedDB for persistence, MVC architecture.

**Spec:** [docs/superpowers/specs/2026-05-19-ignite-m5-area-crud-design.md](../specs/2026-05-19-ignite-m5-area-crud-design.md)

**Test count at end:** ~104 (was 93). Adds ~11 model tests via TDD; views verified manually.

**Commit convention:** Malin commits via GitHub Desktop. Each task ends with a "Stage and commit" step that proposes message + files; the executing agent must NOT run `git commit` directly. Stop at each commit step and wait for Malin. **No `Co-Authored-By` line** — Malin commits as sole author.

**Hardening invariants from the 4-pass stress test — DO NOT simplify away:**

1. `FOCUS_ID` early-return guard in `deleteAreaCascade` — prevents programmatic Focus-area corruption.
2. Redirect-first sequencing in `deleteAreaCascade` — prevents "Area not found" flash.
3. Reverse-cascade restore order (`areas.restore` → `sections.restoreMany` → `tasks.restoreMany`) — keeps view filters consistent.
4. `isRendering` re-entrancy guard in `doRender` — prevents premature rename commit on blur-during-detach.
5. `pendingRenameValue` reset on `enterRename` / `rename-area` / `commitRenameFromInput` / `cancelRename` / `destroy` — prevents cross-rename value leak.
6. Sidebar collapse force-closes menus + commits-or-cancels rename via the prev/next transition check.
7. `onCommitRename` (section) swallows `/Section not found/` for the cascade-race case.

---

## File Structure

| File | Touched | Responsibility |
|------|---------|----------------|
| `src/model/areas.js` | Modify | Export `FOCUS_ID`; `capitalizeFirst` on create; add `rename`, `swapOrder`, `removeMany`, `restore`, `restoreMany`; expand JSDoc |
| `src/model/sections.js` | Modify | Add `restoreMany`; expand JSDoc |
| `src/model/tasks.js` | Modify | Add `listByArea`; expand JSDoc |
| `tests/unit/areas.test.js` | Modify | Add ~8 tests across the new mutators |
| `tests/unit/sections.test.js` | Modify | Add 1 test for `restoreMany` |
| `tests/unit/tasks.test.js` | Modify | Add 1 test for `listByArea` |
| `src/controller.js` | Modify | Add `sidebarCallbacks()`, `moveArea`, `deleteAreaCascade`; wire into `start()`; swallow `Section not found` in `onCommitRename` |
| `src/views/sidebar.js` | Rewrite | Full rewrite — stateful view with closure flags, helpers, bindings, template, `enterRename`, destroy-commit |
| `main.css` | Modify | Sidebar menu / rename / add-area styles + collapsed-state hides |

---

## Task 1 — Foundation: export `FOCUS_ID` + capitalize on create

**Why first:** The sidebar view and controller cascade-delete both reference `FOCUS_ID`. Exporting it is a one-line prerequisite. Bundling with the `capitalizeFirst` on create gives a small but cohesive commit.

**Files:**
- Modify: `src/model/areas.js`
- Modify: `tests/unit/areas.test.js`

- [ ] **Step 1.1: Write the failing test**

Append to `tests/unit/areas.test.js` (above the `describe("createAreaModel — subscribe/notify", ...)` block is fine — group with CRUD describe; or add as its own describe at the bottom). Adding at the bottom:

```js
describe("createAreaModel — name capitalization", () => {
	it("capitalizes the first character of name on create", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "projects" });
		expect(a.name).toBe("Projects");
	});
});
```

- [ ] **Step 1.2: Run the new test to verify it fails**

Run: `npx vitest run tests/unit/areas.test.js`
Expected: 1 new test fails — assertion error showing `"projects"` received instead of `"Projects"`. All previously-passing area tests still pass.

- [ ] **Step 1.3: Export `FOCUS_ID` and apply `capitalizeFirst` on create**

In `src/model/areas.js`:

(a) Add `capitalizeFirst` import at the top:

```js
import { uuid } from "../utils/id.js";
import { capitalizeFirst } from "../utils/text.js";
```

(b) Change `const FOCUS_ID = "focus";` to:

```js
export const FOCUS_ID = "focus";
```

(c) In the `create` method body, change `name` to `capitalizeFirst(name)`:

```js
async create({ name, icon = "", critical = false }) {
	const all = await db.getAll("areas");
	const order = all.length;
	const area = { id: uuid(), name: capitalizeFirst(name), icon, critical, order };
	await db.put("areas", area);
	notify();
	return area;
},
```

- [ ] **Step 1.4: Run the full test suite**

Run: `npm test`
Expected: 94 passing (93 previous + 1 new). No regressions.

- [ ] **Step 1.5: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 1.6: Stage and commit (Malin via GitHub Desktop)**

Files to stage: `src/model/areas.js`, `tests/unit/areas.test.js`.

Proposed commit message:

```
feat(model): export FOCUS_ID + capitalize area name on create
```

Stop. Wait for Malin to commit before proceeding.

---

## Task 2 — Model: `areas.rename` (TDD)

**Files:**
- Modify: `src/model/areas.js`
- Modify: `tests/unit/areas.test.js`

- [ ] **Step 2.1: Write the two failing tests**

Append to `tests/unit/areas.test.js`:

```js
describe("createAreaModel — rename", () => {
	it("trims, capitalizes, and updates the name in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "Projects" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.rename(a.id, "  studies  ");
		const stored = (await model.list()).find((x) => x.id === a.id);
		expect(stored.name).toBe("Studies");
		expect(calls).toEqual(["notified"]);
	});

	it("rejects empty / whitespace-only names and missing ids", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "Old" });
		await expect(model.rename(a.id, "")).rejects.toThrow(/empty/i);
		await expect(model.rename(a.id, "   ")).rejects.toThrow(/empty/i);
		await expect(model.rename("no-such-id", "New")).rejects.toThrow(/not found/i);
		const stored = (await model.list()).find((x) => x.id === a.id);
		expect(stored.name).toBe("Old");
	});
});
```

- [ ] **Step 2.2: Run to verify failures**

Run: `npx vitest run tests/unit/areas.test.js`
Expected: 2 new tests fail with `TypeError: model.rename is not a function`.

- [ ] **Step 2.3: Implement `rename`**

In `src/model/areas.js`, add this method to the returned object (place it after `update`, before `remove`):

```js
async rename(id, name) {
	const cleaned = capitalizeFirst(name);
	if (!cleaned) throw new Error("rename(area): name cannot be empty");
	const existing = await db.get("areas", id);
	if (!existing) throw new Error(`Area not found: ${id}`);
	await db.put("areas", { ...existing, name: cleaned });
	notify();
},
```

**Why `capitalizeFirst` here too:** parallel to `sections.rename`. Whitespace-only input → `capitalizeFirst("   ")` returns `""` → the `if (!cleaned)` throws "empty." One function handles both trim+capitalize+empty-check.

- [ ] **Step 2.4: Run the full test suite**

Run: `npm test`
Expected: 96 passing (94 previous + 2 new).

- [ ] **Step 2.5: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 2.6: Stage and commit**

Files to stage: `src/model/areas.js`, `tests/unit/areas.test.js`.

Proposed commit message:

```
feat(model): add areas.rename with trim + capitalize + empty guard
```

Stop. Wait for Malin.

---

## Task 3 — Model: `areas.swapOrder` (TDD)

**Files:**
- Modify: `src/model/areas.js`
- Modify: `tests/unit/areas.test.js`

- [ ] **Step 3.1: Write the two failing tests**

Append to `tests/unit/areas.test.js`:

```js
describe("createAreaModel — swapOrder", () => {
	it("swaps order values between two areas in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "A" }); // order = 1 (Focus is 0)
		const b = await model.create({ name: "B" }); // order = 2

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.swapOrder(a.id, b.id);
		const list = (await model.list()).filter((x) => x.id !== "focus");
		list.sort((x, y) => x.order - y.order);
		expect(list[0].id).toBe(b.id);
		expect(list[1].id).toBe(a.id);
		expect(calls).toEqual(["notified"]); // single notify after both writes
	});

	it("throws when either area id is missing", async () => {
		const { model } = await freshModel();
		await expect(model.swapOrder("nope-a", "nope-b")).rejects.toThrow(
			/Area not found/,
		);
		const a = await model.create({ name: "A" });
		await expect(model.swapOrder(a.id, "nope-b")).rejects.toThrow(
			/Area not found/,
		);
	});
});
```

- [ ] **Step 3.2: Run to verify failures**

Run: `npx vitest run tests/unit/areas.test.js`
Expected: 2 new tests fail with `TypeError: model.swapOrder is not a function`.

- [ ] **Step 3.3: Implement `swapOrder`**

In `src/model/areas.js`, after `rename`, add:

```js
async swapOrder(idA, idB) {
	const [a, b] = await Promise.all([
		db.get("areas", idA),
		db.get("areas", idB),
	]);
	if (!a) throw new Error(`Area not found: ${idA}`);
	if (!b) throw new Error(`Area not found: ${idB}`);
	await Promise.all([
		db.put("areas", { ...a, order: b.order }),
		db.put("areas", { ...b, order: a.order }),
	]);
	notify(); // single notify after both writes
},
```

- [ ] **Step 3.4: Run the full test suite**

Run: `npm test`
Expected: 98 passing (96 + 2).

- [ ] **Step 3.5: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 3.6: Stage and commit**

Files to stage: `src/model/areas.js`, `tests/unit/areas.test.js`.

Proposed commit message:

```
feat(model): add areas.swapOrder
```

Stop. Wait for Malin.

---

## Task 4 — Model: `areas.removeMany` with FOCUS_ID guard (TDD)

**Files:**
- Modify: `src/model/areas.js`
- Modify: `tests/unit/areas.test.js`

- [ ] **Step 4.1: Write the two failing tests**

Append to `tests/unit/areas.test.js`:

```js
describe("createAreaModel — removeMany", () => {
	it("deletes multiple areas in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "A" });
		const b = await model.create({ name: "B" });
		await model.create({ name: "C" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.removeMany([a.id, b.id]);
		const list = (await model.list()).filter((x) => x.id !== "focus");
		expect(list.map((x) => x.name)).toEqual(["C"]);
		expect(calls).toEqual(["notified"]); // single notify, not two
	});

	it("rejects removeMany when the id list contains FOCUS_ID", async () => {
		const { model } = await freshModel();
		const other = await model.create({ name: "Other" });
		await expect(model.removeMany([other.id, "focus"])).rejects.toThrow(
			/cannot delete focus/i,
		);
		// Reject before any delete — both records still present.
		const stored = await model.list();
		expect(stored.some((x) => x.id === "focus")).toBe(true);
		expect(stored.some((x) => x.id === other.id)).toBe(true);
	});
});
```

- [ ] **Step 4.2: Run to verify failures**

Run: `npx vitest run tests/unit/areas.test.js`
Expected: 2 new tests fail with `TypeError: model.removeMany is not a function`.

- [ ] **Step 4.3: Implement `removeMany`**

In `src/model/areas.js`, after `remove`, add:

```js
async removeMany(ids) {
	if (ids.some((id) => id === FOCUS_ID)) {
		throw new Error("Cannot delete Focus area");
	}
	await Promise.all(ids.map((id) => db.delete("areas", id)));
	notify(); // single notify after all deletes
},
```

**Why the guard is here AND in the controller's `deleteAreaCascade`:** belt-and-suspenders. The model-layer throw is the hard fence (programmatic protection). The controller-layer early-return is the soft fence (UI-side defensive). Both must exist; removing either weakens the other.

- [ ] **Step 4.4: Run the full test suite**

Run: `npm test`
Expected: 100 passing (98 + 2).

- [ ] **Step 4.5: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 4.6: Stage and commit**

Files to stage: `src/model/areas.js`, `tests/unit/areas.test.js`.

Proposed commit message:

```
feat(model): add areas.removeMany with focus-area guard
```

Stop. Wait for Malin.

---

## Task 5 — Model: `areas.restore` + `restoreMany` (TDD)

**Files:**
- Modify: `src/model/areas.js`
- Modify: `tests/unit/areas.test.js`

- [ ] **Step 5.1: Write the two failing tests**

Append to `tests/unit/areas.test.js`:

```js
describe("createAreaModel — restore + restoreMany", () => {
	it("restore re-inserts a deleted area with the same id, name, and order", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "Projects" });
		await model.remove(a.id);

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.restore(a);
		const list = (await model.list()).filter((x) => x.id !== "focus");
		expect(list).toHaveLength(1);
		expect(list[0].id).toBe(a.id);
		expect(list[0].name).toBe("Projects");
		expect(list[0].order).toBe(a.order);
		expect(calls).toEqual(["notified"]);
	});

	it("restoreMany re-inserts multiple areas in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "A" });
		const b = await model.create({ name: "B" });
		await model.removeMany([a.id, b.id]);

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.restoreMany([a, b]);
		const list = (await model.list()).filter((x) => x.id !== "focus");
		expect(list.map((x) => x.name).sort()).toEqual(["A", "B"]);
		expect(calls).toEqual(["notified"]); // single notify
	});
});
```

- [ ] **Step 5.2: Run to verify failures**

Run: `npx vitest run tests/unit/areas.test.js`
Expected: 2 new tests fail with `TypeError: model.restore is not a function` (or similar).

- [ ] **Step 5.3: Implement `restore` and `restoreMany`**

In `src/model/areas.js`, after `removeMany`, add:

```js
async restore(snapshot) {
	await db.put("areas", { ...snapshot });
	notify();
	return snapshot;
},

async restoreMany(snapshots) {
	await Promise.all(snapshots.map((s) => db.put("areas", { ...s })));
	notify(); // single notify after all writes
},
```

- [ ] **Step 5.4: Update the JSDoc public-API list at the top of the file**

Replace the JSDoc block (lines 22-33 — `// createAreaModel(db) → Promise<AreaModel> ...`) with:

```js
// createAreaModel(db) → Promise<AreaModel>
//
//   AreaModel = {
//     subscribe(fn) → unsubscribe(),
//     list() → Promise<Area[]>,
//     create({ name, icon?, critical? }) → Promise<Area>,
//     update(id, patch) → Promise<Area>,
//     rename(id, name) → Promise<void>,
//     swapOrder(idA, idB) → Promise<void>,
//     remove(id) → Promise<void>,
//     removeMany(ids) → Promise<void>,
//     restore(snapshot) → Promise<Area>,
//     restoreMany(snapshots) → Promise<void>,
//   }
//
// Subscribe/notify pattern: every mutation writes the DB, then notifies.
// Focus area is seeded on first construction and cannot be deleted.
```

- [ ] **Step 5.5: Run the full test suite**

Run: `npm test`
Expected: 102 passing (100 + 2).

- [ ] **Step 5.6: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 5.7: Stage and commit**

Files to stage: `src/model/areas.js`, `tests/unit/areas.test.js`.

Proposed commit message:

```
feat(model): add areas.restore + restoreMany + JSDoc API list
```

Stop. Wait for Malin.

---

## Task 6 — Model: `sections.restoreMany` (TDD)

**Files:**
- Modify: `src/model/sections.js`
- Modify: `tests/unit/sections.test.js`

- [ ] **Step 6.1: Write the failing test**

Append to `tests/unit/sections.test.js`:

```js
describe("createSectionModel — restoreMany", () => {
	it("re-inserts multiple deleted sections in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ areaId: "focus", name: "A" });
		const b = await model.create({ areaId: "focus", name: "B" });
		await model.removeMany([a.id, b.id]);

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.restoreMany([a, b]);
		const list = await model.listByArea("focus");
		expect(list.map((s) => s.name).sort()).toEqual(["A", "B"]);
		expect(calls).toEqual(["notified"]); // single notify
	});
});
```

- [ ] **Step 6.2: Run to verify failure**

Run: `npx vitest run tests/unit/sections.test.js`
Expected: 1 new test fails with `TypeError: model.restoreMany is not a function`.

- [ ] **Step 6.3: Implement `restoreMany`**

In `src/model/sections.js`, after `removeMany`, add:

```js
async restoreMany(snapshots) {
	await Promise.all(snapshots.map((s) => db.put("sections", { ...s })));
	notify(); // single notify after all writes
},
```

- [ ] **Step 6.4: Update the JSDoc public-API list at the top of the file**

In `src/model/sections.js`, replace the JSDoc block at the top to include `restoreMany`. Find the existing JSDoc (around lines 5-19) and ensure the API list reads:

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
//   restoreMany(snapshots) → Promise<void>,
// }
```

- [ ] **Step 6.5: Run the full test suite**

Run: `npm test`
Expected: 103 passing (102 + 1).

- [ ] **Step 6.6: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 6.7: Stage and commit**

Files to stage: `src/model/sections.js`, `tests/unit/sections.test.js`.

Proposed commit message:

```
feat(model): add sections.restoreMany
```

Stop. Wait for Malin.

---

## Task 7 — Model: `tasks.listByArea` (TDD)

**Files:**
- Modify: `src/model/tasks.js`
- Modify: `tests/unit/tasks.test.js`

- [ ] **Step 7.1: Write the failing test**

Append to `tests/unit/tasks.test.js`:

```js
describe("createTaskModel — listByArea", () => {
	it("returns all tasks whose section belongs to the area, regardless of section", async () => {
		const { db, model } = await freshModel();
		// Seed two sections in "focus" area and one in "other" area.
		await db.put("sections", {
			id: "s1", areaId: "focus", name: "S1", order: 0, collapsed: false,
		});
		await db.put("sections", {
			id: "s2", areaId: "focus", name: "S2", order: 1, collapsed: false,
		});
		await db.put("sections", {
			id: "s3", areaId: "other", name: "S3", order: 0, collapsed: false,
		});
		const t1 = await model.create({ sectionId: "s1", title: "T1" });
		const t2 = await model.create({ sectionId: "s2", title: "T2" });
		await model.create({ sectionId: "s3", title: "T3" });

		const focusTasks = await model.listByArea("focus");
		expect(focusTasks.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
	});
});
```

- [ ] **Step 7.2: Run to verify failure**

Run: `npx vitest run tests/unit/tasks.test.js`
Expected: 1 new test fails with `TypeError: model.listByArea is not a function`.

- [ ] **Step 7.3: Implement `listByArea`**

In `src/model/tasks.js`, add this method to the returned object (place it after `listBySection`):

```js
async listByArea(areaId) {
	const allSections = await db.getAll("sections");
	const sectionIds = new Set(
		allSections.filter((s) => s.areaId === areaId).map((s) => s.id),
	);
	const allTasks = await db.getAll("tasks");
	return allTasks
		.filter((t) => sectionIds.has(t.sectionId))
		.map(fromStorage);
},
```

**Why `.map(fromStorage)`:** tasks are persisted with `completed`/`starred`/`critical` as 0/1 (IndexedDB can't index booleans). The model boundary always exposes the public form (true/false) via `fromStorage`. The cascade-delete snapshot is then round-tripped through `tasks.restoreMany` → `db.put(toStorage(snap))`, which re-applies the 0/1 conversion. Both `listBySection` (line 45) and `restoreMany` (line 133) already follow this pattern — `listByArea` matches.

- [ ] **Step 7.4: Update the JSDoc public-API list at the top of the file**

In `src/model/tasks.js`, add `listByArea(areaId)` to the JSDoc API list (around lines 6-18). Insert after `listBySection`:

```js
//   listByArea(areaId) → Promise<Task[]>,  // all tasks whose section is in this area
```

- [ ] **Step 7.5: Run the full test suite**

Run: `npm test`
Expected: 104 passing (103 + 1).

- [ ] **Step 7.6: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 7.7: Stage and commit**

Files to stage: `src/model/tasks.js`, `tests/unit/tasks.test.js`.

Proposed commit message:

```
feat(model): add tasks.listByArea for cascade snapshot
```

Stop. Wait for Malin.

---

## Task 8 — Controller: `sidebarCallbacks` + `moveArea` + `deleteAreaCascade`

**Files:**
- Modify: `src/controller.js`

This task adds three pieces in one commit because they're co-dependent: `sidebarCallbacks()` returns the callbacks; `moveArea` and `deleteAreaCascade` are the helpers it calls.

- [ ] **Step 8.1: Add `FOCUS_ID` to the existing import**

At the top of `src/controller.js`, change:

```js
import { FOCUS_DEFAULT_SECTION_ID } from "./model/areas.js";
```

to:

```js
import { FOCUS_DEFAULT_SECTION_ID, FOCUS_ID } from "./model/areas.js";
```

- [ ] **Step 8.2: Add `sidebarCallbacks()`, `moveArea`, `deleteAreaCascade`, `cascadeAreaMessage`**

Find the `moveSection` function in `src/controller.js`. Immediately after it (after the closing `}` of `moveSection`), insert:

```js
async function moveArea(areaId, direction) {
	const all = await areas.list();
	const peers = all.slice().sort((a, b) => a.order - b.order);
	const idx = peers.findIndex((a) => a.id === areaId);
	if (idx < 0) return;
	const neighbourIdx = direction === "up" ? idx - 1 : idx + 1;
	if (neighbourIdx < 0 || neighbourIdx >= peers.length) return;
	const neighbour = peers[neighbourIdx];
	await areas.swapOrder(areaId, neighbour.id);
}

async function deleteAreaCascade(areaId) {
	// 0. Defensive guard — Focus area is never deletable.
	// The UI's `isUndeletable` already hides the Delete item; this guard
	// protects against programmatic calls (dev tools, future bugs).
	// Without it, the cascade would partial-execute: tasks.removeMany
	// would succeed, then sections.removeMany would throw on
	// `focus-default`, leaving Focus's tasks gone and no toast shown.
	if (areaId === FOCUS_ID) return;

	// 1. Snapshot all three layers BEFORE any write.
	const all = await areas.list();
	const areaSnapshot = all.find((a) => a.id === areaId);
	if (!areaSnapshot) return;
	const sectionSnapshots = await sections.listByArea(areaId);
	const taskSnapshots = await tasks.listByArea(areaId);

	// 2. Redirect-if-active — BEFORE any model write.
	// Without this, applyState fires between areas.remove and the redirect
	// and the user sees an "Area not found" flash.
	if (currentRoute.name === "area" && currentRoute.id === areaId) {
		window.location.hash = "#today";
	}

	// 3. Cascade: tasks → sections → area.
	await tasks.removeMany(taskSnapshots.map((t) => t.id));
	await sections.removeMany(sectionSnapshots.map((s) => s.id));
	await areas.remove(areaId);

	// 4. Toast — reverse-cascade restore (parents before children).
	toast.show({
		message: cascadeAreaMessage(
			areaSnapshot.name,
			sectionSnapshots.length,
			taskSnapshots.length,
		),
		durationMs: CASCADE_TOAST_MS,
		onUndo: async () => {
			await areas.restore(areaSnapshot);
			await sections.restoreMany(sectionSnapshots);
			await tasks.restoreMany(taskSnapshots);
		},
	});
}

function cascadeAreaMessage(name, sectionCount, taskCount) {
	if (sectionCount === 0 && taskCount === 0) return `"${name}" deleted`;
	const parts = [];
	if (sectionCount === 1) parts.push("1 section");
	else if (sectionCount > 1) parts.push(`${sectionCount} sections`);
	if (taskCount === 1) parts.push("1 task");
	else if (taskCount > 1) parts.push(`${taskCount} tasks`);
	return `"${name}" and ${parts.join(", ")} deleted`;
}

function sidebarCallbacks() {
	return {
		onAddArea: async () => {
			const area = await areas.create({ name: "New area" });
			window.location.hash = `#area/${area.id}`;
			sidebar.enterRename(area.id);
		},
		onCommitAreaRename: async ({ areaId, name }) => {
			try {
				await areas.rename(areaId, name);
			} catch (err) {
				// Race: area was just cascade-deleted (e.g., user clicked Delete
				// before the destroy-commit fired). Drop silently.
				if (/Area not found/.test(err.message)) return;
				throw err;
			}
		},
		onMoveAreaUp: async ({ areaId }) => {
			await moveArea(areaId, "up");
		},
		onMoveAreaDown: async ({ areaId }) => {
			await moveArea(areaId, "down");
		},
		onDeleteArea: async ({ areaId }) => {
			await deleteAreaCascade(areaId);
		},
	};
}
```

- [ ] **Step 8.3: Wire `sidebarCallbacks()` into the sidebar construction in `start()`**

Find the `sidebar = createSidebarView(sidebarRoot, { ... })` call in `start()`. Update it to spread the sidebar callbacks alongside the existing ones:

```js
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
	...sidebarCallbacks(),
});
```

- [ ] **Step 8.4: Run the full test suite**

Run: `npm test`
Expected: 104 passing. No new tests in this task — controller is verified manually later.

- [ ] **Step 8.5: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 8.6: Stage and commit**

Files to stage: `src/controller.js`.

Proposed commit message:

```
feat(controller): wire sidebarCallbacks + moveArea + cascade-delete with focus guard
```

Stop. Wait for Malin.

---

## Task 9 — Controller: `onCommitRename` swallow guard

Small targeted fix for the M3-inherited race: cascade-delete of an area mid-section-rename of that area would throw `Section not found` from the destroy-commit. Separate commit so the rationale is in the git log on its own.

**Files:**
- Modify: `src/controller.js`

- [ ] **Step 9.1: Update `onCommitRename` in `areaCallbacks()`**

Find the `onCommitRename` callback inside `areaCallbacks()`:

```js
onCommitRename: async ({ sectionId, name }) => {
	await sections.rename(sectionId, name);
},
```

Replace it with:

```js
onCommitRename: async ({ sectionId, name }) => {
	try {
		await sections.rename(sectionId, name);
	} catch (err) {
		// Race: section was cascade-deleted (e.g., user deleted the parent
		// area while mid-rename of one of its sections, or destroy-commit
		// raced cascade). Drop silently — toast undo will restore the
		// section with its pre-rename name; the typed text is lost.
		if (/Section not found/.test(err.message)) return;
		throw err;
	}
},
```

- [ ] **Step 9.2: Run the full test suite**

Run: `npm test`
Expected: 104 passing.

- [ ] **Step 9.3: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 9.4: Stage and commit**

Files to stage: `src/controller.js`.

Proposed commit message:

```
fix(controller): swallow Section-not-found on cascade-delete race
```

Stop. Wait for Malin.

---

## Task 10 — View: full rewrite of `src/views/sidebar.js`

The big one. ~280 lines. All the closure-flag patterns, helper functions, bindings, template, `enterRename`, destroy-commit. Mirrors `area.js` structure with sidebar-specific adaptations: `pendingRenameValue` + `isRendering` guard for tick-resilient rename, `prevSidebarCollapsed` transition detection, FOCUS_ID `isUndeletable`.

**Files:**
- Rewrite: `src/views/sidebar.js`

- [ ] **Step 10.1: Replace `src/views/sidebar.js` with the new implementation**

Open `src/views/sidebar.js`. Replace its entire contents with:

```js
// createSidebarView(rootEl, {
//   onToggleCollapse, onGoToday, onOpenArea,
//   onAddArea, onCommitAreaRename, onMoveAreaUp, onMoveAreaDown, onDeleteArea,
// }) → { render(state), enterRename(areaId), destroy() }
//
// state expected: { areas, sections, tasks, settings, route, now }
// route:
//   { name: "today" }            → wordmark gets aria-current="page"
//   { name: "area", id: "..." }  → matching area row gets aria-current="page"
//
// Closure state (all reset to initial values in destroy()):
//   openAreaMenuId          - area id whose ⋯ menu is open, or null
//   renamingAreaId          - area id currently in rename mode, or null
//   pendingFocusAreaId      - after the next render, focus this area's ⋯ button
//   pendingMenuFocusAreaId  - after the next render, focus first menu item
//   pendingRenameSelect     - true → next render focuses + selects rename input
//   pendingRenameValue      - last typed value of rename input, or null
//   prevSidebarCollapsed    - tracks settings.sidebarCollapsed across renders
//   isRendering             - true during innerHTML rewrite (blur-listener re-entrancy guard)
//
// We do NOT capture element references for focus return. Across an innerHTML
// rewrite, captured elements detach and .focus() on them is a silent no-op.
// The pending* flags + post-render lookups by data-attribute work because
// they query the freshly-rendered DOM.

import { FOCUS_ID } from "../model/areas.js";
import { bindActions, bindKeys, escapeHtml } from "../utils/dom.js";

export function createSidebarView(
	rootEl,
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
) {
	let lastState = null;
	let openAreaMenuId = null;
	let renamingAreaId = null;
	let pendingFocusAreaId = null;
	let pendingMenuFocusAreaId = null;
	let pendingRenameSelect = false;
	let pendingRenameValue = null;
	let prevSidebarCollapsed = null;
	let isRendering = false;

	function areaFromEvent(actionEl) {
		const rowEl = actionEl.closest("[data-area-id]");
		if (!rowEl || !lastState) return null;
		return lastState.areas.find((a) => a.id === rowEl.dataset.areaId) ?? null;
	}

	function closeMenu() {
		if (!openAreaMenuId) return;
		pendingFocusAreaId = openAreaMenuId;
		openAreaMenuId = null;
		doRender();
	}

	function cancelRename() {
		if (!renamingAreaId) return;
		pendingFocusAreaId = renamingAreaId;
		renamingAreaId = null;
		pendingRenameValue = null;
		doRender();
	}

	function commitRenameFromInput(inputEl) {
		const id = inputEl?.dataset?.areaId ?? renamingAreaId;
		if (!id) return;
		const value = (inputEl?.value ?? "").trim();
		renamingAreaId = null;
		pendingFocusAreaId = id;
		pendingRenameValue = null;
		if (value) {
			onCommitAreaRename({ areaId: id, name: value });
			// Model write is async; the model-notify-driven re-render picks
			// up pendingFocusAreaId and focuses the new ⋯ button.
		} else {
			doRender(); // empty/cancel — re-render now to consume the flag
		}
	}

	const docClickHandler = (event) => {
		if (rootEl.contains(event.target)) return;
		if (openAreaMenuId) closeMenu();
	};
	document.addEventListener("click", docClickHandler);

	// Esc lives on document, not rootEl. After doRender rewrites innerHTML
	// the previously-focused element is detached and focus drops to <body>,
	// outside rootEl. A keydown on body bubbles to document only — never
	// to rootEl. Matches the area.js pattern.
	const docKeyHandler = (event) => {
		if (event.key !== "Escape") return;
		if (renamingAreaId) {
			cancelRename();
			return;
		}
		if (openAreaMenuId) {
			closeMenu();
		}
	};
	document.addEventListener("keydown", docKeyHandler);

	const unbindClick = bindActions(rootEl, {
		"toggle-sidebar": () => onToggleCollapse(),
		"go-today": () => onGoToday(),

		"open-area": (_event, actionEl) => {
			const id = actionEl.dataset.id;
			if (id) onOpenArea(id);
		},

		"add-area": () => onAddArea(),

		"open-area-menu": (event, actionEl) => {
			event.stopPropagation();
			const a = areaFromEvent(actionEl);
			if (!a) return;
			if (openAreaMenuId === a.id) {
				closeMenu();
				return;
			}
			openAreaMenuId = a.id;
			// Heuristic: keyboard activations (Enter/Space) report
			// event.detail === 0; mouse clicks report >= 1. When opened
			// via keyboard, move focus to the first menu item.
			if (event.detail === 0) {
				pendingMenuFocusAreaId = a.id;
			}
			doRender();
		},

		"rename-area": (_event, actionEl) => {
			const a = areaFromEvent(actionEl);
			if (!a) return;
			openAreaMenuId = null;
			renamingAreaId = a.id;
			pendingRenameSelect = true;
			pendingRenameValue = null; // start fresh — required by pendingRenameValue contract
			doRender();
		},

		"commit-area-rename": (_event, actionEl) => {
			// Click delegation also fires this; blur on the input also fires
			// via the listener attached in doRender.
			commitRenameFromInput(actionEl);
		},

		"move-area-up": (_event, actionEl) => {
			const a = areaFromEvent(actionEl);
			openAreaMenuId = null;
			if (a) {
				pendingFocusAreaId = a.id;
				onMoveAreaUp({ areaId: a.id });
			}
		},

		"move-area-down": (_event, actionEl) => {
			const a = areaFromEvent(actionEl);
			openAreaMenuId = null;
			if (a) {
				pendingFocusAreaId = a.id;
				onMoveAreaDown({ areaId: a.id });
			}
		},

		"delete-area": (_event, actionEl) => {
			const a = areaFromEvent(actionEl);
			openAreaMenuId = null;
			// No pendingFocusAreaId — the row is about to vanish.
			// The toast appears (announced via aria-live) and the user
			// Tabs to Undo from there.
			if (a) onDeleteArea({ areaId: a.id });
		},
	});

	const unbindKeys = bindKeys(rootEl, {
		Enter: (event, actionEl) => {
			if (
				renamingAreaId &&
				actionEl?.dataset?.action === "commit-area-rename"
			) {
				event.preventDefault();
				commitRenameFromInput(actionEl);
			}
		},
	});

	function doRender() {
		if (!lastState) return;

		isRendering = true;
		try {
			rootEl.innerHTML = template(lastState, {
				openAreaMenuId,
				renamingAreaId,
				pendingRenameValue,
			});
		} finally {
			// try/finally so a defensive template throw doesn't strand
			// isRendering=true and silently swallow all future blur-commits.
			isRendering = false;
		}

		// Re-attach input + blur listeners on the NEW input. Both must be
		// re-attached on every render because the element is recreated.
		const input = rootEl.querySelector(".sidebar__rename-input");
		if (input) {
			input.addEventListener("input", (e) => {
				pendingRenameValue = e.target.value;
			});
			// Blur commits, but ONLY for user-initiated blur. When innerHTML
			// rewrites during tick re-render, the focused input is detached
			// and a synthetic blur fires; we must NOT commit in that case
			// (rename mode should persist across re-renders).
			input.addEventListener(
				"blur",
				() => {
					if (isRendering) return;
					if (renamingAreaId) commitRenameFromInput(input);
				},
				{ once: true },
			);

			// Rename input focus handling — only select() on first render
			// after entering rename mode. Subsequent re-renders preserve cursor.
			if (pendingRenameSelect) {
				input.focus();
				input.select();
				pendingRenameSelect = false;
			} else if (document.activeElement !== input) {
				input.focus();
			}
		}

		// Post-render lookup: focus the area's ⋯ button by data-attribute.
		// This is how we restore focus after innerHTML rewrites — element
		// references captured BEFORE the rewrite are detached and can't
		// receive focus.
		if (pendingFocusAreaId) {
			const trigger = rootEl.querySelector(
				`[data-area-id="${CSS.escape(pendingFocusAreaId)}"] .sidebar__menu-btn`,
			);
			trigger?.focus();
			pendingFocusAreaId = null;
		}

		// Post-render lookup: when the menu was opened via keyboard, move
		// focus to the first menu item.
		if (pendingMenuFocusAreaId) {
			const firstItem = rootEl.querySelector(
				`[data-area-id="${CSS.escape(pendingMenuFocusAreaId)}"] [role="menu"] [role="menuitem"]:first-child`,
			);
			firstItem?.focus();
			pendingMenuFocusAreaId = null;
		}
	}

	return {
		render(state) {
			lastState = state;

			// Sidebar collapse force-close: when sidebar transitions from
			// expanded → collapsed, close any open menu and commit-or-cancel
			// any active rename. Without this, closure state desyncs and
			// re-expanding shows a stale menu or orphaned input.
			const nextCollapsed = !!state.settings.sidebarCollapsed;
			if (prevSidebarCollapsed === false && nextCollapsed === true) {
				openAreaMenuId = null;
				if (renamingAreaId) {
					const input = rootEl.querySelector(".sidebar__rename-input");
					const value = (input?.value ?? "").trim();
					if (value) onCommitAreaRename({ areaId: renamingAreaId, name: value });
					renamingAreaId = null;
					pendingRenameValue = null;
				}
			}
			prevSidebarCollapsed = nextCollapsed;

			doRender();
		},

		// Public hook for the controller to flip a freshly-created area
		// into rename mode without the view subscribing to model changes.
		enterRename(areaId) {
			renamingAreaId = areaId;
			pendingRenameSelect = true;
			pendingRenameValue = null; // start fresh — fall back to area.name in template
			openAreaMenuId = null; // mutually exclusive with menu being open
			doRender();
		},

		destroy() {
			// Destroy-commit: if a rename is in flight and the input has a
			// non-empty trimmed value, commit it before tearing down so
			// typed work isn't silently lost.
			if (renamingAreaId) {
				const input = rootEl.querySelector(".sidebar__rename-input");
				const value = (input?.value ?? "").trim();
				if (value) onCommitAreaRename({ areaId: renamingAreaId, name: value });
			}
			unbindClick();
			unbindKeys();
			document.removeEventListener("click", docClickHandler);
			document.removeEventListener("keydown", docKeyHandler);
			rootEl.innerHTML = "";

			// Clear every closure flag — explicit list, not "etc."
			lastState = null;
			openAreaMenuId = null;
			renamingAreaId = null;
			pendingFocusAreaId = null;
			pendingMenuFocusAreaId = null;
			pendingRenameSelect = false;
			pendingRenameValue = null;
			prevSidebarCollapsed = null;
			isRendering = false;
		},
	};
}

function template(state, { openAreaMenuId, renamingAreaId, pendingRenameValue }) {
	const route = state.route ?? { name: "today" };
	const todayActive = route.name === "today";
	const wordmarkAria = todayActive ? 'aria-current="page"' : "";
	const wordmarkActive = todayActive ? "is-active" : "";

	const sorted = state.areas.slice().sort((a, b) => a.order - b.order);
	const items = sorted
		.map((area, i) =>
			renderAreaRow(area, state, route, {
				isFirst: i === 0,
				isLast: i === sorted.length - 1,
				isUndeletable: area.id === FOCUS_ID,
				openAreaMenuId,
				renamingAreaId,
				pendingRenameValue,
			}),
		)
		.join("");

	return `
		<button class="sidebar__home ${wordmarkActive}" type="button"
			data-action="go-today" ${wordmarkAria}>Ignite</button>
		<button class="sidebar__toggle" type="button"
			data-action="toggle-sidebar" aria-label="Toggle sidebar">
			<span class="sidebar__toggle-glyph" aria-hidden="true">≡</span>
		</button>
		<ul class="sidebar__areas">
			${items}
			<li class="sidebar__add-area-row">
				<button type="button" class="sidebar__add-area" data-action="add-area">
					＋ New area
				</button>
			</li>
		</ul>
	`;
}

function renderAreaRow(area, state, route, opts) {
	const {
		isFirst,
		isLast,
		isUndeletable,
		openAreaMenuId,
		renamingAreaId,
		pendingRenameValue,
	} = opts;
	const isOpen = openAreaMenuId === area.id;
	const isRenaming = renamingAreaId === area.id;
	const active = route.name === "area" && route.id === area.id;

	if (isRenaming) {
		const renameValue = pendingRenameValue ?? area.name;
		return `
			<li class="sidebar__area-row sidebar__area-row--editing" data-area-id="${escapeHtml(area.id)}">
				<span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
				<input
					type="text"
					class="sidebar__rename-input"
					value="${escapeHtml(renameValue)}"
					data-action="commit-area-rename"
					data-area-id="${escapeHtml(area.id)}"
					aria-label="Rename area: ${escapeHtml(area.name)}"
					autofocus />
			</li>
		`;
	}

	const sectionIds = new Set(
		state.sections.filter((s) => s.areaId === area.id).map((s) => s.id),
	);
	const count = state.tasks.filter(
		(t) => sectionIds.has(t.sectionId) && !t.completed,
	).length;

	const activeClass = active ? "is-active" : "";
	const aria = active ? 'aria-current="page"' : "";
	const menu = isOpen ? renderAreaMenu({ isFirst, isLast, isUndeletable }) : "";

	return `
		<li class="sidebar__area-row" data-area-id="${escapeHtml(area.id)}">
			<button type="button" class="sidebar__area ${activeClass}"
				data-action="open-area" data-id="${escapeHtml(area.id)}" ${aria}>
				<span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
				<span class="sidebar__name">${escapeHtml(area.name)}</span>
				<span class="sidebar__count">${count}</span>
			</button>
			<button type="button" class="sidebar__menu-btn"
				data-action="open-area-menu"
				aria-haspopup="menu"
				aria-expanded="${isOpen}"
				aria-label="Area options: ${escapeHtml(area.name)}">⋯</button>
			${menu}
		</li>
	`;
}

function renderAreaMenu({ isFirst, isLast, isUndeletable }) {
	const upDisabled = isFirst ? "disabled" : "";
	const downDisabled = isLast ? "disabled" : "";
	const deleteItem = isUndeletable
		? ""
		: `<li role="none">
				<button role="menuitem" type="button" class="sidebar-menu__item"
					data-action="delete-area">Delete</button>
			</li>`;
	return `
		<ul class="sidebar-menu" role="menu">
			<li role="none">
				<button role="menuitem" type="button" class="sidebar-menu__item"
					data-action="rename-area">Rename</button>
			</li>
			<li role="none">
				<button role="menuitem" type="button" class="sidebar-menu__item"
					data-action="move-area-up" ${upDisabled}>Move up</button>
			</li>
			<li role="none">
				<button role="menuitem" type="button" class="sidebar-menu__item"
					data-action="move-area-down" ${downDisabled}>Move down</button>
			</li>
			${deleteItem}
		</ul>
	`;
}
```

- [ ] **Step 10.2: Run the full test suite**

Run: `npm test`
Expected: 104 passing. No new tests — view is verified manually in Task 12.

- [ ] **Step 10.3: Run Biome**

Run: `npx biome check .`
Expected: clean.

- [ ] **Step 10.4: Smoke test in the dev server**

Run: `npm run dev` (or whatever the project's dev server command is — check `package.json`).

Open the app in a browser. The sidebar will look BROKEN visually because the CSS hasn't been added yet (Task 11). But verify the JS works:

- `＋ New area` button is visible (might be unstyled).
- Clicking `＋ New area` should: create an area, change URL to `#area/<id>`, show a rename input in the sidebar row, focus it.
- Click `⋯` on a non-Focus area: dropdown menu appears (unstyled but functional).
- Click Rename → input replaces name.
- Click Move up / Move down: row moves.
- Click Delete (on non-Focus): toast appears, row removed, redirect to Today if was on the area.
- Click Undo on the toast: row reappears (with sections + tasks if any).

If any of those don't work, fix before committing. The visual ugliness is expected; the behavioral correctness must be there.

- [ ] **Step 10.5: Stage and commit**

Files to stage: `src/views/sidebar.js`.

Proposed commit message:

```
feat(sidebar): area CRUD with isRendering guard + pendingRenameValue
```

Stop. Wait for Malin.

---

## Task 11 — CSS: sidebar menu, rename, add-area styles + collapsed-state hides

Adds the visual layer. Mirrors the section CSS patterns (`.section__menu-btn`, `.section-menu`, `.section-menu__item`, `.section__rename-input`, `.area__add-section`) with sidebar selectors.

**Files:**
- Modify: `main.css`

- [ ] **Step 11.1: Append the new CSS at the end of `main.css`**

Append to `main.css`:

```css
/* ===== M5: Sidebar area CRUD ===== */

/* Row becomes a flex container so .sidebar__menu-btn sits next to .sidebar__area */
.sidebar__area-row {
	position: relative;
	display: flex;
	align-items: center;
}

.sidebar__area-row .sidebar__area {
	flex: 1;
}

/* Menu trigger — mirrors .section__menu-btn */
.sidebar__menu-btn {
	background: transparent;
	border: 0;
	color: var(--color-text-muted);
	font-size: 1.25rem;
	cursor: pointer;
	padding: 0;
	min-block-size: 44px;
	min-inline-size: 44px;
	border-radius: 6px;
}
.sidebar__menu-btn:hover {
	color: var(--color-text);
	background: var(--color-bg-hover);
}
.sidebar__menu-btn:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}

/* Dropdown — anchored to the row, mirrors .section-menu */
.sidebar-menu {
	position: absolute;
	top: 100%;
	right: 0.5rem;
	z-index: 10;
	list-style: none;
	margin: 0;
	padding: 0.25rem;
	background: var(--color-bg-elevated);
	border: 1px solid var(--color-border);
	border-radius: 8px;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
	display: flex;
	flex-direction: column;
	min-inline-size: 12rem;
}

/* Menu item — mirrors .section-menu__item, separate class per M4 lesson */
.sidebar-menu__item {
	display: block;
	width: 100%;
	background: transparent;
	border: 0;
	color: var(--color-text);
	font: inherit;
	text-align: left;
	padding: 0.5rem 0.75rem;
	min-block-size: 44px;
	cursor: pointer;
	border-radius: 6px;
}
.sidebar-menu__item:hover:not(:disabled) {
	background: var(--color-bg-hover);
}
.sidebar-menu__item:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}
.sidebar-menu__item:disabled {
	color: var(--color-text-muted);
	cursor: not-allowed;
}

/* Rename row — replaces the nav button with an input */
.sidebar__area-row--editing {
	padding: 0.25rem 0.5rem;
	gap: 0.5rem;
}
.sidebar__rename-input {
	flex: 1;
	background: var(--color-bg-elevated);
	color: var(--color-text);
	border: 1px solid var(--color-accent);
	border-radius: 6px;
	padding: 0.5rem 0.75rem;
	font: inherit;
	min-block-size: 44px;
}
.sidebar__rename-input:focus {
	outline: none;
}

/* + New area button — full-width like .area__add-section */
.sidebar__add-area-row {
	list-style: none;
	margin-top: 0.5rem;
}
.sidebar__add-area {
	background: transparent;
	color: var(--color-text-muted);
	border: 1px dashed var(--color-border);
	border-radius: 8px;
	padding: 0.5rem 0.75rem;
	width: 100%;
	min-block-size: 44px;
	cursor: pointer;
	font: inherit;
	text-align: left;
}
.sidebar__add-area:hover {
	color: var(--color-text);
	border-color: var(--color-accent);
}
.sidebar__add-area:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}

/* Collapsed state — hide CRUD affordances when sidebar shows icons only */
body.is-sidebar-collapsed .sidebar__menu-btn,
body.is-sidebar-collapsed .sidebar__add-area-row,
body.is-sidebar-collapsed .sidebar__rename-input {
	display: none;
}
```

**Why a separate `.sidebar-menu__item` class instead of sharing `.section-menu__item`:** M4 codified the "section ↔ task menu CSS parity" lesson — separate classes, shared appearance enforced by convention. When one changes (e.g., new disabled style), mirror in the other. Sharing would couple visual changes; separating documents the intent that they SHOULD look the same.

- [ ] **Step 11.2: Smoke test the styling**

Refresh the browser. Verify:

- `＋ New area` is a full-width dashed button at the bottom of the sidebar list.
- `⋯` button on each area row sits to the right of the name, hover changes color.
- Click `⋯` → menu appears anchored to the row, on top of other content, with 4 items (or 3 for Focus).
- Move up/down show as disabled (greyed out) at edges.
- Rename input replaces the name span, focused + selected.
- Collapse the sidebar (≡ button): `⋯` buttons and `＋ New area` disappear, area icons remain.

If visual issues, tune CSS values. Don't over-engineer — match section's look.

- [ ] **Step 11.3: Run Biome**

Run: `npx biome check .`
Expected: clean. Biome formats CSS too.

- [ ] **Step 11.4: Stage and commit**

Files to stage: `main.css`.

Proposed commit message:

```
style(sidebar): menu + rename + add-area + collapsed-state hides
```

Stop. Wait for Malin.

---

## Task 12 — E2E walkthrough + done-criteria verification

No code, no commit. This task is the manual verification from the spec's "Done criteria" section. The agent should NOT modify code during this task — only run the app and report what works / doesn't work.

**Files:** none modified.

- [ ] **Step 12.1: Start the dev server**

Run: `npm run dev`. Open the app.

- [ ] **Step 12.2: Test create flow**

- Click `＋ New area`. URL should become `#area/<some-uuid>`.
- Sidebar shows the new row with input in rename mode. Default name "New area" is selected (highlighted).
- Type "Test". Press Enter. Row reads "• Test" (or your icon fallback).
- ✅ if all of the above. ❌ if anything is wrong — capture the symptom and stop.

- [ ] **Step 12.3: Test rename flow**

- Click `⋯` on the new "Test" area → Rename.
- Input mounts with "Test" selected.
- Type "Studies", press Enter. Row reads "• Studies".
- Click `⋯` → Rename → press Esc. Row reverts to "Studies" (unchanged).
- Click `⋯` → Rename → clear input → blur. Row reverts to "Studies" (empty commit cancels).

- [ ] **Step 12.4: Tick-resilience test (the M5 hardening payoff)**

- Click `⋯` → Rename. Input mounts, "Studies" selected.
- Type "Stu" (or any partial name).
- Wait for the 60s tick to fire (or shorten `TICK_MS` temporarily in controller.js for testing — REVERT before commit).
- Expected: typed text "Stu" persists in the input. Rename mode stays active. Cursor where you left it. Keep typing.

- [ ] **Step 12.5: Test move flow**

- Create two more areas. Click `⋯` on the middle one → Move up. Row moves up. Focus returns to `⋯` on the moved row.
- Click `⋯` → Move down. Row moves down. Focus returns to `⋯`.
- At the top, Move up is `disabled` (greyed out). At the bottom, Move down is `disabled`.
- Focus area: Move down enabled if not last; Move up enabled if not first.

- [ ] **Step 12.6: Test cascade delete from non-active area**

- Navigate to Focus area (or Today).
- Add 2 sections + 3 tasks to "Studies".
- Click `⋯` on "Studies" → Delete.
- Toast appears: `"Studies" and 2 sections, 3 tasks deleted`. Sidebar drops the row. URL unchanged.
- Click Undo. Toast disappears. Sidebar shows "Studies" again. Navigate to it — sections and tasks all back.

- [ ] **Step 12.7: Test cascade delete from active area**

- Navigate to "Studies" (or recreate it with content if Undo skipped).
- Click `⋯` → Delete.
- Expected: URL changes to `#today`. Main pane shows Today. Sidebar drops "Studies". No "Area not found" flash visible.
- Toast shows. Click Undo. Sidebar restores. URL stays on Today.

- [ ] **Step 12.8: Test Focus area undeletability**

- Click `⋯` on Focus.
- Menu shows Rename / Move up / Move down only. NO Delete item.

- [ ] **Step 12.9: Test sidebar collapse mid-rename**

- Click `⋯` → Rename on any area.
- While input is active, click the ≡ toggle to collapse the sidebar.
- Expected: rename commits (if non-empty) or cancels (if empty). Sidebar collapses to icons only. No orphaned input.
- Toggle back to expand. Sidebar shows the row in normal nav state (no rename input).

- [ ] **Step 12.10: Test sidebar collapse mid-menu**

- Click `⋯` to open a menu.
- Click ≡ to collapse.
- Expected: menu closes. Sidebar collapses.

- [ ] **Step 12.11: SR check (Windows Narrator or NVDA)**

- Tab to `⋯` button → announces "Area options: <Name>, collapsed/expanded button".
- Open menu → Tab through items → each reads "Rename / Move up / Move down / Delete".
- Tab to rename input → announces "Rename area: <Name>, edit".
- Cascade delete → toast reads "<Name> and N sections, M tasks deleted".

- [ ] **Step 12.12: Regression check**

- M3 section CRUD: open an area, `⋯` on a section → Rename / Move up / Move down / Delete all work.
- M4 task reorder: `⋯` on a task → Move up / Move down / Delete work.
- Capture bar: still works on both Today and area routes.

- [ ] **Step 12.13: Report results**

Summarize PASS / FAIL for each of 12.2 through 12.12. If anything FAILS, document the symptom and stop. Malin will decide whether to fix in this milestone or defer.

If everything PASSES, M5 is shipped. Update memory:

```
2026-05-19 — M5 shipped: area CRUD + cascade-delete + 104 tests, M1-M5 in.
```

(Or whatever the actual final test count was.) Malin handles the memory write per project convention.

---

## Self-review notes

**Spec coverage:** Every requirement in `2026-05-19-ignite-m5-area-crud-design.md` maps to a task above:
- §Model gaps (areas.js, sections.js, tasks.js) → Tasks 1-7
- §View (sidebar.js rewrite) → Task 10
- §Controller (sidebarCallbacks, moveArea, deleteAreaCascade, onCommitRename swallow) → Tasks 8-9
- §CSS additions → Task 11
- §Security (escapeHtml sites) → built into Task 10's template code
- §Accessibility (aria-current, aria-label, touch targets, role=menu/menuitem) → built into Task 10 + Task 11
- §Async-safe invariants (isRendering, redirect-first, restore order, FOCUS_ID guard) → Tasks 8 + 10
- §Known limitations → documented in spec; no task (accepted)
- §Done criteria → Task 12

**Type/signature consistency:** verified across tasks — `areas.rename(id, name)`, `areas.swapOrder(idA, idB)`, `areas.removeMany(ids)`, `areas.restore(snapshot)`, `areas.restoreMany(snapshots)` all match the spec's code blocks. `sidebarCallbacks` keys (`onAddArea`, `onCommitAreaRename`, `onMoveAreaUp`, `onMoveAreaDown`, `onDeleteArea`) match the view's expected callback names.

**Placeholder scan:** no "TODO", "TBD", or "implement later." Every code block is complete. The only "fill in" is Step 7.3's conditional `.map(fromStorage)` choice — guarded by an instruction to read `tasks.restore` first to pick the right form. Defensible because the answer depends on existing code the agent must read at execution time.
