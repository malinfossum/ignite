# Polish bundle — Toast aggregation + pause/resume + menu arrow keys

**Date:** 2026-05-27
**Scope:** ~3 small features bundled before v0.1.0 release prep
**Predecessors:** Post-M5 menu-parity cleanup shipped `7fc545f` (2026-05-26). 104/104 tests green, tree clean.
**Target:** 5 atomic commits, +16 tests (120 total), no model-layer changes, no design-system touches.

## Why

Three loose ends from M5's "intentional deferrals" list (see MEMORY.md):

1. **Toast queueing for sequential deletes (last toast wins today).** Delete two tasks within 5 seconds and the first toast's Undo button vanishes — that task is gone with no recovery. A real UX hazard for the common "morning cleanup" pattern.
2. **Pause toast timer on keyboard focus / hover.** Required for WCAG 2.2.1 (Timing Adjustable). A screen reader user tabbing to the Undo button must be able to read it without racing a 5-second timer.
3. **Full arrow-key navigation inside menus (currently Tab-only).** ARIA APG menu pattern. Tab cycles between buttons today; ArrowUp/Down/Home/End/Tab-to-close are the industry standard for `role="menu"` and improve screen reader semantics.

These are the last accessibility / UX gaps before v0.1.0 can be handed to friends and family. The release-blocker work (inline task rename, M6 cross-section task moves) is staged after this bundle.

## Scope

**In scope**

- Toast aggregation for sequential **task deletes only**. Multiple rapid task deletes merge into a single in-place-updating toast (`"Task deleted"` → `"2 tasks deleted"` → ...). One Undo restores all in reverse insertion order.
- Toast pause on hover OR keyboard focus, resume from remaining (not full reset). Standard Material UI / Sonner pattern.
- Menu arrow-key navigation following ARIA APG menu pattern across all four menus (today task menu, area view section menu, area view task menu, sidebar area menu): ArrowUp/Down with wrap, Home/End jumps, Tab-closes-menu-and-returns-focus-to-⋯. Roving tabindex via static `tabindex="-1"` on all menuitems + programmatic `.focus()` on open and navigation.
- New `toast.update({ message, durationMs })` and `toast.isActive(key)` API on toast view.
- New `key` parameter on `toast.show()` for batch identity.
- New `src/utils/menu-keyboard.js` with three pure helpers: `firstEnabledIndex`, `lastEnabledIndex`, `nextEnabledIndex`.
- New `formatTaskDeleteMessage(count)` in `src/utils/text.js`.

**Out of scope**

- Cascade-delete aggregation (section / area). Cascades keep current "newer replaces older" semantics. Cross-type rapid sequences continue to lose the older undo — accepted for v0.1, mitigated in v0.2 by a "Recently deleted" trash view (separate spec when needed).
- Typeahead on menus (typing first letter to jump). ARIA APG calls this optional; for 1–4 item menus it adds little.
- Inline task rename. Separate spec next session.
- M6 cross-section task moves. Separate spec after task rename.
- Toast dismiss button. Not requested; auto-dismiss + paused-while-interacted-with covers the use cases.
- JSDOM view tests. Continue manual E2E via Claude Preview MCP per project convention.

## Decisions log

Three questions surfaced during brainstorming; lock-ins:

| Question | Lock-in | Rationale |
|---|---|---|
| Aggregation semantics for sequential deletes | Aggregate **task-only** (cascades unchanged) | Cross-type rapid sequences are rare in practice. Cascade messaging ("'work' and 3 tasks deleted") gives critical user feedback that a generic "N items deleted" would lose. Queue overflow risk avoided. Lost-undo edge case mitigated later by Trash view (v0.2). |
| Timer behavior on hover/focus resume | Resume from **remaining** time | Industry standard (Material UI, Sonner). "Reset to full" can feel like the toast won't dismiss if user keeps glancing. Predictable. |
| Menu keyboard model | Full **ARIA APG** pattern (with all-`tabindex="-1"` + intercepted Tab) | Best screen reader experience ("menu, item 2 of 4"). Tabindex shuffling avoided by intercepting Tab to close the menu — simpler than dynamic tabindex rewrite. Matches Radix UI / HeadlessUI conventions. |

## Section 1 — Toast aggregation + pause/resume

### Toast view — extended API

`src/views/toast.js` exports `createToastView(rootEl) → { show, update, isActive, destroy }` plus a named constant:

```js
export const TASK_DELETE_BATCH_KEY = "task-delete";
// Identifies the task-delete aggregation batch.
// Imported by the controller; lives here as the single source of truth
// so a typo silently breaking aggregation is impossible.

show({ message, onUndo, onDismiss, durationMs, key })
// Existing fields preserved. `key` is a new optional string identifying
// the batch this toast belongs to. Replaces any active toast (clears its
// timer + fires its onDismiss).

update({ message, durationMs })
// Mutates the *active* toast in place: replaces .toast__message textContent,
// resets the timer to a fresh durationMs (or default 5s if omitted).
// No-op if there's no active toast. Does NOT fire onDismiss on the prior
// state — same toast continues with new message + new timer.

isActive(key)
// Returns true iff a toast with this `key` is currently showing.
// Returns false if no toast is showing or if active toast has a different key.

destroy()
// Existing: clears active toast + timer, removes listeners.
```

### Toast template structure

The rendered toast HTML changes — `aria-live` moves from the toast root to the message span, so a screen-reader user with focus on the Undo button is **outside** the live region and update-announcements still fire. (Per W3C ARIA: focus inside a live region suppresses change announcements in some SRs. The current M2 template has `aria-live` on the toast root, which becomes a real bug once `update()` mutates the message in place during a batch.)

```html
<!-- before (M2-current; aria-live on root, focus on Undo suppresses announcements) -->
<div class="toast" role="status" aria-live="polite">
    <span class="toast__message">${escapeHtml(message ?? "")}</span>
    <button class="toast__undo" type="button">Undo</button>
</div>

<!-- after (this bundle; aria-live on message span only) -->
<div class="toast">
    <span class="toast__message" role="status" aria-live="polite">${escapeHtml(message ?? "")}</span>
    <button class="toast__undo" type="button">Undo</button>
</div>
```

`role="status"` on a `<span>` is valid per ARIA (HeadlessUI + Reach UI both use this pattern). `role="status"` implies `aria-live="polite"` + `aria-atomic="true"` by default; the explicit `aria-live="polite"` here is defense-in-depth.

### Toast view — internal changes

Closure state:
```
activeKey:         string | null   // identifies the active batch
timer:             number | null   // setTimeout handle; null when paused or cleared
timerStartedAt:    number | null   // Date.now() when current timer leg started
elapsedAtPause:    number          // accumulated elapsed ms across pause/resume cycles
durationMs:        number | null   // total duration for the active toast
isHovered:         boolean
isFocused:         boolean
activeUndoHandler: function | null // existing — undo click listener handle
```

**Pause/resume contract:**
- Pause triggers: `mouseenter` on **`.toast` div** (rendered child of `rootEl`, NOT `rootEl` itself) OR `focusin` on `.toast` (Undo button focused).
- Resume triggers: `mouseleave` AND `focusout` (must be off BOTH to resume).
- **`pause()` is idempotent.** Early-return if `timer === null` (already paused). Otherwise: `clearTimeout(timer)`, `elapsedAtPause += Date.now() - timerStartedAt`, `timer = null`, `timerStartedAt = null`.
- **`resume()` is idempotent.** Early-return if `timer !== null` (already running). Otherwise: `remainingMs = durationMs - elapsedAtPause`, `timerStartedAt = Date.now()`, `timer = setTimeout(dismiss, remainingMs)`.
- On `update()`: reset `elapsedAtPause = 0`, `durationMs = newDurationMs`. If a timer is currently running, `clearTimeout(timer)` then `setTimeout(dismiss, newDurationMs)`. If paused (no timer), do nothing else — user un-hover will resume with the new full duration via the resume logic above.

**Listener attachment.** All four listeners (`mouseenter`, `mouseleave`, `focusin`, `focusout`) attach to the **`.toast` div** (the rendered child), not to `rootEl`. After `rootEl.innerHTML = "..."` in `show()`, do `const toastEl = rootEl.querySelector(".toast")` and attach there. When the toast is cleared (`rootEl.innerHTML = ""`), the `.toast` div is detached from DOM → its listeners GC with it. No manual `removeEventListener` needed. This avoids the "stale listeners accumulate on the persistent `#toast-root` div" failure mode.

**Closure-state reset contract.** A single internal helper `clearActive()` MUST reset every closure variable on every exit path:

```js
function clearActive() {
    if (timer) clearTimeout(timer);
    timer = null;
    timerStartedAt = null;
    elapsedAtPause = 0;
    durationMs = null;
    activeKey = null;
    activeUndoHandler = null;
    isHovered = false;
    isFocused = false;
    rootEl.innerHTML = "";  // detaches .toast div + its listeners
}
```

`clearActive()` is called from **every** exit path:
1. **Undo click** — `activeUndoHandler` calls `clearActive()` then invokes the caller's `onUndo`.
2. **Timer expiry (dismiss)** — `setTimeout` callback calls `clearActive()` then invokes the caller's `onDismiss`.
3. **Replace-on-`show()`** — start of `show()` calls `clearActive()` (firing the prior toast's `onDismiss` if defined) before rendering the new toast.
4. **`destroy()`** — calls `clearActive()` (no callbacks fired).

**Why this matters:** without an enumerated reset, a stale `elapsedAtPause` from a prior paused toast leaks into the next show — its resume math is then wrong and the toast dismisses early. The M5 reverse-cascade-restore had a similar exhaustive-enumeration discipline; this is the equivalent here.

**Message mutation:** `update()` sets `rootEl.querySelector(".toast__message").textContent = message` directly (no `escapeHtml` needed — `textContent` does not parse HTML, so user-supplied content is safe by construction). The existing `show()` path uses `innerHTML` interpolation and therefore still applies `escapeHtml(message)` once at render time.

**Aria-live re-announce:** with the template fix above (aria-live on the message span only, not the toast root), a `textContent` change on `.toast__message` triggers an announcement even when focus is on the sibling `.toast__undo` button. Validate during E2E with at least one screen reader (NVDA on Windows is closest at hand).

### Controller — task delete aggregation

Both `taskDeleteBatch` and `handleTaskDelete` live in the **`createController` closure scope** (NOT view-local, NOT module-top-level). View-local scope would mean today and area each have their own batch → deleting a task from today then navigating to area and deleting another would start a fresh batch instead of aggregating. Module-top-level would persist across controller restarts which is wrong. Controller-scoped is the only correct scope.

```js
import { TASK_DELETE_BATCH_KEY, createToastView } from "./views/toast.js";
import { formatTaskDeleteMessage } from "./utils/text.js";

export function createController({ models, els }) {
    const { tasks, /* ... */ } = models;
    // ... existing setup ...

    let taskDeleteBatch = null;  // null | { tasks: Array<TaskSnapshot> }

    function handleTaskDelete(task) {
        tasks.remove(task.id);  // existing soft-delete path

        if (toast.isActive(TASK_DELETE_BATCH_KEY)) {
            taskDeleteBatch.tasks.push(task);
            toast.update({
                message: formatTaskDeleteMessage(taskDeleteBatch.tasks.length),
                durationMs: 5000,
            });
        } else {
            taskDeleteBatch = { tasks: [task] };
            toast.show({
                message: formatTaskDeleteMessage(1),
                key: TASK_DELETE_BATCH_KEY,
                durationMs: 5000,
                onUndo: () => {
                    const batch = taskDeleteBatch;
                    taskDeleteBatch = null;
                    for (const t of [...batch.tasks].reverse()) {
                        tasks.restore(t);
                    }
                },
                onDismiss: () => {
                    taskDeleteBatch = null;
                },
            });
        }
    }

    // ... mountMainView etc. ...
}
```

Both view callbacks become thin wrappers:
```js
// today view mount
createTodayView(mainRoot, {
    // ...
    onDelete: (task) => handleTaskDelete(task),
});

// area view mount
createAreaView(mainRoot, {
    // ...
    onDeleteTask: (task) => handleTaskDelete(task),
});
```

Cascade-delete callbacks (`onDeleteSection`, `onDeleteArea`) are **unchanged** — they continue to call `toast.show({ ... })` without a `key`, which replaces any active task-delete batch (firing its `onDismiss` → `taskDeleteBatch = null`).

### Pure helper — `formatTaskDeleteMessage`

`src/utils/text.js` gains:

```js
export function formatTaskDeleteMessage(count) {
    if (count === 1) return "Task deleted";
    return `${count} tasks deleted`;
}
```

Three tests, boundary-focused (count = 1, 2, 10).

### Cascade interaction (unchanged behavior, explicit)

Cascade deletes (section + area) continue to call `toast.show({ message: cascadeMessage(...) | cascadeAreaMessage(...), durationMs: CASCADE_TOAST_MS, onUndo: ..., })` with **no `key` parameter** — they are not part of the aggregation system. When a cascade fires while a task-delete batch is up:

1. `show()` calls its existing `clearActive()` internally → fires the active toast's `onDismiss` if defined → controller's `onDismiss` clears `taskDeleteBatch = null` (committing those tasks as truly deleted, no longer recoverable).
2. Cascade toast appears with its own message + 8s timer + own undo handler. Unchanged from M3 / M5 behavior.
3. Reverse direction (task delete fires while a cascade toast is up): the new `toast.show({ key: "task-delete", ... })` replaces the cascade toast via the same `clearActive()` path. The cascade's onDismiss is currently undefined → no-op, but the cascade snapshot is dropped. Cascade undo is lost. Same behavior as M5 today.

See [Known limitations](#known-limitations-accepted-for-v01) — items 1 and 2 cover this trade-off.

### Edge cases

| Scenario | Behavior |
|---|---|
| Hover during batch, new delete arrives | Batch grows via `update()`; timer stays paused (no fresh setTimeout). On un-hover, resumes with full new `durationMs`. |
| Click Undo with 3-task batch | All 3 restored in reverse insertion order. `taskDeleteBatch = null` immediately. Toast clears. |
| Timer expires while batch has N tasks | `onDismiss` fires → `taskDeleteBatch = null` → tasks stay deleted. |
| Hover during paused state → leave → toast dismisses normally | Resume sets fresh timer from `durationMs - elapsedAtPause`. |
| `update()` called when no toast active | No-op. |
| `isActive(key)` with no active toast | Returns false. |
| `show()` with a key that matches active key | Still REPLACES (calls clearActive + render fresh). Controller should use `update()` for same-batch growth, `show()` for new batches. |

### Anti-regressions

- All existing `toast.show()` call sites work unchanged (new params optional).
- Cascade undo flow (M3/M5) untouched.
- HTML escaping for user content via `escapeHtml()` in `show()` preserved.

## Section 2 — Menu arrow keys (ARIA APG pattern)

### Pure helper — `src/utils/menu-keyboard.js` (NEW)

```js
// Returns the index of the first non-disabled item. -1 if none (including empty array).
export function firstEnabledIndex(items)

// Returns the index of the last non-disabled item. -1 if none (including empty array).
export function lastEnabledIndex(items)

// Returns the next non-disabled index in `direction` (+1 = forward, -1 = backward),
// wrapping around the array boundary. Returns `currentIndex` if it's the only
// enabled item. Returns -1 if no item is enabled (including empty array).
export function nextEnabledIndex(items, currentIndex, direction)
```

`items` is an array shape `[{ disabled: boolean }, ...]`. The view code maps DOM nodes to this shape via `Array.from(menuEl.querySelectorAll('[role="menuitem"]')).map(el => ({ disabled: el.disabled }))`.

**Input contract:** caller passes `currentIndex` in `[0, items.length - 1]` (the index of the currently focused menuitem). Out-of-range indices are not defended against — they would only arise from a view-state bug, which an integration-level E2E check would catch. Keeping the helper pure and small.

**Helper signature for `findOpenMenuContainingTarget`:** each view implements this as a small lookup using its existing menu-open state AND a containment check. Without the containment check, a keydown fired while focus is on a sibling element (e.g., focus dropped to body but menu is visually still open) would falsely match the menu and try to focus a menuitem.

```js
// In today.js, structurally identical in area.js + sidebar.js with the relevant state flag.
function findOpenMenuContainingTarget(target) {
    if (!openMenuTaskId) return null;
    const menu = rootEl.querySelector(
        `[data-id="${CSS.escape(openMenuTaskId)}"] [role="menu"]`
    );
    return menu?.contains(target) ? menu : null;
}
```

### Template change — tabindex on menuitems

All menuitems across `src/views/section.js`, `src/views/sidebar.js`, `src/views/today.js` gain `tabindex="-1"`:

```html
<!-- before -->
<button role="menuitem" type="button" data-action="rename-section">Rename</button>

<!-- after -->
<button role="menuitem" tabindex="-1" type="button" data-action="rename-section">Rename</button>
```

This removes menuitems from the natural Tab sequence. They remain programmatically focusable (auto-focus on menu open continues to work — `.focus()` on `tabindex=-1` is valid).

### Trigger ARIA — already done

The `⋯` buttons across all four trigger sites already have `aria-haspopup="menu"` and `aria-expanded="${isOpen}"` (verified: `task.js:31-33`, `sidebar.js:443-446`, `section.js:73-78`; `today.js` renders via `renderTaskRow` so it inherits the task.js template). No changes needed in this bundle.

### Arrow-key focus loss on mid-nav re-render (defensive note)

Arrow-key navigation calls `.focus()` directly on the target menuitem; it does NOT route through the `pendingMenuFocus*` post-render restore pattern. If a model notify fires DURING an active arrow-nav sequence (e.g., another tab writes to IndexedDB, clock tick fires), the `innerHTML` rewrite drops focus, and the existing `pendingMenuFocus*` pattern restores focus to the FIRST menuitem — losing the user's arrow-nav position.

For solo users this is rare (sub-second arrow nav vs. infrequent notify-driven renders), so v0.1 accepts the limitation. If real-world usage surfaces friction, follow up in v0.2 with a `pendingMenuItemIndex` flag that the post-render query consumes alongside the existing first-item restore. **Do not** add this defensive infrastructure in this bundle — it'd grow scope past the polish theme without a real signal that it's needed.

### View wiring — each `docKeyHandler`

`src/views/today.js`, `src/views/area.js`, `src/views/sidebar.js` extend their existing `docKeyHandler` (today.js:35, area.js:122, sidebar.js:110) to handle arrow keys when a menu is open AND `event.target` is a menuitem inside it.

Pseudocode (one per view, structurally identical except for which menu state to check):

```js
function docKeyHandler(event) {
    // ... existing Esc-close logic stays ...

    const menuEl = findOpenMenuContainingTarget(event.target);
    if (!menuEl) return;  // event isn't in an open menu

    const menuItems = Array.from(menuEl.querySelectorAll('[role="menuitem"]'));
    const currentIndex = menuItems.indexOf(event.target);
    const items = menuItems.map(el => ({ disabled: el.disabled }));

    let nextIdx = -1;
    switch (event.key) {
        case "ArrowDown":
            nextIdx = nextEnabledIndex(items, currentIndex, 1);
            break;
        case "ArrowUp":
            nextIdx = nextEnabledIndex(items, currentIndex, -1);
            break;
        case "Home":
            nextIdx = firstEnabledIndex(items);
            break;
        case "End":
            nextIdx = lastEnabledIndex(items);
            break;
        case "Tab":
            event.preventDefault();
            closeMenu(true);  // returnFocus = true → focuses ⋯
            return;
        default:
            return;
    }

    event.preventDefault();
    if (nextIdx >= 0) menuItems[nextIdx].focus();
}
```

The `findOpenMenuContainingTarget` is per-view (each view knows its menu DOM structure via `openMenuSectionId` / `openMenuTaskId` / `openMenuAreaId` state).

### Edge cases

| Scenario | Behavior |
|---|---|
| Single-item menu (Focus area "Rename" only) | `nextEnabledIndex([{disabled:false}], 0, ±1)` returns 0 → `.focus()` no-ops (already focused). |
| All items disabled (theoretical — currently never happens since boundary moves are omitted) | Helper returns -1 → view skips `.focus()` call. |
| Current focus on a disabled item (defensive — never happens in practice) | Helper still finds next enabled correctly. |
| Tab from menuitem when menu is the last interactive element | `closeMenu(true)` focuses ⋯; user Tabs again from ⋯ to advance naturally. |
| Shift+Tab | Same as Tab — closes menu, focuses ⋯ (user then Shift+Tabs from ⋯). |

### Anti-regressions (M5 / s2 / s3 invariants — DO NOT simplify)

- **s3 invariant — `closeMenu(returnFocus)` parameter intact.** docClickHandler still passes `false` (click-outside doesn't steal focus). Arrow-key handler's Tab/Esc paths pass `true`.
- **s3 invariant — boundary moves OMITTED (not disabled).** The `disabled` skip in `nextEnabledIndex` is defensive only, but the `:not([disabled])` post-render query in doRender stays.
- **M5 invariant — `isRendering` blur-guard.** No rename input lives in menus; no interaction with this guard.
- **M5 invariant — post-render focus pattern.** `pendingMenuFocusSectionId` / `pendingMenuFocusTaskId` / `pendingMenuFocusAreaId` post-render focus queries are unchanged. Arrow-key nav operates on the *currently focused* item, not via the pending-focus pattern.
- **Existing Esc-close behavior unchanged.** Esc still routes through `closeMenu(true)` exactly as today.

## Known limitations (accepted for v0.1)

Explicit, documented accepted trade-offs — not bugs.

1. **Mixed task / cascade rapid sequences lose the older undo.** Cascades replace task batches and vice versa (firing `onDismiss` → batch cleared). Mitigated in v0.2 by a "Recently deleted" Trash view if real usage shows it matters.
2. **Hard reload mid-batch loses the entire batch.** With aggregation, a 5-task batch in flight = 5 tasks `tasks.remove()`'d in IndexedDB. Reload = all 5 unrecoverable. Same correctness profile as current single-task reload but a bigger blast radius. Trash view in v0.2 solves this.
3. **Touch users cannot pause the toast timer.** `mouseenter` doesn't fire from touch; `focusin` is uncommon on touch. Touch users get the 5s window. WCAG 2.2.1 is satisfied via the keyboard-focus path; revisit only if mobile usage data shows users want a longer read window.
4. **Arrow-key nav loses position on mid-nav re-render.** `.focus()` is called directly, not via the `pendingMenuFocus*` post-render restore. A notify-driven re-render during sub-second arrow nav resets focus to the first menuitem. Rare for solo users; addressable in v0.2 with `pendingMenuItemIndex` if friction surfaces.
5. **`setTimeout` keeps counting while the tab is in the background.** Modern browsers throttle but don't pause `setTimeout` on hidden tabs. Toast may dismiss in the background → undo lost on tab return. Existing M2 behavior; not a regression introduced by this bundle.
6. **Focus drops to body after Undo click.** Clicking Undo removes the focused button via `innerHTML = ""`; focus falls back to `<body>`. Existing M2 behavior; toast doesn't participate in the menu's `pendingMenuFocus*` pattern.

## Testing strategy

### TDD (pure-function seam — project convention)

**`tests/utils/text.test.js`** — extend with 3 tests:

```
formatTaskDeleteMessage
├── returns "Task deleted" for count = 1
├── returns "2 tasks deleted" for count = 2
└── returns "10 tasks deleted" for count = 10
```

**`tests/utils/menu-keyboard.test.js`** — NEW, 13 tests:

```
firstEnabledIndex
├── returns 0 when all enabled
├── skips leading disabled items
└── returns -1 when all disabled

lastEnabledIndex
├── returns last index when all enabled
├── skips trailing disabled items
└── returns -1 when all disabled

nextEnabledIndex
├── moves forward by one
├── wraps forward at end
├── moves backward by one
├── wraps backward at start
├── skips disabled items going forward
├── returns currentIndex when it's the only enabled item
└── returns -1 when all disabled
```

**Workflow per test:** Red (write test against missing/empty function) → Verify Red (`npm test` → must fail for "function missing", not for typo) → Green (minimal impl) → Verify Green (test passes, others still green, output pristine) → next test.

### Manual E2E (Claude Preview MCP — per project convention)

**After commit #2 (menu wiring):**
- Today task menu: ⋯ opens menu; ArrowDown wraps last→first; ArrowUp wraps first→last; Home jumps to first; End jumps to last; Tab closes menu + focuses ⋯; Esc closes + focuses ⋯ (s3 unchanged); click outside closes WITHOUT stealing focus (s3 unchanged).
- Area view section menu: same coverage.
- Area view task menu: same coverage.
- Sidebar area menu: same coverage + Focus area single-item menu doesn't crash on ArrowDown.
- Verify `document.activeElement` matches expectation after each key.
- No console errors throughout.

**After commit #4 (toast pause/resume):**
- Delete a task; hover the toast for > 5s; toast stays visible (timer paused).
- Mouse-leave; ~5s remaining (resumes from where it paused; instrument with a console.log of `Date.now() - timerStartedAt` if needed to prove).
- Repeat with keyboard: Tab to Undo button; wait > 5s; toast stays. Tab away; resumes.
- `toast.isActive(TASK_DELETE_BATCH_KEY)` query (via `preview_eval`) returns expected boolean.
- **Closure-state reset:** probe internal state (via `preview_eval` if the view exposes a debug getter, or by observing the next toast's behavior) — after dismiss or undo, the next toast's pause/resume math is correct (proves `elapsedAtPause` reset).
- **Listener cleanup:** add several toasts in sequence (delete → wait dismiss → delete → wait dismiss × 3); check `document.querySelectorAll(".toast")` returns 0 or 1 at any moment, never more. Confirms listeners attached to `.toast` div GC'd cleanly.

**After commit #5 (aggregation):**
- Delete task A → toast "Task deleted".
- Within 5s, delete task B → toast in-place updates to "2 tasks deleted"; timer reset.
- Add task C → "3 tasks deleted".
- Click Undo → all 3 restored (verify via DOM probe and IndexedDB state).
- Restore order: reverse insertion (C first, then B, then A).
- Cascade delete a section while task batch is up → cascade toast replaces (verify task batch's onDismiss fired by checking the batch is no longer recoverable; tasks stay deleted).
- **Cross-view aggregation:** delete a task from today view, navigate to area view via the sidebar, delete a task there within 5s → aggregates to "2 tasks deleted" (proves `taskDeleteBatch` lives in controller scope, not view scope).
- **SR re-announce:** with NVDA running, focus the Undo button BEFORE the batch grows; trigger a second delete; verify NVDA announces "2 tasks deleted" (proves the aria-live move from toast root to message span works).
- All E2E flows: zero console errors.

### Test count delta

| Before | After | Delta |
|---|---|---|
| 104 | 120 | +16 (3 text + 13 menu-keyboard) |

## Rollout / commit plan

Five atomic commits, menu-first for risk minimization:

| # | Commit message | Files | Test gate |
|---|---|---|---|
| 1 | `feat(utils): menu-keyboard navigation helpers (first/last/next enabled index)` | `src/utils/menu-keyboard.js` (NEW), `tests/utils/menu-keyboard.test.js` (NEW) | 117/117 |
| 2 | `feat(views): ARIA APG menu arrow-key navigation in today/area/sidebar` | `src/views/today.js`, `src/views/area.js`, `src/views/sidebar.js`, `src/views/section.js` (template tabindex) | 117 + E2E |
| 3 | `feat(utils): formatTaskDeleteMessage for aggregated task-delete toast` | `src/utils/text.js`, `tests/utils/text.test.js` | 120/120 |
| 4 | `feat(views): toast.update + isActive + pause/resume API extensions` | `src/views/toast.js` | 120 + E2E |
| 5 | `feat(controller): aggregate sequential task deletes into batch toast` | `src/controller.js` | 120 + E2E |

**Gates that block forward progress:**
- Any failed unit test → fix before commit
- Any console error in dev server during E2E → fix before commit
- Biome lint error → fix before commit
- Any s2/s3/M5 invariant violation (rename input, menu close-focus, isRendering blur-guard, FOCUS_ID exclusion, post-render focus pattern) → stop and reassess

**Scope guardrails (memory rules):**
- No changes to `base.css` or `design-system/`
- No model layer changes (IndexedDB schema, snapshot shapes)
- No new feature flags
- No "while I'm here" refactors

**Estimated effort:** one focused session (~similar to M4). Splits cleanly at the menu/toast boundary if interrupted between commits #2 and #3 (each half is independently shippable).

## Done criteria

- [ ] 120/120 tests pass
- [ ] Biome clean
- [ ] All E2E checkpoints green (see Testing strategy)
- [ ] Zero console errors during E2E
- [ ] All s2/s3/M5 invariants preserved
- [ ] Memory log entry summarizing what shipped
- [ ] Tree clean (no uncommitted work)

## Post-bundle next steps (for context, not in this bundle)

1. **Inline task rename** — mechanical third application of the rename pattern (section → area → task). ~1 session. Release blocker.
2. **M6 cross-section task moves** — brainstorm + 4-lens stress-test + plan + execute. ~2 sessions. Release blocker.
3. **v0.1.0 tag** — README pass, screenshot, ship.

Drag-to-reorder, task date edit, global shortcuts → v0.2.
