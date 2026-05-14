# M4 — Task reorder via ⋯ menu

**Date:** 2026-05-14
**Milestone:** M4 (Area view polish)
**Scope:** ~50 lines of code + 2 new tests + small CSS + a11y fix on task `⋯` trigger
**Predecessors:** M3 (Area View + Section CRUD) shipped 2026-05-14. 91 tests green.

## Why

Sections can already be reordered via `⋯` → Move up / Move down (M3). Tasks inside a section have an `order` field but no UI to change it. The first thing a user does after adding tasks is reorder them. Without Move up / Move down, the only way to change order is delete-and-recreate, which is destructive and loses metadata.

M4 closes that gap by mirroring the section reorder pattern at the task level. Same UX shape, parallel implementation, same tests.

## Scope

**In scope**

- New model method `tasks.swapOrder(idA, idB)` parallel to `sections.swapOrder`.
- Two new menu items in the task `⋯` menu (area view only): Move up, Move down. Mirrors section menu items including `disabled` at edges.
- Two new view callbacks: `onMoveTaskUp({ taskId })`, `onMoveTaskDown({ taskId })`.
- Controller helper `moveTask(taskId, direction)` parallel to `moveSection`, **with peers filtered to incomplete tasks** (see Architecture → Controller).
- Focus return after move via post-render lookup using a new `pendingFocusTaskId` closure flag.
- Small a11y fixes on the existing task `⋯` trigger that we're touching anyway: `aria-expanded` and `aria-label`. Affects both `area.js` and `today.js` callers of `renderTaskRow` — today.js must thread its `openMenuTaskId` so `aria-expanded` doesn't lie when the today-view menu is open.
- CSS: `min-block-size: 44px` on `.task-menu__item` to bring the task menu up to the same touch-target baseline as the section menu.

**Out of scope**

- Today view reorder (today is date-grouped; reorder semantics don't apply).
- Cross-section moves (Move up at top of section A → bottom of preceding section). Separate M3 follow-up "move-task-between-sections" with its own UX questions.
- Drag-to-reorder. Explicit M5+ stretch.
- Keyboard arrow-key reorder shortcuts.
- Auto-focus on first menu item when task menu opens via keyboard. Pre-existing M3-follow-up gap (the section menu has it, the task menu doesn't). Defer to a future a11y pass that fixes both at once.

## UX

**Where:** area view only. Inside a task row, click the `⋯` button → menu opens with three items:

```
┌───────────────────┐
│ Move up           │  (disabled if first incomplete task in this section)
│ Move down         │  (disabled if last incomplete task in this section)
│ Delete            │
└───────────────────┘
```

**Behaviour:**

- Click Move up → task swaps order with the **incomplete** task immediately above it in the same section. Visible result: task moves up one row. Focus returns to the `⋯` button on the moved task.
- Click Move down → mirror.
- At edges, the corresponding button is `disabled` (native HTML `disabled` attribute — tab order skips it).
- Esc closes the menu (already wired via `docKeyHandler`).
- Clicking outside the menu closes it (already wired via `docClickHandler`).

**Edge cases:**

- Single incomplete task in section → both buttons disabled.
- All other tasks in section completed (visible list of 1) → both buttons disabled.
- Section collapsed → menu can't be opened (body hidden via CSS); irrelevant.
- Task is the first/last in its section but completed siblings exist with higher/lower orders → still disabled, because "first/last" is computed against the **visible** (incomplete) list, matching what the user sees.

## Architecture

### Model — `src/model/tasks.js`

Add `swapOrder` as a direct mirror of `sections.swapOrder`:

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

Note: no same-section validation at the model boundary. Caller (`moveTask`) is responsible for picking intra-section neighbours, exactly as `moveSection` does for areas. Symmetry over paranoia.

Also update the JSDoc header to include `swapOrder(idA, idB) → Promise<void>` in the public API list.

### Controller — `src/controller.js`

Add `moveTask(taskId, direction)` parallel to `moveSection` (lines 153–165), **with one critical difference**: peers must be filtered to incomplete tasks.

```js
async function moveTask(taskId, direction) {
    const target = await tasks.list().then((all) =>
        all.find((t) => t.id === taskId),
    );
    if (!target) return;
    const peers = (await tasks.listBySection(target.sectionId))
        .filter((t) => !t.completed); // already sorted by order in listBySection
    const idx = peers.findIndex((t) => t.id === taskId);
    const neighbourIdx = direction === "up" ? idx - 1 : idx + 1;
    if (neighbourIdx < 0 || neighbourIdx >= peers.length) return;
    const neighbour = peers[neighbourIdx];
    await tasks.swapOrder(target.id, neighbour.id);
}
```

**Why filter to incomplete:** the area view filters `!completed` and sorts by `order`. If completed tasks have orders intermixed with incomplete ones, swapping with a completed neighbour means the **visible** order doesn't change — the user clicks Move up and sees nothing happen, then clicks again and the swap finally works against an incomplete neighbour. Filtering peers to `!completed` ensures every click swaps with the visually-adjacent task.

Wire two new callbacks into `areaCallbacks()`:

```js
onMoveTaskUp: async ({ taskId }) => { await moveTask(taskId, "up"); },
onMoveTaskDown: async ({ taskId }) => { await moveTask(taskId, "down"); },
```

### View — `src/views/section.js`

Expand `renderTaskRowWithMenu` to include Move up / Move down items, threaded with `isFirst` / `isLast` flags from the caller. Signature change:

```js
function renderTaskRowWithMenu(task, { now, isFirst, isLast, openTaskMenuId, isOpen })
```

Compute `isFirst`/`isLast` in `renderBody` from position in the already-sorted (incomplete) `tasks` array — same shape as section.js computes it for sections:

```js
function renderBody(tasks, now, openTaskMenuId) {
    const rows = tasks
        .map((t, i) => renderTaskRowWithMenu(t, {
            now,
            isFirst: i === 0,
            isLast: i === tasks.length - 1,
            openTaskMenuId,
            isOpen: openTaskMenuId === t.id,
        }))
        .join("");
    return `<div class="section__body"><ul class="section__tasks">${rows}</ul></div>`;
}
```

Updated task menu HTML (inside the `row.replace` block):

```html
<div class="task-menu" role="menu">
    <button class="task-menu__item" type="button" data-action="move-task-up"
        role="menuitem" ${upDisabled}>Move up</button>
    <button class="task-menu__item" type="button" data-action="move-task-down"
        role="menuitem" ${downDisabled}>Move down</button>
    <button class="task-menu__item" type="button" data-action="delete-task"
        role="menuitem">Delete</button>
</div>
```

### View — `src/views/task.js`

Update `renderTaskRow` signature to accept `isOpen` and emit `aria-expanded` + `aria-label`:

```js
export function renderTaskRow(task, { now, isOpen = false } = {})
```

The `⋯` button becomes:

```html
<button class="task__menu-btn" type="button" data-action="open-menu"
    aria-haspopup="menu"
    aria-expanded="${isOpen}"
    aria-label="Task options: ${escapeHtml(task.title)}">⋯</button>
```

`today.js` **must** thread its `openMenuTaskId` state through to `renderTaskRow` so the `aria-expanded` value is correct when the today-view menu is open. today.js has its own `renderTaskRowWithMenu` helper (a near-duplicate of section.js's) — update it to pass `isOpen: openMenuTaskId === task.id` when delegating to `renderTaskRow`. Without this update, `aria-expanded="false"` would lie whenever a today-view task menu is open. No behaviour change beyond the SR announcement.

### View — `src/views/area.js`

Add two actions to `bindActions`:

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

Add a new closure flag `pendingFocusTaskId` mirroring `pendingFocusSectionId`. In `doRender`, after the existing section focus-return lookup, add:

```js
if (pendingFocusTaskId) {
    const trigger = rootEl.querySelector(
        `[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
    );
    trigger?.focus();
    pendingFocusTaskId = null;
}
```

Clear it on `destroy` alongside the other flags. Add `pendingFocusTaskId` to the closure-state JSDoc at the top of the file.

Add two new callback names to the view's documented callbacks list (top of file):

```
onMoveTaskUp({ taskId })
onMoveTaskDown({ taskId })
```

### CSS — `main.css`

One change: add `min-block-size: 44px;` to `.task-menu__item` (currently lines 249-263 in main.css). Brings touch target up to WCAG 2.5.5. CSS-only, no behaviour change.

No new tokens. No other CSS edits.

## Security

- All new HTML in the task menu is **static text** ("Move up", "Move down"). No interpolation, no XSS surface.
- New `aria-label` on `.task__menu-btn` interpolates `task.title` — already escaped via `escapeHtml`.
- `data-id` attribute on the task row was already escaped before M4; no change.
- New IDB writes (`tasks.swapOrder`) take task records that were just read from IDB — no untrusted input crossing the boundary.

## Accessibility

- New menu items are real `<button>` elements with `role="menuitem"` and `type="button"` — keyboard-reachable via Tab, activated via Enter/Space, focusable.
- `disabled` attribute on edge buttons removes them from tab order natively.
- Task `⋯` trigger gains `aria-expanded` (so SR announces open/closed) and `aria-label="Task options: <title>"` (so SR announces which task this menu controls). Matches the section trigger pattern.
- Task menu items pick up the existing `.task-menu` ancestor's `role="menu"`; focus management within the open menu is "user Tabs through items" (M3-consistent — same as section menu's effective behaviour for mouse-opened menus).
- After Move up / Move down completes, focus returns to the `⋯` button on the moved task via `pendingFocusTaskId` + post-render lookup — same pattern as section reorder.
- Touch target: `.task-menu__item` raised to 44 px.
- `prefers-reduced-motion`: no animation tied to task move, nothing to gate.
- No screen-reader live announcement of the move event itself. The button label confirms which task is focused; the visual order change is implicit. Matches section reorder's M3-shipped behaviour. Could add `aria-live` later as a unified a11y pass.

## Privacy

All changes stay in IndexedDB. No new network calls. No telemetry. No third-party requests.

## Known limitations (inherited from M3)

- **`pendingFocusTaskId` ↔ 60s tick race.** If the 60s clock tick triggers a re-render between the Move click and the swap-driven re-render, the flag is consumed by the tick render against the old DOM (refocuses the ⋯ in its old position), then the swap re-render runs and focus drops to body because the flag is now null. M3's `pendingFocusSectionId` has the same race. Window is small (≤1 minute). Don't harden in M4; document, defer.
- **No keyboard-open auto-focus on task menu.** Section menu uses `event.detail === 0` heuristic; task menu doesn't. Pre-existing M3-follow-up gap. Defer to a future a11y pass that does both at once.
- **No SR live announcement on move.** Focus return is the only audible feedback. M3-consistent.

## Tests

**New (in `tests/unit/tasks.test.js`):** 2 tests under `describe("createTaskModel — swapOrder")`, mirroring the section tests at `tests/unit/sections.test.js:112-127`:

1. `it("swaps order values between two tasks in one notify")` — create two tasks in the same section, swap, assert order flipped and exactly one `notified` event.
2. `it("throws when either task id is missing")` — assert rejection on unknown ids.

**Test count:** 91 → 93.

Controller and view changes are verified manually (no DOM tests for views in this project — convention from M2 memory).

## Done criteria

1. `npm test` reports 93/93 green.
2. `npx biome check .` is clean.
3. In a real browser, on `#area/focus-default` with 3+ tasks:
   - `⋯` → Move up moves the task up one row; focus returns to `⋯` on the moved task.
   - `⋯` → Move down mirrors.
   - At top of section, Move up is `disabled`. At bottom, Move down is `disabled`.
   - With one or more completed tasks in the section, Move up / Move down swap with the **incomplete** neighbour — every click produces a visible change.
   - `⋯` button reads as "Task options: <title>, collapsed/expanded" via screen reader (verify with Windows Narrator or NVDA).
   - Menu items are at least 44 px tall (measure in DevTools).
4. On `#today`: opening a task `⋯` menu now reports `aria-expanded="true"` (verify in DevTools accessibility panel); closing reports `false`.
5. Section reorder still works (regression check).

## Out-of-scope follow-ups noted

- Cross-section task moves.
- Today view task reorder (semantically N/A, but worth a brief comment if asked).
- Keyboard-open auto-focus on task menu (a11y polish — unify with section pattern in one pass).
- Drag-to-reorder for both sections and tasks (M5+).
- `aria-live` announcement of reorder events.
- M3-inherited `pendingFocus*` ↔ tick race (unify-and-harden pass).
