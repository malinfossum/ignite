# Ignite M3 — Area View + Section CRUD (Design Spec)

**Status:** Design locked 2026-05-05. Ready for implementation planning.

**Parent spec:** [`2026-04-20-ignite-design.md`](./2026-04-20-ignite-design.md)
**Predecessor:** M2 — first views (shipped 2026-05-04, head `d5d8712`).

---

## Context

M2 turned the data layer into something usable: Today view, capture bar,
sidebar, shared task row, delete-with-undo, collapsible sidebar. 67 tests
green, manual E2E walked, real IndexedDB verified.

M3 wires the second view. By the end of M3, Malin can click Focus in the
sidebar, land on a dedicated area page, organise tasks under named sections,
and shape that organisation herself — create, rename, reorder, and delete
sections, with cascade-undo when a delete eats too much.

**Scope correction vs parent spec:** the parent's milestone sketch lumps
"Area view + section management" into M3. This spec keeps M3 narrow —
**Focus only, no `+ New area`, no task moves between sections, no date
picker**. Area CRUD is M4-flavoured (it changes the sidebar surface and
deserves its own milestone). Task moves want a date picker / move-to-area
menu next to them, also M4+.

---

## Scope

### In M3

- Hash router activates `#area/:id` (M2 parsed it, M2 fell back to Today; M3 mounts a real view)
- Sidebar wordmark becomes clickable, routes to Today
- Sidebar Focus row routes to `#area/focus`; active-route highlight enabled
- New `area` view: title + sections + tasks
- Section CRUD inside Focus:
  - Create — `＋ New section` button at area bottom; create-then-rename
  - Rename — inline input replaces H2; Enter/blur commits, Esc/empty cancels
  - Delete — cascade-delete with 5s undo toast (8s for section delete; see [Accessibility](#accessibility))
  - Reorder — Move up / Move down in section menu, swap with neighbour, greyed at the ends
- Collapsible sections: clickable header row + chevron icon, state persisted via existing `section.collapsed`
- Per-section `＋ Add task` button; capture bar hidden on `#area/:id`
- `focus-default` seed section becomes undeletable; first-boot rename `""` → `"Tasks"`
- Pure-function tests for `reorderSections`
- Security: `escapeHtml` discipline applied to every interpolated user value (section names, area title, toast message, task title in `renderTaskRow`)
- Accessibility: keyboard-reachable section headers, focus management on rename, Esc closes menu, ARIA on dynamic state, 44×44 px touch targets, `aria-current="page"` on active sidebar items

### Deferred to M4+

- `+ New area` in sidebar; rename/delete user areas
- Move-task-between-sections (drag or menu)
- Date picker, time, recurrence UI on tasks
- Reminder scheduling, Service Worker, PWA polish
- Section drag-to-reorder
- Settings link in sidebar
- Full arrow-key navigation inside section menu (Tab cycling is acceptable for AA)
- Toast queueing (sequential deletes still lose the first snapshot — M2-consistent)

---

## Architecture

### File layout — what M3 adds

```
src/
├── views/
│   ├── area.js              # NEW — area title + sections + tasks
│   └── section.js           # NEW — single-section template (header, body, menu, add-task)
└── utils/
    └── sections.js          # NEW — pure: reorderSections(sections, id, direction)

tests/
└── utils/
    └── sections.test.js     # NEW — ~5 tests
```

**Modified:**

- `src/controller.js` — mount `area` view on `#area/:id`, toggle `is-area-route` body class, enable wordmark click handler
- `src/views/sidebar.js` — wordmark becomes a clickable Today entry; Focus row gets `data-action="open-area" data-id="focus"`; `aria-current="page"` reflects active route
- `src/views/task.js` (`renderTaskRow`) — audit and apply `escapeHtml` to `task.title` interpolation
- `src/views/toast.js` — extend `show()` API to accept optional `durationMs` (defaults to 5000); apply `escapeHtml` to the message string once at render time
- `src/model/sections.js` — add `setCollapsed(id, value)`, `rename(id, name)`, `swapOrder(idA, idB)`, `restore(snapshot)`, `removeMany(ids)` mutators
- `src/model/tasks.js` — add `removeMany(ids)`, `restoreMany(snapshots)` mutators (the existing `restore(snapshot)` from M2 stays as-is)
- `src/model/areas.js` — `ensureFocus` migration: if `focus-default` section name is `""`, set to `"Tasks"`. Idempotent (only renames the empty case).
- `src/utils/dom.js` — add `escapeHtml(str)` helper; add `bindKeys(rootEl, keyMap)` helper for keydown delegation
- `main.css` — section header row, chevron rotation, area title, per-section add button, empty-section state, touch-target sizes, focus-visible styling on dynamic controls
- `index.html` — `<main>` keeps `#capture-root` and gains `#main-root` (the route-swappable child); Today and Area both mount inside `#main-root`. Toast root stays outside `<main>` (see [Toast root location](#toast-root-location)).

**Untouched:** `base.css`, `src/model/db.js`, `src/model/recurrence.js`, `src/model/settings.js`, `src/utils/id.js`, `src/utils/time.js`, `src/main.js`, `src/views/today.js`, `src/views/capture.js`.

### MVC layering

| Layer | M3 files | What lives here |
|---|---|---|
| Model | `model/sections.js`, `model/tasks.js`, `model/areas.js` | New mutators (`setCollapsed`, `rename`, `swapOrder`, `restore`, `removeMany`, `restoreMany`); first-boot rename migration |
| View | `views/area.js`, `views/section.js`, `utils/sections.js` (pure), `utils/dom.js` (`escapeHtml`, `bindKeys`) | New view files; pure swap util; escape + key delegation helpers |
| Controller | `controller.js` | Route to area view; toggle `is-area-route` body class; wordmark click; focus management on rename trigger/return |

Models stay completely unaware that views exist. Views never touch models
directly. Controller is the only place that reads model state and tells views
what to render.

---

## Routing & view lifecycle

### Hash routes

```js
parseHash("")              → { name: "today" }
parseHash("#today")        → { name: "today" }
parseHash("#area/focus")   → { name: "area", id: "focus" }
parseHash("#area/abc-123") → { name: "area", id: "abc-123" }   // any user area in M4+
parseHash("#anything")     → { name: "today" }                  // unknown → fallback
```

`parseHash` is unchanged from M2.

If `#area/:id` references an area that doesn't exist in state (typo, deleted,
manual hash edit), the area view renders an empty-state: *"Area not found."*
with a link back to Today. Cheap, no router change, no error swallowed
silently.

### DOM structure — small change to `<main>`

```html
<main>
  <section class="capture" id="capture-root"></section>   <!-- capture bar -->
  <section            id="main-root"></section>           <!-- route-swappable child -->
</main>
```

`#capture-root` always exists in the DOM. **Visibility** is toggled by a
body-level class:

```css
body.is-area-route #capture-root { display: none; }
```

Same pattern as `is-sidebar-collapsed` from M2. The capture *view* is never
destroyed — its closure state (typed input, focus position) survives every
route change. Only the rendered `<input>` is hidden.

### Toast root location

The toast root lives **outside** `#main-root`. Concretely: a sibling of
`<main>` (or directly inside `<body>`):

```html
<body>
  <aside id="sidebar"></aside>
  <main>...</main>
  <div id="toast-root"></div>   <!-- never destroyed by route change -->
</body>
```

Reason: cascade-undo can carry up to N task snapshots. If the toast lived
inside `#main-root`, navigating to Today after a section delete would destroy
the toast and the undo snapshot before the user could act. With cascade
delete, that's 1-12 tasks lost in one click.

### Controller start sequence

```
1. Mount sidebar in <aside>                         (always-on, never unmounts)
2. Mount capture view in #capture-root              (always-on, hidden by CSS on area route)
3. Mount toast view in #toast-root                  (always-on, never unmounts)
4. Subscribe to all model notifies → re-render sidebar + currentMainView
5. syncRoute() — read window.location.hash, mount matching main view
6. addEventListener("hashchange", syncRoute)
7. Start setInterval(tick, 60_000) — calls currentMainView.render(state) only
```

```js
function syncRoute() {
  const route = parseHash(location.hash)
  document.body.classList.toggle("is-area-route", route.name === "area")
  currentMainView?.destroy()
  currentMainView = mountTable[route.name](route)
  currentMainView.render(state())
}
```

`syncRoute` is the only place that mounts/unmounts main views or flips the
capture bar. One source of truth.

`controller.stop()` clears the tick interval, calls `destroy()` on sidebar,
capture, toast, and `currentMainView`.

### Active-route highlight in sidebar

State shape passed to sidebar becomes `{ areas, sections, tasks, settings, route }`.
Sidebar render branches on `route.name` (and `route.id` for the area case)
to apply `aria-current="page"` and the `is-active` CSS class on the right
item.

```html
<button class="sidebar__home"
        data-action="go-today"
        aria-current="page">  <!-- when on Today -->
  Ignite
</button>
…
<button class="sidebar__area"
        data-action="open-area"
        data-id="focus"
        aria-current="page">  <!-- when on #area/focus -->
  Focus (3)
</button>
```

`go-today` action sets `location.hash = "#today"`, fires `hashchange`, calls
`syncRoute`. `open-area` sets `location.hash = "#area/<id>"`. No special-case
wiring.

---

## Sidebar updates

Same template as M2 with three additions:

- Clickable wordmark at the top (`<button data-action="go-today">Ignite</button>`)
- Focus row becomes a `<button>` with `data-action="open-area" data-id="focus"`
- Both items get conditional `aria-current="page"` and `is-active` based on `route`

Active-task count logic (M2) is unchanged.

Mobile (`<768px`): sidebar still stacks above main; toggle button still
hidden via media query. M3 changes nothing about the mobile sidebar.

---

## Area view template

### `createAreaView(rootEl, { areaId })`

Standard view contract from M2: returns `{ render(state), destroy() }`.
Template is a single `innerHTML` write per render. No diffing.

If the looked-up area doesn't exist in state: render the not-found
empty-state instead of the normal area shell.

```html
<section class="area" data-area-id="focus">
  <header class="area__header">
    <h1 class="area__title">Focus</h1>
  </header>

  <div class="area__sections">
    <!-- one .section per section, in order -->
  </div>

  <footer class="area__footer">
    <button data-action="add-section" class="area__add-section">＋ New section</button>
  </footer>
</section>
```

Area title is plain text. Area rename/delete is M4+.

### Section block

```html
<section class="section" data-section-id="abc" data-collapsed="false">
  <header class="section__header">
    <button class="section__toggle"
            data-action="toggle-section"
            aria-expanded="true">
      <span class="section__chevron" aria-hidden="true">▾</span>
      <span class="section__title">Tasks</span>
    </button>
    <button class="section__menu"
            data-action="open-section-menu"
            aria-haspopup="menu"
            aria-expanded="false">⋯</button>
  </header>

  <div class="section__body">
    <ul class="section__tasks">
      <!-- renderTaskRow(task) for each task in this section -->
    </ul>
    <button data-action="add-task" class="section__add-task">＋ Add task</button>
  </div>
</section>
```

Behavioural notes baked into the template:

- **Collapse hook:** `data-collapsed="true"` on the outer `<section>` is the
  CSS hook. CSS hides `.section__body` when true and rotates the chevron via
  `transform`. No conditional rendering of the body — keeps the template
  branch-free. `aria-expanded` mirrors the same state on the toggle button.
- **Toggle button wraps chevron + title:** the whole region is one
  keyboard-reachable button. The `⋯` is a sibling button, not a child
  (button-in-button is invalid HTML). `bindActions` resolves to the closest
  `[data-action]` ancestor, so `⋯` clicks don't bubble to toggle.
- **Empty section** (`tasks.length === 0`): the `<ul>` renders empty; only
  `＋ Add task` shows. No "No tasks yet" message — presence of the button is
  itself the empty state. ADHD-friendly: when there's nothing to do, the
  page should look quiet.
- **`focus-default` (`section.id === FOCUS_DEFAULT_SECTION_ID`):** the menu
  omits the **Delete** item entirely. Rename / Move up / Move down still
  render normally.
- **Recurring chevron etc.:** task rows continue to use `renderTaskRow(task)`
  from M2, with the `escapeHtml` audit applied.

### Section menu

A small dropdown anchored to the `⋯` button. Closure state on the area view
tracks `openSectionMenuId`. Single-menu invariant: opening menu B implicitly
closes menu A.

```html
<ul class="section__menu-pop" role="menu">
  <li role="none"><button role="menuitem" data-action="rename-section">Rename</button></li>
  <li role="none"><button role="menuitem" data-action="move-up" disabled?>Move up</button></li>
  <li role="none"><button role="menuitem" data-action="move-down" disabled?>Move down</button></li>
  <li role="none"><button role="menuitem" data-action="delete-section">Delete</button></li>
</ul>
```

`Move up` is `disabled` on the first section (lowest `order`); `Move down`
on the last. Disabled items are styled per `:disabled` and do not fire
actions.

**Menu close triggers (all required):**

- Click outside menu (existing M2 pattern: document-level click listener installed on open, removed on close)
- Esc key (`bindKeys(rootEl, { Escape: closeMenu })`)
- Selecting any menu item (handler closes menu before mutating state)
- Hashchange / view destroy (cleanup)

**Focus management on menu open/close:**

- Open via Enter on `⋯`: focus moves to first menu item (Rename)
- Open via mouse click on `⋯`: menu shown, focus stays on `⋯` (mouse pattern)
- Close (any trigger): focus returns to the `⋯` button that opened it

Implementation: controller stores `lastMenuTriggerEl` when opening; restores
focus to it on close. Same pattern reused for rename trigger memorisation
(below).

### Inline rename

When `renamingSectionId === section.id`, the header renders an input variant
in place of the toggle:

```html
<header class="section__header section__header--editing">
  <span class="section__chevron" aria-hidden="true">▾</span>
  <input type="text"
         class="section__rename-input"
         value="Tasks"
         data-action="commit-rename"
         data-section-id="abc"
         autofocus />
  <!-- ⋯ menu hidden during edit -->
</header>
```

- `autofocus` puts focus in the input on render. Controller calls
  `input.select()` after the next render so the existing name is highlighted.
- Enter or blur fires `commit-rename` → if value is non-empty after `.trim()`,
  call `sections.rename(id, value.trim())`; clear `renamingSectionId`;
  re-render; restore focus to the section's `⋯` button.
- Esc fires `cancel-rename` → clear `renamingSectionId`; re-render; restore
  focus to the section's `⋯` button.
- Empty/whitespace-only value on commit = treated as cancel (revert, no
  error, no model write).
- Esc handling requires `bindKeys(rootEl, { Escape: cancelRename })` since
  `bindActions` is click-only.

**Focus return after commit/cancel:** controller stores the trigger button
(`section.section__menu`) when `rename-section` is fired, before opening
rename mode. After re-render, controller calls `triggerEl.focus()`. Without
this, focus falls back to `<body>` and keyboard users get teleported to the
top of the page.

**Rename in-flight + navigation:** `area.destroy()` checks
`renamingSectionId`. If set and the input has a non-empty trimmed value, it
commits the rename (calls `sections.rename`) before tearing down. Predictable
behaviour across hashchange, route swap, and `controller.stop()`. Empty
in-flight values are discarded silently.

### Add-section flow

`＋ New section` button at the area footer is **not** an inline input — it
calls `sections.create({ areaId, name: "New section" })` directly, then
immediately enters rename mode on the new section. Same UX as Notion /
Linear: create-then-rename is one less interaction model than
create-via-input. The input is auto-focused with text selected, so a single
keystroke replaces the placeholder name.

---

## CRUD flows

### Create section

1. Controller handles `add-section` → `sections.create({ areaId, name: "New section" })`
2. Model assigns next `order` (max existing + 1) and a new uuid; persists; notifies
3. Re-render places new section at the bottom (highest `order`)
4. Controller sets `renamingSectionId = newSection.id` → next render shows the rename input on the new section, autofocused, value selected
5. New section starts expanded (`collapsed: false` is the default)

### Rename section

1. Controller handles `rename-section` (from menu) → store trigger button reference; close menu; set `renamingSectionId`; re-render
2. View renders the input variant for that section
3. `commit-rename` (Enter or blur, click delegation): read input value
   - Empty/whitespace after `.trim()` → cancel (clear `renamingSectionId`, re-render, focus trigger)
   - Non-empty → `sections.rename(id, value.trim())`, clear `renamingSectionId`, re-render, focus trigger
4. `cancel-rename` (Esc, key delegation) → clear `renamingSectionId`, re-render, focus trigger
5. View destroy: any non-empty in-flight rename is committed before teardown (see above)

### Reorder (Move up / Move down)

1. Controller handles `move-up` or `move-down` → find neighbour by `order` in current state
2. Call `reorderSections(sections, id, direction)` (pure helper) → returns new array with `order` swapped between the section and its neighbour
3. Persist the two changed records: `sections.swapOrder(idA, idB)` — single mutator, both writes in one transaction, one notify
4. Re-render. Menu was already closed when the action fired (every action handler closes the menu first — same pattern as M2).

Edge cases:

- First section + `move-up` → button is `disabled`, action never fires
- Single section + `move-up` or `move-down` → both `disabled`
- Sections with non-contiguous `order` values (e.g. 0, 5, 10) still swap correctly — covered by `reorderSections` resilience test

### Delete section with cascade undo

The most complex M3 flow.

**Step 1 — capture snapshot (before any mutation):**

```js
const sectionSnapshot = sections.getById(id)            // full record
const taskSnapshots   = tasks.allBySection(id)          // array of full records
```

**Step 2 — mutate model:**

```js
tasks.removeMany(taskSnapshots.map(t => t.id))          // bulk delete in one txn, one notify
sections.remove(id)                                      // separate notify
```

Two notifies are fine — re-render is idempotent. Optimising to one notify is
M2-style premature.

**Step 3 — show toast (8s timer for section delete):**

```js
toastView.show({
  message: `"${sectionSnapshot.name}" and ${n} task${s} deleted`,
  durationMs: 8000,
  onUndo: () => {
    sections.restore(sectionSnapshot)
    tasks.restoreMany(taskSnapshots)
  }
})
```

Escaping responsibility: the controller passes the **plain composed string**;
`toastView` applies `escapeHtml` once at render time. Double-escaping (both
sides) would render `&quot;` as literal text. Single source of truth.

Message variants:

- 0 tasks: `"Tasks" deleted` (no count phrase)
- 1 task: `"Tasks" and 1 task deleted`
- N tasks: `"Tasks" and N tasks deleted`

The 8s timer (vs M2's 5s for task delete) reflects higher stakes — a cascade
delete can lose 1-12 tasks, and keyboard / screen-reader users need more
time to navigate to and activate Undo.

**Step 4 — undo within 8s:**

- `sections.restore(snapshot)` writes the original record back via direct
  `db.put` (preserves original `order` verbatim — see [Order ties](#order-ties))
- `tasks.restoreMany(snapshots)` writes all task records back in one txn
- Re-render shows the section back in place with all its tasks

#### Order ties

`sections.restore` writes the original `order` value back verbatim. If the
user created another section with the same `order` between the delete and
the undo (rare in normal flow because new sections take `max + 1`), tied
orders are tolerated. Sort is stable: the spec uses `Array.prototype.sort`
on `order`, ties fall back to insertion order in IndexedDB. No "ghost
ordering" bug; no migration needed.

#### Sequential delete + lost snapshot (accepted)

If a second delete happens during an active toast, the first toast dismisses
and its snapshot is lost. M2 accepted this for tasks; M3 inherits it for
sections. Cascade amplifies the cost (N tasks per snapshot), but a queue
would mean stacking toasts or carrying state across them — both out of
scope. Documented here so it doesn't surprise.

#### Hard reload + lost snapshot (accepted)

Refreshing the browser before clicking Undo loses the snapshot. The toast is
JS-only; nothing is persisted to IndexedDB until the restore call fires.
Standard behaviour, M2-consistent.

### New mutators required

| File | Mutator | Notes |
|---|---|---|
| `model/sections.js` | `setCollapsed(id, value)` | Wraps existing `update`; minimal |
| `model/sections.js` | `rename(id, name)` | Wraps existing `update`; trims, notifies |
| `model/sections.js` | `swapOrder(idA, idB)` | Two `db.put` in one txn, one notify |
| `model/sections.js` | `restore(snapshot)` | Direct `db.put` with original id + order; notifies |
| `model/sections.js` | `removeMany(ids)` | Used by cascade; one txn, one notify |
| `model/tasks.js` | `removeMany(ids)` | Bulk delete in one txn, one notify |
| `model/tasks.js` | `restoreMany(snapshots)` | Bulk reinsert in one txn, one notify |

`tasks.removeMany` and `restoreMany` are thin loops; verifying via the
manual cascade-undo step is enough. No new unit tests for them.

### Capture-bar reachability after rename

If the user renames `focus-default` from "Tasks" to "Inbox" or "Brain dump",
the capture bar still works. It targets `FOCUS_DEFAULT_SECTION_ID`, not the
name. Renaming is decoration; the id is the contract. Names are user-visible
and changeable; ids are stable forever.

---

## Security

### XSS via interpolated user input

User-controlled strings reach the DOM through several paths:

- Section name (header H2, toast message)
- Area title (currently only "Focus" — but the area title is read from
  `area.name`, so any future user area would expose it)
- Task title (already in `renderTaskRow` from M2)
- Toast message (composed from section name and counts)

All view templates use `rootEl.innerHTML = template(state)` for performance
and simplicity. Without escaping, a section named
`<img src=x onerror=alert(1)>` executes JS on the next render.

**Fix — applied across the codebase in M3:**

1. Add `escapeHtml(str)` to `src/utils/dom.js`:

   ```js
   export function escapeHtml(str) {
     return String(str ?? "")
       .replaceAll("&", "&amp;")
       .replaceAll("<", "&lt;")
       .replaceAll(">", "&gt;")
       .replaceAll('"', "&quot;")
       .replaceAll("'", "&#39;")
   }
   ```

2. Apply at every interpolation of user-controlled string in view templates:

   - `views/area.js` — area title, section names
   - `views/section.js` — section name in header, in rename input `value`
     attribute (use `&quot;` from `escapeHtml`)
   - `views/task.js` (`renderTaskRow`) — task title
   - `views/toast.js` — interpolated message values

3. Numeric values (counts, dates), booleans, and stable ids do not need
   escaping — they come from controlled sources.

### Why this matters in a local-first app

IndexedDB is per-origin: a section name typed locally can't directly
attack other users. Three reasons to enforce escaping anyway:

- **Open source + future JSON import.** The parent spec lists data
  export/import as MVP. A shared export file with malicious section names
  becomes a cross-user vector the moment import lands.
- **Future copy/paste flows.** Pasting from rich-text sources can introduce
  HTML-as-text. Escape discipline at the boundary is simpler than per-source
  sanitisation.
- **Discipline carries forward.** Once views ship unescaped, retrofitting
  is annoying. M3 establishes the pattern; future view code follows it.

### Privacy

M3 doesn't change Ignite's privacy posture:

- All data stays in IndexedDB (per-origin, on-device)
- No new network calls, no telemetry, no analytics, no third-party requests
- Service Worker is still M4+ — M3 ships fully offline
- Section names are user-typed; never leave the device unless the user
  explicitly exports

---

## Accessibility

### Keyboard navigation

- **Wordmark, sidebar Focus row, section toggle, `⋯` menu trigger,
  per-section `＋ Add task`, area `＋ New section`, all menu items, and
  rename input** are all native `<button>` or `<input>` elements — focusable,
  Enter/Space activates, screen readers announce role.
- Tab order follows DOM order: sidebar → main capture (when visible) → main
  content top-to-bottom → toast (when visible).
- Esc closes the section menu and cancels rename. Implemented via
  `bindKeys(rootEl, { Escape: handler })`.
- No new global keyboard shortcuts in M3 (the parent spec's `/`, `n`,
  `space` are deferred to a later milestone).

### ARIA

- `aria-current="page"` on the active sidebar item (wordmark when on Today,
  Focus row when on Focus area)
- `aria-expanded="true|false"` on `.section__toggle`, kept in sync with
  `data-collapsed`
- `aria-haspopup="menu"` and `aria-expanded` on `.section__menu`
- `role="menu"` on the dropdown `<ul>`; `role="menuitem"` on each button;
  `role="none"` on `<li>` wrappers
- `aria-hidden="true"` on the chevron glyph (decorative; the toggle button
  has the accessible name from the title text)
- Toast region uses `role="status"` / `aria-live="polite"` (M2 pattern,
  unchanged)

### Focus management

Three transitions need explicit focus handling:

| Transition | Focus moves to |
|---|---|
| Open menu via Enter on `⋯` | First menu item (Rename) |
| Close menu (any trigger) | The `⋯` button that opened it |
| Rename commit / cancel / destroy-commit | The `⋯` button on that section |

Controller stores the trigger button reference at the moment a menu opens
or rename starts; restores focus after the next render completes.

### Touch targets

Every interactive element must be at least **44×44 px** on touch:

- `.section__chevron` and `.section__toggle` (whole header is the target)
- `.section__menu` (`⋯` button) — explicit min-width / min-height
- `.section__add-task`, `.area__add-section`
- Menu items (`Rename`, `Move up`, `Move down`, `Delete`)

CSS sets `min-block-size: 44px` and `min-inline-size: 44px` on these
elements. Visual size can be smaller via padding tricks if the design wants;
the *touch target* meets minimum.

### Toast timer

Section-delete toast: **8 seconds** (vs M2 task delete's 5s). Cascade-undo
carries higher stakes (1-12 task snapshots), and keyboard / screen-reader
users need more time to:

1. Hear the live-region announcement
2. Tab into the toast region
3. Find and activate Undo

Task delete in M2 stays at 5s — small undo, fine. Future enhancement (not
M3): pause the timer while the toast region has keyboard focus.

### Focus-visible styling

All new dynamic controls (toggle, menu trigger, menu items, rename input,
add-task, add-section, wordmark, sidebar area row) get a visible
`:focus-visible` outline using existing design tokens. No `outline: none`
without replacement.

### Reduced motion

The chevron rotation and any section-body slide animations respect
`prefers-reduced-motion: reduce` — `transition: none` on those properties
when the media query matches.

---

## DOM event delegation

M2 introduced `bindActions(rootEl, actionMap)` — click-only delegation
keyed by `data-action`.

M3 needs **keydown** delegation (Esc on rename input, Esc to close menu).
Two options were considered: extend `bindActions` to handle multiple event
types, or add a separate helper. Chose the latter:

```js
// src/utils/dom.js
bindActions(rootEl, actionMap)            // unchanged from M2 — click only
bindKeys(rootEl, keyMap)                  // NEW — keydown delegation
```

`bindKeys` uses `e.key` to match (e.g. `"Escape"`, `"Enter"`). Handlers
receive `(event, target)` like `bindActions`.

**Idempotency requirement:** keydown fires repeatedly when a key is held.
Handlers must be safe to call multiple times in a row. The two M3 handlers
both meet this:

- `cancel-rename`: clears `renamingSectionId`. Repeated calls are no-ops.
- `close-section-menu`: clears `openSectionMenuId`. Same.

### Why not extend `bindActions`?

- Smaller scope — no churn on M2 callers
- Cleaner mental model — one helper per event type
- Avoids a temptation to mix unrelated event handlers in one map

---

## Pure-function seam

`src/utils/sections.js` exports one pure function:

```js
reorderSections(sections, sectionId, direction) → Section[]
// direction: "up" | "down"
```

- Returns a new array (does not mutate input)
- Swaps `order` values with the immediate neighbour
- Returns the same array unchanged when the move is at an edge (no-op)
- Tolerates non-contiguous `order` values (swaps work by neighbour
  position in sorted-by-order list, not by `order ± 1`)
- No DB, no DOM, no `Date.now`, no globals

This is the one piece of M3 logic where off-by-one bugs would hide silently.
~5 tests, ~10 minutes to write.

---

## Verification plan

### Pure-function tests (`tests/utils/sections.test.js`)

5 tests. M3 ends at **≈ 72 tests passing** (M2: 67 + 5 new).

- Move first section up → unchanged array (no-op)
- Move last section down → unchanged array (no-op)
- Move middle section up → swaps `order` with predecessor, others unchanged
- Move middle section down → swaps `order` with successor, others unchanged
- Sections with non-contiguous `order` (0, 5, 10) still swap correctly

### Manual browser verification (16 steps)

Run on Brave/Chrome desktop + DevTools mobile viewport unless noted.

1. **Boot** — fresh state shows sidebar with clickable "Ignite" wordmark (active highlighted) and Focus row (not highlighted). Today renders as in M2.
2. **Sidebar Focus click** — routes to `#area/focus`. Capture bar disappears (CSS hide via `is-area-route`). Wordmark loses active highlight; Focus row gains it.
3. **Initial Area view content** — shows "Focus" title, one section "Tasks" (the renamed seed), any captured tasks from M2 sit inside it. Below: `＋ New section`.
4. **Wordmark back to Today** — click "Ignite" → routes to `#today`. Capture bar reappears. Sidebar highlights swap back. `aria-current` flips correctly.
5. **Browser back/forward** — back/forward through Today ↔ Focus works without refresh; current view re-renders correctly each time.
6. **Add section** — click `＋ New section` → new section appears at the bottom with name in rename input, autofocused, text selected. Type "Routines", press Enter → committed.
7. **Rename existing section** — open `⋯` on "Tasks" → click Rename → input replaces title with "Tasks" pre-selected. Type "Inbox", Enter → renamed. Capture bar in Today still places new tasks here (proves id-not-name contract).
8. **Rename → Esc cancels** — open Rename, type junk, Esc → reverts to old name. Focus returns to `⋯`.
9. **Rename → empty cancels** — open Rename, clear input, Enter → reverts to old name (no error).
10. **Reorder** — with 3+ sections: open `⋯` on middle section → Move up swaps with predecessor; Move up on first is greyed; Move down on last is greyed.
11. **Collapse / expand** — click section header → body hides, chevron rotates. `aria-expanded` flips. Hard reload → state persists. Click `⋯` inside header → menu opens, doesn't toggle collapse.
12. **Delete cascade + undo** — section with 3 tasks: open `⋯` → Delete → section + tasks vanish, toast: *"Inbox and 3 tasks deleted"*. Click **Undo** within 8s → section returns at its original `order`, all 3 tasks restored. Repeat, let timer expire → toast dismisses, section stays gone.
13. **`focus-default` is undeletable** — open `⋯` on the renamed-Tasks section → menu shows Rename / Move up / Move down only; **no Delete item**.
14. **Unknown route** — manually set `location.hash = "#area/does-not-exist"` → empty-state in main: *"Area not found."* with link back to Today.
15. **Mobile (<768px)** — sidebar stacks above main. Section header click target is comfortable (≥ 44px). `⋯` reachable. `＋ Add task` doesn't get cut off.
16. **Keyboard-only walk-through** — Tab from URL bar:
    - Tab to wordmark, Enter → goes to Today
    - Tab to Focus row, Enter → goes to Focus area
    - Tab through area: section toggles, `⋯` buttons, `＋ Add task`, `＋ New section`
    - Enter on a `⋯` → menu opens, focus on Rename. Tab through items. Esc → menu closes, focus returns to `⋯`.
    - Enter on `⋯` → Rename → input focused, text selected. Type. Esc → cancels, focus returns to `⋯`. Repeat with Enter to commit.
    - Enter on `＋ New section` → new section appears in rename mode, input focused.
    - Delete a section → toast announced via aria-live. Tab to Undo button → Enter → restored.
    - Reload → all state persisted; no lost focus crashes.

### XSS spot-check

After implementation, paste these into a section name and verify no
execution + no broken markup:

- `<img src=x onerror=alert(1)>`
- `<script>alert(1)</script>`
- `"; alert(1); //`
- `<b>bold?</b>`

Expected: each renders as literal text. Same check on task title via the
capture bar (regression-checks the `renderTaskRow` audit).

### Done-criteria

- All tests pass: `npm test` (≈ 72 passing)
- Biome clean: `npm run lint`
- 16 manual checks pass in real browser
- XSS spot-check clean on section name and task title
- No console errors. Favicon 404 still acceptable.
- Git head ≈ 12-15 atomic commits past `d5d8712`. One task = one commit, same as M2.

---

## Open follow-ups (post-M3)

- **`+ New area` + sidebar area CRUD** — unblocks user areas beyond Focus. Sidebar gains the bottom button; controller wires create/rename/delete/reorder for areas. Reuses everything M3 builds for sections.
- **Move task to another section / area** — small `…` menu addition on task rows; needs a section/area picker.
- **Task date picker / starring inline** — the prerequisite UI for M4 reminder scheduling.
- **Drag-to-reorder for sections** — replace Move up/down menu items with HTML5 DnD when there's enough demand. Up/down stays as a fallback.
- **Toast queueing** — second delete during a toast window currently dismisses the first. Acceptable in M3; revisit if it surfaces as friction.
- **Pause toast timer on keyboard focus** — improves the keyboard/SR undo experience further. M3 ships the 8s timer; pause-on-focus is a follow-up.
- **Full arrow-key navigation in section menu** — current M3 ships Tab cycling (AA acceptable). Arrow-key navigation is AAA polish.
- **Global keyboard shortcuts** — `/` to focus capture, `n` for new section, etc. The new `bindKeys` helper supports this cleanly when the time comes.

---

## Locked decisions reference (Q1-Q10)

| # | Question | Locked answer |
|---|---|---|
| Q1 | Scope envelope | B — Area view + section CRUD on Focus only. No area CRUD, no task moves, no date picker. |
| Q2 | Today nav | B — clickable wordmark at top of sidebar. |
| Q3 | Section CRUD pattern | B — `⋯` menu (Rename / Move up / Move down / Delete) + `＋ New section` at area bottom. |
| Q4 | Capture bar in Area view | B — hidden via CSS on `#area/:id`; per-section `＋ Add task` only. |
| Q5 | Section delete | B — cascade with 5s undo toast (extended to 8s for accessibility). Mirrors M2 pattern. |
| Q6 | Seed section | A — `focus-default` undeletable; first-boot rename `""` → `"Tasks"`. |
| Q7 | Section reorder | B — Move up / Move down in menu, swap with neighbour, greyed at the ends. |
| Q8 | Collapse trigger | A — clickable header row + chevron icon. New sections start expanded. |
| Q9 | Rename UX | A — inline input replaces H2; Enter/blur commits, Esc/empty cancels. |
| Q10 | Test seam | A — `reorderSections` pure helper in `src/utils/sections.js`, ~5 tests. |
