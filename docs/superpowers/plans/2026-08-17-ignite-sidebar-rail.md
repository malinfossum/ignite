# Ignite Sidebar Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the 48px collapsed sidebar as a status-and-navigation rail with no loss of function, and give the Focus surface a real front door.

**Architecture:** One DOM rendered as a CSS variant. The template never branches on `sidebarCollapsed`, because that flag is also true on mobile where the drawer is full width — every rail rule lives inside `@media (min-width: 768px)`. Accessible names move onto the buttons themselves so they are correct in both states without depending on which children are painted. Counts come from one shared pure helper so the page header and the sidebar cannot disagree.

**Tech Stack:** Vanilla JS (MVC), Vite 8, Vitest 4, Biome 2.4, IndexedDB. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-08-17-ignite-sidebar-rail-design.md`](../specs/2026-08-17-ignite-sidebar-rail-design.md)

## Global Constraints

- **Mobile-first CSS only.** `min-width` media queries. A `max-width` query is a defect — never add one.
- **Every rail rule lives inside `@media (min-width: 768px)`.** `sidebarCollapsed` is also true on mobile, where the drawer is full width and labels must stay visible.
- **`#sidebar { overflow-y: visible }` at ≥768px is an invariant.** It is the only reason a popover can escape a 48px column. Never change it to `auto` or `hidden`.
- **`design-system/` is READ-ONLY.** Never hand-edit it. Overrides go in `main.css`.
- **Line endings are LF**, pinned by `.gitattributes`. If `npm run check` complains about CRLF, fix the checkout — never the Biome config.
- **No `Co-Authored-By` trailer and no Claude attribution in any commit.** Malin is sole author.
- **Unit tests cover the pure-function seam only** (`src/utils/*.js`, model helpers). Views and the controller have no unit coverage by design; they are verified in the browser.
- **Run before every commit:** `npm run check && npm run test:run`.
- Existing token aliases in use: `--accent-soft`, `--accent-rgb`, `--surface-1..5`, `--text`, `--text-muted`, `--border`, `--space-1..4`, `--radius`, `--radius-sm`, `--duration-fast`, `--ease-standard`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/utils/focus-counts.js` | Pure derivation of Focus section ids and the day's counts | **Create** |
| `tests/utils/focus-counts.test.js` | Unit tests for the above | **Create** |
| `src/views/sidebar.js` | Sidebar template + interaction; gains accessible names, the hero card, the count class | Modify |
| `src/controller.js` | Page header uses the shared helper; `onAddArea` seeds a section | Modify |
| `src/views/focus.js` | Tab counts use the shared helper | Modify |
| `main.css` | All rail presentation | Modify |
| `docs/superpowers/specs/2026-08-17-ignite-sidebar-rail-design.md` | D3 mechanism correction | Modify (Task 2) |

---

### Task 1: Shared focus-counts helper

Removes the byte-identical `focusSectionIds` derivation from two call sites and gives the sidebar a third consumer that cannot drift from them.

**Files:**
- Create: `src/utils/focus-counts.js`
- Create: `tests/utils/focus-counts.test.js`
- Modify: `src/controller.js:149-158`
- Modify: `src/views/focus.js:569-579`

**Interfaces:**
- Consumes: `groupTasksForFocus(tasks, now, focusSectionIds)` and `summariseDay(groups)` from `src/utils/time.js`.
- Produces:
  - `focusSectionIds(sections, focusAreaId) → string[]`
  - `focusCounts(sections, tasks, now, focusAreaId) → { sectionIds: string[], groups: {overdue,today,tomorrow,starred,notepad}, overdue: number, dueToday: number, attention: number }`
  - `attention === overdue + dueToday` — the single number the rail badge shows.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/focus-counts.test.js`:

```js
import { describe, expect, it } from "vitest";
import { focusCounts, focusSectionIds } from "../../src/utils/focus-counts.js";

const NOW = new Date("2026-04-28T14:00:00");

const section = (overrides) => ({
	id: "s1",
	areaId: "focus",
	name: "Tasks",
	collapsed: false,
	order: 0,
	...overrides,
});

const task = (overrides) => ({
	id: "t1",
	sectionId: "s1",
	title: "Test task",
	notes: "",
	completed: false,
	starred: false,
	critical: false,
	dueAt: null,
	hasTime: false,
	recurrence: null,
	leadTime: 0,
	scheduledTags: [],
	createdAt: "2026-04-28T08:00:00.000Z",
	order: 0,
	...overrides,
});

describe("focusSectionIds", () => {
	it("returns every section belonging to the focus area", () => {
		const sections = [
			section({ id: "a" }),
			section({ id: "b" }),
			section({ id: "c", areaId: "work" }),
		];
		expect(focusSectionIds(sections, "focus")).toEqual(["a", "b"]);
	});

	it("returns an empty array when no section matches", () => {
		expect(focusSectionIds([section({ areaId: "work" })], "focus")).toEqual([]);
	});

	it("returns an empty array for an empty section list", () => {
		expect(focusSectionIds([], "focus")).toEqual([]);
	});
});

describe("focusCounts", () => {
	it("counts overdue and due-today separately and sums them into attention", () => {
		const sections = [section({ id: "s1" })];
		const tasks = [
			task({ id: "t1", dueAt: "2026-04-27T09:00:00.000Z" }),
			task({ id: "t2", dueAt: "2026-04-28T09:00:00.000Z" }),
			task({ id: "t3", dueAt: "2026-04-28T18:00:00.000Z" }),
		];
		const result = focusCounts(sections, tasks, NOW, "focus");
		expect(result.overdue).toBe(1);
		expect(result.dueToday).toBe(2);
		expect(result.attention).toBe(3);
	});

	it("ignores completed tasks", () => {
		const sections = [section({ id: "s1" })];
		const tasks = [
			task({ id: "t1", dueAt: "2026-04-28T09:00:00.000Z", completed: true }),
		];
		expect(focusCounts(sections, tasks, NOW, "focus").attention).toBe(0);
	});

	it("returns zeroes when there are no sections and no tasks", () => {
		const result = focusCounts([], [], NOW, "focus");
		expect(result.sectionIds).toEqual([]);
		expect(result.overdue).toBe(0);
		expect(result.dueToday).toBe(0);
		expect(result.attention).toBe(0);
	});

	it("exposes the same groups object groupTasksForFocus produces", () => {
		const sections = [section({ id: "s1" })];
		const tasks = [task({ id: "t1", starred: true })];
		const result = focusCounts(sections, tasks, NOW, "focus");
		expect(result.groups.starred).toHaveLength(1);
		expect(result.groups.starred[0].id).toBe("t1");
	});
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/utils/focus-counts.test.js`
Expected: FAIL — `Failed to resolve import "../../src/utils/focus-counts.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/focus-counts.js`:

```js
// One derivation of "what is in Focus, and how much of it needs attention today".
//
// Before this file the section-id filter existed byte-for-byte in controller.js
// (for the page-header summary) and views/focus.js (for the tab counts). The
// sidebar's hero card is the third consumer, and a one-sided edit across three
// copies would silently desync numbers that sit on screen at the same time.
//
// `focusAreaId` arrives as a parameter, not an import: utils/ must stay ignorant
// of FOCUS_ID, the same contract utils/time.js keeps.

import { groupTasksForFocus, summariseDay } from "./time.js";

export function focusSectionIds(sections, focusAreaId) {
	return sections.filter((s) => s.areaId === focusAreaId).map((s) => s.id);
}

export function focusCounts(sections, tasks, now, focusAreaId) {
	const sectionIds = focusSectionIds(sections, focusAreaId);
	const groups = groupTasksForFocus(tasks, now, sectionIds);
	const { overdue, dueToday } = summariseDay(groups);
	// `attention` is what the collapsed rail's single badge shows: one number for
	// "needs looking at today". The expanded card spells out the breakdown.
	return { sectionIds, groups, overdue, dueToday, attention: overdue + dueToday };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/utils/focus-counts.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 5: Rewire the controller**

In `src/controller.js`, add to the imports near the top (alongside the existing `./model/areas.js` import):

```js
import { focusCounts } from "./utils/focus-counts.js";
```

Replace lines 149-158 (from `const focusSectionIds = state.sections` through `const { overdue, dueToday } = summariseDay(groups);`) with:

```js
		// One shared derivation with the Focus tab counts and the sidebar hero
		// card — see utils/focus-counts.js for why this is not inlined here.
		const { overdue, dueToday } = focusCounts(
			state.sections,
			state.tasks,
			state.now,
			FOCUS_ID,
		);
```

Then remove `groupTasksForFocus` and `summariseDay` from the `./utils/time.js` import in `controller.js` **only if nothing else in the file uses them** — check with `grep -n "groupTasksForFocus\|summariseDay" src/controller.js` first and leave any still-used name in place.

- [ ] **Step 6: Rewire the Focus view**

In `src/views/focus.js`, add to the imports:

```js
import { focusCounts } from "../utils/focus-counts.js";
```

Replace lines 569-579 (from `const focusSectionIds = state.sections` through the closing `};` of `counts`) with:

```js
	// Shared with the page-header summary and the sidebar hero card so the three
	// can never disagree — see utils/focus-counts.js.
	const { groups } = focusCounts(
		state.sections,
		state.tasks,
		state.now,
		FOCUS_ID,
	);
	const counts = {
		today: groups.overdue.length + groups.today.length,
		tomorrow: groups.tomorrow.length,
		starred: groups.starred.length,
		focus: groups.notepad.length,
	};
```

Remove `groupTasksForFocus` from the `../utils/time.js` import in `focus.js` **only if** `grep -n "groupTasksForFocus" src/views/focus.js` shows no other use.

- [ ] **Step 7: Run the full suite and the linter**

Run: `npm run check && npm run test:run`
Expected: Biome reports no diagnostics; all tests pass (251 existing + 8 new = 259).

- [ ] **Step 8: Commit**

```bash
git add src/utils/focus-counts.js tests/utils/focus-counts.test.js src/controller.js src/views/focus.js
git commit -m "refactor(focus): derive the day's counts in one shared helper

The focusSectionIds filter existed byte-for-byte in controller.js and
views/focus.js. The sidebar hero card needs the same numbers, and a third
copy is how the page header and the sidebar start disagreeing on screen."
```

---

### Task 2: Accessible names on the sidebar buttons

Fixes the spec's headline defect — area buttons with no accessible name — and does it in a way that is correct in both states, so no later CSS task can reintroduce it.

**Spec deviation, deliberate.** Spec D3 says labels are *clipped, not removed*. Clipping cannot work here: `.sidebar__name` is the **visible** label when expanded, so it cannot also carry a screen-reader-only phrase like "Hjemme, 3 open". Putting the name on the button as `aria-label` and marking the painted children `aria-hidden` gives one correct name in both states, satisfies WCAG 2.5.3 Label in Name (the accessible name contains the visible text), and removes the need for the clip technique on area rows entirely. This step updates the spec to match.

**Files:**
- Modify: `src/views/sidebar.js:513-517` (add-area button), `:573-588` (area row)
- Modify: `docs/superpowers/specs/2026-08-17-ignite-sidebar-rail-design.md` (D3 + §3.3)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `.sidebar__count` gains an `is-zero` class when `count === 0`; `.sidebar__add-glyph` and `.sidebar__add-text` are new spans inside `.sidebar__add-area`. Tasks 4 and 5 target all three.

- [ ] **Step 1: Give the area button its accessible name**

In `src/views/sidebar.js`, in `renderAreaRow`, replace the return block that starts `<li class="sidebar__area-row"` (lines 573-588) with:

```js
	// The accessible name lives on the button, not in its children. In the rail
	// the label and count are not painted, and a name assembled from painted
	// children would vanish with them — the exact defect this replaces. Both
	// spans are aria-hidden so the name is stated once, identically, in both
	// states. WCAG 2.5.3 holds: the visible "Hjemme" is contained in "Hjemme, 3 open".
	const countClass = count === 0 ? "sidebar__count is-zero" : "sidebar__count";

	return `
		<li class="sidebar__area-row" data-area-id="${escapeHtml(area.id)}">
			<button type="button" class="sidebar__area ${activeClass}"
				data-action="open-area" data-id="${escapeHtml(area.id)}" ${aria}
				aria-label="${escapeHtml(area.name)}, ${count} open">
				<span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
				<span class="sidebar__name" aria-hidden="true">${escapeHtml(area.name)}</span>
				<span class="${countClass}" aria-hidden="true">${count}</span>
			</button>
			<button type="button" class="sidebar__menu-btn"
				data-action="open-area-menu"
				aria-haspopup="menu"
				aria-expanded="${isOpen}"
				aria-label="Area options: ${escapeHtml(area.name)}">⋯</button>
			${menu}
		</li>
	`;
```

- [ ] **Step 2: Give the add-area button its accessible name**

In the same file, in `template`, replace the `<li class="sidebar__add-area-row">` block (lines 513-517) with:

```js
			<li class="sidebar__add-area-row">
				<button type="button" class="sidebar__add-area" data-action="add-area"
					aria-label="New area">
					<span class="sidebar__add-glyph" aria-hidden="true">＋</span>
					<span class="sidebar__add-text" aria-hidden="true">New area</span>
				</button>
			</li>
```

- [ ] **Step 3: Verify in the browser**

Start the dev server with the Browser pane preview (`ignite-dev`, port 5173) — never `npm run dev` in a terminal.

At desktop width, expanded sidebar: read the accessibility tree and confirm each area button's name is `"<Area name>, <N> open"` and the add button's name is `"New area"`. Confirm the visible rendering is unchanged — same label, same count, same ＋ row.

- [ ] **Step 4: Update the spec to match**

In `docs/superpowers/specs/2026-08-17-ignite-sidebar-rail-design.md`, replace the D3 row:

```markdown
| D3 | Accessible names live on the **button** via `aria-label`, with painted children `aria-hidden` | A clipped label cannot work on area rows — `.sidebar__name` is the *visible* label when expanded. One name, stated once, correct in both states (§3.3) |
```

And in §3.3, replace the bullet `- \`.sidebar__name\`, clipped (position/1px/clip-rect, per D3) so the accessible name survives` with:

```markdown
- `.sidebar__name`, not painted in the rail. The name is not lost, because `.sidebar__area` carries `aria-label="<name>, <N> open"` and both spans are `aria-hidden` — see D3
```

Then replace the paragraph beginning **"The count must not land in the accessible name as a bare integer."** with:

```markdown
**The count does not land in the accessible name as a bare integer.** The button's `aria-label` states it with a unit — "Hjemme, 3 open" — and `.sidebar__count` is `aria-hidden`, so the painted badge never contributes a stray number.
```

- [ ] **Step 5: Run the linter and tests**

Run: `npm run check && npm run test:run`
Expected: no diagnostics, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/views/sidebar.js docs/superpowers/specs/2026-08-17-ignite-sidebar-rail-design.md
git commit -m "fix(a11y): name sidebar buttons on the button, not from painted children

Area buttons had no accessible name at all when collapsed: the icon span is
aria-hidden and the label and count were display:none, which removed the
button's entire name. Clipping the label cannot fix it, because that span is
the visible label when expanded. aria-label states the name once, correctly,
in both states."
```

---

### Task 3: A new area is created with a section

Independent of every CSS task. Do it early so the rail's ＋ never ships a one-click path to an unusable area.

**Files:**
- Modify: `src/controller.js:712-716`

**Interfaces:**
- Consumes: `sections.create({ areaId, name, collapsed })` from `src/model/sections.js:45`, which returns the created section and notifies section subscribers.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Orchestrate both creates in the controller**

In `src/controller.js`, in `sidebarCallbacks()`, replace the `onAddArea` handler (lines 712-716) with:

```js
			onAddArea: async () => {
				const area = await areas.create({ name: "New area" });
				// Seed a section so the area is usable and a valid move target the
				// moment it exists. Composed HERE, not inside areas.create: a model
				// that writes to another model's store notifies its own listeners
				// only, so the section model would never hear about a section that
				// now exists. ensureFocus gets away with that only because it runs
				// before any subscriber exists.
				await sections.create({ areaId: area.id, name: "Tasks" });
				window.location.hash = `#area/${area.id}`;
				sidebar.enterRename(area.id);
			},
```

The section is created **before** the hash change so the area page's first render already has it.

- [ ] **Step 2: Verify in the browser**

In the preview, click **＋ New area**. Expected: the app navigates to the new area, the sidebar row enters rename mode with an empty field, and the area page shows one section named "Tasks" — not an empty-area state.

Then open any task's **Move** picker and confirm the new area appears as a destination with its "Tasks" section.

- [ ] **Step 3: Run the linter and tests**

Run: `npm run check && npm run test:run`
Expected: no diagnostics, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/controller.js
git commit -m "fix(areas): give a new area a section so it can be used

onAddArea created an area with no section, so nothing could be filed into it
and it was not a valid move target until a section was added by hand."
```

---

### Task 4: Rail geometry — padding, tiles, toggle, ＋

The structural fix. After this task nothing overflows, but badges, the hero card, the ⋯ and rename are still to come.

**Files:**
- Modify: `main.css:196-202` (the label/count collapsed rule), `:1119-1126` (the collapsed display-none rule)
- Modify: `main.css` — add a new rail block **after the base `.sidebar__*` rules it overrides**, not near the top of the file. Biome's `noDescendingSpecificity` fires if the block precedes them, and this file's existing convention is to keep specificity ascending in source order (see the comments at `main.css:181` and `:1251`). In the shipped result the block lives at roughly line 1111.

**Interfaces:**
- Consumes: `.sidebar__add-glyph` / `.sidebar__add-text` from Task 2.
- Produces: `.sidebar__icon` is the painted 36px tile in the rail; `.sidebar__area`, `.sidebar__toggle` and `.sidebar__add-area` are 44px hit targets. Tasks 5-8 position badges and popovers against these.

- [ ] **Step 1: Shrink the rail's own padding and centre its children**

In `main.css`, replace the collapsed label/count rule at lines 196-202 with:

```css
/* Collapsed rail — desktop only. The rail is a CSS VARIANT of the same DOM, not
   a second template: sidebarCollapsed is also true on mobile, where the drawer
   is full width and every label must stay visible. That is why every rule below
   is inside this media query, and why none of them may move out of it. */
@media (min-width: 768px) {
	/* #sidebar's 1rem padding is what left a 48px rail with 16px of content
	   width — the cause of every overflow in the old rail. */
	body.is-sidebar-collapsed #sidebar {
		padding: 0.375rem 0;
		align-items: center;
	}

	/* .sidebar__count is hidden HERE and only HERE. It is a flex sibling of the
	   icon inside the 44px button, and its min-content width squeezes or overflows
	   the tile for as long as it stays in flow. Task 5 removes it from this rule in
	   the same change that gives it `position: absolute` — the two must land
	   together, exactly as the ⋯ button's hide pairs with Task 7. */
	body.is-sidebar-collapsed .sidebar__name,
	body.is-sidebar-collapsed .sidebar__count,
	body.is-sidebar-collapsed .sidebar__add-text {
		display: none;
	}

	body.is-sidebar-collapsed .sidebar__areas {
		align-self: stretch;
	}
	body.is-sidebar-collapsed .sidebar__area-row {
		justify-content: center;
	}

	/* The painted tile and the hit target are DIFFERENT boxes. The button stays
	   44px so pointer targets do not shrink and gaps do not open between rows;
	   .sidebar__icon is the 36px surface that carries the tint. Do not "simplify"
	   this by shrinking the button to 36px. */
	body.is-sidebar-collapsed .sidebar__area {
		inline-size: 44px;
		min-block-size: 44px;
		flex: 0 0 auto;
		justify-content: center;
		padding: 0;
		border-radius: 10px;
	}
	body.is-sidebar-collapsed .sidebar__icon {
		inline-size: 36px;
		block-size: 36px;
		/* Load-bearing. .sidebar__count is still a visible flex sibling inside the
		   44px button until Task 5 turns it into an absolutely-positioned badge,
		   and flex children default to flex-shrink: 1 — without this the tile is
		   squeezed to ~28px and the declared 36px is a lie. */
		flex-shrink: 0;
		display: grid;
		place-items: center;
		border-radius: 10px;
		font-size: var(--text-md);
	}

	/* The tint moves off the button and onto the tile, so it can never paint
	   across a box wider than the rail. */
	body.is-sidebar-collapsed .sidebar__area.is-active {
		background: transparent;
	}
	body.is-sidebar-collapsed .sidebar__area.is-active .sidebar__icon {
		background: var(--accent-soft);
	}
	body.is-sidebar-collapsed .sidebar__area:not(.is-active):hover {
		background: transparent;
	}
	body.is-sidebar-collapsed .sidebar__area:not(.is-active):hover .sidebar__icon {
		background: var(--surface-4);
	}

	/* The toggle is the ONLY way out of the rail. It had no collapsed rule at
	   all, and its old position came from the 1rem padding removed above. */
	body.is-sidebar-collapsed .sidebar__toggle {
		align-self: center;
		inline-size: 44px;
		block-size: 44px;
		border: 0;
	}

	/* ＋ becomes a tile rather than disappearing. */
	body.is-sidebar-collapsed .sidebar__add-area-row {
		display: flex;
		justify-content: center;
	}
	body.is-sidebar-collapsed .sidebar__add-area {
		inline-size: 44px;
		min-block-size: 44px;
		padding: 0;
		text-align: center;
		border-radius: 10px;
	}
	body.is-sidebar-collapsed .sidebar__add-glyph {
		font-size: var(--text-lg);
		line-height: 1;
	}
}
```

- [ ] **Step 2: Stop hiding the controls the rail now renders**

Replace the collapsed display-none rule at lines 1119-1126 with:

```css
/* Collapsed state — desktop-only. The ＋ row is rendered by the rail now (see
   the collapsed block above), so it is no longer hidden.

   The ⋯ button stays hidden HERE and only HERE: it carries min-inline-size:44px,
   so while it is still in flow the row would centre two 44px children inside a
   48px rail and both would bleed off the edges. Task 7 removes this line in the
   same change that gives it `position: absolute` in the tile's corner — the two
   must land together.

   The rename input likewise stays hidden until it becomes a popover in Task 8,
   which removes it from this rule. */
@media (min-width: 768px) {
	body.is-sidebar-collapsed .sidebar__menu-btn,
	body.is-sidebar-collapsed .sidebar__rename-input {
		display: none;
	}
}
```

Leave `main.css:1579-1586`'s `.icon-picker` collapsed rule alone in this task — it is removed together with the rename input's hide, in Task 8. Between the two tasks the rename path stays exactly as broken as it is today, which is intentional: this task is about geometry and must be reviewable on its own.

- [ ] **Step 3: Verify in the browser**

Reload the preview at desktop width and collapse the sidebar.

Expected: every tile is centred inside 48px with nothing overflowing the right border; the active area shows a 36px tinted square, not a block running past the rail; the toggle is visible and centred; a ＋ tile sits at the end of the list.

Confirm with `read_page` that the toggle and every area button are still reachable, and take a screenshot for the record.

- [ ] **Step 4: Verify the mobile drawer is untouched**

Resize the preview to the `mobile` preset, open the drawer, and confirm full labels, counts and the "＋ New area" text still render. This is the check that no rail rule leaked out of the media query.

- [ ] **Step 5: Run the linter and tests**

Run: `npm run check && npm run test:run`
Expected: no diagnostics, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add main.css
git commit -m "feat(sidebar): give the collapsed rail real geometry

The rail kept #sidebar's 1rem padding, leaving 48px with 16px of content
width, so tiles, the wordmark and the active tint all overflowed it. Pad the
rail itself, centre its children, and make the icon the painted 36px tile
while the button stays a 44px target. The toggle and + become tiles instead
of an unstyled box and a hidden row."
```

---

### Task 5: Count badges

**Files:**
- Modify: `main.css` — extend the collapsed rail block from Task 4

**Interfaces:**
- Consumes: `.sidebar__count` and its `is-zero` class from Task 2; `.sidebar__area` / `.sidebar__icon` geometry from Task 4.
- Produces: the badge treatment Task 6 reuses for the hero tile.

- [ ] **Step 1: Add the badge rules**

Append inside the `@media (min-width: 768px)` collapsed block added in Task 4 (before its closing brace):

```css
	/* Counts become corner badges. The badge must stay INSIDE the rail's inline
	   bounds — a 44px button in a 48px rail leaves 2px each side, so it is inset
	   from the button's edge, never overhanging it. */
	body.is-sidebar-collapsed .sidebar__area {
		position: relative;
	}
	body.is-sidebar-collapsed .sidebar__count {
		/* Un-hides what Task 4 hid. That hide and this rule are one change split
		   across two tasks: in flow the count squeezes the 36px tile, so it may
		   only become visible at the moment it leaves flow. */
		display: block;
		position: absolute;
		inset-block-start: 1px;
		inset-inline-end: 1px;
		min-inline-size: 1rem;
		padding: 0 0.25rem;
		border-radius: 999px;
		background: var(--surface-4);
		color: var(--text);
		font-size: 0.6875rem;
		line-height: 1.45;
		text-align: center;
	}
	body.is-sidebar-collapsed .sidebar__area.is-active .sidebar__count {
		background: var(--accent);
		color: var(--surface-1);
		font-weight: 500;
	}
	/* An area with nothing open shows a bare icon. Scoped to the rail: the
	   expanded row keeps showing 0, which is its existing behaviour. */
	body.is-sidebar-collapsed .sidebar__count.is-zero {
		display: none;
	}
```

- [ ] **Step 2: Verify contrast in both themes**

In the preview, collapse the sidebar and confirm the badge is legible on an inactive tile and on the active tile.

Then cycle the theme control to **light** and check again. The active badge is `--surface-1` text on `--accent`; in light theme that is a near-white on `#c64e16`. If it does not read cleanly at 11px, switch the active badge to `color: var(--surface-2)` and re-check — do not silently accept a marginal pair.

Screenshot both themes.

- [ ] **Step 3: Verify the number matches the expanded row**

Expand the sidebar, note an area's count, collapse it, and confirm the badge shows the same number. They are the same span; this is a regression check that no rule replaced its content.

- [ ] **Step 4: Run the linter and tests**

Run: `npm run check && npm run test:run`
Expected: no diagnostics, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add main.css
git commit -m "feat(sidebar): show area counts as corner badges in the rail

Same number the expanded row shows, inset so it cannot overhang the rail's
border. Zero is not painted in the rail."
```

---

### Task 6: The Focus hero card

**Files:**
- Modify: `src/views/sidebar.js:474-526` (`template`)
- Modify: `main.css:931-953` (`.sidebar__home` block)
- Modify: `main.css` — extend the collapsed rail block

**Interfaces:**
- Consumes: `focusCounts(sections, tasks, now, focusAreaId)` from Task 1; `FOCUS_ID`, already imported in `sidebar.js:27`.
- Produces: `.sidebar__home-mark`, `.sidebar__home-body`, `.sidebar__home-name`, `.sidebar__home-meta`, `.sidebar__home-badge`.

- [ ] **Step 1: Import the helper**

In `src/views/sidebar.js`, add below the existing `../utils/dom.js` import:

```js
import { focusCounts } from "../utils/focus-counts.js";
```

- [ ] **Step 2: Build the card in the template**

In `template`, immediately after the `const wordmarkActive = …` line, insert:

```js
	// Same derivation as the page-header summary and the Focus tab counts.
	const { overdue, dueToday, attention } = focusCounts(
		state.sections,
		state.tasks,
		state.now,
		FOCUS_ID,
	);
	const focusArea = state.areas.find((a) => a.id === FOCUS_ID);
	const focusMark = focusArea?.icon || "🔥";
	// Numbers only — no user-authored text reaches this string.
	const focusMeta =
		overdue > 0
			? `Focus · <strong class="sidebar__home-overdue">${overdue} overdue</strong> · ${dueToday} due today`
			: `Focus · ${dueToday} due today`;
	const focusName =
		overdue > 0
			? `Ignite, Focus, ${overdue} overdue, ${dueToday} due today`
			: `Ignite, Focus, ${dueToday} due today`;
	const homeBadgeClass =
		attention === 0 ? "sidebar__home-badge is-zero" : "sidebar__home-badge";
```

Then replace the `<button class="sidebar__home …>Ignite</button>` element (lines 505-506) with:

```js
		<button class="sidebar__home ${wordmarkActive}" type="button"
			data-action="go-focus" ${wordmarkAria} aria-label="${focusName}">
			<span class="sidebar__home-mark" aria-hidden="true">${escapeHtml(focusMark)}</span>
			<span class="sidebar__home-body" aria-hidden="true">
				<span class="sidebar__home-name">Ignite</span>
				<span class="sidebar__home-meta">${focusMeta}</span>
			</span>
			<span class="${homeBadgeClass}" aria-hidden="true">${attention}</span>
		</button>
```

The card stays **one control**, so `aria-current="page"` and `focusHome()`'s `.sidebar__home` focus target keep working untouched.

- [ ] **Step 3: Style the expanded card**

In `main.css`, replace the `.sidebar__home` block at lines 931-953 with:

```css
/* Sidebar home = the Focus card. Brand and landing surface are one control:
   promoting the wordmark gives Focus a real front door without adding a second
   control that points at the same page. */
.sidebar__home {
	position: relative;
	display: flex;
	align-items: center;
	gap: var(--space-2);
	inline-size: 100%;
	padding: var(--space-3);
	background: var(--accent-soft);
	border: 1px solid rgb(var(--accent-rgb) / 45%);
	border-radius: var(--radius);
	color: var(--color-text);
	cursor: pointer;
	text-align: left;
}
.sidebar__home-mark {
	font-size: var(--text-lg);
	line-height: 1;
	flex-shrink: 0;
}
.sidebar__home-body {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}
.sidebar__home-name {
	font-family: var(--font-display);
	font-size: 1.1rem;
	font-weight: 700;
	line-height: 1.1;
}
.sidebar__home-meta {
	font-size: 0.8125rem;
	color: var(--text-muted);
}
.sidebar__home-overdue {
	color: var(--color-overdue);
	font-weight: 500;
}
/* The badge is a rail affordance only; the expanded card spells the numbers out. */
.sidebar__home-badge {
	display: none;
}
.sidebar__home:hover {
	border-color: var(--color-accent);
}
.sidebar__home:focus-visible {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}
.sidebar__home.is-active .sidebar__home-name {
	color: var(--color-accent);
}
```

- [ ] **Step 4: Style the rail tile**

Append inside the Task 4 collapsed block:

```css
	/* The card collapses to one promoted tile — bordered, so it reads as the
	   landing surface rather than another area. */
	body.is-sidebar-collapsed .sidebar__home {
		inline-size: 44px;
		min-block-size: 44px;
		padding: 0;
		justify-content: center;
		background: transparent;
		border: 0;
	}
	body.is-sidebar-collapsed .sidebar__home-body {
		display: none;
	}
	body.is-sidebar-collapsed .sidebar__home-mark {
		inline-size: 38px;
		block-size: 38px;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px rgb(var(--accent-rgb) / 45%);
	}
	body.is-sidebar-collapsed .sidebar__home-badge {
		display: block;
		position: absolute;
		inset-block-start: 1px;
		inset-inline-end: 1px;
		min-inline-size: 1rem;
		padding: 0 0.25rem;
		border-radius: 999px;
		background: var(--accent);
		color: var(--surface-1);
		font-size: 0.6875rem;
		line-height: 1.45;
		font-weight: 500;
		text-align: center;
	}
	body.is-sidebar-collapsed .sidebar__home-badge.is-zero {
		display: none;
	}
```

- [ ] **Step 5: Verify in the browser**

Expanded: the card shows the flame, "Ignite", and "Focus · N due today", with the overdue count in the danger colour when there is one. On the Focus route it carries `aria-current="page"`.

Collapsed: one bordered tile above the divider with a badge, and the badge number equals overdue + due today.

Check the accessible name reads as one phrase — "Ignite, Focus, 3 due today" — not a wordmark followed by loose numbers.

Compare the card's numbers against the page header's summary line. They must match exactly; that is the whole point of Task 1.

- [ ] **Step 6: Run the linter and tests**

Run: `npm run check && npm run test:run`
Expected: no diagnostics, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/views/sidebar.js main.css
git commit -m "feat(sidebar): promote the wordmark into the Focus hero card

Focus is the landing surface but had no visible front door — the wordmark
read as a logo. Promote it into a bordered, tinted card carrying the day's
counts, still one control so there is no second door onto the same page."
```

---

### Task 7: The corner ⋯, popover anchoring, and motion guards

**Files:**
- Modify: `main.css` — extend the collapsed rail block
- Modify: `main.css:1248-1255` (the reduced-motion block)

**Interfaces:**
- Consumes: `.sidebar__area-row { position: relative }` (already at `main.css:986`) and the Task 4 tile geometry.
- Produces: the `z-index: 110` rail-popover layer Task 8 reuses for the rename popover.

- [ ] **Step 1: Position and reveal the ⋯**

Append inside the Task 4 collapsed block:

```css
	/* Same ⋯ as the expanded sidebar, moved to the tile's corner. Painted small,
	   but the TARGET is 24x24 per WCAG 2.5.8. Revealed with opacity only — never
	   display or visibility, both of which would take it out of the tab order and
	   re-create the dead keyboard path this rail exists to fix. */
	body.is-sidebar-collapsed .sidebar__menu-btn {
		/* Un-hides what Task 4 hid. That hide and this rule are one change split
		   across two tasks: in flow the button's min-inline-size:44px overflows a
		   48px rail, so it may only become visible at the moment it leaves flow. */
		display: block;
		position: absolute;
		inset-block-end: 0;
		inset-inline-end: 0;
		inline-size: 24px;
		min-inline-size: 24px;
		block-size: 24px;
		min-block-size: 24px;
		padding: 0;
		font-size: 0.875rem;
		line-height: 24px;
		border-radius: 6px;
		background: var(--surface-4);
		color: var(--text);
		opacity: 0;
		transition: opacity var(--duration-fast) var(--ease-standard);
	}
	/* :focus-within, NOT :focus-visible — the row is an <li> and never receives
	   focus itself, and there is no :focus-visible-within. */
	body.is-sidebar-collapsed .sidebar__area-row:hover .sidebar__menu-btn,
	body.is-sidebar-collapsed .sidebar__area-row:focus-within .sidebar__menu-btn {
		opacity: 1;
	}

	/* Anchored beside the TILE, not below the row. The rail's popovers project
	   into the content column, where .capture-picker (70) and #toast-root (100)
	   live — so they need a layer above both. They escape the 48px column only
	   because #sidebar is overflow-y: visible at this breakpoint; that is an
	   invariant, not an oversight. */
	body.is-sidebar-collapsed .sidebar-menu {
		inset-block-start: 0;
		inset-inline-start: 100%;
		inset-inline-end: auto;
		z-index: 110;
	}
```

- [ ] **Step 1b: Correct Task 4's now-stale comments**

Task 4's hide rule carries a comment promising that Tasks 5 and 7 would *remove* `.sidebar__count` and `.sidebar__menu-btn` from it. Both tasks instead override the hide with `display: block` in the rule that positions the element, which works by source-order cascade — the selectors are identical, so there is no specificity win, only order. The behaviour is correct; the comment is not.

In `main.css`, in Task 4's collapsed hide rule, replace the sentence that says the later task "removes it from this rule" with wording that matches what actually happens:

```
   Tasks 5 and 7 each override this hide with `display: block` in the very rule
   that gives the element `position: absolute` — never separately. The override is
   a source-order cascade tie-break on an identical selector, not a specificity
   win, so those blocks must stay BELOW this one. Biome's noDescendingSpecificity
   and this file's ascending-order convention are what keep that true.
```

- [ ] **Step 2: Keep the ⋯ visible where there is no hover**

Add immediately **after** the closing brace of the `@media (min-width: 768px)` collapsed block, so it wins on source order:

```css
/* Desktop-only does not mean pointer-only. A touchscreen laptop at 1280px gets
   the rail with no hover state, and an opacity:0 element is still hit-testable —
   so without this the first tap on the tile's corner opens a menu the user
   cannot see. */
@media (hover: none) {
	body.is-sidebar-collapsed .sidebar__menu-btn {
		opacity: 1;
	}
}
```

- [ ] **Step 3: Honour reduced motion**

Replace the reduced-motion block at lines 1248-1255 with:

```css
/* Reduced motion: drawer + scrim appear without the slide/fade, the sidebar
   collapses without animating the grid column, and the rail's ⋯ appears without
   a fade. `body` is in this list because the collapse animation is
   `transition: grid-template-columns` on body, not on #sidebar.
   Placed before the state overrides so #sidebar / #scrim specificity stays ascending. */
@media (prefers-reduced-motion: reduce) {
	body,
	#sidebar,
	#scrim,
	.sidebar__menu-btn {
		transition: none;
	}
}
```

- [ ] **Step 4: Verify keyboard and pointer paths**

In the preview, collapsed:

1. Hover an area tile — the ⋯ fades in; the menu opens beside the tile, not below it or inside the rail.
2. Tab through the rail — the ⋯ becomes visible when focused and opens with Enter. Arrow keys move between menu items; Tab closes the menu.
3. Open a menu near the bottom of the list and confirm it is not painted under the capture bar or a toast.
4. Enable touch emulation at desktop width (`resize_window` to a coarse-pointer profile, or DevTools device emulation), reload, and confirm the ⋯ is permanently visible and tapping the tile still opens the area.
5. Enable `prefers-reduced-motion` and collapse — no column slide, no fade.

- [ ] **Step 5: Run the linter and tests**

Run: `npm run check && npm run test:run`
Expected: no diagnostics, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add main.css
git commit -m "feat(sidebar): give the rail a corner menu trigger and a real layer

The ⋯ was display:none when collapsed, which removed it from the tab order
entirely. Move it to the tile's corner, reveal it with opacity so it stays
keyboard-reachable, keep it permanently visible where hover does not exist,
and anchor rail popovers above the capture picker and toast layers.

Also brings the collapse animation under prefers-reduced-motion: it lives on
body, which the existing block did not cover."
```

---

### Task 8: Rename as a popover, and deleting the force-close

**Files:**
- Modify: `main.css` — extend the collapsed rail block
- Modify: `main.css:1579-1586` (the icon-picker collapsed rule)
- Modify: `src/views/sidebar.js:19` (comment), `:66` (declaration), `:398-412` (force-close), `:468` (destroy reset)

**Interfaces:**
- Consumes: the `z-index: 110` layer from Task 7.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Position the rename field and picker beside the tile**

Append inside the Task 4 collapsed block:

```css
	/* Rename at 48px: the editing row keeps its tile, and its two children are
	   positioned beside the rail as a stacked pair. The DOM is unchanged, so
	   every closure flag in sidebar.js — pendingRenameSelect, the caret restore,
	   the isRendering blur guard — keeps working untouched.
	   The picker's offset is derived from .sidebar__rename-input's pinned
	   min-block-size (44px). CHANGE ONE AND YOU MUST CHANGE THE OTHER. */
	body.is-sidebar-collapsed .sidebar__area-row--editing {
		justify-content: center;
		padding: 0;
	}
	body.is-sidebar-collapsed .sidebar__area-row--editing .sidebar__icon {
		inline-size: 36px;
		block-size: 36px;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: var(--accent-soft);
	}
	body.is-sidebar-collapsed .sidebar__rename-input {
		position: absolute;
		inset-block-start: 0;
		inset-inline-start: calc(100% + var(--space-1));
		inline-size: 13.75rem;
		flex: none;
		z-index: 110;
	}
	body.is-sidebar-collapsed .icon-picker {
		position: absolute;
		inset-block-start: calc(44px + var(--space-1));
		inset-inline-start: calc(100% + var(--space-1));
		inline-size: 13.75rem;
		margin-top: 0;
		flex: none;
		z-index: 110;
	}
```

- [ ] **Step 2: Delete both rules that hid the rename popover**

Remove the `body.is-sidebar-collapsed .sidebar__rename-input { display: none }` rule added in Task 4 Step 2, including its media wrapper and comment.

Remove the block at `main.css:1579-1586` — the `body.is-sidebar-collapsed .icon-picker { display: none }` rule — entirely, including its comment.

Both are superseded by Step 1: the field and the picker are now positioned beside the tile and must render.

- [ ] **Step 3: Delete the force-close and its flag**

In `src/views/sidebar.js`:

Remove the line from the closure-state comment block (line 19):

```js
//   prevSidebarCollapsed    - tracks settings.sidebarCollapsed across renders
```

Remove the declaration (line 66):

```js
	let prevSidebarCollapsed = null;
```

In `render(state)`, replace the whole force-close section — from the comment `// Sidebar collapse force-close:` through `prevSidebarCollapsed = nextCollapsed;` (lines 398-412) — with nothing, so the method body becomes:

```js
		render(state) {
			lastState = state;
			doRender();
		},
```

Remove the reset in `destroy()` (line 468):

```js
			prevSidebarCollapsed = null;
```

The force-close existed only because collapsing used to destroy the rename input, stranding `renamingAreaId` against a field that no longer rendered. With the popover there is nothing to force-close, and keeping it would commit a rename mid-typing whenever the sidebar is collapsed.

- [ ] **Step 4: Verify in the browser**

Collapsed, on an area tile:

1. Open the ⋯ menu and choose **Rename**. The field appears beside the tile with the text selected, and the icon picker sits directly beneath it. Nothing is clipped by the rail.
2. Type, press **Enter** — the name commits and focus returns to the tile.
3. Enter rename again, press **Esc** — the rename cancels and focus returns to the tile.
4. Enter rename, type a new name, then **collapse and re-expand** — the in-progress rename survives rather than being force-committed.
5. Pick an icon from the picker with the arrow keys — focus stays inside the picker.
6. Confirm the expanded sidebar's rename row is visually unchanged.

- [ ] **Step 5: Run the linter and tests**

Run: `npm run check && npm run test:run`
Expected: no diagnostics, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add main.css src/views/sidebar.js
git commit -m "feat(sidebar): make renaming work in the collapsed rail

The rename field was display:none while the row still entered rename mode, so
the user was put into a state with nothing to type into and focus fell to
<body>. Position the field and the icon picker beside the tile instead.

Drops the expanded-to-collapsed force-close with it: it existed only because
collapsing destroyed the input, and keeping it would now commit a rename the
user is still typing."
```

---

### Task 9: Verification sweep

No new code. This is the pass the spec's §8 and §10 require, and the point at which the work can be called done.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-17-ignite-sidebar-rail-design.md` (record what was verified)

- [ ] **Step 1: Walk the spec's manual checklist**

Run all twelve steps in §10 of the spec, in order, at desktop width in the preview. Record the result of each. Any failure stops the sweep and goes back to the task that owns it.

- [ ] **Step 2: Repeat the critical steps in light theme**

Cycle the theme control to light and repeat steps 1, 2 and 7. Badge contrast on the active tile is the specific thing being checked.

- [ ] **Step 3: Run axe over the sidebar in all four combinations**

Collapsed and expanded, dark and light. **Scope axe to `#sidebar`** — `page-has-heading-one` and `landmark-one-main` fire on the inert background whenever a dialog is open and are known artifacts of this project.

axe-core is not a dependency and must not become one for this task, and no remote script may be injected. Use the browser's own accessibility panel, or run axe from the preview's DevTools console if it is available there. If neither is possible, say so plainly in the commit message rather than claiming a pass that did not happen.

- [ ] **Step 4: Confirm the two owed axe passes are still owed**

This sweep covers the sidebar only. It does **not** discharge the axe passes owed on the schedule dialog and the Focus surface. Leave both on the backlog.

- [ ] **Step 5: Record the result in the spec**

Update the spec's status line to note the verification pass and its date, and add a short "Verified" subsection under §10 listing what was actually run — including anything that could not be run and why.

- [ ] **Step 6: Note what only Malin can do**

A real-device pass is **not** dischargeable here. Every "device" check available is desktop Chromium at a resized viewport, which cannot confirm touch targets, the on-screen keyboard, or iOS Safari. The rail is desktop-only so it is largely outside that risk, but the mobile-drawer check (§10 step 8) deserves a real phone. Flag it to Malin rather than substituting a viewport resize.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-17-ignite-sidebar-rail-design.md
git commit -m "docs(spec): record the sidebar rail verification pass"
```

- [ ] **Step 8: Open the pull request**

`main` is protected and requires the `verify` check, so the work lands via PR.

```bash
git push -u origin feat/sidebar-rail
gh pr create --title "The collapsed sidebar rail, and Focus's front door" --body "Implements docs/superpowers/specs/2026-08-17-ignite-sidebar-rail-design.md"
```

Wait for CI (`npm ci` → `check` → `test:run` → `build`, roughly 10-15s) to go green before asking for a merge.
