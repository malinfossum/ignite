# Move task between sections — design spec

**Date:** 2026-05-31
**Phase:** v0.1 Phase 3 (M6, post-inline-task-rename)
**Goal:** Let the user move a task to **any section in any area**, from both the **area view** and the **Today view**, via a picker that opens as a sub-face of the existing task ⋯ menu.

This is a **net-new capability** (not a 4th application of a settled pattern). It adds one model method, one controller handler, one shared view unit (`renderMovePicker`), and a small amount of per-view wiring. It deliberately **reuses** the hardened menu machinery (open/close, arrow-key nav, `isRendering` blur-guard, post-render focus) rather than inventing a new primitive.

**Settled scope decisions (from brainstorm 2026-05-31):**
- **Cross-area** — a task can move to a section in a different area, not just within its own area. (The killer use case: triage captured tasks *out* of `focus-default` into the right project section.)
- **Both surfaces** — area view **and** Today view get "Move to…".
- **Approach B** — inline picker that replaces the ⋯ menu's contents (chosen over a cascading submenu and a modal dialog).
- **Toast + Undo** — a confirmation toast with Undo (restores original section + position).

---

## Approach

**Approach B (selected): inline picker as a menu sub-face.**
Clicking **"Move to…"** in the task ⋯ menu swaps the menu's contents (the action buttons) for a scrollable list of target sections **grouped by area**, with a "← Back" row. One level deep, no nested submenus, no new overlay primitive. The picker is itself a `role="menu"`, so it inherits the existing arrow-key / Home / End / Tab / Esc / focus machinery unchanged.

**Rejected — Approach A (cascading submenu):** two-level nesting (area → section) is the worst option on touch (mobile-first baseline) and for keyboard/SR a11y, and the fiddliest to build on the innerHTML-menu machinery.

**Rejected — Approach C (modal dialog):** the app has no modal/overlay primitive; building one (focus trap, Esc, backdrop, scroll-lock) is the biggest build and a whole new a11y surface. Overkill for this milestone.

---

## Architecture

| Layer | Change |
|---|---|
| **Model** (`src/model/tasks.js`) | Add `async moveToSection(id, targetSectionId)` — validates task + target section exist (throws `Task not found: {id}` / `Section not found: {id}`), **no-ops without notify** if already in the target, else re-points `sectionId` and **appends to the target end** (`order = max(targetOrders)+1`, robust against gaps left by delete/move), `db.put` + one `notify()`. Add it to the JSDoc contract block (lines 4–20). |
| **View — `renderMovePicker`** (`src/views/move-picker.js`, **new file**) | Pure template. `renderMovePicker({ task, areas, sections }) → string`. Renders the grouped target list (see Template). Shared by area + today. |
| **View — `section.js`** | `renderSection` / `renderTaskRowWithMenu` thread `openTaskMenuId` (already have it), plus **`taskMenuMode`**, **`movePickerHtml`** (pre-rendered string for the open-picker task, or `null`), and **`hasMoveTargets`** (boolean). Add a **"Move to…"** item to the task action menu (omitted when `!hasMoveTargets`). When the open task is in picker mode, inject `movePickerHtml` instead of the action items. |
| **View — `today.js`** | Same threading through its **local** `renderTaskRowWithMenu`. Today's menu becomes `[Rename, Move to…, Delete]`. New closure state + 3 handlers (below). Computes `movePickerHtml` + `hasMoveTargets` in `template`. |
| **View — `area.js`** | New closure state (`taskMenuMode`) + 3 handlers + `open-menu` reset + focus flags. `template` computes `movePickerHtml` for the open-picker task and `hasMoveTargets`, threads both into `renderSection`. |
| **Controller** (`src/controller.js`) | New callback `onMoveTaskToSection({ taskId, targetSectionId })`, wired into **both** view mounts. Snapshots `{sectionId, order}` for undo, calls `tasks.moveToSection`, swallows `/not found/i` (cascade race), then shows a **toast + Undo**. New constant `MOVE_TOAST_MS = 5_000` — matches the existing single-task delete-undo window (`durationMs: 5000` at controller.js:75,82); a move is non-destructive, so it warrants no more urgency than a delete (cascade's 8s is for destructive multi-item ops). |
| **CSS** (`src/styles/main.css`) | `.task-menu--picker` (scrollable: `max-height` + `overflow-y:auto`), `.task-menu__group`, `.task-menu__group-label` (**existing text token meeting AA contrast ≥4.5:1** against the menu background — no new sub-threshold muted value), `.task-menu__item--back`, plus reuse of the existing `.task-menu__item:disabled` style for the empty-picker hint. Touch targets keep the existing `.task-menu__item` ≥44px convention. |

---

## Template — `renderMovePicker`

`renderMovePicker({ task, areas, sections })`:

1. `currentSectionId = task.sectionId`.
2. `areasSorted = [...areas].sort((a, b) => a.order - b.order)`.
3. For each area, `targets = sections.filter(s => s.areaId === area.id && s.id !== currentSectionId).sort((a,b)=>a.order-b.order)`. **Skip the area entirely if `targets` is empty.**
4. Render a `role="group"` per area (aria-label = area name) containing the target rows. "← Back" is the **last** item.

```html
<div class="task-menu task-menu--picker" role="menu" aria-label="Move to section">
  <!-- per area with ≥1 target -->
  <div class="task-menu__group" role="group" aria-label="<escaped area.name>">
    <p class="task-menu__group-label" aria-hidden="true"><escaped area.name></p>
    <button class="task-menu__item" type="button" role="menuitem" tabindex="-1"
      data-action="pick-move-target"
      data-target-section-id="<escaped section.id>"><escaped section.name></button>
    <!-- …more sections… -->
  </div>
  <!-- …more areas… -->
  <button class="task-menu__item task-menu__item--back" type="button" role="menuitem" tabindex="-1"
    data-action="move-picker-back">← Back</button>
</div>
```

**Required behaviors:**
- **Back is LAST.** This lets the existing "focus first `[role=menuitem]`" machinery land on the first *target* (not Back) when the picker opens.
- Group label `<p>` is `aria-hidden="true"` — the `role="group"` `aria-label` already names the area for SRs; the visible `<p>` is decorative.
- Group labels are **not** `role="menuitem"` → the arrow-key nav (which collects `[role="menuitem"]`) skips them automatically.
- `escapeHtml` applied to: area name (×2: aria-label + visible label), section name, **and `data-target-section-id`**. Names are user-controlled and can contain `<`/`>`/`"`. IDs are `uuid()` today, but escaping is defense-in-depth (matches the rename spec).
- The current section is **omitted** (you can't move where you already are).
- **No Focus-area special-casing** — `focus-default` and the Focus area appear as normal sources/targets.
- **Empty-picker race:** "Move to…" is gated by `hasMoveTargets`, but the other sections can be deleted between opening the picker and its re-render. If the computed picker has **zero target groups**, render a single **disabled** `role="menuitem"` reading "No other sections" before Back (the arrow-nav `nextEnabledIndex` + the `:not([disabled])` focus guard already skip `[disabled]`), so the picker is never a bare Back-only dead-end.

---

## State machine — new closure state

```
taskMenuMode - 'actions' | 'picker'. Sub-mode of the OPEN task menu
               (openTaskMenuId in area.js / openMenuTaskId in today.js).
               'actions' = normal [Rename, …, Delete]; 'picker' = the
               move-target list. The template renders the picker ONLY
               when the task is open AND mode === 'picker'.

               RESET to 'actions' on every fresh menu open (open-menu
               handler). A closed menu never reads it (openTaskMenuId is
               null → nothing renders), and the next open resets it, so
               close paths need not reset it — though closeMenu/closeTaskMenu
               MAY reset for hygiene. `destroy()` MUST reset it to 'actions'
               (and null `pendingFocusMoveSourceSectionId`) alongside the
               other closure state.
```

**Reused flags + one new (`pendingFocusMoveSourceSectionId`):**
- `pendingMenuFocusTaskId` (exists) — set **unconditionally** in `move-task-to` so focus moves into the picker's first target (the "Move to…" item the user was on is gone; without this, focus drops to `<body>`). Also reused in `move-picker-back` to focus the first action item.
- `pendingFocusTaskId` (exists) — set in `pick-move-target` so focus follows the moved task's ⋯ when it's still visible (within-area moves; and Today, where the task stays because its starred/due status is unchanged).
- `pendingFocusMoveSourceSectionId` (**new — area.js only**) — set in `pick-move-target` to the task's *source* sectionId. In `doRender`, if the `pendingFocusTaskId` ⋯ lookup MISSES (cross-area move from the area view → the task left the page), focus the **source section's** ⋯ instead (still on the page). Without this, a cross-area move drops focus to `<body>`. Today.js needs no fallback (the task stays in view); the toast still carries the SR announcement and a focusable Undo on both surfaces.

**`doRender` focus block (area.js — extends the existing `pendingFocusTaskId` block):**

```js
if (pendingFocusTaskId) {
  const trigger = rootEl.querySelector(
    `[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
  );
  if (trigger) {
    trigger.focus();
  } else if (pendingFocusMoveSourceSectionId) {
    rootEl
      .querySelector(
        `[data-section-id="${CSS.escape(pendingFocusMoveSourceSectionId)}"] .section__menu-btn`,
      )
      ?.focus();
  }
  pendingFocusTaskId = null;
  pendingFocusMoveSourceSectionId = null;
}
```
(For the non-move uses of `pendingFocusTaskId` — rename, move-up/down — `pendingFocusMoveSourceSectionId` stays null, so the fallback is inert.)

---

## Actions (both views unless noted)

### `move-task-to` (new — opens the picker)

```js
"move-task-to": (_event, actionEl) => {
  const t = taskFromEvent(actionEl);
  if (!t) return;
  // The menu is already open on this task; just flip its face.
  taskMenuMode = "picker";
  pendingMenuFocusTaskId = t.id; // focus first target after render
  doRender();
},
```

### `pick-move-target` (new — commits the move)

```js
"pick-move-target": (_event, actionEl) => {
  const t = taskFromEvent(actionEl);
  const targetSectionId = actionEl?.dataset?.targetSectionId;
  if (!t || !targetSectionId) return;
  openTaskMenuId = null;       // openMenuTaskId in today.js
  taskMenuMode = "actions";    // reset for next open
  pendingFocusTaskId = t.id;   // focus follows the task (if still visible)
  pendingFocusMoveSourceSectionId = t.sectionId; // area.js only — cross-area focus fallback
  callbacks.onMoveTaskToSection({ taskId: t.id, targetSectionId });
  // No doRender() here — the model-notify re-render picks up the focus flags,
  // same as move-task-up/down. SELF-HEAL on the swallowed-error path: every
  // moveToSection throw cause IS a deletion (task or target section), and that
  // deletion fires its own notify → re-render → the menu closes (openTaskMenuId
  // is already null in closure state). So the picker never stays visually stale.
},
```

### `move-picker-back` (new — returns to actions)

```js
"move-picker-back": (_event, actionEl) => {
  const t = taskFromEvent(actionEl);
  if (!t) return;
  taskMenuMode = "actions";
  pendingMenuFocusTaskId = t.id; // focus first action item (Rename)
  doRender();
},
```

### `open-menu` (extend — reset mode on open)

```js
"open-menu": (event, actionEl) => {
  event.stopPropagation();
  const t = taskFromEvent(actionEl);
  if (!t) return;
  if (openTaskMenuId === t.id) { closeTaskMenu(); return; }  // toggle
  openMenuId = null;            // area.js mutual exclusion (section menu)
  openTaskMenuId = t.id;
  taskMenuMode = "actions";     // NEW — always open in the actions face
  if (event.detail === 0) pendingMenuFocusTaskId = t.id;
  doRender();
},
```

### `commit-task-rename` — unchanged, still **NO click action**

(Existing invariant. The picker actions are all click actions; the rename input remains Enter/blur-only.)

---

## Escape behavior — **one level** (deliberately simple)

Esc on an open task menu **closes it**, whether in actions or picker mode. The "← Back" item is the explicit picker→actions path. This keeps the Escape precedence unchanged from today (no new branch) and matches the "Esc dismisses the popup" mental model. `closeMenu`/`closeTaskMenu` reset `taskMenuMode = "actions"` for hygiene.

- **area.js precedence (unchanged):** `renamingId` ≻ `renamingTaskId` ≻ `openMenuId` ≻ `openTaskMenuId`.
- **today.js precedence (unchanged):** `renamingTaskId` ≻ `openMenuTaskId`.

(Two-level Esc — picker→actions→close — is an explicit out-of-scope refinement; see below.)

---

## Arrow-key nav — **unchanged machinery**

`findOpenMenuInArea` / `findOpenMenuInToday` locate the open menu by `[data-id="…"] [role="menu"]` — the picker IS a `[role="menu"]`, so it's found. `docKeyHandler` collects `[role="menuitem"]` and cycles with ArrowUp/Down/Home/End; group labels aren't menuitems, so they're skipped. **No changes to `docKeyHandler` are required.** Tab still closes the menu via `closeMenu(true)` / `closeTaskMenu(true)`.

---

## Threading `movePickerHtml` + `hasMoveTargets` (parent computes, child injects)

The tree-walking lives in the parent view (which owns `state.areas` / `state.sections`); `section.js` / `today.js` task-row renderers just inject a provided string. This keeps the section renderer free of cross-area data beyond two opaque params.

**`area.js` `template` (and `today.js` `template`), before rendering rows:**

```js
const hasMoveTargets = state.sections.length > 1; // ≥1 section other than any task's own

let movePickerHtml = null;
if (openTaskMenuId && taskMenuMode === "picker") {
  const openTask = state.tasks.find((t) => t.id === openTaskMenuId);
  if (openTask) {
    movePickerHtml = renderMovePicker({
      task: openTask,
      areas: state.areas,
      sections: state.sections,
    });
  }
}
// pass openTaskMenuId, taskMenuMode, movePickerHtml, hasMoveTargets down
```

**`renderTaskRowWithMenu` (both `section.js` and `today.js`), action-menu branch:**

```js
// …existing isOpen / isRenaming handling…
const moveToItem = hasMoveTargets
  ? `<button class="task-menu__item" type="button" data-action="move-task-to"
        role="menuitem" tabindex="-1" aria-haspopup="true">Move to…</button>`
  : "";

if (taskMenuMode === "picker" && movePickerHtml) {
  // inject the picker instead of the action items
  return row.replace("</li>", `${movePickerHtml}</li>`);
}
// else inject the normal action menu, with moveToItem placed:
//   today.js order:  [Rename, Move to…, Delete]
//   area/section.js: [Rename, Move up?, Move down?, Move to…, Delete]
```

**Menu order rationale:** `Move to…` sits **after** Move up/down and **before** Delete in the area menu (Delete stays last — destructive, hardest to mis-click). In Today (no Move up/down) it sits between Rename and Delete.

---

## Controller wiring — `onMoveTaskToSection` (both mounts)

```js
onMoveTaskToSection: async ({ taskId, targetSectionId }) => {
  // Snapshot BEFORE the move (for undo).
  const snapshot = (await tasks.list()).find((t) => t.id === taskId);
  if (!snapshot) return;                              // task already gone (race)
  const fromSectionId = snapshot.sectionId;
  const fromOrder = snapshot.order;
  if (fromSectionId === targetSectionId) return;      // no-op (also omitted in picker)

  try {
    await tasks.moveToSection(taskId, targetSectionId);
  } catch (err) {
    if (/not found/i.test(err.message)) return;        // cascade race (task OR target section gone)
    throw err;
  }

  // Resolve a friendly "Area › Section" label.
  const targetSection = (await sections.list()).find((s) => s.id === targetSectionId);
  const targetArea = targetSection
    ? (await areas.list()).find((a) => a.id === targetSection.areaId)
    : null;
  const label = !targetSection
    ? "section"
    : targetArea
      ? `${targetArea.name} › ${targetSection.name}`
      : targetSection.name;

  toast.show({
    message: `Moved to ${label}`,
    durationMs: MOVE_TOAST_MS,
    onUndo: async () => {
      try {
        await tasks.update(taskId, { sectionId: fromSectionId, order: fromOrder });
      } catch (err) {
        if (/not found/i.test(err.message)) return;    // task deleted since the move
        throw err;
      }
    },
  });
},
```

**Undo correctness:** the move touched only this task (append leaves others untouched; the source keeps a gap exactly where the task was). Restoring `{sectionId, order}` re-fills that gap precisely — no other task claimed it. (Theoretical exception: the user *creates* a task in the source section during the toast window; `create` uses `siblings.length`, which can collide with a gap. Pre-existing `create` behavior, extremely unlikely in ~6s, out of scope to fix here.)

**Toast keying:** the move toast uses no special `key` — it's one-at-a-time and will replace any pending toast (e.g. a delete-undo), which fires that toast's `onDismiss` (committing the delete). This is the existing supersede-on-show semantics; acceptable and consistent.

---

## Edge cases

| Scenario | Behavior |
|---|---|
| Only one section exists in the whole app (just `focus-default`) | `hasMoveTargets` false → **"Move to…" omitted** from the menu. |
| Target section / its area cascade-deleted between open and pick | `moveToSection` throws `Section not found` → controller swallows; no move, no toast. |
| Task cascade-deleted mid-flow | `snapshot` is undefined → early return; or `moveToSection` throws `Task not found` → swallow. |
| Move **within** the same area | Task relocates to the target section (visible); focus follows via `pendingFocusTaskId`. |
| Move to a **different** area | Task vanishes from the current area page; toast confirms + announces. Focus: area view falls back to the **source section's ⋯** (`pendingFocusMoveSourceSectionId`); Today keeps the task in view so its ⋯ stays focused. |
| Move **from Today** | The task's starred/due status is unchanged, so it **stays in Today** under the same group — the toast is the ONLY visible feedback. (This is why the toast is mandatory.) |
| Undo | Restores `{sectionId, order}`; task returns to original section + position. |
| Undo after the task was deleted post-move | `tasks.update` throws `Task not found` → swallow. |
| Move target == current section | Omitted from picker; controller also early-returns on `fromSectionId === targetSectionId`. |
| Completed task | Not shown in area view (filtered) nor surfaced in Today → not reachable via UI; `moveToSection` still correct if ever called. |
| Picker with many areas/sections | `.task-menu--picker` scrolls (`max-height` + `overflow-y:auto`). |
| All other sections deleted *after* the picker opened (race) | Picker renders a disabled "No other sections" menuitem + Back — no bare dead-end. |
| Keyboard | Arrow/Home/End cycle picker items; Esc closes the menu; Tab closes; "← Back" returns to actions. |
| Section / area named with markup (`<b>`, `"`) | `escapeHtml` on names + `data-target-section-id`. |
| NEXT card task (Today) | Menu/picker inject inside the `<article>`'s `<li>` exactly as the action menu does today. |

---

## Invariants (do NOT simplify away)

1. **`moveToSection` APPENDS (`order = max+1`) — never reorders peers.** This is what keeps it clear of the **M4 `!completed` invariant**; the existing `moveTask` up/down `!completed` peer filter is untouched.
2. **`moveToSection` no-ops WITHOUT `notify()`** when already in the target section (avoid a spurious re-render).
3. **`taskMenuMode` resets to `'actions'` on every `open-menu`.** Required. A closed menu doesn't read it; the next open resets it.
4. **"Move to…" is OMITTED when `sections.length <= 1`** (no valid target) — omit, don't show a dead-end. Mirrors the boundary-move omission convention.
5. **The picker is `role="menu"`; targets are `role="menuitem"`; group labels are NOT menuitems.** Reuses `findOpenMenu*` + arrow-nav + the `isRendering` blur-guard unchanged. Back is the LAST item.
6. **Controller swallows `/not found/i`** from BOTH `moveToSection` and the undo `tasks.update` (cascade races, both directions). Mirrors `onCommitRename`.
7. **Undo restores `{sectionId, order}` via `tasks.update`** — exact restore (move touched only this task).
8. **`pick-move-target` does NOT call `doRender()`** — the model-notify re-render consumes the focus flags (same as `move-task-up/down`). It sets `pendingFocusTaskId = taskId` (focus follows the task) and, in area.js, `pendingFocusMoveSourceSectionId = t.sectionId` (cross-area fallback → source section's ⋯). On the swallowed-error path the triggering deletion's own notify re-renders and closes the menu (**self-heal** — every `moveToSection` throw cause is a deletion that notifies).
9. **`move-task-to` sets `pendingMenuFocusTaskId` unconditionally** — focus MUST enter the picker or it drops to `<body>`.
10. **`escapeHtml` on area/section names + `data-target-section-id`.**
11. **The toast is mandatory feedback in Today** (a section-move doesn't change Today's grouping) — do not "optimize" it away.

---

## Files touched (estimated)

| File | LOC | Note |
|---|---|---|
| `src/model/tasks.js` | +16 | `moveToSection` method + JSDoc contract line |
| `tests/unit/tasks.test.js` | +35 | `describe("createTaskModel — moveToSection")` (~6 cases) |
| `src/views/move-picker.js` | +55 | **new** — `renderMovePicker` (incl. empty-picker hint) |
| `src/views/section.js` | +16 | thread `taskMenuMode` + `movePickerHtml` + `hasMoveTargets`; "Move to…" item |
| `src/views/today.js` | +55 | state + 3 handlers + thread + compute picker; "Move to…" item |
| `src/views/area.js` | +62 | state + 3 handlers + thread + compute picker + cross-area focus fallback |
| `src/controller.js` | +38 | `onMoveTaskToSection` + toast/undo, both mounts; `MOVE_TOAST_MS` |
| `src/styles/main.css` | +32 | `.task-menu--picker` + group + back + disabled hint + scroll |
| **Total** | **~309** | **+6 tests → 133 total** |

---

## Testing

### Unit (Vitest — `tests/unit/tasks.test.js`)

New `describe("createTaskModel — moveToSection")`:
- happy path: re-points `sectionId`, appends `order = max(targetOrders)+1`, persists, notifies once, returns void
- **gap-robustness:** target has orders `[0, 2]` → new order is `3` (not `2`/collision)
- empty target section: `order = 0`
- same-section: no-op, **no notify**, no write
- non-existent task → throws `Task not found: {id}`
- non-existent target section → throws `Section not found: {id}`
- preserves other fields (title, starred, critical, completed, dueAt, recurrence, leadTime, createdAt)

### Manual / Claude Preview MCP E2E (end of phase)

- **Area, within-area:** open task ⋯ → Move to… → pick a sibling section → task relocates there; toast shows; focus on the moved task's ⋯
- **Area, cross-area:** move to a section in another area → task leaves the page; toast "Moved to Area › Section"; Undo restores it
- **Focus-out triage:** move a captured (starred) task out of `focus-default` into a project section → works; verify it's no longer in Focus
- **Today:** move a starred task's section → task stays in Today (toast is the only feedback); Undo works
- **"Move to…" omission:** fresh app with only `focus-default` → no "Move to…" item
- **Picker keyboard:** ArrowUp/Down/Home/End cycle targets; Esc closes; Tab closes + focus returns to ⋯; "← Back" returns to actions
- **Cascade race:** open picker, delete the target section in another path → pick → swallowed, no crash
- **NEXT card:** move the NEXT task in Today
- **escapeHtml:** a section named `<b>x</b>` renders as text in the picker, doesn't execute
- **No console errors throughout**

No JSDOM tests for views — per project convention (TDD only on the pure-function seam).

---

## Out of scope (v0.2 candidates)

- **Drag-to-reorder / drag-to-move** — a separate, larger interaction.
- **Choosing position within the target** — always appends to the end; no insert-at-position.
- **Search / filter box in the picker** — YAGNI until there are many areas; the list scrolls.
- **Bulk move** (multi-select) — single task at a time.
- **Two-level Esc** (picker → actions → close) — v1 is one-level (Esc closes; Back returns).
- **Back focuses the "Move to…" item specifically** — v1 focuses the first action item (Rename).
- **Moving sections between areas** — this milestone is TASKS only.
- **`_rename.js` / shared menu-state helper extraction** — a separate refactor; not gated on this work.

## Plan-phase flags (notes for the plan-writer)

- **`renderMovePicker` lives in a new `src/views/move-picker.js`**, imported by both `area.js`/`section.js` and `today.js`. Confirm relative import paths.
- **CSS `max-height` vs the capture bar on mobile.** A long picker shouldn't overflow the viewport or hide behind the fixed capture bar — check during CSS planning.
- **`hasMoveTargets = sections.length > 1`** is a cheap global check (≥1 section other than the task's own). It's correct because every task's own section is exactly one of those sections; if any other exists, it's a valid target.
- **Confirm `toast.show` tolerates an absent `key`** (one-at-a-time replace) — quick read of `toast.js` `show()` during planning.
- **area.js threads the full `{areas, sections}` only to compute the open picker** — small data, no perf concern, but keep the computation guarded by `taskMenuMode === "picker"` so it's skipped on every normal render.

---

## Stress-test outcome (2026-05-31)

4-lens pass (security / privacy / accessibility / loopholes): **0 🔴, 1 🟠, 6 🟡 — converged in one pass, all 7 folded inline above.**
- Security ✅ + Privacy ✅ clean (`toast.show` escapes `message` per toast.js:111; picker escapes names + `data-target-section-id`; all writes local IndexedDB).
- 🟠 cross-area focus-to-body → source-section focus fallback (`pendingFocusMoveSourceSectionId`).
- 🟡 ×6: `aria-haspopup` on "Move to…"; group-label AA contrast; `MOVE_TOAST_MS = 5_000`; `taskMenuMode` in `destroy()`; no-`doRender` self-heal documented; empty-picker race handled.
- Considered-and-rejected (accepted limitations): undo-orphan (prevented by one-at-a-time toast supersede); double-pick lands on last target; menu focus not preserved across unrelated re-renders (transient); `create`-into-gap order collision (pre-existing, out of scope); move into collapsed target (toast confirms).

No open questions.
