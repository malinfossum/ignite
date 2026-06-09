# PWA Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ignite installable to the home screen and usable offline by adding a hand-rolled web app manifest + service worker, plus an interim flame icon.

**Architecture:** A new `public/` dir ships static, stable-URL assets (`manifest.webmanifest`, `sw.js`, icons) that Vite copies verbatim to `dist/`. The worker precaches the app shell and runtime-caches the content-hashed `/assets/*`; it's registered (production builds only) from `src/main.js` using `import.meta.env.BASE_URL`, and derives all cache URLs from `self.registration.scope`, so it is correct at both `/` and a future `/ignite/`. No Model/View/Controller logic changes — task data already lives offline in IndexedDB.

**Tech Stack:** Vanilla JS, Vite 8, Biome 2.4 (tabs, double quotes), `sharp` (dev-only, icon rasterization). Source of truth: `docs/superpowers/specs/2026-06-09-ignite-pwa-install-design.md`.

---

## Testing approach (read first)

Per the project convention (CLAUDE.md: TDD only on pure-function seams; views/infra verified manually) **and** the spec, this milestone adds **zero new Vitest tests** — a service worker and a manifest are not pure-function seams, and mocking the worker global tests the mocks, not real offline behavior. Verification is instead:
- **Per task:** `npm run check` (Biome) clean + file-existence / JSON-validity probes.
- **Acceptance (Task 5):** `npm run build` clean → `npm run preview` → Claude Preview MCP probes of `serviceWorker`/`caches` state + an offline reload, plus the **134 existing tests staying green**.

Do **not** write JSDOM/Vitest tests for `sw.js` or the manifest.

## Pre-flight (establish baseline)

- [ ] Confirm green baseline before any change: `npm test` → **134 passed**, `npm run check` → clean, `npm run build` → clean. (Verified clean 2026-06-09; reconfirm.)

## Commit convention

Per project rule: **propose** the message + staged files; **Malin commits via GitHub Desktop** as sole author — **no `Co-Authored-By` line**, no Claude attribution. Each task below ends by staging its files and proposing the commit; do not author the commit yourself unless Malin says so.

## File structure

| File | Responsibility |
|---|---|
| `public/icon.svg` | Interim flame mark (source SVG; also the SVG favicon). |
| `public/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon-180.png` | Rasterized icon set (generated, committed). |
| `scripts/gen-icons.mjs` | Dev-only one-off: `icon.svg` → the four PNGs via `sharp`. Never imported by the app. |
| `public/manifest.webmanifest` | Install metadata (name, colors, `display`, relative `start_url`/`scope`, icons). |
| `public/sw.js` | Hand-rolled service worker: precache shell, runtime cache-first assets, network-first navigations. |
| `index.html` | +3 `<head>` links (manifest, SVG icon, apple-touch) via `%BASE_URL%`. |
| `src/main.js` | +SW registration (production-only, base-aware). |
| `package.json` | +`sharp` devDependency, +`gen:icons` script. |

---

### Task 1: Interim flame icon + `sharp` rasterization pipeline

**Files:**
- Create: `public/icon.svg`
- Create: `scripts/gen-icons.mjs`
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-512-maskable.png`, `public/icons/apple-touch-icon-180.png` (generated)
- Modify: `package.json` (add `sharp` devDep + `gen:icons` script)

- [ ] **Step 1: Author the interim flame SVG**

Create `public/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Ignite flame">
	<rect width="512" height="512" fill="#0f0f10" />
	<path d="M256 96 C 322 188 382 246 382 332 C 382 404 326 440 256 440 C 186 440 130 404 130 332 C 130 246 190 188 256 96 Z" fill="#ff7a18" />
	<path d="M256 224 C 298 280 326 308 326 350 C 326 398 294 426 256 426 C 218 426 186 398 186 350 C 186 308 214 280 256 224 Z" fill="#ffd166" />
</svg>
```

Notes: full-bleed `#0f0f10` tile (so PNGs are opaque); two-tone warm flame (`#ff7a18` / `#ffd166`) for clear contrast on the dark splash/tile (spec a11y line). The flame sits within x≈130–382, y≈96–440 — inside the maskable safe zone (inner ~80% of 512 = 51–461px). **Colors/shape are placeholder** (the definitive icon is a tracked follow-up).

- [ ] **Step 2: Install `sharp` (dev-only)**

Run: `npm i -D sharp`
Expected: `sharp` added under `devDependencies`; `package.json` + `package-lock.json` updated; `node_modules/sharp` present.

- [ ] **Step 3: Add the `gen:icons` script to `package.json`**

In the `"scripts"` block, add (after `"check": "biome check ."`,):

```json
		"gen:icons": "node scripts/gen-icons.mjs",
```

- [ ] **Step 4: Write the rasterizer**

Create `scripts/gen-icons.mjs`:

```js
// scripts/gen-icons.mjs — one-off: rasterize public/icon.svg → the PWA PNG icon set.
// Dev-only (sharp is a devDependency, never shipped to the browser). Run: npm run gen:icons
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const SRC = "public/icon.svg";
const OUT = "public/icons";

mkdirSync(OUT, { recursive: true });

const targets = [
	{ file: "icon-192.png", size: 192 },
	{ file: "icon-512.png", size: 512 },
	{ file: "icon-512-maskable.png", size: 512 },
	{ file: "apple-touch-icon-180.png", size: 180, opaque: true },
];

for (const { file, size, opaque } of targets) {
	let img = sharp(SRC).resize(size, size);
	if (opaque) img = img.flatten({ background: "#0f0f10" });
	await img.png().toFile(`${OUT}/${file}`);
	console.log(`wrote ${OUT}/${file} (${size}x${size})`);
}
```

- [ ] **Step 5: Generate the icons**

Run: `npm run gen:icons`
Expected output: four `wrote public/icons/… (NxN)` lines; `public/icons/` now holds the four PNGs.

- [ ] **Step 6: Verify the PNGs exist + are correctly sized**

Run: `node -e "const s=require('sharp');for(const f of ['icon-192.png','icon-512.png','icon-512-maskable.png','apple-touch-icon-180.png'])s('public/icons/'+f).metadata().then(m=>console.log(f,m.width+'x'+m.height,m.format))"`
Expected: `icon-192.png 192x192 png`, `icon-512.png 512x512 png`, `icon-512-maskable.png 512x512 png`, `apple-touch-icon-180.png 180x180 png`.

- [ ] **Step 7: Biome clean**

Run: `npx biome check --write . && npm run check`
Expected: auto-formats `gen-icons.mjs` + `package.json`; final `npm run check` → "No fixes applied." (Biome skips the `.svg`/`.png` assets.)

- [ ] **Step 8: Stage + propose commit**

Stage: `public/icon.svg public/icons/ scripts/gen-icons.mjs package.json package-lock.json`
Proposed message: `feat(pwa): add interim flame icon + sharp rasterization pipeline`
(Malin commits via GitHub Desktop — no Co-Authored-By.)

---

### Task 2: Web app manifest

**Files:**
- Create: `public/manifest.webmanifest`

- [ ] **Step 1: Write the manifest**

Create `public/manifest.webmanifest`:

```json
{
	"name": "Ignite",
	"short_name": "Ignite",
	"description": "A small flame, kept going — an ADHD-friendly task app.",
	"start_url": "./",
	"scope": "./",
	"display": "standalone",
	"theme_color": "#0f0f10",
	"background_color": "#0f0f10",
	"icons": [
		{ "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
		{ "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
		{ "src": "icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
	]
}
```

Notes: `start_url`/`scope`/icon `src` are **relative** (`./`, `icons/…`) so they resolve against the manifest's URL → correct at `/` and `/ignite/` (spec invariant 2). Every referenced icon exists from Task 1 (spec invariant 6 — a missing one would fail SW install).

- [ ] **Step 2: Verify it's valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('public/manifest.webmanifest','utf8'));console.log('manifest OK')"`
Expected: `manifest OK`.

- [ ] **Step 3: Biome clean**

Run: `npm run check`
Expected: clean (Biome skips the unknown `.webmanifest` extension under the glob; baseline confirmed 2026-06-09).

- [ ] **Step 4: Stage + propose commit**

Stage: `public/manifest.webmanifest`
Proposed message: `feat(pwa): add web app manifest`

---

### Task 3: Service worker

**Files:**
- Create: `public/sw.js`

- [ ] **Step 1: Write the worker**

Create `public/sw.js` (all SW globals accessed via `self.` so Biome's linter stays clean):

```js
// public/sw.js — Ignite service worker (hand-rolled). Caches the app SHELL (code);
// task DATA already lives offline in IndexedDB and is never touched here.
const VERSION = "ignite-v1"; // bump to invalidate all caches (hygiene; online users self-heal)
const SCOPE = self.registration.scope; // base-correct, e.g. https://host/ignite/

const SHELL = [
	"./",
	"./manifest.webmanifest",
	"./icon.svg",
	"./icons/icon-192.png",
	"./icons/icon-512.png",
	"./icons/icon-512-maskable.png",
	"./icons/apple-touch-icon-180.png",
].map((path) => new URL(path, SCOPE).toString());

self.addEventListener("install", (event) => {
	event.waitUntil(
		self.caches
			.open(VERSION)
			.then((cache) => cache.addAll(SHELL))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		self.caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => self.caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;
	if (new URL(request.url).origin !== self.location.origin) return;

	// Navigations → network-first, fall back to the cached shell when offline.
	if (request.mode === "navigate") {
		const shell = new URL("./", SCOPE).toString();
		event.respondWith(
			fetch(request)
				.then((res) => {
					if (res.ok) self.caches.open(VERSION).then((cache) => cache.put(shell, res.clone()));
					return res;
				})
				.catch(() => self.caches.match(shell)),
		);
		return;
	}

	// Static assets (hashed /assets/*, icons, …) → cache-first, runtime-populate.
	event.respondWith(
		self.caches.match(request).then(
			(cached) =>
				cached ||
				fetch(request).then((res) => {
					if (res.ok && res.type === "basic") {
						self.caches.open(VERSION).then((cache) => cache.put(request, res.clone()));
					}
					return res;
				}),
		),
	);
});
```

Honors spec invariants: shell-only caching (1), scope-derived URLs (2), versioned cache + activate cleanup (3), `skipWaiting`+`claim` (4), GET + same-origin + network-first-nav / cache-first-assets + `res.ok` guards (5).

- [ ] **Step 2: Biome clean**

Run: `npx biome check --write public/sw.js && npm run check`
Expected: formats `sw.js` (tabs/line-wrapping); final check clean. If `noUndeclaredVariables` fires on any bare global, prefix it with `self.` (it should not — every SW global here is already `self.`-qualified).

- [ ] **Step 3: Stage + propose commit**

Stage: `public/sw.js`
Proposed message: `feat(pwa): add hand-rolled service worker (precache shell + runtime cache assets)`

---

### Task 4: Wire it up — `index.html` links + `src/main.js` registration

**Files:**
- Modify: `index.html`
- Modify: `src/main.js`

- [ ] **Step 1: Add the PWA links to `index.html`**

Insert three lines between the `description` meta and `<title>`. Replace:

```html
		<meta name="description" content="Ignite — a small flame, kept going." />
		<title>Ignite</title>
```

with:

```html
		<meta name="description" content="Ignite — a small flame, kept going." />
		<link rel="manifest" href="%BASE_URL%manifest.webmanifest" />
		<link rel="icon" href="%BASE_URL%icon.svg" type="image/svg+xml" />
		<link rel="apple-touch-icon" href="%BASE_URL%icons/apple-touch-icon-180.png" />
		<title>Ignite</title>
```

`%BASE_URL%` is Vite's placeholder → `/` in dev, `/ignite/` once `base` is set; keeps the links public + base-robust. The existing `theme-color` meta and stylesheet links are untouched.

- [ ] **Step 2: Add SW registration to `src/main.js`**

Replace the entire file contents:

```js
// main.js — app entry point.
// Service Worker registration arrives in the PWA milestone, once /sw.js exists.

import("./app.js");
```

with:

```js
// main.js — app entry point.

import("./app.js");

// Production builds only — `vite preview` + Pages register the worker; `vite dev` does not,
// so editing source during development never serves a stale cached module.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		const base = import.meta.env.BASE_URL; // "/" or "/ignite/"
		navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
	});
}
```

Honors spec invariant 10 (PROD-guarded + `serviceWorker`-guarded registration; `main.js` is the registration site).

- [ ] **Step 3: Biome clean**

Run: `npx biome check --write index.html src/main.js && npm run check`
Expected: clean.

- [ ] **Step 4: Existing tests still green**

Run: `npm run test:run`
Expected: **134 passed** (no model/util/view logic changed).

- [ ] **Step 5: Stage + propose commit**

Stage: `index.html src/main.js`
Proposed message: `feat(pwa): register service worker + link manifest and icons`

---

### Task 5: Build + offline acceptance (orchestrator-run E2E)

**Files:** none (verification). The base-path dry-run temporarily edits `vite.config.js` and reverts it.

> Run in the main session (Preview MCP E2E is interactive), matching the project's E2E pattern. Uses the **built** app via `vite preview` (the worker caches built, hashed assets — the dev server is not representative).

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: clean build; `dist/` contains `manifest.webmanifest`, `sw.js`, `icon.svg`, `icons/` (Vite copies `public/` verbatim) and `dist/index.html` has `%BASE_URL%` resolved to `/manifest.webmanifest`, `/icon.svg`, `/icons/apple-touch-icon-180.png`.

- [ ] **Step 2: Confirm public assets landed in `dist/`**

Run: `node -e "const f=require('fs');for(const p of ['dist/manifest.webmanifest','dist/sw.js','dist/icon.svg','dist/icons/icon-192.png','dist/icons/icon-512.png','dist/icons/icon-512-maskable.png','dist/icons/apple-touch-icon-180.png'])console.log(p, f.existsSync(p))"`
Expected: every line ends `true`.

- [ ] **Step 3: Serve the build**

Run (background): `npm run preview` → serves `dist/` (default `http://localhost:4173`). Point the Preview-MCP `launch.json` / `preview_start` at the **preview** server, not dev.

- [ ] **Step 4: Probe manifest + registration + activation (Preview MCP `preview_eval`)**

```js
// manifest applied
[...document.querySelectorAll('link[rel=manifest]')].map(l => l.href);
// registration scope + active state
await navigator.serviceWorker.ready.then(r => ({ scope: r.scope, state: r.active && r.active.state }));
```
Expected: one manifest link resolving to `…/manifest.webmanifest`; `state === "activated"`; `scope` ends with `/` (at base `/`, the origin root).

- [ ] **Step 5: Probe the precached shell**

```js
await caches.open('ignite-v1').then(c => c.keys()).then(ks => ks.map(r => new URL(r.url).pathname).sort());
```
Expected: includes `/`, `/manifest.webmanifest`, `/icon.svg`, and the four `/icons/*.png`.

- [ ] **Step 6: Offline boot (headline)**

Stop the preview server process (true offline — no network), then in the browser reload the page.
Expected: the app shell loads and boots from cache; the task list + IndexedDB data render. Re-probe: `caches.open('ignite-v1').then(c => c.match(new URL('./', location.href).toString())).then(Boolean)` → `true`. Then restart `npm run preview`.
(Note per spec: reliable offline is **second-online-load onward** — load the built app online once with the worker active before testing offline, so the hashed `/assets/*` are runtime-cached.)

- [ ] **Step 7: No console errors**

Via Preview MCP console logs: zero errors across registration, activation, navigation, offline reload.

- [ ] **Step 8: Base-path dry-run (de-risks item 3) — temporary, must revert**

Temporarily set `base` in `vite.config.js` — change:

```js
	build: {
		target: "es2022",
```

to:

```js
	base: "/ignite/",
	build: {
		target: "es2022",
```

Then: `npm run build` → `npm run preview` → open `http://localhost:4173/ignite/` and `preview_eval`:

```js
await navigator.serviceWorker.ready.then(r => r.scope);
```
Expected: scope ends with **`/ignite/`** (never just `/`) — confirms the `*.github.io` sibling-project safety (spec invariant 2 / Security finding). Also confirm `dist/index.html` references `/ignite/assets/…`, `/ignite/manifest.webmanifest`.

**Revert** `vite.config.js` (remove the `base` line) and rebuild: `npm run build`. Confirm `git diff vite.config.js` is empty.

- [ ] **Step 9: Final gate**

Run: `npm run test:run` (134 passed) · `npm run check` (clean) · `npm run build` (clean).

- [ ] **Step 10: Stage + propose commit (only if Step 8's revert or any fix changed a tracked file)**

If no tracked files changed in Task 5, there's nothing to commit (verification only). Otherwise stage the changed file(s); proposed message: `chore(pwa): <describe fix>`.

---

## Self-review (plan ↔ spec)

**Spec coverage:** manifest (Task 2) · hand-rolled SW install/activate/fetch (Task 3) · base-aware registration + `%BASE_URL%` links (Task 4) · interim icon set + pipeline (Task 1) · native install (no code = nothing to build) · `skipWaiting`/`claim` updates (Task 3) · offline + second-load semantics (Task 5 Step 6) · base-path/scope security (Task 5 Step 8) · all 10 invariants mapped to Task 1–4 code. Testing = build + Preview-MCP E2E (Task 5). ✅ no gaps.

**Placeholder scan:** every code/command step contains complete content; no TBD/TODO. ✅

**Type/name consistency:** `VERSION`/`SCOPE`/`SHELL`, the four icon filenames, `manifest.webmanifest`, and the `%BASE_URL%` links are identical across the manifest, `sw.js`, `index.html`, and the probes. ✅

**Open decision resolved:** icon rasterization = dev-only `sharp` (approved 2026-06-09).
