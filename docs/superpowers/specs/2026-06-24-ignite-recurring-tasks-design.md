# Recurring tasks — design spec

**Date:** 2026-06-24
**Phase:** v0.2 (recurring tasks UI)
**Goal:** Let the user set/edit a **repeat rule** on a task (daily / weekly / monthly / yearly, each with an **"every N"** interval) through a **dialog** opened from the task ⋯ menu, and make **completing a recurring task advance it to its next occurrence** — stamping *last-done* + a count — instead of just checking it off. History is the *last-done* stamp on the task itself; there is **no Logbook view**.

This wires up machinery that already half-exists: the pure `nextOccurrence` engine (`src/model/recurrence.js`, 10 passing tests) is **never called** today, the `recurrence` + `dueAt` task fields are **persisted but have no editor**, and `task.js` already renders a decorative `⟲` badge. This milestone adds the **editor**, the **completion wiring**, an **`interval`** to the rule shape, and two history fields.

**Settled scope decisions (from brainstorm 2026-06-24):**
- **Behaviour: option C — advance in place + stamp last-done.** Completing a recurring task moves it to its next date and records *when you last did it* + *how many times*. Chosen over **A** (reschedule, no history) and **B** (spawn a new task per occurrence + a Logbook view). C delivers the part actually referenced ("when did I last do this?" — the user's manual *"Forrige kur 01.02"* habit) without B's new view.
- **Intervals included.** "Every N" for all four cadences. Required by real routines the user already runs ("meldekort hver 2. uke", quarterly tax) that the type-only engine **cannot express today**.
- **Editor = dialog/sheet** (chosen over inline-expand). A multi-field form inside the re-rendering list would re-run the inline-rename focus/caret/value-preservation dance across *four* controls; a dialog holds its own state outside the list. Reuses the mobile-drawer dialog/inert/focus patterns.
- **Entry point = task ⋯ menu** ("Repeat…"). Capture stays a fast title-only flow.
- **Date field = native `<input type="date">`, date-only.** Time-of-day is deferred (decorative until reminders exist).
- **No backlog.** Completing always schedules the *next future* occurrence — miss three days of a daily task, completing once sets the next future date, it never piles up.
- **Completion feedback = existing toast** ("Done · next Jul 6") + Undo.

**Deferred (their own milestones — most blocked on notifications, which Ignite lacks):** time-of-day, reminders, hide-until, priority levels (the app already has ⭐ + critical), duration, task score, a full browsable Logbook/history view.

---

## Approach

Five woven changes, smallest-risk first:

1. **Engine** (`recurrence.js`) — add optional `interval` (default 1) to each rule type; `nextOccurrence` honours it. **Pure-function seam → TDD.**
2. **Model** (`tasks.js`) — add `lastCompletedAt` + `completedCount`; add `completeOccurrence(id, now)` (advance via the engine, no-backlog loop). **Unit-tested.**
3. **View** (`recurrence-dialog.js`, **new**) — the editor. Controller-owned open state, render-once, reuses drawer a11y.
4. **Controller** — `handleToggleComplete` gains a recurring branch (advance + toast/undo); dialog open/save/remove wiring; new transient `repeatEditorTaskId`.
5. **Menus + badge** — "Repeat…" item in both task menus; `task.js` `⟲` badge gains a meaningful label.

**Rejected — inline-expand editor:** native-feeling and Amplenote-like, but lives *inside* the innerHTML-re-rendering list, so every model-notify / 60 s tick would wipe an in-progress multi-field form unless the rename-style focus/caret/value preservation is reproduced across all controls. High complexity for the exact pain the project already documented for single-input rename.

**Rejected — menu-submenu editor:** the rule needs cadence + interval number + weekday multi-select + a date; that does not fit a flat `role="menu"` the way the move-picker's section list did.

**Rejected — behaviour A / B:** see scope decisions above.

---

## Architecture

| Layer | Change |
|---|---|
| **Engine** (`src/model/recurrence.js`) | Add optional `interval` (default 1) to each rule. `nextOccurrence(rule, from)` returns the first occurrence **strictly after `from`**: daily → `+N` days; monthly → `+N` months (clamp to last day); yearly → `+N` years (clamp); weekly → next selected weekday spaced `N` weeks from `from` (algorithm below). Unknown type / empty `weekdays` still throw. Absent `interval` ≡ 1 → the existing 10 tests stay green. |
| **Model** (`src/model/tasks.js`) | `create()` defaults gain `lastCompletedAt: null`, `completedCount: 0`. `toStorage`/`fromStorage` pass them through (NOT in `BOOL_FIELDS`). New `async completeOccurrence(id, now = new Date())`: loads task, **requires `recurrence`** (throws `Task is not recurring: {id}` — controller guards), computes the next future occurrence (no-backlog loop), `db.put` `{ dueAt, lastCompletedAt, completedCount+1, completed:false }`, **one** `notify()`. Extend the JSDoc contract block. |
| **View — `recurrence-dialog.js`** (**new file**) | `createRecurrenceDialog(rootEl, { onSave, onRemove, onClose }) → { open(task), close(), destroy() }`. Renders backdrop + panel: cadence segmented control (radios), "every N" number input, weekday chips (weekly only), `<input type="date">`, footer (`Remove repeat` if editing an existing rule · `Cancel` · `Save`). Holds form state in its **own closure** — never re-rendered by `applyState`. Internal control focus on open; Esc + backdrop-click → `onClose`. |
| **Controller** (`src/controller.js`) | New transient `repeatEditorTaskId` (`null \| id`), owned like `drawerOpen`. `handleToggleComplete(id)` replaces both `onToggleComplete: (id) => tasks.toggleCompleted(id)` wirings. `openRecurrenceEditor(taskId)` (sets background `inert`, calls `recurrenceDialog.open(task)`), `closeRecurrenceEditor()` (clears `inert`, restores focus to the task's ⋯, `recurrenceDialog.close()`). `onSaveRecurrence` / `onRemoveRecurrence` → `tasks.update`. New constant `COMPLETE_TOAST_MS = 5_000`. Construct the dialog in `start()`, destroy in `stop()`, `closeRecurrenceEditor()` first in `stop()` and in `onHashChange` (mirrors `closeDrawer`). |
| **View — menus** (`src/views/section.js` + `src/views/area.js`, and `src/views/today.js`) | Add a **"Repeat…"** item (`data-action="open-repeat"`) to the task action menu. area menu → `[Rename, Move up?, Move down?, Move to…?, Repeat…, Delete]`; today menu → `[Rename, Move to…?, Repeat…, Delete]`. New `open-repeat` handler in each view (resets `taskMenuMode`, closes menu, calls `callbacks.onOpenRepeatEditor(t.id)`). |
| **View — `task.js`** | The `⟲` badge gains a meaningful `aria-label` (cadence + next date, e.g. `"Repeats every 2 weeks; next Jul 6"`) so it is no longer purely decorative; glyph unchanged. (Optional small visible "next" hint — see Out of scope.) |
| **Bootstrap** (`src/app.js`) | Append `<div id="repeat-dialog-root">` to `body` (mirrors `toastRoot`); pass `repeatDialogRoot` in `els`. |
| **CSS** (`src/styles/main.css`) | Backdrop + panel (**mobile-first bottom sheet** ≤767px, **centered dialog** ≥768px), segmented control, weekday chips (toggle, `aria-pressed`), number + date inputs, footer buttons. Reuse design-system tokens. `base.css` / `design-system/` untouched. |

---

## Engine — `interval` support

Rule shapes (interval optional, defaults to 1):

```
{ type:"daily",   interval:N }
{ type:"weekly",  interval:N, weekdays:[0–6] }   // 0 = Sunday
{ type:"monthly", interval:N, day:1–31 }          // clamps to last day of target month
{ type:"yearly",  interval:N, month:1–12, day:1–31 }
```

`nextOccurrence(rule, from)` returns the first occurrence **strictly after `from`**, preserving `from`'s time-of-day (as the current engine does):

- **daily** → `addDays(from, N)`
- **monthly** → month `+ N` from `from`, day = `min(rule.day, lastDayOfTargetMonth)`
- **yearly** → year `+ N` from `from`, day clamped in the target month
- **weekly** → next selected weekday, spaced `N` weeks (algorithm below)

**Weekly algorithm** (`from` is the anchor occurrence = the task's current `dueAt`):

```js
function nextWeekly(from, weekdays, interval = 1) {
  const sorted = [...new Set(weekdays)].sort((a, b) => a - b); // 0..6 asc
  const fromDay = from.getDay();
  const later = sorted.find((d) => d > fromDay);   // another selected day this same week?
  if (later !== undefined) return addDays(from, later - fromDay);
  // else jump `interval` weeks to the next on-week, take its first selected day
  return addDays(from, interval * 7 - fromDay + sorted[0]);
}
```

Reduces correctly to today's behaviour at `interval = 1` (the 3 existing weekly tests pass): `from=Mon, [Mon,Wed] → Wed`; `from=Fri, [Mon] → next Mon`; `from=Mon, [Mon,Wed] → Wed (never same day)`. At `interval = 2`: `from=Mon,[Mon] → Mon+14`; `from=Wed,[Mon,Wed] → Mon two weeks out (+12)`.

> **Plan flag:** the exact weekly-interval semantics (esp. multi-weekday + interval>1, and a `from` that is not itself on a selected weekday) are the highest-value TDD target. Pin every case in `recurrence.test.js` before implementing.

---

## Model — history fields + `completeOccurrence`

New fields on every task (defaulted in `create()`, passed through storage uncoerced):

```
recurrence       Rule | null     // exists — the repeat rule
dueAt            ISO  | null     // exists — the current/next occurrence date
lastCompletedAt  ISO  | null     // NEW — when last completed (null until first)
completedCount   number          // NEW — times completed (default 0)
```

```js
async completeOccurrence(id, now = new Date()) {
  const stored = await db.get("tasks", id);
  if (!stored) throw new Error(`Task not found: ${id}`);
  const task = fromStorage(stored);
  if (!task.recurrence) throw new Error(`Task is not recurring: ${id}`);

  // No-backlog: advance from the schedule, but never land in the past.
  const anchor = task.dueAt ? new Date(task.dueAt) : now;
  let next = nextOccurrence(task.recurrence, anchor);
  while (next <= now) next = nextOccurrence(task.recurrence, next);

  const updated = {
    ...task,
    dueAt: next.toISOString(),
    lastCompletedAt: now.toISOString(),
    completedCount: (task.completedCount ?? 0) + 1,
    completed: false, // a recurring task NEVER persists as completed — it advances
  };
  await db.put("tasks", toStorage(updated));
  notify();
}
```

The no-backlog `while` loop preserves the rule's phase (a monthly-on-15th task stays on the 15th, just skips to the next future 15th) and is bounded + cheap (a few iterations even for long-stale dates).

**Date storage:** the dialog builds `dueAt` from the date input as **local midnight** (`new Date(y, m-1, d).toISOString()`); the engine copies time-of-day through, so it stays midnight. The rule's `day` / `month` are **derived from that same date** (see dialog), so the date is the single source for both the anchor and the day-of-month/month-day. (Known simplification: date-only at local midnight has minor DST/timezone edge cases, acceptable for v1.)

---

## Dialog — `recurrence-dialog.js`

`createRecurrenceDialog(rootEl, { onSave, onRemove, onClose })`:

- **`open(task)`** — seed form state from `task.recurrence` + `task.dueAt` (or sensible defaults: cadence `daily`, interval `1`, weekdays = today's weekday, date = today), render the panel, focus the cadence control. Stores `task.id` + whether it was already recurring (controls the `Remove repeat` button).
- **`close()` / `destroy()`** — tear down listeners, clear `rootEl`.

**Controls (the only inputs):** cadence segmented control · "every N" number · weekday chips (**weekly only**) · date. On **Save**, the rule is *built* from these — the date supplies day-of-month / month+day:

```
daily   → { type:"daily",   interval }
weekly  → { type:"weekly",  interval, weekdays:[…selected] }
monthly → { type:"monthly", interval, day: date.getDate() }
yearly  → { type:"yearly",  interval, month: date.getMonth()+1, day: date.getDate() }
dueAt   → local-midnight ISO of the chosen date
```

`onSave({ taskId, recurrence, dueAt })`, `onRemove({ taskId })`, `onClose()`.

**Validation (Save disabled until valid):** a date is required; weekly requires ≥1 weekday; interval is an integer ≥1 (min/clamp). These mirror the rule-shape invariants so an invalid rule can never reach the engine.

**A11y / modality** — same split as the drawer (component renders + owns internal focus/Esc; **controller** owns background `inert`):
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → the panel heading `Repeat — <escaped task.title>`.
- Background `inert` is set by the controller on **exactly** `[topbarRoot, sidebarRoot, mainEl, toastRoot]` (`mainEl` covers capture + main). The dialog root + backdrop are **never** inert (backdrop must stay clickable to close). `inert` makes focus-trapping automatic — no manual trap needed (drawer precedent).
- Open → focus the cadence control. Close → controller restores focus to the task's ⋯ via DOM lookup (never a stored ref). Esc and backdrop-click both call `onClose`.
- Render-once per `open()`; **not** re-rendered by `applyState`, so a 60 s tick / model-notify under the dialog can't wipe the form (the entire reason the dialog beat inline).

---

## Completion wiring — controller

```js
async function handleToggleComplete(id) {
  const task = (await tasks.list()).find((t) => t.id === id);
  if (!task) return;                                  // race
  if (!task.recurrence || task.completed) {           // non-recurring, or un-checking
    await tasks.toggleCompleted(id);                  // existing behaviour, unchanged
    return;
  }
  const snapshot = {
    dueAt: task.dueAt,
    lastCompletedAt: task.lastCompletedAt,
    completedCount: task.completedCount,
  };
  try {
    await tasks.completeOccurrence(id);
  } catch (err) {
    if (/not found/i.test(err.message)) return;       // cascade race
    throw err;
  }
  const updated = (await tasks.list()).find((t) => t.id === id);
  toast.show({
    message: `Done · next ${formatOccurrenceLabel(updated.dueAt)}`,
    durationMs: COMPLETE_TOAST_MS,
    onUndo: async () => {
      try {
        await tasks.update(id, snapshot);             // restores date, stamp, count
      } catch (err) {
        if (/not found/i.test(err.message)) return;
        throw err;
      }
    },
  });
}
```

`formatOccurrenceLabel(dueAt)` = a short date label (e.g. `"Jul 6"`). **Plan flag:** `task.js` already calls `formatTimeLabel(task.dueAt, now)` — reuse it (or a sibling in `time.js`) for one date vocabulary across the row and the toast. Pure → TDD.

---

## Menu item — "Repeat…"

```js
"open-repeat": (event, actionEl) => {
  event.stopPropagation();
  const t = taskFromEvent(actionEl);
  if (!t) return;
  openTaskMenuId = null;          // openMenuTaskId in today.js
  taskMenuMode = "actions";       // reset (move-picker invariant)
  doRender();                     // menu closes visually (list still interactive)
  callbacks.onOpenRepeatEditor(t.id); // controller opens dialog → inert + focus
},
```

`doRender()` runs **before** the controller sets `inert`, so the menu-close re-render touches a non-inert list and no focus lands in an inert subtree (no `pendingFocus*` set here). Menu item markup mirrors the existing `task-menu__item` (role/tabindex), placed before `Delete`.

---

## Edge cases

| Scenario | Behaviour |
|---|---|
| Complete a **non-recurring** task | Unchanged — `tasks.toggleCompleted`. |
| Complete a recurring task **on schedule** | Advances by `interval`; stamps last-done + count; stays unchecked; toast "Done · next …". |
| Complete a recurring task **badly overdue** (stale `dueAt`) | No-backlog loop advances to the next **future** occurrence (phase preserved). |
| Recurring task with `dueAt = null` (defensive) | Anchor = `now`; `nextOccurrence` returns a strictly-future date. |
| Recurring task shown as completed | Never happens — recurring tasks never persist `completed:true`. (Un-checking a somehow-completed one just toggles, defensive.) |
| **Undo** a completion | Restores `{dueAt, lastCompletedAt, completedCount}`. |
| Task cascade-deleted mid-complete or mid-undo | `/not found/i` swallowed (mirrors move/rename). |
| Save a rule with **no date** | Save disabled. A recurrence always carries a `dueAt`. |
| Save a **weekly** rule with no weekday | Save disabled. |
| **Weekly** start date not on a selected weekday | First occurrence = the chosen date **as-is** (`dueAt`); subsequent advances follow the weekday set. The dialog defaults the weekday chips to the start date's weekday, so the default flow never mismatches. |
| `interval` < 1 | Clamped to 1 (min on the number input). |
| **Remove repeat** | `recurrence: null`; `dueAt` kept (task becomes a one-off with that due date). |
| Monthly from a 31st date in a short month | `day:31` clamps (Feb → 28/29) via the engine. |
| Yearly Feb 29 in a non-leap year | Clamps to Feb 28 (existing engine behaviour, now with interval). |
| Dialog open while the list re-renders (60 s tick / notify) | Dialog persists — separate root, not in `applyState`. |
| Esc / backdrop click | Closes without saving; focus returns to the task's ⋯. |
| Task cascade-deleted **while its dialog is open** | On Save, `tasks.update` throws `Task not found` → swallow + close. |
| Starred recurring task in **Today** after completion | Stays in Today (existing **star** semantics; advancing `dueAt` doesn't unstar). See Plan flags — not changed here. |
| Task title with markup (`<b>`, `"`) in the dialog heading | `escapeHtml` on the title. |
| Mobile: dialog vs capture bar / on-screen keyboard | Bottom sheet must clear the fixed capture bar; verify during CSS planning. |
| Fast double-click / double-tap a recurring checkbox | In-flight guard ignores the second trigger → advances exactly once (no skipped occurrence, `completedCount +1`). |
| Malformed rule (`interval < 1`, non-advancing) reaches the no-backlog loop | Engine coerces `interval ≥ 1` and the loop breaks on non-advance → no hang. |
| Open "Repeat…" on a task deleted between render and click | `openRecurrenceEditor` no-ops (task not found). |
| Save / Remove a rule | Focus returns to the task's ⋯ **after** the re-render (pending-focus, not a stale direct `.focus()`); a confirmation toast announces the change. |

---

## Invariants (do NOT simplify away)

1. **A recurring task NEVER persists `completed: true`.** Completion *advances* it (`completeOccurrence` sets `completed:false`). The only completed-write path for a recurring task is the defensive un-check branch.
2. **`completeOccurrence` is one `db.put` + one `notify()`**, computing the next date via the **pure engine** + the no-backlog `while (next <= now)` loop (result strictly > `now`).
3. **`interval` defaults to 1 when absent** — back-compat; the engine's existing 10 tests must stay green.
4. **A saved recurrence always carries a `dueAt`; weekly always carries ≥1 weekday.** Enforced in the dialog (Save disabled) *and* assumed by the engine. Removing a rule sets `recurrence:null` but keeps `dueAt`.
5. **The dialog is controller-owned transient state (`repeatEditorTaskId`), NOT a model field; render-once-on-open; NOT re-rendered by `applyState`.** (Mirrors `drawerOpen`.)
6. **Background `inert` on exactly `[topbarRoot, sidebarRoot, mainEl, toastRoot]` while open** (`mainEl` covers capture); dialog root + backdrop never inert. Focus into the dialog on open; restore to the task's ⋯ on close via **DOM lookup**, never a stored ref. (Mirrors the drawer.)
7. **Controller swallows `/not found/i`** from `completeOccurrence`, the completion undo, and dialog save (cascade races).
8. **The completion toast is the only completion feedback** (reuses `toast.show`, one-at-a-time); Undo restores the snapshot.
9. **"Repeat…" uses `data-action="open-repeat"`, resets `taskMenuMode="actions"`, and closes the menu (`doRender`) before the controller sets `inert`.**
10. **The date is the single source for day-of-month (monthly) and month+day (yearly); weekday chips are the single source for weekly weekdays.** No separate day/month pickers.
11. **`closeRecurrenceEditor()` runs first in `stop()` and in `onHashChange`** (route change closes the dialog), mirroring `closeDrawer`.
12. **`escapeHtml` the task title in the dialog heading.** `base.css` / `design-system/` untouched.
13. **Completion is guarded against re-entry.** The controller holds an in-flight `Set` of task ids being completed; `handleToggleComplete` ignores a call for an id already in flight and clears it in `finally`. Without this, a fast double-click advances a recurring task twice — skipping an occurrence and bumping `completedCount` by 2.
14. **Save/Remove returns focus through the view, not a direct `.focus()`.** Save/Remove triggers a model-notify re-render that replaces the task's ⋯; a direct `.focus()` in `closeRecurrenceEditor` would hit a detached node → focus-to-body. The controller calls a new `currentMainView.focusTaskMenu(taskId)` that sets a pending flag consumed in `doRender` (reusing the `pendingFocusTaskId` machinery). **Cancel/Esc** (no model change, no re-render) restore focus directly via DOM lookup. `openRecurrenceEditor` no-ops if the task is gone (deleted between menu render and click); route-change close restores focus **best-effort** (trigger may not exist on the new route).
15. **The engine guarantees strict advance.** `nextOccurrence` coerces `interval` to an integer ≥1; the no-backlog loop additionally breaks if `next` fails to advance past the previous value. Together these make the `while (next <= now)` loop non-terminating impossible (malformed / imported / dev-tools rules included). Unit-tested with `interval` 0 / negative.
16. **Saving or removing a rule shows a confirmation toast** ("Repeats every 2 weeks" / "Repeat removed") — feedback parity with delete/move/complete, and the `aria-live` toast announces the change to screen readers (the badge change alone is silent).
17. **Dialog a11y specifics:** weekday chips = visible single letter + full-day-name `aria-label`; cadence = labelled `radiogroup`; interval input + date input have explicit labels (interval's unit tracks the cadence); the "Repeat…" menu item carries `aria-haspopup="dialog"`; the `⟲` badge is `role="img"` with an `aria-label` (reliable SR exposure); chips + footer buttons meet ≥44px touch targets; the dialog enter animation is gated behind `prefers-reduced-motion`; selected/unselected control states meet AA contrast.

---

## Files touched (estimated)

| File | LOC | Note |
|---|---|---|
| `src/model/recurrence.js` | +30 | `interval` across all four types + `nextWeekly` |
| `tests/unit/recurrence.test.js` | +45 | interval cases (all cadences), weekly same-week/jump, clamp+interval, back-compat |
| `src/model/tasks.js` | +28 | `completeOccurrence` + two fields + JSDoc |
| `tests/unit/tasks.test.js` | +35 | `completeOccurrence` (~7 cases) + field defaults |
| `src/views/recurrence-dialog.js` | +160 | **new** — editor component |
| `src/controller.js` | +60 | `handleToggleComplete`, dialog open/close/save/remove, `repeatEditorTaskId`, `COMPLETE_TOAST_MS` |
| `src/views/section.js` | +6 | "Repeat…" item |
| `src/views/area.js` | +10 | `open-repeat` handler |
| `src/views/today.js` | +12 | `open-repeat` handler + "Repeat…" item |
| `src/views/task.js` | +6 | `⟲` badge `aria-label` |
| `src/app.js` | +4 | `#repeat-dialog-root` |
| `src/styles/main.css` | +95 | dialog/backdrop + controls (mobile-first) |
| **Total** | **~490** | + ~14 unit cases |

---

## Testing

### Unit (Vitest — TDD on the pure seam)

`tests/unit/recurrence.test.js` — extend:
- daily interval: every 2/3 days; preserves time-of-day; month rollover with interval.
- weekly interval: same-week next day; jump N weeks; wrap; multi-weekday + interval>1; `from` not on a selected weekday self-corrects.
- monthly interval: every 2/3 months; clamp (Jan 31 +1 → Feb 28); year rollover.
- yearly interval: every 2 years; Feb 29 clamp.
- **back-compat:** rules with no `interval` behave as `interval:1` (the existing 10 assertions unchanged).

`tests/unit/tasks.test.js` — new `describe("completeOccurrence")`:
- advances `dueAt` via the engine; stamps `lastCompletedAt`; `completedCount` +1; `completed` stays false; notifies once.
- no-backlog: stale past `dueAt` → result strictly after `now`.
- `dueAt = null` → anchors on `now`.
- throws `Task is not recurring` on a non-recurring task; `Task not found` on a missing id.
- `create()` defaults `lastCompletedAt:null`, `completedCount:0`; storage round-trip leaves them uncoerced.

### Manual / Claude Preview MCP E2E (end of phase)

- Open "Repeat…" from a task ⋯ in **area** and **Today**; set each cadence; set interval; pick weekdays (weekly); pick a date; Save → `⟲` badge appears, `dueAt` set.
- Complete a recurring task → it advances (stays unchecked, new date), toast "Done · next …", Undo restores date/stamp/count.
- Remove repeat → badge gone, `dueAt` retained.
- Validation: weekly with no weekday → Save disabled; empty date → Save disabled; interval can't go below 1.
- A11y: Esc closes; backdrop click closes; focus enters the dialog and returns to the ⋯; background is inert (Tab can't reach it); SR reads the dialog label.
- Mobile (≤767px): bottom sheet, not hidden behind the capture bar.
- No console errors throughout.

No JSDOM tests for views or the dialog — per project convention (TDD only on the pure-function seam; views verified manually).

---

## Out of scope (later milestones)

- **Time-of-day, reminders/notifications, hide-until** — blocked on a notification layer Ignite doesn't have.
- **Priority levels, duration, task score** — Amplenote extras; priority already covered by ⭐ + critical.
- **Full browsable Logbook / per-occurrence history** — option C keeps last-done + count only.
- **Changing Today's membership rule for recurring tasks** — advancing `dueAt` interacts with existing star/due semantics; revisit as a follow-up (see Plan flags), not here.
- **Setting recurrence at capture time** — capture stays title-only.
- **Advanced rules** — "last weekday of month", "every weekday", end-date / until / max-occurrences.
- **Drag, visible inline "next" hint beyond the badge label** — polish.

## Plan-phase flags (notes for the plan-writer)

- **Weekly-interval is the TDD centre of gravity** — over-cover it.
- **Reuse `formatTimeLabel` (or a `time.js` sibling)** for the toast's "next" label; confirm its output vocabulary and that date-only `dueAt` formats cleanly.
- **Verify the Today filter interaction** — does a starred recurring task stay in Today after completion? Decide whether that's acceptable for v1 (likely yes; a Today-membership change is its own follow-up). Read `today.js` membership logic during planning.
- **Confirm `inert` target list** covers capture via `mainEl` (it does in `app.js`), and that the dialog root being a `body` child sits outside all inert subtrees.
- **CSS bottom-sheet vs the fixed capture bar + on-screen keyboard** on mobile — the date input focus can raise the OSK.
- **`completeOccurrence` on a non-recurring task throws** by contract; the controller guards so it's never called — keep the throw as defence + a unit test.
- **`<input type="date">` value is `YYYY-MM-DD`** → build `new Date(y, m-1, d)` for local midnight before `toISOString()`.
- **Weekly default:** seed the weekday chips from the start date's weekday so the default flow is self-consistent. Snapping the first occurrence to a selected weekday is a deferred nicety — v1 keeps the chosen date as the first occurrence.

---

## Stress-test outcome (2026-06-24)

4-lens pass (security / privacy / accessibility / loopholes): **0 🔴, 4 🟠, 7 🟡 — all 11 folded into Invariants 13–17 + the new edge-case rows above.**

- **Security** — escaping already specified (dialog heading escapes `task.title`; `toast.js:111` escapes the message; no free-text in the dialog body). One robustness hole: the no-backlog `while` loop could hang on a non-advancing rule → engine now coerces `interval ≥ 1` + breaks on non-advance (inv. 15).
- **Privacy** ✅ — no new network calls / telemetry; `lastCompletedAt` / `completedCount` (incl. sensitive cadences like "Mensen") stay in IndexedDB, same posture as task titles today.
- **Accessibility** — 🟠 focus-to-body on Save (re-render race) → pending-focus routing via `focusTaskMenu` (inv. 14); 🟠 ambiguous weekday chip letters → full-name `aria-label`s (inv. 17). 🟡: badge `role="img"`, save/remove toast, control labels + `aria-haspopup="dialog"`, ≥44px targets, `prefers-reduced-motion`, AA contrast (inv. 16–17).
- **Loopholes** — 🟠 double-complete advances twice → in-flight guard (inv. 13). 🟡: missing-task guard on open + best-effort route-change focus (inv. 14); integer `interval` (inv. 15).

**Considered and rejected:**
- **Full Logbook / per-occurrence history** — option C keeps last-done + count by design; the browsable log is a separate milestone.
- **Undo lost when a later toast supersedes** — app-wide one-at-a-time toast pattern; a missed 5 s undo makes the advance permanent. Accepted (consistent, rare).
- **Prototype pollution via `{...task, ...patch}`** — pre-existing in `update()`; patch keys are dialog-controlled today. Revisit with import/export.
- **Timezone/DST exactness** — date-only at local midnight has edge cases; accepted for v1 (no time semantics yet).
- **Starred recurring task stays in Today after completion** — existing star semantics; a Today-membership change is its own follow-up (Out of scope + Plan flags).

## Open questions

None — ready for plan-writing.
