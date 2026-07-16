# Cascade Focus Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a cascade delete (section or area), route keyboard focus to a surviving neighbour instead of letting it drop to `document.body`.

**Architecture:** The controller computes the focus target *before* the model writes (the snapshot it already takes), then — *after* the writes land — sets a pending flag on the view and forces one consuming `applyState()` render. The view consumes the flag with a post-render DOM lookup, never a stored element ref, because every `innerHTML` rewrite detaches captured references and `.focus()` on a detached node is a silent no-op. This mirrors the existing `focusTaskMenu` + `closeRecurrenceEditor({rerender:true})` pattern already in the codebase.

**Tech Stack:** Vanilla JS (ES modules, MVC), Vite, Vitest, Biome. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-16-ignite-cascade-focus-design.md`

## Global Constraints

- **Baseline is green: 166 tests, Biome clean, build clean.** Every task ends green. `npm run test:run`, `npx biome check .`, `npm run build`.
- **Do NOT touch `base.css` or `design-system/`.** Read-only, no exceptions. This work needs no CSS at all.
- **No model change, no DB version bump.** This is view/controller focus routing only.
- **Interpolated ids in selectors are ALWAYS `CSS.escape`d.** Eight existing call sites do this (`area.js:179,185,574,582,607,615`; `sidebar.js:122,301,312,321`; `today.js:81,319`). Follow it.
- **Post-`innerHTML` focus = pending flag → post-render DOM lookup.** Never store an element reference across a render.
- **Focus lookups target CSS classes** (`.section__menu-btn`, `.area__add-section`, `.sidebar__home`), not `data-action`. `data-action` is the click-delegation contract; classes are the focus contract.
- **Views clear every closure flag in `destroy()` with an explicit list** — no "etc.". Add each new flag to that list.
- **TDD applies to the pure seam only** (`src/utils/sections.js`). Views are verified manually via Preview MCP — there is no JSDOM in this project, so do not add view unit tests.
- **Commits: Malin is the sole author. NEVER add a `Co-Authored-By` trailer or any Claude attribution.** Project convention is that Malin commits via GitHub Desktop: where a task says "Commit", propose the message + staged files and wait for her, unless she has given per-session consent to commit directly.

---

### Task 1: `previousSectionId` pure helper

**Files:**
- Modify: `src/utils/sections.js` (append — currently holds only `reorderSections`)
- Test: `tests/utils/sections.test.js` (append a second `describe` block)

**Interfaces:**
- Consumes: nothing.
- Produces: `previousSectionId(sections: Array<{id: string, areaId: string, name: string, order: number}>, sectionId: string) → string | null` — the id of the section immediately before `sectionId` when sorted by `order`; `null` when it is first, absent, or the list is empty. The caller passes **one area's sections** (the peers), matching `reorderSections`' existing contract in the same file.

- [ ] **Step 1: Write the failing tests**

Append to `tests/utils/sections.test.js`. Note the existing `make` helper at the top of the file (`const make = (id, order) => ({ id, areaId: "focus", name: id, order });`) is already in scope — reuse it, do not redefine it.

```js
describe("previousSectionId", () => {
	it("returns the predecessor's id for a middle section", () => {
		const input = [make("a", 0), make("b", 1), make("c", 2)];
		expect(previousSectionId(input, "b")).toBe("a");
	});

	it("returns null for the first section", () => {
		const input = [make("a", 0), make("b", 1)];
		expect(previousSectionId(input, "a")).toBeNull();
	});

	it("returns null for the only section", () => {
		expect(previousSectionId([make("a", 0)], "a")).toBeNull();
	});

	it("returns null for an unknown id", () => {
		const input = [make("a", 0), make("b", 1)];
		expect(previousSectionId(input, "nope")).toBeNull();
	});

	it("returns null for an empty list", () => {
		expect(previousSectionId([], "a")).toBeNull();
	});

	it("sorts by order — non-contiguous values", () => {
		// Defensive: non-contiguous orders happen after a restore.
		const input = [make("a", 0), make("b", 5), make("c", 99)];
		expect(previousSectionId(input, "c")).toBe("b");
	});

	it("sorts by order — input array not already sorted", () => {
		const input = [make("c", 2), make("a", 0), make("b", 1)];
		expect(previousSectionId(input, "c")).toBe("b");
	});

	it("does not mutate the input array", () => {
		const input = [make("b", 1), make("a", 0)];
		const snapshot = input.map((s) => ({ ...s }));
		previousSectionId(input, "b");
		expect(input).toEqual(snapshot);
	});
});
```

Also extend the import on line 2 of that file:

```js
import { previousSectionId, reorderSections } from "../../src/utils/sections.js";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- tests/utils/sections.test.js`
Expected: FAIL — `previousSectionId is not a function` (the import resolves to `undefined`).

- [ ] **Step 3: Write the minimal implementation**

Append to `src/utils/sections.js`:

```js
// Pure helper: returns the id of the section immediately before `sectionId`
// when sorted by `order`, or null when it is first, absent, or the list is
// empty. Caller passes ONE area's sections (the peers) — same contract as
// reorderSections above. Handles non-contiguous and unsorted input.
//
// Used for cascade-delete focus routing: the deleted section's ⋯ button is
// gone after the delete, so focus is routed to its predecessor's ⋯ instead
// of dropping to <body>. A null return means "no predecessor" — the caller
// falls back to the area's "＋ New section" button.

export function previousSectionId(sections, sectionId) {
	const sorted = [...sections].sort((a, b) => a.order - b.order);
	const idx = sorted.findIndex((s) => s.id === sectionId);
	if (idx <= 0) return null; // -1 = not found, 0 = first → no predecessor
	return sorted[idx - 1].id;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- tests/utils/sections.test.js`
Expected: PASS — 8 new tests. Then run the full suite: `npm run test:run` → **174 passing** (166 baseline + 8).

- [ ] **Step 5: Lint**

Run: `npx biome check .`
Expected: no diagnostics. If it reports formatting, run `npx biome check --write .` and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/utils/sections.js tests/utils/sections.test.js
git commit -m "feat(utils): add previousSectionId helper

Pure seam for cascade-delete focus routing: given one area's
sections, return the predecessor by order, or null when first."
```

---

### Task 2: `area.js` — consume a section-delete focus flag

**Files:**
- Modify: `src/views/area.js` (closure var near the other `pendingFocus*` declarations; a `doRender` block after the `pendingMenuFocusTaskId` block ending at line 619; the returned object near `focusTaskMenu` at line 640; the `destroy()` explicit clear list)

**Interfaces:**
- Consumes: nothing from Task 1 directly (the controller does the computing).
- Produces: `focusAfterSectionDelete(prevSectionId: string | null) → void` on the area view's returned object. Sets a pending flag; does **NOT** call `doRender` — the controller's `applyState()` provides the consuming render. `null` means "no predecessor, focus the add-section button".

- [ ] **Step 1: Declare the flag**

Add alongside the other `pendingFocus*` closure declarations near the top of `createAreaView`:

```js
// null | { prevSectionId: string | null } — the object wrapper matters:
// prevSectionId is legitimately null ("focus ＋ New section"), so a bare
// null flag couldn't distinguish "not set" from "set to no-predecessor".
let pendingFocusAfterSectionDelete = null;
```

- [ ] **Step 2: Consume it in `doRender`**

Insert **after** the `pendingMenuFocusTaskId` block (which currently ends at line 619, immediately before `doRender`'s closing brace). It goes last deliberately.

```js
		// Post-render lookup: a cascade delete removed the section whose ⋯ had
		// focus, so focus would fall to <body>. Route it to the previous
		// section's ⋯, or "＋ New section" when the deleted one was first/only
		// (or when the predecessor is itself gone — a cascade race).
		//
		// Consumed LAST and cleared UNCONDITIONALLY: a rename input that
		// claimed focus above must win, and a flag set for a render that never
		// reaches this branch must not leak into a later, unrelated render.
		if (pendingFocusAfterSectionDelete) {
			const { prevSectionId } = pendingFocusAfterSectionDelete;
			pendingFocusAfterSectionDelete = null;
			if (!renamingId && !renamingTaskId) {
				const prevTrigger = prevSectionId
					? rootEl.querySelector(
							`[data-section-id="${CSS.escape(prevSectionId)}"] .section__menu-btn`,
						)
					: null;
				(prevTrigger ?? rootEl.querySelector(".area__add-section"))?.focus();
			}
		}
```

- [ ] **Step 3: Expose the public hook**

Add to the returned object, directly after the existing `focusTaskMenu(taskId)` method (line 640-642):

```js
		// Controller hook: after a section cascade delete, route focus to a
		// surviving neighbour. Sets the pending flag ONLY — the controller's
		// applyState() after its model writes provides the consuming render.
		// Setting it before those writes would let the first notify's render
		// consume it, and the second render's innerHTML rewrite would then
		// detach the focused button anyway. Mirrors focusTaskMenu.
		focusAfterSectionDelete(prevSectionId) {
			pendingFocusAfterSectionDelete = { prevSectionId };
		},
```

- [ ] **Step 4: Clear it in `destroy()`**

Add to the explicit clear list in `destroy()`, alongside `pendingFocusSectionId = null;` etc.:

```js
			pendingFocusAfterSectionDelete = null;
```

- [ ] **Step 5: Verify the suite and lint still pass**

Run: `npm run test:run && npx biome check . && npm run build`
Expected: 174 passing, no Biome diagnostics, build clean. No new tests — this is view wiring, verified manually in Task 5 per project convention.

- [ ] **Step 6: Commit**

```bash
git add src/views/area.js
git commit -m "feat(area): route focus after a section cascade delete

Add focusAfterSectionDelete(prevSectionId): pending flag consumed
by a post-render DOM lookup, falling back to the add-section button
when the deleted section had no predecessor."
```

---

### Task 3: `sidebar.js` — consume an area-delete focus flag

**Files:**
- Modify: `src/views/sidebar.js` (closure var near the other `pendingFocus*` declarations; a `doRender` block after the `pendingMenuFocusAreaId` block ending at line 325; the returned object near `enterRename` at line 355; the `destroy()` explicit clear list)

**Interfaces:**
- Consumes: nothing.
- Produces: `focusHome() → void` on the sidebar view's returned object. Sets a pending flag; does **NOT** call `doRender`.

**Context the implementer needs:** there is no separate "Today" nav item. The `Ignite` wordmark **is** it — `.sidebar__home`, `data-action="go-today"`, and it takes `aria-current="page"` on the Today route (`sidebar.js:424`). It is also the element `openDrawer` focuses, so this reuses an established target.

- [ ] **Step 1: Declare the flag**

Add alongside the other `pendingFocus*` closure declarations near the top of `createSidebarView`:

```js
let pendingFocusHome = false; // → focus the "Ignite" wordmark (the Today nav item)
```

- [ ] **Step 2: Consume it in `doRender`**

Insert **after** the `pendingMenuFocusAreaId` block (which currently ends at line 325, immediately before `doRender`'s closing brace).

```js
		// Post-render lookup: an area cascade delete removed the row whose ⋯
		// had focus and redirected to #today, so focus would fall to <body>.
		// The wordmark IS the Today nav item — focusing it lands the user
		// where the redirect took them.
		//
		// Cleared UNCONDITIONALLY; skipped while a rename is live so it can't
		// steal focus out of an open rename input.
		if (pendingFocusHome) {
			pendingFocusHome = false;
			if (!renamingAreaId) {
				rootEl.querySelector(".sidebar__home")?.focus();
			}
		}
```

- [ ] **Step 3: Expose the public hook**

Add to the returned object, directly before the existing `enterRename(areaId)` method (line 355):

```js
		// Controller hook: after an area cascade delete, put focus on the
		// wordmark (= the Today nav item, where the redirect just sent the
		// user). Sets the pending flag ONLY — the controller's applyState()
		// after its model writes provides the consuming render.
		focusHome() {
			pendingFocusHome = true;
		},
```

- [ ] **Step 4: Clear it in `destroy()`**

Add to the explicit clear list in `destroy()` ("Clear every closure flag — explicit list, not 'etc.'"):

```js
			pendingFocusHome = false;
```

- [ ] **Step 5: Verify the suite and lint still pass**

Run: `npm run test:run && npx biome check . && npm run build`
Expected: 174 passing, no Biome diagnostics, build clean.

- [ ] **Step 6: Commit**

```bash
git add src/views/sidebar.js
git commit -m "feat(sidebar): route focus to the wordmark after an area delete

Add focusHome(): pending flag consumed by a post-render DOM lookup,
skipped while a rename is live."
```

---

### Task 4: `controller.js` — wire both cascades

**Files:**
- Modify: `src/controller.js` (import near line 9; `onDeleteSection` at lines 307-324; `deleteAreaCascade` at lines 366-419)

**Interfaces:**
- Consumes: `previousSectionId(sections, sectionId) → string | null` from Task 1; `currentMainView.focusAfterSectionDelete(prevSectionId)` from Task 2; `sidebar.focusHome()` from Task 3.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Add the import**

`src/controller.js` currently imports `formatOccurrenceLabel` from `./utils/time.js` (line 10) and has no import from `./utils/sections.js`. Add one, keeping Biome's import ordering (alphabetical by path — `./utils/sections.js` sorts before `./utils/text.js`):

```js
import { previousSectionId } from "./utils/sections.js";
```

- [ ] **Step 2: Wire `onDeleteSection`**

Replace the body of `onDeleteSection` (lines 307-324) with:

```js
			onDeleteSection: async ({ sectionId }) => {
				const allSections = await sections.list();
				const sectionSnapshot = allSections.find((s) => s.id === sectionId);
				if (!sectionSnapshot) return;
				const taskSnapshots = await tasks.listBySection(sectionId);

				// Focus target computed BEFORE the writes — afterwards the section
				// and its ordering context are gone from state.
				const peers = allSections.filter(
					(s) => s.areaId === sectionSnapshot.areaId,
				);
				const prevId = previousSectionId(peers, sectionId);

				// Empty-layer guard: removeMany([]) still notifies, adding another
				// in-flight render to the pile the drain below has to absorb.
				// Mirrors deleteAreaCascade.
				if (taskSnapshots.length) {
					await tasks.removeMany(taskSnapshots.map((t) => t.id));
				}
				await sections.remove(sectionId);

				// DRAIN, then flag, then one final render. notify() is synchronous
				// and does NOT await its subscribers, so the last write's own
				// notify-render is still queued when remove() resolves — our
				// continuation is a microtask and beats it. Flagging here without
				// the drain lets that queued render consume the flag and focus
				// correctly, and then THIS applyState's render rewrites innerHTML
				// and drops focus to <body>. The drain is safe because the pending
				// renders queued their IDB reads first and reads complete FIFO,
				// and no notify fires after the last write.
				await applyState();
				currentMainView?.focusAfterSectionDelete?.(prevId);
				await applyState();

				toast.show({
					message: cascadeMessage(sectionSnapshot.name, taskSnapshots.length),
					durationMs: CASCADE_TOAST_MS,
					onUndo: async () => {
						await sections.restore(sectionSnapshot);
						await tasks.restoreMany(taskSnapshots);
					},
				});
			},
```

- [ ] **Step 3: Wire `deleteAreaCascade`**

Two edits inside `deleteAreaCascade`.

**(a)** Immediately after the `FOCUS_ID` guard (line 373, `if (areaId === FOCUS_ID) return;`) and **before** the step-2 redirect, add:

```js
		// Snapshot BEFORE the redirect below. That redirect fires hashchange,
		// whose onHashChange runs closeDrawer() — setting drawerOpen = false and
		// focusing .topbar__menu — while the awaits below yield. Reading
		// drawerOpen later would report false on mobile, and we'd then focus
		// .sidebar__home inside a visibility:hidden drawer, losing focus to
		// <body>: exactly the bug this routing exists to fix.
		const wasDrawerOpen = drawerOpen;
```

**(b)** Between `await areas.remove(areaId);` (line 397) and the `toast.show({` call (line 400), add:

```js
		// DRAIN, then flag, then one final render — same reasoning as
		// onDeleteSection above, plus one extra competitor here: the redirect's
		// onHashChange fires its own un-awaited applyState().
		await applyState();
		// Desktop only. On mobile the drawer was the user's path to this menu,
		// and closeDrawer's return-to-.topbar__menu is already correct — defer
		// to it rather than compete.
		if (!wasDrawerOpen) sidebar.focusHome();
		await applyState();
```

- [ ] **Step 4: Verify the suite and lint still pass**

Run: `npm run test:run && npx biome check . && npm run build`
Expected: 174 passing, no Biome diagnostics, build clean.

- [ ] **Step 5: Commit**

```bash
git add src/controller.js
git commit -m "feat(controller): wire cascade-delete focus routing

Section delete routes focus to the previous section's menu button;
area delete routes it to the sidebar wordmark on desktop. Both set
their flag after the model writes and force one consuming render.

drawerOpen is snapshotted before the redirect: hashchange runs
closeDrawer() while the writes await, so a later read reports false
on mobile and would focus into a hidden drawer."
```

---

### Task 5: Verify end-to-end in the browser

**Files:** none modified. This task produces evidence, not code.

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: a pass/fail report per scenario.

**Context:** `.claude/launch.json` (gitignored, local-only) defines `ignite-dev` → `npm run dev` on `:5173`. Views have no unit tests in this project — this task IS their test.

**Tool names have changed since the lessons were written.** The project's `lessons.md` refers to `preview_eval` / `preview_click` / `preview_resize` / `preview_screenshot`. The current Browser MCP equivalents are `javascript_tool` (eval), `computer` with `action: "left_click"` (click), `resize_window` (resize), and `computer` with `action: "screenshot"`. The lessons below still hold — only the names moved.

**Method, per the project's E2E lessons — read these before starting, they are hard-won:**
- Assert with `document.activeElement` probes inside a **single** `javascript_tool` call. Wall-clock between separate calls is not deterministic.
- A click can **silently no-op** (reports success, dispatches no DOM click). If one seems not to register, fall back to `el.dispatchEvent(new MouseEvent("click", {bubbles:true, detail:1}))`. But note: a *dispatched* click does not drive focus like a real one, so for focus assertions use a real click once proven to work.
- Do not block on the screenshot — it can hang while eval stays live. DOM probes are better proof here anyway.
- Re-query the DOM after every re-render; refs go stale mid-eval.

- [ ] **Step 1: Start the dev server**

Use `preview_start` with `{name: "ignite-dev"}`. Seed an area with at least three sections (one containing tasks) via the UI.

- [ ] **Step 2: Section delete — middle section**

Focus a middle section's `⋯`, open it, click Delete. Probe: `document.activeElement.className` contains `section__menu-btn`, and its closing `[data-section-id]` is the **predecessor's** id.
Expected: PASS.

- [ ] **Step 3: Section delete — first section, others remain**

Expected: `document.activeElement.className` contains `area__add-section`.

- [ ] **Step 4: Section delete — the only section**

Expected: `document.activeElement.className` contains `area__add-section`.

- [ ] **Step 5: Section delete — a section containing tasks (the two-notify trap)**

Delete a section with 2+ tasks in it. Probe `document.activeElement` **after awaiting a tick** inside the same eval — not immediately:

```js
await new Promise((r) => setTimeout(r, 250));
return document.activeElement.className;
```

Expected: still the predecessor's `.section__menu-btn`. An implementation that sets the flag before the writes passes an immediate probe and **fails this one** — that is the point of this step.

- [ ] **Step 6: Area delete — desktop**

At ≥768px, delete a non-Focus area from its sidebar `⋯`.
Expected: `document.activeElement.className` contains `sidebar__home`; route is `#today`.

- [ ] **Step 7: Area delete — mobile, from the drawer, deleting the ACTIVE area**

Resize to 375px wide, navigate to the area you will delete (it must be the **active** route — that is what triggers the redirect this guard exists for), open the drawer, delete it from its `⋯`.
Expected: `document.activeElement.className` contains `topbar__menu`; drawer closed; focus is **not** on `.sidebar__home`. This is the `wasDrawerOpen` guard — if it regressed, focus lands on `.sidebar__home` or `body`.

**Known gap, do not report as a failure:** deleting a **non-active** area on mobile fires no redirect, so no `closeDrawer` runs, `focusHome()` is skipped anyway, and focus lands on `body`. `wasDrawerOpen` conflates "drawer open" with "closeDrawer will fire". Logged as MINOR-1 for triage at the final review.

- [ ] **Step 8: Regression — no console errors**

Read console messages across all scenarios.
Expected: zero errors.

- [ ] **Step 9: Report**

Report each scenario pass/fail with the actual `activeElement` observed. Do not claim a scenario passed without the probe output for it.

---

## Definition of done

- 174 tests passing (166 baseline + 8 new), Biome clean, build clean.
- All seven E2E scenarios pass with probe evidence.
- No CSS touched. `base.css` and `design-system/` untouched.
- Spec §8 invariants intact: pending-flag-then-DOM-lookup, `CSS.escape` on every interpolated id, explicit `destroy()` clear lists.
- Deferred and NOT in this plan (spec §1): the `/` shortcut (rides with the settings surface — see spec Appendix A), single task delete focus, undo focus.
