# Ignite — ADHD-Friendly Task App (Design Spec)

**Status:** Design approved 2026-04-20. Scaffold complete. Ready for implementation planning.

**App name:** Ignite
**Tagline:** a small flame, kept going.

---

## Context

Malin's first major solo project. An open-source, ADHD-friendly task app designed to
replace her current Amplenote setup — without the bloat and the paywall. Built for her
first; intended to help anyone who shares the same cognitive-load struggle.

**Origin friction:** Malin landed on Amplenote as a compromise when searching for a
minimal, free, reminder-capable task app. She loves Notesnook's feel (design, security,
effectiveness) but dislikes Amplenote's notes+tasks mashup, subscription model, and
feature sprawl.

**Intended outcome:** A self-contained web-installable task app that actually replaces
her daily tool, showcases her as a developer, and is genuinely useful for other
ADHD users.

---

## Direction

### Philosophy
- Zero bloat — every feature must earn its place
- Minimal and intentional, not minimal and empty
- Open source, free
- ADHD-friendly; reduces cognitive load; actually helps in daily life
- Data ownership (local-first, Notesnook-style instinct)

### Primary User
Malin first, open to anyone with similar struggles. Binding thread: ADHD / cognitive load.

### Aesthetic Target
Notesnook's design language — clean, satisfying, secure-feeling, dark-mode-first.

### Structural Target
Amplenote's shape, simplified — 2-level hierarchy:
- **Area** (top-level life bucket: Focus, Routines, Projects, Personal, Shopping)
- **Section** (H2 group inside an area: Daily, Weekly, To do, Stay in touch, …)
- **Task** (the item itself — checkbox with metadata)

---

## Scope

### MVP (v1)
Areas + sections + dated/starred tasks + PWA reminder notifications with recurrence,
lead-time, multi-snooze, quiet hours, and critical-override.

### Deferred to v2+
- Inline markdown / rich text on title or notes
- Tags (cross-cutting labels)
- Subtasks / nested tasks
- Account system / multi-device sync
- Completion history / streaks
- Upcoming view (beyond today)
- Native Android/iOS apps
- Cross-browser reliable reminders (backend + Web Push)
- Dedupe of quiet-hours notification pileup
- Light mode / theming

---

## Architecture

Vite modular MVC + IndexedDB + Service Worker.

**Tech stack:**
- Vanilla HTML/CSS/JS (no frameworks)
- Vite (build tool, dev server)
- Biome (format/lint)
- IndexedDB (persistence, thin hand-rolled wrapper)
- Service Worker + Web App Manifest (PWA install + background notifications)
- Notification Triggers API (scheduled local notifications — Chromium)

**MVC separation** (per Malin's CLAUDE.md):

| Layer | Responsibility |
|---|---|
| **Model** | State + data only. No DOM. No timers. Uses subscribe/notify. |
| **View** | Renders HTML from state. `data-action` attrs. No logic. |
| **Controller** | Behavior, timers, event wiring. Mediates model ↔ view. |

---

## Data Model

Four IndexedDB object stores.

### `areas`
```js
{
  id,        // uuid (Focus = "focus", built-in)
  name,      // user-provided
  icon,      // optional emoji/glyph
  critical,  // boolean — new tasks inherit this flag
  order      // display order
}
```
The `Focus` area is built-in and always exists. Cannot be deleted.

### `sections`
```js
{
  id,         // uuid
  areaId,     // foreign key
  name,
  collapsed,  // boolean — remembered per section across reloads
  order       // display order within area
}
```

### `tasks`
```js
{
  id,              // uuid
  sectionId,       // foreign key
  title,           // plain text; URLs auto-linkify on render
  notes,           // plain text (separate field); also auto-linkifies URLs
  completed,       // boolean
  starred,         // boolean
  critical,        // boolean — inherits area.critical at creation; independent after
  dueAt,           // ISO datetime or null
  recurrence,      // null or { type, ...params }
  leadTime,        // minutes before dueAt for pre-notification (0 = none)
  scheduledTags,   // string[] — notification tags currently scheduled
  createdAt,       // ISO datetime
  order            // display order within section
}
```

### `settings` (singleton)
```js
{
  id: "app",
  quietStart: 23,              // hour 0-23
  quietEnd: 7,
  lastKnownPermission,         // "default" | "granted" | "denied" — cached from last check; detects denial after install without re-prompting each boot
  lastView                     // URL-hash string (e.g. "#today", "#area/focus") — restored on next launch
}
```

### Recurrence shapes
- `{ type: "daily" }`
- `{ type: "weekly", weekdays: [1, 3, 5] }` (0 = Sunday)
- `{ type: "monthly", day: 15 }` (clamped if month is shorter)
- `{ type: "yearly", month: 4, day: 7 }` (Feb 29 → Feb 28 in non-leap years)

### Indexes
- `tasks` by `sectionId`
- `tasks` by `dueAt` (for Today view queries)
- `tasks` by `completed`
- `tasks` by `starred`

---

## Views

### Today View (default on open)

```
┌─────────────────────────────────────────┐
│ [+] What's next? ______________________ │
├─────────────────────────────────────────┤
│ ╔═══════════════════════════════════╗   │
│ ║  NEXT                             ║   │
│ ║  ☐ Ta medisin                     ║   │
│ ║    in 45 min · daily              ║   │
│ ╚═══════════════════════════════════╝   │
│                                         │
│ Overdue (1)                             │
│ Today (4)                               │
│ Starred                                 │
└─────────────────────────────────────────┘
```

**NEXT hero card** — single task, big visual weight. Priority order:
1. Oldest overdue, OR
2. Earliest time-dated today (after `now`), OR
3. First starred undated (ordered by `order` field), OR
4. Empty-state: *"You're clear. Nice."*

Hero task is excluded from the lists below to avoid duplication.

**Overdue** — red accent, hidden when empty.
**Today** — time-sorted dated tasks for today; recurring items show `⟲` glyph.
**Starred** — undated starred tasks (the "don't forget" pile).

**No 2-week lookahead on home.** Planning mode is a click into an Area.

### Area View
Area title, sections stacked as H2 blocks each with its task list. Per-section inline
`+ add task` (click or `/` to focus). Sections collapsible; collapse state remembered
per section via `section.collapsed`.

No separate Section view — collapsible sections handle drill-down.

### Sidebar (persistent)
Areas list with active-task counts. `Focus` pinned at top, user areas below,
`+ New area` and Settings at the bottom. Active area highlighted. Collapsible on
narrow screens.

### Settings
Quiet hours config, per-area critical toggle, data export/import (JSON round-trip).

### Keyboard Shortcuts (v1)
- `/` or `n` — focus quick-add in current view
- `space` — toggle check on focused task
- `esc` — blur / close modals

---

## Reminder Scheduling

### Core Mechanism
Service Worker owns all scheduled notifications via **Notification Triggers API**.
Per time-based task: up to two notifications, one at `dueAt − leadTime` and one at
`dueAt`. Tags: `task-{id}-lead`, `task-{id}-due`. Tags stored in `task.scheduledTags`
for cancel/reschedule.

### Flow: setting a task's date/time
1. Model saves task
2. Request notification permission (first time only)
3. `scheduler.schedule(task)` calls `registration.showNotification()` with
   `TimestampTrigger` — up to twice (lead + due)
4. Save tag list onto `task.scheduledTags`

### Flow: task rescheduled / deleted
1. Look up `task.scheduledTags` → cancel pending notifications
2. Clear `scheduledTags`
3. Re-schedule with new `dueAt` if any

### Flow: recurring task checked off
1. `next = nextOccurrence(recurrence, dueAt)`
2. Task updates: `completed = false`, `dueAt = next`
3. Reschedule notifications

### Flow: app boot
Scan incomplete tasks with `dueAt > now`; re-schedule any whose `scheduledTags` are
missing from the SW queue (handles reinstall or browser state eviction).

### Notification Content
- **Title:** task title
- **Body:** lead-time → *"Coming up in 1 hour"*; due-time → *"Due now"*
- **Actions (where supported):** `Mark complete`, `Snooze` (= 10 min quick-snooze)

### In-App Snooze Menu
- 10 min
- 1 hour
- Tomorrow 09:00
- Custom… (date/time picker)

Snooze = shift `dueAt` forward and reschedule. No separate snooze store.

### Quiet Hours + Critical Override
- Default window: **23:00–07:00**, configurable in Settings
- `area.critical: boolean` — new tasks created in this area default to critical
- `task.critical: boolean` — bypasses quiet hours; visual indicator (red dot/flag)
- Inheritance: at task creation, `task.critical = area.critical`. Independent thereafter.

```js
function adjustForQuietHours(triggerAt, settings, task) {
  if (task.critical) return triggerAt;
  if (!inQuietWindow(triggerAt, settings)) return triggerAt;
  return shiftToQuietEnd(triggerAt, settings);
}
```

- Accepted v1 limitation: lead + due triggers that both land in quiet hours both
  shift to `quietEnd` → small pileup. Dedupe is v2 polish.

### Non-Chromium Fallback (Firefox/Safari)
Runtime feature-detect `showTrigger`. If absent:
- Skip future scheduling
- On app open, surface tasks whose `dueAt` passed while away in Overdue
- First-launch banner: *"For reliable reminders, install in Brave/Chrome/Edge."*

### Recurrence Math (pure functions, `src/model/recurrence.js`)
- `daily` — `+1 day`
- `weekly` — next date whose weekday is in `weekdays[]`
- `monthly` — same day-of-month next month; clamp to last-day-of-month if needed
- `yearly` — same month+day next year; Feb 29 → Feb 28 in non-leap years

No side effects → unit-testable.

---

## File Layout

```
ignite/
├── index.html              # app shell: <aside id="sidebar"> <main id="main">
├── vite.config.js
├── biome.json
├── package.json
├── public/
│   ├── manifest.json       # PWA metadata
│   ├── sw.js               # Service Worker
│   └── icons/              # app icons (192, 512, maskable)
├── base.css                # shared dark-mode foundation (do not edit)
├── main.css                # app-specific styles
├── docs/
│   └── superpowers/
│       └── specs/          # this spec lives here
└── src/
    ├── main.js             # boots: register SW, import ./app.js
    ├── app.js              # wires createModel / createView / createController
    ├── model/
    │   ├── db.js           # IndexedDB init + schema + migrations
    │   ├── tasks.js        # createTaskModel — CRUD, subscribe/notify
    │   ├── areas.js        # createAreaModel — ensures Focus always exists
    │   ├── sections.js     # createSectionModel
    │   ├── settings.js     # createSettingsModel
    │   ├── recurrence.js   # pure: nextOccurrence(rule, fromDate)
    │   └── scheduler.js    # schedule/cancel notifications; quiet-hours math
    ├── views/
    │   ├── sidebar.js      # area list + counts
    │   ├── today.js        # NEXT card + three groups
    │   ├── area.js         # area title + sections + tasks
    │   ├── task.js         # shared single-task row renderer
    │   ├── capture.js      # quick-capture bar
    │   └── settings.js     # quiet hours config, data export/import
    ├── controller.js       # event wiring, keyboard shortcuts, hash-routing
    └── utils/
        ├── dom.js          # bindActions, formatTime, linkifyUrls
        └── id.js           # UUID helper
```

---

## MVC Wiring

**Model factories** return `{ getters, mutators, subscribe }`. Mutators write
IndexedDB then notify subscribers. `scheduler` is the only model that talks to the
Service Worker.

**View factories** export `createXView(rootEl) → { render(state), destroy() }`.
Views use `data-action="…"` attrs; no inline handlers. Shared `task.js` renders a
task row used by both Today and Area views.

**Controller:** one exported `createController({ models, views })`. Routes by URL
hash (`#today`, `#area/:id`, `#settings`). `bindActions(rootEl, actionMap)` for
delegated events. Subscribes to model changes; triggers view re-renders. Calls
`scheduler` on task writes.

**Service Worker (`public/sw.js`):** handles `notificationclick` (opens app +
deep-links to task via URL hash) and `notificationaction` (routes complete/snooze
back to running app via `postMessage`). No app state — just fires and forwards.

---

## Startup Flow

1. `index.html` loads; Vite serves `main.js` as a module
2. `main.js` registers the Service Worker, then imports `app.js`
3. `app.js` opens IndexedDB; ensures `Focus` area exists (seed on first run);
   constructs models, views, controller
4. Controller reads URL hash → activates view → subscribes to model → renders
5. Controller kicks `scheduler.bootResync()` to re-schedule any missing notifications

---

## Verification Plan

### Unit-testable pure functions
- `recurrence.nextOccurrence()` — all 4 types + edge cases (leap year, month-end clamp)
- `scheduler.adjustForQuietHours()` — various triggerAt / settings / critical combos
- `utils.linkifyUrls()` — titles/notes with and without URLs

### Manual end-to-end scenarios
1. Create task, set `dueAt` 2 min from now → verify notification fires
2. Create task with `leadTime` 5 min, `dueAt` 10 min from now → verify two notifications
3. Mark a daily recurring task complete → verify `dueAt` rolls forward, notifications reschedule
4. Set `dueAt` during quiet hours → verify notification shifts to `quietEnd`
5. Mark task critical, set `dueAt` in quiet hours → verify fires at actual `dueAt`
6. Close browser entirely past trigger time → verify notification fires (Chromium install)
7. Uninstall + reinstall app → verify scheduled notifications restore on boot
8. Firefox/Safari: fallback banner appears; missed reminders land in Overdue

### Integration checks
- PWA installability (Lighthouse audit ≥ 90 on PWA score)
- IndexedDB migrations work on schema version bump
- Data export → import round-trips identically

---

## Milestone Sketch

Rough ordering — each is a shippable chunk. The writing-plans skill expands these into
a detailed implementation plan:

1. **Scaffold + data layer** — Vite project, Biome, IndexedDB wrapper, model
   factories (tasks, areas, sections, settings), Focus-area seed, recurrence
   pure functions with unit tests
2. **Today view + capture bar** — sidebar, NEXT card, Overdue/Today/Starred groups,
   quick-capture bar, basic task-row component, check/star/delete actions
3. **Area view + section management** — click area → area view, section H2 blocks,
   per-section add-task, collapsible sections
4. **Reminder scheduling (core)** — notification permission, Service Worker
   registration, Notification Triggers scheduling, one-off reminders working
   end-to-end
5. **Recurring + lead-time** — recurrence rollover on complete, lead-time
   notifications, boot-resync flow
6. **Quiet hours + critical** — settings UI, quiet-hours math, critical override
   (per-area + per-task), visual indicator
7. **Snooze + notification actions** — in-app snooze menu, notification action
   buttons, SW → app postMessage round-trip
8. **PWA polish** — manifest, install prompt, icons, dark-mode CSS pass,
   Lighthouse audit, Firefox/Safari fallback banner
9. **Data export/import** — JSON round-trip, settings page wiring
10. **Pre-release** — README, license (MIT), GitHub repo, deploy to static host
    (Netlify/Vercel), test install on Brave
