# Inline task rename — design spec

**Date:** 2026-05-28
**Phase:** v0.1 Phase 2 (post-polish-bundle)
**Goal:** Let the user rename a task in place, anywhere a task row is shown (today + area views), via the existing ⋯ menu pattern used for sections and areas.

This is the **3rd application** of a settled inline-rename pattern. Section rename (M3) and area rename (M5) already work. Task rename grafts the same closure-state + post-render focus + isRendering blur-guard machinery onto a third view layer, plus a new dedicated model method.

---

## Approach

**Approach A + C (selected):**
- `renderTaskRow` (already shared between today + area + section) learns a rename-mode branch — when `renaming: true`, it renders an input-only `<li>` instead of the checkbox/title/star/⋯ row. (C)
- All rename plumbing — closure state, action handlers, post-render focus, destroy-commit — lives in the two parent views (`today.js`, `area.js`), independent of each other. (A)
- **No shared `_rename.js` helper.** Section/area/task rename have subtle per-context differences (selector strings, mutual-exclusion partners, destroy-commit fallback owners). Extracting under load risks the wrong abstraction. Per Malin's principles: "write three concrete versions before you extract a fourth." We're shipping the THIRD; helper extraction (if it earns its keep) is a v0.2 candidate.

**Rejected: Approach B (extract shared helper now)** — refactor masquerading as a feature; postponed.

---

## Architecture

| Layer | Change |
|---|---|
| **Model** (`src/model/tasks.js`) | Add `async rename(id, title)` — mirrors `sections.rename` / `areas.rename`: applies `capitalizeFirst`, throws `"rename(task): title cannot be empty"` on empty, throws `Task not found: {id}` on missing, `db.put` + `notify`. |
| **View — `renderTaskRow`** (`src/views/task.js`) | New optional params `renaming: boolean` + `pendingRenameValue: string \| null`. When `renaming` true, the `<li>` renders an input-only mode (see Template). The `<li>` keeps `data-id` so `taskFromEvent` lookups still resolve. |
| **View — `section.js`** | `renderTaskRowWithMenu` threads through `renamingTaskId` + `pendingRenameTaskValue`. When `task.id === renamingTaskId`, pass `renaming: true` to `renderTaskRow` and skip the menu injection (mutually exclusive — input replaces the row). |
| **View — `today.js`** | Adds: `renamingTaskId`, `pendingRenameTaskValue`, `pendingRenameTaskSelect`, `isRendering` closure state. New actions: `rename-task` (in ⋯ menu) and `commit-task-rename` (input only, Enter handler — NO click handler). Existing `closeMenu` is unaffected; rename state is separate from menu state. **Also: today.js's LOCAL `renderTaskRowWithMenu(task, now, openMenuTaskId)` helper (distinct from `section.js`'s) must be extended to thread `renamingTaskId` + `pendingRenameTaskValue`, pass `renaming: true` + `pendingRenameValue` to `renderTaskRow` when `task.id === renamingTaskId`, and skip menu injection in that case.** Also: today.js currently has NO `bindKeys` plumbing — this phase introduces it (see "today.js — new `bindKeys` lifecycle" below). |
| **View — `area.js`** | Adds the SAME task-rename closure state ALONGSIDE existing section-rename state. New actions: `rename-task`, `commit-task-rename`. Existing `rename-section` action MUST also null task-rename state (cross-type mutual exclusion). |
| **Controller** | New callback `onCommitTaskRename({ taskId, name })`, wired into BOTH today-view and area-view mounts. Calls `tasks.rename(id, name)` inside try/catch that swallows `/Task not found/` (cascade race), same shape as existing `onCommitRename` for sections. |
| **CSS** (`src/styles/main.css`) | `.task--editing` modifier + `.task__rename-input` styles. Must preserve row height so the rename doesn't shift other rows. |

---

## Template — `renderTaskRow` rename branch

When `renaming === true`:

```html
<li class="task task--editing" data-id="<escaped task.id>">
  <input type="text"
    class="task__rename-input"
    value="<escaped pendingRenameValue ?? task.title>"
    data-action="commit-task-rename"
    data-task-id="<escaped task.id>"
    aria-label="Rename task: <escaped task.title>"
    placeholder="<escaped task.title>"
    autofocus />
</li>
```

**Required behaviors:**
- `pendingRenameValue ?? task.title` — `??`, not `||`. A `""` value renders an empty input with the placeholder hinting the committed title; `null` prefills the committed title.
- `escapeHtml` applied to: the input `value`, `aria-label`, `placeholder`, **and `data-id` + `data-task-id`**. Titles can contain `<`/`>`/`"` and would otherwise break the input attributes or execute as HTML. IDs come from `uuid()` today (not user-controlled), but escaping them is defense-in-depth + future-proofs the template if imported tasks ever carry external IDs.
- No checkbox / star / ⋯ / recurring / time-label during rename. They re-appear on commit or cancel. (Section-pattern symmetry: rename is "modal" — no concurrent affordances on the same row.)
- `data-action="commit-task-rename"` exists ONLY so the Enter handler (`bindKeys`, which reads the attribute) finds the input. Wiring it as a CLICK action would commit + exit rename when the user clicks inside the field to position the cursor. Enter and blur are the only commit paths.
- `task--editing` modifier class — CSS hook to adjust row padding/grid if needed.

---

## State machine — new closure vars per view (mirror area.js section-rename exactly)

```
renamingTaskId          - task id currently in rename mode, or null
pendingRenameTaskValue  - in-progress text preserved across re-renders
                          (60s tick, unrelated model notifies). `null` on
                          menu rename (prefill committed title); reserved
                          for `""` if create-into-rename is added later.
pendingRenameTaskSelect - true when entering rename; on the next render the
                          input is .focus()'d AND .select()'d. Cleared after
                          that one render so subsequent re-renders preserve
                          cursor position.
pendingFocusTaskId      - (already exists in both views) after ANY rename
                          exit path — Esc, cancel-empty, blur-empty, OR
                          commit-with-value — focus returns to the row's ⋯
                          button via post-render lookup. All four paths set
                          this flag before doRender or before the async
                          model.rename whose notify triggers doRender.
isRendering             - true during the innerHTML rewrite; the blur
                          listener returns early if set. today.js does NOT
                          have this yet — Phase 2 introduces it (required
                          to prevent the synthetic blur on detach from
                          committing mid-render).
```

---

## Actions

### `rename-task` (new, both views)

```js
"rename-task": (_event, actionEl) => {
  const t = taskFromEvent(actionEl);
  if (!t) return;
  // Cross-type mutual exclusion (area.js only):
  //   renamingId = null;
  //   pendingRenameValue = null;
  //   pendingRenameSelect = false;
  openMenuTaskId = null; // today.js; or openTaskMenuId in area.js
  renamingTaskId = t.id;
  pendingRenameTaskSelect = true;
  pendingRenameTaskValue = null; // menu rename → prefill committed title
  doRender();
},
```

### `commit-task-rename` — **NO click action**

The rename input carries `data-action="commit-task-rename"` only so `bindKeys` can find it for Enter. NO entry under `bindActions`. (Critical invariant — matches section/area rename.)

### Existing `rename-section` (area.js) — must extend

```js
"rename-section": (_event, actionEl) => {
  const s = sectionFromEvent(actionEl);
  if (!s) return;
  openMenuId = null;
  renamingId = s.id;
  pendingRenameSelect = true;
  pendingRenameValue = null;
  // NEW: cross-type mutual exclusion — null task-rename state too
  renamingTaskId = null;
  pendingRenameTaskValue = null;
  pendingRenameTaskSelect = false;
  doRender();
},
```

### `commitRenameFromInput` (both views, new function)

```js
function commitTaskRenameFromInput(inputEl) {
  const id = inputEl?.dataset?.taskId ?? renamingTaskId;
  if (!id) return;
  const value = (inputEl?.value ?? "").trim();
  renamingTaskId = null;
  pendingFocusTaskId = id;
  pendingRenameTaskValue = null;
  if (value) {
    callbacks.onCommitTaskRename({ taskId: id, name: value });
  } else {
    doRender(); // empty/cancel — re-render now to consume the flag
  }
}
```

### today.js — new `bindKeys` lifecycle

Today.js currently has no `bindKeys` call (only `bindActions`). This phase introduces it:

1. Import: `import { bindActions, bindKeys } from "../utils/dom.js";` (extend the existing import).
2. After `const unbind = bindActions(rootEl, {...});`, add:
   ```js
   const unbindKeys = bindKeys(rootEl, {
     Enter: (event, actionEl) => {
       if (renamingTaskId && actionEl?.dataset?.action === "commit-task-rename") {
         event.preventDefault();
         commitTaskRenameFromInput(actionEl);
       }
     },
   });
   ```
3. In `destroy()`, call `unbindKeys()` alongside the existing `unbind()`.

For area.js, `bindKeys` already exists for the section-rename Enter — just extend the existing handler with the task-rename branch (see next subsection).

### `bindKeys` Enter handler (both views, extend)

```js
Enter: (event, actionEl) => {
  // Existing section-rename Enter (area.js only) stays
  if (renamingTaskId && actionEl?.dataset?.action === "commit-task-rename") {
    event.preventDefault();
    commitTaskRenameFromInput(actionEl);
  }
},
```

### `cancelTaskRename` (both views, new function)

```js
const cancelTaskRename = () => {
  if (!renamingTaskId) return;
  pendingFocusTaskId = renamingTaskId;
  renamingTaskId = null;
  pendingRenameTaskValue = null;
  doRender();
};
```

### `docKeyHandler` extensions

**today.js — extend Escape branch:**
```js
if (event.key === "Escape") {
  if (renamingTaskId) { cancelTaskRename(); return; }
  if (openMenuTaskId) closeMenu();
  return;
}
```

**area.js — extend Escape branch (rename precedence: any rename ≻ any menu):**
```js
if (event.key === "Escape") {
  if (renamingId)     { cancelRename();      return; }
  if (renamingTaskId) { cancelTaskRename();  return; }
  if (openMenuId)     { closeMenu();          return; }
  if (openTaskMenuId) { closeTaskMenu();      return; }
  return;
}
```

### `doRender` extensions

After the existing innerHTML rewrite + isRendering try/finally, add a rename-input listener block mirroring section rename, and a post-render focus block:

```js
// Re-attach rename input listeners (input event + blur commit, guarded by isRendering)
const renameInput = rootEl.querySelector(".task__rename-input");
if (renameInput) {
  renameInput.addEventListener("input", (e) => {
    pendingRenameTaskValue = e.target.value;
  });
  renameInput.addEventListener(
    "blur",
    () => {
      if (isRendering) return;
      if (renamingTaskId) commitTaskRenameFromInput(renameInput);
    },
    { once: true },
  );
  if (pendingRenameTaskSelect) {
    renameInput.focus();
    renameInput.select();
    pendingRenameTaskSelect = false;
  } else if (document.activeElement !== renameInput) {
    renameInput.focus();
  }
}
```

For today.js, doRender also needs the `isRendering = true / try / finally` wrapper around the `rootEl.innerHTML = template(...)` line — currently missing because today.js had no rename-state-to-protect.

### `destroy()` extensions

```js
if (renamingTaskId) {
  const input = rootEl.querySelector(".task__rename-input");
  const value = (input?.value ?? "").trim();
  if (value) {
    callbacks.onCommitTaskRename({ taskId: renamingTaskId, name: value });
  }
  renamingTaskId = null;
}
// Plus reset: pendingRenameTaskValue = null; pendingRenameTaskSelect = false; isRendering = false;
```

---

## Controller wiring

In `mountMainView` for both today and area:

```js
onCommitTaskRename: async ({ taskId, name }) => {
  try {
    await tasks.rename(taskId, name);
  } catch (err) {
    // Race: task was cascade-deleted (e.g., section/area cascade fired
    // while mid-rename, or destroy-commit raced cascade). Drop silently —
    // toast undo restores the task with its pre-rename title; typed text
    // is lost. Mirrors `onCommitRename` for sections.
    if (/Task not found/.test(err.message)) return;
    throw err;
  }
},
```

For today-view mount, this is wired into the `createTodayView` callbacks alongside `onDelete`. For area-view mount, it joins the existing `areaCallbacks()` block.

---

## Task ⋯ menu — new "Rename" item

**Order in menu:**
- **today.js task menu:** `[Rename, Delete]` — today has no Move up/down (today is a sorted view, not a manual order).
- **area.js / section.js task menu:** `[Rename, Move up (omitted if first), Move down (omitted if last), Delete]` — Rename first to match section + area menu order.

Each new menu item is a `<button class="task-menu__item" type="button" data-action="rename-task" role="menuitem" tabindex="-1">Rename</button>`.

---

## Edge cases (covered, all match settled pattern)

| Scenario | Behavior |
|---|---|
| 60s tick mid-rename | `pendingRenameTaskValue` preserves typing; `isRendering` blur-guard prevents synthetic blur from committing. |
| Task model-deleted from elsewhere | Row detaches; blur fires; `tasks.rename` throws `Task not found` → controller swallows. |
| Section cascade-deleted (area view) | Tasks vanish on cascade; same swallow path. |
| Area cascade-deleted (area view) | `deleteAreaCascade` redirects to `#today` FIRST → view destroys → destroy-commit fires → if commit needed, swallowed. |
| Route change mid-rename | Destroy-commit: non-empty trimmed value commits via callback; reset state either way. |
| Esc during rename | `cancelTaskRename`: discard value; focus returns to ⋯ via `pendingFocusTaskId`. |
| Enter during rename | `commitTaskRenameFromInput`: trim → empty cancels, non-empty calls `onCommitTaskRename`. |
| Blur (Tab, click outside, click capture bar) | Same as Enter, gated by `if (!isRendering)`. |
| Click inside rename input | Cursor positions; no commit (no click handler). |
| Open ⋯ menu on task B while task A renaming | Allowed: A keeps rename mode (its ⋯ isn't rendered); B's menu opens independently. |
| From task B's menu, pick Rename | A's typed value is silently lost; B enters rename. Matches existing section↔section behavior. Documented, not a bug. |
| Cross-type: section X renaming → user picks task Y's Rename | `rename-task` MUST null `renamingId` + `pendingRenameValue` + `pendingRenameSelect`. Symmetric: `rename-section` MUST null all three task-rename vars. Both directions covered. |
| NEXT card in today | `renderTaskRowWithMenu` inside `<article class="next-card">` — `<li>` swaps to input-mode normally; NEXT label persists. |
| Title containing markup | `escapeHtml` on input value + aria-label + placeholder. |
| Empty / whitespace title | Controller view trims; empty → cancel (no model write). Model also defends: `capitalizeFirst("") === ""` → throws `"rename(task): title cannot be empty"`. |
| Long title | Input scrolls horizontally; row height preserved by CSS. |
| Empty / cleared input + Enter | Silently cancels; original title restored. Placeholder hints the committed title for the rare user who clears + Enters by accident. Matches section/area pattern. Documented design choice — empty titles are not allowed by the schema, and supporting "commit empty" would require a separate UX affordance. |

---

## Invariants (do NOT simplify away)

Lifted verbatim from section/area rename — these are the M5 lessons codified:

1. **`isRendering` MUST wrap doRender's innerHTML rewrite in try/finally.** Else a template throw strands `isRendering=true` and silently swallows all future blur-commits.
2. **Blur listener MUST return early if `isRendering`.** Otherwise the synthetic blur fired when innerHTML detaches the focused input fires the commit + exits rename on every re-render tick.
3. **`pendingRenameTaskValue` MUST use `??`, not `||`.** A typed `"0"` or `""` would otherwise fall back to the committed title.
4. **Rename input MUST NOT have a `commit-task-rename` CLICK action.** The `data-action` attribute exists solely for the Enter handler. Wiring click would commit on every cursor-positioning tap.
5. **Cross-type mutual exclusion: `rename-task` nulls section-rename state, `rename-section` nulls task-rename state.** Required in area.js. Bidirectional.
6. **`pendingFocusTaskId` MUST be set BEFORE doRender** in cancel/commit paths — post-render lookup uses it, then nulls it.
7. **Destroy-commit MUST run BEFORE listener unbinding** so the in-flight rename's typed value isn't silently lost on route change.
8. **Controller MUST swallow `/Task not found/` from `tasks.rename`** — cascade-race protection. Match section/area `onCommitRename` shape exactly.
9. **today.js's `doRender` MUST gain the `isRendering` try/finally** — currently absent because today had no rename state. Phase 2 introduces it.
10. **Menu order: Rename first, Delete last.** Matches section + area menu order; Rename is the most common operation, Delete is destructive (lowest in menu = hardest to mis-click).

---

## Files touched (estimated)

| File | LOC | Note |
|---|---|---|
| `src/model/tasks.js` | +12 | `async rename` method |
| `tests/unit/tasks.test.js` | +30 | `describe("createTaskModel — rename", …)` block (~6 cases) |
| `src/views/task.js` | +20 | rename-mode branch in template |
| `src/views/section.js` | +6 | thread `renamingTaskId` + `pendingRenameTaskValue` through |
| `src/views/today.js` | +80 | closure state + actions + handlers + isRendering + destroy-commit |
| `src/views/area.js` | +80 | task-rename plumbing alongside existing section-rename |
| `src/controller.js` | +14 | `onCommitTaskRename` callback in both view mounts |
| `src/styles/main.css` | +10 | `.task--editing` + `.task__rename-input` |
| **Total** | **~252** | **+6 tests → 127 total** |

---

## Testing

### Unit (Vitest — `tests/unit/tasks.test.js`)

New `describe("createTaskModel — rename")` block:
- happy path: capitalizes first char, persists, notifies, returns updated task
- empty title → throws `"rename(task): title cannot be empty"`
- whitespace-only title → throws (since `capitalizeFirst("   ") === ""` — verify in plan phase by checking the helper)
- non-existent id → throws `"Task not found: {id}"`
- preserves other fields (order, dueAt, starred, completed, sectionId, recurrence)
- notifies subscribers exactly once

### Manual / Claude Preview MCP E2E (end of phase)

- **Area view**: open task ⋯ → Rename → input shows → type → Enter → committed + capitalized
- **Area view, empty commit**: type empty → Enter → row restored with original title
- **Esc**: cancels, focus returns to ⋯
- **Blur**: click into capture bar → commits if non-empty
- **60s tick mid-rename**: lower `TICK_MS` temporarily → tick fires → typed value preserved
- **Today view**: same flow in NEXT card + Today group + Starred group + Overdue group
- **Cross-type**: in area view, section X mid-rename → click task Y's Rename → X discarded silently, Y enters rename
- **Reverse cross-type**: task X mid-rename → click section Y's Rename → X discarded, Y enters rename
- **Destroy-commit**: area → today route change mid-rename → commits if non-empty; reset if empty
- **Mid-rename task delete (via another window — N/A; via cascade)**: delete parent section → task vanishes → rename swallowed, no UI surprise
- **Cascade**: delete area mid-task-rename → redirect-then-cascade → swallow
- **A11y**: aria-label present, arrow-key menu nav still works pre-rename, Tab from rename-input commits + closes mode
- **No console errors throughout**

No JSDOM tests for views — per project convention (`TDD only on the pure-function seam`).

---

## Out of scope (v0.2 candidates)

- Shared `_rename.js` helper extracting the 4-call pattern (section in area, area in sidebar, task in today, task in area). Earned after this phase ships.
- Double-click on title to enter rename (Windows-style F2 / dblclick — convenience trigger, doesn't replace menu).
- Create-into-rename for tasks (sections + areas have it; tasks currently arrive via capture with a typed title — no need yet).
- Inline editing of dueAt / starred / recurrence / notes (Phase 3+ candidates).
- IME composition guard on Enter (`event.isComposing` check). Pre-existing gap across all rename surfaces — fold into a unified hardening pass alongside the `_rename.js` extraction.
- Mobile cancel-without-clearing-text. Touch keyboards have no Esc; mobile users can only "cancel" via clear + tap-outside (which commit-empty → cancel). Pre-existing parity with section + area rename; solving requires a visible Cancel button (UI-wide change) or a long-press gesture.
- Focus-to-body when parent section cascade-deletes mid-rename. Pre-existing focus gap in cascade-delete generally; routing focus to the toast Undo would be a project-wide change.

## Plan-phase flags (notes for the plan-writer)

- **NEXT card CSS quirks during rename.** The NEXT card has its own wrapper (`<article class="next-card">`) with custom padding/styling. An input-only `<li>` inside it may need a minor CSS tweak — check during CSS planning.

---

## Open questions

None at write-time. Stress-test pass (security / privacy / a11y / loopholes) follows; any findings get folded inline before user review.
