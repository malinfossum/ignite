# Ignite: backup, restore and the Amplenote import

**Date:** 2026-11-09
**Status:** design agreed section by section (2026-11-09) · stress-tested 2026-11-09 (findings folded in, see §14 and the record line) · no plan yet
**Project:** 1 of 5 on the platform roadmap (reordered 2026-10-27: import/export, sync, React + TS rewrite, Android app, then my switch from Amplenote)
**Supersedes:** nothing.

---

## 1. Goal

I can save everything in Ignite to one file and put it back later. And on the day I switch, my open Amplenote tasks arrive in Ignite intact: in the right areas and sections, with their dates, stars, reminder offsets and repeats.

The backup also protects real data before sync (project 2) ever touches it.

**What I see in this project:** a Settings page with a Backup group and an Import group, a confirm dialog, an import report, and a banner when my last backup is more than a week old.

### Non-goals

Sync and accounts (project 2) · reminders (project 3) · importing completed or dismissed Amplenote tasks (that history stays in my Amplenote ZIP) · merging an import into existing data (every import and restore replaces) · Amplenote's non-task text and images (listed in the report, left behind) · automatic scheduled backups (a browser can't save files without a click) · a settings field for anything except `lastBackupAt`.

---

## 2. Hard requirements

These override every other section. A task in the plan that breaks one stops and asks.

**R1. My data never leaves the device.** Backup, restore and import all run in the browser. No network request carries a backup, an export or a report. The Amplenote plugin runs inside Amplenote, calls no network API (no `fetch`, no `app.*` call that sends data elsewhere) and only saves a local file. The ZIP is read in memory and never stored: only the imported tasks land in IndexedDB, and left-behind text is counted, never kept or shown. No agent working on this project ever opens my real ZIP, a report built from it, or a backup of my real data. The checks in §12 that touch them are local scripts that print counts only.

**R2. Nothing is lost, nothing is half-written.**

- Every check passes before anything is written. A refused file writes nothing.
- Every replace runs in one IndexedDB transaction, so it either lands whole or not at all.
- A safety backup of the current data downloads before every replace.
- Every open Amplenote task in a picked note arrives as a task, even if its metadata is broken. What can't be mapped goes on the report. Nothing is dropped silently.

**R3. Every screen size.** The Settings page, the checklist, the dialogs and the banner work and look finished at 320, 768, 1024, 1280, 1600 and 1920 px, measured on the rendered page before I review it.

---

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | The Amplenote **Markdown ZIP is the backbone**. An optional **Amplenote plugin** adds repeat rules, joined by task `uuid`. | The ZIP has notes, headings and emoji but no repeat rule (checked on a monthly task 27.10). The plugin API has `repeat` but no heading per task. Each fills the other's gap. Without the plugin the import still works, only repeats are missing. |
| D2 | Build on a branch from **`main`**, not `feat/accounts-sync`. | That branch can't be released before its Task 15, and sync is paused. Import/export ships on its own. |
| D3 | Pure modules with TDD in `src/backup/`, one I/O seam `db.replaceAll`. | Same rule as today: TDD on the pure seam, views checked in the browser. |
| D4 | Restore and import **replace**, never merge. | Restore means "back to this file". The switch-day import is a fresh start, and the trial week before it is a dress rehearsal. |
| D5 | Undo after a replace uses an **in-memory snapshot**, not a stored one. | Storing it in IndexedDB needs a database version bump, which collides with the sync branch's version 2. The safety download covers a closed tab. |
| D6 | Amplenote `important` becomes **`starred`**. | That's what a star means to me. |
| D7 | Past Amplenote dates are **kept**. | The import must not quietly undate tasks. Triage is a switch-day job. |
| D8 | ZIP reading uses **`fflate`** (0.8.3, MIT, no dependencies, read from the npm registry 09.11; pinned exact, no caret), **imported statically**. | A hand-written ZIP reader is format code full of edge cases. A static import keeps it in the precached bundle, so it works offline. A lazy chunk would bring back the offline break the dynamic `import("./app.js")` caused. Install approved 09.11. |
| D9 | The backup file **excludes settings**. | Theme and sidebar state belong to the device, not to my data. |
| D10 | **No Amplenote counts in this spec, the plan or the tests.** | My notes change every day. The checklist and the report count live from the file I pick. Tests use invented data only. |

---

## 4. Architecture

```
src/backup/
  backup-format.js    serialise and validate an Ignite backup (pure)
  amplenote-parse.js  ZIP entries → notes: front matter, headings, task lines (pure)
  amplenote-map.js    picked notes + repeats → areas, sections, tasks + report (pure)
  rrule.js            RRULE string → Ignite recurrence, or null with a reason (pure)
  download.js         Blob → file download through an <a download>
src/model/db.js       + replaceAll({ areas, sections, tasks })
src/model/settings.js + lastBackupAt (ISO string; a missing field reads as null, so no migration)
src/views/settings.js the #settings page
src/views/backup-banner.js
src/views/import-report.js
tools/amplenote-plugin/  plugin source, its pure function, README
```

- `controller.js` gains the `#settings` route in `parseHash` and wires the page's callbacks. Views stay free of model calls, as in every other view.
- **`replaceAll`** opens one `readwrite` transaction over `areas`, `sections` and `tasks`, clears all three and puts every record (in storage shape, through the existing `toStorage`). It resolves on `oncomplete` and rejects on `onerror`/`onabort`, matching `run`'s commit rule. Models are notified after it resolves, so every view re-renders from the new data.
- `settings` is never touched by a replace.
- **Every replace takes a safety backup first.** That covers restore, import, and undo (an undo is a replace too), so an edit made between a replace and its undo is never lost.
- **Other open tabs:** after `replaceAll` resolves, a `BroadcastChannel("ignite")` message tells every other Ignite tab to reload. Without it, a stale tab would write tasks into sections that no longer exist.
- **Parsed input never becomes a plain object keyed by file data.** The repeats file's `tasks` and the front matter are read into a `Map`, and keys are checked against a uuid pattern, so a `__proto__` key can't pollute anything.
- **All imported text reaches the DOM through `escapeHtml`**: area and section names, titles, note names in the checklist and every line of the report. The views that already show areas, sections and tasks escape today, and the new views follow the same rule.

---

## 5. The backup file

Named `ignite-backup-YYYY-MM-DD-HHMM.json` in local time, so the files sort in order.

```json
{
  "app": "ignite",
  "schemaVersion": 1,
  "appVersion": "0.9.0",
  "exportedAt": "2026-11-09T13:03:00.000Z",
  "areas": [],
  "sections": [],
  "tasks": []
}
```

- **Records use the model shape** (booleans `true`/`false`), converted through `fromStorage`/`toStorage`. The 0/1 IndexedDB quirk stays inside the model.
- **Ids are kept.** A restore is a true restore.
- **Fields, schema version 1:**
  - area: `id`, `name`, `icon`, `critical`, `order`
  - section: `id`, `areaId`, `name`, `collapsed`, `order`
  - task: `id`, `sectionId`, `title`, `notes`, `completed`, `starred`, `critical`, `dueAt`, `hasTime`, `recurrence`, `lastCompletedAt`, `completedCount`, `leadTime`, `scheduledTags`, `createdAt`, `order`
- **Unknown keys are refused.** A field added to the model later bumps `schemaVersion`, and the reader migrates older versions forward in code. The file format never drifts silently.

### Validation (`validateBackup(json) → { ok: true, data } | { ok: false, reason }`)

1. The text parses as JSON. Over **10 MB** is refused before parsing.
2. `app === "ignite"`. A `schemaVersion` above the newest the app knows is refused with "This backup was made by a newer Ignite. Update Ignite first."
3. Every record has every required field with the right type, and no unknown key. `dueAt`, `lastCompletedAt` and `createdAt` are valid ISO strings or `null` where the model allows it. `recurrence` is `null` or a shape `nextOccurrence` accepts.
4. Ids are unique per store.
5. The Focus area (`id: "focus"`) and its section (`focus-default`) are present.

The first failure is returned as one plain sentence ("Task 12 has no title."). Nothing is written.

**Orphans are repaired, not refused.** A backup Ignite made itself must always restore, and a real database can hold an orphan (my dev database has a `sections` row whose `areaId` matches no area). So broken links are `repairs`, returned beside `data`:
- A section whose area is missing is dropped if it has no tasks. Its tasks, if any, move to the Focus notepad.
- A task whose section is missing moves to the Focus notepad.

The confirm dialog lists every repair in counts ("1 task whose section is missing goes to the Focus notepad."). **Back up now** never refuses: it writes what is there, orphans included, so the file is an exact copy.

---

## 6. Restore flow

1. **Restore from file…** opens a file input (`accept=".json,application/json"`).
2. The file is read and validated. A refusal shows inline in the Backup group (`role="alert"`) and stops.
3. A **confirm dialog** shows both sides in counts: "Replace 4 areas, 13 sections and 170 tasks with 3 areas, 9 sections and 41 tasks." It lists any repairs (§5) and names the safety file that will download first. The buttons are **Replace** and **Cancel**, with focus starting on Cancel.
4. On Replace: the button disables at once, so a double press can't run two replaces. The current data is snapshotted and **the safety backup downloads**. If building or starting that download throws, the flow stops here and nothing is replaced. Then `replaceAll` runs, and `lastBackupAt` is stamped (the safety file is a full backup).
5. **Undo, in two places.** The usual toast says "Restored from ignite-backup-….json." with **Undo**. Its 5 s timer is far too short for undoing a whole restore, so the Backup group also shows a persistent **Undo last replace** button until the next app start. Either one runs a replace with the snapshot, taking its own safety backup first (§4). After an undo, both disappear.
6. Focus returns to **Restore from file…**, the control that started the flow. The Settings view renders once and updates its values in place, so a model notify never destroys the focused control.

The page can't confirm that the browser saved the download. The dialog's wording and the persistent undo cover that gap (D5). The plan checks it in Brave with "ask where to save" both on and off.

---

## 7. The Amplenote import

### 7.1 Sources

- **The ZIP** from Amplenote's web or desktop app: Account settings → Import & Export. It's required. It holds one Markdown file per note with YAML front matter (`title`, `uuid`, `version`, `created`, `updated`, `tags`, `storage`). Vault notes aren't in it.
- **The repeats file** from the plugin (§7.2). It's optional. Without it, tasks import with `recurrence: null`, and the report says repeats were not included.

### 7.2 The plugin (`tools/amplenote-plugin/`)

A personal Amplenote plugin: one note holding a settings table and a code block, installed from that note's menu. It's never published. One action, "Export repeats for Ignite":

1. List every note (`app.filterNotes`), then each note's open tasks (`app.getNoteTasks`, which excludes done and dismissed tasks by default).
2. Build `{ uuid → { repeat, isRepeating } }` for **every** open task, repeating or not. That way a task missing from the file means the file is stale, not that the task doesn't repeat.
3. Save it with `app.saveFile` as `amplenote-repeats-YYYY-MM-DD.json`:

```json
{
  "app": "ignite-amplenote-repeats",
  "version": 1,
  "exportedAt": "2026-11-09T13:00:00.000Z",
  "tasks": { "<uuid>": { "repeat": "FREQ=MONTHLY;BYMONTHDAY=1", "isRepeating": true } }
}
```

The file holds **no titles and no note names**, so it's harmless anywhere.

The building step is a pure function (`buildRepeatsFile(tasks, now)`) living in its own module, so vitest can test it. The plugin note pastes that module's code. The README covers install, run and where the file lands.

**Assumptions the plan checks first, on my real account, through a local script that prints counts only:** the plugin installs on my plan (the docs don't say whether the free plan allows plugins); `app.saveFile` works in the app I use; the API's task `uuid` equals the `uuid` in the ZIP's task comment; and the real RRULE strings are the shape §7.5 expects (the docs give no example). If the uuids don't match, the plugin is dropped, and the spec gets a revision before any import code depends on it.

### 7.3 Parsing (`parseAmplenoteZip(bytes) → { notes, problems }`)

- Only `.md` entries are decompressed. Other entries (images) are counted per note, never unpacked.
- **Caps:** 100 MB for the ZIP, and 50 MB total of **actually inflated** `.md` bytes. A ZIP header's declared size can lie, so the entries are inflated through `fflate`'s streaming `Unzip`, counting chunks, and the parse aborts the moment the running total passes 50 MB. This guards against a ZIP bomb.
- **Front matter:** a small YAML reader for this exact shape. Plain, single-quoted and double-quoted scalars are supported, with double-quoted escapes decoded (`\U0001F4DD`, `\u00e6`, `\x41`, `\"`, `\\`, `\n`). `tags` is a list. Anything else on a line it doesn't understand turns that note into a problem ("Couldn't read this note's header."). The note is greyed out in the checklist, and the other notes still import.
- **Body, line by line:**
  - `#` to `######` heading → a heading (its text with Markdown emphasis removed).
  - `- [ ] text<!-- {json} -->` → an open task. `- [x] …` and tasks with `completedAt`, `dismissedAt` or `crossedOutAt` are skipped.
  - A task line whose JSON comment won't parse is still an open task, with its title and no metadata, plus a problem entry.
  - Indented lines under a task, and every other line, are **left-behind text**, counted per note.
- A ZIP with no `.md` entry that has front matter is refused: "This doesn't look like an Amplenote export."

### 7.4 Mapping (`mapAmplenote(notes, pickedUuids, repeats) → { areas, sections, tasks, report }`)

**Structure:**
- **Picked note → area.** If the title's first grapheme (found with `Intl.Segmenter`) is an emoji (`\p{Extended_Pictographic}`), it becomes the `icon` and the rest, trimmed, becomes the `name`. Otherwise the icon is empty. A name left empty (a note titled only "📝") becomes "Untitled". Areas are ordered by name (`localeCompare` with `"nb"`), ties broken by note `uuid` so the order is the same on every run, after Focus.
- **Heading → section**, flat at any level, in note order. Tasks before the first heading go to a section called **"Tasks"**. A heading with no open tasks under it creates no section. A heading whose text is empty after stripping becomes "Untitled section". Two headings with the same text stay two sections.
- **Focus** keeps its area and its `focus-default` section with the same ids. Its notepad is emptied with everything else (D4).
- New ids come from `utils/id.js`. `order` follows the position in the note.

**Task fields:**

| Amplenote | Ignite |
|---|---|
| line text | `title`: Markdown emphasis removed, `[text](url)` → `text (url)` (only `url` when the two are equal), through the same `capitalizeFirst` as capture |
| `startAt` (Unix seconds) | `dueAt` ISO, `hasTime: true` (Amplenote dates always carry a time) |
| `important: true` | `starred: true` (D6) |
| `notify` `PT5M` / `PT15M` / `PT1H` / `PT24H` (any ISO 8601 duration in minutes, hours, days) | `leadTime` in minutes; `false` or missing → `0` |
| repeats file entry | `recurrence` via `rrule.js` (§7.5) |
| `urgent`, `hideUntil`, `hideRule`, `duration`, `deadline`, `score`, `victoryValue` | dropped, counted on the report |

Everything else gets the same defaults `tasks.create` gives: `notes: ""`, `completed: false`, `critical: false`, `lastCompletedAt: null`, `completedCount: 0`, `scheduledTags: []`, and `createdAt` set to the import time.

### 7.5 Repeats (`rruleToRecurrence(rrule, startAt) → { recurrence } | { recurrence: null, reason }`)

The input may carry a `DTSTART` line or an `RRULE:` prefix; only the rule part is read. Where the rule leaves a part out, it comes from `startAt` in local time, as RFC 5545 does with `DTSTART`.

| RRULE | Ignite |
|---|---|
| `FREQ=DAILY;INTERVAL=n` | `{ type: "daily", interval: n }` |
| `FREQ=WEEKLY;BYDAY=MO,TH` | `{ type: "weekly", interval, weekdays: [1, 4] }` (`SU` = 0); no `BYDAY` → the weekday of `startAt` |
| `FREQ=MONTHLY;BYMONTHDAY=d` | `{ type: "monthly", interval, day: d }`; `-1` → `day: 31`, which Ignite already clamps to the month's last day; no `BYMONTHDAY` → the day of `startAt` |
| `FREQ=YEARLY;BYMONTH=m;BYMONTHDAY=d` | `{ type: "yearly", interval, month: m, day: d }`; missing parts come from `startAt` |

**Not mapped, `null` with a reason on the report:** `BYSETPOS` and `BYDAY` with an ordinal (`1MO`, "first Monday"), `COUNT`, `UNTIL`, `BYHOUR` and smaller parts, several `BYMONTHDAY` values, other negative days, `HOURLY` and smaller frequencies, and any part the parser doesn't know. **Relative repeats** (`isRepeating: true`, `repeat: null`) go on the report as "repeats after completion; set by hand". A rule is never guessed.

---

## 8. The import report

It opens in a dialog right after the import, with a **Download report** button that saves `ignite-import-report-YYYY-MM-DD-HHMM.txt`. It's my switch-day to-do list. Sections, each left out when empty:

1. **Imported:** tasks per area, and the totals.
2. **Repeats to set by hand:** task title, area, and the reason (relative, unsupported part, no repeats file entry).
3. **Problems:** notes that couldn't be read, tasks with broken metadata.
4. **Dropped fields:** a count per field.
5. **Left behind:** lines of text and images, per note.
6. **Repeats file:** whether it was used, how many entries matched, how many tasks had no entry, how many entries matched no task.

Titles are rendered through `escapeHtml`, like every other user text.

---

## 9. Screens

### 9.1 The Settings page (`#settings`)

- `parseHash` learns `settings` → `{ name: "settings" }`. The page renders in `#main` with `<h1>Settings</h1>`. The capture bar is hidden on this route, as it is on the area route.
- **Entry point:** a **Settings** button in the sidebar footer beside Theme, painted as a tile on the collapsed rail with `aria-label="Settings"`, and `aria-current="page"` while the route is active. It follows the rail invariants in `main.css` (rules inside the 768 px media query, 44 px targets painted as 36 px tiles).

**Backup group:**
- A label and value pair: "Last backup" and `09.11.2026 13:20`, or "Never".
- One line under it: "The file holds all your tasks in plain text. Keep it somewhere private."
- **Back up now** downloads a backup, stamps `lastBackupAt` and toasts "Backup saved as ignite-backup-….json."
- **Restore from file…** runs §6.
- **Undo last replace**, only while a replace from this app start can still be undone (§6).

**Import from Amplenote group**, three steps on the page:
1. **Choose files.** "Amplenote export (ZIP)" is required. "Repeats file (optional)" carries one line on what's missing without it, plus a link to the plugin README.
2. **Pick notes.** A `fieldset` with a `legend`. One checkbox row per note, 44 px tall, the `<label>` wrapping the checkbox so the whole row is the target: icon, name, and "N open tasks" set apart as a label/value pair. Long names wrap rather than clip. Notes with no open tasks, and notes that couldn't be read, are disabled, with the reason tied to the checkbox through `aria-describedby`. Every enabled note starts checked. **Import** stays disabled while no checked note has an open task.
3. **Import.** The same confirm dialog as §6 ("Replace … with …. Focus stays, its notepad is emptied."), the safety backup, `replaceAll`, then the report dialog (§8). Closing the report returns focus to **Import**.

- **File inputs** stay in the accessibility tree: visually hidden, never `display: none`. Their visible `<label>` is styled as a 44 px button and shows the focus ring through `:has(:focus-visible)`. After a pick, the chosen file name shows beside it.
- **Announcements:** each group holds one alert region (`role="alert"`) rendered empty with the page, and its text is set on failure. Successes go through the existing toast. Navigating to `#settings` focuses the `<h1>`, as other routes focus their heading.
- **Long work:** parsing a big ZIP shows "Reading the export…" in the group's status line. If I leave the page before it finishes, the view's destroy marks the flow as cancelled, and the late result is dropped instead of reaching a removed view.
- The dialogs follow the schedule dialog's pattern (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus kept inside, Esc closes, focus back on the trigger), so there's no second dialog system.
- **Layout:** mobile-first, built from design-system layout primitives. Controls on one row share one height and one bottom edge. The groups are cards of a capped width in an auto-fill grid. That gives one column on a phone, two from 1024 px, and more as later settings join the page, rather than one column stretched wide.

### 9.2 The backup banner

- Shown at the top of `#main`, above the page heading, when `tasks.length > 0` **and** either `lastBackupAt` is `null` or it's more than 7 days old. A new user with an empty app never sees it, so it doesn't collide with the welcome text.
- Text: "Your last backup was 9 days ago." or "You haven't made a backup yet." Buttons: **Back up now** and **Not now**.
- **Not now** hides it until the next app start. That's held in memory, not as a setting.
- A `lastBackupAt` in the future (a clock set back) counts as "just now": no banner, and Settings shows the stored date as it is.
- It's not shown on the Settings page itself, where the Backup group already says the same.

---

## 10. Errors

Every failure has its own visible copy. Ignite's UI is English only, so there's one language to write.

| What goes wrong | What happens | Copy |
|---|---|---|
| Backup file isn't JSON, or over 10 MB | Inline refusal. Nothing written. | "This file isn't an Ignite backup." / "This file is over 10 MB, so it can't be an Ignite backup." |
| Backup from a newer Ignite | Inline refusal. Nothing written. | "This backup was made by a newer Ignite. Update Ignite first." |
| Backup fails a field check (§5) | Inline refusal naming the first problem. Nothing written. | "This backup is damaged: task 12 has no title." |
| ZIP isn't an Amplenote export | Inline refusal. Nothing written. | "This doesn't look like an Amplenote export." |
| ZIP over 100 MB, or over 50 MB inflated | Inline refusal. Nothing written. | "This export is too big to read here." |
| One note's front matter unreadable | That note is disabled in the checklist. The rest import. | "Couldn't read this note's header." |
| A task's JSON comment broken | Task imported with its title. On the report under Problems. | "Imported without its date and flags: the metadata was damaged." |
| Repeats file wrong shape or wrong `app` | Refused at step 1. I can remove it and go on. | "This isn't a repeats file from the Ignite plugin." |
| Repeats file and ZIP out of step | Joined by uuid. Misses are counted both ways on the report. | (report section 6) |
| Safety download throws | Stop before `replaceAll`. Nothing replaced. | "Couldn't save the safety backup, so nothing was replaced." |
| `replaceAll` fails (such as quota) | The transaction aborts, so the old data is untouched. | "Couldn't replace your data. Nothing was changed." |
| Undo fails | The data stays as the replace left it. | "Couldn't undo. Your data from before is in ignite-backup-….json." |

---

## 11. Testing

**TDD, vitest, invented data only (D10):**
- `backup-format`: a round trip through the models' storage shape, then one test per refusal (bad JSON, over 10 MB, wrong `app`, newer schema, missing field, wrong type, unknown key, a `__proto__` key, duplicate id, missing Focus). Orphan repairs: a section with no area and no tasks is dropped; its tasks, and a task with no section, land in the Focus notepad; the repairs are counted. **A backup of a database holding an orphan must restore** (the case my dev database is in).
- `amplenote-parse`: test ZIPs built in the test with `fflate`'s `zipSync` from strings. Covers front matter escapes, headings, open, ticked and stamped tasks, broken JSON comments, left-behind text, a non-`.md` entry that's never decompressed, the 100 MB cap, and **an entry whose header declares a small size but inflates past 50 MB**, which must abort.
- `amplenote-map`: emoji split (including a multi-code-point emoji), the no-emoji case, an emoji-only title, heading levels, the "Tasks" fallback, empty and duplicate headings, link rewriting, `leadTime` for every duration form, `important` → star, past dates kept, Focus kept but emptied, tie order by uuid, and the repeats join counted both ways, with a `__proto__` key in the repeats file ignored.
- `rrule`: every row of §7.5, the `startAt` fallbacks, every unsupported part.
- `buildRepeatsFile`: the shape, non-repeating tasks included, no title in the output.
- `db.replaceAll` on `fake-indexeddb`: replaces all three stores, leaves `settings` alone, and an aborted transaction leaves the old data in place.
- `parseHash("#settings")`, and the banner rule (`null`, 7 days, 8 days, a future date, an empty database).

**In the browser (no view unit tests, as everywhere else):**
- The whole flow on a throwaway origin with demo data: backup, restore, both undo paths, import with and without a repeats file, the report download, the banner and Not now.
- A keyboard-only walk through Settings, both dialogs and the checklist: focus lands on the `<h1>`, returns to each trigger, and never drops to `<body>`.
- A double press on Replace runs one replace and downloads one safety file.
- Two tabs open: a restore in one reloads the other.
- Leaving `#settings` mid-parse throws no error.
- Layout measured at 320, 768, 1024, 1280, 1600 and 1920 px, collapsed rail included, plus 200 % text at 320 px (R3).
- The safety download in Brave with "ask where to save" on and off.
- The bundle size before and after `fflate`, with both numbers in the PR.

---

## 12. Owed to me (only I can do these)

1. **Before any import code:** install and run the plugin on my account. A local script compares its file with my ZIP and prints counts only: uuids matched, uuids missing either way, the set of RRULE part names seen. This settles the §7.2 assumptions.
2. **After the build:** the dress-rehearsal import on my real ZIP, on the live site, and a read through the report.

---

## 13. Where this meets later projects

- **Sync (project 2):** when `feat/accounts-sync` merges, `replaceAll` must also clear the outbox and treat the result as a fresh upload, or a restore would leave stale outbox writes behind. `db.js` will conflict at that merge (version 1 here, version 2 there), and the merge resolves it by moving `replaceAll` onto the version 2 `transact`.
- **React rewrite (project 4):** the pure modules carry over unchanged. Only `views/settings.js`, the banner and the report dialog are rewritten.
- **Settings surface:** the `/` shortcut toggle from the cascade-focus spec's Appendix A lands on this page later.

---

## 14. Considered and rejected

- **A length cap on imported titles.** The ZIP caps already bound the input, and cutting a title would break R2.
- **Refusing a backup with broken links.** A backup Ignite made itself must always restore. Repairing into the Focus notepad (§5) keeps every task.
- **Storing the undo snapshot in IndexedDB.** It needs a database version bump that collides with the sync branch (D5). The persistent undo button plus the safety file cover a closed tab.
- **Encrypted backups.** A password I must keep for a local file I already control. The Settings copy says the file is plain text.
- **Zip-slip checks on entry paths.** Entries are only read in memory, never written to disk, so a `../` path can't reach anything.
- **Parsing in a Web Worker.** An export is a few MB of Markdown. The status line covers the wait, and a worker would add a second entry point to precache.
- **Legal duties.** Everything stays on my device and nobody else receives it, so no GDPR duty is triggered. fflate's MIT licence fits Apache-2.0. Exporting my own data through Amplenote's own export and a personal plugin uses the features as offered.

> Stress-tested 2026-11-09 (skill a217382): 21 applied, 3 adapted, 0 decided by me.
