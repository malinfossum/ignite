# Ignite v3 — Focus, capture routing, and scheduling

**Date:** 2026-08-11
**Status:** design agreed · stress-tested 2026-08-11 (11 findings folded in)
**Supersedes:** nothing. Extends `2026-08-10-ignite-v2-design.md`.
**Delivered as:** one spec, three implementation plans (see *Staging*).

---

## 1. The problem

Capture is hardcoded. [`controller.js:750`](../../../src/controller.js) reads:

```js
capture = createCaptureView(captureRoot, {
    onSubmit: (title) =>
        tasks.create({ sectionId: FOCUS_DEFAULT_SECTION_ID, title, starred: true }),
});
```

Two defects fall out of that one line.

**A task can never be filed into an area.** The capture bar is visible on area routes (the M3 amendment recorded at `main.css:505`), so on an area page it presents an input that silently writes somewhere else. This is the user-facing blocker.

**The star carries no signal.** Every captured task is starred, so Today's *Starred* group is just "everything I have ever typed."

Underneath both sits a structural problem. **Today and Focus are two surfaces doing one job.** Today is a computed lens over every task in the app — `buildState` loads `tasks.list()` unfiltered and `groupTasksForToday` applies no area filter. Focus is the container capture writes into. Because the user stands on Today while capture writes to Focus, the app stars each new task purely to drag it into view. **The auto-star is a workaround for the split, not a design decision.**

That is why removing the star alone would make things worse: capture on Today would drop the task into a container the user cannot see.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Today and Focus merge** into one landing surface called Focus | They describe the same thing: a quick-capture notepad plus the day's agenda |
| D2 | **Capture never stars** | A date says *when*; a star says *now, no date needed*. Auto-starring destroys that signal |
| D3 | **Focus, Starred, Today and Tomorrow become tabs** | Four addressable views, each with one meaning, and the counts land on the tabs |
| D4 | On Focus, the capture bar shows an informational **destination chip** | Focus has one destination; there is nothing to choose |
| D5 | In any other area, submitting capture opens a **section picker** every time there is a choice to make | An area has several sections and no safe default. A wrong default is worse than a prompt. An area with one section has no choice, so it is written directly |
| D6 | Every section gets a persistent **inline add row** | Bulk entry must not go through the picker N times |
| D7 | Focus rows carry a one-tap **File** button | Things rot in an inbox when moving them out costs more than leaving them |
| D8 | Tasks gain a **real due date and time**, editable on any task | The agenda is worthless without it — see §6 |
| D9 | The capture bar stays **phone-bottom / desktop-top** | Already true; no work. Recorded so it is not "fixed" by accident |

---

## 3. The Focus surface

Route `#/` remains the landing route; `route.name` changes `"today"` → `"focus"`.
`#/area/focus` **redirects to `#/`** so a bookmark or the back button cannot land on a dead duplicate.

### 3.1 Page chrome

Above the tabs, and outside any tab:

- **Heading** — `<h1>Focus</h1>`.
- **Greeting** — the weekday and date, e.g. `Tuesday 11 August`.
- **Summary line** — `1 overdue · 3 due today`, the overdue count emphasised.

`renderPageHeader` ([`controller.js:118`](../../../src/controller.js)) remains **the only `<h1>` emitter in the app** (v2 invariant).

**The `<h1>` stays "Focus" — the date does NOT become the heading.** A heading names where you are; a screen-reader user navigating by heading needs "Focus", not "Tuesday 11 August", and a date-as-heading also makes every day a different landmark. The greeting and summary render beneath it as a `<p>`. Style the `<h1>` small, or `.visually-hidden`, if it competes with the greeting visually — but it exists and it says Focus.

### 3.2 Tabs

| Tab | Contents | Sort |
|---|---|---|
| **Today** | "Next up" hero, then Overdue, then due today | time ascending; untimed last |
| **Tomorrow** | due tomorrow | time ascending; untimed last |
| **Starred** | undated **and** starred, any area | `order` — see note |
| **Focus** | the notepad — Focus-area tasks that are undated and unstarred | **newest first** |

Each tab shows a count. `Focus 12` is the growth signal — no nag text, no age-shaming.

**Precedence is a cascade, matching the existing `groupTasksForToday` shape: a date beats a star, a star beats the notepad.** A useful consequence: starring a note *promotes* it out of the notepad into Starred, which is a second way to pull something into the day without filing it.

An undated, unstarred task in another area appears on none of these tabs. That is deliberate — it lives in its area.

**Completed tasks appear in no tab, including the notepad.** `groupTasksForToday` already skips them; the new notepad bucket must too, or the notepad silently fills with finished items. (A recurring task never persists `completed: true` — it advances — so it always remains visible.)

#### Overdue is deliberately day-granular

`groupTasksForToday` buckets on `startOfDay` boundaries, so a task due 07:30 today stays in **Today** all day and never moves to Overdue. Once §6 gives tasks real times, that means the row can read `was 09:30` while its group still says Today.

**This is a deliberate choice, not an oversight.** A missed 07:30 is still today's business, and time-based demotion would reshuffle the list continuously through the day — noise, in a surface whose whole job is calm. **Overdue means "a previous day."** The row's `was 09:30` carries the missed-time signal instead. Do not "fix" this later without re-deciding it.

#### Empty states

Each tab needs one; an empty surface with no message is indistinguishable from a broken render.

| Tab | Empty state |
|---|---|
| **Today** | "Nothing due today." Positive, not an error |
| **Tomorrow** | "Nothing scheduled for tomorrow." Positive |
| **Starred** | Explains what the star is for — "Star a task to pull it into your day" |
| **Focus** | Points at the capture bar. This is the state a new user starts in |

> **Inherited wart, carried unchanged:** the Starred tab sorts on `order`, which today's code also does (`starred.sort((a, b) => a.order - b.order)`). `order` is only meaningful *within* a section, so sorting a cross-area list by it produces an arbitrary sequence. It is left as-is here so this spec changes one thing at a time; if the Starred tab feels randomly ordered in use, that is the cause and it deserves its own fix.

### 3.3 Tab state

Tab selection is **controller-owned transient state**, not a model field — the same call as `drawerOpen` and `repeatEditorTaskId`. **It always resets to Today on mount**, and leaving Focus for an area destroys the view, so returning always lands on Today too. Opening the app is a here-and-now moment; Tomorrow is a deliberate check, never a landing state.

**Switching tab is a lifecycle event, not just a re-render.** Changing tab rewrites the content region, which detaches whatever was in it. Without a rule, an open ⋯ menu's button vanishes and focus falls to `<body>` — the exact failure the cascade-focus drain exists to prevent — and a live rename loses its `pendingRenameValue` mid-edit. So, in order:

1. Close any open task menu.
2. Resolve any live rename — **commit it**, matching Enter, rather than discarding the user's typing.
3. Render the new tab.
4. Move focus to the newly-selected tab button.

### 3.4 Capture feedback

Because capture writes to the Focus tab while the user is usually on Today, the task lands out of sight. Two signals close that gap, both reusing machinery that already exists:

1. A toast: `Added to Focus` with a **View** action that switches tabs.
2. The Focus tab count increments.

---

## 4. Capture routing

### 4.1 On Focus

The bar renders an informational chip reading `→ Focus`. Submitting writes to `FOCUS_DEFAULT_SECTION_ID`, **unstarred**.

### 4.2 In any other area

Submitting opens a **section picker**. Choosing a section writes the task there. The picker asks every time — there is no remembered default.

Implementation notes:

- Reuse the `move-picker.js` list machinery rather than inventing a second picker. It already carries the `role="menu"` / `role="menuitem"` a11y treatment.
- It is a **menu, not a modal dialog.** The recurrence dialog's `inert`-on-four-roots treatment is too heavy here; capture must stay a flow.
- An area with exactly one section skips the picker and writes straight to it — mirrors the existing "omit *Move to…* when `sections.length <= 1`" rule.
- **Escape section names through `escapeHtml`**, and carry the target id in `data-target-section-id` rather than interpolating it. Section names are user-authored and this is a new render path; the M6 move-picker already does exactly this, and the discipline must not be lost in the copy.

#### The focus contract

Unspecified focus is how keyboard users get stranded, so all four transitions are named:

| Event | Focus goes to |
|---|---|
| Picker opens | the **first section item** |
| A section is chosen | back to the capture input, now empty |
| Escape | back to the capture input, **text intact** |
| Outside click | back to the capture input, **text intact** |

The input carries `aria-haspopup="menu"` and `aria-expanded`, so the menu is discoverable rather than something you have to guess is there.

#### The typed text must survive dismissal

The picker is not modal, so nothing prevents a route change, a drawer open, or a sidebar click while it is open. The title exists only in the input and the pending-submit closure, and both die with the view.

**`onHashChange` and `destroy()` must both close the picker and leave the typed text in the input** — never discard it. For most apps losing uncommitted input is ordinary; for an app whose stated purpose is catching a thought before it evaporates, it is the signature failure.

### 4.3 The capture view must not be re-rendered

`capture.js` currently mounts once and never re-renders, deliberately: *"preserves the input cursor across model notifies and route changes."*

**Adding the chip must not break this.** The chip updates through a targeted `textContent` write on its own element. Any `innerHTML` rewrite of the capture root would destroy the cursor position on every model notify — the exact failure the caret-restore invariants exist to prevent elsewhere.

### 4.4 Inline add per section

Each section renders a persistent add row at its end. Enter commits and **keeps the row focused and open** so several tasks can be entered in a run. This is what makes the every-time picker tolerable: bulk entry never touches it.

The IME guard (`if (event.isComposing) return;`) applies, matching the three existing rename Enter handlers.

**Each add row needs a distinct accessible name:** `aria-label="Add task to {section name}"`, escaped. Four sections rendering four identically-labelled inputs gives a screen-reader user four indistinguishable "Add task" fields and turns forms-mode navigation into guesswork.

---

## 5. Filing out of Focus

Every notepad row carries a **File** button that opens the section list directly — one tap, not two levels inside the ⋯ menu.

- The button's accessible name is **`aria-label="File {task title}"`** (escaped). A column of buttons all named "File" is unusable by voice or screen reader.
- The picker it opens follows §4.2's focus contract and escaping rules — same machinery, same guarantees.
- Filing raises the **existing move undo toast**. M6's *Move to…* already does; a silent File would read as that undo having been removed.
- Writes through the existing `tasks.moveToSection`, which appends at `max(order) + 1`. That deliberately never reorders peers, keeping clear of the M4 `!completed` reorder invariant.
- **The drain applies.** Filing removes the row from the current view, so focus must be routed:

```js
await tasks.moveToSection(id, targetSectionId);
await applyState();            // drain the in-flight notify-render
currentMainView?.focusAfterFile?.(nextId);
await applyState();            // now this one is genuinely last
```

  Without the drain the queued render consumes the flag and the *next* render's rewrite detaches the button, dropping focus to `<body>`. This is proven behaviour, not a precaution — see the *Cascade focus routing* invariants.

---

## 6. Scheduling — date and time

**This is the part the current app cannot do, and the agenda is empty without it.**

Findings from the code:

- `formatTimeLabel` ([`time.js:46`](../../../src/utils/time.js)) is already complete and renders `12:00`, `in 40 min`, `was 09:30`, `Tomorrow 14:00`, `Aug 21 · 09:00`. It already satisfies "show the date alongside the time in other areas".
- The **only** writer of `dueAt` is `onSaveRecurrence` ([`controller.js:678`](../../../src/controller.js)), and `buildDueAt()` stores **local midnight** (`recurrence-dialog.js:268`; confirmed by the comment at `time.js:73`).
- **A one-off task cannot be given a date at all.** "Task date edit" is an existing backlog item.

### 6.1 Model change

Add one field: **`hasTime`** (boolean).

- Persisted through the existing `BOOL_FIELDS` 0/1 conversion — `tasks.js` already does this for `completed`, `starred`, `critical`.
- **No DB version bump.** It is a new, non-indexed field; the same precedent as the recurring-tasks fields.
- Renders `formatTimeLabel` when true, `formatOccurrenceLabel` (date only) when false. This is what distinguishes "no time set" from "due at 00:00" — without it they are indistinguishable.

### 6.2 Sorting

Within a day, timed tasks sort ascending by time; **untimed tasks sort after all timed ones.** An untimed task means "sometime today", not "00:00", and must not squat at the top of the day.

**Tie-break for untimed peers: `createdAt` ascending** (oldest first), so the order is stable across renders and doesn't shuffle as unrelated tasks change. Ties must be documented rather than left to sort stability, which is engine behaviour, not a guarantee.

### 6.3 Editor

The task ⋯ menu's *Repeat…* becomes **Schedule…**, opening the existing dialog with date and time at the top and repeat as an optional section beneath it. Repeat is a property of a schedule, so one surface owning "when is this due" is the honest structure.

> **Risk, stated plainly:** `recurrence-dialog.js` is one of the most heavily-invarianted files in the repo — validation gating Save, the date being the single source for monthly/yearly, chips for weekly, the backdrop-click rule, the focus-return protocol via `pendingFocusTaskId`. Extending it is the right design and the highest-risk task in this spec. Every existing invariant must be re-verified after the change, not assumed.

---

## 7. Layout

Chosen direction: **wide rows with richer rows** (option D2 in the visual session).

- **Phone (baseline)** — outer padding tightened; area badge and time column drop out; capture bar pinned to the bottom, as today.
- **≥768px** — rows run near-full width; the recovered width shows the **area badge** and the **time** per row instead of stretching whitespace; capture bar at the top, as today.

Mobile-first throughout: baseline styles target the phone, `min-width` queries layer up. No `max-width` queries.

**The alignment is the work.** The badge and time columns must stay strictly aligned across every group, or the result reads as a cheap task app rather than a considered one.

**The area badge renders a user-authored area name and must pass through `escapeHtml`.** This is a new interpolation site — the Today view has never rendered area names before — and it is the kind of place escaping gets forgotten because everything around it is static markup.

Two v2 CSS invariants continue to apply and must not be reintroduced as bugs:

- **Never put `overflow` on `.group__list` or `.group`** — the task ⋯ menu injects inside the `<li>`, so any clipping ancestor cuts it off.
- `.task` is a flex row, so `.task__title` keeps `flex: 1; min-width: 0` or the ellipsis never engages.

---

## 8. Accessibility

- Tabs use `role="tablist"` / `role="tab"` / `aria-selected`, with **roving tabindex and arrow-key traversal** via the existing `menu-keyboard.js` — the same treatment the icon picker uses, and for the same reason: a tab strip must not add four tab stops to a keyboard-first flow.
- The section picker keeps the `role="menu"` / `role="menuitem"` treatment and `tabindex="-1"` on every item, per the existing menu invariants.
- The capture bar sits **before** the main content in the DOM while rendering visually at the bottom on phones. Keyboard focus therefore reaches capture before the list. This is defensible for a capture-first app and is already today's behaviour — it is recorded here as a deliberate choice rather than left as an accident.
- The greeting and summary must not be the only route to the overdue count; the Overdue group keeps its own heading and count.

### 8.1 Touch targets

**≥44×44 px for every new control:** each tab, the File button, the inline add row, and the destination chip. The project already holds this line in the recurrence dialog; it was never written down for new work.

The tab strip is the tightest spot in the design — four tabs at 44px on a 375px screen. **If they do not fit, the strip scrolls horizontally. The targets do not shrink.**

### 8.2 Colour and motion

- v2 shipped axe-clean with **zero contrast violations**, and this spec must hold that line rather than quietly spend it.
- **Tab counts and area badges use real token colours, never `opacity`.** Faded small text is the classic contrast failure — opacity compounds against whatever is behind it, so a value that passes on one surface fails on another.
- Any tab transition is gated on `prefers-reduced-motion`, matching the recurrence dialog's slide-in.

---

## 9. Testing

Per project convention, **TDD applies to the pure-function seam only.** Views and the controller have no unit coverage by design and are verified in the browser.

New or changed pure functions, all in `utils/`:

| Function | Contract |
|---|---|
| `groupTasksForFocus(tasks, now)` | replaces `groupTasksForToday`; returns the four tab buckets with the date → star → notepad cascade |
| `sortByDueThenUntimed(tasks)` | timed ascending, untimed last |
| `formatDayGreeting(now)` | `Tuesday 11 August` |
| `summariseDay(groups)` | overdue and due-today counts |
| `areaForTask(task, sections, areas)` | resolves the area badge |

Existing `formatTimeLabel` and `formatOccurrenceLabel` gain `hasTime` coverage.

Browser verification is required for: capture on Focus, capture in a multi-section area, capture in a single-section area, the inline add run, filing out of Focus and where focus lands, tab switching by keyboard, and the ≥768px column alignment.

Plus, specifically because the stress test found them undefined:

- Dismissing the picker by **route change** and by **outside click** — the typed text must still be in the input both times.
- **Escape** out of the picker — text intact, focus back on the input.
- **Switching tab mid-rename** — the rename commits, focus lands on the new tab, nothing reaches `<body>`.
- **Switching tab with a ⋯ menu open** — menu closes, focus lands on the new tab.
- All four **empty states**.
- Tab strip at **375px** — targets still ≥44px, strip scrolls if needed.

---

## 10. Staging

One spec, three plans. Each is independently useful and independently verifiable.

**Plan 1 — Capture routing.** D2, D4, D5, D6, D7. No visual redesign. Clears the daily blocker.

**Plan 2 — Scheduling.** D8 and all of §6. Makes dates real, verifiable on the existing area views before any new surface depends on them.

**Plan 3 — The Focus surface.** D1, D3, §3, §7. Lands last, with real data to display.

---

## 11. Deferred

- **Calendar tab** — a month view; pressing a date shows that date's tasks. The tab bar in §3.2 is exactly the structure to hang a fifth tab on, so this stays cheap to add later. Explicitly out of scope here.
- **Sidebar rail rethink**, including the two pre-existing collapsed-rail a11y bugs. The Focus merge removes one row from the rail as a side effect, but the rail is its own piece of work.
- **Branding** — logo, banner, identity.
- **Emoji sets** — expanding beyond the curated 24.
- `onCycleTheme` double-click race; custom install prompt; drag-to-reorder.

---

## 12. Assumptions carried into implementation

1. **"Newest on top" applies to the Focus notepad; the dated tabs sort by time ascending.** The two readings pull opposite ways and this one was inferred, not confirmed. If wrong, §3.2's sort column changes and nothing else does.
2. The notepad's newest-first order is achieved by sorting on `createdAt` **in the view**. `order` semantics are left alone, because the M4 reorder invariants depend on them.
3. Existing Ignite data is throwaway; **no unstar migration is written**.
4. Focus keeps exactly one section (`focus-default`). The merged surface renders its tasks flat, with no section heading and no "add section" affordance. Tasks in any extra Focus sections created previously still appear in the notepad; nothing is orphaned.

---

## 13. Accepted limitations

Looked at during the stress test and deliberately **not** fixed. Recorded so they are decisions rather than oversights.

- **Tabs are not in the URL.** A tab cannot be linked or bookmarked, and Back does not walk backwards through tabs. Deliberate: the app must always open on Today, and tab history would fight that.
- **Area names are visible on the landing screen** via the badge at ≥768px. A mild exposure — but titles reveal more than area names, and badges already drop on phones. Revisit only if Ignite ever gains sharing.
- **Two open windows drift apart.** IndexedDB writes in one PWA window do not notify the other. Pre-existing, unchanged here.
- **Starred's cross-area `order` sort is arbitrary** — see §3.2. Left alone so this spec changes one thing at a time.
- **Hard reload mid-capture loses the typed text.** Route changes and outside clicks are handled (§4.2); surviving a reload would mean persisting draft input, which is a bigger idea than it looks and is not in scope.

### Verified during the stress test — no fix needed

- **The recurrence engine already preserves time-of-day.** `nextMonth` and `nextYear` explicitly carry `getHours/getMinutes/getSeconds/getMilliseconds`, and `addDays` clones the Date. §6 does not need to touch the engine, which makes Plan 2 smaller than it first appears.
- **`hasTime` needs no migration.** Existing rows lack the field, `fromStorage` yields `false`, and the next write persists `0`. Safe by construction.
