# Ignite backup, restore and the Amplenote import: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** I can save everything in Ignite to one file and put it back, and my open Amplenote tasks import into the right areas and sections with their dates, stars, reminder offsets and repeats.

**Architecture:** Pure modules in `src/backup/` (TDD with vitest) do all the format work: backup serialise/validate, ZIP parse, Amplenote mapping, RRULE conversion. One I/O seam, `db.replaceAll`, swaps all three data stores in one IndexedDB transaction. A new `src/settings-flows.js` orchestrates the flows (safety backup, replace, undo, import) so `controller.js` only gains the route and the wiring. Views (`#settings`, two dialogs, a banner) are checked in the browser, as everywhere else in this repo.

**Tech Stack:** Vanilla JS (ES modules, MVC), Vite 8, vitest 5 with `fake-indexeddb`, Biome 2.6, `fflate` 0.8.3 (the first runtime dependency).

**Spec:** `docs/superpowers/specs/2026-11-09-ignite-import-export-design.md`. Read it before any task. This plan argues from it and names every place it departs from it (see "Where this plan departs from the spec").

## Global Constraints

- **R1.** No network request carries a backup, an export, a repeats file or a report. No agent opens Malin's real ZIP, a report built from it, or a backup of her real data. Checks on real data are local scripts that print counts only, run by Malin.
- **R2.** Every check passes before anything is written. Every replace runs in one IndexedDB transaction. A safety backup downloads before every replace (restore, import and undo). Every open Amplenote task in a picked note arrives as a task.
- **R3.** Settings page, checklist, dialogs and banner measured at 320, 768, 1024, 1280, 1600 and 1920 px, collapsed rail included, plus 200 % text at 320 px.
- **D10.** No real Amplenote counts in the plan, the code or the tests. Tests use invented data only.
- `fflate` pinned exact: `"fflate": "0.8.3"` in `dependencies` (no caret), imported statically, never `import()`.
- All user-visible text and every interpolated string reaching `innerHTML` goes through `escapeHtml` (`src/utils/dom.js`). Status and alert lines are set with `textContent`.
- Parsed file data is never a plain object keyed by file content: use `Map`, and check uuid keys against `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.
- UI copy is English. No em dashes anywhere (copy, comments, commits). Times take a colon (`13:20`), dates take periods (`09.11.2026`). File names use ISO-ish stamps (`2026-11-09-1320`).
- Every control on one row is 44 px tall and shares one bottom edge. Use `.repeat-btn` (44 px) for buttons and button-styled labels, not the design system's `.btn` (42 px).
- Mobile-first CSS: base rules for 320 px, `@media (min-width: 768px)` and up only. No `max-width` queries. `design-system/` is read-only.
- Every `<h2>` uses `--text-lg`. `renderPageHeader` in `controller.js` stays the only `<h1>` emitter.
- Biome clean (`npm run check`), all tests green (`npm run test:run`), `npm run build` green before every commit. The code blocks in this plan are written to be read, not pre-formatted: run `npx biome check --write <the files the task touched>` before `npm run check`, and accept Biome's formatting.
- No agent opens, prints or lints `.dev.vars` or `.wrangler/` (leftovers from the paused sync work that can hold secrets). Task 1 Step 1 puts them in `.gitignore` first, so Biome skips them.
- Commits: conventional prefix, Malin's voice, **no `Co-Authored-By` trailer, no AI attribution**.
- `settings` is never touched by a replace. The only new settings field is `lastBackupAt`.

## Review Focus

1. **A backup of an old database.** Tasks created before 24.06.2026 have no `completedCount`/`lastCompletedAt`, and tasks before 13.08.2026 have no stored `hasTime` (checked with `git log -S` on `src/model/tasks.js`). A strict validator would refuse a backup Ignite made itself. Expected: the writer fills schema-v1 defaults, and the file restores. Pinned in Task 4.
2. **Amplenote subtasks.** The plugin API has `isParent`/`parentUUID`, so an open subtask is an indented `- [ ]` line in the ZIP. The spec's "indented lines are left-behind text" would drop it silently, which breaks R2. Expected: it imports as an ordinary task, and the report counts it. Pinned in Tasks 9 and 10.
3. **CRLF line endings and a UTF-8 BOM** in a note file. Expected: the front matter and the tasks parse exactly as with LF. Pinned in Task 9.
4. **Uppercase uuids** in either file. Expected: the repeats join is case-insensitive. Pinned in Task 10.
5. **A task with no text** (`- [ ] <!-- {...} -->`, or a line holding only an image). Expected: it still arrives, titled "Untitled task". Pinned in Task 10.

## Where this plan departs from the spec

Each is small and protects a hard requirement or matches the real code. Malin reviews them with the plan.

1. **The capture bar** is *not* hidden on the area route today (`main.css:700`: "capture bar stays visible on both routes"). The Settings route hides it with its own `body.is-settings-route` class.
2. **Subtasks import as tasks** (Review Focus 2). Spec §7.3 said indented lines are left behind.
3. **The backup writer normalises records** to the schema-v1 field list (Review Focus 1). Fields missing from old records, or holding a value the reader would refuse (a `null` note, a date in another format, a rule key the model doesn't know), get `tasks.create`'s defaults, and keys outside the schema are not written. So every file Ignite writes, the safety backups included, passes its own reader. The spec's "exact copy" holds for every value the reader accepts.
4. **`lastBackupAt` is stamped right after the safety download succeeds**, before `replaceAll`. The file is a full backup whatever happens to the replace.
5. **"Models are notified"** becomes one `applyState()` call after `replaceAll`. The controller is every model's only subscriber, so the effect is the same without exposing three private `notify`s.
6. **New files beyond §4's list** (and `.gitignore`, see 19): `src/model/data.js` (snapshot + replaceAll with the task storage conversion), `src/settings-flows.js` (the flows), `src/views/confirm-dialog.js`, `src/backup/backup-due.js`, `tools/amplenote-plugin/build-note.mjs` and `check-join.mjs`.
7. **`parseAmplenoteZip` returns `{ ok, notes, otherFiles }`** (problems live on each note), and **`mapAmplenote` takes the whole parse result**, so it can count other files.
8. **Images are counted from `![…](…)` lines** in each note, and other ZIP entries are counted as one total, because the ZIP's folder layout is unknown. The check in Task 1 prints that layout's shape.
9. **"Navigating to `#settings` focuses the `<h1>`, as other routes do"**: no other route does this today. Only `#settings` gets it.
10. **Back up now failing** has no copy in §10. It uses "Couldn't save the backup."

Added by the plan stress test (09.11.2026):

11. **The Settings route lifts `#main`'s 42rem reading cap** (`body.is-settings-route { --main-max-width: none; }`) and the cards' minimum drops from 22rem to 20rem. Under the cap, §9.1's "two columns from 1024 px, more later" could never happen at any width.
12. **The page header is written only when its markup changes**, on every route, and each `<h1>` carries `tabindex="-1"`. The spec doesn't say where focus goes when the banner closes; it goes to the `<h1>`, which a rewrite on the next tick would otherwise destroy.
13. **`replace` returns an outcome instead of writing the alert.** Its caller closes the dialog first, then shows the message, because an alert written into the `inert` background isn't announced. The dialog closes in a `finally`, so a throw can never leave it open with its buttons disabled.
14. **A note with an unreadable header still has its body counted**, so its checklist row and the report name how many open tasks stay behind. It still can't be picked (§7.3).
15. **The import's last check is the backup reader.** The mapped areas, sections and tasks must pass `validateBackup` before the confirm dialog opens, so the database never holds a record a later restore would refuse.
16. **Copy not in §10:** "Couldn't turn these notes into tasks, so nothing was imported." (mapping or that check failed), "Imported without its date: the date couldn't be read." (a `startAt` outside Date's range, on the report), and the status lines "Read N notes from the export." and "Read repeat rules for N tasks." (the spoken result of each file pick).
17. **Weekly repeats every N weeks on several days** are refused when `WKST` is anything but `MO` or `SU` (and with `MO` when Sunday is one of the days). §7.5 has no `WKST` row; a different week start can group the days into different weeks, and a rule is never guessed.
18. **Flags and keycaps count as emoji** in note titles (`\p{Regional_Indicator}`, U+20E3), beside §7.4's `\p{Extended_Pictographic}`, which doesn't match them.
19. **`.gitignore` gains `.dev.vars` and `.wrangler/`** in Task 1, so Biome never reads files that can hold secrets.

## File map

| File | Responsibility |
|---|---|
| `tools/amplenote-plugin/build-repeats.js` | Pure `buildRepeatsFile(tasks, now)` |
| `tools/amplenote-plugin/build-note.mjs` | Prints the plugin note (settings table + code block) from `build-repeats.js` |
| `tools/amplenote-plugin/check-join.mjs` | Local count-only check of a real ZIP against a real repeats file |
| `tools/amplenote-plugin/README.md` | Install, run, where the file lands |
| `src/model/db.js` | + `readAll(storeNames)`, `replaceAll({ areas, sections, tasks })` |
| `src/model/tasks.js` | Exports `taskToStorage`, `taskFromStorage` |
| `src/model/areas.js` | Exports `FOCUS_DEFAULTS`, `FOCUS_DEFAULT_SECTION` |
| `src/model/data.js` | `createDataModel(db)` → `snapshot()`, `replaceAll(data)` in model shape |
| `src/model/settings.js` | + `lastBackupAt`, `setLastBackupAt(iso)` |
| `src/model/recurrence.js` | + `isValidRecurrence(rule)` |
| `src/backup/backup-due.js` | Banner rule, `formatBackupStamp`, `fileStamp` |
| `src/backup/backup-format.js` | Build, normalise, validate, repair, describe |
| `src/backup/download.js` | `downloadFile(content, fileName, type)` |
| `src/backup/rrule.js` | `rruleToRecurrence(rule, startAt)` |
| `src/backup/amplenote-parse.js` | `parseAmplenoteZip(bytes)`, `markdownToPlain(text)` |
| `src/backup/amplenote-map.js` | `parseRepeatsFile`, `splitTitle`, `noteChoices`, `mapAmplenote`, `reportSections`, `reportToText`, `reportFileName` |
| `src/settings-flows.js` | Back up, restore, undo, read ZIP, read repeats, import |
| `src/views/settings.js` | The `#settings` page |
| `src/views/confirm-dialog.js` | Replace/Cancel dialog |
| `src/views/import-report.js` | Report dialog |
| `src/views/backup-banner.js` | The stale-backup banner |
| `src/controller.js`, `src/app.js`, `src/views/sidebar.js`, `main.css` | Route, wiring, entry point, styles |

---

### Task 1: Branch, fflate, and the Amplenote plugin

**Files:**
- Create: `tools/amplenote-plugin/build-repeats.js`, `tools/amplenote-plugin/build-note.mjs`, `tools/amplenote-plugin/check-join.mjs`, `tools/amplenote-plugin/README.md`
- Test: `tests/tools/build-repeats.test.js`
- Modify: `package.json`, `package-lock.json` (fflate)

**Interfaces:**
- Produces: `buildRepeatsFile(tasks: Array<{ uuid, repeat?, isRepeating?, completedAt?, dismissedAt? }>, now: Date) → { app: "ignite-amplenote-repeats", version: 1, exportedAt: string, tasks: { [uuid]: { repeat: string|null, isRepeating: boolean } } }`. Task 10 reads exactly this shape.

- [ ] **Step 1: Branch and baseline**

This plan and the spec sit on `docs/import-export-spec`, which is `main` plus the spec commit. Commit this plan there first, so both travel with the feature branch (Task 13 edits the spec). Then:

```bash
git log --oneline main..HEAD   # expect only the docs commits (spec, plan)
git switch -c feat/import-export
git status --short
```

If `git status` lists `.dev.vars` or `.wrangler/` as untracked, add both lines to `.gitignore` before anything runs Biome (Biome follows `.gitignore`, and a diagnostic on those files could print a secret). Never open or `cat` them.

```bash
printf '\n# Wrangler (local secrets and state)\n.dev.vars\n.wrangler/\n' >> .gitignore
git add .gitignore
git commit -m "chore: ignore Wrangler's local secrets and state"
npm run build
```

Write down the `dist/assets/index-*.js` size and its gzip size from the build output. The PR needs it (spec §11).

- [ ] **Step 2: Install fflate, exact**

```bash
npm install fflate@0.8.3 --save-exact
```

Expected: `package.json` gains `"dependencies": { "fflate": "0.8.3" }` with no caret. npm collects no usage data, so there's no telemetry to switch off.

- [ ] **Step 3: Write the failing test**

`tests/tools/build-repeats.test.js`:

```js
import { describe, expect, it } from "vitest";
import { buildRepeatsFile } from "../../tools/amplenote-plugin/build-repeats.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-09T12:00:00.000Z");

describe("buildRepeatsFile", () => {
	it("has the app, version and export time", () => {
		const file = buildRepeatsFile([], NOW);
		expect(file).toEqual({
			app: "ignite-amplenote-repeats",
			version: 1,
			exportedAt: "2026-11-09T12:00:00.000Z",
			tasks: {},
		});
	});

	it("includes every open task, repeating or not", () => {
		const file = buildRepeatsFile(
			[
				{ uuid: A, repeat: "FREQ=DAILY", isRepeating: true },
				{ uuid: B, repeat: null, isRepeating: false },
				{ uuid: C, isRepeating: true },
			],
			NOW,
		);
		expect(file.tasks[A]).toEqual({ repeat: "FREQ=DAILY", isRepeating: true });
		expect(file.tasks[B]).toEqual({ repeat: null, isRepeating: false });
		expect(file.tasks[C]).toEqual({ repeat: null, isRepeating: true });
	});

	it("treats a repeat string as repeating even if isRepeating is missing", () => {
		const file = buildRepeatsFile([{ uuid: A, repeat: "FREQ=WEEKLY" }], NOW);
		expect(file.tasks[A].isRepeating).toBe(true);
	});

	it("skips done and dismissed tasks and bad uuids", () => {
		const file = buildRepeatsFile(
			[
				{ uuid: A, completedAt: 1 },
				{ uuid: B, dismissedAt: 1 },
				{ uuid: "__proto__", repeat: "FREQ=DAILY" },
				{ uuid: "not-a-uuid" },
				null,
			],
			NOW,
		);
		expect(Object.keys(file.tasks)).toEqual([]);
	});

	it("never writes a title or a note name", () => {
		const file = buildRepeatsFile(
			[{ uuid: A, content: "Ring the dentist", noteUUID: B, repeat: null }],
			NOW,
		);
		const text = JSON.stringify(file);
		expect(text).not.toContain("Ring the dentist");
		expect(text).not.toContain(B);
	});
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `npx vitest run tests/tools/build-repeats.test.js`
Expected: FAIL, cannot find `build-repeats.js`.

- [ ] **Step 5: Implement**

`tools/amplenote-plugin/build-repeats.js`:

```js
// Pure builder for the repeats file. It calls no Amplenote API, so vitest can
// test it. build-note.mjs pastes this file into the plugin's code block, so it
// must stay self-contained: no imports, only this constant and this function.

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildRepeatsFile(tasks, now) {
	const out = {};
	for (const task of tasks) {
		if (!task || typeof task.uuid !== "string" || !UUID_RE.test(task.uuid)) {
			continue;
		}
		if (task.completedAt || task.dismissedAt) continue;
		const repeat =
			typeof task.repeat === "string" && task.repeat !== "" ? task.repeat : null;
		out[task.uuid] = {
			repeat,
			isRepeating: task.isRepeating === true || repeat !== null,
		};
	}
	return {
		app: "ignite-amplenote-repeats",
		version: 1,
		exportedAt: now.toISOString(),
		tasks: out,
	};
}
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/tools/build-repeats.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 7: Write the note generator**

`tools/amplenote-plugin/build-note.mjs`:

```js
// Prints the Amplenote plugin note: a settings table and one code block.
// Usage: node tools/amplenote-plugin/build-note.mjs > plugin-note.md
// The code block inlines build-repeats.js, so the tested function and the
// installed one can't drift apart.

import { readFileSync } from "node:fs";

const source = readFileSync(
	new URL("./build-repeats.js", import.meta.url),
	"utf8",
)
	.replace(/^\/\/.*\n/gm, "")
	.replace(/^export /gm, "")
	.trim();

const body = source
	.split("\n")
	.map((line) => `\t\t\t${line}`)
	.join("\n");

const code = `{
	appOption: {
		"Export repeats for Ignite": async function (app) {
${body}

			const handles = await app.filterNotes({});
			const tasks = [];
			for (const handle of handles) {
				tasks.push(...(await app.getNoteTasks({ uuid: handle.uuid })));
			}
			const now = new Date();
			const file = buildRepeatsFile(tasks, now);
			const pad = (n) => String(n).padStart(2, "0");
			const day = \`\${now.getFullYear()}-\${pad(now.getMonth() + 1)}-\${pad(now.getDate())}\`;
			const blob = new Blob([JSON.stringify(file, null, 2)], {
				type: "application/json",
			});
			await app.saveFile(blob, \`amplenote-repeats-\${day}.json\`);
			await app.alert(
				\`Saved repeat rules for \${Object.keys(file.tasks).length} open tasks.\`,
			);
		},
	},
}`;

process.stdout.write(`| | |
|-|-|
| name | Ignite repeats export |
| icon | repeat |
| description | Saves the repeat rule of every open task to a local file for Ignite. Sends nothing anywhere. |

\`\`\`js
${code}
\`\`\`
`);
```

Run: `node tools/amplenote-plugin/build-note.mjs`
Expected: a table, then a `js` code block whose body contains `function buildRepeatsFile` and no `export`.

- [ ] **Step 8: Write the count-only check**

`tools/amplenote-plugin/check-join.mjs`. It settles spec §7.2's assumptions and Departures 2 and 8. It prints counts and key names only: never a title, a note name, a task text or a file path.

```js
// Local check, counts only. Compares an Amplenote ZIP with a repeats file.
// Usage: node tools/amplenote-plugin/check-join.mjs <export.zip> <repeats.json>
// Prints no titles, note names, task text or paths, so the output is safe to paste.

import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";

const [zipPath, repeatsPath] = process.argv.slice(2);
if (!zipPath || !repeatsPath) {
	console.error("Usage: node check-join.mjs <export.zip> <repeats.json>");
	process.exit(1);
}

const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
const names = Object.keys(entries);
const md = names.filter((n) => n.toLowerCase().endsWith(".md"));
const other = names.filter((n) => !n.toLowerCase().endsWith(".md") && !n.endsWith("/"));
const depth = (n) => n.split("/").length - 1;
const mdStems = new Set(md.map((n) => n.replace(/\.md$/i, "")));
const otherBesideNote = other.filter((n) => mdStems.has(n.split("/")[0])).length;

const decoder = new TextDecoder();
const TASK = /^(\s*)[-*+] \[([ xX])\] (.*)$/;
const frontKeys = new Set();
const commentKeys = new Set();
let withFront = 0;
// Indented front-matter lines that aren't list items: a folded long title,
// for example. Task 9's reader turns such a note into a header problem.
let frontContinuationLines = 0;
let openTop = 0;
let openIndented = 0;
let brokenComment = 0;
let imageLines = 0;
let crlf = 0;
const zipUuids = new Set();

for (const name of md) {
	const text = decoder.decode(entries[name]);
	if (text.includes("\r\n")) crlf++;
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
	let start = 0;
	if (lines[0] === "---") {
		const end = lines.indexOf("---", 1);
		if (end > 0) {
			withFront++;
			for (const l of lines.slice(1, end)) {
				const m = l.match(/^([A-Za-z_][\w-]*):/);
				if (m) frontKeys.add(m[1]);
				else if (/^\s+\S/.test(l) && !/^\s*-\s/.test(l)) frontContinuationLines++;
			}
			start = end + 1;
		}
	}
	for (const line of lines.slice(start)) {
		if (/!\[[^\]]*\]\([^)]*\)/.test(line)) imageLines++;
		const t = line.match(TASK);
		if (!t || t[2] !== " ") continue;
		const idx = t[3].lastIndexOf("<!--");
		let meta = null;
		if (idx !== -1) {
			const m = t[3].slice(idx).match(/^<!--\s*(\{.*\})\s*-->\s*$/);
			try {
				meta = m ? JSON.parse(m[1]) : null;
			} catch {
				meta = null;
			}
		}
		if (!meta) {
			brokenComment++;
			continue;
		}
		if (meta.completedAt || meta.dismissedAt || meta.crossedOutAt) continue;
		for (const k of Object.keys(meta)) commentKeys.add(k);
		if (t[1].length > 0) openIndented++;
		else openTop++;
		if (typeof meta.uuid === "string") zipUuids.add(meta.uuid.toLowerCase());
	}
}

const repeats = JSON.parse(readFileSync(repeatsPath, "utf8"));
const fileUuids = new Set(Object.keys(repeats.tasks ?? {}).map((k) => k.toLowerCase()));
const entriesList = Object.values(repeats.tasks ?? {});
const partNames = new Set();
const freqs = new Set();
let dtstartLines = 0;
let rrulePrefix = 0;
for (const { repeat } of entriesList) {
	if (typeof repeat !== "string") continue;
	for (const line of repeat.split(/\r?\n/)) {
		if (/^DTSTART/i.test(line)) {
			dtstartLines++;
			continue;
		}
		if (/^RRULE:/i.test(line)) rrulePrefix++;
		for (const part of line.replace(/^RRULE:/i, "").split(";")) {
			const [name, value] = part.split("=");
			if (!name) continue;
			partNames.add(name.toUpperCase());
			if (name.toUpperCase() === "FREQ") freqs.add(String(value).toUpperCase());
		}
	}
}

const matched = [...zipUuids].filter((u) => fileUuids.has(u)).length;
console.log({
	zip: {
		markdownEntries: md.length,
		otherEntries: other.length,
		otherEntriesBesideANoteFolder: otherBesideNote,
		maxEntryDepth: Math.max(0, ...names.map(depth)),
		notesWithFrontMatter: withFront,
		notesWithCRLF: crlf,
		frontMatterKeys: [...frontKeys].sort(),
		frontMatterContinuationLines: frontContinuationLines,
		openTasksTopLevel: openTop,
		openTasksIndented: openIndented,
		taskLinesWithBrokenOrMissingComment: brokenComment,
		taskCommentKeys: [...commentKeys].sort(),
		imageLines,
	},
	repeatsFile: {
		app: repeats.app,
		version: repeats.version,
		entries: fileUuids.size,
		isRepeatingTrue: entriesList.filter((e) => e.isRepeating === true).length,
		repeatingWithNoRule: entriesList.filter((e) => e.isRepeating && !e.repeat).length,
		rrulePartNames: [...partNames].sort(),
		freqValues: [...freqs].sort(),
		dtstartLines,
		rrulePrefix,
	},
	join: {
		zipTaskUuids: zipUuids.size,
		matched,
		inZipOnly: zipUuids.size - matched,
		inFileOnly: [...fileUuids].filter((u) => !zipUuids.has(u)).length,
	},
});
```

Run it on invented data to prove it works and prints nothing personal. In a scratch folder outside the repo (for example `%TEMP%\ignite-check`), build a two-note ZIP with `zipSync` and a repeats file with one entry, then run the script on them. Expected: an object with counts; `join.matched` is 1.

- [ ] **Step 9: Write the README**

`tools/amplenote-plugin/README.md`:

```markdown
# Amplenote repeats export

A personal Amplenote plugin that saves the repeat rule of every open task to a local file. Ignite's import reads that file beside the Amplenote export ZIP, because the ZIP has no repeat rules.

The file holds task uuids and repeat rules only: no titles, no note names. The plugin calls no network API.

## Install

1. Run `node tools/amplenote-plugin/build-note.mjs` and copy its output.
2. In Amplenote, make a new note called "Ignite repeats export" and paste the output into it.
3. Open the note's menu and choose **Install plugin**.

## Run

Run "Export repeats for Ignite" from Amplenote's app options (the plugin's `appOption`). Gate G1 in the plan confirms where it shows up on my account. Amplenote saves `amplenote-repeats-YYYY-MM-DD.json` to your downloads folder, or asks where to save it.

Run it on the same day as the ZIP export, so the two files match.

## Check a real export (counts only)

    node tools/amplenote-plugin/check-join.mjs <export.zip> <amplenote-repeats-….json>

It prints counts and key names only, so the output is safe to share.
```

- [ ] **Step 10: Check and commit**

```bash
npm run check && npm run test:run
git add package.json package-lock.json tools/amplenote-plugin tests/tools
git commit -m "feat(import): Amplenote repeats plugin and a count-only join check"
```

### Gate G1: Malin runs the plugin (spec §12.1)

**STOP. Tasks 2 to 7 (backup and restore) don't depend on this and can go ahead. Tasks 8 to 11 wait for Malin's numbers.**

Malin installs the plugin, runs it, exports the ZIP the same day and runs `check-join.mjs`. She pastes the printed object. Then:

| Result | Action |
|---|---|
| `join.matched` is close to `zip.zipTaskUuids` | Proceed. |
| `join.matched` is 0 or tiny | The uuids don't match. Stop. The spec gets a revision that drops the plugin (D1) before Task 10. |
| The plugin won't install or `saveFile` fails | Stop. Same revision: import without repeats. |
| `taskCommentKeys` lacks `uuid`, `startAt`, `important` or `notify` (or names them differently) | Stop and revise the §7.4 mapping table. |
| `rrulePartNames` holds a name outside FREQ, INTERVAL, BYDAY, BYMONTHDAY, BYMONTH, WKST, COUNT, UNTIL, BYSETPOS, BYHOUR, BYMINUTE, BYSECOND | Add it to `KNOWN` in Task 8 so it gets a reason, not "unknown". |
| `openTasksIndented` > 0 | Departure 2 is live. Keep it. |
| `frontMatterKeys` holds a key that isn't a plain scalar or list | Check Task 9's front-matter reader handles its form before Task 9 ships. |
| `frontMatterContinuationLines` > 0 | Some notes fold a long value over several lines. Task 9's reader marks those notes unreadable, so teach it the folded form (with a test) before Task 9 ships. |

---

### Task 2: `db.replaceAll` and the data model

**Files:**
- Modify: `src/model/db.js`, `src/model/tasks.js:236-246`
- Create: `src/model/data.js`
- Test: `tests/unit/db.test.js` (append), `tests/unit/data.test.js`

**Interfaces:**
- Produces: `db.readAll(storeNames: string[]) → Promise<{ [store]: record[] }>` (one readonly transaction); `db.replaceAll({ areas, sections, tasks }) → Promise<void>` (records in storage shape); `taskToStorage(task)`, `taskFromStorage(row)` exported from `src/model/tasks.js`; `createDataModel(db) → { snapshot(): Promise<{ areas, sections, tasks }>, replaceAll(data): Promise<void> }` in model shape (task booleans are `true`/`false`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/db.test.js`:

```js
describe("replaceAll", () => {
	const seed = async (db) => {
		await db.put("areas", { id: "old-area", name: "Old", icon: "", critical: false, order: 1 });
		await db.put("sections", { id: "old-sec", areaId: "old-area", name: "Old", collapsed: false, order: 0 });
		await db.put("tasks", { id: "old-task", sectionId: "old-sec", title: "Old", completed: 0, starred: 0, critical: 0, hasTime: 0, order: 0 });
		await db.put("settings", { id: "app", theme: "dark" });
	};

	it("replaces all three data stores", async () => {
		const db = await fresh();
		await seed(db);
		await db.replaceAll({
			areas: [{ id: "a", name: "A", icon: "", critical: false, order: 1 }],
			sections: [{ id: "s", areaId: "a", name: "S", collapsed: false, order: 0 }],
			tasks: [{ id: "t", sectionId: "s", title: "T", completed: 0, starred: 1, critical: 0, hasTime: 0, order: 0 }],
		});
		expect((await db.getAll("areas")).map((r) => r.id)).toEqual(["a"]);
		expect((await db.getAll("sections")).map((r) => r.id)).toEqual(["s"]);
		expect((await db.getAll("tasks")).map((r) => r.id)).toEqual(["t"]);
	});

	it("leaves settings alone", async () => {
		const db = await fresh();
		await seed(db);
		await db.replaceAll({ areas: [], sections: [], tasks: [] });
		expect(await db.get("settings", "app")).toEqual({ id: "app", theme: "dark" });
	});

	it("rejects and keeps the old data when a record can't be written", async () => {
		const db = await fresh();
		await seed(db);
		// A task with no `id` violates the keyPath, so put() throws inside the
		// transaction. The whole replace must abort, clears included.
		await expect(
			db.replaceAll({
				areas: [{ id: "a", name: "A", icon: "", critical: false, order: 1 }],
				sections: [],
				tasks: [{ sectionId: "s", title: "No id" }],
			}),
		).rejects.toThrow();
		expect((await db.getAll("areas")).map((r) => r.id)).toEqual(["old-area"]);
		expect((await db.getAll("tasks")).map((r) => r.id)).toEqual(["old-task"]);
	});
});

describe("readAll", () => {
	it("reads several stores in one call", async () => {
		const db = await fresh();
		await db.put("areas", { id: "a", name: "A", icon: "", critical: false, order: 0 });
		const out = await db.readAll(["areas", "sections"]);
		expect(out.areas.map((r) => r.id)).toEqual(["a"]);
		expect(out.sections).toEqual([]);
	});
});
```

`tests/unit/data.test.js`:

```js
import { afterEach, describe, expect, it } from "vitest";
import { createDataModel } from "../../src/model/data.js";
import { openDB } from "../../src/model/db.js";

let handles = [];
afterEach(() => {
	for (const db of handles) db.close();
	handles = [];
});
async function fresh() {
	const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
	handles.push(db);
	return db;
}

const task = {
	id: "t", sectionId: "s", title: "T", notes: "", completed: false, starred: true,
	critical: false, dueAt: null, hasTime: true, recurrence: null, lastCompletedAt: null,
	completedCount: 0, leadTime: 0, scheduledTags: [], createdAt: "2026-11-09T12:00:00.000Z", order: 0,
};

describe("createDataModel", () => {
	it("writes task booleans as 0/1 and reads them back as booleans", async () => {
		const db = await fresh();
		const data = createDataModel(db);
		await data.replaceAll({ areas: [], sections: [], tasks: [task] });
		const raw = await db.get("tasks", "t");
		expect(raw.starred).toBe(1);
		expect(raw.hasTime).toBe(1);
		expect(raw.completed).toBe(0);
		const snap = await data.snapshot();
		expect(snap.tasks).toEqual([task]);
	});

	it("snapshots areas and sections as stored", async () => {
		const db = await fresh();
		const area = { id: "a", name: "A", icon: "🏠", critical: false, order: 1 };
		await db.put("areas", area);
		const snap = await createDataModel(db).snapshot();
		expect(snap).toEqual({ areas: [area], sections: [], tasks: [] });
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/unit/db.test.js tests/unit/data.test.js`
Expected: FAIL, `db.replaceAll is not a function` and cannot find `data.js`.

- [ ] **Step 3: Implement `readAll` and `replaceAll`**

In `src/model/db.js`, extend the header comment with the two methods, then add inside `wrap(db)`'s returned object:

```js
		// One readonly transaction across several stores, so a backup is a
		// consistent snapshot even if a write lands between the reads.
		readAll: (storeNames) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(storeNames, "readonly");
				const out = {};
				for (const name of storeNames) {
					const req = tx.objectStore(name).getAll();
					req.onsuccess = () => {
						out[name] = req.result;
					};
				}
				tx.oncomplete = () => resolve(out);
				tx.onerror = () => reject(tx.error);
				tx.onabort = () =>
					reject(tx.error ?? new Error("readAll transaction aborted"));
			}),

		// Clears areas, sections and tasks and writes every record, in ONE
		// readwrite transaction: it lands whole or not at all. Records must be
		// in storage shape. Settings are never touched. Resolves on commit,
		// like run(), so a quota failure surfaces as a rejection.
		replaceAll: ({ areas, sections, tasks }) =>
			new Promise((resolve, reject) => {
				const stores = { areas, sections, tasks };
				const tx = db.transaction(Object.keys(stores), "readwrite");
				let thrown = null;
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(thrown ?? tx.error);
				tx.onabort = () =>
					reject(thrown ?? tx.error ?? new Error("replaceAll aborted"));
				try {
					for (const [name, records] of Object.entries(stores)) {
						const store = tx.objectStore(name);
						store.clear();
						for (const record of records) store.put(record);
					}
				} catch (err) {
					// put() throws synchronously on a bad key. Abort so the clears
					// above roll back too.
					thrown = err;
					tx.abort();
				}
			}),
```

- [ ] **Step 4: Export the task storage converters**

At the bottom of `src/model/tasks.js`, after `fromStorage`:

```js
// The backup layer converts between model and storage shape with the SAME
// functions the model uses, so the 0/1 boolean quirk stays in one place.
export { fromStorage as taskFromStorage, toStorage as taskToStorage };
```

- [ ] **Step 5: Write the data model**

`src/model/data.js`:

```js
// createDataModel(db) → { snapshot(), replaceAll(data) }
//
// Whole-database reads and writes for backup, restore and import. Both work
// in MODEL shape: task booleans are true/false here and 0/1 in IndexedDB.
// Areas and sections are stored as-is by their models, so they pass through.

import { taskFromStorage, taskToStorage } from "./tasks.js";

const DATA_STORES = ["areas", "sections", "tasks"];

export function createDataModel(db) {
	return {
		async snapshot() {
			const out = await db.readAll(DATA_STORES);
			return {
				areas: out.areas,
				sections: out.sections,
				tasks: out.tasks.map(taskFromStorage),
			};
		},

		replaceAll({ areas, sections, tasks }) {
			return db.replaceAll({
				areas,
				sections,
				tasks: tasks.map(taskToStorage),
			});
		},
	};
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/db.test.js tests/unit/data.test.js && npm run test:run`
Expected: PASS, and the whole suite stays green.

- [ ] **Step 7: Commit**

```bash
npm run check
git add src/model/db.js src/model/tasks.js src/model/data.js tests/unit/db.test.js tests/unit/data.test.js
git commit -m "feat(backup): replace all data in one transaction"
```

---

### Task 3: `lastBackupAt` and the banner rule

**Files:**
- Modify: `src/model/settings.js`
- Create: `src/backup/backup-due.js`
- Test: `tests/unit/settings.test.js` (append), `tests/backup/backup-due.test.js`

**Interfaces:**
- Produces: `settings.setLastBackupAt(iso: string) → Promise<Settings>`; `backupReminder({ lastBackupAt: string|null, taskCount: number, now: Date }) → string|null` (banner text or null); `formatBackupStamp(iso: string|null) → string` ("09.11.2026 13:20" or "Never"); `fileStamp(now: Date) → "2026-11-09-1320"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/settings.test.js`. It already imports `openDB` and `createSettingsModel`, and defines `freshModel()` (returns `{ db, model }`) plus an `openHandles` list that `afterEach` closes; these tests use both as they are:

```js
describe("lastBackupAt", () => {
	it("reads as null on a new database", async () => {
		const { model } = await freshModel();
		expect((await model.get()).lastBackupAt ?? null).toBeNull();
	});

	it("reads as null on a record saved before the field existed", async () => {
		const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
		openHandles.push(db);
		await db.put("settings", { id: "app", theme: "dark", sidebarCollapsed: false });
		const model = await createSettingsModel(db);
		expect((await model.get()).lastBackupAt ?? null).toBeNull();
	});

	it("stores the stamp", async () => {
		const { model } = await freshModel();
		await model.setLastBackupAt("2026-11-09T12:20:00.000Z");
		expect((await model.get()).lastBackupAt).toBe("2026-11-09T12:20:00.000Z");
	});

	it("refuses anything that isn't an ISO string", async () => {
		const { model } = await freshModel();
		await expect(model.setLastBackupAt("yesterday")).rejects.toThrow();
	});
});
```

`tests/backup/backup-due.test.js`:

```js
import { describe, expect, it } from "vitest";
import { backupReminder, fileStamp, formatBackupStamp } from "../../src/backup/backup-due.js";

const NOW = new Date(2026, 10, 9, 13, 20); // local 09.11.2026 13:20
const daysAgo = (d, extraMs = 0) => new Date(NOW.getTime() - d * 86_400_000 - extraMs).toISOString();

describe("backupReminder", () => {
	it("is silent on an empty database, even with no backup", () => {
		expect(backupReminder({ lastBackupAt: null, taskCount: 0, now: NOW })).toBeNull();
	});
	it("asks for a first backup", () => {
		expect(backupReminder({ lastBackupAt: null, taskCount: 3, now: NOW })).toBe(
			"You haven't made a backup yet.",
		);
	});
	it("is silent at exactly 7 days", () => {
		expect(backupReminder({ lastBackupAt: daysAgo(7), taskCount: 3, now: NOW })).toBeNull();
	});
	it("speaks just past 7 days", () => {
		expect(backupReminder({ lastBackupAt: daysAgo(7, 60_000), taskCount: 3, now: NOW })).toBe(
			"Your last backup was 7 days ago.",
		);
	});
	it("counts whole days", () => {
		expect(backupReminder({ lastBackupAt: daysAgo(8), taskCount: 3, now: NOW })).toBe(
			"Your last backup was 8 days ago.",
		);
	});
	it("treats a future stamp as just now", () => {
		expect(backupReminder({ lastBackupAt: daysAgo(-3), taskCount: 3, now: NOW })).toBeNull();
	});
	it("treats an unreadable stamp as no backup", () => {
		expect(backupReminder({ lastBackupAt: "garbage", taskCount: 3, now: NOW })).toBe(
			"You haven't made a backup yet.",
		);
	});
});

describe("formatBackupStamp", () => {
	it("uses periods for the date and a colon for the time", () => {
		expect(formatBackupStamp(NOW.toISOString())).toBe("09.11.2026 13:20");
	});
	it("says Never for null or garbage", () => {
		expect(formatBackupStamp(null)).toBe("Never");
		expect(formatBackupStamp("nope")).toBe("Never");
	});
});

describe("fileStamp", () => {
	it("sorts by time in local time", () => {
		expect(fileStamp(NOW)).toBe("2026-11-09-1320");
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/unit/settings.test.js tests/backup/backup-due.test.js`
Expected: FAIL, `setLastBackupAt is not a function` and cannot find `backup-due.js`.

- [ ] **Step 3: Implement the settings field**

In `src/model/settings.js`, add to `DEFAULTS` after `theme`:

```js
	// ISO string of the last full backup, or null. Records saved before this
	// field existed simply lack it, and every reader uses `?? null`, so there
	// is no migration.
	lastBackupAt: null,
```

and a method after `setTheme`:

```js
		async setLastBackupAt(iso) {
			if (typeof iso !== "string" || Number.isNaN(Date.parse(iso))) {
				throw new Error(`setLastBackupAt: not an ISO date "${iso}"`);
			}
			return this.update({ lastBackupAt: iso });
		},
```

- [ ] **Step 4: Implement `backup-due.js`**

```js
// Pure helpers for the backup reminder and backup file names. No DOM.

const DAY_MS = 86_400_000;
export const BACKUP_STALE_MS = 7 * DAY_MS;

const pad = (n) => String(n).padStart(2, "0");

function parseStamp(iso) {
	if (typeof iso !== "string") return null;
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? null : ms;
}

// Banner text, or null when no banner should show. A new user with an empty
// database never sees it. A stamp in the future (a clock set back) counts as
// "just now".
export function backupReminder({ lastBackupAt, taskCount, now }) {
	if (taskCount === 0) return null;
	const last = parseStamp(lastBackupAt);
	if (last === null) return "You haven't made a backup yet.";
	const age = now.getTime() - last;
	if (age <= BACKUP_STALE_MS) return null;
	return `Your last backup was ${Math.floor(age / DAY_MS)} days ago.`;
}

// "09.11.2026 13:20" in local time, or "Never".
export function formatBackupStamp(iso) {
	const ms = parseStamp(iso);
	if (ms === null) return "Never";
	const d = new Date(ms);
	return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "2026-11-09-1320" in local time, so backup files sort in order.
export function fileStamp(now) {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}
```

- [ ] **Step 5: Run the tests, then commit**

Run: `npx vitest run tests/unit/settings.test.js tests/backup/backup-due.test.js && npm run check`
Expected: PASS.

```bash
git add src/model/settings.js src/backup/backup-due.js tests/unit/settings.test.js tests/backup/backup-due.test.js
git commit -m "feat(backup): remember the last backup and when to remind"
```

---

### Task 4: The backup file format

**Files:**
- Modify: `src/model/recurrence.js` (+ `isValidRecurrence`), `src/model/areas.js` (export the Focus defaults)
- Create: `src/backup/backup-format.js`
- Test: `tests/unit/recurrence.test.js` (append), `tests/backup/backup-format.test.js`

**Interfaces:**
- Consumes: `fileStamp` (Task 3); `FOCUS_ID`, `FOCUS_DEFAULT_SECTION_ID` from `src/model/areas.js`.
- Produces: `isValidRecurrence(rule) → boolean` and `RECURRENCE_KEYS` from `recurrence.js`; `buildBackup(data, { appVersion, now }) → object`; `backupToJson(backup) → string`; `backupFileName(now) → string`; `validateBackup(text) → { ok: true, data, repairs } | { ok: false, reason }`; `describeRepairs(repairs) → string[]`; `describeCounts({ areas, sections, tasks }) → string`; constants `MAX_BACKUP_BYTES`, `NOT_A_BACKUP`, `BACKUP_TOO_BIG`; `FOCUS_DEFAULTS`, `FOCUS_DEFAULT_SECTION` exported from `areas.js`.
- `repairs` is `{ droppedEmptySections, tasksFromMissingArea, tasksFromMissingSection }`, all numbers.

- [ ] **Step 1: Export the Focus defaults**

In `src/model/areas.js`, change `const FOCUS_DEFAULTS` to `export const FOCUS_DEFAULTS` and `const FOCUS_DEFAULT_SECTION` to `export const FOCUS_DEFAULT_SECTION`. The import flow (Task 11) falls back to them.

- [ ] **Step 2: Write the failing recurrence test**

Append to `tests/unit/recurrence.test.js` (add `isValidRecurrence` to its import):

```js
describe("isValidRecurrence", () => {
	it.each([
		[{ type: "daily" }],
		[{ type: "daily", interval: 3 }],
		[{ type: "weekly", interval: 1, weekdays: [1, 4] }],
		[{ type: "monthly", interval: 1, day: 31 }],
		[{ type: "yearly", interval: 1, month: 2, day: 29 }],
	])("accepts %j", (rule) => {
		expect(isValidRecurrence(rule)).toBe(true);
	});

	it.each([
		[null],
		["daily"],
		[{ type: "hourly" }],
		[{ type: "weekly", weekdays: [] }],
		[{ type: "weekly", weekdays: [7] }],
		[{ type: "monthly", day: 0 }],
		[{ type: "yearly", month: 13, day: 1 }],
		[{ type: "daily", interval: "two" }],
		[{ type: "daily", extra: true }],
	])("refuses %j", (rule) => {
		expect(isValidRecurrence(rule)).toBe(false);
	});
});
```

- [ ] **Step 3: Implement `isValidRecurrence`**

Append to `src/model/recurrence.js`:

```js
// True when nextOccurrence can run this rule without throwing. Used to check
// rules read from a file before they reach the database. RECURRENCE_KEYS is
// exported so the backup writer can strip anything else without a second list.
export const RECURRENCE_KEYS = new Set(["type", "interval", "weekdays", "month", "day"]);
const isIntIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export function isValidRecurrence(rule) {
	if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
		return false;
	}
	for (const key of Object.keys(rule)) if (!RECURRENCE_KEYS.has(key)) return false;
	if (
		rule.interval !== undefined &&
		!(typeof rule.interval === "number" && Number.isFinite(rule.interval))
	) {
		return false;
	}
	switch (rule.type) {
		case "daily":
			return true;
		case "weekly":
			return (
				Array.isArray(rule.weekdays) &&
				rule.weekdays.length > 0 &&
				rule.weekdays.every((d) => isIntIn(d, 0, 6))
			);
		case "monthly":
			return isIntIn(rule.day, 1, 31);
		case "yearly":
			return isIntIn(rule.month, 1, 12) && isIntIn(rule.day, 1, 31);
		default:
			return false;
	}
}
```

Run: `npx vitest run tests/unit/recurrence.test.js`
Expected: PASS.

- [ ] **Step 4: Write the failing format tests**

`tests/backup/backup-format.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
	BACKUP_TOO_BIG,
	backupFileName,
	backupToJson,
	buildBackup,
	describeCounts,
	describeRepairs,
	MAX_BACKUP_BYTES,
	NOT_A_BACKUP,
	validateBackup,
} from "../../src/backup/backup-format.js";

const NOW = new Date(2026, 10, 9, 13, 20);
const focusArea = { id: "focus", name: "Focus", icon: "🔥", critical: false, order: 0 };
const focusSection = { id: "focus-default", areaId: "focus", name: "Tasks", collapsed: false, order: 0 };
const area = { id: "a1", name: "Home", icon: "🏠", critical: false, order: 1 };
const section = { id: "s1", areaId: "a1", name: "Chores", collapsed: false, order: 0 };
const task = (over = {}) => ({
	id: "t1", sectionId: "s1", title: "Water plants", notes: "", completed: false,
	starred: true, critical: false, dueAt: "2026-11-10T08:00:00.000Z", hasTime: true,
	recurrence: { type: "weekly", interval: 1, weekdays: [1] }, lastCompletedAt: null,
	completedCount: 2, leadTime: 15, scheduledTags: [], createdAt: "2026-10-01T10:00:00.000Z",
	order: 0, ...over,
});
const db = (over = {}) => ({
	areas: [focusArea, area], sections: [focusSection, section], tasks: [task()], ...over,
});
const text = (data) => backupToJson(buildBackup(data, { appVersion: "0.9.0", now: NOW }));
const damaged = (mutate) => {
	const json = JSON.parse(text(db()));
	mutate(json);
	return validateBackup(JSON.stringify(json));
};

describe("buildBackup", () => {
	it("writes the header", () => {
		const b = buildBackup(db(), { appVersion: "0.9.0", now: NOW });
		expect(b.app).toBe("ignite");
		expect(b.schemaVersion).toBe(1);
		expect(b.appVersion).toBe("0.9.0");
		expect(b.exportedAt).toBe(NOW.toISOString());
	});

	it("fills defaults for fields an old record never had (Review Focus 1)", () => {
		const old = { id: "t9", sectionId: "s1", title: "From April", completed: false, starred: false, critical: false, dueAt: null, recurrence: null, leadTime: 0, scheduledTags: [], createdAt: "2026-04-26T10:00:00.000Z", order: 1, notes: "" };
		const b = buildBackup(db({ tasks: [old] }), { appVersion: "0.9.0", now: NOW });
		expect(b.tasks[0]).toMatchObject({ hasTime: false, completedCount: 0, lastCompletedAt: null });
		expect(validateBackup(backupToJson(b)).ok).toBe(true);
	});

	it("drops keys outside the schema and coerces stored 0/1 booleans", () => {
		const b = buildBackup(db({ areas: [focusArea, { ...area, critical: 1, legacy: "x" }] }), { appVersion: "0.9.0", now: NOW });
		expect(b.areas[1]).toEqual({ ...area, critical: true });
	});

	it("writes a file its own reader accepts, whatever an odd record holds", () => {
		// A backup that can't be restored is no backup. Every value the reader
		// would refuse is reset to the default tasks.create gives.
		const odd = {
			id: "t8", sectionId: "s1", title: " ", notes: null, completed: 0, starred: "yes", critical: undefined,
			dueAt: "Tue, 10 Nov 2026 07:00:00 GMT", hasTime: 1, recurrence: { type: "weekly", interval: 1, weekdays: [1], legacy: true },
			lastCompletedAt: "garbage", completedCount: -1, leadTime: null, scheduledTags: null, createdAt: 5, order: Number.NaN,
		};
		const b = buildBackup(db({ tasks: [odd] }), { appVersion: "0.9.0", now: NOW });
		expect(validateBackup(backupToJson(b)).ok).toBe(true);
		expect(b.tasks[0]).toMatchObject({
			title: "Untitled task", notes: "", completed: false, starred: false, critical: false,
			dueAt: "2026-11-10T07:00:00.000Z", hasTime: true, recurrence: { type: "weekly", interval: 1, weekdays: [1] },
			lastCompletedAt: null, completedCount: 0, leadTime: 0, scheduledTags: [], createdAt: NOW.toISOString(), order: 0,
		});
	});
});

describe("validateBackup round trip", () => {
	it("restores what it wrote", () => {
		const result = validateBackup(text(db()));
		expect(result.ok).toBe(true);
		expect(result.data).toEqual(db());
		expect(result.repairs).toEqual({ droppedEmptySections: 0, tasksFromMissingArea: 0, tasksFromMissingSection: 0 });
	});
});

describe("validateBackup refusals", () => {
	it("refuses text that isn't JSON", () => {
		expect(validateBackup("{nope")).toEqual({ ok: false, reason: NOT_A_BACKUP });
	});
	it("refuses a file over 10 MB before parsing", () => {
		expect(validateBackup(" ".repeat(MAX_BACKUP_BYTES + 1))).toEqual({ ok: false, reason: BACKUP_TOO_BIG });
	});
	it("refuses another app's file", () => {
		expect(damaged((j) => { j.app = "other"; })).toEqual({ ok: false, reason: NOT_A_BACKUP });
	});
	it("refuses a newer schema", () => {
		expect(damaged((j) => { j.schemaVersion = 2; }).reason).toBe(
			"This backup was made by a newer Ignite. Update Ignite first.",
		);
	});
	it("names a missing title", () => {
		expect(damaged((j) => { delete j.tasks[0].title; }).reason).toBe("This backup is damaged: task 1 has no title.");
	});
	it("names an empty title", () => {
		expect(damaged((j) => { j.tasks[0].title = "  "; }).reason).toBe("This backup is damaged: task 1 has no title.");
	});
	it("names a missing field", () => {
		expect(damaged((j) => { delete j.sections[1].areaId; }).reason).toBe("This backup is damaged: section 2 has no areaId.");
	});
	it("names a wrong type", () => {
		expect(damaged((j) => { j.tasks[0].starred = "yes"; }).reason).toBe("This backup is damaged: task 1 has a bad starred.");
	});
	it("refuses a bad date", () => {
		expect(damaged((j) => { j.tasks[0].dueAt = "next week"; }).reason).toBe("This backup is damaged: task 1 has a bad dueAt.");
	});
	it("refuses a bad recurrence", () => {
		expect(damaged((j) => { j.tasks[0].recurrence = { type: "weekly", weekdays: [] }; }).reason).toBe("This backup is damaged: task 1 has a bad recurrence.");
	});
	it("refuses an unknown key", () => {
		expect(damaged((j) => { j.areas[0].colour = "red"; }).reason).toBe('This backup is damaged: area 1 has an unknown field "colour".');
	});
	it("refuses a __proto__ key without polluting anything", () => {
		const raw = text(db()).replace('"title": "Water plants"', '"title": "Water plants", "__proto__": { "polluted": true }');
		expect(validateBackup(raw).reason).toBe('This backup is damaged: task 1 has an unknown field "__proto__".');
		expect({}.polluted).toBeUndefined();
	});
	it("refuses a duplicate id", () => {
		expect(damaged((j) => { j.tasks.push({ ...j.tasks[0] }); }).reason).toBe('This backup is damaged: two tasks share the id "t1".');
	});
	it("refuses a missing Focus area", () => {
		expect(damaged((j) => { j.areas.shift(); }).reason).toBe("This backup is damaged: the Focus area is missing.");
	});
	it("refuses a missing Focus notepad", () => {
		expect(damaged((j) => { j.sections.shift(); }).reason).toBe("This backup is damaged: the Focus notepad is missing.");
	});
});

describe("orphan repairs", () => {
	it("drops a section with no area and no tasks", () => {
		const orphan = { id: "s9", areaId: "gone", name: "Lost", collapsed: false, order: 0 };
		const result = validateBackup(text(db({ sections: [focusSection, section, orphan] })));
		expect(result.ok).toBe(true);
		expect(result.data.sections.map((s) => s.id)).toEqual(["focus-default", "s1"]);
		expect(result.repairs.droppedEmptySections).toBe(1);
	});

	it("moves the tasks of an area-less section to the Focus notepad", () => {
		const orphan = { id: "s9", areaId: "gone", name: "Lost", collapsed: false, order: 0 };
		const inFocus = task({ id: "f1", sectionId: "focus-default", order: 4 });
		const lost = task({ id: "t9", sectionId: "s9" });
		const result = validateBackup(text(db({ sections: [focusSection, section, orphan], tasks: [inFocus, lost] })));
		const moved = result.data.tasks.find((t) => t.id === "t9");
		expect(moved.sectionId).toBe("focus-default");
		expect(moved.order).toBe(5);
		expect(result.repairs.tasksFromMissingArea).toBe(1);
	});

	it("moves a task with no section to the Focus notepad", () => {
		const result = validateBackup(text(db({ tasks: [task({ sectionId: "nowhere" })] })));
		expect(result.data.tasks[0].sectionId).toBe("focus-default");
		expect(result.repairs.tasksFromMissingSection).toBe(1);
	});

	it("restores a backup of a database holding an orphan section row", () => {
		// The case Malin's dev database is in: a sections row whose areaId matches no area.
		const orphan = { id: "s9", areaId: "gone", name: "Lost", collapsed: false, order: 0 };
		expect(validateBackup(text(db({ sections: [focusSection, section, orphan] }))).ok).toBe(true);
	});
});

describe("descriptions", () => {
	it("describes repairs in counts", () => {
		expect(describeRepairs({ droppedEmptySections: 1, tasksFromMissingArea: 2, tasksFromMissingSection: 1 })).toEqual([
			"1 empty section whose area is missing is left out.",
			"2 tasks whose area is missing go to the Focus notepad.",
			"1 task whose section is missing goes to the Focus notepad.",
		]);
		expect(describeRepairs({ droppedEmptySections: 0, tasksFromMissingArea: 0, tasksFromMissingSection: 0 })).toEqual([]);
	});
	it("describes counts", () => {
		expect(describeCounts(db())).toBe("2 areas, 2 sections and 1 task");
	});
	it("names the file", () => {
		expect(backupFileName(NOW)).toBe("ignite-backup-2026-11-09-1320.json");
	});
});
```

- [ ] **Step 5: Run them to make sure they fail**

Run: `npx vitest run tests/backup/backup-format.test.js`
Expected: FAIL, cannot find `backup-format.js`.

- [ ] **Step 6: Implement `backup-format.js`**

```js
// Serialise and validate an Ignite backup. Pure: no DOM, no IndexedDB.
//
// Records are in MODEL shape (task booleans true/false). The writer projects
// every record onto the schema-v1 field list and fills the defaults
// tasks.create gives, because tasks made before some fields existed lack them
// (completedCount before 24.06.2026, hasTime before 13.08.2026). A value the
// reader would refuse is reset the same way. Without that, the strict reader
// would refuse a backup Ignite made itself, and the safety backup taken before
// every replace would be a file that can't be restored.

import { FOCUS_DEFAULT_SECTION_ID, FOCUS_ID } from "../model/areas.js";
import { isValidRecurrence, RECURRENCE_KEYS } from "../model/recurrence.js";
import { fileStamp } from "./backup-due.js";

export const BACKUP_APP = "ignite";
export const SCHEMA_VERSION = 1;
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export const NOT_A_BACKUP = "This file isn't an Ignite backup.";
export const BACKUP_TOO_BIG = "This file is over 10 MB, so it can't be an Ignite backup.";
const NEWER = "This backup was made by a newer Ignite. Update Ignite first.";

const TOP_KEYS = new Set(["app", "schemaVersion", "appVersion", "exportedAt", "areas", "sections", "tasks"]);

const SCHEMA = {
	areas: { label: "area", fields: { id: "id", name: "string", icon: "string", critical: "boolean", order: "number" } },
	sections: { label: "section", fields: { id: "id", areaId: "id", name: "string", collapsed: "boolean", order: "number" } },
	tasks: {
		label: "task",
		fields: {
			id: "id", sectionId: "id", title: "title", notes: "string", completed: "boolean",
			starred: "boolean", critical: "boolean", dueAt: "isoOrNull", hasTime: "boolean",
			recurrence: "recurrence", lastCompletedAt: "isoOrNull", completedCount: "count",
			leadTime: "minutes", scheduledTags: "tags", createdAt: "iso", order: "number",
		},
	},
};
const STORES = Object.keys(SCHEMA);

// Defaults match tasks.create / sections.create / areas.create.
const DEFAULTS = { string: "", boolean: false, number: 0, isoOrNull: null, recurrence: null, count: 0, minutes: 0 };

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isIso = (v) => typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const CHECKS = {
	id: (v) => typeof v === "string" && v.length > 0,
	string: (v) => typeof v === "string",
	title: (v) => typeof v === "string" && v.trim().length > 0,
	boolean: (v) => typeof v === "boolean",
	number: (v) => typeof v === "number" && Number.isFinite(v),
	count: (v) => Number.isInteger(v) && v >= 0,
	minutes: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
	iso: isIso,
	isoOrNull: (v) => v === null || isIso(v),
	recurrence: (v) => v === null || isValidRecurrence(v),
	tags: (v) => Array.isArray(v) && v.every((t) => typeof t === "string"),
};

// Coerce first (0/1 booleans, dates Date.parse can read, rule keys the model
// doesn't know), then keep the value only if the reader's own check passes.
// Anything else gets the default. Ids are never invented: a record without
// one can't exist in IndexedDB (it's the keyPath), and a missing areaId or
// sectionId is left for the reader to name.
function normalizeValue(value, kind) {
	if (kind === "boolean") return value === true || value === 1;
	if ((kind === "iso" || kind === "isoOrNull") && typeof value === "string" && !isIso(value)) {
		const ms = Date.parse(value);
		return Number.isNaN(ms) ? value : new Date(ms).toISOString();
	}
	if (kind === "recurrence" && isPlainObject(value)) {
		return Object.fromEntries(Object.entries(value).filter(([k]) => RECURRENCE_KEYS.has(k)));
	}
	return value;
}

function normalizeRecord(record, fields, fallbackIso) {
	const out = {};
	for (const [key, kind] of Object.entries(fields)) {
		const value = normalizeValue(record[key], kind);
		if (value !== undefined && CHECKS[kind](value)) out[key] = value;
		else if (kind === "id") {
			if (value !== undefined) out[key] = value;
		} else if (kind === "title") out[key] = "Untitled task";
		else if (kind === "iso") out[key] = fallbackIso;
		else if (kind === "tags") out[key] = [];
		else out[key] = DEFAULTS[kind];
	}
	return out;
}

export function buildBackup(data, { appVersion, now }) {
	const exportedAt = now.toISOString();
	const backup = { app: BACKUP_APP, schemaVersion: SCHEMA_VERSION, appVersion, exportedAt };
	for (const store of STORES) {
		backup[store] = data[store].map((r) => normalizeRecord(r, SCHEMA[store].fields, exportedAt));
	}
	return backup;
}

export const backupToJson = (backup) => JSON.stringify(backup, null, 2);
export const backupFileName = (now) => `ignite-backup-${fileStamp(now)}.json`;

const fail = (reason) => ({ ok: false, reason });
const damaged = (problem) => fail(`This backup is damaged: ${problem}.`);
const quote = (key) => `"${String(key).slice(0, 40)}"`;

function checkStore(store, records) {
	const { label, fields } = SCHEMA[store];
	const seen = new Set();
	for (let i = 0; i < records.length; i++) {
		const r = records[i];
		const n = i + 1;
		if (!isPlainObject(r)) return `${label} ${n} isn't a record`;
		for (const key of Object.keys(r)) {
			if (!Object.hasOwn(fields, key)) return `${label} ${n} has an unknown field ${quote(key)}`;
		}
		for (const [key, kind] of Object.entries(fields)) {
			const missing = !Object.hasOwn(r, key);
			if (kind === "title" && (missing || !CHECKS.title(r[key]))) return `${label} ${n} has no title`;
			if (missing) return `${label} ${n} has no ${key}`;
			if (!CHECKS[kind](r[key])) return `${label} ${n} has a bad ${key}`;
		}
		if (seen.has(r.id)) return `two ${label}s share the id ${quote(r.id)}`;
		seen.add(r.id);
	}
	return null;
}

function repairLinks({ areas, sections, tasks }) {
	const areaIds = new Set(areas.map((a) => a.id));
	const taskCount = new Map();
	for (const t of tasks) taskCount.set(t.sectionId, (taskCount.get(t.sectionId) ?? 0) + 1);

	const kept = [];
	const droppedIds = new Set();
	let droppedEmptySections = 0;
	for (const s of sections) {
		if (areaIds.has(s.areaId)) kept.push({ ...s });
		else {
			droppedIds.add(s.id);
			if (!taskCount.get(s.id)) droppedEmptySections++;
		}
	}
	const keptIds = new Set(kept.map((s) => s.id));
	let focusOrder = tasks
		.filter((t) => t.sectionId === FOCUS_DEFAULT_SECTION_ID)
		.reduce((max, t) => Math.max(max, t.order), -1);
	let tasksFromMissingArea = 0;
	let tasksFromMissingSection = 0;
	const outTasks = tasks.map((t) => {
		if (keptIds.has(t.sectionId)) return { ...t };
		if (droppedIds.has(t.sectionId)) tasksFromMissingArea++;
		else tasksFromMissingSection++;
		focusOrder += 1;
		return { ...t, sectionId: FOCUS_DEFAULT_SECTION_ID, order: focusOrder };
	});
	return {
		data: { areas: areas.map((a) => ({ ...a })), sections: kept, tasks: outTasks },
		repairs: { droppedEmptySections, tasksFromMissingArea, tasksFromMissingSection },
	};
}

export function validateBackup(text) {
	if (typeof text !== "string") return fail(NOT_A_BACKUP);
	if (text.length > MAX_BACKUP_BYTES) return fail(BACKUP_TOO_BIG);
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		return fail(NOT_A_BACKUP);
	}
	if (!isPlainObject(json) || json.app !== BACKUP_APP) return fail(NOT_A_BACKUP);
	if (!Number.isInteger(json.schemaVersion) || json.schemaVersion < 1) return fail(NOT_A_BACKUP);
	if (json.schemaVersion > SCHEMA_VERSION) return fail(NEWER);
	// schemaVersion 1 is the only version so far. A later version adds a
	// migration step here that lifts older files forward before the checks.
	for (const key of Object.keys(json)) {
		if (!TOP_KEYS.has(key)) return damaged(`it has an unknown field ${quote(key)}`);
	}
	if (!isIso(json.exportedAt)) return damaged("it has no export date");
	for (const store of STORES) {
		if (!Array.isArray(json[store])) return damaged(`it has no ${SCHEMA[store].label} list`);
		const problem = checkStore(store, json[store]);
		if (problem) return damaged(problem);
	}
	if (!json.areas.some((a) => a.id === FOCUS_ID)) return damaged("the Focus area is missing");
	if (!json.sections.some((s) => s.id === FOCUS_DEFAULT_SECTION_ID && s.areaId === FOCUS_ID)) {
		return damaged("the Focus notepad is missing");
	}
	const { data, repairs } = repairLinks(json);
	return { ok: true, data, repairs };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function describeRepairs({ droppedEmptySections, tasksFromMissingArea, tasksFromMissingSection }) {
	const lines = [];
	if (droppedEmptySections > 0) {
		lines.push(`${plural(droppedEmptySections, "empty section")} whose area is missing ${droppedEmptySections === 1 ? "is" : "are"} left out.`);
	}
	if (tasksFromMissingArea > 0) {
		lines.push(`${plural(tasksFromMissingArea, "task")} whose area is missing ${tasksFromMissingArea === 1 ? "goes" : "go"} to the Focus notepad.`);
	}
	if (tasksFromMissingSection > 0) {
		lines.push(`${plural(tasksFromMissingSection, "task")} whose section is missing ${tasksFromMissingSection === 1 ? "goes" : "go"} to the Focus notepad.`);
	}
	return lines;
}

export function describeCounts({ areas, sections, tasks }) {
	return `${plural(areas.length, "area")}, ${plural(sections.length, "section")} and ${plural(tasks.length, "task")}`;
}
```

- [ ] **Step 7: Run the tests, then commit**

Run: `npx vitest run tests/backup tests/unit/recurrence.test.js && npm run check && npm run test:run`
Expected: PASS. If Biome reformats the long lines, accept its formatting (`npm run format`) and re-run.

```bash
git add src/model/recurrence.js src/model/areas.js src/backup/backup-format.js tests/unit/recurrence.test.js tests/backup/backup-format.test.js
git commit -m "feat(backup): the backup file format, its checks and orphan repairs"
```

---

### Task 5: The Settings page and Back up now

**Files:**
- Create: `src/backup/download.js`, `src/settings-flows.js`, `src/views/settings.js`
- Modify: `src/controller.js` (parseHash, renderPageHeader, applyState, mountMainView, onHashChange, start/stop, sidebar callbacks), `src/app.js`, `src/views/sidebar.js` (footer + action map + callback param), `main.css`
- Test: `tests/unit/parse-hash.test.js` (append)

**Interfaces:**
- Consumes: `createDataModel` (Task 2); `settings.setLastBackupAt`, `formatBackupStamp` (Task 3); `buildBackup`, `backupToJson`, `backupFileName` (Task 4).
- Produces:
  - `downloadFile(content: string, fileName: string, type: string) → void` (throws if the browser refuses).
  - `createSettingsFlows({ models: { data, settings }, toast, getView, appVersion }) → { backUpNow(): Promise<boolean> }`. Tasks 6, 7 and 11 extend this object.
  - `createSettingsView(rootEl, { onBackUp }) → { render(state), setAlert(group: "backup"|"import", text), focusControl(name: "back-up"|"restore"|"import"), destroy() }`. Tasks 6 and 11 add callbacks and methods.
  - Route `{ name: "settings" }`; body class `is-settings-route`.

- [ ] **Step 1: Write the failing route test**

Append inside the `describe("parseHash")` block of `tests/unit/parse-hash.test.js`:

```js
	it("parses #settings", () => {
		expect(parseHash("#settings")).toEqual({ name: "settings" });
	});

	it("doesn't treat a settings prefix as Settings", () => {
		expect(parseHash("#settings/x")).toEqual({ name: "focus" });
	});
```

Run: `npx vitest run tests/unit/parse-hash.test.js`
Expected: FAIL on the first new case.

- [ ] **Step 2: Route**

In `src/controller.js` `parseHash`, before the `areaMatch` line:

```js
	if (raw === "settings") return { name: "settings" };
```

Update the comment in `tests/unit/parse-hash.test.js` ("Two routes exist") to list three. Run the test: PASS.

- [ ] **Step 3: `download.js`**

```js
// Saves text as a file through a temporary <a download>. The page can't tell
// whether the browser actually saved it (a "where to save" prompt can be
// cancelled), which is why every replace also keeps an in-memory undo.

const REVOKE_AFTER_MS = 60_000;

export function downloadFile(content, fileName, type) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	try {
		const a = document.createElement("a");
		a.href = url;
		a.download = fileName;
		a.hidden = true;
		document.body.append(a);
		a.click();
		a.remove();
	} finally {
		// Revoking at once can cancel the download in some browsers.
		setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
	}
}
```

- [ ] **Step 4: `settings-flows.js` with Back up now**

```js
// createSettingsFlows(deps) → the backup, restore and import flows.
//
// Lives beside controller.js so the controller only routes and wires. It
// touches the DOM only through the Settings view, the dialogs and the toast it
// is handed. getView() returns the mounted Settings view or null: every flow
// re-checks it after an await, so a result that arrives after I left the page
// is dropped instead of reaching a removed view.

import { backupFileName, backupToJson, buildBackup } from "./backup/backup-format.js";
import { downloadFile } from "./backup/download.js";

const ALERT_TOAST_MS = 8_000;

export function createSettingsFlows({ models, toast, getView, appVersion }) {
	const { data, settings } = models;

	// Shows a failure in the group's alert line, or as a toast when the flow
	// started outside Settings (the banner) or the page has gone.
	function alertIn(group, message) {
		const view = getView();
		if (view) view.setAlert(group, message);
		else toast.show({ message, durationMs: ALERT_TOAST_MS });
	}

	async function downloadBackupOf(snapshot, fileName, now) {
		downloadFile(backupToJson(buildBackup(snapshot, { appVersion, now })), fileName, "application/json");
		await settings.setLastBackupAt(now.toISOString());
	}

	async function backUpNow() {
		getView()?.setAlert("backup", "");
		const now = new Date();
		const fileName = backupFileName(now);
		try {
			await downloadBackupOf(await data.snapshot(), fileName, now);
		} catch {
			alertIn("backup", "Couldn't save the backup.");
			return false;
		}
		toast.show({ message: `Backup saved as ${fileName}.` });
		return true;
	}

	return { backUpNow, _internal: { alertIn, downloadBackupOf } };
}
```

`_internal` is how Task 6 reaches the two helpers when it extends this file. Task 6 replaces the `return` line, so `_internal` never reaches `main`.

- [ ] **Step 5: The Settings view (Backup group, Back up now only)**

`src/views/settings.js`:

```js
// createSettingsView(rootEl, callbacks) → { render, setAlert, focusControl, destroy }
//
// Renders ONCE. applyState calls render(state) on every model notify and every
// 60 s tick; render only updates values in place, so a notify never destroys
// the control that has focus (spec §6 step 6). Alert lines are role="alert"
// regions rendered empty with the page and filled with textContent.

import { formatBackupStamp } from "../backup/backup-due.js";

export function createSettingsView(rootEl, { onBackUp }) {
	rootEl.innerHTML = `
		<div class="settings">
			<section class="card stack settings-card" aria-labelledby="backup-heading">
				<h2 class="settings-card__heading" id="backup-heading">Backup</h2>
				<dl class="settings-meta">
					<dt class="settings-meta__label">Last backup</dt>
					<dd class="settings-meta__value" data-role="last-backup">Never</dd>
				</dl>
				<p class="settings-card__note">The file holds all your tasks in plain text. Keep it somewhere private.</p>
				<div class="cluster settings-actions" data-role="backup-actions">
					<button type="button" class="repeat-btn repeat-btn--primary" data-action="back-up">Back up now</button>
				</div>
				<p class="settings-alert" role="alert" data-role="backup-alert"></p>
			</section>
		</div>
	`;

	const $ = (selector) => rootEl.querySelector(selector);

	const onClick = (event) => {
		const action = event.target.closest("[data-action]")?.dataset.action;
		if (action === "back-up") onBackUp();
	};
	rootEl.addEventListener("click", onClick);

	return {
		render(state) {
			$('[data-role="last-backup"]').textContent = formatBackupStamp(state.settings.lastBackupAt ?? null);
		},
		setAlert(group, text) {
			const el = $(`[data-role="${group}-alert"]`);
			if (el) el.textContent = text;
		},
		focusControl(name) {
			const selectors = {
				"back-up": '[data-action="back-up"]',
				restore: "#restore-file",
				import: '[data-action="import"]',
			};
			$(selectors[name])?.focus();
		},
		destroy() {
			rootEl.removeEventListener("click", onClick);
			rootEl.innerHTML = "";
		},
	};
}
```

- [ ] **Step 6: Wire the data model and version**

`src/app.js`: import `createDataModel` from `./model/data.js`, create `const data = createDataModel(db);` after the settings model, and pass `models: { areas, sections, tasks, settings, data }`.

`src/controller.js`:
- Imports: `import { version as APP_VERSION } from "../package.json";`, `import { createSettingsFlows } from "./settings-flows.js";`, `import { createSettingsView } from "./views/settings.js";`.
- Destructure `data` from `models`.
- Add `let flows = null;` beside the other view handles.
- In `start()`, after `toast = createToastView(toastRoot);`:

```js
		flows = createSettingsFlows({
			models: { data, settings },
			toast,
			getView: () => (currentRoute.name === "settings" ? currentMainView : null),
			appVersion: APP_VERSION,
		});
```

- [ ] **Step 7: Header, body class and mount**

The header is rewritten on every notify and every 60 s tick, and a rewrite drops any focus on its `<h1>`. Settings focuses that heading on arrival, and the banner (Task 7) hands focus to it when it closes, so the header must only be written when its markup changes. One mechanism for every route:

1. Rename the current `renderPageHeader(state)` to `pageHeaderHtml(state)`, and turn its two `pageHeaderRoot.innerHTML = …;` assignments (the area branch and the Focus branch) into `return …;`. Add `tabindex="-1"` to both `<h1 class="page-header__title">` tags, so either can take programmatic focus (it adds no Tab stop).
2. Add a Settings branch as its first lines:

```js
		if (currentRoute.name === "settings") {
			return `<h1 class="page-header__title" tabindex="-1">Settings</h1>`;
		}
```

3. Add, beside the other handles, `let lastHeaderHtml = null;`, and below `pageHeaderHtml`:

```js
	// Writes only when the markup changed. The Focus header changes when the
	// day or a count changes, the area header on a rename, so a focused <h1>
	// keeps its focus through every tick and every unrelated notify.
	function renderPageHeader(state) {
		const html = pageHeaderHtml(state);
		if (html === lastHeaderHtml) return;
		lastHeaderHtml = html;
		pageHeaderRoot.innerHTML = html;
	}

	const focusPageHeading = () => pageHeaderRoot.querySelector("h1")?.focus();
```

4. In `stop()`, add `lastHeaderHtml = null;`.

In `applyState`, after the `is-area-route` toggle:

```js
		document.body.classList.toggle("is-settings-route", currentRoute.name === "settings");
```

In `mountMainView(route)`, before the `// route.name === "area"` comment:

```js
		if (route.name === "settings") {
			currentMainView = createSettingsView(mainRoot, {
				onBackUp: () => flows.backUpNow(),
			});
			return;
		}
```

In `onHashChange`, replace the final `applyState();` with:

```js
		applyState().then(() => {
			// Settings focuses its heading, so a keyboard user lands at the top
			// of the new page instead of on <body>.
			if (currentRoute.name === "settings") focusPageHeading();
		});
```

Update the controller's header comment (line 1 to 5) to name the Settings route.

- [ ] **Step 8: Sidebar entry point**

In `src/views/sidebar.js`:
- Add `onOpenSettings` to the callbacks `createSidebarView` destructures (read the top of the function for the exact list).
- Action map, after `"cycle-theme"`: `"open-settings": () => onOpenSettings(),`
- Footer markup, inside `.sidebar__footer` before the theme button:

```js
			<button class="sidebar__settings ${state.route?.name === "settings" ? "is-active" : ""}" type="button"
				data-action="open-settings" aria-label="Settings"
				${state.route?.name === "settings" ? 'aria-current="page"' : ""}>
				<span class="sidebar__settings-icon" aria-hidden="true">⚙️</span>
				<span class="sidebar__settings-text">Settings</span>
			</button>
```

The `is-active` class mirrors the area rows (`renderAreaRow` sets both `is-active` and `aria-current`); `main.css` styles the class, not the attribute.

Update the header comment (lines 7 to 10) with `{ name: "settings" } → the Settings button gets aria-current="page"`.

In `controller.js` `start()`, in the `createSidebarView` callbacks after `onGoFocus`:

```js
			onOpenSettings: () => {
				window.location.hash = "#settings";
				closeDrawer();
			},
```

- [ ] **Step 9: Styles**

Read `invariants.md` "Ignite v2" section before this step. In `main.css`:

1. Footer button. Change each `.sidebar__theme` rule to a grouped selector that also covers the settings button, so both share one look. `.sidebar__theme {` → `.sidebar__theme,\n.sidebar__settings {`; `.sidebar__theme:hover {` → `.sidebar__theme:hover,\n.sidebar__settings:hover {`; `.sidebar__theme-icon {` → `.sidebar__theme-icon,\n.sidebar__settings-icon {`. Inside the existing `@media (min-width: 768px)` collapsed block: `body.is-sidebar-collapsed .sidebar__theme-text,\nbody.is-sidebar-collapsed .sidebar__settings-text {` and `body.is-sidebar-collapsed .sidebar__theme,\nbody.is-sidebar-collapsed .sidebar__settings {`. Then, directly after the grouped `:hover` rule, add the active state with the same paint as `.sidebar__area.is-active` (`main.css` has no `aria-current` rule; the area rows are styled through `is-active`):

```css
.sidebar__settings.is-active {
	background: var(--accent-soft);
	color: var(--text);
}
```

Add `.sidebar__footer { display: flex; flex-direction: column; gap: var(--space-1); }` properties to the existing `.sidebar__footer` rule (keep its three lines).

2. Settings route, after the mobile `#main { padding-block-end: … }` rule (around line 1568):

```css
/* Settings has no capture bar, so it reserves no space for one. The
   override equals the >=768px value, so it holds at every width. */
body.is-settings-route #capture-root {
	display: none;
}
body.is-settings-route #main {
	padding-block-end: var(--main-padding);
}
/* #main is capped at the reading width (42rem) for task lists. At that cap
   the Settings grid could never reach a second column at any width, so this
   route lifts it and lets the grid add columns instead (R3). */
body.is-settings-route {
	--main-max-width: none;
}
```

3. Settings page, a new block at the end of the file, before any trailing `@media (prefers-reduced-motion)` block that must stay last (read the end of the file first):

```css
/* --- Settings page --- */
/* Cards of a capped width in an auto-fill grid: one column on a phone, two
   from 1024px, more as later settings join the page, never one column
   stretched wide. min(100%, …) keeps a 320px screen from overflowing.
   20rem, not wider: at 1024px with the full sidebar #main has 720px of
   content, and two 20rem tracks plus the gap (664px) fit where two 22rem
   tracks (728px) would not. */
.settings {
	display: grid;
	gap: var(--space-5);
	grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
	align-items: start;
}
.settings-card {
	min-width: 0;
}
.settings-card__heading {
	font-size: var(--text-lg);
}
.settings-card__note {
	font-size: var(--text-sm);
}
.settings-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: var(--space-2);
}
.settings-meta__label {
	font-size: var(--text-sm);
	color: var(--text-muted);
}
.settings-meta__value {
	color: var(--text);
	font-weight: 600;
	font-variant-numeric: tabular-nums;
}
.settings-actions {
	align-items: flex-end;
}
/* An empty alert line stays in the tree (so it announces when filled) but
   must not add a gap at the bottom of the card: cancel the stack's gap. */
.settings-alert {
	color: var(--color-overdue);
	font-size: var(--text-sm);
}
.settings-alert:empty {
	margin-block-start: calc(-1 * var(--space-4));
}
```

- [ ] **Step 10: Verify in the browser**

Use a throwaway origin so Malin's real dev data is never read: `npm run build` then a preview server on port 4173 (add a `preview` entry to `.claude/launch.json` only with Malin's go-ahead, since `.claude/` is gated; otherwise ask her to run `npm run preview`). Seed two demo areas and a few demo tasks with the app's own UI. Then check, in one batched round:
- Clicking **Settings** in the sidebar lands on `#settings`, focus is on the `<h1>` (`document.activeElement.tagName === "H1"`), the capture bar is `display: none`, the sidebar button has `aria-current="page"`.
- **Back up now** downloads `ignite-backup-…json` (`read_network_requests` shows no request carrying it), the toast says "Backup saved as …", and "Last backup" shows today's date with a colon in the time.
- A 60 s tick (or `dispatchEvent` on a model by editing a task in another route and coming back) doesn't move focus off a focused **Back up now**.
- Collapsed rail at 1024 px: the Settings tile is 44 px tall like the Theme tile (`getBoundingClientRect().height`), its text is clipped, its accessible name is "Settings".

- [ ] **Step 11: Commit**

```bash
npm run check && npm run test:run && npm run build
git add src/backup/download.js src/settings-flows.js src/views/settings.js src/controller.js src/app.js src/views/sidebar.js main.css tests/unit/parse-hash.test.js
git commit -m "feat(settings): a Settings page with Back up now"
```

---

### Task 6: Restore, the confirm dialog, undo, other tabs

**Files:**
- Create: `src/views/confirm-dialog.js`
- Modify: `src/settings-flows.js`, `src/views/settings.js`, `src/controller.js`, `src/app.js`, `main.css`

**Interfaces:**
- Consumes: `validateBackup`, `describeCounts`, `describeRepairs`, `MAX_BACKUP_BYTES`, `BACKUP_TOO_BIG`, `NOT_A_BACKUP`, `backupFileName` (Task 4); `data.snapshot/replaceAll` (Task 2).
- Produces:
  - `createConfirmDialog(rootEl) → { open({ title, lines: string[], confirmLabel, onConfirm, onCancel }), close(), isOpen(), destroy() }`.
  - Flows gain: `restoreFromFile(file: File)`, `undoLastReplace()`, `canUndo() → boolean`, `closeDialogs()`, and the internal `replace(data, safetyName, { replaceFailMessage? }) → Promise<{ ok: true } | { ok: false, message: string|null }>` plus `openConfirm`/`closeConfirm`, used again by Task 11. `replace` never writes an alert itself: its caller closes the dialog first and then shows `message`, because text written into an `inert` background is not announced. `message` is null only when another replace was already running.
  - `createSettingsFlows` gains deps `confirmDialog`, `setModal(open: boolean)`, `applyState`, `channel` (a `BroadcastChannel` or null).
  - View gains callbacks `onRestoreFile(file)`, `onUndoReplace()` and method `setUndoAvailable(bool)`.

- [ ] **Step 1: The confirm dialog**

`src/views/confirm-dialog.js`:

```js
// createConfirmDialog(rootEl) → { open, close, isOpen, destroy }
//
// The Replace/Cancel dialog for restore and import. Same pattern as the
// schedule dialog (recurrence-dialog.js): role="dialog", aria-modal, labelled
// by its heading, Esc and the backdrop cancel. The CONTROLLER owns background
// `inert` and where focus goes afterwards. Focus starts on Cancel, because
// Replace overwrites everything.
//
// Replace disables itself (and Cancel) on the first press, so a double press
// can't start two replaces.

import { escapeHtml } from "../utils/dom.js";

export function createConfirmDialog(rootEl) {
	let current = null;
	let busy = false;
	let clickHandler = null;
	let keyHandler = null;

	function close() {
		if (clickHandler) rootEl.removeEventListener("click", clickHandler);
		if (keyHandler) document.removeEventListener("keydown", keyHandler);
		clickHandler = null;
		keyHandler = null;
		current = null;
		busy = false;
		rootEl.innerHTML = "";
	}

	function open(opts) {
		close();
		current = opts;
		rootEl.innerHTML = `
			<div class="repeat-backdrop" data-action="confirm-backdrop">
				<div class="repeat-panel confirm-panel" role="dialog" aria-modal="true"
					aria-labelledby="confirm-heading" aria-describedby="confirm-body">
					<h2 class="repeat-panel__heading" id="confirm-heading">${escapeHtml(opts.title)}</h2>
					<div class="confirm-panel__body" id="confirm-body">
						${opts.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
					</div>
					<footer class="repeat-footer">
						<button type="button" class="repeat-btn" data-action="confirm-cancel">Cancel</button>
						<button type="button" class="repeat-btn repeat-btn--primary" data-action="confirm-ok">${escapeHtml(opts.confirmLabel)}</button>
					</footer>
				</div>
			</div>
		`;
		clickHandler = (event) => {
			const actionEl = event.target.closest("[data-action]");
			const action = actionEl?.dataset.action;
			if (!action || busy) return;
			if (action === "confirm-backdrop" && event.target !== actionEl) return;
			if (action === "confirm-ok") {
				busy = true;
				for (const b of rootEl.querySelectorAll("button")) b.disabled = true;
				current.onConfirm();
				return;
			}
			current.onCancel();
		};
		keyHandler = (event) => {
			if (event.key !== "Escape" || busy) return;
			event.preventDefault();
			current.onCancel();
		};
		rootEl.addEventListener("click", clickHandler);
		document.addEventListener("keydown", keyHandler);
		rootEl.querySelector('[data-action="confirm-cancel"]').focus();
	}

	return {
		open,
		close,
		isOpen: () => current !== null,
		destroy: close,
	};
}
```

- [ ] **Step 2: A dialog root and the modal helper**

`src/app.js`: after the `repeatDialogRoot` lines:

```js
	const settingsDialogRoot = document.createElement("div");
	settingsDialogRoot.id = "settings-dialog-root";
	document.body.appendChild(settingsDialogRoot);
```

and pass `settingsDialogRoot` in `els`. Destructure it in the controller.

`src/controller.js`, a helper beside `openRecurrenceEditor`:

```js
	// Background inert + scroll lock while a Settings dialog is open. Same
	// split as the schedule dialog: the dialog owns its own focus, the
	// controller owns the background.
	function setSettingsModal(open) {
		document.body.classList.toggle("is-dialog-open", open);
		for (const el of [topbarRoot, sidebarRoot, mainEl, toastRoot]) el.inert = open;
	}
```

`main.css`, beside `body.is-drawer-open`:

```css
body.is-dialog-open {
	overflow: hidden;
}
.confirm-panel__body {
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
}
.confirm-panel__body p {
	color: var(--text);
}
```

- [ ] **Step 3: Extend the flows**

In `src/settings-flows.js`, extend the imports:

```js
import {
	BACKUP_TOO_BIG,
	backupFileName,
	backupToJson,
	buildBackup,
	describeCounts,
	describeRepairs,
	MAX_BACKUP_BYTES,
	NOT_A_BACKUP,
	validateBackup,
} from "./backup/backup-format.js";
```

Change the signature to `createSettingsFlows({ models, toast, getView, appVersion, confirmDialog, setModal, applyState, channel })`, then add after `backUpNow`:

```js
	let replacing = false;
	let lastReplace = null; // { snapshot, safetyName } until the next app start
	let returnFocus = null;

	function openConfirm({ onReturnFocus, ...opts }) {
		returnFocus = onReturnFocus;
		setModal(true);
		confirmDialog.open({ ...opts, onCancel: () => closeConfirm() });
	}

	function closeConfirm({ restoreFocus = true } = {}) {
		if (!confirmDialog.isOpen()) return;
		confirmDialog.close();
		setModal(false);
		if (restoreFocus) returnFocus?.();
		returnFocus = null;
	}

	// Every replace: snapshot, safety download, stamp, one-transaction write,
	// tell other tabs, re-render. Returns { ok: true } only when the data was
	// replaced, else { ok: false, message } for the caller to show once its
	// dialog has closed (an alert written behind `inert` isn't announced).
	async function replace(newData, safetyName, { replaceFailMessage } = {}) {
		if (replacing) return { ok: false, message: null };
		replacing = true;
		try {
			const now = new Date();
			let snapshot;
			try {
				// Reading the current data is part of the safety backup: if it
				// fails, there is nothing safe to fall back to, so stop here.
				snapshot = await data.snapshot();
				await downloadBackupOf(snapshot, safetyName, now);
			} catch {
				return { ok: false, message: "Couldn't save the safety backup, so nothing was replaced." };
			}
			try {
				await data.replaceAll(newData);
			} catch {
				return { ok: false, message: replaceFailMessage ?? "Couldn't replace your data. Nothing was changed." };
			}
			lastReplace = { snapshot, safetyName };
			// Another open tab still holds the old ids and would write into
			// sections that no longer exist. It reloads on this message.
			channel?.postMessage({ type: "replaced" });
			getView()?.setUndoAvailable(true);
			await applyState();
			return { ok: true };
		} finally {
			replacing = false;
		}
	}

	async function restoreFromFile(file) {
		const view = getView();
		view?.setAlert("backup", "");
		if (file.size > MAX_BACKUP_BYTES) {
			view?.setAlert("backup", BACKUP_TOO_BIG);
			return;
		}
		let text;
		try {
			text = await file.text();
		} catch {
			view?.setAlert("backup", NOT_A_BACKUP);
			return;
		}
		if (getView() !== view) return;
		const result = validateBackup(text);
		if (!result.ok) {
			view.setAlert("backup", result.reason);
			return;
		}
		const current = await data.snapshot();
		if (getView() !== view) return;
		const safetyName = backupFileName(new Date());
		openConfirm({
			title: "Restore from this backup?",
			lines: [
				`Replace ${describeCounts(current)} with ${describeCounts(result.data)}.`,
				...describeRepairs(result.repairs),
				`Your current data downloads first as ${safetyName}.`,
			],
			confirmLabel: "Replace",
			onReturnFocus: () => getView()?.focusControl("restore"),
			onConfirm: async () => {
				let outcome = { ok: false, message: null };
				try {
					outcome = await replace(result.data, safetyName);
				} finally {
					// Always close, even if the render after the write throws: a
					// dialog left open with its buttons disabled, Esc ignored and
					// the background inert is a keyboard trap.
					closeConfirm();
				}
				if (!outcome.ok) {
					if (outcome.message) alertIn("backup", outcome.message);
					return;
				}
				toast.show({
					message: `Restored from ${file.name}.`,
					actionLabel: "Undo",
					onAction: () => undoLastReplace(),
				});
			},
		});
	}

	async function undoLastReplace() {
		if (!lastReplace) return;
		const target = lastReplace;
		const outcome = await replace(target.snapshot, backupFileName(new Date()), {
			replaceFailMessage: `Couldn't undo. Your data from before is in ${target.safetyName}.`,
		});
		if (!outcome.ok) {
			if (outcome.message) alertIn("backup", outcome.message);
			return;
		}
		lastReplace = null;
		getView()?.setUndoAvailable(false);
		toast.show({ message: "Replace undone." });
	}

	return {
		backUpNow,
		restoreFromFile,
		undoLastReplace,
		canUndo: () => lastReplace !== null,
		closeDialogs: () => closeConfirm({ restoreFocus: false }),
		_internal: { alertIn, replace, openConfirm, closeConfirm },
	};
```

Delete the old `return { backUpNow, _internal: … }` line. Task 11 adds the import flows inside this same function and removes `_internal`.

- [ ] **Step 4: Wire it in the controller**

In `start()`, before the flows are created:

```js
		confirmDialog = createConfirmDialog(settingsDialogRoot);
		// A restore or import in another tab replaced every id. Reload, so this
		// tab never writes tasks into sections that no longer exist.
		channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ignite");
		if (channel) {
			channel.onmessage = (event) => {
				if (event.data?.type === "replaced") window.location.reload();
			};
		}
```

Add `let confirmDialog = null;` and `let channel = null;` to the handles, import `createConfirmDialog`, and pass `confirmDialog, setModal: setSettingsModal, applyState, channel` into `createSettingsFlows`.

In `mountMainView`'s settings branch:

```js
			currentMainView = createSettingsView(mainRoot, {
				onBackUp: () => flows.backUpNow(),
				onRestoreFile: (file) => flows.restoreFromFile(file),
				onUndoReplace: () => flows.undoLastReplace(),
			});
			currentMainView.setUndoAvailable(flows.canUndo());
```

In `onHashChange`, after `closeRecurrenceEditor(…)`: `flows?.closeDialogs();`. In `stop()`: `flows?.closeDialogs(); confirmDialog?.destroy(); channel?.close();` and null them.

- [ ] **Step 5: Restore and Undo controls in the view**

In `src/views/settings.js`:
- Signature: `createSettingsView(rootEl, { onBackUp, onRestoreFile, onUndoReplace })`.
- Inside `data-role="backup-actions"`, after the Back up now button:

```html
					<label class="repeat-btn settings-file">
						<input class="sr-only" id="restore-file" type="file" accept=".json,application/json" />
						Restore from file…
					</label>
					<button type="button" class="repeat-btn" data-action="undo-replace" hidden>Undo last replace</button>
```

- In `onClick`: `else if (action === "undo-replace") onUndoReplace();`
- A change listener (and remove it in `destroy`):

```js
	const onChange = (event) => {
		const input = event.target;
		if (input.id !== "restore-file") return;
		const file = input.files?.[0];
		// Reset, so picking the same file again still fires `change`.
		input.value = "";
		if (file) onRestoreFile(file);
	};
	rootEl.addEventListener("change", onChange);
```

- Method:

```js
		setUndoAvailable(available) {
			const button = $('[data-action="undo-replace"]');
			// After an undo from this button, hiding it would drop focus to
			// <body>. Hand focus to the restore control beside it first.
			if (!available && document.activeElement === button) $("#restore-file").focus();
			button.hidden = !available;
		},
```

The file input stays in the accessibility tree (`.sr-only` clips it, never `display: none`). Its accessible name is the label text.

`main.css`, in the Settings block:

```css
/* A <label> painted as a 44px button around a visually hidden file input.
   inline-flex, or min-block-size has no effect on an inline label. The
   focus ring shows on the label because the input itself is clipped. */
.settings-file {
	display: inline-flex;
	align-items: center;
	cursor: pointer;
}
.settings-file:has(:focus-visible) {
	outline: 2px solid var(--color-accent);
	outline-offset: 2px;
}
```

- [ ] **Step 6: Verify in the browser**

On the throwaway origin with demo data, one batched round:
- Back up, then delete a demo area, then **Restore from file…** with that backup: the dialog names both sides in counts and the safety file; focus starts on Cancel; Esc closes it and focus returns to the restore input.
- Replace: the deleted area is back; one safety file downloaded; the toast offers Undo; **Undo last replace** is visible.
- A double click on Replace (two `click()`s in one script) produces one safety download and one replace.
- Toast Undo returns to the post-delete state and hides **Undo last replace**.
- Restore again, then press **Undo last replace** itself: the data goes back, the button hides, and `document.activeElement` is the restore input, not `<body>`.
- Force a failure (in the console, make `indexedDB` writes fail, for example by stubbing `IDBObjectStore.prototype.clear` to throw, then Replace): the dialog closes, focus returns to the restore input, and the alert line reads "Couldn't replace your data. Nothing was changed." after the dialog is gone. Restore the stub.
- A file that isn't JSON, a JSON with `"app": "x"`, and a backup with one title blanked each show the right sentence in the alert line and write nothing (the area list is unchanged).
- Two tabs on the same origin: a restore in one reloads the other (`performance.getEntriesByType("navigation")[0].type === "reload"` there).
- No network request carries backup content.
- The safety download in Brave with "Ask where to save each file" on and off. This needs Malin's Brave, so it goes on her owed list if the agent can't toggle it.

- [ ] **Step 7: Commit**

```bash
npm run check && npm run test:run && npm run build
git add src/views/confirm-dialog.js src/settings-flows.js src/views/settings.js src/controller.js src/app.js main.css
git commit -m "feat(backup): restore from a file with a safety backup and undo"
```

---

### Task 7: The backup banner

**Files:**
- Create: `src/views/backup-banner.js`
- Modify: `src/app.js`, `src/controller.js`, `main.css`

**Interfaces:**
- Consumes: `backupReminder` (Task 3), `flows.backUpNow` (Task 5).
- Produces: `createBackupBanner(rootEl, { onBackUp, onDismiss }) → { render(message: string|null), destroy() }`.

- [ ] **Step 1: The view**

`src/views/backup-banner.js`:

```js
// createBackupBanner(rootEl, { onBackUp, onDismiss }) → { render, destroy }
//
// render(message) rewrites only when the message changes, so the 60 s tick
// never destroys a focused banner button.

import { escapeHtml } from "../utils/dom.js";

export function createBackupBanner(rootEl, { onBackUp, onDismiss }) {
	let shown = null;

	const onClick = (event) => {
		const action = event.target.closest("[data-action]")?.dataset.action;
		if (action === "banner-back-up") onBackUp();
		else if (action === "banner-dismiss") onDismiss();
	};
	rootEl.addEventListener("click", onClick);

	return {
		render(message) {
			if (message === shown) return;
			shown = message;
			rootEl.innerHTML = message
				? `<div class="backup-banner" role="region" aria-label="Backup reminder">
						<p class="backup-banner__text">${escapeHtml(message)}</p>
						<div class="cluster backup-banner__actions">
							<button type="button" class="repeat-btn repeat-btn--primary" data-action="banner-back-up">Back up now</button>
							<button type="button" class="repeat-btn" data-action="banner-dismiss">Not now</button>
						</div>
					</div>`
				: "";
		},
		destroy() {
			rootEl.removeEventListener("click", onClick);
			rootEl.innerHTML = "";
		},
	};
}
```

- [ ] **Step 2: Root and wiring**

`src/app.js`: the `mainEl.innerHTML` template gains `<div id="backup-banner-root"></div>` as its first line, and `els` gains `bannerRoot: document.getElementById("backup-banner-root")`.

When the banner disappears under focus, focus goes to the page's `<h1>` (`focusPageHeading`, Task 5), never to `#main`: a focused container makes NVDA read the whole page in one breath. Task 5's cached header keeps that `<h1>` in place through later ticks.

`src/controller.js`:
- Destructure `bannerRoot`; add `let banner = null;` and `let bannerDismissed = false; // until the next app start, never a setting`.
- Imports: `import { backupReminder } from "./backup/backup-due.js";` and `import { createBackupBanner } from "./views/backup-banner.js";`.
- In `start()`:

```js
		banner = createBackupBanner(bannerRoot, {
			onBackUp: async () => {
				// The banner goes away after a backup. Hand focus to the page's
				// <h1>, not <body>. On failure the banner stays, and so does focus.
				if (await flows.backUpNow()) focusPageHeading();
			},
			onDismiss: async () => {
				bannerDismissed = true;
				await applyState();
				focusPageHeading();
			},
		});
```

- In `applyState`, after `renderPageHeader(state);`:

```js
		banner?.render(
			currentRoute.name === "settings" || bannerDismissed
				? null
				: backupReminder({
						lastBackupAt: state.settings.lastBackupAt ?? null,
						taskCount: state.tasks.length,
						now: state.now,
					}),
		);
```

- In `stop()`: `banner?.destroy(); banner = null;`.

`main.css`, Settings block:

```css
.backup-banner {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-3);
	margin-block-end: var(--space-4);
	padding: var(--space-3) var(--space-4);
	border: 1px solid var(--border);
	border-radius: var(--radius-md);
	background: var(--panel-bg);
}
.backup-banner__text {
	flex: 1 1 16rem;
	color: var(--text);
}
```

- [ ] **Step 3: Verify in the browser**

On the throwaway origin: an empty database shows no banner (the welcome text shows alone). Add a task: "You haven't made a backup yet." shows above the `<h1>`. **Not now** hides it, focus lands on the page's `<h1>` (`document.activeElement.tagName === "H1"`) and is still there after the next 60 s tick, and it stays hidden through a hash change. Set `lastBackupAt` to nine days ago through the settings store in IndexedDB on that throwaway origin, reload: "Your last backup was 9 days ago." **Back up now** hides it. It never shows on `#settings`. The two buttons share one height and bottom edge at 320 px.

- [ ] **Step 4: Commit**

```bash
npm run check && npm run test:run && npm run build
git add src/views/backup-banner.js src/app.js src/controller.js main.css
git commit -m "feat(backup): remind me when the last backup is over a week old"
```

---

### Task 8: RRULE to Ignite recurrence

**Waits for Gate G1.**

**Files:**
- Create: `src/backup/rrule.js`
- Test: `tests/backup/rrule.test.js`

**Interfaces:**
- Produces: `rruleToRecurrence(input: string, startAt: Date|null) → { recurrence: Rule } | { recurrence: null, reason: string }`, where `Rule` is a shape `isValidRecurrence` accepts; `RRULE_REASONS` (the reason strings).

- [ ] **Step 1: Write the failing tests**

```js
import { describe, expect, it } from "vitest";
import { isValidRecurrence } from "../../src/model/recurrence.js";
import { RRULE_REASONS as R, rruleToRecurrence } from "../../src/backup/rrule.js";

const START = new Date(2026, 10, 12, 9, 0); // Thursday 12.11.2026 09:00 local
const ok = (rule) => rruleToRecurrence(rule, START).recurrence;
const why = (rule, start = START) => rruleToRecurrence(rule, start).reason;

describe("rruleToRecurrence, supported", () => {
	it("daily with an interval", () => {
		expect(ok("FREQ=DAILY;INTERVAL=3")).toEqual({ type: "daily", interval: 3 });
	});
	it("weekly on listed days, Sunday = 0", () => {
		expect(ok("FREQ=WEEKLY;BYDAY=TH,MO,SU")).toEqual({ type: "weekly", interval: 1, weekdays: [0, 1, 4] });
	});
	it("weekly with no BYDAY takes the start's weekday", () => {
		expect(ok("FREQ=WEEKLY")).toEqual({ type: "weekly", interval: 1, weekdays: [4] });
	});
	it("monthly on a day", () => {
		expect(ok("FREQ=MONTHLY;BYMONTHDAY=1")).toEqual({ type: "monthly", interval: 1, day: 1 });
	});
	it("monthly on the last day becomes day 31", () => {
		expect(ok("FREQ=MONTHLY;BYMONTHDAY=-1")).toEqual({ type: "monthly", interval: 1, day: 31 });
	});
	it("monthly with no BYMONTHDAY takes the start's day", () => {
		expect(ok("FREQ=MONTHLY;INTERVAL=2")).toEqual({ type: "monthly", interval: 2, day: 12 });
	});
	it("yearly, explicit and from the start", () => {
		expect(ok("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=14")).toEqual({ type: "yearly", interval: 1, month: 2, day: 14 });
		expect(ok("FREQ=YEARLY")).toEqual({ type: "yearly", interval: 1, month: 11, day: 12 });
	});
	it("reads past a DTSTART line and an RRULE: prefix", () => {
		expect(ok("DTSTART:20261112T090000Z\nRRULE:FREQ=DAILY")).toEqual({ type: "daily", interval: 1 });
	});
	it("accepts WKST when it can't change anything", () => {
		expect(ok("FREQ=WEEKLY;WKST=MO;BYDAY=MO")).toEqual({ type: "weekly", interval: 1, weekdays: [1] });
		expect(ok("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH")).toEqual({ type: "weekly", interval: 2, weekdays: [1, 4] });
		expect(ok("FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=SU,MO")).toEqual({ type: "weekly", interval: 2, weekdays: [0, 1] });
	});
	it("every result is a rule the model accepts", () => {
		for (const rule of ["FREQ=DAILY", "FREQ=WEEKLY", "FREQ=MONTHLY;BYMONTHDAY=-1", "FREQ=YEARLY"]) {
			expect(isValidRecurrence(ok(rule))).toBe(true);
		}
	});
});

describe("rruleToRecurrence, refused with a reason", () => {
	it.each([
		["FREQ=MONTHLY;BYDAY=1MO", R.position],
		["FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO", R.position],
		["FREQ=WEEKLY;BYDAY=1MO", R.position],
		["FREQ=MONTHLY;BYDAY=MO", R.weekdayRule],
		["FREQ=DAILY;COUNT=5", R.ends],
		["FREQ=DAILY;UNTIL=20261231T000000Z", R.ends],
		["FREQ=DAILY;BYHOUR=9", R.hours],
		["FREQ=MONTHLY;BYMONTHDAY=1,15", R.severalDays],
		["FREQ=MONTHLY;BYMONTHDAY=-2", R.fromEnd],
		["FREQ=YEARLY;BYMONTH=1,7", R.severalMonths],
		["FREQ=HOURLY", R.frequency],
		["FREQ=DAILY;FOO=1", R.unknown],
		["FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO", R.weekStart],
		["FREQ=WEEKLY;INTERVAL=2;WKST=TU;BYDAY=MO,TH", R.weekStart],
		["FREQ=WEEKLY;WKST=XX;BYDAY=MO", R.unreadable],
		["FREQ=DAILY;INTERVAL=0", R.unreadable],
		["INTERVAL=2", R.unreadable],
		["DTSTART:20261112T090000Z\nRDATE:20261120T090000Z\nRRULE:FREQ=DAILY", R.unknown],
		["", R.empty],
	])("%s", (rule, reason) => {
		expect(why(rule)).toBe(reason);
	});

	it("needs a start date when the rule leaves the day out", () => {
		expect(why("FREQ=WEEKLY", null)).toBe(R.noStart);
		expect(why("FREQ=MONTHLY", null)).toBe(R.noStart);
	});

	it("never guesses: an unknown part wins over everything else", () => {
		expect(rruleToRecurrence("FREQ=DAILY;X-THING=1", START).recurrence).toBeNull();
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/backup/rrule.test.js`
Expected: FAIL, cannot find `rrule.js`.

- [ ] **Step 3: Implement**

`src/backup/rrule.js`:

```js
// RRULE string → Ignite recurrence, or null with a reason. Pure.
//
// Only the rule part is read. Parts the rule leaves out come from startAt in
// LOCAL time, as RFC 5545 does with DTSTART. A rule is never guessed: any part
// Ignite can't follow exactly returns null with a reason for the report.

const WEEKDAY = new Map([["SU", 0], ["MO", 1], ["TU", 2], ["WE", 3], ["TH", 4], ["FR", 5], ["SA", 6]]);
const FREQS = new Map([["DAILY", "daily"], ["WEEKLY", "weekly"], ["MONTHLY", "monthly"], ["YEARLY", "yearly"]]);
const TOO_OFTEN = new Set(["HOURLY", "MINUTELY", "SECONDLY"]);
const KNOWN = new Set([
	"FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST", "COUNT", "UNTIL",
	"BYSETPOS", "BYHOUR", "BYMINUTE", "BYSECOND", "BYYEARDAY", "BYWEEKNO",
]);

export const RRULE_REASONS = {
	empty: "No repeat rule was found.",
	unreadable: "The repeat rule couldn't be read.",
	unknown: "It uses a repeat rule Ignite doesn't know.",
	frequency: "It repeats more often than daily.",
	ends: "It stops after a set number of times or on a date.",
	position: "It repeats on a numbered weekday, such as the first Monday.",
	hours: "It repeats at set hours or minutes.",
	weekdayRule: "It repeats on weekdays within a month or year.",
	severalDays: "It repeats on several days of the month.",
	fromEnd: "It counts days back from the end of the month.",
	severalMonths: "It repeats in several months.",
	weekStart: "It repeats every few weeks on several days, counted from a week start Ignite doesn't use.",
	noStart: "It has no start date to take the day from.",
};

const none = (key) => ({ recurrence: null, reason: RRULE_REASONS[key] });

function extractRule(input) {
	if (typeof input !== "string") return { key: "empty" };
	const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	let rule = null;
	for (const line of lines) {
		const upper = line.toUpperCase();
		if (upper.startsWith("DTSTART")) continue;
		// Extra or skipped dates change which days the rule hits.
		if (upper.startsWith("RDATE") || upper.startsWith("EXDATE")) return { key: "unknown" };
		if (rule !== null) return { key: "unreadable" };
		rule = upper.startsWith("RRULE:") ? line.slice(6) : line;
	}
	return rule === null ? { key: "empty" } : { rule };
}

function readMonthDay(raw, start) {
	if (raw === undefined) return start ? start.getDate() : "noStart";
	if (raw.includes(",")) return "severalDays";
	if (raw === "-1") return 31; // Ignite clamps 31 to the month's last day
	if (/^-\d+$/.test(raw)) return "fromEnd";
	if (!/^\+?\d+$/.test(raw)) return "unreadable";
	const day = Number(raw.replace("+", ""));
	return day >= 1 && day <= 31 ? day : "unreadable";
}

export function rruleToRecurrence(input, startAt) {
	const extracted = extractRule(input);
	if (extracted.key) return none(extracted.key);

	const parts = new Map();
	for (const piece of extracted.rule.split(";")) {
		if (piece === "") continue;
		const eq = piece.indexOf("=");
		if (eq <= 0) return none("unreadable");
		const name = piece.slice(0, eq).toUpperCase();
		const value = piece.slice(eq + 1).toUpperCase();
		if (parts.has(name) || value === "") return none("unreadable");
		parts.set(name, value);
	}
	for (const name of parts.keys()) if (!KNOWN.has(name)) return none("unknown");
	if (parts.has("COUNT") || parts.has("UNTIL")) return none("ends");
	if (parts.has("BYSETPOS")) return none("position");
	if (parts.has("BYHOUR") || parts.has("BYMINUTE") || parts.has("BYSECOND")) return none("hours");
	if (parts.has("BYYEARDAY") || parts.has("BYWEEKNO")) return none("unknown");

	const freq = parts.get("FREQ");
	if (freq === undefined) return none("unreadable");
	if (TOO_OFTEN.has(freq)) return none("frequency");
	const type = FREQS.get(freq);
	if (!type) return none("unknown");

	let interval = 1;
	if (parts.has("INTERVAL")) {
		const raw = parts.get("INTERVAL");
		if (!/^\d+$/.test(raw) || Number(raw) < 1) return none("unreadable");
		interval = Number(raw);
	}

	const byDay = parts.get("BYDAY");
	const byMonthDay = parts.get("BYMONTHDAY");
	const byMonth = parts.get("BYMONTH");
	if (byDay !== undefined && type !== "weekly") {
		return none(/\d/.test(byDay) ? "position" : "weekdayRule");
	}
	if (byMonthDay !== undefined && (type === "daily" || type === "weekly")) return none("unknown");
	if (byMonth !== undefined && type !== "yearly") return none("unknown");

	const start = startAt instanceof Date && !Number.isNaN(startAt.getTime()) ? startAt : null;

	if (type === "daily") return { recurrence: { type, interval } };

	if (type === "weekly") {
		let weekdays;
		if (byDay === undefined) {
			if (!start) return none("noStart");
			weekdays = [start.getDay()];
		} else {
			const days = [];
			for (const token of byDay.split(",")) {
				if (/^[+-]?\d/.test(token)) return none("position");
				if (!WEEKDAY.has(token)) return none("unreadable");
				days.push(WEEKDAY.get(token));
			}
			weekdays = [...new Set(days)].sort((a, b) => a - b);
		}
		// Ignite's weeks run Sunday to Saturday (Date.getDay). RFC 5545 weeks
		// start on WKST, Monday by default. With one weekday, or every week,
		// the two always agree. For every N weeks with several days they agree
		// when WKST is Sunday, and when it is Monday unless Sunday is one of
		// the days. Any other WKST can group the days into different weeks, so
		// it is refused rather than guessed.
		const wkst = parts.get("WKST") ?? "MO";
		if (!WEEKDAY.has(wkst)) return none("unreadable");
		if (interval > 1 && weekdays.length > 1) {
			const agrees = wkst === "SU" || (wkst === "MO" && !weekdays.includes(0));
			if (!agrees) return none("weekStart");
		}
		return { recurrence: { type, interval, weekdays } };
	}

	const day = readMonthDay(byMonthDay, start);
	if (typeof day === "string") return none(day);

	if (type === "monthly") return { recurrence: { type, interval, day } };

	let month;
	if (byMonth === undefined) {
		if (!start) return none("noStart");
		month = start.getMonth() + 1;
	} else {
		if (byMonth.includes(",")) return none("severalMonths");
		if (!/^\d+$/.test(byMonth) || Number(byMonth) < 1 || Number(byMonth) > 12) return none("unreadable");
		month = Number(byMonth);
	}
	return { recurrence: { type: "yearly", interval, month, day } };
}
```

If Gate G1 printed part names outside `KNOWN`, add them to `KNOWN` and give them a reason with a test, so they never read as "unknown".

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/backup/rrule.test.js && npm run check`
Expected: PASS.

```bash
git add src/backup/rrule.js tests/backup/rrule.test.js
git commit -m "feat(import): turn Amplenote repeat rules into Ignite repeats"
```

---

### Task 9: Parse the Amplenote ZIP

**Waits for Gate G1.**

**Files:**
- Create: `src/backup/amplenote-parse.js`
- Test: `tests/backup/amplenote-parse.test.js`

**Interfaces:**
- Produces:
  - `parseAmplenoteZip(bytes: Uint8Array) → { ok: true, notes: Note[], otherFiles: number } | { ok: false, reason: string }`.
  - `Note = { path, uuid: string|null, title: string, problem: string|null, items: Item[], leftBehind: number, images: number }`.
  - `Item = { kind: "heading", text } | { kind: "task", text: string (raw Markdown), meta: Map|null, metaProblem: boolean, subtask: boolean }`.
  - `markdownToPlain(text) → string`.
  - Constants `MAX_ZIP_BYTES`, `MAX_MARKDOWN_BYTES`, `INPUT_CHUNK_BYTES`, `NOT_AMPLENOTE`, `TOO_BIG_EXPORT`, `HEADER_PROBLEM`.
  - A note whose header can't be read still carries the open tasks of its body in `items` (counted, never imported), so the checklist and the report can say how many tasks it holds.

- [ ] **Step 1: Write the failing tests**

`tests/backup/amplenote-parse.test.js`:

```js
import { strToU8, Unzip, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
	HEADER_PROBLEM,
	INPUT_CHUNK_BYTES,
	MAX_ZIP_BYTES,
	markdownToPlain,
	NOT_AMPLENOTE,
	parseAmplenoteZip,
	TOO_BIG_EXPORT,
} from "../../src/backup/amplenote-parse.js";

const U1 = "aaaaaaaa-1111-4111-8111-111111111111";
const T1 = "bbbbbbbb-1111-4111-8111-111111111111";
const T2 = "bbbbbbbb-2222-4222-8222-222222222222";

const note = (title, body, uuid = U1) =>
	`---\ntitle: ${title}\nuuid: ${uuid}\nversion: 7\ncreated: '2026-01-01T10:00:00+01:00'\ntags:\n  - home\n---\n${body}`;
const zip = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));
const task = (text, meta) => `- [ ] ${text}<!-- ${JSON.stringify(meta)} -->`;

describe("parseAmplenoteZip, front matter", () => {
	it("reads title, uuid and tags", () => {
		const out = parseAmplenoteZip(zip({ "Home.md": note("Home", "") }));
		expect(out.ok).toBe(true);
		expect(out.notes[0]).toMatchObject({ uuid: U1, title: "Home", problem: null });
	});

	it("decodes double-quoted escapes", () => {
		const out = parseAmplenoteZip(zip({ "n.md": note('"\\U0001F4DD Notes \\u00e6\\x41 \\"q\\" \\\\"', "") }));
		expect(out.notes[0].title).toBe('📝 Notes æA "q" \\');
	});

	it("reads single quotes with a doubled quote", () => {
		const out = parseAmplenoteZip(zip({ "n.md": note("'It''s mine'", "") }));
		expect(out.notes[0].title).toBe("It's mine");
	});

	it("marks a note with an unreadable header as a problem, and keeps the others", () => {
		const bad = `---\ntitle: "unterminated\nuuid: ${U1}\n---\n${task("A", { uuid: T1 })}`;
		const out = parseAmplenoteZip(zip({ "Bad.md": bad, "Good.md": note("Good", "", "cccccccc-1111-4111-8111-111111111111") }));
		expect(out.ok).toBe(true);
		const badNote = out.notes.find((n) => n.path === "Bad.md");
		expect(badNote).toMatchObject({ problem: HEADER_PROBLEM, uuid: null, title: "Bad" });
		// Its open task is still counted, so the report can say what stays behind.
		expect(badNote.items.filter((i) => i.kind === "task")).toHaveLength(1);
		expect(out.notes.find((n) => n.path === "Good.md").problem).toBeNull();
	});

	it("handles CRLF line endings and a BOM (Review Focus 3)", () => {
		const text = `\uFEFF${note("Home", task("Call", { uuid: T1 }))}`.replace(/\n/g, "\r\n");
		const out = parseAmplenoteZip(zip({ "Home.md": text }));
		expect(out.notes[0]).toMatchObject({ uuid: U1, title: "Home" });
		expect(out.notes[0].items).toHaveLength(1);
	});
});

describe("parseAmplenoteZip, body", () => {
	const body = [
		"Intro text",
		task("Before any heading", { uuid: T1 }),
		"## **Garden**",
		task("Water *the* plants", { uuid: T2, startAt: 1_800_000_000, important: true }),
		"  continued under the task",
		"- [x] Done one<!-- {} -->",
		task("Stamped done", { uuid: T1, completedAt: 1 }),
		task("Dismissed", { uuid: T1, dismissedAt: 1 }),
		task("Crossed out", { uuid: T1, crossedOutAt: 1 }),
		"- [ ] Broken meta<!-- {not json -->",
		"  - [ ] A subtask<!-- {\"uuid\":\"dddddddd-1111-4111-8111-111111111111\"} -->",
		"![photo](images/a.png)",
		"```",
		"# not a heading",
		"```",
	].join("\n");
	const out = parseAmplenoteZip(zip({ "Home.md": note("Home", body) }));
	const items = out.notes[0].items;

	it("finds headings with emphasis removed", () => {
		expect(items.filter((i) => i.kind === "heading").map((i) => i.text)).toEqual(["Garden"]);
	});

	it("strips only a closing # run that follows a space", () => {
		const lines = ["## Learn C#", "### Closed ###", "##", "#hashtag"].join("\n");
		const headings = parseAmplenoteZip(zip({ "h.md": note("H", lines) }))
			.notes[0].items.filter((i) => i.kind === "heading")
			.map((i) => i.text);
		expect(headings).toEqual(["Learn C#", "Closed", ""]);
	});

	it("keeps only open tasks", () => {
		expect(items.filter((i) => i.kind === "task").map((i) => i.text)).toEqual([
			"Before any heading", "Water *the* plants", "Broken meta", "A subtask",
		]);
	});

	it("reads the metadata comment into a Map", () => {
		const water = items.find((i) => i.text === "Water *the* plants");
		expect(water.meta.get("startAt")).toBe(1_800_000_000);
		expect(water.meta.get("important")).toBe(true);
	});

	it("keeps a task with broken metadata, flagged", () => {
		expect(items.find((i) => i.text === "Broken meta")).toMatchObject({ meta: null, metaProblem: true });
	});

	it("keeps an indented open task as a subtask (Review Focus 2)", () => {
		expect(items.find((i) => i.text === "A subtask")).toMatchObject({ subtask: true, metaProblem: false });
	});

	it("counts left-behind text and images, never keeps them", () => {
		// Intro, the continued line, and the three fenced lines.
		expect(out.notes[0].leftBehind).toBe(5);
		expect(out.notes[0].images).toBe(1);
		expect(JSON.stringify(out)).not.toContain("Intro text");
	});
});

describe("parseAmplenoteZip, refusals and caps", () => {
	it("refuses a ZIP with no Amplenote note", () => {
		expect(parseAmplenoteZip(zip({ "readme.txt": "hi", "x.md": "no front matter" }))).toEqual({ ok: false, reason: NOT_AMPLENOTE });
	});

	it("refuses bytes that aren't a ZIP", () => {
		expect(parseAmplenoteZip(strToU8("not a zip at all"))).toEqual({ ok: false, reason: NOT_AMPLENOTE });
	});

	it("refuses a ZIP over 100 MB before reading it", () => {
		const fake = new Uint8Array(MAX_ZIP_BYTES + 1);
		expect(parseAmplenoteZip(fake)).toEqual({ ok: false, reason: TOO_BIG_EXPORT });
	});

	it("counts other entries without reading them", () => {
		const out = parseAmplenoteZip(zip({ "Home.md": note("Home", ""), "images/a.png": new Uint8Array(10), "images/b.png": new Uint8Array(10) }));
		expect(out.otherFiles).toBe(2);
	});

	it("doesn't count a huge non-Markdown entry toward the 50 MB cap", () => {
		const big = new Uint8Array(60 * 1024 * 1024);
		const out = parseAmplenoteZip(zip({ "Home.md": note("Home", ""), "video.bin": big }));
		expect(out.ok).toBe(true);
	});

	it("aborts when Markdown inflates past 50 MB", () => {
		const bomb = zip({ "Home.md": note("Home", "a".repeat(51 * 1024 * 1024)) });
		expect(parseAmplenoteZip(bomb)).toEqual({ ok: false, reason: TOO_BIG_EXPORT });
	});

	it("aborts when the header lies about the size", () => {
		const bomb = zip({ "Home.md": note("Home", "a".repeat(51 * 1024 * 1024)) });
		const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
		// Local file header: uncompressed size at +22. Central directory: at +24.
		view.setUint32(22, 10, true);
		for (let i = 0; i < bomb.length - 4; i++) {
			if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 10, true);
		}
		expect(parseAmplenoteZip(bomb)).toEqual({ ok: false, reason: TOO_BIG_EXPORT });
	});

	it("feeds the ZIP in small slices and stops once the cap is passed", () => {
		// fflate's sync inflater turns one push into one output chunk, so a
		// single push of the whole file would inflate a bomb in full before the
		// cap is ever checked. Proof of the guard: no push is bigger than a
		// slice (with room for fflate's own header carry-over), and reading
		// never reaches the incompressible 2 MB that sits behind the bomb.
		const pad = new Uint8Array(2 * 1024 * 1024);
		for (let i = 0; i < pad.length; i += 65_536) crypto.getRandomValues(pad.subarray(i, i + 65_536));
		const bomb = zip({ "Home.md": note("Home", "a".repeat(51 * 1024 * 1024)), "pad.bin": pad });
		const push = vi.spyOn(Unzip.prototype, "push");
		try {
			expect(parseAmplenoteZip(bomb)).toEqual({ ok: false, reason: TOO_BIG_EXPORT });
			const chunks = push.mock.calls.map(([chunk]) => chunk);
			expect(Math.max(...chunks.map((c) => c.length))).toBeLessThanOrEqual(2 * INPUT_CHUNK_BYTES);
			const reached = Math.max(...chunks.filter((c) => c.buffer === bomb.buffer).map((c) => c.byteOffset + c.length));
			expect(reached - bomb.byteOffset).toBeLessThan(bomb.length / 2);
		} finally {
			push.mockRestore();
		}
	});
});

describe("markdownToPlain", () => {
	it.each([
		["**bold** and _it_ and ~~gone~~", "bold and it and gone"],
		["`code` stays", "code stays"],
		["[Docs](https://x.no)", "Docs (https://x.no)"],
		["[https://x.no](https://x.no)", "https://x.no"],
		["snake_case_name", "snake_case_name"],
		["\\*not emphasis\\*", "*not emphasis*"],
		["  many   spaces  ", "many spaces"],
	])("%s", (input, expected) => {
		expect(markdownToPlain(input)).toBe(expected);
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/backup/amplenote-parse.test.js`
Expected: FAIL, cannot find `amplenote-parse.js`.

- [ ] **Step 3: Implement**

`src/backup/amplenote-parse.js`:

```js
// Amplenote export ZIP → notes. Pure apart from fflate.
//
// The ZIP is read in memory and never stored. Only .md entries are inflated,
// through fflate's streaming Unzip, counting the bytes that actually come
// out: a header's declared size can lie, so the 50 MB cap counts real bytes
// and aborts the moment it's passed (a ZIP bomb guard). Other entries are
// counted and never started.
//
// Left-behind text is counted per note, never kept.

import { Unzip, UnzipInflate } from "fflate";

export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
export const MAX_MARKDOWN_BYTES = 50 * 1024 * 1024;
// fflate's sync inflater turns everything handed to it in one push into ONE
// output chunk. Pushing the whole ZIP at once would inflate a bomb in full
// before the counter below saw a byte. Slices bound each burst (deflate tops
// out near 1032:1, so 16 KB in is at most about 17 MB out), and the loop
// stops the moment the cap is passed.
export const INPUT_CHUNK_BYTES = 16 * 1024;
export const NOT_AMPLENOTE = "This doesn't look like an Amplenote export.";
export const TOO_BIG_EXPORT = "This export is too big to read here.";
export const HEADER_PROBLEM = "Couldn't read this note's header.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A closing run of # is only stripped when a space comes before it, as in
// CommonMark, so "## Learn C#" keeps its "#". A bare "##" is an empty heading.
const HEADING_RE = /^(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const TASK_RE = /^(\s*)[-*+] \[([ xX])\] (.*)$/;
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/;
const FENCE_RE = /^\s*(```|~~~)/;
const KEY_RE = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/;
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (reason) => ({ ok: false, reason });

function readMarkdownEntries(bytes) {
	const markdown = [];
	let otherFiles = 0;
	let inflated = 0;
	let tooBig = false;
	let broken = false;

	const unzip = new Unzip((file) => {
		if (tooBig || broken) return;
		if (!file.name.toLowerCase().endsWith(".md")) {
			if (!file.name.endsWith("/")) otherFiles++;
			return; // never start(): never handed to a decoder
		}
		const decoder = new TextDecoder("utf-8");
		let text = "";
		file.ondata = (err, chunk, final) => {
			if (tooBig || broken) return;
			if (err) {
				broken = true;
				return;
			}
			inflated += chunk.length;
			if (inflated > MAX_MARKDOWN_BYTES) {
				tooBig = true;
				file.terminate();
				return;
			}
			text += decoder.decode(chunk, { stream: !final });
			if (final) markdown.push({ path: file.name, text });
		};
		file.start();
	});
	unzip.register(UnzipInflate);
	try {
		for (let offset = 0; offset < bytes.length && !tooBig && !broken; offset += INPUT_CHUNK_BYTES) {
			const end = Math.min(offset + INPUT_CHUNK_BYTES, bytes.length);
			unzip.push(bytes.subarray(offset, end), end === bytes.length);
		}
	} catch {
		broken = true;
	}
	if (tooBig) return fail(TOO_BIG_EXPORT);
	if (broken) return fail(NOT_AMPLENOTE);
	return { ok: true, markdown, otherFiles };
}

const SIMPLE_ESCAPES = new Map([["n", "\n"], ["t", "\t"], ["r", "\r"], ["0", "\0"], ['"', '"'], ["\\", "\\"], ["/", "/"], [" ", " "]]);
const HEX_ESCAPES = new Map([["x", 2], ["u", 4], ["U", 8]]);

function decodeDoubleQuoted(inner) {
	let out = "";
	for (let i = 0; i < inner.length; i++) {
		const c = inner[i];
		if (c === '"') return null;
		if (c !== "\\") {
			out += c;
			continue;
		}
		const next = inner[++i];
		if (SIMPLE_ESCAPES.has(next)) {
			out += SIMPLE_ESCAPES.get(next);
			continue;
		}
		const len = HEX_ESCAPES.get(next);
		if (!len) return null;
		const hex = inner.slice(i + 1, i + 1 + len);
		if (hex.length !== len || !/^[0-9a-fA-F]+$/.test(hex)) return null;
		const cp = Number.parseInt(hex, 16);
		if (cp > 0x10ffff) return null;
		out += String.fromCodePoint(cp);
		i += len;
	}
	return out;
}

function parseScalar(raw) {
	if (raw.startsWith('"')) {
		// decodeDoubleQuoted refuses an unescaped quote inside, and a trailing
		// backslash (which would escape the closing quote).
		if (raw.length < 2 || !raw.endsWith('"')) return null;
		return decodeDoubleQuoted(raw.slice(1, -1));
	}
	if (raw.startsWith("'")) {
		if (raw.length < 2 || !raw.endsWith("'")) return null;
		const inner = raw.slice(1, -1);
		if (inner.replace(/''/g, "").includes("'")) return null;
		return inner.replace(/''/g, "'");
	}
	return raw;
}

function parseFlowList(raw) {
	if (!raw.endsWith("]")) return null;
	const inner = raw.slice(1, -1).trim();
	if (inner === "") return [];
	const items = [];
	let token = "";
	let quote = null;
	for (const c of inner) {
		if (quote) {
			token += c;
			if (c === quote) quote = null;
		} else if (c === '"' || c === "'") {
			quote = c;
			token += c;
		} else if (c === ",") {
			items.push(token.trim());
			token = "";
		} else token += c;
	}
	if (quote) return null;
	items.push(token.trim());
	const values = items.map(parseScalar);
	return values.includes(null) ? null : values;
}

// The exact front-matter shape Amplenote writes: `key: value` scalars
// (plain, 'single' or "double" quoted) and lists. Anything else → null.
function parseFrontMatter(lines) {
	const map = new Map();
	let listKey = null;
	for (const line of lines) {
		if (line.trim() === "") continue;
		const item = line.match(/^\s*-\s+(.*)$/);
		if (item && listKey) {
			const value = parseScalar(item[1].trim());
			if (value === null) return null;
			map.get(listKey).push(value);
			continue;
		}
		const m = line.match(KEY_RE);
		if (!m) return null;
		const key = m[1];
		const raw = (m[2] ?? "").trim();
		listKey = null;
		if (raw === "") {
			map.set(key, []);
			listKey = key;
		} else if (raw.startsWith("[")) {
			const list = parseFlowList(raw);
			if (list === null) return null;
			map.set(key, list);
		} else {
			const value = parseScalar(raw);
			if (value === null) return null;
			map.set(key, value);
		}
	}
	return map;
}

function splitTaskComment(rest) {
	const idx = rest.lastIndexOf("<!--");
	if (idx === -1) return { text: rest.trim(), meta: null, problem: true };
	const text = rest.slice(0, idx).trim();
	const m = rest.slice(idx).match(/^<!--\s*(\{.*\})\s*-->\s*$/);
	if (!m) return { text, meta: null, problem: true };
	try {
		const obj = JSON.parse(m[1]);
		if (!isPlainObject(obj)) return { text, meta: null, problem: true };
		return { text, meta: new Map(Object.entries(obj)), problem: false };
	} catch {
		return { text, meta: null, problem: true };
	}
}

function parseBody(lines) {
	const items = [];
	let leftBehind = 0;
	let images = 0;
	let inFence = false;
	for (const line of lines) {
		if (FENCE_RE.test(line)) {
			inFence = !inFence;
			leftBehind++;
			continue;
		}
		if (inFence) {
			leftBehind++;
			continue;
		}
		if (line.trim() === "") continue;
		const heading = /^\s/.test(line) ? null : line.match(HEADING_RE);
		if (heading) {
			items.push({ kind: "heading", text: markdownToPlain(heading[2] ?? "") });
			continue;
		}
		const t = line.match(TASK_RE);
		if (t) {
			if (t[2] !== " ") continue;
			const { text, meta, problem } = splitTaskComment(t[3]);
			if (meta && (meta.get("completedAt") || meta.get("dismissedAt") || meta.get("crossedOutAt"))) continue;
			// Indented open tasks are Amplenote subtasks. Ignite has no
			// subtasks, so they arrive as ordinary tasks rather than being
			// dropped (R2).
			items.push({ kind: "task", text, meta, metaProblem: problem, subtask: t[1].length > 0 });
			continue;
		}
		if (IMAGE_RE.test(line)) images++;
		else leftBehind++;
	}
	return { items, leftBehind, images };
}

const fileStem = (path) => path.split("/").pop().replace(/\.md$/i, "");

// A note that can't be imported still has its body read, so the checklist
// and the report can say how many open tasks stay behind (R2: nothing is
// dropped silently). bodyLines is empty when the header never closes.
function problemNote(path, bodyLines = []) {
	return { path, uuid: null, title: fileStem(path), problem: HEADER_PROBLEM, ...parseBody(bodyLines) };
}

function parseNote(path, text) {
	const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
	if (lines[0] !== "---") return { note: problemNote(path, lines), hasFrontMatter: false };
	const end = lines.indexOf("---", 1);
	if (end === -1) return { note: problemNote(path), hasFrontMatter: true };
	const header = parseFrontMatter(lines.slice(1, end));
	const uuid = header?.get("uuid");
	let title = header?.get("title");
	if (Array.isArray(title) && title.length === 0) title = "";
	if (!header || typeof uuid !== "string" || !UUID_RE.test(uuid) || typeof title !== "string") {
		return { note: problemNote(path, lines.slice(end + 1)), hasFrontMatter: true };
	}
	return {
		note: { path, uuid: uuid.toLowerCase(), title, problem: null, ...parseBody(lines.slice(end + 1)) },
		hasFrontMatter: true,
	};
}

export function parseAmplenoteZip(bytes) {
	if (!(bytes instanceof Uint8Array)) return fail(NOT_AMPLENOTE);
	if (bytes.length > MAX_ZIP_BYTES) return fail(TOO_BIG_EXPORT);
	const entries = readMarkdownEntries(bytes);
	if (!entries.ok) return entries;
	const notes = [];
	let sawFrontMatter = false;
	for (const { path, text } of entries.markdown) {
		const { note, hasFrontMatter } = parseNote(path, text);
		if (hasFrontMatter) sawFrontMatter = true;
		notes.push(note);
	}
	if (!sawFrontMatter) return fail(NOT_AMPLENOTE);
	return { ok: true, notes, otherFiles: entries.otherFiles };
}

// Markdown inline → plain text. Escaped characters are swapped for
// private-use placeholders first, so `\*` is never read as emphasis.
const ESCAPABLE = "\\`*_{}[]()#+-.!~|<>";
const hold = (c) => String.fromCharCode(0xe000 + ESCAPABLE.indexOf(c));
const HELD_RE = /[\uE000-\uE012]/g;

export function markdownToPlain(text) {
	let out = String(text ?? "").replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, (_, c) => hold(c));
	out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
	out = out.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) => {
		const t = label.trim();
		return !t || t === url ? url : `${t} (${url})`;
	});
	out = out.replace(/(\*\*|__|~~)(?=\S)(.+?)(?<=\S)\1/g, "$2");
	out = out.replace(/(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, "$1");
	out = out.replace(/(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1");
	out = out.replace(/`([^`]+)`/g, "$1");
	out = out.replace(HELD_RE, (c) => ESCAPABLE[c.charCodeAt(0) - 0xe000]);
	return out.replace(/\s+/g, " ").trim();
}
```

`ESCAPABLE` has 19 characters, so the held range is U+E000 to U+E012. If you change it, update `HELD_RE` (a range one too wide turns a stray U+E013 in a title into the text "undefined").

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/backup/amplenote-parse.test.js && npm run check`
Expected: PASS. The 51 MB cases take a second or two each; that's fine. If fflate's behaviour differs from the type comments quoted in the spec research (for example `terminate` throws on a sync inflater), fix the parser, not the test.

```bash
git add src/backup/amplenote-parse.js tests/backup/amplenote-parse.test.js
git commit -m "feat(import): read the Amplenote export ZIP in memory with size caps"
```

---

### Task 10: Map notes to areas, sections and tasks, and build the report

**Waits for Gate G1.**

**Files:**
- Create: `src/backup/amplenote-map.js`
- Test: `tests/backup/amplenote-map.test.js`

**Interfaces:**
- Consumes: `markdownToPlain`, `HEADER_PROBLEM` (Task 9), `rruleToRecurrence` (Task 8), `formatBackupStamp`, `fileStamp` (Task 3), `capitalizeFirst` (`src/utils/text.js`), `uuid` (`src/utils/id.js`).
- Produces:
  - `parseRepeatsFile(text) → { ok: true, repeats: Map<uuid, { repeat: string|null, isRepeating: boolean }> } | { ok: false, reason }`; constants `NOT_A_REPEATS_FILE`, `MAX_REPEATS_BYTES`.
  - `splitTitle(title) → { icon, name }`.
  - `noteChoices(notes) → Array<{ uuid, key, icon, name, openTasks, disabledReason: string|null }>` sorted like the areas.
  - `mapAmplenote(parsed, pickedUuids: Set, repeats: Map|null, { now, newId }) → { areas, sections, tasks, report }`. Areas get `order` 1..n (Focus keeps 0); Focus is NOT in the output.
  - `reportSections(report) → Array<{ heading, lines: string[] }>`; `reportToText(report, now) → string`; `reportFileName(now) → string`.

- [ ] **Step 1: Write the failing tests**

`tests/backup/amplenote-map.test.js`:

```js
import { describe, expect, it } from "vitest";
import { validateBackup } from "../../src/backup/backup-format.js";
import { FOCUS_DEFAULT_SECTION, FOCUS_DEFAULTS } from "../../src/model/areas.js";
import {
	mapAmplenote,
	NOT_A_REPEATS_FILE,
	noteChoices,
	parseRepeatsFile,
	reportFileName,
	reportSections,
	reportToText,
	splitTitle,
} from "../../src/backup/amplenote-map.js";

const NOW = new Date(2026, 10, 9, 13, 20);
let n = 0;
const newId = () => `id-${++n}`;
const T = (i) => `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`;
const N = (i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`;
const heading = (text) => ({ kind: "heading", text });
const task = (text, meta = {}, extra = {}) => ({ kind: "task", text, meta: new Map(Object.entries(meta)), metaProblem: false, subtask: false, ...extra });
const note = (i, title, items, extra = {}) => ({ path: `${title}.md`, uuid: N(i), title, problem: null, items, leftBehind: 0, images: 0, ...extra });
const parsed = (notes, otherFiles = 0) => ({ ok: true, notes, otherFiles });
const run = (notes, picked, repeats = null) => {
	n = 0;
	return mapAmplenote(parsed(notes), new Set(picked), repeats, { now: NOW, newId });
};

describe("splitTitle", () => {
	it("splits a leading emoji into the icon", () => {
		expect(splitTitle("🏠 Home")).toEqual({ icon: "🏠", name: "Home" });
	});
	it("keeps a multi-code-point emoji whole", () => {
		expect(splitTitle("👩‍💻 Work")).toEqual({ icon: "👩‍💻", name: "Work" });
	});
	it("leaves a title without an emoji alone", () => {
		expect(splitTitle("garden")).toEqual({ icon: "", name: "Garden" });
	});
	it("names an emoji-only title Untitled", () => {
		expect(splitTitle("📝")).toEqual({ icon: "📝", name: "Untitled" });
	});
	it("treats a flag and a keycap as emoji too", () => {
		// Flags are regional-indicator pairs, which \p{Extended_Pictographic}
		// doesn't match.
		expect(splitTitle("🇳🇴 Norsk")).toEqual({ icon: "🇳🇴", name: "Norsk" });
		expect(splitTitle("1️⃣ First")).toEqual({ icon: "1️⃣", name: "First" });
		expect(splitTitle("1 First")).toEqual({ icon: "", name: "1 First" });
	});
});

describe("mapAmplenote, structure", () => {
	const home = note(2, "🏠 Home", [
		task("Before headings", { uuid: T(1) }),
		heading("Garden"),
		task("Water", { uuid: T(2) }),
		heading("Empty one"),
		heading(""),
		task("Under an empty heading", { uuid: T(3) }),
		heading("Garden"),
		task("Second garden", { uuid: T(4) }),
	]);
	const out = run([home, note(1, "Admin", [task("File taxes", { uuid: T(5) })])], [N(1), N(2)]);

	it("orders areas by name in Norwegian, after Focus", () => {
		expect(out.areas.map((a) => [a.name, a.order])).toEqual([["Admin", 1], ["Home", 2]]);
	});

	it("breaks name ties by note uuid", () => {
		const a = run([note(2, "Same", [task("x", { uuid: T(1) })]), note(1, "Same", [task("y", { uuid: T(2) })])], [N(1), N(2)]);
		expect(a.areas.map((x) => x.name)).toEqual(["Same", "Same"]);
		expect(a.tasks.find((t) => t.title === "Y").sectionId).toBe(a.sections.find((s) => s.areaId === a.areas[0].id).id);
	});

	it("makes a Tasks section, skips empty headings, keeps duplicates apart", () => {
		const homeId = out.areas.find((a) => a.name === "Home").id;
		expect(out.sections.filter((s) => s.areaId === homeId).map((s) => [s.name, s.order])).toEqual([
			["Tasks", 0], ["Garden", 1], ["Untitled section", 2], ["Garden", 3],
		]);
	});

	it("leaves unpicked notes out", () => {
		expect(run([home], []).areas).toEqual([]);
	});
});

describe("mapAmplenote, task fields", () => {
	const meta = { uuid: T(1), startAt: 1_800_000_000, important: true, notify: "PT15M", urgent: true, score: 3, hideUntil: 1 };
	const out = run([note(1, "Home", [task("**Call** [the vet](https://vet.no)", meta)])], [N(1)]);
	const t = out.tasks[0];

	it("cleans and capitalises the title", () => {
		expect(t.title).toBe("Call the vet (https://vet.no)");
	});
	it("maps the date with a time, even in the past", () => {
		expect(t.dueAt).toBe(new Date(1_800_000_000 * 1000).toISOString());
		expect(t.hasTime).toBe(true);
		const past = run([note(1, "Home", [task("Old", { uuid: T(2), startAt: 1_000_000_000 })])], [N(1)]);
		expect(past.tasks[0].dueAt).toBe(new Date(1_000_000_000 * 1000).toISOString());
	});
	it("maps important to a star", () => {
		expect(t.starred).toBe(true);
	});
	it.each([["PT5M", 5], ["PT15M", 15], ["PT1H", 60], ["PT24H", 1440], ["P1D", 1440], ["P1DT2H30M", 1590], [false, 0], [undefined, 0]])(
		"notify %s → %i minutes",
		(notify, minutes) => {
			const m = notify === undefined ? { uuid: T(3) } : { uuid: T(3), notify };
			expect(run([note(1, "H", [task("x", m)])], [N(1)]).tasks[0].leadTime).toBe(minutes);
		},
	);
	it("gives the defaults tasks.create gives", () => {
		expect(t).toMatchObject({ notes: "", completed: false, critical: false, lastCompletedAt: null, completedCount: 0, scheduledTags: [], createdAt: NOW.toISOString(), recurrence: null, order: 0 });
	});
	it("counts dropped fields", () => {
		expect(Object.fromEntries(out.report.droppedFields)).toEqual({ hideUntil: 1, score: 1, urgent: 1 });
	});
	it.each([[""], ["![](photo.png)"]])("titles a task with no text (%j) Untitled task (Review Focus 5)", (text) => {
		expect(run([note(1, "H", [task(text, { uuid: T(4) })])], [N(1)]).tasks[0].title).toBe("Untitled task");
	});
	it("imports a subtask and counts it (Review Focus 2)", () => {
		const r = run([note(1, "H", [task("Sub", { uuid: T(5) }, { subtask: true })])], [N(1)]);
		expect(r.tasks).toHaveLength(1);
		expect(r.report.subtasks).toBe(1);
	});
	it("imports a task with broken metadata and reports it", () => {
		const r = run([note(1, "H", [{ kind: "task", text: "Broken", meta: null, metaProblem: true, subtask: false }])], [N(1)]);
		expect(r.tasks[0]).toMatchObject({ title: "Broken", dueAt: null, starred: false });
		expect(r.report.problems).toEqual([{ note: "H", title: "Broken", message: "Imported without its date and flags: the metadata was damaged." }]);
	});
	it("imports a task whose date is out of range, undated, and reports it", () => {
		// new Date(1e18) is an Invalid Date, and toISOString() would throw.
		const r = run([note(1, "H", [task("Far", { uuid: T(6), startAt: 1e15 })])], [N(1)]);
		expect(r.tasks[0]).toMatchObject({ title: "Far", dueAt: null, hasTime: false });
		expect(r.report.problems).toEqual([{ note: "H", title: "Far", message: "Imported without its date: the date couldn't be read." }]);
	});
	it("maps to data the backup reader accepts, so a later restore never refuses it", () => {
		const r = run([note(1, "🏠 Home", [heading(""), task("", { uuid: T(7), startAt: 1_800_000_000, notify: "P1DT2H30M", important: true })])], [N(1)]);
		const file = {
			app: "ignite", schemaVersion: 1, appVersion: "0.9.0", exportedAt: NOW.toISOString(),
			areas: [FOCUS_DEFAULTS, ...r.areas], sections: [FOCUS_DEFAULT_SECTION, ...r.sections], tasks: r.tasks,
		};
		expect(validateBackup(JSON.stringify(file)).ok).toBe(true);
	});
});

describe("repeats", () => {
	const notes = [note(1, "H", [
		task("Daily", { uuid: T(1), startAt: 1_800_000_000 }),
		task("Relative", { uuid: T(2) }),
		task("Odd", { uuid: T(3) }),
		task("Missing", { uuid: T(4) }),
		task("Plain", { uuid: T(5) }),
	]), note(2, "Unpicked", [task("Elsewhere", { uuid: T(6) })])];
	const repeats = new Map([
		[T(1), { repeat: "FREQ=DAILY", isRepeating: true }],
		[T(2), { repeat: null, isRepeating: true }],
		[T(3), { repeat: "FREQ=MONTHLY;BYDAY=1MO", isRepeating: true }],
		[T(5), { repeat: null, isRepeating: false }],
		[T(6), { repeat: null, isRepeating: false }],
		[T(9), { repeat: "FREQ=DAILY", isRepeating: true }],
	]);
	const out = run(notes, [N(1)], repeats);

	it("maps a supported rule", () => {
		expect(out.tasks.find((t) => t.title === "Daily").recurrence).toEqual({ type: "daily", interval: 1 });
	});
	it("lists what has to be set by hand, with reasons", () => {
		expect(out.report.repeatsByHand.map((r) => [r.title, r.reason])).toEqual([
			["Relative", "It repeats after completion; set it by hand."],
			["Odd", "It repeats on a numbered weekday, such as the first Monday."],
			["Missing", "It isn't in the repeats file, which may be older than the export."],
		]);
	});
	it("counts the join both ways", () => {
		// T(9) matches no task in any note; T(6) matches a task in an unpicked note.
		expect(out.report.repeatsFile).toEqual({ used: true, matched: 5, tasksWithoutEntry: 1, entriesWithoutTask: 1 });
	});
	it("joins case-insensitively (Review Focus 4)", () => {
		const upper = run([note(1, "H", [task("Daily", { uuid: T(1).toUpperCase() })])], [N(1)], repeats);
		expect(upper.tasks[0].recurrence).toEqual({ type: "daily", interval: 1 });
	});
	it("says when no repeats file was used", () => {
		expect(run(notes, [N(1)]).report.repeatsFile.used).toBe(false);
	});
});

describe("parseRepeatsFile", () => {
	const file = (tasks, over = {}) => JSON.stringify({ app: "ignite-amplenote-repeats", version: 1, exportedAt: "2026-11-09T12:00:00.000Z", tasks, ...over });
	it("reads entries into a Map", () => {
		const r = parseRepeatsFile(file({ [T(1)]: { repeat: "FREQ=DAILY", isRepeating: true } }));
		expect(r.ok).toBe(true);
		expect(r.repeats.get(T(1))).toEqual({ repeat: "FREQ=DAILY", isRepeating: true });
	});
	it("ignores a __proto__ key and other non-uuid keys", () => {
		const raw = `{"app":"ignite-amplenote-repeats","version":1,"tasks":{"__proto__":{"repeat":"x"},"nope":{},"${T(1).toUpperCase()}":{"repeat":null,"isRepeating":false}}}`;
		const r = parseRepeatsFile(raw);
		expect([...r.repeats.keys()]).toEqual([T(1)]);
		expect({}.repeat).toBeUndefined();
	});
	it.each([["not json"], [file({}, { app: "other" })], [file({}, { version: 2 })], [JSON.stringify({ app: "ignite-amplenote-repeats", version: 1, tasks: [] })]])(
		"refuses %s",
		(text) => {
			expect(parseRepeatsFile(text)).toEqual({ ok: false, reason: NOT_A_REPEATS_FILE });
		},
	);
});

describe("noteChoices", () => {
	it("disables notes with no open tasks or a bad header", () => {
		const choices = noteChoices([
			note(1, "🏠 Home", [task("x", { uuid: T(1) })]),
			note(2, "Empty", []),
			{ path: "Broken.md", uuid: null, title: "Broken", problem: "Couldn't read this note's header.", items: [], leftBehind: 0, images: 0 },
		]);
		expect(choices.map((c) => [c.name, c.openTasks, c.disabledReason])).toEqual([
			["Broken", 0, "Couldn't read this note's header."],
			["Empty", 0, "No open tasks."],
			["Home", 1, null],
		]);
	});
	it("says how many open tasks an unreadable note holds", () => {
		const broken = { path: "Broken.md", uuid: null, title: "Broken", problem: "Couldn't read this note's header.", items: [task("a"), task("b")], leftBehind: 0, images: 0 };
		expect(noteChoices([broken])[0].disabledReason).toBe("Couldn't read this note's header. Its 2 open tasks can't be imported.");
		const r = run([broken], []);
		expect(r.report.problems).toEqual([{ note: "Broken", title: null, message: "Couldn't read this note's header. Its 2 open tasks weren't imported." }]);
	});
});

describe("the report", () => {
	const out = mapAmplenote(
		parsed([note(1, "H", [task("A", { uuid: T(1), urgent: true })], { leftBehind: 3, images: 1 })], 2),
		new Set([N(1)]),
		null,
		{ now: NOW, newId },
	);
	it("has sections in order and leaves empty ones out", () => {
		expect(reportSections(out.report).map((s) => s.heading)).toEqual(["Imported", "Dropped fields", "Left behind", "Repeats file"]);
	});
	it("writes plain text with a header", () => {
		const text = reportToText(out.report, NOW);
		expect(text.startsWith("Ignite import report, 09.11.2026 13:20\n")).toBe(true);
		expect(text).toContain("- H: 1 task");
		expect(text).toContain("- urgent: 1 task");
		expect(text).toContain("- H: 3 lines of text, 1 image");
		expect(text).toContain("- Other files in the export: 2");
		expect(text).toContain("- Not included, so no repeats were imported.");
	});
	it("names the file", () => {
		expect(reportFileName(NOW)).toBe("ignite-import-report-2026-11-09-1320.txt");
	});
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/backup/amplenote-map.test.js`
Expected: FAIL, cannot find `amplenote-map.js`.

- [ ] **Step 3: Implement**

`src/backup/amplenote-map.js`:

```js
// Picked Amplenote notes + repeats → Ignite areas, sections, tasks, and the
// import report. Pure: ids and the clock are injected.
//
// Focus is NOT in the output. The import flow keeps the current Focus area and
// its notepad section (same ids) and empties the notepad, so imported areas
// take order 1..n.

import { uuid as defaultId } from "../utils/id.js";
import { capitalizeFirst } from "../utils/text.js";
import { fileStamp, formatBackupStamp } from "./backup-due.js";
import { markdownToPlain } from "./amplenote-parse.js";
import { rruleToRecurrence } from "./rrule.js";

export const REPEATS_APP = "ignite-amplenote-repeats";
export const NOT_A_REPEATS_FILE = "This isn't a repeats file from the Ignite plugin.";
export const MAX_REPEATS_BYTES = 10 * 1024 * 1024;
const BROKEN_META = "Imported without its date and flags: the metadata was damaged.";
const BAD_DATE = "Imported without its date: the date couldn't be read.";
const RELATIVE = "It repeats after completion; set it by hand.";
const NOT_IN_FILE = "It isn't in the repeats file, which may be older than the export.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// An emoji grapheme: a pictograph, a flag (a pair of regional indicators,
// which Extended_Pictographic doesn't cover), or a keycap such as 1️⃣.
const EMOJI_GRAPHEME = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
const KNOWN_META = new Set(["uuid", "startAt", "important", "notify", "completedAt", "dismissedAt", "crossedOutAt"]);
const DURATION_RE = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const plural = (n, word) => count(n, word, `${word}s`);

export function parseRepeatsFile(text) {
	const refuse = { ok: false, reason: NOT_A_REPEATS_FILE };
	if (typeof text !== "string" || text.length > MAX_REPEATS_BYTES) return refuse;
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		return refuse;
	}
	if (!isPlainObject(json) || json.app !== REPEATS_APP || json.version !== 1 || !isPlainObject(json.tasks)) {
		return refuse;
	}
	const repeats = new Map();
	for (const [key, entry] of Object.entries(json.tasks)) {
		if (!UUID_RE.test(key) || !isPlainObject(entry)) continue;
		repeats.set(key.toLowerCase(), {
			repeat: typeof entry.repeat === "string" && entry.repeat !== "" ? entry.repeat : null,
			isRepeating: entry.isRepeating === true,
		});
	}
	return { ok: true, repeats };
}

export function splitTitle(title) {
	const trimmed = String(title ?? "").trim();
	const first = segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? "";
	if (first && EMOJI_GRAPHEME.test(first)) {
		return { icon: first, name: capitalizeFirst(trimmed.slice(first.length)) || "Untitled" };
	}
	return { icon: "", name: capitalizeFirst(trimmed) || "Untitled" };
}

const byNameThenKey = (a, b) => a.name.localeCompare(b.name, "nb") || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const openTaskCount = (note) => note.items.filter((i) => i.kind === "task").length;

// "Couldn't read this note's header. Its 2 open tasks can't be imported."
// The count comes from the note's body, which Task 9 still reads.
function problemLine(note, cantOrWerent) {
	const n = openTaskCount(note);
	if (n === 0) return note.problem;
	const verb = cantOrWerent === "cant" ? "can't be" : n === 1 ? "wasn't" : "weren't";
	return `${note.problem} Its ${plural(n, "open task")} ${verb} imported.`;
}

export function noteChoices(notes) {
	return notes
		.map((note) => {
			const { icon, name } = note.problem ? { icon: "", name: note.title } : splitTitle(note.title);
			const openTasks = openTaskCount(note);
			return {
				uuid: note.uuid,
				key: note.uuid ?? `path:${note.path}`,
				icon,
				name,
				openTasks,
				disabledReason: note.problem ? problemLine(note, "cant") : openTasks === 0 ? "No open tasks." : null,
			};
		})
		.sort(byNameThenKey);
}

// undefined = present but unreadable (counted as a dropped field).
function readLeadTime(notify) {
	if (notify === undefined || notify === null || notify === false) return 0;
	if (typeof notify !== "string") return undefined;
	const m = notify.match(DURATION_RE);
	if (!m || notify === "P" || notify.endsWith("T")) return undefined;
	const [, d = "0", h = "0", min = "0"] = m;
	return Number(d) * 1440 + Number(h) * 60 + Number(min);
}

export function mapAmplenote(parsed, pickedUuids, repeats, { now = new Date(), newId = defaultId } = {}) {
	const createdAt = now.toISOString();
	const areas = [];
	const sections = [];
	const tasks = [];
	const report = {
		imported: [],
		totals: { areas: 0, sections: 0, tasks: 0 },
		subtasks: 0,
		repeatsByHand: [],
		problems: [],
		droppedFields: new Map(),
		leftBehind: [],
		otherFiles: parsed.otherFiles,
		repeatsFile: { used: repeats !== null, matched: 0, tasksWithoutEntry: 0, entriesWithoutTask: 0 },
	};
	const drop = (field) => report.droppedFields.set(field, (report.droppedFields.get(field) ?? 0) + 1);

	for (const note of parsed.notes) {
		if (note.problem) report.problems.push({ note: note.title, title: null, message: problemLine(note, "werent") });
	}

	const picked = parsed.notes
		.filter((n) => !n.problem && pickedUuids.has(n.uuid) && openTaskCount(n) > 0)
		.map((n) => ({ note: n, key: n.uuid, ...splitTitle(n.title) }))
		.sort(byNameThenKey);

	picked.forEach(({ note, icon, name }, index) => {
		const areaId = newId();
		areas.push({ id: areaId, name, icon, critical: false, order: index + 1 });
		let pendingHeading = null;
		let current = null;
		let sectionOrder = 0;
		let areaTasks = 0;

		for (const item of note.items) {
			if (item.kind === "heading") {
				pendingHeading = capitalizeFirst(item.text) || "Untitled section";
				current = null;
				continue;
			}
			if (!current) {
				current = { id: newId(), nextOrder: 0 };
				sections.push({ id: current.id, areaId, name: pendingHeading ?? "Tasks", collapsed: false, order: sectionOrder++ });
			}
			const meta = item.meta ?? new Map();
			const title = capitalizeFirst(markdownToPlain(item.text)) || "Untitled task";
			const startAt = meta.get("startAt");
			// A number outside Date's range gives an Invalid Date, whose
			// toISOString() throws. Such a task still arrives (R2), undated, and
			// the report says so.
			const dueDate = typeof startAt === "number" ? new Date(startAt * 1000) : null;
			const due = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null;
			if (startAt !== undefined && startAt !== null && due === null) {
				report.problems.push({ note: name, title, message: BAD_DATE });
			}
			let leadTime = readLeadTime(meta.get("notify"));
			if (leadTime === undefined) {
				drop("notify");
				leadTime = 0;
			}
			for (const [key, value] of meta) {
				if (!KNOWN_META.has(key) && value !== null && value !== undefined && value !== false) drop(String(key).slice(0, 40));
			}
			if (item.metaProblem) report.problems.push({ note: name, title, message: BROKEN_META });
			if (item.subtask) report.subtasks++;

			let recurrence = null;
			const rawUuid = meta.get("uuid");
			const taskUuid = typeof rawUuid === "string" && UUID_RE.test(rawUuid) ? rawUuid.toLowerCase() : null;
			if (repeats !== null && taskUuid) {
				const entry = repeats.get(taskUuid);
				if (!entry) {
					report.repeatsFile.tasksWithoutEntry++;
					report.repeatsByHand.push({ title, area: name, reason: NOT_IN_FILE });
				} else if (entry.repeat) {
					const mapped = rruleToRecurrence(entry.repeat, due);
					if (mapped.recurrence) recurrence = mapped.recurrence;
					else report.repeatsByHand.push({ title, area: name, reason: mapped.reason });
				} else if (entry.isRepeating) {
					report.repeatsByHand.push({ title, area: name, reason: RELATIVE });
				}
			}

			tasks.push({
				id: newId(),
				sectionId: current.id,
				title,
				notes: "",
				completed: false,
				starred: meta.get("important") === true,
				critical: false,
				dueAt: due ? due.toISOString() : null,
				hasTime: due !== null,
				recurrence,
				lastCompletedAt: null,
				completedCount: 0,
				leadTime,
				scheduledTags: [],
				createdAt,
				order: current.nextOrder++,
			});
			areaTasks++;
		}
		report.imported.push({ area: name, tasks: areaTasks });
		if (note.leftBehind > 0 || note.images > 0) {
			report.leftBehind.push({ note: name, lines: note.leftBehind, images: note.images });
		}
	});

	if (repeats !== null) {
		const allTaskUuids = new Set();
		for (const note of parsed.notes) {
			for (const item of note.items) {
				const u = item.kind === "task" ? item.meta?.get("uuid") : null;
				if (typeof u === "string") allTaskUuids.add(u.toLowerCase());
			}
		}
		for (const key of repeats.keys()) {
			if (allTaskUuids.has(key)) report.repeatsFile.matched++;
			else report.repeatsFile.entriesWithoutTask++;
		}
	}
	report.totals = { areas: areas.length, sections: sections.length, tasks: tasks.length };
	return { areas, sections, tasks, report };
}

export function reportSections(report) {
	const out = [];
	const imported = report.imported.map((r) => `${r.area}: ${plural(r.tasks, "task")}`);
	imported.push(`Total: ${plural(report.totals.areas, "area")}, ${plural(report.totals.sections, "section")} and ${plural(report.totals.tasks, "task")}.`);
	if (report.subtasks > 0) imported.push(`${plural(report.subtasks, "subtask")} came in as ordinary tasks.`);
	out.push({ heading: "Imported", lines: imported });

	if (report.repeatsByHand.length > 0) {
		out.push({ heading: "Repeats to set by hand", lines: report.repeatsByHand.map((r) => `${r.title} (${r.area}): ${r.reason}`) });
	}
	if (report.problems.length > 0) {
		out.push({ heading: "Problems", lines: report.problems.map((p) => (p.title ? `${p.title} (${p.note}): ${p.message}` : `${p.note}: ${p.message}`)) });
	}
	if (report.droppedFields.size > 0) {
		const fields = [...report.droppedFields].sort(([a], [b]) => a.localeCompare(b));
		out.push({ heading: "Dropped fields", lines: fields.map(([field, count]) => `${field}: ${plural(count, "task")}`) });
	}
	const left = report.leftBehind.map((l) => `${l.note}: ${plural(l.lines, "line")} of text, ${plural(l.images, "image")}`);
	if (report.otherFiles > 0) left.push(`Other files in the export: ${report.otherFiles}`);
	if (left.length > 0) out.push({ heading: "Left behind", lines: left });

	const r = report.repeatsFile;
	out.push({
		heading: "Repeats file",
		lines: r.used
			? [`Used. ${count(r.matched, "entry", "entries")} matched a task, ${plural(r.tasksWithoutEntry, "task")} had no entry, ${count(r.entriesWithoutTask, "entry", "entries")} matched no task.`]
			: ["Not included, so no repeats were imported."],
	});
	return out;
}

export function reportToText(report, now) {
	const body = reportSections(report)
		.map((s) => `${s.heading}\n${s.lines.map((l) => `- ${l}`).join("\n")}`)
		.join("\n\n");
	return `Ignite import report, ${formatBackupStamp(now.toISOString())}\n\n${body}\n`;
}

export const reportFileName = (now) => `ignite-import-report-${fileStamp(now)}.txt`;
```

- [ ] **Step 4: Run, then commit**

Run: `npx vitest run tests/backup/amplenote-map.test.js && npm run check && npm run test:run`
Expected: PASS.

```bash
git add src/backup/amplenote-map.js tests/backup/amplenote-map.test.js
git commit -m "feat(import): map Amplenote notes to areas, sections and tasks with a report"
```

---

### Task 11: The Import group, the import flow and the report dialog

**Waits for Gate G1.**

**Files:**
- Create: `src/views/import-report.js`
- Modify: `src/settings-flows.js`, `src/views/settings.js`, `src/controller.js`, `main.css`

**Interfaces:**
- Consumes: `parseAmplenoteZip`, `MAX_ZIP_BYTES`, `TOO_BIG_EXPORT`, `NOT_AMPLENOTE` (Task 9); `parseRepeatsFile`, `MAX_REPEATS_BYTES`, `NOT_A_REPEATS_FILE`, `noteChoices`, `mapAmplenote`, `reportSections`, `reportToText`, `reportFileName` (Task 10); `replace`, `openConfirm`, `closeConfirm`, `alertIn` (Task 6, now in the same closure); `FOCUS_ID`, `FOCUS_DEFAULT_SECTION_ID`, `FOCUS_DEFAULTS`, `FOCUS_DEFAULT_SECTION` (Task 4).
- Produces:
  - `createImportReportDialog(rootEl) → { open({ sections, onDownload, onClose }), close(), destroy() }`.
  - Flows gain `readZip(file)`, `readRepeats(file)`, `importNotes(uuids: string[])`, `resetImport()`; `createSettingsFlows` gains the deps `reportDialog` and `focusPageHeading` (Task 5's controller helper).
  - View gains callbacks `onZipFile(file)`, `onRepeatsFile(file)`, `onImport(uuids)` and methods `setStatus(text)`, `setNoteChoices(choices|null)`, `setFileName(kind: "zip"|"repeats", name)`.

- [ ] **Step 1: The report dialog**

`src/views/import-report.js`:

```js
// createImportReportDialog(rootEl) → { open, close, destroy }
//
// Shows the import report right after an import, with Download report. Same
// dialog pattern as confirm-dialog.js; the controller owns inert and focus
// return. Every line is file-derived text, so every line is escaped.

import { escapeHtml } from "../utils/dom.js";

export function createImportReportDialog(rootEl) {
	let clickHandler = null;
	let keyHandler = null;

	function close() {
		if (clickHandler) rootEl.removeEventListener("click", clickHandler);
		if (keyHandler) document.removeEventListener("keydown", keyHandler);
		clickHandler = null;
		keyHandler = null;
		rootEl.innerHTML = "";
	}

	function open({ sections, onDownload, onClose }) {
		close();
		const body = sections
			.map(
				(s) => `
				<section class="report-section">
					<h3 class="report-section__heading">${escapeHtml(s.heading)}</h3>
					<ul class="report-section__list">${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>
				</section>`,
			)
			.join("");
		rootEl.innerHTML = `
			<div class="repeat-backdrop" data-action="report-backdrop">
				<div class="repeat-panel report-panel" role="dialog" aria-modal="true" aria-labelledby="report-heading">
					<h2 class="repeat-panel__heading" id="report-heading" tabindex="-1">Import report</h2>
					${body}
					<footer class="repeat-footer">
						<button type="button" class="repeat-btn" data-action="report-download">Download report</button>
						<button type="button" class="repeat-btn repeat-btn--primary" data-action="report-close">Close</button>
					</footer>
				</div>
			</div>
		`;
		clickHandler = (event) => {
			const actionEl = event.target.closest("[data-action]");
			const action = actionEl?.dataset.action;
			if (action === "report-download") onDownload();
			else if (action === "report-close") onClose();
			else if (action === "report-backdrop" && event.target === actionEl) onClose();
		};
		keyHandler = (event) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onClose();
		};
		rootEl.addEventListener("click", clickHandler);
		document.addEventListener("keydown", keyHandler);
		// Start at the heading, so a screen reader reads the report from the top.
		rootEl.querySelector("#report-heading").focus();
	}

	return { open, close, destroy: close };
}
```

- [ ] **Step 2: The import flows**

In `src/settings-flows.js` add the imports:

```js
import {
	mapAmplenote,
	MAX_REPEATS_BYTES,
	NOT_A_REPEATS_FILE,
	noteChoices,
	parseRepeatsFile,
	reportFileName,
	reportSections,
	reportToText,
} from "./backup/amplenote-map.js";
import { MAX_ZIP_BYTES, NOT_AMPLENOTE, parseAmplenoteZip, TOO_BIG_EXPORT } from "./backup/amplenote-parse.js";
import { FOCUS_DEFAULT_SECTION, FOCUS_DEFAULT_SECTION_ID, FOCUS_DEFAULTS, FOCUS_ID } from "./model/areas.js";
```

add `reportDialog` and `focusPageHeading` to the destructured deps, and add before the `return`:

```js
	// Held in memory only while Settings is mounted: mountMainView calls
	// resetImport on every mount, so it's dropped as soon as I leave. The ZIP's
	// text never reaches IndexedDB; only the mapped tasks do.
	let importState = { parsed: null, repeats: null };
	// Each pick bumps its counter. A read that finishes after a newer pick of
	// the same kind (or after I left the page) is dropped, so the checklist
	// can never show an older file than the name beside the button.
	let zipRun = 0;
	let repeatsRun = 0;
	const resetImport = () => {
		importState = { parsed: null, repeats: null };
		zipRun++;
		repeatsRun++;
	};
	const countOf = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
	// Lets the "Reading the export…" line paint before the synchronous parse.
	const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

	async function readZip(file) {
		const view = getView();
		const run = ++zipRun;
		view.setAlert("import", "");
		view.setNoteChoices(null);
		importState.parsed = null;
		if (file.size > MAX_ZIP_BYTES) {
			view.setStatus("");
			view.setAlert("import", TOO_BIG_EXPORT);
			view.setFileName("zip", "");
			return;
		}
		view.setStatus("Reading the export…");
		await nextPaint();
		let result;
		try {
			result = parseAmplenoteZip(new Uint8Array(await file.arrayBuffer()));
		} catch {
			result = { ok: false, reason: NOT_AMPLENOTE };
		}
		// I may have left Settings, or picked another export, while this one
		// was read. Drop the result.
		if (getView() !== view || run !== zipRun) return;
		if (!result.ok) {
			view.setStatus("");
			view.setAlert("import", result.reason);
			view.setFileName("zip", "");
			return;
		}
		importState.parsed = result;
		view.setNoteChoices(noteChoices(result.notes));
		// The spoken result of the pick. The checklist appearing is silent.
		view.setStatus(`Read ${countOf(result.notes.length, "note")} from the export.`);
	}

	async function readRepeats(file) {
		const view = getView();
		const run = ++repeatsRun;
		view.setAlert("import", "");
		importState.repeats = null;
		let result = { ok: false, reason: NOT_A_REPEATS_FILE };
		if (file.size <= MAX_REPEATS_BYTES) {
			try {
				result = parseRepeatsFile(await file.text());
			} catch {
				// keep the refusal
			}
		}
		if (getView() !== view || run !== repeatsRun) return;
		if (!result.ok) {
			// Refused files are dropped, so I can go on without one.
			view.setAlert("import", result.reason);
			view.setFileName("repeats", "");
			return;
		}
		importState.repeats = result.repeats;
		view.setStatus(`Read repeat rules for ${countOf(result.repeats.size, "task")}.`);
	}

	async function importNotes(uuids) {
		const view = getView();
		if (!view || !importState.parsed) return;
		view.setAlert("import", "");
		let mapped;
		let current;
		let next;
		try {
			mapped = mapAmplenote(importState.parsed, new Set(uuids), importState.repeats, { now: new Date() });
			if (mapped.tasks.length === 0) return;
			current = await data.snapshot();
			// Focus keeps its area and notepad section, with the same ids. Its
			// tasks are not carried over: the notepad is emptied (D4).
			const focusArea = current.areas.find((a) => a.id === FOCUS_ID) ?? FOCUS_DEFAULTS;
			const focusSection = current.sections.find((s) => s.id === FOCUS_DEFAULT_SECTION_ID) ?? FOCUS_DEFAULT_SECTION;
			next = {
				areas: [focusArea, ...mapped.areas],
				sections: [focusSection, ...mapped.sections],
				tasks: mapped.tasks,
			};
			// The last check before anything is written: the imported records
			// pass the same reader a restore uses, so the database never holds
			// a record a later backup of it would refuse (R2). Focus is checked
			// in its default shape, because an old Focus record may carry
			// fields the writer would project away.
			const gate = validateBackup(
				JSON.stringify({
					app: "ignite",
					schemaVersion: 1,
					appVersion,
					exportedAt: new Date().toISOString(),
					areas: [FOCUS_DEFAULTS, ...mapped.areas],
					sections: [FOCUS_DEFAULT_SECTION, ...mapped.sections],
					tasks: mapped.tasks,
				}),
			);
			if (!gate.ok) throw new Error(gate.reason);
		} catch {
			if (getView() === view) view.setAlert("import", "Couldn't turn these notes into tasks, so nothing was imported.");
			return;
		}
		if (getView() !== view) return;
		const safetyName = backupFileName(new Date());
		openConfirm({
			title: "Import from Amplenote?",
			lines: [
				`Replace ${describeCounts(current)} with ${describeCounts(next)}. Focus stays, its notepad is emptied.`,
				`Your current data downloads first as ${safetyName}.`,
			],
			confirmLabel: "Replace",
			onReturnFocus: () => getView()?.focusControl("import"),
			onConfirm: async () => {
				let outcome = { ok: false, message: null };
				try {
					outcome = await replace(next, safetyName);
				} finally {
					// Closed whatever happens (see restoreFromFile). Focus goes
					// back to Import on failure; on success the report takes it.
					closeConfirm({ restoreFocus: !outcome.ok });
				}
				if (!outcome.ok) {
					if (outcome.message) alertIn("import", outcome.message);
					return;
				}
				openReport(mapped.report);
			},
		});
	}

	let reportOpen = false;

	function openReport(report) {
		const now = new Date();
		reportOpen = true;
		setModal(true);
		reportDialog.open({
			sections: reportSections(report),
			onDownload: () => {
				try {
					downloadFile(reportToText(report, now), reportFileName(now), "text/plain");
				} catch {
					// The report stays readable in the dialog either way.
				}
			},
			onClose: () => {
				reportOpen = false;
				reportDialog.close();
				setModal(false);
				// If I left Settings while the replace ran (browser Back), the
				// report still opened, and Import no longer exists. Land on the
				// page heading instead of <body>.
				const view = getView();
				if (view) view.focusControl("import");
				else focusPageHeading();
			},
		});
	}
```

Replace the `return` with:

```js
	return {
		backUpNow,
		restoreFromFile,
		undoLastReplace,
		canUndo: () => lastReplace !== null,
		readZip,
		readRepeats,
		importNotes,
		resetImport,
		closeDialogs: () => {
			closeConfirm({ restoreFocus: false });
			if (reportOpen) {
				reportOpen = false;
				reportDialog.close();
				setModal(false);
			}
		},
	};
```

`_internal` is gone. Check that nothing outside this file used it: `grep -rn "_internal" src` must print nothing.

- [ ] **Step 3: Controller wiring**

In `start()`, right after `confirmDialog = createConfirmDialog(settingsDialogRoot);` and so before `createSettingsFlows`: `reportDialog = createImportReportDialog(settingsDialogRoot);` (add the `let reportDialog = null;` handle and the import). Pass `reportDialog` and `focusPageHeading` to `createSettingsFlows`. In `stop()`: `reportDialog?.destroy(); reportDialog = null;`.

At the top of `mountMainView(route)`, right after `currentMainView = null;`, drop any parsed export on every mount, so ZIP-derived text never outlives the Settings page:

```js
		flows?.resetImport();
```

The settings branch becomes:

```js
		if (route.name === "settings") {
			currentMainView = createSettingsView(mainRoot, {
				onBackUp: () => flows.backUpNow(),
				onRestoreFile: (file) => flows.restoreFromFile(file),
				onUndoReplace: () => flows.undoLastReplace(),
				onZipFile: (file) => flows.readZip(file),
				onRepeatsFile: (file) => flows.readRepeats(file),
				onImport: (uuids) => flows.importNotes(uuids),
			});
			currentMainView.setUndoAvailable(flows.canUndo());
			return;
		}
```

- [ ] **Step 4: The Import group in the view**

In `src/views/settings.js`:
- Import `escapeHtml` from `../utils/dom.js`.
- Signature: add `onZipFile, onRepeatsFile, onImport`.
- After the Backup `</section>`, inside `.settings`:

```html
			<section class="card stack settings-card" aria-labelledby="import-heading">
				<h2 class="settings-card__heading" id="import-heading">Import from Amplenote</h2>
				<ol class="import-steps">
					<li class="stack stack-sm import-step">
						<h3 class="import-step__title">Choose files</h3>
						<div class="cluster settings-file-row">
							<label class="repeat-btn settings-file">
								<input class="sr-only" id="zip-file" type="file" accept=".zip,application/zip" />
								Amplenote export (ZIP)
							</label>
							<span class="settings-file__name" data-role="zip-name"></span>
						</div>
						<div class="cluster settings-file-row">
							<label class="repeat-btn settings-file">
								<input class="sr-only" id="repeats-file" type="file" accept=".json,application/json" />
								Repeats file (optional)
							</label>
							<span class="settings-file__name" data-role="repeats-name"></span>
						</div>
						<p class="settings-card__note">Without the repeats file, tasks import without their repeats. <a href="https://github.com/malinfossum/ignite/blob/main/tools/amplenote-plugin/README.md" target="_blank" rel="noopener noreferrer">How to make one<span class="sr-only"> (opens in a new tab)</span></a></p>
					</li>
					<li class="stack stack-sm import-step">
						<h3 class="import-step__title">Pick notes</h3>
						<div data-role="note-list"><p class="settings-card__note">Choose an export first.</p></div>
					</li>
					<li class="stack stack-sm import-step">
						<h3 class="import-step__title">Import</h3>
						<div class="cluster settings-actions">
							<button type="button" class="repeat-btn repeat-btn--primary" data-action="import" disabled>Import</button>
						</div>
					</li>
				</ol>
				<p class="settings-status" role="status" data-role="import-status"></p>
				<p class="settings-alert" role="alert" data-role="import-alert"></p>
			</section>
```

- In `onClick`: `else if (action === "import") onImport(checkedUuids());`
- Extend `onChange` (keep the restore branch):

```js
		if (input.id === "zip-file" || input.id === "repeats-file") {
			const file = input.files?.[0];
			input.value = "";
			if (!file) return;
			const kind = input.id === "zip-file" ? "zip" : "repeats";
			$(`[data-role="${kind}-name"]`).textContent = file.name;
			(kind === "zip" ? onZipFile : onRepeatsFile)(file);
			return;
		}
		if (input.name === "import-note") syncImportEnabled();
```

- Helpers inside the factory:

```js
	const checkedUuids = () =>
		[...rootEl.querySelectorAll('input[name="import-note"]:checked')].map((el) => el.value);

	// Import stays disabled while no checked note has an open task. Disabled
	// rows (no tasks, unreadable header) are never checked.
	function syncImportEnabled() {
		$('[data-action="import"]').disabled = checkedUuids().length === 0;
	}

	function renderNoteList(choices) {
		const list = $('[data-role="note-list"]');
		if (!choices) {
			list.innerHTML = `<p class="settings-card__note">Choose an export first.</p>`;
			syncImportEnabled();
			return;
		}
		const rows = choices
			.map((c, i) => {
				const reasonId = `import-note-reason-${i}`;
				const disabled = c.disabledReason !== null;
				const detail = disabled
					? `<span class="import-note__detail" id="${reasonId}">${escapeHtml(c.disabledReason)}</span>`
					: `<span class="import-note__detail">${c.openTasks} open ${c.openTasks === 1 ? "task" : "tasks"}</span>`;
				return `
					<label class="import-note${disabled ? " import-note--disabled" : ""}">
						<input type="checkbox" name="import-note" value="${escapeHtml(c.uuid ?? "")}"
							${disabled ? `disabled aria-describedby="${reasonId}"` : "checked"} />
						<span class="import-note__icon" aria-hidden="true">${escapeHtml(c.icon)}</span>
						<span class="import-note__name">${escapeHtml(c.name)}</span>
						${detail}
					</label>`;
			})
			.join("");
		list.innerHTML = `<fieldset class="import-notes"><legend class="import-notes__legend">Notes to import</legend>${rows}</fieldset>`;
		syncImportEnabled();
	}
```

- Methods:

```js
		setStatus(text) {
			$('[data-role="import-status"]').textContent = text;
		},
		setNoteChoices(choices) {
			renderNoteList(choices);
		},
		setFileName(kind, name) {
			$(`[data-role="${kind}-name"]`).textContent = name;
		},
```

- [ ] **Step 5: Styles**

`main.css`, Settings block:

```css
.import-steps {
	display: flex;
	flex-direction: column;
	gap: var(--space-5);
	padding-inline-start: 1.25rem;
	list-style: decimal;
}
.import-steps ::marker {
	color: var(--text-muted);
}
.import-step__title {
	font-size: var(--text-base);
	font-weight: 600;
}
.settings-file__name {
	font-size: var(--text-sm);
	color: var(--text-muted);
	overflow-wrap: anywhere;
	min-width: 0;
}
.settings-status {
	font-size: var(--text-sm);
}
.settings-status:empty {
	margin-block-start: calc(-1 * var(--space-4));
}
.import-notes {
	display: flex;
	flex-direction: column;
	min-width: 0;
	margin: 0;
	padding: 0;
	border: 0;
}
.import-notes__legend {
	margin-block-end: var(--space-2);
	font-size: var(--text-sm);
	color: var(--text-muted);
}
/* The <label> wraps the checkbox, so the whole 44px row is the target. Long
   names wrap instead of clipping. */
.import-note {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--space-2);
	min-block-size: 44px;
	padding-block: var(--space-1);
	cursor: pointer;
}
.import-note input {
	flex: none;
	inline-size: 1.25rem;
	block-size: 1.25rem;
	accent-color: var(--color-accent);
}
.import-note__name {
	flex: 1 1 8rem;
	min-width: 0;
	overflow-wrap: anywhere;
	color: var(--text);
}
/* The count is the value beside the name: set apart by size and ink. */
.import-note__detail {
	font-size: var(--text-sm);
	color: var(--text-muted);
	font-variant-numeric: tabular-nums;
}
.import-note--disabled {
	cursor: default;
}
.import-note--disabled .import-note__name {
	color: var(--text-muted);
}
.report-section {
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
}
.report-section__heading {
	font-size: var(--text-base);
	font-weight: 600;
}
.report-section__list {
	padding-inline-start: 1.25rem;
	list-style: disc;
}
.report-section__list li {
	color: var(--text);
	overflow-wrap: anywhere;
}
```

`.import-steps` sits inside `.card.stack`; if the `--space-4` stack gap plus `--space-5` here reads too loose in the browser, use `--space-4` and say so in the report.

- [ ] **Step 6: Verify in the browser**

Build an invented Amplenote ZIP and repeats file (a scratch script outside the repo using `zipSync`, three notes: one with an emoji title and headings, one with no open tasks, one with a broken header; at least one subtask, one broken comment, one repeating task of each supported kind, one relative repeat, one image line). On the throwaway origin, one batched round:
- Picking the ZIP shows "Reading the export…" and then the checklist, and the status line ends on "Read 3 notes from the export." (the spoken result of the pick): the empty note and the broken note are disabled, each with its reason tied through `aria-describedby`, and the broken note's reason names how many open tasks it holds; every enabled note is checked; unchecking all disables **Import**.
- Pick the 20 MB padded ZIP, then at once the small one: the checklist and the file name both end on the small one.
- Import without the repeats file: confirm names both sides and "Focus stays, its notepad is emptied"; Replace downloads one safety file; the report opens with focus on its heading; "Repeats file: Not included…"; **Download report** saves a `.txt`; Close returns focus to **Import**.
- Areas, sections, stars, dates and lead times in the app match the invented data. The Focus area keeps its id and its notepad is empty.
- Again with the repeats file: repeats land, the relative one and the unsupported one are listed to set by hand.
- A wrong repeats file (`"app": "x"`) shows the refusal and clears its name.
- Leave `#settings` right after picking a large invented ZIP (pad a note to 20 MB): no console error, no alert lands on another page.
- `read_network_requests`: nothing carries the ZIP, the repeats file or the report.

- [ ] **Step 7: Commit**

```bash
npm run check && npm run test:run && npm run build
git add src/views/import-report.js src/settings-flows.js src/views/settings.js src/controller.js main.css
git commit -m "feat(import): import picked Amplenote notes with a report"
```

---

### Task 12: Every screen size, keyboard, and the bundle

**Files:**
- Modify: `main.css` only if a measurement fails.

- [ ] **Step 1: Measure the layout (R3)**

On the throwaway origin with the invented import done, at 320, 768, 1024, 1280, 1600 and 1920 px, collapsed rail included at 1024 and above, one batched round per width:
- `document.documentElement.scrollWidth <= innerWidth` (no horizontal scroll).
- `.settings` column count (`getComputedStyle(el).gridTemplateColumns.split(" ").length`): 1 at 320 and 768, 2 at 1024 and 1280, more at 1600 and 1920 (the route lifts `#main`'s 42rem reading cap, Task 5 Step 9; if this reads 1 everywhere from 1024 up, that rule is missing).
- Every control row (`.settings-actions`, `.settings-file-row`, `.backup-banner__actions`, `.repeat-footer`): all children 44 px tall and sharing one `getBoundingClientRect().bottom`.
- The longest invented note name wraps inside its row, nothing is clipped (`scrollWidth <= clientWidth` on `.import-note__name`).
- The confirm and report dialogs fit at 320 px (bottom sheet) and centre from 768 px, and the report scrolls inside the panel.
- 200 % text at 320 px (`document.documentElement.style.fontSize = "200%"`): same checks, no clipped label.

Fix, then confirm in at most one more round. If anything is still off after that, stop and list it in the PR.

- [ ] **Step 2: Keyboard walk**

Keyboard only (real Tab presses where the tool allows, synthetic otherwise, and say which): sidebar Settings → focus on the `<h1>` → Back up now → Restore input → dialog (focus on Cancel, Tab stays inside, Esc returns to Restore) → ZIP input → repeats input → each checkbox → Import → confirm → report (focus on its heading, Esc returns to Import) → Undo last replace (focus moves to the Restore input as the button hides). Then on `#focus`, the banner's Not now and Back up now each leave focus on the `<h1>`. `document.activeElement` is never `<body>` at any step.

- [ ] **Step 3: Bundle size**

Run `npm run build` and record the JS and gzip sizes beside Task 1's baseline. Both numbers go in the PR body.

- [ ] **Step 4: Commit any fixes**

```bash
npm run check && npm run test:run && npm run build
git add main.css
git commit -m "fix(settings): layout fixes from the screen-size pass"
```

Skip the commit if nothing changed.

---

### Task 13: Docs and the PR

**Files:**
- Modify: `README.md` (Features, Tech: the new dependency and the test count), `docs/superpowers/specs/2026-11-09-ignite-import-export-design.md` (status line + a short "Plan departures" pointer to this plan)

- [ ] **Step 1: README**

Under Features add one line each for backup/restore and the Amplenote import. Under Tech, name `fflate` as the one runtime dependency. Replace the test count with the number `npm run test:run` prints.

- [ ] **Step 2: Spec status**

Change the spec's status line from "no plan yet" to "plan: `docs/superpowers/plans/2026-11-09-ignite-import-export.md`", and add one line under §14 pointing to this plan's "Where this plan departs from the spec".

- [ ] **Step 3: Final checks and push**

```bash
npm run check && npm run test:run && npm run build
git add README.md docs/superpowers/specs/2026-11-09-ignite-import-export-design.md
git commit -m "docs: backup, restore and the Amplenote import"
git push -u origin feat/import-export
```

- [ ] **Step 4: Open the PR**

Title: `Backup, restore and the Amplenote import`. Body (fill the numbers from the tool outputs, nothing estimated):

```markdown
## What this adds

- A Settings page with Back up now, Restore from file and Undo last replace.
- An Amplenote import: pick notes from the export ZIP, optionally add the repeats file from the plugin in `tools/amplenote-plugin/`, and get a report of what to finish by hand.
- A banner when my last backup is more than a week old.

Everything runs in the browser. No request carries a backup, an export or a report.

## How it's safe

- Every check runs before anything is written.
- Every replace is one IndexedDB transaction, with a safety backup downloaded first and an in-memory undo until the next app start.
- Other open tabs reload after a replace.

## Numbers

- Tests: <N> in <M> files, all green.
- Bundle: <before> kB (gzip <before>) → <after> kB (gzip <after>).

## Checked in the browser

<the Task 5, 6, 7, 11 and 12 checks, each with its result>

## Still owed (only I can do these)

- The dress-rehearsal import on my real ZIP on the live site, and a read through the report.
- A Back up now and a Restore (cancelled at the dialog) on my real data, to see that a backup of it validates.
- The safety download in Brave with "Ask where to save" on and off, if not done above.
- A real-device pass on the Settings page.
```

No `Co-Authored-By`, no AI attribution. Then bind the PR with the ccd_pr tools and read its CI.

---

## Owed to Malin (spec §12, extended)

1. **Gate G1** (after Task 1): install and run the plugin, run `check-join.mjs`, paste the counts.
2. **After the build:** the dress-rehearsal import on the live site with her real ZIP, and a read through the report.
3. **After the build:** a Back up now and a Restore of her real data (cancelled at the confirm dialog) on her own device. This proves that a backup of a real, old database validates (Review Focus 1), without any agent opening it.
4. The Brave "ask where to save" check if the agent couldn't toggle it.

## Considered and rejected (plan stress test)

- **Holding link URLs out of the emphasis rules in `markdownToPlain`.** A URL holding `__` or `**` (a Python dunder path) loses those characters in the title. It's rare in task text, the URL stays readable, and protecting it would add a second placeholder scheme.
- **Guarding an edit made in another tab between the snapshot and `replaceAll`.** The window is one synchronous download, that tab reloads right after, and the edit is in neither file only if it lands inside that window. A cross-tab lock costs more than the risk.
- **Skipping macOS `__MACOSX/._*.md` entries.** They only appear if a ZIP is re-packed on a Mac, which my switch-day flow doesn't do. If they ever show, they list as unreadable notes, which is visible, not silent.
- **Seconds in backup file names.** Two files made in the same minute share a name and the browser adds " (1)". The spec fixed the name format, and the undo failure copy still points at the right day and minute.
- **Detecting a blocked download.** `a.click()` can't tell whether the browser saved the file. The in-memory undo (D5) and the Brave check in Task 6 cover it.
- **Moving focus after a toast's Undo.** The toast's own Undo button disappears under focus, as it does for every toast in the app. That's a known backlog item across all undo paths, not this feature's to fix.
- **Waiting without a frame in `nextPaint`.** A ZIP picked in a background tab parses when the tab shows again. Picking a file brings the tab to the front anyway.

- **`auto-fit` for the Settings grid** (decided 09.11.2026). `auto-fill` stays: at 1600 px and up the two cards keep a readable width, and later Settings groups fill the empty tracks.
- **Importing notes with an unreadable header under their file name** (decided 09.11.2026). They stay greyed out as spec §7.3 says. The checklist and report show how many open tasks each one holds, so I fix it in Amplenote and re-export.

> Stress-tested 2026-11-09 (skill a217382): 22 applied, 4 adapted, 2 decided by me.
