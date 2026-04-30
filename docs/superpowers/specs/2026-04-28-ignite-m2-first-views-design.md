# Ignite M2 — First Views (Design Spec)

**Status:** Design locked 2026-04-28. Ready for implementation planning.

**Parent spec:** [`2026-04-20-ignite-design.md`](./2026-04-20-ignite-design.md)
**Predecessor:** M1 — data layer (shipped 2026-04-26, head `aa334bc`; CSS-only commits since: `a50eb0a`, `209187a`).

---

## Context

M1 delivered the data layer end-to-end: `db.js`, all four model factories
(`tasks`, `areas`, `sections`, `settings`), pure recurrence math, the Focus-area
seed, and a working app shell with mobile-first CSS. 44/44 tests passing,
Biome clean, real IndexedDB verified in browser.

M2 turns that data layer into something Malin can actually use. By the end of
M2 she can open the app, see her tasks, capture new ones, check them off,
star them, delete them with undo, and collapse the sidebar — on phone or
desktop.

**Scope correction vs parent spec:** the parent's milestone sketch lumps
"Today view + capture bar" into M2 and "Area view + sections" into M3. This
spec confirms that split. M2 stays narrow — Today only — so the routing
scaffold, view lifecycle, capture bar, and shared task row all get exercised
on a single view before Area view stresses them in M3.

---

## Scope

### In M2
- Hash router scaffold (`#today` only wired; `#area/:id` deferred to M3)
- Sidebar view (areas list with active-task counts)
- Capture bar (title-only, Enter creates undated starred task in Focus)
- Today view (NEXT card + Overdue/Today/Starred groups)
- Shared task row (`renderTaskRow`) used by Today now, Area in M3
- Per-row controls: check, star, delete (via `…` menu)
- Undo toast for delete (5s window)
- Collapsible sidebar (Claude Desktop pattern)
- 60-second clock tick on the current main view
- Pure-function tests for time/grouping logic

### Deferred to M3+
- Area view, section H2 blocks, per-section add
- `+ New area` button, Settings link in sidebar
- Inline rename, date picker, move-to-area on task rows
- Reminder scheduling, Service Worker, PWA polish
- 12-hour time format setting (groundwork present, no UI)
- Critical-task glyph (visual marker only — deferred to M6 when quiet hours land)

---

## Architecture

### File layout — what M2 adds

```
src/
├── controller.js         # NEW — wires models + views, owns clock tick
├── views/
│   ├── sidebar.js        # NEW — areas list + collapse toggle
│   ├── capture.js        # NEW — quick-capture bar
│   ├── task.js           # NEW — renderTaskRow(task) string template
│   ├── today.js          # NEW — NEXT card + three groups
│   └── toast.js          # NEW — undo toast for delete
└── utils/
    ├── dom.js            # NEW — bindActions(rootEl, actionMap) only
    └── time.js           # NEW — pure: pickNextTask, groupTasksForToday, formatTimeLabel

tests/
└── utils/
    └── time.test.js      # NEW — ~12-15 tests
```

**Modified:** `src/app.js` (wires the controller; removes the M1 sanity log
and `window.ignite` DevTools handle — both are explicitly marked "drop in M2"
in the M1 source). `main.css` gains styles for sidebar item, capture bar,
NEXT card, task row, `…` menu, empty states, and collapsed-sidebar state.

**Modified models** (small additions, no migrations):
- `src/model/areas.js` — extend `ensureFocus` to also seed a default section
  for Focus on first boot (see [Focus default section](#focus-default-section)
  below). Idempotent — same pattern as the area seed.
- `src/model/settings.js` — add `sidebarCollapsed: false` to `DEFAULTS`. New
  thin mutator `setSidebarCollapsed(value)` that wraps existing `update`.
  Reads tolerate missing field (`settings.sidebarCollapsed ?? false`) so
  records seeded under M1 keep working without a migration.
- `src/model/tasks.js` — new mutator `restore(taskData)` that re-inserts a
  previously-deleted task with its original `id` intact. Bypasses `create()`
  (which always generates a new uuid). Implementation: a direct `db.put`
  with `toStorage(taskData)` then `notify()`. Used by the undo toast.

**Untouched:** `base.css`, `src/model/db.js`, `src/model/sections.js`,
`src/model/recurrence.js`, `src/utils/id.js`, `src/main.js`, `index.html`.

### Focus default section

`tasks.create()` requires a `sectionId`. The M1 seed creates the Focus area
but no section inside it, so the capture bar would have nowhere to put a new
task. M2 closes this gap by extending Focus's idempotent seed with a default
section.

- Constant `FOCUS_DEFAULT_SECTION_ID = "focus-default"` (stable id, like
  `"focus"` for the area).
- On first boot, `ensureFocus` checks for that section and creates it if
  missing. Name: `""` (empty) — invisible in M2 since Today view doesn't
  render section headings; M3 can rename or relabel when Area view ships.
- `areas.js` exports `FOCUS_DEFAULT_SECTION_ID` for the capture bar / view
  layer to import without a database round-trip.

### Pure-function seam

The TDD seam in M2 is `src/utils/time.js`. It is split out from `dom.js` so
the test surface is visible from the file tree alone. All exports are pure
(no DOM, no Date.now, no globals) — `now` is always a parameter.

```js
// src/utils/time.js — exported
pickNextTask(tasks, now) → task | null
groupTasksForToday(tasks, now) → { overdue, today, starred }
formatTimeLabel(dueAt, now, format = "24h") → string

// private helpers, covered implicitly through the three exports
isOverdue(task, now)
isToday(task, now)
// date-window math
```

### MVC layering reminder

| Layer | M2 files | What lives here |
|---|---|---|
| Model | `src/model/*` (unchanged from M1) | State, persistence, subscribe/notify |
| View | `src/views/*`, `renderTaskRow`, `formatTimeLabel` use | Pure templates → string HTML; `data-action` attrs; no logic |
| Controller | `src/controller.js`, `bindActions` use | Event wiring, hash routing, clock tick, model→view orchestration |

Models stay completely unaware that views exist. Views never touch models
directly. Controller is the only place that reads model state and tells views
what to render.

---

## Routing & view lifecycle

### Hash routing

```js
// src/controller.js
parseHash("")           → { name: "today" }
parseHash("#today")     → { name: "today" }
parseHash("#area/abc")  → { name: "area", id: "abc" }   // recognized, no view in M2
parseHash("#anything")  → { name: "today" }             // unknown → fallback
```

`#area/:id` is parsed but unhandled in M2 — the controller falls back to
Today. M3 wires the matching view without router refactor.

### View contract

Every view file exports a factory:

```js
createXView(rootEl) → { render(state), destroy() }
```

- `render(state)` does a full `rootEl.innerHTML = template(state)`. No diffing.
- `destroy()` clears event listeners and innerHTML. Always called before
  unmounting or replacing.

### Controller start sequence

```
1. Mount sidebar in <aside>                          (always-on, never unmounts)
2. Mount capture view in <main> child #capture-root  (always-on inside <main>)
3. Subscribe to all model notifies → re-render sidebar + currentMainView
4. Read window.location.hash → parseHash → mount matching main view
5. addEventListener("hashchange", ...) → currentMainView.destroy(); mount new
6. Start setInterval(tick, 60_000) — calls currentMainView.render(state) only
```

`controller.stop()` clears the interval, calls `destroy()` on sidebar, capture,
and current main view. (Used by tests/teardown later; M2 ships `start()`
called once from `app.js`.)

### Capture-bar-as-sibling pattern

Capture lives in its own DOM root, separate from Today:

```html
<main>
  <section class="capture" id="capture-root"></section>
  <section class="today"   id="today-root"></section>
</main>
```

Today re-renders only `#today-root`. Typing in the capture input survives
state notifications, route changes, and the 60s tick.

---

## Sidebar view

### Behavior

- Always mounted in `<aside>`. Never unmounts in M2 or later.
- Same template renders both visual states (expanded/collapsed); CSS does the
  visual swap via a `is-sidebar-collapsed` class on `<body>`.
- Active-route highlight wired but visually inert in M2 — only one route
  exists. Lights up in M3 when Focus becomes a clickable route.

### Contents (M2)

- Toggle button at top of `<aside>`, `data-action="toggle-sidebar"`. Always
  rendered. Hidden on mobile via CSS.
- Areas list: Focus + active-task count. No "Today" entry (Today is the
  implicit default route). No `+ New area` button. No Settings link.

**Active-task count** (tasks reference `sectionId`, not `areaId`, so the
count joins through sections):

```js
const focusSectionIds = new Set(
  state.sections.filter(s => s.areaId === "focus").map(s => s.id)
);
const count = state.tasks
  .filter(t => focusSectionIds.has(t.sectionId) && !t.completed)
  .length;
```

The controller assembles `state` for views by reading current snapshots from
each model: `{ areas, sections, tasks, settings }`. View renders are pure
over this state.

### Collapsible sidebar (Claude Desktop pattern)

- New `settings` field: `sidebarCollapsed: boolean`, default `false`. **No DB
  migration** — IndexedDB stores records as plain objects, so the field just
  appears on the next read.
- New mutator: `settings.setSidebarCollapsed(value)`.
- Two visual states:
  - Expanded — full sidebar (~240px width, set in CSS as `--sidebar-width`).
  - Collapsed — icon rail (~48px, set as `--sidebar-rail-width`), toggle
    button still visible, areas list hidden or icon-only.
- Implementation:
  - Controller subscribes to `settings` notify → adds/removes
    `is-sidebar-collapsed` on `<body>`.
  - CSS swaps `grid-template-columns` between `var(--sidebar-width) 1fr` and
    `var(--sidebar-rail-width) 1fr`.
  - Optional `transition: grid-template-columns 200ms ease`.
- **Mobile (`<768px`):** collapse is a no-op visually. Toggle button hidden via
  `@media (min-width: 768px)`. Sidebar stays in stacked-above-main form.

---

## Today view & capture bar

### DOM structure

```html
<section class="capture" id="capture-root">
  <input type="text" placeholder="What's next?" data-action="capture-submit" />
</section>

<section class="today" id="today-root">
  <!-- NEXT card (one task, big visual weight) -->
  <article class="next-card" data-id="...">
    <h2>NEXT</h2>
    <!-- renderTaskRow output, scaled up -->
  </article>

  <!-- Overdue group: hidden when empty -->
  <section class="group group--overdue">
    <h3>Overdue (<count>)</h3>
    <ul><!-- task rows --></ul>
  </section>

  <!-- Today group: hidden when empty -->
  <section class="group group--today">
    <h3>Today (<count>)</h3>
    <ul><!-- task rows --></ul>
  </section>

  <!-- Starred group: hidden when empty -->
  <section class="group group--starred">
    <h3>Starred</h3>
    <ul><!-- task rows --></ul>
  </section>

  <!-- Empty state when ALL groups are empty AND NEXT is empty -->
  <p class="empty">You're clear. Nice.</p>
</section>
```

### NEXT card priority

Returned by `pickNextTask(tasks, now)`:

1. **Earliest upcoming time-dated task** (dueAt > now, ordered ascending)
2. **Oldest overdue** (dueAt ≤ now, ordered ascending)
3. **First starred undated** by `order` field
4. **Empty** → null → "You're clear. Nice." empty-state

> Reasoning: NEXT means *what's next to do* (forward momentum), not *what's
> most behind* (shame spiral). Overdue still appears in its own group below.

The NEXT task is excluded from the groups below to avoid duplication.

### Group filtering

`groupTasksForToday(tasks, now)` returns three arrays. Caller filters out
the NEXT task before rendering each group.

Predicates (all groups exclude `completed === true`):

- **Overdue:** `dueAt < startOfToday(now)` — strictly *prior days*. A task
  due today at 09:00 when it's currently 14:00 is **not** overdue; it stays
  in Today with a `was 09:00` label. Reasoning: keep same-day past-due
  tasks visible where the user expects them; reserve "Overdue" for
  multi-day-late items so it actually means something.
- **Today:** `dueAt` falls inside `[startOfToday, endOfToday]`, sorted by
  `dueAt` ascending.
- **Starred:** `starred === true` AND `dueAt == null`, sorted by `order`
  ascending.

Empty groups hide their entire `<section>` (heading included).

### Capture bar

- Title-only input. Enter submits.
- On submit: create task via `tasks.create({ sectionId: FOCUS_DEFAULT_SECTION_ID,
  title, starred: true })`. Other fields default per `tasks.create` defaults
  (`dueAt: null`, `recurrence: null`, `critical: false`, etc.).
- Default-starred makes the captured task land in Today's Starred group, so
  it's visible immediately. (Without this, undated tasks would vanish into
  the Area view, which doesn't exist yet.)
- No date parsing. No inline form. No tagging.
- Empty / whitespace-only input is ignored.
- Input keeps focus and clears on successful submit.

### Time labels

`formatTimeLabel(dueAt, now, format = "24h")` returns one of seven buckets:

| Bucket | Example output |
|---|---|
| Just now (within 1 min) | `now` |
| < 1 hour from now | `in 45 min` |
| Today, future | `14:30` |
| Today, past (overdue) | `was 09:00` |
| Tomorrow | `Tomorrow 09:00` |
| Within next 7 days | `Fri 09:00` |
| Beyond 7 days | `Apr 30 · 09:00` |

24-hour format hardcoded for M2. The `format` arg exists so 12h-as-setting is
a one-liner once Settings ships in M3+ (deferred per Q5 — no Settings link
in M2).

---

## Task row + `…` menu

### Shared template

`src/views/task.js` exports a string-returning template:

```js
renderTaskRow(task) → string
```

Output (illustrative):

```html
<li class="task" data-id="<task.id>">
  <input type="checkbox" data-action="toggle-complete" <checked?>>
  <span class="task__title"><task.title></span>
  <button data-action="toggle-star" aria-pressed="<task.starred>">★</button>
  <span class="task__recurring" hidden?>⟲</span>
  <span class="task__time-label" hidden?><formatTimeLabel(...)></span>
  <button data-action="open-menu" aria-haspopup="menu">⋯</button>
</li>
```

Used by Today now, by Area in M3, unchanged. Star button visible always
(toggleable). Recurring `⟲` glyph shown only if `task.recurrence != null`
(visual-only in M2 — recurrence rollover was already implemented in M1's pure
functions but nothing checks them off in M2 since there are no due dates).

### `…` menu

- Inline absolute-positioned dropdown anchored to the `⋯` button (option A
  from Q4). Conventional, no portal complexity.
- M2 has one menu item: **Delete**.
- Future-room for: Rename, Set date, Move to area — deferred.
- Open/close is ephemeral DOM state managed inside the Today view (M2 has
  only one menu surface). The view tracks `openMenuTaskId` in a closure;
  re-render closes any open menu (acceptable trade-off — menu is rarely open
  across a 60s tick or model write).
- Click outside menu → close. `Esc` → close.

### Delete with undo

- Click Delete → task deleted from model immediately.
- Toast appears: *"Task deleted"* with **Undo** button.
- 5-second timer; on expiry, toast dismisses.
- Undo within 5s → calls `tasks.restore(taskData)` (new mutator) which
  re-inserts the task with its original `id` and all fields preserved. The
  Today view captures the full `taskData` snapshot before calling
  `tasks.remove(id)` so the toast has everything it needs to restore.
- If a second delete happens during the toast window, the first toast
  dismisses (no queueing in M2).

### Toast view

`src/views/toast.js`:

```js
createToastView(rootEl) → { show({ message, onUndo, onDismiss }), destroy() }
```

- Single toast at a time. New `show()` replaces any existing toast.
- `destroy()` clears the timer + DOM.

---

## Clock tick + state freshness

### The tick

```js
// inside controller.start()
tickHandle = setInterval(() => {
  currentMainView?.render(state);
}, 60_000);

// inside controller.stop()
clearInterval(tickHandle);
```

- 60-second cadence is enough — labels are minute-precision. No millisecond
  precision needed.
- Sidebar is **not** ticked. Active-task counts only change on model writes,
  which already trigger sidebar re-renders via subscribe.
- On `hashchange`, old view is destroyed, new view is mounted,
  `currentMainView` ref updates. The interval keeps running — next tick hits
  the new view automatically. No restart logic.
- No tab-visibility pause in M2. Re-rendering once a minute is cheap; the
  optimization isn't worth the lifecycle complexity yet.

### What stays in views (impure, manual verification)

- DOM render via `innerHTML = template(state)`
- Event wiring via `bindActions(rootEl, actionMap)`
- Toast timer (`setTimeout` inside `createToastView`)
- Menu open/close ephemeral DOM state

These are not pure-function-tested. They're verified by the manual checklist
below.

---

## Verification plan

### Pure-function tests (`tests/utils/time.test.js`)

Roughly 12-15 tests. M2 ends with ≈ 58 tests passing.

**`pickNextTask(tasks, now)`**
- Picks earliest upcoming time-dated task
- Picks oldest overdue when no upcoming
- Picks first starred undated when no dated tasks
- Returns null on empty input

**`groupTasksForToday(tasks, now)`**
- Partitions correctly across overdue / today / starred
- Excludes completed tasks from all groups
- Returns empty arrays (not omitted keys) when groups are empty
- Sort orders within each group are correct

**`formatTimeLabel(dueAt, now, format)`**
- Each of the 7 buckets returns expected string
- 12-hour format arg flips the time portion (groundwork for future setting)

### Manual browser verification (9 steps)

1. App boots → seed loads → sidebar shows "Focus (0)", main shows empty state
2. Type into capture bar, press Enter → task appears in Today's Starred group
3. Hard reload → captured task persists
4. Click `⋯` on a task → menu opens; click Delete → task disappears, toast shows
5. Click Undo within 5s → task restored to its previous position
6. Delete again, wait 5s → toast dismisses, task stays gone
7. Click sidebar toggle → sidebar collapses to icon rail; reload → state persists
8. Resize to <768px → sidebar stacks above main, toggle button hidden
9. Set a task's `dueAt` via DevTools to 30s in the future, wait 60s →
   time-label updates on the next tick. Navigate to `#anything-else` →
   falls back to Today.

### Done-criteria

- All tests pass: `npm test`
- Biome clean: `npm run lint`
- 9 manual checks pass in real browser (Brave/Chrome on desktop + mobile
  viewport)
- No console errors. Favicon 404 still acceptable (cosmetic — fix when
  branding lands).
- Git head ≈ 10-12 atomic commits past `209187a`. One task = one commit.

---

## Open follow-ups (post-M2)

- **12-hour time format setting** — `formatTimeLabel` accepts the arg already;
  needs a Settings UI to pass a non-default value through.
- **Area view + sections** — M3. The router already parses `#area/:id`; M3 just
  adds the matching view file and updates the controller's mount table.
- **Critical-task glyph** — deferred to M6 when quiet hours land.
- **Update parent spec milestone sketch** — confirm the M2/M3 split note from
  the brainstorm. Cosmetic; non-blocking.
- **Toast queueing** — second delete during a toast window currently dismisses
  the first. Acceptable in M2; revisit if it surfaces as friction.

---

## Locked decisions reference (Q1-Q6)

| # | Question | Locked answer |
|---|---|---|
| Q1 | Test discipline for views | Pure-function TDD on view *logic* (extracted helpers); manual verification on rendering. No JSDOM in M2. |
| Q2 | Hash routing scope | Build router scaffold in M2. Only `#today` wired now; M3 adds `#area/:id` without refactor. |
| Q3 | Capture bar behavior | Title-only Enter → undated, **starred** task in Focus. No date parsing, no inline form. |
| Q4 | Task-row controls | Spec-exact (check + star + delete). No inline rename. Delete via per-row `…` menu. |
| Q5 | Sidebar M2 contents | Bare minimum: areas list (Focus + active-task count). No `+ New area` button, no Settings link. |
| Q6 | Time-label freshness | Controller owns 60s `setInterval` calling `currentMainView.render(state)`. Sidebar not ticked. Cleared on `destroy`. |
