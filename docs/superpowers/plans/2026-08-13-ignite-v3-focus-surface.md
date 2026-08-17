# Ignite v3 — Plan 3: The Focus surface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge Today and Focus into one landing surface with four tabs — Today, Tomorrow, Starred, Focus — so the notepad capture writes into is somewhere you can actually look, and the dates Plan 2 made real finally have a surface that shows them.

**Architecture:** The landing route is renamed `today` → `focus` and `#area/focus` redirects onto it, so the Focus area stops being a second door to the same tasks. `src/views/today.js` is renamed to `src/views/focus.js` and grows a tab strip: view-owned tab state, four mutually exclusive panels, and the §3.3 lifecycle (close menu → commit rename → render → focus the tab). All bucketing moves into one new pure function, `groupTasksForFocus`, which adds a Tomorrow bucket and a notepad bucket to the existing cascade. Rows gain an area badge, and at ≥768px the badge and time become fixed-width columns that line up across every group.

**Tech Stack:** Vanilla JS (MVC), Vite, Vitest, Biome. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-11-ignite-v3-focus-design.md` — decisions D1 and D3, §3, §7, §8, and the §9 function table.

**Status:** stress-tested 2026-08-13, 13 findings folded in — no criticals, four important. The four worth knowing before you read a step and think it looks over-built: the `#area/focus` redirect uses `replaceState` because assigning `location.hash` builds a back-button trap; the capture toast snapshots its preconditions before its `await` because reading them after makes it announce the wrong destination; `doRender` re-asserts tab focus because the 60-second tick otherwise throws it to `<body>`; and `pendingFocusTaskId` has a fallback because rescheduling a task off the current tab is now the ordinary case, not an edge one.

## Global Constraints

- **Mobile-first CSS.** Baseline styles target the phone; layer up with `@media (min-width: 768px)`. No `max-width` queries.
- **`design-system/` is vendored and read-only.** Never hand-edit. All project CSS goes in `main.css` at the repo root (NOT `src/styles/main.css`).
- **Escape every user-authored string** through `escapeHtml` before interpolating. The area badge is a new interpolation site for a user-authored area name.
- **≥44×44 px** for every new control: each tab and the File button. **At 375px the tab strip scrolls horizontally — the targets do not shrink** (§8.1). §8.1 also lists the capture bar's destination chip; **it is deliberately excluded** — the chip is a non-interactive `<span>`, not a control, and sizing it to 44px would unbalance the capture bar. One of the three recorded Plan 1 corrections the spec still carries.
- **`renderPageHeader` in `controller.js` stays the only `<h1>` emitter in the app.** Views render into `#main-root`, a later sibling of `#page-header`, so they cannot own it.
- **Never put `overflow` on `.group__list` or `.group`.** The task ⋯ menu injects inside the `<li>`; any clipping ancestor cuts it off. (`overflow-x` on the *tab strip* is fine — no menu lives there.)
- **`.task` stays a flex row.** `.task__title` keeps `flex: 1; min-width: 0`, and `.task--editing`'s padding must keep tracking `.task`'s. Do not convert the row to grid.
- **Tab counts and area badges use real token colours, never `opacity`** (§8.2). v2 shipped zero contrast violations; hold the line.
- **Any tab transition is gated on `prefers-reduced-motion`.**
- **`utils/` never imports from `model/`.** Focus-area membership reaches the pure functions as a list of section ids the controller resolves.
- **Line endings are LF**, pinned by `.gitattributes`. Do not resolve a Biome complaint by changing Biome.
- **No AI attribution in commit messages.** No `Co-Authored-By`, no "Generated with Claude Code".
- Run `npm run check` (Biome) before every commit. Zero warnings, zero `biome-ignore`.
- Green baseline before starting: **228 tests / 15 files**, Biome clean, build clean.
- **The suite grows, so no step asserts a fixed total.** Tasks 1–5 each add cases; Tasks 6–14 add none. Projection, for sanity only: Task 1 `+2` → 230, Task 2 `+5` → 235, Task 3 `+2` → 237, Task 4 `+6` → 243, Task 5 `+4` and a 16th file → **247 / 16**, and flat thereafter. **Read the real number off the runner every time and report that** — a projection is not evidence, and this project has shipped a plan whose arithmetic was wrong before.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/controller.js` | modify | Route rename + `#area/focus` redirect; page header (heading, greeting, summary); capture toast; tab wiring |
| `src/utils/time.js` | modify | `groupTasksForFocus` (replaces `groupTasksForToday`), `pickNextTask` (new signature), `formatDayGreeting`, `summariseDay` |
| `src/utils/areas.js` | **create** | `areaForTask` — resolves the row's area badge |
| `src/views/focus.js` | **create** (git mv of `today.js`) | The Focus surface: tabs, panels, menus, rename, File |
| `src/views/today.js` | **delete** (via git mv) | — |
| `src/views/focus-tabs.js` | **create** | Pure template for the tab strip + the `TABS` list |
| `src/views/task.js` | modify | Area badge slot; row order reshuffled for column alignment |
| `src/views/toast.js` | modify | Generic action button (`onAction` / `actionLabel`) instead of a hardcoded Undo |
| `src/views/sidebar.js` | modify | Focus stops being a listed area; route name |
| `src/views/topbar.js` | modify | `go-today` → `go-focus` |
| `tests/unit/parse-hash.test.js` | modify | Landing route is `focus` |
| `tests/utils/time.test.js` | modify | New grouping, sort, hero, greeting and summary contracts |
| `tests/utils/areas.test.js` | **create** | `areaForTask` |
| `tests/utils/capture.test.js` | modify | Route-name copy in one fixture |
| `main.css` | modify | Tab strip, panels, badge/time columns, empty states, phone padding |
| `README.md` | modify | Describe the Focus surface |

### Four deliberate deviations from the spec, and why

**1. Tab state is view-owned, not controller-owned.** §3.3 says "controller-owned transient state, the same call as `drawerOpen`". It is owned by `focus.js` instead. Three reasons: all four §3.3 lifecycle steps (close the menu, commit the live rename, render, focus the tab button) act on state that already lives in the view — `openMenuTaskId`, `taskMenuMode`, `renamingTaskId`, `pendingRenameTaskValue` — and the controller cannot touch any of them; the spec's own rule "it always resets to Today on mount" comes for free from a closure that dies with the view, whereas a controller field would need an explicit reset in `mountMainView`; and `drawerOpen` is controller-owned because the drawer is *chrome*, outside every view, which the tabs are not. The controller still drives the tab where it needs to, through the `selectTab(tabId)` / `getActiveTab()` methods the view exposes (Task 13).

**2. `formatDayGreeting` builds its string from constant arrays, not `toLocaleDateString`.** Today's `renderPageHeader` calls `state.now.toLocaleDateString(undefined, {...})`, which returns a different string per locale and is therefore untestable without pinning a locale. §9 requires `formatDayGreeting(now)` as a tested pure function and §3.1 fixes the format as `Tuesday 11 August`. Constant arrays give exactly that, deterministically, and match how `formatTimeLabel` and `formatOccurrenceLabel` already work in the same file. **Consequence: on a Norwegian-locale browser the greeting changes from "tirsdag 11. august" to "Tuesday 11 August".** The rest of the app is English-only ("Today", "Overdue", "Starred", "Next"), so this makes the surface consistent rather than half-localised — but it is a visible change and it is Malin's to reject.

**3. `pickNextTask` changes signature to take the grouped buckets.** It currently takes the raw task list and scans *every* dated task, so it can promote something due next Friday into a hero labelled "Next" on the Today tab. It also treats an untimed task due today as overdue, because an untimed task is stored at local midnight and `dueAt > now` is false from 00:01 — the defect Plan 2 recorded and explicitly deferred to this plan. Taking `groups` fixes both: the candidates are exactly what the Today tab renders. Task 3 rewrites its four existing tests.

**4. The toast's action button is renamed, not aliased.** §3.4 needs a toast with a **View** action. `toast.show` currently hardcodes the label "Undo" and names the handler `onUndo`. Passing a View action through a slot called `onUndo` would be a lie at seven call sites; adding a second alias would be worse. Task 6 renames the pair to `onAction` / `actionLabel` (defaulting to `"Undo"`) and the CSS class `.toast__undo` → `.toast__action`, and updates all five `onUndo:` call sites. The nine-variable `clearActive()` reset contract is preserved exactly — one variable is renamed, none added or removed.

### Four gaps the spec does not cover

**A task due later than tomorrow appears on no tab.** The §3.2 table has Today, Tomorrow, Starred and the notepad; a task due next Friday matches none of them, and the date-beats-star cascade means starring it does not rescue it either. It is still visible in its own area, so nothing is lost — but the landing surface cannot show you the week. **Not fixed here.** The answer is the Calendar tab, which §11 defers explicitly and which the tab strip this plan builds is the structure to hang. Recorded so it is a decision.

**Filing a task out of the notepad leaves focus with nowhere to return.** `pick-move-target` sets `pendingFocusTaskId` on the moved task, with the comment "the task stays in Today". That is true on the dated tabs — a move between sections changes neither `dueAt` nor `starred` — and false on the notepad, where filing is precisely what removes the row from the tab. Task 11 branches: on the Focus tab, focus goes to the Focus **tab button**, which always exists, rather than to a ⋯ that is about to be detached. §5's prescribed `focusAfterFile(nextId)` drain is deliberately not built, matching Plan 1's decision to reuse the move picker wholesale.

**`area.js`'s File button does not move focus into the picker it opens.** §4.2's focus contract says the picker opens with focus on the first section item; `area.js:494-502` opens the picker without setting `pendingMenuFocusTaskId`, so focus stays on a File button that the synchronous re-render has just detached. `focus.js` does it correctly (Task 11), which leaves the two surfaces inconsistent. **Not fixed here** — `area.js` is out of this plan's scope and the fix is one line whenever someone is in that file. Recorded as a follow-up.

**The Starred tab's cross-area `order` sort stays arbitrary.** `order` is only meaningful within a section, so sorting a cross-area list by it produces an arbitrary sequence. §3.2 flags this as an inherited wart and leaves it; this plan carries it unchanged so it changes one thing at a time.

### Considered and deliberately not fixed

- **A tab switch during a rename whose model write rejects leaves the tab visually unchanged.** `selectTab` fires the rename commit and then does *not* render, so the write's own notify-render can render the new tab and consume the focus flag in one pass. Rendering here as well would focus the tab button and let the queued render detach it — focus to `<body>`, the exact trap the cascade-focus drain exists to prevent, and the view cannot drain (only the controller can `await applyState()`). If the write rejects — the task was cascade-deleted mid-rename — no notify fires and the tab does not visibly change until the next render. This is identical in kind to the race `commitTaskRenameFromInput` already carries today, where a rejected write leaves `pendingFocusTaskId` unconsumed. Same trade, same reasoning, not made worse.
- **Tabs are not in the URL.** §13 decides this: the app must always open on Today, and tab history would fight that.
- **The area badge is `display: none` on phones, which strips it from the accessibility tree too.** The area is not conveyed by any other means on a phone row. Accepted: §7 makes dropping it a layout decision, and the alternative — a visually-hidden badge — adds a per-row string to every screen-reader row for information the sighted phone user does not get either.
- **Both `renderPageHeader` and the view call `groupTasksForFocus` on the same state.** Two O(n) passes per render instead of one. They are handed the identical `state` object, including the same `now`, so the summary counts and the tab counts agree by construction — which is the property worth having. Threading the groups through `state` would make the view depend on the controller having computed them.
- **The capture toast can in principle paint over an open capture picker.** The known latent trap: `#toast-root` is z-index 100 and beats a picker inside `#capture-root`'s z-index-60 stacking context. Unreachable here — the toast only fires on the Focus route, where `captureDestination` returns `{ kind: "focus" }` and the picker never opens.

*The rest of this list came out of the 2026-08-13 stress test.*

- **The tab count includes the "Next" hero; the group heading count excludes it.** Two numbers on one screen derived differently — the Today tab may read `5` above an Overdue group headed `1` and a Today group headed `3`. Pre-existing: `today.js` already filters the hero out before counting a group. Defensible, because a group's count counts the rows in that group.
- **Every tab shows a count even at zero.** "Tomorrow 0" is noise on an empty app, but §3.2 says each tab shows a count, and suppressing zeroes makes the strip's width jump as tasks come and go — worse on the 375px scrolling strip than the noise it removes.
- **Arrow-key activation commits a live rename.** Automatic activation means arrowing across the strip mid-rename commits it. That is §3.3's rule stated outright — commit, never discard — and it is what clicking anywhere else already does.
- **Extra Focus sections become unmanageable.** A second Focus section created before the merge keeps its tasks visible in the flat notepad (§12.4) and File moves them out, but the section itself can no longer be renamed, reordered or deleted, and lingers in IndexedDB. Cruft, not data loss. The move picker still offers it as a target, which is consistent. Belongs to the deferred rail rethink.
- **The toast's View button is not inside the live region.** A screen-reader user hears "Added to Focus" and is not told a View button exists; they have five seconds to Tab to it. Identical for Undo across all five existing toasts, and the toast's `aria-live` invariant deliberately keeps the button *outside* the live region so `update()` re-announces. Not a regression, and the Focus tab is reachable regardless — View is a shortcut, not the only route.
- **`·` as the summary separator.** Screen readers may skip it, so `1 overdue · 3 due today` can read as one run-on phrase. `formatTimeLabel` already ships `"Aug 21 · 09:00"`; a lone comma here would be the inconsistency.
- **Holding an arrow key cycles tabs and re-renders on every repeat.** `bindKeys` fires on keydown repeat. The icon picker has exactly this property and shipped.

---

## Task 1: Rename the landing route to Focus

**Files:**
- Modify: `src/controller.js` (`parseHash`, `currentRoute` init, `mountMainView`, `onHashChange`, `start`, both `onGoToday` callbacks)
- Modify: `src/views/sidebar.js` (header comment, `onGoToday` param, `go-today` action, `template`)
- Modify: `src/views/topbar.js` (header comment, `onGoToday` param, `go-today` action)
- Test: `tests/unit/parse-hash.test.js`, `tests/utils/capture.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseHash(hash)` returns `{ name: "focus" }` for `""`, `"#"`, `"#today"`, `"#focus"` and every unknown route; `{ name: "area", id }` unchanged. The controller exposes no new API. `createSidebarView` / `createTopbarView` take `onGoFocus` where they took `onGoToday`.

- [ ] **Step 1: Rewrite the failing route tests**

Replace the whole body of `tests/unit/parse-hash.test.js` with:

```javascript
import { describe, expect, it } from "vitest";
import { parseHash } from "../../src/controller.js";

// parseHash maps the location hash to a route object. Two routes exist:
//   { name: "focus" }            — the landing surface, and the fallback for anything unknown
//   { name: "area", id: "<id>" } — an area page
// "#today" is kept as an accepted alias so pre-v3 bookmarks still resolve.
describe("parseHash", () => {
	it("treats an empty hash as Focus", () => {
		expect(parseHash("")).toEqual({ name: "focus" });
	});

	it("treats a bare # as Focus", () => {
		expect(parseHash("#")).toEqual({ name: "focus" });
	});

	it("parses #focus as Focus", () => {
		expect(parseHash("#focus")).toEqual({ name: "focus" });
	});

	it("still parses the legacy #today as Focus", () => {
		expect(parseHash("#today")).toEqual({ name: "focus" });
	});

	it("parses a hash with no leading # as Focus", () => {
		expect(parseHash("focus")).toEqual({ name: "focus" });
	});

	it("parses #area/<id> into an area route", () => {
		expect(parseHash("#area/abc123")).toEqual({ name: "area", id: "abc123" });
	});

	it("keeps the full id after area/, including dashes", () => {
		expect(parseHash("#area/focus-default")).toEqual({
			name: "area",
			id: "focus-default",
		});
	});

	it("still parses #area/focus as an area route (the controller redirects it)", () => {
		// parseHash stays pure — the redirect is a side effect and belongs to the
		// controller, which owns FOCUS_ID. utils and pure parsers never import model/.
		expect(parseHash("#area/focus")).toEqual({ name: "area", id: "focus" });
	});

	it("falls back to Focus on an unknown route", () => {
		expect(parseHash("#settings")).toEqual({ name: "focus" });
	});

	it("falls back to Focus when area/ has no id", () => {
		// /^area\/(.+)$/ requires at least one character after the slash.
		expect(parseHash("#area/")).toEqual({ name: "focus" });
	});

	it("treats null and undefined as Focus (hash may be unset)", () => {
		expect(parseHash(null)).toEqual({ name: "focus" });
		expect(parseHash(undefined)).toEqual({ name: "focus" });
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:run -- tests/unit/parse-hash.test.js
```

Expected: FAIL — several assertions report `{ name: "today" }` where `{ name: "focus" }` is expected.

- [ ] **Step 3: Rename the route in `parseHash`**

In `src/controller.js`, replace the `parseHash` body:

```javascript
export function parseHash(hash) {
	const raw = (hash || "").replace(/^#/, "");
	if (raw === "" || raw === "focus" || raw === "today") return { name: "focus" };
	const areaMatch = raw.match(/^area\/(.+)$/);
	if (areaMatch) return { name: "area", id: areaMatch[1] };
	return { name: "focus" };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:run -- tests/unit/parse-hash.test.js
```

Expected: PASS.

- [ ] **Step 5: Update the controller's route handling**

In `src/controller.js`:

Change the initial route (grep `let currentRoute`):

```javascript
	let currentRoute = { name: "focus" };
```

Add the redirect helper directly above `function mountMainView(route) {`:

```javascript
	// #area/focus is a dead duplicate of the landing route: Focus is no longer a
	// listed area, it IS the landing surface. Redirect rather than render it, so
	// neither a bookmark nor the back button can land on a second copy of the
	// same tasks.
	//
	// replaceState, NOT an assignment to location.hash. Assigning PUSHES a
	// history entry, so Back would land on #area/focus and be redirected straight
	// forward again — a loop the user cannot walk out of. replaceState rewrites
	// the URL in place, fires no hashchange, and therefore also mounts once
	// instead of twice.
	function routeFromHash() {
		const route = parseHash(window.location.hash);
		if (route.name === "area" && route.id === FOCUS_ID) {
			window.history.replaceState(null, "", "#focus");
			return { name: "focus" };
		}
		return route;
	}
```

Change the route test in `mountMainView` (grep `if (route.name === "today")`):

```javascript
		if (route.name === "focus") {
```

In `onHashChange`, replace the `currentRoute` assignment (grep `currentRoute = parseHash`):

```javascript
		currentRoute = routeFromHash();
```

In `start()`, replace the identical assignment (grep `currentRoute = parseHash`, the second occurrence) with:

```javascript
		currentRoute = routeFromHash();
```

- [ ] **Step 6: Rename the go-home callback through the controller, topbar and sidebar**

In `src/controller.js`, both callback objects (grep `onGoToday`) become:

```javascript
			onGoFocus: () => {
				window.location.hash = "#focus";
				closeDrawer(); // same-hash tap of "Ignite" on #focus fires no hashchange
			},
```

In `src/views/topbar.js`:

```javascript
// createTopbarView(rootEl, { onToggleDrawer, onGoFocus }) → { setExpanded(open), destroy() }
```

```javascript
export function createTopbarView(rootEl, { onToggleDrawer, onGoFocus }) {
```

```javascript
		<button class="topbar__wordmark" type="button" data-action="go-focus">Ignite</button>
```

```javascript
		"go-focus": () => onGoFocus(),
```

In `src/views/sidebar.js`, update the header comment (grep `onGoToday` and `{ name: "today" }`):

```javascript
//   onToggleCollapse, onGoFocus, onOpenArea,
```

```javascript
//   { name: "focus" }            → wordmark gets aria-current="page"
```

the destructure (grep `onGoToday,`):

```javascript
		onGoFocus,
```

the action key (grep `"go-today"`):

```javascript
		"go-focus": () => onGoFocus(),
```

and in `template` (grep `const route = state.route`):

```javascript
	const route = state.route ?? { name: "focus" };
	const focusActive = route.name === "focus";
	const wordmarkAria = focusActive ? 'aria-current="page"' : "";
	const wordmarkActive = focusActive ? "is-active" : "";
```

plus the button itself (grep `data-action="go-today"`):

```javascript
		<button class="sidebar__home ${wordmarkActive}" type="button"
			data-action="go-focus" ${wordmarkAria}>Ignite</button>
```

- [ ] **Step 7: Update the one stale route fixture**

In `tests/utils/capture.test.js`, the fixture on line 11 names the old route. `captureDestination` only tests `route?.name !== "area"`, so this is copy, not behaviour:

```javascript
		expect(captureDestination({ name: "focus" }, [])).toEqual({
```

- [ ] **Step 8: Run the full suite and Biome**

```bash
npm run test:run && npm run check
```

Expected: all tests pass, Biome reports zero warnings. The suite grows in this task — the rewritten `parse-hash.test.js` has 11 cases where the old one had 9.

- [ ] **Step 9: Commit**

```bash
git add src/controller.js src/views/sidebar.js src/views/topbar.js tests/unit/parse-hash.test.js tests/utils/capture.test.js
git commit -m "refactor(route): rename the landing route to focus and redirect #area/focus"
```

---

## Task 2: `groupTasksForFocus`

**Files:**
- Modify: `src/utils/time.js` (replace `groupTasksForToday`)
- Modify: `src/views/today.js` (the import and its one call site)
- Test: `tests/utils/time.test.js`

**Interfaces:**
- Consumes: `sortByDueThenUntimed(tasks)` (already in the file).
- Produces: `groupTasksForFocus(tasks, now, focusSectionIds)` → `{ overdue, today, tomorrow, starred, notepad }`, all arrays of task objects. `focusSectionIds` is an array of section ids belonging to the Focus area; the controller resolves it, because `utils/` never imports `FOCUS_ID` from `model/`. `groupTasksForToday` is **removed** in this task.

**Every commit on this branch must leave the build green**, so the caller moves over in the same commit that changes the function. `today.js` reads only `.overdue`, `.today` and `.starred`, which the new return value still carries, and it passes `[]` for `focusSectionIds` because it has no notepad to render yet — Task 10 supplies the real list. Do **not** leave `groupTasksForToday` behind as a bridge; two bucketing functions is exactly the drift the whole-branch review has caught twice.

- [ ] **Step 1: Write the failing tests**

In `tests/utils/time.test.js`, replace the entire `describe("groupTasksForToday", …)` block (it starts at line 73) with:

```javascript
describe("groupTasksForFocus", () => {
	it("partitions tasks into overdue, today, tomorrow, starred and the notepad", () => {
		const tasks = [
			task({ id: "a", dueAt: "2026-04-27T09:00:00.000Z" }), // overdue (yesterday)
			task({ id: "b", dueAt: "2026-04-28T18:00:00.000Z" }), // today
			task({ id: "c", dueAt: "2026-04-29T09:00:00.000Z" }), // tomorrow
			task({ id: "d", starred: true, dueAt: null }), // starred undated
			task({ id: "e", dueAt: null, sectionId: "focus-default" }), // notepad
			task({ id: "f", dueAt: null, sectionId: "work-1" }), // undated in an area: no tab
			task({ id: "g", dueAt: "2026-05-10T09:00:00.000Z" }), // beyond tomorrow: no tab
		];
		const result = groupTasksForFocus(tasks, NOW, ["focus-default"]);
		expect(result.overdue.map((t) => t.id)).toEqual(["a"]);
		expect(result.today.map((t) => t.id)).toEqual(["b"]);
		expect(result.tomorrow.map((t) => t.id)).toEqual(["c"]);
		expect(result.starred.map((t) => t.id)).toEqual(["d"]);
		expect(result.notepad.map((t) => t.id)).toEqual(["e"]);
	});

	it("excludes completed tasks from every group, including the notepad", () => {
		const tasks = [
			task({ id: "a", completed: true, dueAt: "2026-04-27T09:00:00.000Z" }),
			task({ id: "b", completed: true, dueAt: "2026-04-28T18:00:00.000Z" }),
			task({ id: "c", completed: true, dueAt: "2026-04-29T09:00:00.000Z" }),
			task({ id: "d", completed: true, starred: true }),
			task({ id: "e", completed: true, sectionId: "focus-default" }),
		];
		const result = groupTasksForFocus(tasks, NOW, ["focus-default"]);
		expect(result.overdue).toEqual([]);
		expect(result.today).toEqual([]);
		expect(result.tomorrow).toEqual([]);
		expect(result.starred).toEqual([]);
		expect(result.notepad).toEqual([]);
	});

	it("lets a date beat a star: a dated starred task never reaches Starred", () => {
		const tasks = [
			task({ id: "a", starred: true, dueAt: "2026-04-28T18:00:00.000Z" }),
			// Dated beyond tomorrow AND starred — the date still wins, so it lands
			// on no tab at all rather than falling through to Starred.
			task({ id: "b", starred: true, dueAt: "2026-05-10T09:00:00.000Z" }),
		];
		const result = groupTasksForFocus(tasks, NOW, ["focus-default"]);
		expect(result.today.map((t) => t.id)).toEqual(["a"]);
		expect(result.starred).toEqual([]);
	});

	it("lets a star beat the notepad: starring a note promotes it out", () => {
		const tasks = [
			task({ id: "a", starred: true, dueAt: null, sectionId: "focus-default" }),
		];
		const result = groupTasksForFocus(tasks, NOW, ["focus-default"]);
		expect(result.starred.map((t) => t.id)).toEqual(["a"]);
		expect(result.notepad).toEqual([]);
	});

	it("keeps same-day past-due tasks in Today, not Overdue", () => {
		const tasks = [task({ id: "a", dueAt: "2026-04-28T09:00:00.000Z" })];
		const result = groupTasksForFocus(tasks, NOW, []);
		expect(result.overdue).toEqual([]);
		expect(result.today.map((t) => t.id)).toEqual(["a"]);
	});

	it("sorts the dated groups by time and starred by order", () => {
		const tasks = [
			task({ id: "b", dueAt: "2026-04-28T18:00:00.000Z", hasTime: true }),
			task({ id: "a", dueAt: "2026-04-28T16:00:00.000Z", hasTime: true }),
			task({ id: "d", dueAt: "2026-04-29T18:00:00.000Z", hasTime: true }),
			task({ id: "c", dueAt: "2026-04-29T16:00:00.000Z", hasTime: true }),
			task({ id: "z", starred: true, order: 2 }),
			task({ id: "y", starred: true, order: 0 }),
		];
		const result = groupTasksForFocus(tasks, NOW, []);
		expect(result.today.map((t) => t.id)).toEqual(["a", "b"]);
		expect(result.tomorrow.map((t) => t.id)).toEqual(["c", "d"]);
		expect(result.starred.map((t) => t.id)).toEqual(["y", "z"]);
	});

	it("sorts the notepad newest first, on createdAt", () => {
		// The notepad is a capture stream, so the thing you just typed belongs on
		// top. Deliberately NOT `order`: the M4 reorder invariants depend on
		// `order` meaning position-within-a-section, and this is a cross-section
		// view. Spec §12.2.
		const tasks = [
			task({ id: "old", sectionId: "focus-default", createdAt: "2026-04-01T10:00:00.000Z" }),
			task({ id: "new", sectionId: "focus-default", createdAt: "2026-04-28T10:00:00.000Z" }),
			task({ id: "mid", sectionId: "focus-default", createdAt: "2026-04-14T10:00:00.000Z" }),
		];
		const result = groupTasksForFocus(tasks, NOW, ["focus-default"]);
		expect(result.notepad.map((t) => t.id)).toEqual(["new", "mid", "old"]);
	});

	it("counts every Focus section into the notepad, not just focus-default", () => {
		// §12.4: extra Focus sections created before the merge still show their
		// tasks. Nothing is orphaned by the surface losing its section headings.
		const tasks = [
			task({ id: "a", sectionId: "focus-default" }),
			task({ id: "b", sectionId: "focus-extra" }),
		];
		const result = groupTasksForFocus(tasks, NOW, [
			"focus-default",
			"focus-extra",
		]);
		expect(result.notepad.map((t) => t.id).sort()).toEqual(["a", "b"]);
	});

	it("treats a missing focusSectionIds as an empty notepad rather than throwing", () => {
		const tasks = [task({ id: "a", sectionId: "focus-default" })];
		expect(groupTasksForFocus(tasks, NOW).notepad).toEqual([]);
	});
});
```

The `task()` helper at the top of the file already defaults `createdAt` to `"2026-04-28T08:00:00.000Z"` and `sectionId` to `"focus-default"`, so nothing needs adding — but **that `sectionId` default is why several fixtures above set it explicitly.** A task built with no overrides is already a Focus-area task, and the notepad assertions would pass for the wrong reason otherwise.

**There is a SECOND block calling the old function** — `describe("groupTasksForToday — untimed ordering", …)`, further down the file, which Plan 2 added. Convert it rather than deleting it; it pins a contract this plan does not change:

```javascript
describe("groupTasksForFocus — untimed ordering", () => {
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
		expect(groupTasksForFocus(tasks, NOW, []).today.map((t) => t.id)).toEqual([
			"timed",
			"untimed",
		]);
	});
});
```

Grep `groupTasksForToday` across `tests/` before moving on — after this task there must be zero hits anywhere in the repo.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:run -- tests/utils/time.test.js
```

Expected: FAIL with `groupTasksForFocus is not a function` (and the import at the top of the file still names `groupTasksForToday`).

- [ ] **Step 3: Replace `groupTasksForToday` with `groupTasksForFocus`**

In `src/utils/time.js`, replace the whole `groupTasksForToday` function with:

```javascript
// The four Focus tabs, in one pass. Precedence is a cascade — a date beats a
// star, a star beats the notepad — so each task lands in at most one bucket and
// the tab counts sum to something meaningful.
//
// A dated task outside today/tomorrow deliberately falls off every tab rather
// than dropping through to Starred: the date is the strongest statement the
// user has made about it, and it is still visible in its own area.
//
// `focusSectionIds` arrives as a parameter because utils/ must never import
// FOCUS_ID from model/. The controller resolves it from the section list.
export function groupTasksForFocus(tasks, now, focusSectionIds) {
	const startToday = startOfDay(now).getTime();
	const startTomorrow = startToday + ONE_DAY_MS;
	const startDayAfter = startTomorrow + ONE_DAY_MS;
	const inFocus = new Set(focusSectionIds ?? []);

	const overdue = [];
	const today = [];
	const tomorrow = [];
	const starred = [];
	const notepad = [];

	for (const t of tasks) {
		if (t.completed) continue;
		if (t.dueAt) {
			const due = new Date(t.dueAt).getTime();
			if (due < startToday) overdue.push(t);
			else if (due < startTomorrow) today.push(t);
			else if (due < startDayAfter) tomorrow.push(t);
			continue;
		}
		if (t.starred) {
			starred.push(t);
			continue;
		}
		if (inFocus.has(t.sectionId)) notepad.push(t);
	}

	starred.sort((a, b) => a.order - b.order);
	// Newest first: the notepad is a capture stream, so what you just typed goes
	// on top. Sorting in the view keeps `order` semantics — and the M4 reorder
	// invariants that rest on them — untouched. Spec §12.2.
	notepad.sort((a, b) =>
		a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
	);

	return {
		overdue: sortByDueThenUntimed(overdue),
		today: sortByDueThenUntimed(today),
		tomorrow: sortByDueThenUntimed(tomorrow),
		starred,
		notepad,
	};
}
```

- [ ] **Step 4: Update the test file's import**

At the top of `tests/utils/time.test.js`, replace `groupTasksForToday,` in the import list with `groupTasksForFocus,` (keep the list alphabetical — Biome sorts it).

- [ ] **Step 5: Move the one existing caller across**

In `src/views/today.js`, change the import (grep `groupTasksForToday`):

```javascript
import { groupTasksForFocus, pickNextTask } from "../utils/time.js";
```

and its single call site inside `template`:

```javascript
	// Temporary []: this view has no notepad yet, and an empty focusSectionIds
	// yields an empty notepad bucket, which nothing here reads. Task 10 replaces
	// the whole template and supplies the real list.
	const groups = groupTasksForFocus(state.tasks, state.now, []);
```

- [ ] **Step 6: Run the tests, Biome and the build**

```bash
npm run test:run && npm run check && npm run build
```

Expected: all tests pass, Biome clean, build clean. The rendered Today view is byte-for-byte what it was — the three buckets it reads are unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/utils/time.js src/views/today.js tests/utils/time.test.js
git commit -m "feat(focus): bucket tasks into the four Focus tabs"
```

---

## Task 3: `pickNextTask` over the grouped buckets

**Files:**
- Modify: `src/utils/time.js` (`pickNextTask`)
- Modify: `src/views/today.js` (two adjacent lines in `template`)
- Test: `tests/utils/time.test.js`

**Interfaces:**
- Consumes: the object `groupTasksForFocus` returns.
- Produces: `pickNextTask(groups, now)` → a task object or `null`. It reads only `groups.today` and `groups.overdue`.

- [ ] **Step 1: Write the failing tests**

In `tests/utils/time.test.js`, replace the entire `describe("pickNextTask", …)` block with:

```javascript
describe("pickNextTask", () => {
	// The hero reads the grouped buckets, not the raw list, so it can never
	// promote something due next week into a card labelled "Next" on Today.
	const groups = (over, todayList) => ({
		overdue: over,
		today: todayList,
		tomorrow: [],
		starred: [],
		notepad: [],
	});

	it("picks the earliest still-upcoming timed task today", () => {
		const a = task({ id: "a", dueAt: "2026-04-28T18:00:00.000Z", hasTime: true });
		const b = task({ id: "b", dueAt: "2026-04-28T16:00:00.000Z", hasTime: true });
		expect(pickNextTask(groups([], [b, a]), NOW)?.id).toBe("b");
	});

	it("skips a timed task that has already passed today", () => {
		const past = task({ id: "past", dueAt: "2026-04-28T09:00:00.000Z", hasTime: true });
		const soon = task({ id: "soon", dueAt: "2026-04-28T18:00:00.000Z", hasTime: true });
		expect(pickNextTask(groups([], [past, soon]), NOW)?.id).toBe("soon");
	});

	it("prefers an untimed task due today over anything overdue", () => {
		// An untimed task is stored at local midnight, so `dueAt > now` is false
		// from 00:01 onward. Reading the buckets instead of the raw dates is what
		// stops that stored midnight from reading as "overdue" — the defect Plan 2
		// recorded and deferred to here.
		const untimed = task({ id: "untimed", dueAt: "2026-04-28T00:00:00.000Z", hasTime: false });
		const old = task({ id: "old", dueAt: "2026-04-20T09:00:00.000Z", hasTime: true });
		expect(pickNextTask(groups([old], [untimed]), NOW)?.id).toBe("untimed");
	});

	it("falls back to the first task due today when everything today has passed", () => {
		const past = task({ id: "past", dueAt: "2026-04-28T09:00:00.000Z", hasTime: true });
		expect(pickNextTask(groups([], [past]), NOW)?.id).toBe("past");
	});

	it("falls back to the oldest overdue task when nothing is due today", () => {
		// `overdue` arrives day-ascending from sortByDueThenUntimed, so [0] is the
		// thing that has been rotting longest.
		const older = task({ id: "older", dueAt: "2026-04-20T09:00:00.000Z" });
		const newer = task({ id: "newer", dueAt: "2026-04-27T09:00:00.000Z" });
		expect(pickNextTask(groups([older, newer], []), NOW)?.id).toBe("older");
	});

	it("never reaches into Starred, Tomorrow or the notepad", () => {
		const result = pickNextTask(
			{
				overdue: [],
				today: [],
				tomorrow: [task({ id: "t" })],
				starred: [task({ id: "s", starred: true })],
				notepad: [task({ id: "n" })],
			},
			NOW,
		);
		expect(result).toBeNull();
	});

	it("returns null for empty groups", () => {
		expect(pickNextTask(groups([], []), NOW)).toBeNull();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:run -- tests/utils/time.test.js
```

Expected: FAIL — the current `pickNextTask` calls `tasks.filter` on the groups object.

- [ ] **Step 3: Rewrite `pickNextTask`**

In `src/utils/time.js`, replace `pickNextTask` and delete the now-unused `byDueAtAsc` helper below it:

```javascript
// The Today tab's "Next up" hero. Takes the grouped buckets rather than the raw
// task list for two reasons: it can then never promote something due next week
// into a card labelled "Next", and an untimed task due today stays a candidate
// instead of being mistaken for overdue (its stored midnight is behind `now`
// from 00:01 onward).
//
// Candidate order: the next timed thing still ahead of you today → anything
// untimed today ("sometime today" is still ahead of you) → the earliest thing
// today that has already passed → the oldest overdue item. `groups.today` and
// `groups.overdue` both arrive sorted, so first-match is the right pick.
export function pickNextTask(groups, now) {
	const today = groups?.today ?? [];
	const upcoming = today.find(
		(t) => t.hasTime && new Date(t.dueAt).getTime() > now.getTime(),
	);
	if (upcoming) return upcoming;

	const untimed = today.find((t) => !t.hasTime);
	if (untimed) return untimed;

	return today[0] ?? groups?.overdue?.[0] ?? null;
}
```

- [ ] **Step 4: Move the caller across**

In `src/views/today.js`'s `template`, the two lines that compute `next` and `groups` currently run in that order. Swap them, so the hero reads the buckets:

```javascript
	const groups = groupTasksForFocus(state.tasks, state.now, []);
	const next = pickNextTask(groups, state.now);
```

- [ ] **Step 5: Run the tests, Biome and the build**

```bash
npm run test:run && npm run check && npm run build
```

Expected: all tests pass, Biome clean (`byDueAtAsc` is gone, so `noUnusedVariables` stays quiet), build clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/time.js src/views/today.js tests/utils/time.test.js
git commit -m "fix(focus): pick the Next hero from the Today bucket, not every dated task"
```

---

## Task 4: `formatDayGreeting` and `summariseDay`

**Files:**
- Modify: `src/utils/time.js`
- Test: `tests/utils/time.test.js`

**Interfaces:**
- Consumes: the object `groupTasksForFocus` returns.
- Produces: `formatDayGreeting(now)` → `"Tuesday 28 April"`. `summariseDay(groups)` → `{ overdue: number, dueToday: number }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/utils/time.test.js`:

```javascript
describe("formatDayGreeting", () => {
	it("renders weekday, day-of-month and month in full", () => {
		expect(formatDayGreeting(NOW)).toBe("Tuesday 28 April");
	});

	it("does not pad a single-digit day", () => {
		expect(formatDayGreeting(new Date("2026-04-05T12:00:00"))).toBe(
			"Sunday 5 April",
		);
	});

	it("handles the last month of the year", () => {
		expect(formatDayGreeting(new Date("2026-12-31T12:00:00"))).toBe(
			"Thursday 31 December",
		);
	});
});

describe("summariseDay", () => {
	it("counts overdue and due-today items", () => {
		const result = summariseDay({
			overdue: [task({ id: "a" }), task({ id: "b" })],
			today: [task({ id: "c" })],
			tomorrow: [task({ id: "d" })],
			starred: [task({ id: "e" })],
			notepad: [task({ id: "f" })],
		});
		expect(result).toEqual({ overdue: 2, dueToday: 1 });
	});

	it("counts zeroes rather than omitting them", () => {
		expect(
			summariseDay({
				overdue: [],
				today: [],
				tomorrow: [],
				starred: [],
				notepad: [],
			}),
		).toEqual({ overdue: 0, dueToday: 0 });
	});

	it("survives a missing or partial groups object", () => {
		expect(summariseDay()).toEqual({ overdue: 0, dueToday: 0 });
	});
});
```

Confirm `NOW` at the top of the file is `new Date("2026-04-28T12:00:00")` — a Tuesday. If it carries a different value, adjust the first expectation to match the day it actually names rather than changing `NOW`, which every other test depends on.

Add `formatDayGreeting,` and `summariseDay,` to the import list at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:run -- tests/utils/time.test.js
```

Expected: FAIL with `formatDayGreeting is not a function`.

- [ ] **Step 3: Implement both functions**

In `src/utils/time.js`, add the long-name constants next to the existing `SHORT_WEEKDAY` / `SHORT_MONTH` arrays at the top of the file:

```javascript
const LONG_WEEKDAY = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];
const LONG_MONTH = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
```

and append both functions to the end of the file:

```javascript
// "Tuesday 28 April" — the Focus page's greeting line.
//
// Built from constant arrays rather than toLocaleDateString on purpose: the
// locale-driven version returns a different string per machine, which makes it
// untestable without pinning a locale, and the rest of this surface ("Today",
// "Overdue", "Starred", "Next") is English regardless. Matches how
// formatTimeLabel and formatOccurrenceLabel already work in this file.
export function formatDayGreeting(now) {
	return `${LONG_WEEKDAY[now.getDay()]} ${now.getDate()} ${LONG_MONTH[now.getMonth()]}`;
}

// Counts for the page-header summary. Takes the grouped output, not the raw
// task list, so the summary can never disagree with what the Today tab renders
// — both are derived from one groupTasksForFocus call over one `state`.
export function summariseDay(groups) {
	return {
		overdue: groups?.overdue?.length ?? 0,
		dueToday: groups?.today?.length ?? 0,
	};
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:run -- tests/utils/time.test.js && npm run check
```

Expected: PASS, Biome clean.

- [ ] **Step 5: Commit**

```bash
git add src/utils/time.js tests/utils/time.test.js
git commit -m "feat(focus): add the day greeting and the overdue/due-today summary"
```

---

## Task 5: `areaForTask`

**Files:**
- Create: `src/utils/areas.js`
- Test: `tests/utils/areas.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `areaForTask(task, sections, areas)` → an area object or `null`.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/areas.test.js`:

```javascript
import { describe, expect, it } from "vitest";
import { areaForTask } from "../../src/utils/areas.js";

const SECTIONS = [
	{ id: "s1", areaId: "work" },
	{ id: "s2", areaId: "home" },
	{ id: "orphan", areaId: "deleted-area" },
];
const AREAS = [
	{ id: "work", name: "Work" },
	{ id: "home", name: "Home" },
];

describe("areaForTask", () => {
	it("resolves the area through the task's section", () => {
		const result = areaForTask({ id: "t", sectionId: "s2" }, SECTIONS, AREAS);
		expect(result?.name).toBe("Home");
	});

	it("returns null when the section is missing", () => {
		expect(areaForTask({ id: "t", sectionId: "gone" }, SECTIONS, AREAS)).toBeNull();
	});

	it("returns null when the section points at a missing area", () => {
		expect(areaForTask({ id: "t", sectionId: "orphan" }, SECTIONS, AREAS)).toBeNull();
	});

	it("returns null for a missing task or missing lists", () => {
		expect(areaForTask(null, SECTIONS, AREAS)).toBeNull();
		expect(areaForTask({ id: "t", sectionId: "s1" })).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:run -- tests/utils/areas.test.js
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement it**

Create `src/utils/areas.js`:

```javascript
// Pure area lookups for view code. No DOM, no model imports — the caller passes
// the full section and area lists it already has in `state`.

// areaForTask(task, sections, areas) → Area | null
//
// Resolves the area a task lives in, for the row's area badge. Returns null
// rather than throwing when either link is missing: a task whose section was
// cascade-deleted mid-render is a real race, and a badge is not worth a throw
// inside a template.
export function areaForTask(task, sections, areas) {
	if (!task) return null;
	const section = (sections ?? []).find((s) => s.id === task.sectionId);
	if (!section) return null;
	return (areas ?? []).find((a) => a.id === section.areaId) ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:run -- tests/utils/areas.test.js && npm run check
```

Expected: PASS, Biome clean.

- [ ] **Step 5: Commit**

```bash
git add src/utils/areas.js tests/utils/areas.test.js
git commit -m "feat(focus): resolve a task's area for the row badge"
```

---

## Task 6: A generic toast action button

**Files:**
- Modify: `src/views/toast.js`
- Modify: `src/controller.js` (five `onUndo:` call sites)
- Modify: `main.css` (`.toast__undo` → `.toast__action`, two rules)

**Interfaces:**
- Consumes: nothing.
- Produces: `toast.show({ message, onAction, actionLabel, onDismiss, durationMs, key })`. `actionLabel` defaults to `"Undo"`, so every existing toast is unchanged on screen. `onUndo` is **gone** — there is no alias.

- [ ] **Step 1: Rename the action slot in `toast.js`**

In `src/views/toast.js`, extend the header comment block after the `aria-live placement` paragraph:

```javascript
// Action button: one per toast, labelled "Undo" unless the caller passes
// actionLabel. The label is user-visible copy, so it goes through escapeHtml
// like every other interpolated string — even though every current caller
// passes a literal.
```

Rename the closure variable (grep `activeUndoHandler`) in both its declaration and its reset inside `clearActive()`:

```javascript
	let activeActionHandler = null;
```

```javascript
		activeActionHandler = null;
```

Replace the `show` signature and the two lines that build and wire the button:

```javascript
	function show({
		message,
		onAction,
		onDismiss,
		durationMs: d,
		key,
		actionLabel,
	} = {}) {
```

```javascript
		rootEl.innerHTML = `
			<div class="toast">
				<span class="toast__message" role="status" aria-live="polite">${escapeHtml(message ?? "")}</span>
				<button class="toast__action" type="button">${escapeHtml(actionLabel ?? "Undo")}</button>
			</div>
		`;

		const toastEl = rootEl.querySelector(".toast");
		const actionBtn = rootEl.querySelector(".toast__action");

		activeActionHandler = () => {
			clearActive();
			if (onAction) onAction();
		};
		actionBtn.addEventListener("click", activeActionHandler, { once: true });
```

The nine-variable `clearActive()` contract is unchanged: one variable renamed, none added or removed.

- [ ] **Step 2: Rename the five call sites in the controller**

In `src/controller.js`, change `onUndo:` to `onAction:` at all five sites — grep `onUndo` to locate them, line numbers drift. They are, in file order:

1. `handleToggleComplete` — the recurring-completion undo (`await tasks.update(id, snapshot)`)
2. `handleTaskDelete` — the delete-batch undo (`const batch = taskDeleteBatch; …`)
3. `handleMoveTaskToSection` — the move undo (`await tasks.update(taskId, { sectionId: fromSectionId, order: fromOrder })`)
4. `onDeleteSection` — the section-cascade undo (`await sections.restore(sectionSnapshot); …`)
5. `deleteAreaCascade` — the area-cascade undo (`await areas.restore(areaSnapshot); …`)

Change only the key. Every handler body stays byte-identical, and none of them passes `actionLabel`, so all five keep the "Undo" label.

- [ ] **Step 3: Rename the CSS class**

In `main.css`, rename both selectors (grep `toast__undo`):

```css
.toast__action {
```

```css
.toast__action:hover {
```

- [ ] **Step 4: Verify nothing still references the old names**

```bash
grep -rn "onUndo\|toast__undo\|activeUndoHandler" src/ main.css tests/
```

Expected: no output.

- [ ] **Step 5: Run the suite, Biome and the build**

```bash
npm run test:run && npm run check && npm run build
```

Expected: all tests pass, Biome clean, build clean. All five toasts still read "Undo" on screen; nothing user-visible changed in this task.

- [ ] **Step 6: Commit**

```bash
git add src/views/toast.js src/controller.js main.css
git commit -m "refactor(toast): let a toast carry any action, not only Undo"
```

---

## Task 7: The area badge in the task row

**Files:**
- Modify: `src/views/task.js`

**Interfaces:**
- Consumes: `areaForTask` output (the caller resolves the name and passes a string).
- Produces: `renderTaskRow(task, { now, isOpen, renaming, pendingRenameValue, showFile, areaName })`. `areaName` defaults to `null`, which renders no badge — so `area.js` and `section.js`, which do not pass it, are unaffected.

- [ ] **Step 1: Add the badge and reorder the row**

In `src/views/task.js`, extend the options comment block:

```javascript
//   areaName           - the task's area name, or null. Renders the area badge
//                        that appears at >=768px on the dated tabs. Escaped —
//                        area names are user-authored and this is a new
//                        interpolation site.
```

Add `areaName = null,` to the destructured options next to `showFile = false,`, and build the badge above the `return`:

```javascript
	// The badge is a plain <span>, not a link or a button: it says where the task
	// lives, it does not navigate. main.css hides it below 768px.
	const areaBadge = areaName
		? `<span class="task__area-badge">${escapeHtml(areaName)}</span>`
		: "";
```

Replace the returned markup so the fixed-width columns sit to the right of the flexible title:

```javascript
	return `
		<li class="task" data-id="${escapeHtml(task.id)}">
			<input type="checkbox" class="task__check" data-action="toggle-complete" ${checked}
				aria-label="Mark complete: ${escapeHtml(task.title)}" />
			<span class="task__title">${escapeHtml(task.title)}</span>
			${recurring}
			${areaBadge}
			${timeLabel}
			<button class="task__star" type="button" data-action="toggle-star" ${starredAttr}
				aria-label="Star: ${escapeHtml(task.title)}">${starGlyph}</button>
			${fileBtn}
			<button class="task__menu-btn" type="button" data-action="open-menu"
				aria-haspopup="menu"
				aria-expanded="${isOpen}"
				aria-label="Task options: ${escapeHtml(task.title)}">⋯</button>
		</li>
	`;
```

**The order is load-bearing, not taste.** `.task__title` is the only `flex: 1` child, so it absorbs every width difference between rows. Anything *conditional* must therefore sit immediately after it — that is `⟲`, which is present only on recurring tasks. Everything after that point has a fixed basis and is packed against the right edge, which is what makes the badge and time columns line up across every group (§7: "the alignment is the work"). Moving `⟲` back below the badge would shift the badge left by its width on recurring rows only. The star moves from before `⟲` to after the time for the same reason; it now sits beside the ⋯, which also groups the two per-row controls together.

- [ ] **Step 2: Verify no caller broke**

```bash
npm run test:run && npm run check
```

Expected: all tests pass, Biome clean. `area.js` and `section.js` pass no `areaName`, so their rows render exactly as before apart from the star's position.

- [ ] **Step 3: Commit**

```bash
git add src/views/task.js
git commit -m "feat(focus): give the task row an area badge slot"
```

---

## Task 8: The tab strip template

**Files:**
- Create: `src/views/focus-tabs.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `TABS` — a frozen-by-convention array of `{ id, label }` in display order: `today`, `tomorrow`, `starred`, `focus`. `renderTabStrip({ activeTab, counts })` → an HTML string; `counts` is an object keyed by tab id.

- [ ] **Step 1: Write the template**

Create `src/views/focus-tabs.js`:

```javascript
// renderTabStrip({ activeTab, counts }) → string
//
// Pure template for the Focus surface's tab strip. ARIA APG tabs: a
// role="tablist" of role="tab" buttons with ROVING TABINDEX — exactly one tab
// stop for the whole strip, arrows traverse (focus.js wires the keys through
// utils/menu-keyboard.js). Four extra tab stops in a keyboard-first capture
// flow is the failure this avoids; it is the same treatment the icon picker
// already gets, for the same reason.
//
// aria-controls is set ONLY on the selected tab. Just one panel is in the DOM at
// a time, so putting aria-controls on the other three would point at ids that do
// not exist — the kind of "technically ARIA" attribute that axe flags and that
// already cost this project once (aria-expanded on the capture input).
//
// Nothing here is user-authored: labels and ids come from the TABS literal and
// counts are numbers, so there is no escaping to do.

export const TABS = [
	{ id: "today", label: "Today" },
	{ id: "tomorrow", label: "Tomorrow" },
	{ id: "starred", label: "Starred" },
	{ id: "focus", label: "Focus" },
];

export function renderTabStrip({ activeTab, counts }) {
	const tabs = TABS.map((tab) => {
		const selected = tab.id === activeTab;
		const controls = selected ? ` aria-controls="focus-panel-${tab.id}"` : "";
		return `
			<button class="focus-tab${selected ? " is-active" : ""}" type="button"
				role="tab"
				id="focus-tab-${tab.id}"
				data-action="select-tab"
				data-tab="${tab.id}"
				aria-selected="${selected}"${controls}
				tabindex="${selected ? "0" : "-1"}">${tab.label}<span class="focus-tab__count">${counts?.[tab.id] ?? 0}</span></button>
		`;
	}).join("");

	return `
		<div class="focus-tabs" role="tablist" aria-label="Focus views">${tabs}</div>
	`;
}
```

- [ ] **Step 2: Verify Biome accepts it**

```bash
npm run check
```

Expected: zero warnings. The module has no importer yet — that is Task 10.

- [ ] **Step 3: Commit**

```bash
git add src/views/focus-tabs.js
git commit -m "feat(focus): add the tab strip template"
```

---

## Task 9: Rename `today.js` to `focus.js`

**Files:**
- Rename: `src/views/today.js` → `src/views/focus.js`
- Modify: `src/controller.js` (the import and the one call site)

**Interfaces:**
- Consumes: nothing.
- Produces: `createFocusView(rootEl, callbacks)` — the same object `createTodayView` returned (`render`, `focusTaskMenu`, `destroy`).

Mechanical, on purpose: it lands as its own commit so Task 10's diff is readable instead of being buried under a whole-file move. Unlike Plan 2's decision to keep the dialog's internal `repeat-*` namespace, this identifier is *not* invisible — a file called `today.js` that renders the Focus surface and contains a Today tab inside it actively misleads the next reader.

- [ ] **Step 1: Rename the file, preserving history**

```bash
git mv src/views/today.js src/views/focus.js
```

- [ ] **Step 2: Rename the factory and its self-references**

In `src/views/focus.js`:

```javascript
// createFocusView(rootEl, { onToggleComplete, onToggleStar, onDelete })
```

```javascript
export function createFocusView(rootEl, callbacks) {
```

and update the two internal helper names that spell out the old surface (grep `Today`):

```javascript
	function findOpenMenuInFocus(target) {
```

with its single call site inside `docKeyHandler`:

```javascript
		const menuEl = findOpenMenuInFocus(event.target);
```

- [ ] **Step 3: Update the controller**

In `src/controller.js` (grep `createTodayView`):

```javascript
import { createFocusView } from "./views/focus.js";
```

```javascript
			currentMainView = createFocusView(mainRoot, {
```

- [ ] **Step 4: Update the four comments in other files that point at the old filename**

`src/utils/rename-input.js:2`, `src/views/area.js:197`, `src/views/capture.js:141` and `src/views/move-picker.js:6` each name `today.js` in prose. Replace `today.js` with `focus.js` in each — grep to find them; they are comments only. Line numbers drift, so locate by grep rather than by number.

- [ ] **Step 5: Verify**

```bash
grep -rn "today\.js\|createTodayView" src/ && echo "STALE REFERENCES ABOVE" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add -A src/views src/controller.js src/utils/rename-input.js
git commit -m "refactor(focus): rename the Today view to the Focus view"
```

---

## Task 10: Tabs — state, lifecycle, keyboard, and the four panels

**Files:**
- Modify: `src/views/focus.js`

**Interfaces:**
- Consumes: `groupTasksForFocus`, `pickNextTask` (Tasks 2–3); `TABS`, `renderTabStrip` (Task 8).
- Produces: `createFocusView` returns `{ render, focusTaskMenu, selectTab, getActiveTab, destroy }`. `selectTab(tabId)` runs the full §3.3 lifecycle; `getActiveTab()` returns the current tab id. The view expects `state.route` to carry `{ name: "focus" }` and reads `state.sections` to resolve which sections belong to the Focus area — it receives them as a prop, computed in the template, so no model import is added.

- [ ] **Step 1: Swap the imports**

In `src/views/focus.js`, add the tab strip and `FOCUS_ID` (the `time.js` import is already correct from Tasks 2–3):

```javascript
import { FOCUS_ID } from "../model/areas.js";
import { renderTabStrip, TABS } from "./focus-tabs.js";
```

Importing a model constant into a view is the established pattern — `sidebar.js` already imports `FOCUS_ID` for exactly this kind of identity test. The rule this plan holds is narrower: **`utils/` never imports from `model/`**, which is why `groupTasksForFocus` takes section ids as data instead.

- [ ] **Step 2: Add the tab state**

Below `let taskMenuMode = "actions";` add:

```javascript
	// Which tab is showing. VIEW-owned, not a model field and not controller
	// state: every step of a tab switch acts on state that lives in this closure
	// (the open menu, the live rename), and "always resets to Today on mount"
	// then comes for free — leaving Focus for an area destroys the view, so
	// coming back always lands here again. Spec §3.3.
	let activeTab = "today";
	// After the next render, focus this tab's button. Consumed last in doRender,
	// cleared unconditionally, reset in destroy() — same contract as every other
	// pending-focus flag in this file.
	let pendingFocusTab = null;
```

- [ ] **Step 3: Add `selectTab`**

Add below `enterTaskRename`:

```javascript
	// Switching tab is a lifecycle event, not just a re-render: the panel is
	// rewritten, which detaches everything inside it. In order (spec §3.3):
	//   1. close any open task menu
	//   2. resolve a live rename by COMMITTING it, matching Enter — never
	//      discard what the user typed
	//   3. render the new tab
	//   4. move focus to the newly-selected tab button
	//
	// Step 3 is deliberately conditional. When a rename commit fires, the model
	// write's own notify-render is the render that must consume pendingFocusTab.
	// Rendering here as well would focus the tab button and then let that queued
	// render rewrite innerHTML underneath it, dropping focus to <body> — the trap
	// the cascade-focus drain exists to prevent, and a view cannot drain, only
	// the controller can await applyState(). commitTaskRenameFromInput below
	// renders in exactly one branch for exactly this reason.
	const selectTab = (next) => {
		if (!TABS.some((t) => t.id === next)) return;

		openMenuTaskId = null;
		taskMenuMode = "actions";
		pendingMenuFocusTaskId = null;
		// Never route focus back to a ⋯ button that is about to be detached.
		pendingFocusTaskId = null;

		let renameCommitted = false;
		if (renamingTaskId) {
			const input = rootEl.querySelector(".task__rename-input");
			const value = (input?.value ?? "").trim();
			const id = renamingTaskId;
			renamingTaskId = null;
			pendingRenameTaskValue = null;
			pendingRenameTaskSelect = false;
			if (value) {
				callbacks.onCommitTaskRename({ taskId: id, name: value });
				renameCommitted = true;
			}
		}

		activeTab = next;
		pendingFocusTab = next;
		if (!renameCommitted) doRender();
	};
```

- [ ] **Step 4: Wire the click action**

Add to the `bindActions` map, above `"toggle-complete"`:

```javascript
		"select-tab": (_event, actionEl) => {
			const next = actionEl?.dataset?.tab;
			if (next) selectTab(next);
		},
```

- [ ] **Step 5: Wire the arrow keys**

Add to the `bindKeys(rootEl, …)` map, alongside `Enter` and `F2`:

```javascript
		ArrowRight: (event) => moveTabFocus(event, 1),
		ArrowLeft: (event) => moveTabFocus(event, -1),
		Home: (event) => moveTabFocus(event, 0, firstEnabledIndex),
		End: (event) => moveTabFocus(event, 0, lastEnabledIndex),
```

and define the helper above `commitTaskRenameFromInput`:

```javascript
	// Roving-tabindex traversal for the tab strip, mirroring the icon picker.
	// Guarded on the event target actually being a tab, so it never competes with
	// the ⋯ menu's own Home/End handling (which is guarded on being inside an
	// open menu) or with a caret moving inside a rename input.
	//
	// Activation is automatic: arrowing to a tab selects it, per the APG pattern
	// for cheap panels. selectTab moves the focus, so nothing is needed here
	// beyond choosing the target.
	function moveTabFocus(event, direction, pick) {
		if (!event.target.closest('[role="tab"]')) return;
		const items = TABS.map(() => ({ disabled: false }));
		const currentIndex = TABS.findIndex((t) => t.id === activeTab);
		const nextIdx = pick
			? pick(items)
			: nextEnabledIndex(items, currentIndex, direction);
		if (nextIdx < 0) return;
		event.preventDefault();
		selectTab(TABS[nextIdx].id);
	}
```

`firstEnabledIndex`, `lastEnabledIndex` and `nextEnabledIndex` are already imported at the top of the file for the ⋯ menu.

- [ ] **Step 6: Capture, then consume, the tab focus in `doRender`**

Two edits in `doRender`, and the first one is the reason a keyboard user can park on this surface at all.

**6a — capture.** Add directly above `isRendering = true;`, beside the existing `readRenameCaret` call, which is the same idea for the same reason:

```javascript
		// The 60s tick and every model notify rewrite this subtree with no user
		// action behind them, detaching whatever held focus. Without this, focus
		// parked on a tab drops to <body> once a minute — and the tab strip is now
		// the whole surface's navigation, so that is not a small loss.
		//
		// Only ever re-asserts focus that was ALREADY on a tab, and the guard means
		// it never overrides a tab switch that has explicitly asked for focus.
		if (!pendingFocusTab) {
			pendingFocusTab =
				document.activeElement?.closest?.(".focus-tab")?.dataset?.tab ?? null;
		}
```

**6b — consume.** Add at the end of `doRender`, after the `pendingMenuFocusTaskId` block:

```javascript
		// Last flag consumed, cleared unconditionally. It is mutually exclusive
		// with the two above — selectTab nulls both before setting this one.
		if (pendingFocusTab) {
			rootEl
				.querySelector(`.focus-tab[data-tab="${CSS.escape(pendingFocusTab)}"]`)
				?.focus();
			pendingFocusTab = null;
		}
```

**6c — give `pendingFocusTaskId` a fallback.** Replace the existing `pendingFocusTaskId` block a few lines above it:

```javascript
		// Post-render lookup: focus the task's ⋯ button by data-attribute.
		// Captured element refs go stale across innerHTML rewrites, so we query
		// the freshly-rendered DOM.
		if (pendingFocusTaskId) {
			const trigger = rootEl.querySelector(
				`[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
			);
			// The task may have left this tab entirely between the flag being set
			// and this render — rescheduling it to next week from the Schedule
			// dialog is enough, and that is now the ordinary outcome rather than an
			// edge case. Without the fallback, `?.focus()` silently no-ops and focus
			// stays wherever the closed dialog left it: <body>.
			if (trigger) trigger.focus();
			else
				rootEl
					.querySelector(`.focus-tab[data-tab="${CSS.escape(activeTab)}"]`)
					?.focus();
			pendingFocusTaskId = null;
		}
```

- [ ] **Step 7: Pass the tab state into the template and expose the two methods**

Change the `doRender` template call to pass `activeTab`:

```javascript
			rootEl.innerHTML = template(
				lastState,
				openMenuTaskId,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
				activeTab,
			);
```

and extend the returned object:

```javascript
	return {
		render(state) {
			lastState = state;
			doRender();
		},
		focusTaskMenu(taskId) {
			pendingFocusTaskId = taskId;
		},
		selectTab,
		getActiveTab: () => activeTab,
		destroy() {
```

Add the two resets inside `destroy()`, beside the other flag resets:

```javascript
			activeTab = "today";
			pendingFocusTab = null;
```

- [ ] **Step 8: Rewrite the template around the tabs**

Replace the whole `template(...)` function with:

```javascript
function template(
	state,
	openMenuTaskId,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	activeTab,
) {
	// Which sections belong to Focus. Resolved here, then passed as data, because
	// utils/time.js must stay ignorant of FOCUS_ID. Every Focus section counts,
	// not just focus-default — §12.4 keeps pre-merge extra sections from
	// orphaning their tasks now that the surface has no section headings.
	const focusSectionIds = state.sections
		.filter((s) => s.areaId === FOCUS_ID)
		.map((s) => s.id);

	const groups = groupTasksForFocus(state.tasks, state.now, focusSectionIds);
	const counts = {
		today: groups.overdue.length + groups.today.length,
		tomorrow: groups.tomorrow.length,
		starred: groups.starred.length,
		focus: groups.notepad.length,
	};

	// >=1 section other than any task's own ⇒ a valid move target exists.
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

	const rowOpts = {
		now: state.now,
		openMenuTaskId,
		renamingTaskId,
		pendingRenameTaskValue,
		taskMenuMode,
		movePickerHtml,
		hasMoveTargets,
	};

	return `
		${renderTabStrip({ activeTab, counts })}
		${renderPanel(activeTab, groups, state, rowOpts)}
	`;
}

// One panel at a time — the other three are not in the DOM, which is what keeps
// aria-controls honest and stops four lists of rows from competing for ids.
function renderPanel(activeTab, groups, state, rowOpts) {
	const body = panelBody(activeTab, groups, state, rowOpts);
	return `
		<div class="focus-panel" id="focus-panel-${activeTab}" role="tabpanel"
			aria-labelledby="focus-tab-${activeTab}">${body}</div>
	`;
}

function panelBody(activeTab, groups, state, rowOpts) {
	if (activeTab === "tomorrow") {
		return renderGroup("Tomorrow", "group--tomorrow", groups.tomorrow, true, rowOpts);
	}
	if (activeTab === "starred") {
		return renderGroup("Starred", "group--starred", groups.starred, false, rowOpts);
	}
	if (activeTab === "focus") {
		return renderGroup("Focus", "group--notepad", groups.notepad, false, rowOpts);
	}

	const next = pickNextTask(groups, state.now);
	const visible = (list) => list.filter((t) => t.id !== next?.id);
	return `
		${next ? renderNextCard(next, rowOpts) : ""}
		${renderGroup("Overdue", "group--overdue", visible(groups.overdue), true, rowOpts)}
		${renderGroup("Today", "group--today", visible(groups.today), true, rowOpts)}
	`;
}
```

- [ ] **Step 9: Collapse the row-rendering helpers onto `rowOpts`**

The three render helpers currently take eight positional parameters each, which a fourth tab's worth of call sites would make unreadable. Replace `renderNextCard`, `renderGroup` and `renderTaskRowWithMenu` with:

```javascript
function renderNextCard(task, rowOpts) {
	return `
		<article class="next-card">
			<h2 class="next-card__label">Next</h2>
			<ul class="next-card__list">
				${renderTaskRowWithMenu(task, rowOpts)}
			</ul>
		</article>
	`;
}

function renderGroup(heading, modifierClass, tasks, showCount, rowOpts) {
	if (tasks.length === 0) return "";
	// The count is a separate element, not part of the heading string: it is
	// metadata, and styling it as such is what lets the heading itself read as a
	// heading rather than a label.
	const countHtml = showCount
		? `<span class="group__count">${tasks.length}</span>`
		: "";
	const rows = tasks.map((t) => renderTaskRowWithMenu(t, rowOpts)).join("");
	return `
		<section class="group ${modifierClass}">
			<h3 class="group__heading">${heading}${countHtml}</h3>
			<ul class="group__list">${rows}</ul>
		</section>
	`;
}

function renderTaskRowWithMenu(task, rowOpts) {
	const {
		now,
		openMenuTaskId,
		renamingTaskId,
		pendingRenameTaskValue,
		taskMenuMode,
		movePickerHtml,
		hasMoveTargets,
	} = rowOpts;

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
	//
	// The replacement is a FUNCTION, not a string. A string replacement treats
	// `$&`, `$'` and "$`" as substitution patterns, and escapeHtml does not touch
	// `$` — so an area or section named `$&` reaches here through the picker
	// markup and expands to the matched `</li>`, injecting a stray closing tag.
	// Not script execution (the match is always the literal `</li>`), but real
	// DOM corruption. A function replacement never interprets `$`.
	if (taskMenuMode === "picker" && movePickerHtml) {
		return row.replace("</li>", () => `${movePickerHtml}</li>`);
	}

	// Actions face. Focus menu: [Rename, Move to…, Schedule…, Delete]. No Move
	// up/down — every tab here is a sorted view, not a manual order.
	const moveToItem = hasMoveTargets
		? `<button class="task-menu__item" type="button" data-action="move-task-to" role="menuitem" tabindex="-1" aria-haspopup="menu">Move to…</button>`
		: "";
	// Function replacement here too — same `$&` reasoning as the picker face
	// above. Nothing user-authored is in this string today, but the two call
	// sites must not drift apart.
	return row.replace(
		"</li>",
		() => `<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="rename-task" role="menuitem" tabindex="-1">Rename</button>
			${moveToItem}
			<button class="task-menu__item" type="button" data-action="open-repeat" role="menuitem" tabindex="-1" aria-haspopup="dialog">Schedule…</button>
			<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
}
```

The old `allEmpty` early return is gone — the tab strip must always render, and per-tab empty states arrive in Task 11.

- [ ] **Step 10: Verify**

```bash
npm run test:run && npm run check && npm run build
```

Expected: all tests pass, Biome clean, build clean.

- [ ] **Step 11: Browser check — tabs, at two widths**

Start the dev server and open `http://localhost:5173/ignite/#focus` (the bare root drops the hash — always include `/ignite/`). In **one** `javascript_tool` call per assertion set, so nothing is measured across a round trip:

1. At **1280px**: assert `window.innerWidth`, then that `[role="tablist"]` exists with four `[role="tab"]`, exactly one with `aria-selected="true"` and `tabindex="0"`, and the other three `tabindex="-1"`.
2. Click each tab in turn (via a synthetic `MouseEvent` with `detail: 1` if a real click no-ops) and assert the panel's `id` changes to `focus-panel-<tab>` and `document.activeElement` is the newly-selected tab button — in the same call as the click.
3. Focus the selected tab, dispatch `ArrowRight`, and assert selection moved one tab right and focus followed.
4. At **375px** (`resize_window`): assert `window.innerWidth === 375`, then that all four tabs render, the correct one is selected, and switching still works. **Do NOT assert the ≥44px target height or the strip's scroll behaviour here** — `.focus-tab` has no CSS until Task 14, so the tabs render at the browser's default button height and the assertion cannot pass. That check has been moved to Task 14 Step 6, where the CSS it tests actually exists. (Recorded 2026-08-13: this was a sequencing defect in the plan, caught by the Task 10 implementer.)

- [ ] **Step 12: Commit**

```bash
git add src/views/focus.js
git commit -m "feat(focus): put Today, Tomorrow, Starred and the notepad on tabs"
```

---

## Task 11: Empty states, the area badge, and File on notepad rows

**Files:**
- Modify: `src/views/focus.js`

**Interfaces:**
- Consumes: `areaForTask` (Task 5); `renderTaskRow`'s `areaName` and `showFile` options (Task 7).
- Produces: no new exports. Every panel renders either rows or a message; notepad rows carry a File button; rows on the three dated tabs carry an area badge.

- [ ] **Step 1: Import `areaForTask`**

```javascript
import { areaForTask } from "../utils/areas.js";
```

- [ ] **Step 2: Add the empty states**

Replace `panelBody` with:

```javascript
// Every tab needs an empty state. A blank surface with no message is
// indistinguishable from a broken render, and one of these four (Focus) is the
// very first thing a new user sees.
//
// The Focus copy deliberately does NOT say where the capture bar is. The bar is
// pinned to the BOTTOM on phones and sits at the top from 768px up (decision
// D9), so any directional word is wrong on one of the two — and wrong on the
// primary form factor if it says "above".
const EMPTY_STATE = {
	today: "Nothing due today.",
	tomorrow: "Nothing scheduled for tomorrow.",
	starred: "Star a task to pull it into your day.",
	focus: "Anything you capture lands here.",
};

// Returns { html, isEmpty }. The caller needs the flag, not a guess at it — see
// renderPanel in Step 3.
function panelBody(activeTab, groups, state, rowOpts) {
	if (activeTab === "tomorrow") {
		const html = renderGroup("Tomorrow", "group--tomorrow", groups.tomorrow, true, rowOpts);
		return html ? { html, isEmpty: false } : renderEmpty("tomorrow");
	}
	if (activeTab === "starred") {
		const html = renderGroup("Starred", "group--starred", groups.starred, false, rowOpts);
		return html ? { html, isEmpty: false } : renderEmpty("starred");
	}
	if (activeTab === "focus") {
		const html = renderGroup("Focus", "group--notepad", groups.notepad, false, rowOpts);
		return html ? { html, isEmpty: false } : renderEmpty("focus");
	}

	const next = pickNextTask(groups, state.now);
	if (!next) return renderEmpty("today");
	const visible = (list) => list.filter((t) => t.id !== next.id);
	return {
		html: `
			${renderNextCard(next, rowOpts)}
			${renderGroup("Overdue", "group--overdue", visible(groups.overdue), true, rowOpts)}
			${renderGroup("Today", "group--today", visible(groups.today), true, rowOpts)}
		`,
		isEmpty: false,
	};
}

function renderEmpty(tab) {
	return { html: `<p class="empty">${EMPTY_STATE[tab]}</p>`, isEmpty: true };
}
```

`renderGroup` returns `""` for an empty list, so the ternary is the whole test. `pickNextTask` returns null only when both `overdue` and `today` are empty, so `!next` alone decides the Today tab's empty state — no second condition needed, and it is also what makes `next` non-null below.

- [ ] **Step 3: Make the panel focusable only when it is empty**

An empty panel contains nothing focusable, which strands a keyboard user arrowing off the tab strip. APG's rule is to give exactly that case `tabindex="0"`. Replace `renderPanel`:

```javascript
function renderPanel(activeTab, groups, state, rowOpts) {
	// isEmpty comes back as a flag rather than being sniffed out of the HTML.
	// Testing `body.includes('class="empty"')` would work today — escapeHtml
	// turns a `"` in a task title into `&quot;`, so no row can forge it — but it
	// couples this decision to a class name inside a string and breaks silently
	// the first time someone adds a class or reorders an attribute.
	const { html, isEmpty } = panelBody(activeTab, groups, state, rowOpts);
	// A panel full of rows already holds checkboxes and buttons, so adding a tab
	// stop would just be one more thing to Tab past. An EMPTY panel holds nothing
	// at all, and without tabindex the message is unreachable from the keyboard.
	const focusable = isEmpty ? ' tabindex="0"' : "";
	return `
		<div class="focus-panel" id="focus-panel-${activeTab}" role="tabpanel"
			aria-labelledby="focus-tab-${activeTab}"${focusable}>${html}</div>
	`;
}
```

- [ ] **Step 4: Thread the badge and the File flag into the rows**

In `template`, extend `rowOpts` with the two per-tab facts:

```javascript
	const rowOpts = {
		now: state.now,
		openMenuTaskId,
		renamingTaskId,
		pendingRenameTaskValue,
		taskMenuMode,
		movePickerHtml,
		hasMoveTargets,
		areas: state.areas,
		sections: state.sections,
		// The notepad is entirely Focus-area tasks, so a badge there would say
		// "Focus" on every row. File is the notepad's own affordance: one tap to
		// move a captured thought out, so it never rots for costing two levels of
		// menu to file. Spec D7.
		//
		// File is gated on hasMoveTargets for the same reason "Move to…" is. With
		// only the Focus area and its one section there is nowhere to file to, and
		// an ungated button would render on every row purely to open a picker
		// holding nothing but the disabled "No other sections" hint and Back.
		showBadge: activeTab !== "focus",
		showFile: activeTab === "focus" && hasMoveTargets,
	};
```

and consume them in `renderTaskRowWithMenu` — replace the destructure and the row call:

```javascript
	const {
		now,
		openMenuTaskId,
		renamingTaskId,
		pendingRenameTaskValue,
		taskMenuMode,
		movePickerHtml,
		hasMoveTargets,
		areas,
		sections,
		showBadge,
		showFile,
	} = rowOpts;
```

```javascript
	const isOpen = openMenuTaskId === task.id;
	const areaName = showBadge
		? (areaForTask(task, sections, areas)?.name ?? null)
		: null;
	const row = renderTaskRow(task, { now, isOpen, areaName, showFile });
	if (!isOpen) return row;
```

- [ ] **Step 5: Handle the File click**

Add to the `bindActions` map, next to `"move-task-to"`:

```javascript
		// File is a shortcut, not a new mechanism: it opens this task's own ⋯ menu
		// already switched to picker mode, so pick-move-target, the move undo
		// toast and the picker's a11y all apply unchanged.
		//
		// stopPropagation is REQUIRED. The synchronous doRender below detaches
		// this button, after which the document click handler would see a detached
		// target as "outside" and close the menu it just opened — the same trap
		// documented for move-task-to.
		"file-task": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			openMenuTaskId = t.id;
			taskMenuMode = "picker";
			pendingMenuFocusTaskId = t.id; // §4.2: the picker opens on its first item
			doRender();
		},
```

- [ ] **Step 6: Route focus correctly when a notepad row is filed away**

`pick-move-target` currently sets `pendingFocusTaskId` with the comment "the task stays in Today". That holds on the dated tabs — a move between sections changes neither `dueAt` nor `starred` — and is exactly false on the notepad, where filing is what removes the row. Replace the handler:

```javascript
		"pick-move-target": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			const targetSectionId = actionEl?.dataset?.targetSectionId;
			if (!t || !targetSectionId) return;
			openMenuTaskId = null;
			taskMenuMode = "actions"; // reset for next open
			if (activeTab === "focus") {
				// Filing is precisely what takes the row off this tab, so the ⋯ we
				// would return to will not exist after the render. The Focus tab
				// button always does.
				pendingFocusTab = "focus";
			} else {
				// A move changes neither dueAt nor starred, so the task stays on
				// this tab; refocus its ⋯.
				pendingFocusTaskId = t.id;
			}
			callbacks.onMoveTaskToSection({ taskId: t.id, targetSectionId });
			// No doRender() — the model-notify re-render consumes the focus flag.
			// Toast is the only visible feedback here.
		},
```

- [ ] **Step 7: Verify**

```bash
npm run test:run && npm run check && npm run build
```

Expected: all tests pass, Biome clean, build clean.

- [ ] **Step 8: Browser check — all four empty states, badge, File**

Seed IndexedDB directly rather than clicking through the UI: open `ignite`, read one existing row as a shape template, `put` variants with distinct ids, `location.reload()`. **Delete the seeds afterwards.**

1. **Empty states.** With no tasks at all, visit each tab and assert the panel contains exactly the four `EMPTY_STATE` strings, and that the empty panel carries `tabindex="0"`.
2. **Badge.** Seed a task due today in a user area. At **1280px**, assert the row contains `.task__area-badge` with that area's name. At **375px**, assert `getComputedStyle(badge).display === "none"` — in the same call as the `window.innerWidth` assertion.
3. **File.** Seed an undated, unstarred task in `focus-default`. On the Focus tab, assert the row has a `.task__file` button whose `aria-label` names the task, click it, and assert in the same call that a `[role="menu"]` opened inside the `<li>` and `document.activeElement` is its first `[role="menuitem"]`.
4. **Filing routes focus.** Pick a target section, then assert `document.activeElement` is `.focus-tab[data-tab="focus"]` and not `document.body`. Allow for the async write: click → `await` ~250 ms → assert, all inside one call.
5. **Badge absent on the notepad.** Assert a notepad row has no `.task__area-badge` even at 1280px.

- [ ] **Step 9: Commit**

```bash
git add src/views/focus.js
git commit -m "feat(focus): add empty states, area badges and one-tap filing"
```

---

## Task 12: The page header — heading, greeting, summary

**Files:**
- Modify: `src/controller.js` (`renderPageHeader`, imports)

**Interfaces:**
- Consumes: `groupTasksForFocus`, `formatDayGreeting`, `summariseDay` (Tasks 2 and 4); `FOCUS_ID` (already imported).
- Produces: no new exports. `#page-header` renders `<h1>Focus</h1>`, a greeting `<p>` and a summary `<p>` on the focus route; the area branch is untouched.

- [ ] **Step 1: Extend the time imports**

In `src/controller.js`, replace the `time.js` import:

```javascript
import {
	formatDayGreeting,
	formatDueSummary,
	formatOccurrenceLabel,
	groupTasksForFocus,
	summariseDay,
} from "./utils/time.js";
```

- [ ] **Step 2: Rewrite the focus branch of `renderPageHeader`**

Replace everything after the `if (currentRoute.name === "area") { … }` block:

```javascript
		// The <h1> says "Focus", not the date. A heading names WHERE YOU ARE, and
		// a screen-reader user navigating by heading needs a landmark that is the
		// same every day. The date is the greeting beneath it. Spec §3.1.
		const focusSectionIds = state.sections
			.filter((s) => s.areaId === FOCUS_ID)
			.map((s) => s.id);
		// Computed here as well as in the view. Both calls take the same `state`,
		// including the same `now`, so the summary and the tab counts agree by
		// construction — which is the property worth paying one extra O(n) pass
		// for. Threading groups through `state` would make the view depend on the
		// controller having computed them first.
		const groups = groupTasksForFocus(state.tasks, state.now, focusSectionIds);
		const { overdue, dueToday } = summariseDay(groups);
		// The overdue count is emphasised, and omitted entirely at zero — "0
		// overdue" is a reassurance nobody asked for. The Overdue group keeps its
		// own heading and count, so this line is never the only route to the
		// number (§8).
		const summary = [
			overdue > 0
				? `<strong class="page-header__overdue">${overdue} overdue</strong>`
				: "",
			`${dueToday} due today`,
		]
			.filter(Boolean)
			.join(" · ");

		// No escapeHtml on the greeting: formatDayGreeting composes it from two
		// constant arrays and a number, with no user-authored input anywhere.
		pageHeaderRoot.innerHTML = `
			<h1 class="page-header__title">Focus</h1>
			<p class="page-header__greeting">${formatDayGreeting(state.now)}</p>
			<p class="page-header__summary">${summary}</p>
		`;
```

- [ ] **Step 3: Verify**

```bash
npm run test:run && npm run check && npm run build
```

Expected: all tests pass, Biome clean, build clean.

- [ ] **Step 4: Browser check — the heading contract**

In one `javascript_tool` call: assert `document.querySelectorAll("h1").length === 1`, that its text is exactly `Focus`, that `.page-header__greeting` matches `/^[A-Z][a-z]+ \d{1,2} [A-Z][a-z]+$/`, and that `.page-header__summary` reads `N due today` with no overdue clause when nothing is overdue. Then seed an overdue task, reload, and assert the summary now leads with a `<strong>` whose text ends in `overdue` **and** that the Overdue group heading still carries its own count.

- [ ] **Step 5: Commit**

```bash
git add src/controller.js
git commit -m "feat(focus): head the page with Focus, the day and the day's shape"
```

---

## Task 13: Capture feedback and the sidebar

**Files:**
- Modify: `src/controller.js` (the capture callback, `mountMainView`, one new transient field)
- Modify: `src/views/sidebar.js` (`template`)

**Interfaces:**
- Consumes: `selectTab` / `getActiveTab` (Task 10); `toast.show`'s `onAction` / `actionLabel` (Task 6).
- Produces: no new exports. Capture on the Focus route raises `Added to Focus` with a **View** action; the sidebar no longer lists Focus as an area.

- [ ] **Step 1: Add the pending-tab field and consume it on mount**

The View action can be clicked after the user has already navigated to an area — the toast lives five seconds and survives a route change, because `#toast-root` is a body child. At that point `currentMainView` is the *area* view, which has no `selectTab`, so `?.` swallows the call and the button does nothing at all. A dead button is worse than no button.

In `src/controller.js`, declare the field beside the other transient UI state (grep `let repeatEditorTaskId`):

```javascript
	let pendingTabSelection = null; // transient UI state — NOT a model field
```

and consume it at the end of `mountMainView`'s focus branch, immediately before its `return;`:

```javascript
			// Something asked for a specific tab on the next Focus view — today
			// only the capture toast's View action, fired after a route change.
			// selectTab before the first render(state) is safe: doRender early-
			// returns on a null lastState, activeTab is already set, and the
			// applyState below renders the right tab.
			if (pendingTabSelection) {
				currentMainView.selectTab(pendingTabSelection);
				pendingTabSelection = null;
			}
			return;
```

- [ ] **Step 2: Give capture its feedback**

In `src/controller.js`, replace the `capture = createCaptureView(...)` call in `start()`:

```javascript
		capture = createCaptureView(captureRoot, {
			// No `starred` — a star means "I chose this for today", and capture
			// setting it on everything made the signal worthless. Spec D2.
			onSubmit: async (title, sectionId) => {
				// SNAPSHOT BOTH BEFORE THE WRITE. Each of these can change while the
				// IndexedDB write is in flight — one sidebar click during the await is
				// enough — and reading them afterwards makes the toast announce
				// "Added to Focus" for a task that went into an area. Same trap as
				// wasDrawerOpen in deleteAreaCascade, and the lesson recorded there
				// is that a race like this usually has more than one late read.
				const wasFocusRoute = currentRoute.name === "focus";
				const tabBefore = currentMainView?.getActiveTab?.();

				await tasks.create({ sectionId, title });

				// Capture on Focus writes into the notepad, which is usually not the
				// tab on screen — so say where it went and offer one tap to look.
				// Skipped when the notepad WAS on screen: the row is right there, and
				// a toast about something visible is noise. Spec §3.4.
				if (!wasFocusRoute || tabBefore === "focus") return;
				toast.show({
					message: "Added to Focus",
					actionLabel: "View",
					durationMs: MOVE_TOAST_MS,
					onAction: () => {
						// The user may have left Focus since the toast appeared. Route
						// there first and let mountMainView apply the tab; the direct
						// call covers the ordinary case where we never left.
						if (currentRoute.name !== "focus") {
							pendingTabSelection = "focus";
							window.location.hash = "#focus";
							return;
						}
						currentMainView?.selectTab?.("focus");
					},
				});
			},
			focusSectionId: FOCUS_DEFAULT_SECTION_ID,
		});
```

The capture view awaits `onSubmit` and clears the input only on success, so the toast appearing before the clear is the intended order. This toast cannot collide with the capture picker: it fires only on the Focus route, where `captureDestination` returns `{ kind: "focus" }` and no picker ever opens.

- [ ] **Step 3: Stop listing Focus in the sidebar**

In `src/views/sidebar.js`'s `template`, replace the area-list construction:

```javascript
	const sorted = state.areas.slice().sort((a, b) => a.order - b.order);
	// Focus is no longer a listed area — it IS the landing surface, reached by
	// the wordmark above. Listing it as well would be a second door onto the same
	// tasks, and its rename and icon controls belong to a surface that no longer
	// exists here. Spec D1.
	const userAreas = sorted.filter((a) => a.id !== FOCUS_ID);
	const firstUserAreaId = userAreas[0]?.id ?? null;
	const lastUserAreaId = userAreas[userAreas.length - 1]?.id ?? null;
	const items = userAreas
		.map((area) =>
			renderAreaRow(area, state, route, {
				canMoveUp: area.id !== firstUserAreaId,
				canMoveDown: area.id !== lastUserAreaId,
				isUndeletable: false,
				openAreaMenuId,
				renamingAreaId,
				pendingRenameValue,
			}),
		)
		.join("");
```

`FOCUS_ID` stays imported — it is what the filter tests. `isUndeletable` stays in `renderAreaRow`'s options: the only area it ever guarded is now unlisted, but the parameter is part of that function's contract and `renderAreaMenu` reads it.

- [ ] **Step 4: Verify**

```bash
npm run test:run && npm run check && npm run build
```

Expected: all tests pass, Biome clean, build clean.

- [ ] **Step 5: Browser check — capture round trip and the sidebar**

1. On `#focus`, Today tab: type into the capture input and submit with `form.requestSubmit()` (**the CDP pane's Return produces `event.key === ""` and fires no native submit** — a real Enter has never driven this path; that manual phone pass is still outstanding). In the same call, `await` ~250 ms, then assert the toast reads `Added to Focus` and its action button reads `View`.
2. Click **View** and assert the Focus tab is selected, the panel id is `focus-panel-focus`, and the new task's title is in the panel.
3. Capture again while already on the Focus tab and assert **no** toast appears.
4. **View after a route change.** Capture on the Focus tab strip's Today tab, then — inside the same call, before the 5 s window closes — navigate to an area, `await` a tick, click View, `await` ~250 ms, and assert the route is `#focus`, the panel id is `focus-panel-focus`, and the Focus tab carries `aria-selected="true"`. This is the `pendingTabSelection` path; without it the button silently does nothing.
5. **The back button is not a trap.** Navigate to `#area/focus` directly, assert the URL settles on `#focus` and the surface renders, then go Back and assert you land on whatever preceded it — **not** back on `#focus`. `replaceState` is what makes this pass; an assignment to `location.hash` would loop.
6. Assert the sidebar's `.sidebar__area-row` list contains no row with `data-area-id="focus"`, and that the remaining rows' Move up / Move down are enabled correctly at the ends — the first user area must now offer no Move up.
7. Delete the tasks you seeded.

- [ ] **Step 6: Commit**

```bash
git add src/controller.js src/views/sidebar.js
git commit -m "feat(focus): confirm captures with a View action and unlist Focus from the rail"
```

---

## Task 14: Layout, and the README

**Files:**
- Modify: `main.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: the class names Tasks 7, 8, 10 and 11 introduced: `.focus-tabs`, `.focus-tab`, `.focus-tab__count`, `.focus-panel`, `.task__area-badge`, `.group--tomorrow`, `.group--notepad`, `.page-header__greeting`, `.page-header__summary`, `.page-header__overdue`.
- Produces: no new API.

- [ ] **Step 1: Style the tab strip and panel**

In `main.css`, insert immediately **before** the `/* --- NEXT card --- */` comment (so these base rules precede the state overrides further down and specificity stays ascending — appending to the end trips Biome's `noDescendingSpecificity`):

```css
/* --- Focus tabs --- */
.focus-tabs {
	display: flex;
	gap: var(--space-1);
	margin: 0 0 var(--space-4);
	border-bottom: 1px solid var(--border);
	/* Four 44px targets plus their counts do not fit 375px. The strip scrolls;
	   the targets do NOT shrink (spec §8.1).
	   Deliberately NOT `scrollbar-width: none`: at 375px the fourth tab sits off
	   screen, and the scrollbar is the only cue that it is there at all. Mobile
	   browsers auto-hide overlay scrollbars anyway, and the strip does not
	   overflow on desktop, so hiding it buys nothing and costs the affordance. */
	overflow-x: auto;
}
.focus-tab {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	gap: var(--space-2);
	min-height: 44px;
	padding: 0 var(--space-3);
	background: none;
	border: none;
	border-bottom: 2px solid transparent;
	color: var(--text-muted);
	font: inherit;
	font-size: var(--text-sm);
	cursor: pointer;
}
.focus-tab:hover {
	color: var(--text);
}
.focus-tab.is-active {
	color: var(--text);
	border-bottom-color: var(--accent);
}
/* A real token colour, never opacity: opacity compounds against whatever is
   behind it, so a value that passes contrast on one surface fails on another.
   Spec §8.2. `--text-sm` matches `.group__count`, which is the same idea in the
   same palette — `--text-xs` (12px) would make this the smallest text anywhere
   in the app, below even the 13.6px time label. */
.focus-tab__count {
	color: var(--text-faint);
	font-size: var(--text-sm);
}
.focus-tab.is-active .focus-tab__count {
	color: var(--text-muted);
}
.focus-panel:focus-visible {
	outline: 2px solid var(--accent);
	outline-offset: 2px;
}
```

There is no tab transition to gate: selection is a border-colour and colour swap with no `transition` property, so `prefers-reduced-motion` has nothing to suppress. **Do not add one** — it would then need the gate.

- [ ] **Step 2: Give the badge and time real columns at ≥768px**

Add the badge's base rule directly after the existing `.task__time-label, .task__recurring` rule:

```css
/* Phone: the row is title-first, so the badge drops out entirely (spec §7).
   display:none takes it out of the accessibility tree too — accepted, because
   the area is not conveyed to the sighted phone user either. */
.task__area-badge {
	display: none;
	color: var(--text-muted);
	font-size: var(--text-sm);
}
/* Fixed bases so the columns line up across every group. `.task__title` is the
   only flex:1 child, which is what absorbs the conditional ⟲ glyph; every OTHER
   child must refuse to shrink or the alignment drifts row to row.
   `.task__check` and `.task__recurring` are in this list on purpose: both
   default to `flex: 0 1 auto`, so under pressure they compress by a fraction and
   every column to their right moves with them. A partially-pinned row is the
   version that looks right on seeded data and wrong on a real list, and §7 calls
   this alignment the work. */
.task__check,
.task__recurring,
.task__star,
.task__menu-btn {
	flex: 0 0 auto;
}
```

and add a `@media (min-width: 768px)` block immediately after it:

```css
@media (min-width: 768px) {
	.task__area-badge {
		display: block;
		flex: 0 0 8rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.task__time-label {
		flex: 0 0 6rem;
		text-align: right;
	}
}
```

- [ ] **Step 3: Tighten the phone page padding and style the header lines**

Change the phone value of `--main-padding` (grep `--main-padding: var(--space-5)`) — the ≥768px override to `2rem` is untouched:

```css
	--main-padding: var(--space-4);
```

`--space-5` is `1.5rem` and `--space-4` is `1rem`, so the phone gains 1rem of row width on each side.

**Know the blast radius before you change it — four rules read this variable, not one.** `#main`'s padding (`main.css:111`, the intended target) and its `padding-block-end: calc(var(--main-padding) + var(--capture-h))` (`:1112`), plus **`.area`** (`:579`, the area shell's own padding *inside* `#main`) and the **mobile capture bar**'s horizontal padding (`:1104`). That sharing is deliberate and worth keeping: it is what holds the capture bar's left edge in line with the rows above it, and the area view tightens by the same amount for the same reason. Do **not** hard-code a replacement value at any of the four sites, and do not touch `--capture-h`. The ≥768px override to `2rem` is untouched, so nothing changes on desktop.

Add the header lines after the existing `.page-header__date` rule (and delete `.page-header__date`, whose element no longer renders):

```css
.page-header__greeting {
	margin: var(--space-1) 0 0;
	color: var(--text-muted);
	font-size: var(--text-sm);
}
.page-header__summary {
	margin: var(--space-1) 0 0;
	color: var(--text-muted);
	font-size: var(--text-sm);
}
.page-header__overdue {
	color: var(--color-overdue);
	font-weight: 600;
}
```

`--color-overdue` is the token `.group--overdue .group__heading` already uses, so the emphasis matches the group it points at.

- [ ] **Step 4: Update the README**

Three edits in `README.md`. Keep the existing tone — plain, no marketing, no badges.

Replace the **Today view** bullet (line 35) with two bullets, leaving the rest of the list in place:

```markdown
- **Focus** — the landing surface, on four tabs: Today (what's overdue and what's due, led by what's next), Tomorrow, Starred, and Focus itself — the notepad every capture lands in until you file it
- **One-tap filing** — a note moves out of the notepad into any section without going through a menu
```

The existing **Tasks** bullet (line 38) already ends "tasks in Focus file into any section in one tap", which the new bullet now says better — trim that clause from the Tasks bullet so the two do not repeat each other.

Update the screenshot alt text (line 9), which still describes the old surface:

```markdown
![Ignite in dark mode — the Focus view showing the tab strip, a Next card and a Today group, with the area sidebar and theme control on the left](docs/desktop_preview.png)
```

Leave the **Status** line (line 7) and the two "228 tests" mentions alone unless the suite total actually changed — read the count off the test runner's output at Step 5 and update all three occurrences to whatever it really is. Do not carry the number forward from this plan. `docs/desktop_preview.png` itself is now out of date; **retaking it is Malin's call**, not this task's — flag it rather than replacing the file.

- [ ] **Step 5: Verify**

```bash
npm run test:run && npm run check && npm run build
```

Expected: all tests pass, Biome clean (watch specifically for `noDescendingSpecificity`), build clean.

- [ ] **Step 6: Browser check — the alignment, at both widths**

This is the check the project has skipped twice, at a cost of two Criticals. Measure geometry, do not read computed styles, and assert the viewport width in the same call.

1. At **1280px**, seed at least six tasks across Overdue and Today, mixing recurring with non-recurring and long titles with short. Then, in one call: assert `window.innerWidth === 1280`, collect `getBoundingClientRect().left` for every `.task__area-badge` and every `.task__time-label` across **both** groups, and assert each set has exactly one distinct value (allow a sub-pixel epsilon). A recurring row must not shift its neighbours' columns.
2. Same call: assert no `.task__title` overflows its row — `scrollWidth <= clientWidth + 1` after ellipsis.
3. At **375px**: assert `window.innerWidth === 375`, that every `.task__area-badge` computes `display: none`, that `.task__time-label` is still visible (the *column* drops on phones, not the time — losing it would undo Plan 2 on the surface that exists to show it), and that no `.task` row's `getBoundingClientRect().right` exceeds `window.innerWidth`.
4. Same call at 375px: assert the capture bar still clears the last row — the last `.task`'s `bottom` is above `#capture-root`'s `top`.
5. **The area view at 375px**, because `--main-padding` reaches it too. Navigate to a user area and assert no `.section` or `.task` row's `right` exceeds `window.innerWidth`, and that the capture bar's left edge still lines up with the rows above it (`#capture-root`'s content-box `left` equals a `.task`'s `left` within a pixel). The tightened padding nests — `.area` sits inside `#main` and both read the variable — so this is where a wrong value shows up, not on Focus.
6. **The tab strip's touch targets, moved here from Task 10** because this is the task that gives `.focus-tab` its CSS. At 375px, in one call: assert `window.innerWidth === 375`, then `getBoundingClientRect()` on every one of the four tabs shows `height >= 44`, and `.focus-tabs` has `scrollWidth >= clientWidth` — **the strip scrolls, the targets do not shrink** (§8.1). Also assert the strip is genuinely scrollable rather than clipped: `getComputedStyle(strip).overflowX` is `auto`, and no tab's `right` is unreachable by scrolling.
7. Toggle to light theme and re-assert the tab strip and count colours render (a screenshot is fine here; a DOM read is better evidence for the geometry above).

- [ ] **Step 7: Commit**

```bash
git add main.css README.md
git commit -m "feat(focus): lay out the tab strip and the badge and time columns"
```

---

## After the last task

- [ ] **Whole-branch review.** Per-task review is task-scoped by construction and has missed a Critical on each of the last two runs — the v2 icon picker crushing the rename row, and v3 Plan 1's two contradictory contracts for one promise. Budget an opus review over the entire diff, told explicitly to look for cross-task contract drift and for anything that only breaks at a width nobody measured.
- [ ] **An axe pass over the Focus surface, on every tab.** Scope axe to `#main` — `page-has-heading-one` and `landmark-one-main` fire on the inert background whenever a dialog is open, and that is a known artifact, not a defect. The tab strip is a new ARIA composite and has never been checked; so is the empty panel's `tabindex`. **The schedule-dialog axe pass Plan 2 left owed is still owed** and is worth folding into the same session.
- [ ] **Verify the counts before reporting them.** Read the test count off the runner's output, not off this plan.

## Verification checklist from the spec

§9 requires browser verification of each of these. Tasks 10, 11, 13 and 14 cover them; tick them off as a set before calling the plan done.

- [ ] Capture on Focus lands in the notepad, unstarred, with the toast and a working View
- [ ] Capture in a multi-section area still opens the picker; in a single-section area it still writes directly
- [ ] The inline add run still keeps its row focused across several entries
- [ ] Filing out of Focus works and focus lands on the Focus tab, never `<body>`
- [ ] Tab switching by keyboard: arrows traverse, exactly one tab stop
- [ ] Switching tab **mid-rename** commits the rename, focus lands on the new tab, nothing reaches `<body>`
- [ ] Switching tab with a ⋯ menu open closes the menu and lands focus on the new tab
- [ ] Dismissing the capture picker by route change and by outside click leaves the typed text
- [ ] Escape out of the capture picker: text intact, focus on the input
- [ ] All four empty states
- [ ] Tab strip at 375px: targets ≥44px, strip scrolls
- [ ] ≥768px column alignment across every group
