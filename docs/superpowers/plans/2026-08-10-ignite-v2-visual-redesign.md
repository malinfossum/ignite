# Ignite v2 Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the workbench design system with the `ignite` brand palette, add a light theme with a sidebar toggle, re-lay-out the Today view and sidebar, and add an emoji picker for the area icon field that already exists.

**Architecture:** The design system is extracted into a read-only `design-system/` folder and imported by `main.css` in the system's own layer order. Rather than rewriting 25 KB of existing CSS, Ignite's eight legacy `:root` custom properties are **aliased** to system tokens — so every menu, dialog, toast and drawer retokenizes at once, in both themes, from about ten lines. Theme state lives on the existing IndexedDB settings model with a `localStorage` mirror used only by an inline `<head>` snippet to avoid a flash before first paint.

**Tech Stack:** Vanilla JS (strict MVC, subscribe/notify), Vite 8, Vitest 4 + fake-indexeddb, Biome 2.4.12, hand-rolled service worker.

**Source spec:** `docs/superpowers/specs/2026-08-10-ignite-v2-design.md`

## Global Constraints

- **`design-system/` is read-only.** Never edit the extracted copy. Fixes are either a local override in `main.css` or an issue filed against workbench.
- **Mobile-first only.** Baseline styles target the smallest screen; layer up with `min-width`. No `max-width` queries, including any inherited from the system.
- **Focus targets are load-bearing class names** — `.section__menu-btn`, `.area__add-section`, `.sidebar__home`, `.topbar__menu`. Restyle them; never rename them.
- **`--capture-h` stays the single source** for both `#main` bottom padding and the toast lift.
- **Toast `aria-live` stays on `.toast__message`**, never on `.toast`.
- **`tabindex="-1"` stays on every `role="menuitem"`** across all four view files.
- **`inert` target lists are exactly** 3 for the drawer (`topbarRoot`, `mainEl`, `toastRoot` — never the scrim) and 4 for the recurrence dialog (those plus `sidebarRoot`).
- **`commit-*-rename` is read only by each view's `bindKeys` Enter handler.** Never wire it as a `bindActions` click.
- **Closed drawer stays `visibility: hidden`**, not merely transformed off-screen.
- **Commits:** no `Co-Authored-By` trailer, no Claude attribution. Malin is sole author.
- **Green baseline to preserve:** 174 tests passing, `npm run check` clean, `npm run build` clean.
- Indent with tabs. Double quotes in JS. Biome decides formatting — run `npm run format` before committing.

## Theme vocabulary — read before Tasks 5–9

Two vocabularies, deliberately separate. Confusing them is the easiest way to get this wrong.

- **Choice** — `"system" | "dark" | "light"`. What the user picks, what the model stores, what
  goes in localStorage. Default `"system"`.
- **Resolved** — `"dark" | "light"`. What reaches `data-theme` and `theme-color`. `"system"`
  resolves against `prefers-color-scheme`; the other two resolve to themselves.

The control **cycles three states**, system → light → dark → system. A two-state toggle would
be a one-way door: starting at `"system"`, a binary control can only write `"dark"` or
`"light"`, so the first tap permanently ends OS-following with no route back short of clearing
both localStorage and IndexedDB. This was the stress test's finding 6, resolved by making the
control reversible rather than by dropping OS-following.

---

## Phase 1 — The system lands (Tasks 1–4)

At the end of Phase 1 the app is fully restyled in the `ignite` palette, dark only, with offline fonts working. This is a shippable stopping point.

---

### Task 1: Extract the design system

**Files:**
- Create: `design-system/` (via the workbench extractor)
- Modify: `biome.json:10`
- Modify: `.gitignore` (verify only — must NOT ignore `design-system/`)

**Interfaces:**
- Consumes: nothing
- Produces: `design-system/tokens/index.css`, `design-system/base/reset.css`, `design-system/base/base.css`, `design-system/primitives/{container,stack,cluster}.css`, `design-system/components/index.css`, `design-system/utilities/index.css`, `design-system/assets/fonts/*.woff2`

- [ ] **Step 1: Run the extractor**

```bash
node C:/Users/Nugget/Documents/Development/workbench/tools/extract.mjs design-system C:/Users/Nugget/Documents/Development/GitHub/repos/ignite
```

- [ ] **Step 2: Verify the extraction landed**

Run:

```bash
ls design-system && head -1 design-system/tokens/index.css
```

Expected: directories `assets base components compositions primitives theme tokens utilities`, and a first line reading `/* workbench-lib: design-system v2.0.0 — extracted; edit in the workbench, not here */`. `gallery/`, `sandbox/` and `docs/` must be absent — `extract.json` excludes them.

Note there is **no top-level `design-system/VERSION` file**: `extract.json`'s `versionFile` names the version file in the *source* library, and the extractor stamps the version as a header comment on each index file rather than copying it across.

- [ ] **Step 3: Confirm the ignite palette and its fonts arrived**

Run:

```bash
ls design-system/tokens/palettes/ignite.css design-system/assets/fonts/bricolage-grotesque-latin-600-normal.woff2 design-system/assets/fonts/hanken-grotesk-latin-400-normal.woff2
```

Expected: all three paths exist.

- [ ] **Step 4: Exclude `design-system/` from Biome**

In `biome.json`, change line 10 from:

```json
		"includes": ["**", "!dist", "!node_modules", "!**/*.min.js"]
```

to:

```json
		"includes": [
			"**",
			"!dist",
			"!node_modules",
			"!**/*.min.js",
			"!design-system"
		]
```

- [ ] **Step 5: Verify Biome ignores it and the suite is still green**

Run: `npm run check && npm run test:run`
Expected: Biome reports no errors and does not list any file under `design-system/`; Vitest reports 174 passed.

- [ ] **Step 6: Commit**

```bash
git add design-system biome.json
git commit -m "chore: extract the workbench design system into ignite"
```

---

### Task 2: Wire the system in and alias the legacy tokens

This is the task that changes how the app looks. It replaces Ignite's `base.css`, imports the system, sets the `ignite` palette, and aliases the eight legacy custom properties so the existing 25 KB of CSS retokenizes without being rewritten.

**Files:**
- Delete: `base.css`
- Modify: `index.html:2`, `index.html:12`
- Modify: `main.css:1-20`

**Interfaces:**
- Consumes: `design-system/` from Task 1
- Produces: `--surface-1..5`, `--text`, `--text-muted`, `--text-faint`, `--border`, `--accent`, `--danger`, `--space-1..9`, `--radius-xs..pill`, `--text-xs..4xl`, `--duration-fast|base|slow`, `--ease-standard` available to all later tasks

- [ ] **Step 1: Delete the superseded base stylesheet**

```bash
git rm base.css
```

- [ ] **Step 2: Set the palette attribute on `<html>`**

In `index.html`, change line 2 from:

```html
<html lang="en">
```

to:

```html
<html lang="en" data-palette="ignite">
```

- [ ] **Step 3: Remove the deleted stylesheet's link**

In `index.html`, delete line 12 entirely:

```html
		<link rel="stylesheet" href="/base.css" />
```

Line 13 (`<link rel="stylesheet" href="/main.css" />`) stays. Vite bundles, hashes and base-prefixes the whole `@import` chain behind it into a single `/ignite/assets/index-*.css`.

- [ ] **Step 4: Replace the head of `main.css`**

Replace `main.css` lines 1–20 (the comment block and the entire `:root` block) with:

```css
/* main.css — Ignite app styles.
   Layer order per the design system's spec: tokens → base → primitives →
   components → project UI. `design-system/` is READ-ONLY; anything that needs
   changing is overridden below or filed against workbench. */

@import url("./design-system/tokens/index.css");
@import url("./design-system/base/reset.css");
@import url("./design-system/base/base.css");
@import url("./design-system/primitives/container.css");
@import url("./design-system/primitives/stack.css");
@import url("./design-system/primitives/cluster.css");
@import url("./design-system/components/index.css");
@import url("./design-system/utilities/index.css");

/* NOT imported, deliberately:
   - compositions/ — .app-shell and .main-shell are page patterns with 3–5rem
     block padding, wrong for a task app.
   - primitives/index.css — it pulls in primitives/sidebar.css, whose
     .sidebar-layout breaks at max-width: 62rem: both a max-width query (against
     this project's mobile-first rule) and the wrong breakpoint (Ignite's drawer
     flips at 768px). The three primitives Ignite uses are imported individually;
     grid, split and center have no consumer here. */

/* Legacy token aliases. Ignite's own CSS was written against these eight names;
   pointing them at system tokens retokenizes every existing surface — menus,
   dialogs, toast, drawer — in both themes, without rewriting it. */
:root {
	--color-bg: var(--surface-1);
	--color-bg-elevated: var(--surface-2);
	--color-bg-hover: var(--surface-3);
	--color-text: var(--text);
	--color-text-muted: var(--text-muted);
	--color-border: var(--border);
	--color-accent: var(--accent);
	--color-overdue: var(--danger);

	--sidebar-width: 240px;
	--sidebar-rail-width: 48px;
	--main-max-width: var(--reading-width);
	--main-padding: var(--space-5);
	--radius: var(--radius-sm);
}

/* --- Required overrides: the system is built for documents, Ignite is an app --- */

/* base/base.css sets `p, li { color: var(--text-muted) }`. Ignite renders
   <li class="task"> and <li class="sidebar__area-row">, so without this reset
   EVERY task title and area name in the app turns grey. */
.task,
.sidebar__area-row,
.sidebar__add-area-row {
	color: var(--text);
}

/* base/base.css sets h1 to --text-4xl (up to 60px) and h3 to --text-xl. Those
   are document scales; these are app-chrome scales. */
#main h1 {
	font-size: var(--text-2xl);
}
.next-card__label {
	font-size: var(--text-sm);
}
.group__heading {
	font-size: var(--text-md);
}
```

Everything from the old line 22 (`/* Visually hidden … */`) onward stays exactly as it is.

- [ ] **Step 5: Verify the build and the suite**

Run: `npm run check && npm run test:run && npm run build`
Expected: Biome clean, 174 passed, build succeeds with no unresolved `@import`.

- [ ] **Step 6: Verify in the browser**

Start the `ignite-dev` preview config and load the app. Confirm all of:

- Background is the warm near-black `#0b0a0a`, not the old `#0f0f10`.
- Body text renders in Hanken Grotesk, not system-ui.
- **Task titles and area names are full-contrast white, not grey.** This is the §6.1 regression; if they are grey, Step 4's reset did not apply.
- Area page `<h1>` is a normal heading size, not ~60px.
- 0 console errors.

- [ ] **Step 7: Commit**

```bash
npm run format
git add index.html main.css base.css
git commit -m "feat: adopt the design system and the ignite palette"
```

---

### Task 3: Warm the borders and muted text

`tokens/palettes/ignite.css` overrides surfaces, accent and type but not borders or muted text, which still come from base `colors.css` and are cool blue-grey (`--border: #232c35`, `--text-muted: #b4bdc7`). Against the palette's warm ground they read faintly blue.

**Files:**
- Modify: `main.css` (append to the override block from Task 2)

**Interfaces:**
- Consumes: `--surface-*` and `--text-*` from Task 2
- Produces: nothing new — overrides existing token values

- [ ] **Step 1: Add the warm overrides**

Append to `main.css`, directly after the `#main h1` / `.next-card__label` / `.group__heading` rules from Task 2:

```css
/* The ignite palette warms the surfaces but inherits cool blue-grey borders and
   muted text from base colors.css. These are sampled off the palette's own ramp
   so hairlines read neutral against the warm ground rather than faintly blue.
   Upstream fix: ignite.css should carry these itself — see the workbench issue. */
[data-palette="ignite"] {
	--border: #262320;
	--border-strong: #3a3632;
	--border-soft: #1b1917;
	--text-muted: #b8b2aa;
	--text-faint: #8b857d;
}

[data-theme="light"][data-palette="ignite"] {
	--border: #ded8d0;
	--border-strong: #c8c1b8;
	--border-soft: #ece7e0;
	--text-muted: #5d5750;
	--text-faint: #7d766e;
}
```

- [ ] **Step 2: Verify contrast**

In the browser with `ignite-dev`, run axe-core against the Today view and an Area view.
Expected: 0 contrast violations. `--text-muted` at `#b8b2aa` on `#0b0a0a` is roughly 9:1, comfortably past AA.

- [ ] **Step 3: Commit**

```bash
npm run format
git add main.css
git commit -m "style: warm the border and muted-text tokens for the ignite ground"
```

---

### Task 4: Precache the fonts in the service worker

The `ignite` palette pulls four `.woff2` files. Vite emits them to `/ignite/assets/` referenced from **bundled CSS**, not from `index.html` — so the existing install-time regex, which scans the shell HTML for `src`/`href`, never sees them. An installed, offline Ignite would silently fall back to system-ui.

**Files:**
- Modify: `public/sw.js:3`, `public/sw.js:25-33`

**Interfaces:**
- Consumes: the built `/assets/*.css` from Task 2
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Bump the cache version**

In `public/sw.js`, change line 3 from:

```js
const VERSION = "ignite-v1"; // bump to invalidate all caches (hygiene; online users self-heal)
```

to:

```js
const VERSION = "ignite-v2"; // bump to invalidate all caches (hygiene; online users self-heal)
```

- [ ] **Step 2: Add the second parse hop**

In `public/sw.js`, replace the `try { … } catch { … }` block at lines 25–33 with:

```js
				try {
					const html = await (await fetch(new URL("./", SCOPE))).text();
					const assets = [
						...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g),
					].map((m) => new URL(m[1], SCOPE).toString());
					if (assets.length) await cache.addAll(assets);

					// Second hop: fonts are url() references INSIDE the bundled CSS, so the
					// HTML regex above never sees them. Without this, an installed offline
					// Ignite falls back to system-ui and loses its type identity entirely.
					const fonts = new Set();
					for (const styleUrl of assets.filter((u) => u.endsWith(".css"))) {
						const css = await (await fetch(styleUrl)).text();
						for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
							const resolved = new URL(m[1], styleUrl).toString();
							// Same-origin only, matching the fetch handler's own rule. This
							// also drops data: URIs, which need no caching.
							if (resolved.startsWith(self.location.origin)) fonts.add(resolved);
						}
					}
					// Per-item, NOT cache.addAll: addAll is atomic, so a single stale url()
					// reference would reject the whole batch into the catch below and leave
					// ZERO fonts precached — silently reintroducing the exact bug this task
					// exists to fix, one layer up.
					await Promise.allSettled([...fonts].map((url) => cache.add(url)));
				} catch {
					// best-effort: anything not precached falls back to runtime cache-first
				}
```

- [ ] **Step 3: Build and serve the built app**

Run: `npm run build`
Then start the `ignite-preview` launch config (`npm run preview`, port 4173). The service worker is PROD-guarded and does **not** register under `vite dev` — testing this on the dev server proves nothing.

- [ ] **Step 4: Verify the fonts are actually in the cache**

Load the preview, then in the browser console run:

```js
caches.open("ignite-v2").then((c) => c.keys()).then((k) => k.filter((r) => r.url.endsWith(".woff2")).map((r) => r.url))
```

Expected: an array of 4 URLs ending in `.woff2` — Bricolage 600 and 700, Hanken 400 and 500.

- [ ] **Step 5: Verify offline**

Go offline (DevTools → Network → Offline), hard-reload, then in the console run:

```js
getComputedStyle(document.querySelector("#main h1")).fontFamily
```

Expected: a value beginning with `"Bricolage Grotesque"`, and the heading visibly renders in it rather than a system fallback.

- [ ] **Step 6: Commit**

```bash
npm run format
git add public/sw.js
git commit -m "fix(sw): precache fonts referenced from bundled CSS"
```

---

## Phase 2 — Light theme (Tasks 5–9)

---

### Task 5: The theme pure seam

**Files:**
- Create: `src/utils/theme.js`
- Test: `tests/utils/theme.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `THEME_CHOICES` (`["system", "dark", "light"]`), `DEFAULT_CHOICE` (`"system"`), `resolveTheme(choice, prefersDark) → "dark" | "light"`, `nextThemeChoice(choice) → choice` — used by Tasks 6, 8 and 9

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/theme.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
	DEFAULT_CHOICE,
	nextThemeChoice,
	resolveTheme,
	THEME_CHOICES,
} from "../../src/utils/theme.js";

describe("resolveTheme", () => {
	it("resolves an explicit choice to itself, ignoring the OS", () => {
		expect(resolveTheme("light", true)).toBe("light");
		expect(resolveTheme("dark", false)).toBe("dark");
	});

	it("resolves system against the OS preference", () => {
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
	});

	it("treats null and undefined as system", () => {
		expect(resolveTheme(null, false)).toBe("light");
		expect(resolveTheme(undefined, true)).toBe("dark");
	});

	it("treats unrecognised input as system rather than dead-ending", () => {
		expect(resolveTheme("purple", false)).toBe("light");
		expect(resolveTheme("", true)).toBe("dark");
		expect(resolveTheme(0, true)).toBe("dark");
	});
});

describe("nextThemeChoice", () => {
	it("cycles system to light to dark and back", () => {
		expect(nextThemeChoice("system")).toBe("light");
		expect(nextThemeChoice("light")).toBe("dark");
		expect(nextThemeChoice("dark")).toBe("system");
	});

	it("returns to the start after a full cycle", () => {
		let choice = "system";
		for (let i = 0; i < 3; i++) choice = nextThemeChoice(choice);
		expect(choice).toBe("system");
	});

	it("never strands the user — every choice has a successor in the cycle", () => {
		for (const choice of THEME_CHOICES) {
			expect(THEME_CHOICES).toContain(nextThemeChoice(choice));
		}
	});

	it("enters the cycle at a defined point for unrecognised input", () => {
		expect(nextThemeChoice("purple")).toBe("light");
		expect(nextThemeChoice(null)).toBe("light");
	});
});

describe("the theme vocabulary", () => {
	it("separates choices from resolved themes, in cycle order", () => {
		// The array order IS the cycle the control walks. Asserted explicitly so a
		// reorder shows up here rather than as a control that cycles the wrong way.
		expect(THEME_CHOICES).toEqual(["system", "light", "dark"]);
		expect(DEFAULT_CHOICE).toBe("system");
	});
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/utils/theme.test.js`
Expected: FAIL — cannot resolve `../../src/utils/theme.js`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/theme.js`:

```js
// Pure theme logic. No DOM, no storage — the caller supplies every input.
//
// TWO VOCABULARIES, deliberately separate:
//   choice   — "system" | "dark" | "light"; what the user picks and what persists
//   resolved — "dark" | "light"; what actually reaches data-theme
//
// The control cycles three states rather than toggling two. A binary toggle
// starting from "system" could only ever write "dark" or "light", so the first
// tap would permanently end OS-following with no way back through the UI.

// The ARRAY ORDER IS THE CYCLE: system → light → dark → system. Reordering this
// reorders what the control does.
export const THEME_CHOICES = ["system", "light", "dark"];
export const DEFAULT_CHOICE = "system";

export function resolveTheme(choice, prefersDark) {
	if (choice === "dark" || choice === "light") return choice;
	// Anything else — "system", null, a stale value from an older build — follows
	// the OS. Treating unknown input as "system" keeps a corrupted setting
	// recoverable instead of stranding the user on a theme they cannot leave.
	return prefersDark ? "dark" : "light";
}

export function nextThemeChoice(choice) {
	const i = THEME_CHOICES.indexOf(choice);
	// Unrecognised input already RESOLVES as "system" (see resolveTheme), so it has
	// to take system's successor. Letting indexOf's -1 fall through to index 0
	// would return "system" itself — and the control would appear to do nothing.
	const from = i === -1 ? THEME_CHOICES.indexOf(DEFAULT_CHOICE) : i;
	return THEME_CHOICES[(from + 1) % THEME_CHOICES.length];
}
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `npx vitest run tests/utils/theme.test.js`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/utils/theme.js tests/utils/theme.test.js
git commit -m "feat(theme): add the theme resolution and cycling seams"
```

---

### Task 6: Persist the theme on the settings model

**Files:**
- Modify: `src/model/settings.js:7-14`, `src/model/settings.js:43-45`
- Test: `tests/unit/settings.test.js` (append)

**Interfaces:**
- Consumes: `THEME_CHOICES`, `DEFAULT_CHOICE` from Task 5
- Produces: `settings.setTheme(choice) → Promise<Settings>`, and `settings.get()` resolving with a `theme` field of `"system" | "dark" | "light"` — used by Task 8

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/settings.test.js`:

```js
describe("createSettingsModel — theme", () => {
	it("defaults to system on a fresh install", async () => {
		const { model } = await freshModel();
		const current = await model.get();
		expect(current.theme).toBe("system");
	});

	it("persists every valid choice and notifies", async () => {
		const { model } = await freshModel();

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.setTheme("light");
		expect((await model.get()).theme).toBe("light");

		await model.setTheme("dark");
		expect((await model.get()).theme).toBe("dark");

		// Returning to system must be persistable — that is what keeps the control
		// reversible instead of a one-way door.
		await model.setTheme("system");
		expect((await model.get()).theme).toBe("system");

		expect(calls).toHaveLength(3);
	});

	it("rejects an unrecognised choice rather than persisting it", async () => {
		const { model } = await freshModel();
		await expect(model.setTheme("purple")).rejects.toThrow(/theme/i);
		const after = await model.get();
		expect(after.theme).toBe("system");
	});

	it("leaves other settings untouched", async () => {
		const { model } = await freshModel();
		await model.setTheme("dark");
		const after = await model.get();
		expect(after.theme).toBe("dark");
		expect(after.quietStart).toBe(23);
		expect(after.sidebarCollapsed).toBe(false);
	});
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/unit/settings.test.js`
Expected: FAIL — `current.theme` is `undefined`, and `model.setTheme` is not a function.

- [ ] **Step 3: Add the field and the setter**

In `src/model/settings.js`, add the import at the top of the file:

```js
import { DEFAULT_CHOICE, THEME_CHOICES } from "../utils/theme.js";
```

Then change the `DEFAULTS` block at lines 7–14 to:

```js
const DEFAULTS = {
	id: SETTINGS_ID,
	quietStart: 23,
	quietEnd: 7,
	lastKnownPermission: "default",
	lastView: "#today",
	sidebarCollapsed: false,
	// The user's CHOICE, not the resolved theme: "system" | "dark" | "light".
	// "system" defers to prefers-color-scheme and stays reachable via the cycle,
	// so choosing a theme is never a one-way door.
	theme: DEFAULT_CHOICE,
};
```

Then add `setTheme` after `setSidebarCollapsed` (currently lines 43–45):

```js
		async setTheme(choice) {
			if (!THEME_CHOICES.includes(choice)) {
				throw new Error(`setTheme: unknown theme choice "${choice}"`);
			}
			return this.update({ theme: choice });
		},
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/settings.test.js`
Expected: PASS — the 4 new tests plus the 5 that were already there.

Note the existing "is idempotent" test still passes: `createSettingsModel` only seeds when no record exists, so an install predating v2 keeps its record and reads `theme` as `undefined`. `resolveTheme` treats `undefined` exactly like `"system"` (Task 5, step 1), so **no migration is needed** — an existing user simply starts out following their OS.

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:run`
Expected: 187 passed (174 + 9 from Task 5 + 4 here).

- [ ] **Step 6: Commit**

```bash
npm run format
git add src/model/settings.js tests/unit/settings.test.js
git commit -m "feat(settings): persist the chosen theme"
```

---

### Task 7: The no-flash init snippet

**Files:**
- Modify: `index.html:3-14` (insert into `<head>` before the stylesheet link)

**Interfaces:**
- Consumes: `localStorage["ignite:theme"]`, written by Task 8
- Produces: `document.documentElement.dataset.theme` and `.dataset.palette` set before first paint

- [ ] **Step 1: Insert the snippet**

In `index.html`, insert this immediately before the `<link rel="stylesheet" href="/main.css" />` line and after the `<title>`:

```html
		<script>
			/* Inline and synchronous on purpose: an external script runs after the
			   stylesheets parse, which flashes the wrong theme on first paint. The
			   settings model in IndexedDB is the source of truth, but IndexedDB is
			   async and cannot be read this early — so the controller mirrors the
			   chosen theme into localStorage purely as this paint-time cache.
			   Mirrors resolveTheme() in src/utils/theme.js: anything that is not
			   an explicit "dark"/"light" — including "system", absent, or stale —
			   follows the OS. */
			(function () {
				var choice = localStorage.getItem("ignite:theme");
				document.documentElement.dataset.theme =
					choice === "dark" || choice === "light"
						? choice
						: window.matchMedia("(prefers-color-scheme: light)").matches
							? "light"
							: "dark";
			})();
		</script>
```

- [ ] **Step 2: Leave `data-palette` where it is**

`index.html` line 2 keeps the static attribute from Task 2:

```html
<html lang="en" data-palette="ignite">
```

Deliberately **not** moved into the snippet. The value is a constant — the palette is not user-switchable — so routing it through JS buys nothing and costs a worse failure mode: if the snippet ever throws, the app would fall back to the design system's default cool blue-grey palette instead of ignite. The snippet owns `data-theme` only.

- [ ] **Step 3: Verify no flash**

Build and serve: `npm run build`, then the `ignite-preview` config. Run each of these in the console, hard-reloading after each:

1. `localStorage.setItem("ignite:theme", "light")` → paints light immediately, with no dark frame first.
2. `localStorage.setItem("ignite:theme", "system")` with the OS set to light → paints light; with the OS set to dark → paints dark.
3. `localStorage.removeItem("ignite:theme")` → behaves identically to `"system"`.
4. `localStorage.setItem("ignite:theme", "purple")` → falls back to the OS rather than breaking. A corrupted value must stay recoverable.

Also confirm `document.documentElement.dataset.palette` reads `"ignite"` — it comes from the static attribute, not the snippet.

- [ ] **Step 4: Commit**

```bash
npm run format
git add index.html
git commit -m "feat(theme): set the theme before first paint"
```

---

### Task 8: Controller theme wiring

**Files:**
- Modify: `src/controller.js` — imports, `buildState` (lines 66–78), `applyState` (lines 80–92), `start` (line 625 onward), and teardown in `stop`

**Interfaces:**
- Consumes: `resolveTheme`, `nextThemeChoice`, `DEFAULT_CHOICE` from Task 5; `settings.setTheme` from Task 6
- Produces: `state.themeChoice` (`"system" | "dark" | "light"`) and `state.theme` (`"dark" | "light"`) on every rendered state, consumed by Task 9; `onCycleTheme` callback passed to the sidebar view

- [ ] **Step 1: Add the import**

At the top of `src/controller.js`, alongside the existing imports:

```js
import { DEFAULT_CHOICE, nextThemeChoice, resolveTheme } from "./utils/theme.js";
```

- [ ] **Step 2: Add the theme state and the apply helper**

Add near the other controller-owned transient state (beside `let drawerMq = null;` at line 60):

```js
	let currentChoice = null; // "system" | "dark" | "light" — mirrors the model
	let currentTheme = null; // resolved "dark" | "light" — what is on the document
	let themeMq = null; // matchMedia("(prefers-color-scheme: dark)")
	let themeMqHandler = null;
```

Then add this function above `buildState`:

```js
	// Applies the resolved theme to the document. The settings model is the source
	// of truth; localStorage is a derived paint-time cache read only by the inline
	// <head> snippet, and stores the CHOICE (including "system") so the snippet can
	// re-resolve it the same way on the next boot.
	function applyTheme(choice, theme) {
		const choiceChanged = choice !== currentChoice;
		const themeChanged = theme !== currentTheme;
		currentChoice = choice;
		currentTheme = theme;
		if (choiceChanged) localStorage.setItem("ignite:theme", choice);
		if (!themeChanged) return;
		document.documentElement.dataset.theme = theme;
		const meta = document.querySelector('meta[name="theme-color"]');
		meta?.setAttribute("content", theme === "dark" ? "#0b0a0a" : "#f6f8fa");
	}
```

The two `changed` flags are tracked separately on purpose. Cycling dark → system on a dark-mode machine changes the *choice* but not the *resolved theme*: without the split, the localStorage write would be skipped and the next boot would resolve from a stale key.

- [ ] **Step 3: Resolve the theme in `applyState`**

In `applyState` (line 80), insert immediately after `const state = await buildState();`:

```js
		const choice = state.settings.theme ?? DEFAULT_CHOICE;
		applyTheme(
			choice,
			resolveTheme(
				choice,
				window.matchMedia("(prefers-color-scheme: dark)").matches,
			),
		);
		state.themeChoice = currentChoice;
		state.theme = currentTheme;
```

Both must be set **after** `applyTheme`, so the views render what is actually on the document.

- [ ] **Step 4: Follow the OS live, but only while it matters**

In `start()`, alongside the existing `drawerMq` setup:

```js
		themeMq = window.matchMedia("(prefers-color-scheme: dark)");
		themeMqHandler = () => {
			// Early-return unless the user is actually following the OS. applyState
			// is a four-model read plus a full innerHTML rewrite of the sidebar and
			// main view — far too expensive to run for a guaranteed no-op.
			if (currentChoice !== "system") return;
			applyState();
		};
		themeMq.addEventListener("change", themeMqHandler);
```

And in `stop()`, alongside the existing `drawerMq` teardown:

```js
		themeMq?.removeEventListener("change", themeMqHandler);
		themeMq = null;
		themeMqHandler = null;
```

- [ ] **Step 5: Add the cycle callback**

In `start()`, inside the `createSidebarView(sidebarRoot, { … })` options object at line 642, add alongside `onToggleCollapse`:

```js
			onCycleTheme: async () => {
				await settings.setTheme(nextThemeChoice(currentChoice));
			},
```

The model write notifies, `applyState` runs, and `applyTheme` does the DOM work. The controller never touches `dataset.theme` directly outside `applyTheme`.

- [ ] **Step 6: Verify the suite still passes**

Run: `npm run check && npm run test:run`
Expected: Biome clean, 187 passed. No controller tests exist, so this only confirms nothing regressed.

- [ ] **Step 7: Commit**

```bash
npm run format
git add src/controller.js
git commit -m "feat(theme): wire theme resolution and toggling through the controller"
```

---

### Task 9: The sidebar theme control

**Files:**
- Modify: `src/views/sidebar.js` — the `template` function (lines 447–462), the `bindActions` map, and the callbacks destructure
- Modify: `main.css` — remove `.visually-hidden` (lines 22–35), add `.sidebar__footer` / `.sidebar__theme` rules
- Modify: `src/views/today.js:383`, `src/views/today.js:403` — swap `.visually-hidden` usage

**Interfaces:**
- Consumes: `state.themeChoice` and `onCycleTheme` from Task 8; `.sr-only` from `design-system/utilities/index.css`
- Produces: a `[data-action="cycle-theme"]` control in the sidebar footer

- [ ] **Step 1: Render the control**

In `src/views/sidebar.js`, the `template` function must now receive the theme. Change its return block (lines 447–462) so the closing `</ul>` is followed by a footer. Replace:

```js
		<ul class="sidebar__areas">
			${items}
			<li class="sidebar__add-area-row">
				<button type="button" class="sidebar__add-area" data-action="add-area">
					＋ New area
				</button>
			</li>
		</ul>
	`;
```

with:

```js
		<ul class="sidebar__areas">
			${items}
			<li class="sidebar__add-area-row">
				<button type="button" class="sidebar__add-area" data-action="add-area">
					＋ New area
				</button>
			</li>
		</ul>
		<div class="sidebar__footer">
			<button class="sidebar__theme" type="button" data-action="cycle-theme">
				<span class="sidebar__theme-icon" aria-hidden="true">${THEME_GLYPH[state.themeChoice]}</span>
				<span class="sidebar__theme-text">Theme: ${THEME_WORD[state.themeChoice]}</span>
			</button>
		</div>
	`;
```

And add these lookups at module scope in `src/views/sidebar.js`:

```js
const THEME_GLYPH = { system: "◐", light: "☀", dark: "☾" };
const THEME_WORD = { system: "system", light: "light", dark: "dark" };
```

The control sits **outside** `.sidebar__areas`, so it never enters area keyboard navigation and does not disturb `.sidebar__home` — the focus target the cascade-delete routing lands on.

Three deliberate a11y choices:

- **The accessible name is the visible text and changes with the state** — "Theme: system" → "Theme: light" → "Theme: dark". This is the standard cycling-button pattern; screen readers announce the focused control's new name after activation.
- **No `aria-pressed`.** It describes a binary on/off and cannot express three states.
- **No `aria-live` on the value.** That would make a live region that contains the focused element — the same trap documented for the toast, where focus inside a live region suppresses re-announcement in some screen readers.

- [ ] **Step 2: Wire the action**

In `src/views/sidebar.js`, add to the `bindActions` map alongside `"toggle-sidebar"`:

```js
		"cycle-theme": () => callbacks.onCycleTheme(),
```

- [ ] **Step 3: Retire `.visually-hidden`**

In `main.css`, delete lines 22–35 in full — the comment and the entire `.visually-hidden` rule. The system's `.sr-only` from `utilities/index.css` replaces it.

In `src/views/today.js` line 383, change:

```js
		return `<h1 class="visually-hidden">Today</h1><p class="empty">You're clear. Nice.</p>`;
```

to:

```js
		return `<h1 class="sr-only">Today</h1><p class="empty">You're clear. Nice.</p>`;
```

And line 403, change `<h1 class="visually-hidden">Today</h1>` to `<h1 class="sr-only">Today</h1>`.

Both are replaced with a visible heading in Task 10; this step keeps the app correct in the meantime rather than leaving a dangling class.

- [ ] **Step 4: Style the footer**

Append to `main.css`:

```css
/* --- Sidebar footer: theme control --- */
.sidebar__footer {
	margin-top: auto;
	padding-top: var(--space-3);
	border-top: 1px solid var(--border);
}
.sidebar__theme {
	display: flex;
	align-items: center;
	gap: var(--space-2);
	width: 100%;
	min-height: 2.75rem;
	padding: var(--space-2);
	border-radius: var(--radius-sm);
	color: var(--text-muted);
	transition: background-color var(--duration-base) var(--ease-standard);
}
.sidebar__theme:hover {
	background: var(--surface-3);
	color: var(--text);
}
.sidebar__theme-icon {
	font-size: var(--text-lg);
	line-height: 1;
}
```

Then, inside the existing `body.is-sidebar-collapsed` rules for the 48px rail, hide the label while keeping its accessible name — matching how the rest of the sidebar collapses:

```css
body.is-sidebar-collapsed .sidebar__theme-text {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
body.is-sidebar-collapsed .sidebar__theme {
	justify-content: center;
}
```

`display: none` would remove the label from the accessible name entirely, leaving an unlabelled button.

- [ ] **Step 5: Verify the whole theme path in the browser**

With `ignite-dev`, confirm all of:

- The control appears at the bottom of the sidebar, above the fold on desktop.
- **It cycles all three states and returns to the start:** clicking from "Theme: system" gives light, then dark, then system again. Getting back to system without clearing storage is the whole point of the three-state design — verify it explicitly.
- Light mode reaches every surface: the task menu, section menu, area menu, move picker, the toast, and the recurrence dialog. Open each one in light mode.
- With the choice on "system", changing the OS theme flips the app live. With it on "light" or "dark", changing the OS theme does nothing.
- Reloading keeps the chosen state with no flash — including when the choice is "system".
- `document.querySelector('meta[name="theme-color"]').content` reads `#f6f8fa` in light and `#0b0a0a` in dark.
- `localStorage.getItem("ignite:theme")` tracks the choice, including `"system"`. Cycle dark → system **on a dark-mode machine** and confirm the key updates to `"system"` even though the resolved theme did not change — that is the case the split `changed` flags in Task 8 exist for.
- Collapsing the sidebar to the rail leaves an icon-only button that still announces its full "Theme: …" name.
- The control is reachable by keyboard and shows a visible focus ring.
- 0 console errors.

- [ ] **Step 6: Run axe in both themes**

Run axe-core against Today, an Area view, an open menu, and the recurrence dialog, in **dark and light**.
Expected: 0 violations in both. Light mode has never been rendered before this task — treat any contrast failure here as a Task 3 token problem, not a component problem.

- [ ] **Step 7: Commit**

```bash
npm run format
git add src/views/sidebar.js src/views/today.js main.css
git commit -m "feat(theme): add the sidebar theme control"
```

---

## Phase 3 — Layout (Tasks 10–13)

---

### Task 10: Give Today a visible heading

**Files:**
- Modify: `src/views/today.js:382-384`, `src/views/today.js:402-408`
- Modify: `main.css` (append)

**Interfaces:**
- Consumes: `state.now` (already on state)
- Produces: `.today-header`, `.today-header__date` for styling

- [ ] **Step 1: Replace the empty-state heading**

In `src/views/today.js`, replace lines 382–384:

```js
	if (allEmpty) {
		return `<h1 class="sr-only">Today</h1><p class="empty">You're clear. Nice.</p>`;
	}
```

with:

```js
	if (allEmpty) {
		return `${renderHeader(state.now)}<p class="empty">You're clear. Nice.</p>`;
	}
```

- [ ] **Step 2: Replace the populated-state heading**

In the same file, change line 403 from:

```js
		<h1 class="sr-only">Today</h1>
```

to:

```js
		${renderHeader(state.now)}
```

- [ ] **Step 3: Add the header renderer**

Add this function immediately after `template` (after line 409):

```js
// Today is the app's home screen and had no visible title — the <h1> was
// screen-reader-only, added to satisfy axe's page-has-heading-one. A real
// heading satisfies it better. BOTH branches of `template` must render one:
// the empty state is a real route, not a transient.
function renderHeader(now) {
	const date = now.toLocaleDateString(undefined, {
		weekday: "long",
		day: "numeric",
		month: "long",
	});
	return `
		<header class="today-header">
			<h1>Today</h1>
			<p class="today-header__date">${date}</p>
		</header>
	`;
}
```

Two notes. The date is locale-formatted by the browser, so it follows Malin's Norwegian locale without a hardcoded format. And it is **not** passed through `escapeHtml` — deliberately: `escapeHtml` is not imported in `today.js` (line 7 imports only `bindActions, bindKeys`), and the project's rule is to escape *user-provided* strings. `toLocaleDateString` output is generated text that cannot contain markup, so adding an import for it would be noise. Do not copy this exemption to anything carrying a task title or area name.

- [ ] **Step 4: Style it**

Append to `main.css`:

```css
/* --- Today header --- */
.today-header {
	margin-bottom: var(--space-5);
}
.today-header h1 {
	margin: 0;
}
.today-header__date {
	margin: var(--space-1) 0 0;
	color: var(--text-faint);
	font-size: var(--text-sm);
}
```

- [ ] **Step 5: Verify**

Run: `npm run test:run`
Expected: 187 passed — no test asserts on Today's markup.

In the browser, confirm: the heading renders in Bricolage Grotesque at the `--text-2xl` size set in Task 2, the date reads correctly in Norwegian, and it appears in **both** the empty state and the populated state. Run axe and confirm `page-has-heading-one` still passes.

- [ ] **Step 6: Commit**

```bash
npm run format
git add src/views/today.js main.css
git commit -m "feat(today): add a visible page heading and date"
```

---

### Task 11: Sentence-case group headings with a separate count

**Files:**
- Modify: `src/views/today.js:445`, `src/views/today.js:460-465`
- Modify: `main.css` (append)

**Interfaces:**
- Consumes: nothing new
- Produces: `.group__count` for styling

- [ ] **Step 1: Split the count out of the heading text**

In `src/views/today.js`, replace line 445:

```js
	const headingText = showCount ? `${heading} (${tasks.length})` : heading;
```

with:

```js
	// The count is a separate element, not part of the heading string: it is
	// metadata, and styling it as such is what lets the heading itself read as a
	// heading rather than a label.
	const countHtml = showCount
		? `<span class="group__count">${tasks.length}</span>`
		: "";
```

- [ ] **Step 2: Use it in the markup**

In the same function, replace the return block at lines 460–465:

```js
	return `
		<section class="group ${modifierClass}">
			<h3 class="group__heading">${headingText}</h3>
			<ul class="group__list">${rows}</ul>
		</section>
	`;
```

with:

```js
	return `
		<section class="group ${modifierClass}">
			<h3 class="group__heading">${heading}${countHtml}</h3>
			<ul class="group__list">${rows}</ul>
		</section>
	`;
```

The heading strings passed by `template` — `"Overdue"`, `"Today"`, `"Starred"` — are already sentence case and need no change.

- [ ] **Step 3: Restyle the heading**

Find the existing `.group__heading` rule in `main.css` and replace its declarations with:

```css
.group__heading {
	display: flex;
	align-items: baseline;
	gap: var(--space-2);
	margin: 0 0 var(--space-2);
	font-size: var(--text-md);
	letter-spacing: var(--tracking-heading);
	text-transform: none;
	color: var(--text);
}
.group__count {
	font-family: var(--font-sans);
	font-size: var(--text-sm);
	font-weight: 400;
	color: var(--text-faint);
}
```

`text-transform: none` is explicit because the v1 rule uppercased these; leaving it off would silently keep the caps.

- [ ] **Step 4: Restyle the NEXT card label to match**

In `src/views/today.js` line 423, change:

```js
			<h2 class="next-card__label">NEXT</h2>
```

to:

```js
			<h2 class="next-card__label">Next</h2>
```

Then find the existing `.next-card__label` rule in `main.css` and replace its declarations with:

```css
.next-card__label {
	display: flex;
	align-items: center;
	gap: var(--space-2);
	margin: 0 0 var(--space-3);
	font-size: var(--text-sm);
	letter-spacing: var(--tracking-heading);
	text-transform: none;
	color: var(--accent);
}
```

`text-transform: none` is explicit here for the same reason as the group heading: the v1 rule uppercased this label, and dropping the declaration would silently keep the caps even though the source string is now "Next".

- [ ] **Step 5: Verify**

Run: `npm run test:run`
Expected: 187 passed.

In the browser: headings read "Overdue 3", "Today 5", "Starred" — sentence case, count in a lighter weight and colour. "Next" on the card, not "NEXT".

- [ ] **Step 6: Commit**

```bash
npm run format
git add src/views/today.js main.css
git commit -m "style(today): sentence-case group headings with a separate count"
```

---

### Task 12: Put task rows on a bordered surface

This is the change that fixes the floating-in-a-void reading — more than any colour does.

**Files:**
- Modify: `main.css` — `.group__list`, `.next-card`, `.task`

**Interfaces:**
- Consumes: `--panel-bg`, `--card-bg`, `--border`, `--radius-md` from Task 2
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Give the group list a surface**

Find the existing `.group__list` rule in `main.css` and replace its declarations with:

```css
.group__list {
	list-style: none;
	margin: 0;
	padding: 0;
	background: var(--panel-bg);
	border: 1px solid var(--border);
	border-radius: var(--radius-md);
}
.group__list > .task + .task {
	border-top: 1px solid var(--border-soft);
}
/* Round the end rows individually. Do NOT reach for `overflow: hidden` here — the
   task ⋯ menu injects INSIDE the <li> as its last child (see today.js), so a
   clipping ancestor cuts the menu off. It bites worst on the last row of a group,
   which is exactly where a menu most needs to overflow. */
.group__list > .task:first-child {
	border-start-start-radius: var(--radius-md);
	border-start-end-radius: var(--radius-md);
}
.group__list > .task:last-child {
	border-end-start-radius: var(--radius-md);
	border-end-end-radius: var(--radius-md);
}
```

- [ ] **Step 2: Give the NEXT card a full border**

Find the existing `.next-card` rule and replace its declarations with:

```css
.next-card {
	margin: 0 0 var(--space-5);
	padding: var(--space-4);
	background: var(--card-bg);
	/* A full border, not the v1 left rule: single-sided borders and rounded
	   corners do not combine, and the accent tint carries the emphasis anyway. */
	border: 1px solid rgb(var(--accent-rgb) / 28%);
	border-radius: var(--radius-md);
}
.next-card__list {
	list-style: none;
	margin: 0;
	padding: 0;
}
```

Delete any `border-left` declaration left over from v1 on this rule.

- [ ] **Step 3: Give rows room**

Find the existing `.task` rule and ensure it carries:

```css
.task {
	display: flex;
	align-items: center;
	gap: var(--space-3);
	padding: var(--space-3) var(--space-4);
	min-height: 2.75rem;
}
```

`min-height: 2.75rem` (44px) keeps the touch target usable on mobile, per the design system's non-negotiable rules.

- [ ] **Step 4: Verify**

Run: `npm run test:run && npm run check`
Expected: 187 passed, Biome clean.

In the browser, confirm in **both themes**: rows sit on a visible panel with hairline separators; the first and last rows follow the container radius; the NEXT card has a full accent-tinted border with no leftover left rule; nothing overflows on mobile at 375px width; the capture bar still sits correctly and `--capture-h` still drives both `#main` padding and the toast lift.

**Then the regression check that matters here:** open the ⋯ menu on the **last row of a group**, and again on the last row of the last group on the page. The menu must render in full, not clipped at the list border. If it is cut off, a clipping ancestor has crept back in — the menu lives inside the `<li>`, so any `overflow` other than `visible` on `.group__list` or `.group` will cut it.

- [ ] **Step 5: Commit**

```bash
npm run format
git add main.css
git commit -m "style(today): put task rows on a bordered surface"
```

---

### Task 13: Mark the active area in the sidebar

The sidebar currently gives the active area no visual weight beyond `aria-current` — every row reads the same. `renderAreaRow` already emits `is-active` (`src/views/sidebar.js:503`); this task gives that class something to do.

**Files:**
- Modify: `main.css` — `.sidebar__area`, `.sidebar__count`

**Interfaces:**
- Consumes: the existing `is-active` class and `--accent-soft` / `--accent` from Task 2
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Tint the active row**

Find the existing `.sidebar__area` rule in `main.css` and append these rules after it:

```css
.sidebar__area.is-active {
	background: var(--accent-soft);
	color: var(--text);
}
.sidebar__area.is-active .sidebar__count {
	color: var(--accent);
	font-weight: 500;
}
.sidebar__area:not(.is-active):hover {
	background: var(--surface-3);
}
```

The active state is carried by background tint and count colour, not by a loud fill — matching the design system's navigation rule that active states stay soft. `aria-current="page"` is already on the element and remains the accessible signal; this is purely visual reinforcement.

- [ ] **Step 2: Verify**

Run: `npm run check && npm run test:run`
Expected: Biome clean, 187 passed.

In the browser, in **both themes**: navigating to an area tints that row and accents its count; returning to Today clears it; hovering a non-active row gives a distinct, quieter feedback; the tint is still visible in the collapsed 48px rail; contrast passes axe.

- [ ] **Step 3: Commit**

```bash
npm run format
git add main.css
git commit -m "style(sidebar): mark the active area with an accent tint"
```

---

## Phase 4 — Area icons (Task 14)

---

### Task 14: The emoji picker

`areas` already has an `icon` field: `src/model/areas.js:10` seeds Focus with `"🔥"`, `create({ name, icon = "", critical })` accepts one, and `sidebar.js:482` and `:513` already render `${escapeHtml(area.icon || "•")}`. The bullets in v1 are the fallback. This task adds only the picker UI.

**Files:**
- Create: `src/views/icon-picker.js`
- Create: `tests/utils/icon-picker.test.js`
- Modify: `src/views/sidebar.js` — render the picker in the editing row, add the action
- Modify: `src/controller.js` — the `onPickAreaIcon` callback
- Modify: `main.css` (append)

**Interfaces:**
- Consumes: `areas.update(id, patch)` (already exists, `src/model/areas.js:74`); `nextEnabledIndex`, `firstEnabledIndex`, `lastEnabledIndex` from `src/utils/menu-keyboard.js`
- Produces: `AREA_ICONS` (array of 24 strings), `renderIconPicker(selected) → string` — exported from `src/views/icon-picker.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/icon-picker.test.js`:

```js
import { describe, expect, it } from "vitest";
import { AREA_ICONS, renderIconPicker } from "../../src/views/icon-picker.js";

// Attributes are laid out across several lines in the template, so raw substring
// assertions are whitespace-brittle. Flatten before matching.
const flat = (s) => s.replace(/\s+/g, " ");

describe("AREA_ICONS", () => {
	it("offers 24 icons", () => {
		expect(AREA_ICONS).toHaveLength(24);
	});

	it("has no duplicates", () => {
		expect(new Set(AREA_ICONS).size).toBe(AREA_ICONS.length);
	});

	it("includes the flame Focus is seeded with", () => {
		expect(AREA_ICONS).toContain("🔥");
	});
});

describe("renderIconPicker", () => {
	it("renders one option per icon plus a clear option", () => {
		const html = renderIconPicker("");
		expect(html.match(/data-action="pick-area-icon"/g)).toHaveLength(
			AREA_ICONS.length + 1,
		);
	});

	it("is a radio group, not a row of toggles", () => {
		const html = renderIconPicker("🔥");
		expect(html).toContain('role="radiogroup"');
		expect(html.match(/role="radio"/g)).toHaveLength(AREA_ICONS.length + 1);
		expect(html).not.toContain("aria-pressed");
	});

	it("checks exactly the selected icon", () => {
		const html = flat(renderIconPicker("🔥"));
		expect(html).toContain('data-icon="🔥" aria-checked="true"');
		expect(html).toContain('data-icon="🎯" aria-checked="false"');
		expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
	});

	it("checks the clear option when no icon is set", () => {
		const html = flat(renderIconPicker(""));
		expect(html).toContain('data-icon="" aria-checked="true"');
		expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
	});

	it("exposes exactly one tab stop — the roving tabindex", () => {
		const html = renderIconPicker("🔥");
		expect(html.match(/tabindex="0"/g)).toHaveLength(1);
		expect(html.match(/tabindex="-1"/g)).toHaveLength(AREA_ICONS.length);
	});

	it("puts the tab stop on the clear option when nothing is selected", () => {
		const html = flat(renderIconPicker(""));
		expect(html).toContain('data-icon="" aria-checked="true" tabindex="0"');
	});

	it("still exposes one tab stop for an icon outside the curated set", () => {
		// A value from an older build or a future import must not strand the
		// keyboard user with zero reachable options.
		const html = renderIconPicker("🦊");
		expect(html.match(/tabindex="0"/g)).toHaveLength(1);
	});

	it("gives every option an accessible name", () => {
		const html = renderIconPicker("");
		expect(html.match(/aria-label="[^"]+"/g)).toHaveLength(
			AREA_ICONS.length + 1,
		);
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/utils/icon-picker.test.js`
Expected: FAIL — cannot resolve `../../src/views/icon-picker.js`.

- [ ] **Step 3: Write the picker**

Create `src/views/icon-picker.js`:

```js
// renderIconPicker(selected) → HTML string
//
// A curated grid for the area `icon` field, which already exists on the model
// (areas.js seeds Focus with "🔥"). Emoji, not SVG, because that is what the
// field already holds — no migration, no assets, and it works offline.
//
// The icon itself stays aria-hidden wherever it renders in the sidebar: the area
// NAME carries the accessible meaning, and emoji announce inconsistently across
// screen readers. Here in the picker each button needs its own name, so the
// label is written out.

export const AREA_ICONS = [
	"🔥", "⭐", "🎯", "✅",
	"📌", "💡", "🧠", "📚",
	"💼", "🏠", "🧹", "🛒",
	"🍳", "💪", "🏃", "🌱",
	"🎨", "🎵", "💰", "✈️",
	"❤️", "🐾", "🔧", "📅",
];

const LABELS = {
	"🔥": "Flame", "⭐": "Star", "🎯": "Target", "✅": "Check",
	"📌": "Pin", "💡": "Idea", "🧠": "Brain", "📚": "Books",
	"💼": "Work", "🏠": "Home", "🧹": "Cleaning", "🛒": "Shopping",
	"🍳": "Cooking", "💪": "Strength", "🏃": "Running", "🌱": "Growth",
	"🎨": "Art", "🎵": "Music", "💰": "Money", "✈️": "Travel",
	"❤️": "Heart", "🐾": "Pets", "🔧": "Tools", "📅": "Calendar",
};

export function renderIconPicker(selected) {
	const current = selected ?? "";
	// One icon per area, so this is SINGLE-SELECT: role=radio + aria-checked, not
	// 24 independent aria-pressed toggles, which a screen reader would present as
	// 24 unrelated switches rather than one choice.
	//
	// Roving tabindex: exactly one option is tabbable, arrows move between them.
	// Without it the picker adds 25 tab stops between the rename input and the
	// next control, inside a rename flow that is keyboard-first.
	//
	// The tab stop falls back to the clear option when `current` is absent OR is a
	// value outside the curated set — otherwise an icon from an older build would
	// leave the group with no tabbable option at all.
	// The tab stop sits on the checked option. When `current` is absent or is a
	// value outside the curated set, it falls to the clear option — so the group
	// always has exactly one tabbable entry and never strands a keyboard user.
	const tabStop = AREA_ICONS.includes(current) ? current : "";

	const option = (icon, label, extraClass = "") => `
			<button type="button" class="icon-picker__option${extraClass}"
				role="radio"
				data-action="pick-area-icon" data-icon="${icon}"
				aria-checked="${current === icon}" tabindex="${icon === tabStop ? "0" : "-1"}"
				aria-label="${label}">${icon || "•"}</button>`;

	return `
		<div class="icon-picker" role="radiogroup" aria-label="Area icon">
			${AREA_ICONS.map((icon) => option(icon, LABELS[icon])).join("")}
			${option("", "No icon", " icon-picker__option--clear")}
		</div>
	`;
}
```

The icons are hardcoded rather than escaped because they are a fixed internal list, never user input. The `data-icon` values come from that same list, so no `escapeHtml` is needed here — unlike everywhere `area.name` is rendered.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/utils/icon-picker.test.js`
Expected: PASS — 12 tests.

- [ ] **Step 5: Render the picker in the editing row**

In `src/views/sidebar.js`, add the import at the top:

```js
import { renderIconPicker } from "./icon-picker.js";
```

Then in `renderAreaRow`, inside the `if (isRenaming)` branch, replace the returned block (lines 480–493) with:

```js
		return `
			<li class="sidebar__area-row sidebar__area-row--editing" data-area-id="${escapeHtml(area.id)}">
				<span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
				<input
					type="text"
					class="sidebar__rename-input"
					value="${escapeHtml(renameValue)}"
					data-action="commit-area-rename"
					data-area-id="${escapeHtml(area.id)}"
					aria-label="Rename area: ${escapeHtml(area.name)}"
					placeholder="${escapeHtml(area.name)}"
					autofocus />
				${renderIconPicker(area.icon)}
			</li>
		`;
```

The rename input keeps `autofocus` and stays the first focusable element, so the existing rename flow — including the caret-restore machinery in `src/utils/rename-input.js` — is untouched.

- [ ] **Step 6: Wire the action**

In `src/views/sidebar.js`, add to the `bindActions` map:

```js
		"pick-area-icon": (_event, actionEl) => {
			const row = actionEl.closest("[data-area-id]");
			if (row) callbacks.onPickAreaIcon(row.dataset.areaId, actionEl.dataset.icon);
		},
```

Note the signature: `bindActions` calls handlers as `fn(event, actionEl)` (`src/utils/dom.js:17`), so the element is the **second** parameter. A single-parameter handler would receive the event and silently read `undefined` off it.

- [ ] **Step 7: Add arrow-key navigation within the group**

Roving tabindex means arrows must move focus, since Tab no longer does. Add to the sidebar's existing `bindKeys` map — extending the handlers already there rather than adding a competing listener:

```js
		ArrowRight: (event) => moveIconFocus(event, 1),
		ArrowLeft: (event) => moveIconFocus(event, -1),
		ArrowDown: (event) => moveIconFocus(event, 1),
		ArrowUp: (event) => moveIconFocus(event, -1),
		Home: (event) => moveIconFocus(event, 0, firstEnabledIndex),
		End: (event) => moveIconFocus(event, 0, lastEnabledIndex),
```

And add the helper plus its import in `src/views/sidebar.js`:

```js
import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../utils/menu-keyboard.js";

// Arrow/Home/End within the icon radiogroup. Guarded on the group being the
// event's ancestor FIRST — without that, any sidebar keydown would fire this,
// the same trap documented for the menu arrow handlers.
function moveIconFocus(event, direction, pick) {
	const group = event.target.closest(".icon-picker");
	if (!group) return;
	event.preventDefault();
	const els = Array.from(group.querySelectorAll('[role="radio"]'));
	const items = els.map((el) => ({ disabled: el.disabled }));
	const currentIndex = els.indexOf(event.target);
	const idx = pick
		? pick(items)
		: nextEnabledIndex(items, currentIndex, direction);
	if (idx >= 0) els[idx].focus();
}
```

`preventDefault` matters: ArrowUp/ArrowDown would otherwise scroll the sidebar while the user is navigating the grid.

- [ ] **Step 8: Add the controller callback, with the drain**

In `src/controller.js`, in the `createSidebarView` options object, alongside `onCycleTheme`:

```js
			onPickAreaIcon: async (areaId, icon) => {
				try {
					await areas.update(areaId, { icon });
					// THE DRAIN IS LOAD-BEARING. notify() is synchronous and does not
					// await its subscribers, so this write's own notify-render is still
					// queued here — and this continuation, being a microtask, beats it.
					// Setting the focus flag without draining means the queued render
					// consumes it, and the NEXT render's innerHTML rewrite detaches the
					// button again. See the cascade focus routing notes in invariants.md.
					await applyState();
					sidebar?.focusAreaIcon?.(areaId, icon);
					await applyState();
				} catch (err) {
					// Cascade race: the area was deleted mid-edit. Matches how the other
					// area handlers swallow this exact case.
					if (!/not found/i.test(err.message)) throw err;
				}
			},
```

Then in `src/views/sidebar.js`, add the flag and its consumption, mirroring the existing `pendingFocus*` pattern:

```js
	let pendingFocusAreaIcon = null; // { areaId, icon } — consumed by the next render
```

Expose the setter on the returned view object:

```js
		focusAreaIcon(areaId, icon) {
			pendingFocusAreaIcon = { areaId, icon };
		},
```

Consume it **last** in the render, after the rename-input restore, and clear it unconditionally:

```js
	// Consumed last and cleared unconditionally: rename-input.js re-focuses the
	// rename input on every render, so without this a pick ejects the user from
	// the picker back to the text field every single time.
	if (pendingFocusAreaIcon) {
		const { areaId, icon } = pendingFocusAreaIcon;
		pendingFocusAreaIcon = null;
		rootEl
			.querySelector(
				`[data-area-id="${CSS.escape(areaId)}"] .icon-picker [data-icon="${CSS.escape(icon)}"]`,
			)
			?.focus();
	}
```

`CSS.escape` on both values, matching the existing `pendingFocusAreaId` and `pendingFocusAreaButtonId` consumers at `src/views/sidebar.js:302` and `:312`. The flag is nulled *before* the focus call so it clears even if the selector misses.

Also reset it to `null` in `destroy()`, alongside `pendingFocusAreaId`, `pendingFocusAreaButtonId` and `pendingFocusHome` (around `src/views/sidebar.js:405`).

- [ ] **Step 9: Style the picker**

Append to `main.css`:

```css
/* --- Area icon picker --- */
/* Mobile-first: 4 columns at the baseline, because six 44px targets plus gaps do
   not fit the 300px drawer. Six from tablet up. */
.icon-picker {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: var(--space-1);
	margin-top: var(--space-2);
	padding: var(--space-2);
	background: var(--surface-3);
	border: 1px solid var(--border);
	border-radius: var(--radius-sm);
}
.icon-picker__option {
	display: flex;
	align-items: center;
	justify-content: center;
	/* 44px, matching the task rows and the design system's touch-target rule. */
	min-width: 2.75rem;
	min-height: 2.75rem;
	border-radius: var(--radius-xs);
	font-size: var(--text-md);
	transition: background-color var(--duration-fast) var(--ease-standard);
}
.icon-picker__option:hover {
	background: var(--surface-5);
}
.icon-picker__option[aria-checked="true"] {
	background: var(--accent-soft);
	box-shadow: inset 0 0 0 1px rgb(var(--accent-rgb) / 45%);
}
.icon-picker__option--clear {
	color: var(--text-faint);
}

@media (min-width: 768px) {
	.icon-picker {
		grid-template-columns: repeat(6, 1fr);
	}
}
```

- [ ] **Step 10: Run the whole suite**

Run: `npm run check && npm run test:run`
Expected: Biome clean, 199 passed (187 + 12).

- [ ] **Step 11: Verify in the browser**

Confirm all of:

- Renaming an area shows the picker below the input; the rename input still takes focus first.
- Clicking an icon updates the sidebar row immediately and persists across reload.
- The clear option (`•`) resets to the bullet fallback.
- Typing a new name and pressing Enter still commits the rename — the picker did not break the `commit-area-rename` Enter path.
- **Escape from within the picker exits the rename**, exactly as Escape from the input does. The picker adds no new level to the sidebar's rename → menu → drawer precedence.

Then the keyboard behaviour the roving tabindex exists for:

- **Tab reaches the group exactly once.** From the rename input, one Tab lands on the checked option; the next Tab leaves the group entirely. It must not step through 25 options.
- Arrow keys move within the group and wrap at both ends; Home and End jump to first and last.
- ArrowUp/ArrowDown move focus **without scrolling the sidebar**.
- **Picking with the keyboard does not eject you.** Arrow to an option, activate it, and focus must stay on that option — not jump back to the rename input. If it jumps, the drain in Step 8 is missing or the flag is being consumed by the wrong render.
- Every option announces its own label, and the group announces as a radio group with one selected.

And the rest:

- 44px targets; the grid is 4 columns in the 300px mobile drawer with no overflow, 6 from 768px.
- Works in both themes.
- 0 console errors.

- [ ] **Step 12: Commit**

```bash
npm run format
git add src/views/icon-picker.js tests/utils/icon-picker.test.js src/views/sidebar.js src/controller.js main.css
git commit -m "feat(areas): add an emoji picker for area icons"
```

---

## Phase 5 — Release (Task 15)

---

### Task 15: Full verification and release prep

**Files:**
- Modify: `README.md:7`, `README.md:83-91`
- Modify: `package.json:3`

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Run the full green baseline**

Run: `npm run check && npm run test:run && npm run build`
Expected: Biome clean, 199 passed, build succeeds.

- [ ] **Step 2: Run the full browser matrix**

On the `ignite-preview` config (the built app), verify every one of these in **both themes**:

1. Today — empty state and populated state
2. Area view — with sections, and with none
3. Task menu, section menu, area menu, move picker — **including the ⋯ menu on the last row of a group**, where a clipping ancestor would show up
4. Recurrence dialog
5. Toast — plain, aggregated, and undo variants
6. Mobile drawer at 375px — open, close, capture bar, `--capture-h` lift
7. Sidebar collapsed rail, including the theme control
8. Theme control — the full system → light → dark → system cycle, persistence across reload, no flash, `theme-color` updates, and OS changes tracked live on "system" but ignored on an explicit choice
9. Emoji picker — rename flow, clear option, one tab stop, arrow-key navigation, and focus staying put after a pick
10. Cascade delete — delete a section, confirm focus lands on the previous section's `⋯`; delete an area, confirm focus lands on `.sidebar__home` on desktop and `.topbar__menu` on mobile
11. Keyboard — full paths through menus, rename (including F2 and double-click), drawer, theme control
12. axe-core — 0 violations on every surface, both themes
13. 0 console errors

Item 10 is the regression check that matters most: the cascade focus routing depends on `.section__menu-btn`, `.area__add-section`, `.sidebar__home` and `.topbar__menu` surviving the restyle by name.

- [ ] **Step 3: Verify offline once more on the built app**

Go offline, hard-reload, and confirm the app loads, renders in Bricolage/Hanken, and the theme persists.

- [ ] **Step 4: Update the README**

In `README.md`, change line 7 to:

```markdown
**Status:** v0.4.0 — 199 tests passing. **Live:** [malinfossum.github.io/ignite](https://malinfossum.github.io/ignite/)
```

In the Features list, add:

```markdown
- **Light and dark** — follows your system by default, or pick one; the control cycles back to system whenever you want it
```

In the Roadmap section, remove the line `- A refreshed visual design (the next milestone, toward v1.0.0)` — it has shipped.

Also update the test count in the Tech section from `(166 tests)` to `(199 tests)`.

- [ ] **Step 5: Bump the version**

In `package.json`, change line 3 to:

```json
	"version": "0.4.0",
```

- [ ] **Step 6: Replace the README screenshot**

Take a fresh desktop screenshot of the redesigned Today view and overwrite `docs/desktop_preview.png`. The current image shows the v1 design and would misrepresent the app.

- [ ] **Step 7: Commit**

```bash
npm run format
git add README.md package.json docs/desktop_preview.png
git commit -m "docs: update the README and version for v0.4.0"
```

---

## Deferred, with reasons

- **The `/` capture shortcut** and `settings.shortcutsEnabled` — still blocked on a real settings surface. The sidebar toggle is one control, not a settings surface. Design preserved in Appendix A of `2026-07-16-ignite-cascade-focus-design.md`, including the Norwegian Shift+7 trap.
- **File the workbench issues** — two, both found while reading canonical: (1) `ignite.css` should carry its own warm border and muted-text values, so Task 3's override can be dropped; (2) `base/base.css`'s `.skip-link` uses `var(--motion-base)` and `var(--ease-out)`, and `tokens/motion.css` defines neither — they are `--duration-base` and `--ease-standard`, so the transition is dead.
- **The three known cascade-focus follow-ups** — `wasDrawerOpen` on non-active mobile areas, first-section-delete jumping to the footer, undo focus. Behaviour, not visual.
- **Drag-to-reorder, task date editing, the definitive app icon, a custom install prompt.**
