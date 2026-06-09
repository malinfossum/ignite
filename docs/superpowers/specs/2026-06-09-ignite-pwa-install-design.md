# PWA install — manifest + service worker — design spec

**Date:** 2026-06-09
**Phase:** v0.2 (PWA install — second of the mobile / PWA / Pages trio)
**Goal:** Make Ignite **installable** to the phone/desktop home screen and fully usable **offline**, by adding a hand-rolled **web app manifest** + **service worker**. Ignite's *data* is already offline (IndexedDB); this milestone makes the app *shell* — the HTML/CSS/JS — available offline and gives the app an installable identity. All existing behavior (desktop + mobile) is otherwise unchanged.

This is an **infrastructure** change, not a feature change. It adds two static files (`manifest.webmanifest`, `sw.js`) + an interim icon set under a new `public/` dir, three `<link>`s in `index.html`, and a service-worker registration block in `src/main.js` — filling the `/sw.js` breadcrumb already sitting there. **No model, view, or controller logic changes.** It is written **base-path-aware** so the GitHub Pages milestone (item 3) is a clean one-line drop-in.

**Settled scope decisions (from brainstorm 2026-06-09):**
- **Hand-rolled** manifest + `sw.js` (chosen over `vite-plugin-pwa`) — for the learning value, full control over caching + the `/ignite/` base path, zero new runtime deps, and because `main.js` already points at a hand-rolled `/sw.js`.
- **Hybrid caching** — *precache* the stable app shell at install; *runtime cache-first* for the content-hashed `/assets/*` (whose filenames we can't know at SW-author time without a build step).
- **Interim flame icon now** — a clean hand-authored SVG rasterized to the required PNG set, **stable filenames so the definitive icon is a pure drop-in later**. The real Ignite icon is its own dedicated effort (out of scope).
- **Native browser install** only — no custom in-app install button (reversible + already cross-platform-complete).
- **Updates** via `skipWaiting()` + `clients.claim()` — a new deploy takes over on next launch.
- **GitHub Pages base path stays item 3.** The SW + manifest are built base-aware *now* so item 3 reduces to setting `base: '/ignite/'`.

---

## Approach

**Selected: hand-rolled manifest + service worker, app-shell model, hybrid caching.**

A service worker is a script the browser runs in the background, separate from the page, that can **intercept network requests** and answer them from a **cache** — that's what makes a web app work offline. Ignite's worker caches the **app shell** (the document + its CSS/JS/icons) so the UI loads with no network; the task **data** is already offline because it lives in **IndexedDB** (untouched here). Two offline layers, cleanly separated: **SW = code, IndexedDB = data.**

Caching is **hybrid** because of how Vite builds the app:
- The **shell** has *stable* URLs — `index.html`, `manifest.webmanifest`, the icons — so the worker **precaches** them at `install` (a fixed list).
- The **app assets** are *content-hashed* — `assets/index-<hash>.js`, `assets/index-<hash>.css`, `assets/app-<hash>.js` — and their filenames change every build. A hand-rolled worker can't know them ahead of time, so it **runtime-caches** them **cache-first**: the first (online) load fetches them and stores them; every later load (including offline) serves them from cache; a new deploy's new-hash files are fetched once online and cached; old ones are cleared on version bump.

**Why hand-rolled:** Ignite is small with a stable shell, so the worker is ~55 lines of standard lifecycle code (no Workbox black box, no build dependency), and it teaches the real `install → activate → fetch` model. It also keeps **full control of the base path**, which matters because Pages serves under `/ignite/`.

**Rejected — `vite-plugin-pwa` (Workbox):** auto-generates the worker + a precache manifest of the hashed assets + handles the base path. Less code, industry-standard — but it makes the worker a generated black box and adds a build-time dependency. Against the learning goal and unnecessary for an app this size.

**Rejected — precache *everything* (hashed assets included) in the hand-rolled worker:** would require a build step that reads `dist/` and writes the hashed filenames into the worker — i.e. reinventing the plugin by hand. The hybrid (precache stable shell + runtime-cache hashed assets) gets ~the same offline result with zero build glue.

---

## Architecture

| Layer | Change |
|---|---|
| **Model / View / Controller** | **No changes.** PWA is infrastructure; no app logic is touched. Task data stays in IndexedDB, which is already offline. |
| **`public/` (new dir)** | Vite copies `public/` verbatim to `dist/` at the deploy root (base-prefixed). Holds the worker, manifest, and icons so they ship at **stable, predictable URLs** (not hashed). |
| **`public/manifest.webmanifest`** (new) | The install metadata: name, colors, `display: standalone`, **relative** `start_url`/`scope`, and the icon set. Relative paths → resolve against the manifest's own URL → correct at both `/` and `/ignite/`. |
| **`public/sw.js`** (new) | The hand-rolled worker (~55 LOC): `install` precaches the shell, `activate` cleans old caches + claims clients, `fetch` serves navigations network-first→shell and assets cache-first. Derives every cache URL from `self.registration.scope`, so it's base-correct with **zero edits** under `/ignite/`. |
| **`public/icon.svg` + `public/icons/*.png`** (new) | Interim flame mark: one source SVG + the rasterized PNG set (192, 512, 512-maskable, apple-touch-180). Stable filenames → real icon is a later drop-in. |
| **`index.html`** | **+3 `<link>`s** in `<head>`: `manifest`, SVG `icon`, `apple-touch-icon`, all via Vite's `%BASE_URL%` placeholder (base-robust). The existing `theme-color` meta + stylesheet links are **unchanged**. |
| **`src/main.js`** | **+SW registration** (~6 lines) inside the existing file — replaces the breadcrumb comment. Registers `${BASE_URL}sw.js` with `scope: BASE_URL` on `window.load`, guarded by `"serviceWorker" in navigator`. |
| **`vite.config.js`** | **Unchanged this milestone.** (`base: '/ignite/'` is item 3. The design is correct at the current default `base: '/'` and at `/ignite/` without further edits.) |

**The base-path mechanism (why item 3 stays one line):** Vite injects `import.meta.env.BASE_URL` (`/` in dev, whatever `base` is in prod) and replaces `%BASE_URL%` in `index.html`. `main.js` registers the worker at `${BASE_URL}sw.js`; the worker reads `self.registration.scope` and resolves all shell URLs against it (`new URL("./manifest.webmanifest", scope)`). So **nothing hardcodes `/` or `/ignite/`** — flipping `base` later is sufficient.

---

## Manifest — `public/manifest.webmanifest`

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

- **`start_url`/`scope` = `"./"`** (relative) — resolve against the manifest's location, so `/manifest.webmanifest` → scope `/`, and `/ignite/manifest.webmanifest` → scope `/ignite/`. No base hardcoding.
- **Icon `src` is relative** (`icons/icon-192.png`) — same base-robustness. PNGs live in `public/icons/`.
- **`display: "standalone"`** — launches in its own window, no browser chrome.
- **`theme_color` + `background_color` = `#0f0f10`** — matches the existing `<meta name="theme-color">`; drives the splash screen + status bar (dark-mode-first, no white flash).
- **`maskable` icon** — lets Android crop the icon into its adaptive shape (circle/squircle) without clipping the flame; the flame is drawn inside the maskable **safe zone** (content within the inner ~80% / 60–70% of the canvas).

---

## Service worker — `public/sw.js`

```js
// public/sw.js — Ignite service worker (hand-rolled). Caches the app SHELL (code);
// task DATA is already offline in IndexedDB and is never touched here.
const VERSION = "ignite-v1";                       // bump to invalidate all caches
const SCOPE = self.registration.scope;             // e.g. https://host/ignite/  (base-correct)

// Stable, known shell URLs — resolved against scope so they're base-correct at / and /ignite/.
const SHELL = [
  "./",                          // the app document (start_url / navigation fallback)
  "./manifest.webmanifest",
  "./icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon-180.png",
].map((p) => new URL(p, SCOPE).toString());

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())              // activate the new worker immediately
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())            // take control of open pages now
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;            // never cache mutations
  if (new URL(request.url).origin !== self.location.origin) return;  // same-origin only

  // Navigations → network-first, fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    const shell = new URL("./", SCOPE).toString();
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(shell, res.clone())); // fresh; never poison
          return res;
        })
        .catch(() => caches.match(shell))
    );
    return;
  }

  // Static assets (hashed /assets/*, icons, …) → cache-first, runtime-populate.
  event.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request).then((res) => {
        if (res.ok && res.type === "basic") {
          caches.open(VERSION).then((c) => c.put(request, res.clone()));
        }
        return res;
      })
    )
  );
});
```

**Registration — `src/main.js`:**

```js
// main.js — app entry point.
import("./app.js");

// Production builds only — `vite preview` + Pages register the worker; `vite dev` does not,
// so editing source during development never serves a stale cached module.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;         // "/" or "/ignite/"
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  });
}
```

- **Register on `load`, production only** (`import.meta.env.PROD`) — so the worker doesn't compete with first paint, and a cache-first worker never serves stale modules during `vite dev` (`vite preview` is a prod build, so offline testing still works).
- **`scope: base`** — the worker controls everything under the app's base. A worker at `${base}sw.js` has `${base}` as its default max scope, so **no `Service-Worker-Allowed` header is needed**.
- **`skipWaiting()` + `clients.claim()`** — the approved update behavior: a new deploy's worker activates immediately and controls open pages, so the fresh shell loads on next navigation/launch. Safe here because Ignite loads all its JS up front — **grep-verified 2026-06-09: the only dynamic `import()` in `src/` is `main.js`'s boot `import('./app.js')`; no post-boot lazy chunks** — so claiming + clearing the old cache can't strand a running page.
- **Network-first navigation** keeps the shell fresh when online and falls back to the precached shell when offline. **Cache-first assets** are safe because the assets are content-hashed (immutable). The `res.type === "basic"` guard caches only same-origin successful responses.

---

## Icons (interim)

- **`public/icon.svg`** — a hand-authored flame mark: dark tile `#0f0f10`, a clean geometric flame in Ignite's warm accent. Doubles as the modern SVG favicon.
- Rasterized to **`public/icons/`**: `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` (flame inside the maskable safe zone), `apple-touch-icon-180.png` (opaque dark tile — iOS dislikes transparency).
- **Stable filenames** — the definitive icon later overwrites these files only; manifest, links, and the worker's SHELL list don't change.
- **Rasterization method is a plan-phase decision** (see flags): prefer a no-new-dependency route (a tiny canvas/browser render, output committed); fall back to a one-off `sharp` dev-only script if needed. The generated PNGs are committed as static assets, so the *build* never depends on the rasterizer.
- **Malin reviews the interim SVG before it's locked.**

---

## Install & update UX

- **Install = native browser affordance.** Desktop Chrome/Edge: address-bar install icon. Android Chrome: install prompt. iOS Safari: Share → "Add to Home Screen" (iOS exposes no programmatic hook). No custom in-app button — `beforeinstallprompt` is Chromium-only and wouldn't remove the need for the iOS route anyway; adding a button later is purely additive (no SW/manifest change).
- **Update = `skipWaiting()` + `clients.claim()`** → a new deploy takes over on next launch. The polished alternative (suppress `skipWaiting`, detect `registration.waiting`, show an "Update available — reload" **toast** via Ignite's existing toast system, user-triggered) is a v0.2 candidate, not this milestone.

---

## Accessibility

PWA install + offline are **native, browser-driven** flows — this milestone adds no new in-app UI, so no new focus/keyboard/AT surface. The relevant a11y points are metadata quality:
- **`theme_color`/`background_color` = `#0f0f10`** → the splash + status bar match the dark UI (no jarring white flash for light-sensitive users — consistent with dark-mode-first).
- **Maskable icon** → the home-screen icon isn't clipped into an unreadable shape on Android.
- **Interim-icon contrast** → the flame must read clearly against the `#0f0f10` splash + home-screen tile (and sit within the maskable safe zone); a dark/low-contrast flame would be invisible on the dark background for low-vision users. Verify when authoring the SVG.
- **`name`/`short_name` = "Ignite"** → a clear, correct home-screen label.
- The existing app a11y (roles, arrow-key menus, focus management, `aria-current`) is **unchanged** — offline serves the same DOM.

---

## Edge cases

| Scenario | Behavior |
|---|---|
| First visit (online) | Page loads from network; the worker installs + precaches the shell (`./`, manifest, icons) and starts controlling. The hashed `/assets/*` are runtime-cached the first time the worker intercepts them. |
| Offline reload, after ≥1 fully-loaded online visit *with the worker in control* (typically second online load onward) | Navigation falls back to the precached shell; `/assets/*` served cache-first; app boots; IndexedDB data renders. Fully usable offline. |
| Navigation returns 5xx / captive-portal / redirect while online | The `res.ok` guard means it is **not** cached as the shell — the bad response reaches the page but never poisons the offline fallback. |
| iOS PWA not opened for ~7 days | iOS may evict the SW cache + storage → offline-readiness needs a recent online visit on iOS. **Accepted platform limitation** (not in-app-fixable). |
| New version deployed | New `sw.js` differs → installs → `skipWaiting` activates it → `activate` deletes `ignite-v(old)` and claims clients → next navigation serves the fresh shell + new-hash assets. |
| A SHELL URL 404s at install (e.g. a missing icon) | `cache.addAll` rejects → `install` fails → worker doesn't activate (old one keeps serving). **Mitigation:** the SHELL list must list only files that exist in `dist/`; verified in the E2E build test. |
| Page open on v1 while v2 activates and clears v1 cache | No lazy chunks load after boot in Ignite, so the running page already has its code; nothing is stranded. Worst case is cosmetic and rare. |
| POST / non-GET request, or cross-origin request | Worker ignores it (returns early) → normal network behavior; never cached. |
| Hard refresh / "Update on reload" in DevTools | Standard SW bypass works; the network-first navigation also self-heals a stale shell whenever online. |
| Run under `/ignite/` (after item 3) | `BASE_URL`/`%BASE_URL%`/`self.registration.scope`/relative manifest paths all resolve to `/ignite/…` automatically — no code change. |
| Browser without service workers | `"serviceWorker" in navigator` guard skips registration; the app runs exactly as today (online-only). Progressive enhancement. |

---

## Invariants (do NOT simplify away)

1. **The worker caches the app SHELL (code) only — never IndexedDB / task data.** The two-layer offline story (SW = code, IndexedDB = data) is the design; do not route app data through the Cache API.
2. **Nothing hardcodes the base path.** Registration uses `import.meta.env.BASE_URL` for both the URL and `scope`; `sw.js` derives every cache URL from `self.registration.scope`; the manifest uses relative `./`; `index.html` links use `%BASE_URL%`. This is what makes item 3 a one-line change — keep it. **Security corollary:** `scope` MUST equal `BASE_URL` (`/ignite/`), **never root** — on the shared `*.github.io` origin a root-scoped worker would intercept your *other* Pages projects. A worker at `/ignite/sw.js` can't exceed `/ignite/` by construction; never add a `Service-Worker-Allowed` header to widen it.
3. **Cache is versioned (`ignite-v1`) and `activate` deletes every non-current cache.** Never skip the cleanup. **A `VERSION` bump is *not* what delivers updates to online users** — network-first navigation already self-heals them (a fresh `index.html` references new-hash assets, which miss the cache and get fetched + cached). The bump's real jobs are **cache hygiene** (without it, old-hash assets accumulate unboundedly across deploys) and forcing **offline** users to refresh on their next online launch.
4. **`skipWaiting()` + `clients.claim()` are paired and intentional.** If a future "update ready" toast is added, REMOVE `skipWaiting` and gate activation on the user action instead — never ship both (that reintroduces the surprise-swap risk skipWaiting otherwise accepts).
5. **`fetch` handler: GET + same-origin only; navigations network-first→shell-fallback; assets cache-first.** Do **not** cache-first navigations (would pin a stale shell and never update); do not cache non-GET or cross-origin.
6. **The SHELL precache list contains only files guaranteed to exist in `dist/`.** A missing entry fails `install` for everyone. Adding a shell file ⇒ add it to SHELL; removing one ⇒ remove it.
7. **`base.css` + `design-system/` untouched.** CSS still bundles via Vite exactly as today; the worker caches the built `/assets/*.css`, it does not reference `base.css`/`main.css` by name.
8. **Icons use stable, unhashed filenames** (`icon-192.png`, …) so the definitive icon is a drop-in overwrite. Never bake build hashes into icon names.
9. **No new client/runtime dependency.** The worker + manifest are hand-rolled, zero deps shipped to the browser. (A `sharp` icon-gen script, if chosen, is **dev-only** and never imported by the app.)
10. **`src/main.js` stays the registration site** (fills its own breadcrumb); registration is guarded by **`import.meta.env.PROD && "serviceWorker" in navigator`** — unsupported browsers degrade to online-only, **and `vite dev` never runs the worker** (no stale-module caching during development; `vite preview` + Pages still register it).

---

## Files touched (estimated)

| File | LOC | Note |
|---|---|---|
| `public/manifest.webmanifest` | +18 | **new** — install metadata |
| `public/sw.js` | +55 | **new** — hand-rolled service worker |
| `public/icon.svg` | +1 file | **new** — interim flame source (also SVG favicon) |
| `public/icons/*.png` | 4 assets | **new** — 192 / 512 / 512-maskable / apple-touch-180 (generated, committed) |
| `index.html` | +3 | manifest + SVG icon + apple-touch links (`%BASE_URL%`) |
| `src/main.js` | +6 | SW registration (replaces breadcrumb) |
| `scripts/gen-icons.mjs` *(only if `sharp` route)* | +~20 | **dev-only**, one-off; not shipped, not a build dep |
| **Total** | **~80 LOC + assets** | **0 new unit tests** — 134 existing stay green |

---

## Testing

### Unit (Vitest)
- **None new.** A service worker is an event-driven, side-effectful environment (install/activate/fetch, Cache API, network), not a pure-function seam — unit-testing it means mocking the worker global + Cache API, which tests the mocks, not real offline behavior. The manifest is static JSON. Consistent with the project convention (TDD only on pure logic; views/infra verified manually). The **134 existing tests must stay green** (no model/util changes). If a pure helper emerges (e.g. a cache-decision predicate), TDD it.

### Manual / Claude Preview MCP E2E — against the **production build**
The worker caches **built, hashed** assets, so tests run against `dist/`, not the dev server:
`npm run build` → `npm run preview` (serves `dist/` on localhost) → drive with Preview MCP (`localhost` is a secure context, so SW + install work with no hosting).

- **Manifest:** `/manifest.webmanifest` is valid JSON with required fields; `<link rel="manifest">` resolves; DevTools/`navigator` shows it applied.
- **Registration + activation:** `navigator.serviceWorker.ready` resolves; the active worker reaches `activated` (via `preview_eval`).
- **Shell precached:** after activation, `caches.open('ignite-v1')` contains `./` + manifest + all icons (probe `cache.keys()`).
- **Offline serves the app (headline):** go offline → reload → the shell loads and the app boots.
- **Data survives offline:** existing tasks still render offline (proves SW = code, IndexedDB = data).
- **Update flow:** bump `VERSION` (or change a shell file) → rebuild → confirm the new worker activates on next launch and old caches are deleted.
- **Unsupported-browser path:** registration guard no-ops; app runs online-only with no errors.
- **Base-path dry-run (de-risks item 3):** temporarily set `base: '/ignite/'`, build + preview, confirm registration, scope, manifest, and shell all resolve under `/ignite/` with no code change; then revert. **Assert `registration.scope` ends in `/ignite/` (never `/`)** — a root scope on `*.github.io` would hijack sibling projects.
- **No console errors throughout.**
- **Honest caveat** (per v0.2 E2E lessons): emulated offline + the install prompt are awkward to drive headlessly and `preview_screenshot` has hung before — where the tool can't drive it, verify via `preview_eval` probes of `caches`/`serviceWorker` state + SW code-reading, and call out anything only truly confirmable once on Pages / a real phone.
- **Final gate:** `npm test` green · Biome clean · `npm run build` clean.

---

## Out of scope (tracked separately)

- **The definitive Ignite icon** — done properly with real art, its own dedicated effort (worth the visual companion + iteration). Interim flame + stable filenames make it a pure asset swap. (Follow-up chip.)
- **GitHub Pages deploy (item 3)** — set `base: '/ignite/'`, add an Actions build→deploy workflow, verify on the `github.io` origin. The PWA is built base-aware so item 3 stays small.
- **Custom in-app install button** (`beforeinstallprompt`) — additive later; native install suffices.
- **"Update available" toast** — the polished update UX; deferred since `skipWaiting`+`claim` already updates correctly.
- **Push notifications / background sync / periodic sync** — a different feature class (needs a server + push service + permission flows); not part of "installable + offline," and arguably never needed for a local-first task app.
- **`apple-mobile-web-app-*` meta polish** for older iOS standalone quirks — optional; fold in during planning only if a real iOS test shows it's needed.

## Plan-phase flags (notes for the plan-writer)

- **Icon rasterization** — decide the method and, if it needs a package (`sharp`), **ask Malin before installing** (CLAUDE.md). Prefer the no-new-dependency route (canvas/browser render) for the interim set; commit the resulting PNGs as static assets so the build has no rasterizer dependency.
- **`%BASE_URL%` link handling** — confirm Vite leaves the `manifest`/`icon`/`apple-touch-icon` links as plain public references after replacing `%BASE_URL%` (i.e. doesn't try to bundle/hash them). Reference public assets via `%BASE_URL%`, not bare leading-slash absolutes.
- **`vite preview` port** — confirm the default (4173) and point the Preview-MCP `launch.json` at the *preview* (built) server, not dev, for offline testing.
- **`new URL("./", scope)` precache key vs the navigation request URL** — verify the navigation fallback `caches.match(shell)` hits the precached `"./"` entry for hash-routed navigations (the path is always the scope root; the `#…` fragment isn't sent to the network). Confirm in the offline E2E.
- **`install` atomicity** — `cache.addAll(SHELL)` is all-or-nothing; double-check every SHELL URL exists in `dist/` (especially the four icons) before shipping, or install fails silently for users.
- **Favicon fallback** — SVG `icon.svg` covers modern browsers; decide whether a `favicon.ico` is worth adding for very old ones (likely skip).
- **First-visit offline vs. dynamic `import('./app.js')`** — `app.js` is a *dynamically*-imported chunk, so its hashed URL is **not** in `index.html` for an install-time parser to find. Reliable offline is therefore **second-online-load onward** (runtime cache-first fills the asset cache once the worker controls fetches). True first-visit offline would require making `app.js` a **static** import (so it lands in the precacheable shell) or scanning JS bundles — both deliberately deferred; second-load offline is fine for an installed app. Revisit only if first-launch-offline becomes a real need.
- **Stress-test:** done (2026-06-09) — see "Stress-test outcome" below; all changes folded in. Ready for `writing-plans`.

## Stress-test outcome (2026-06-09)

4-lens pass (security / privacy / accessibility / loopholes): **0 🔴, 3 🟠, 3 🟡 — converged in one pass; all folded in (+1 issue surfaced while folding).**
- **Privacy ✅ + Security ✅ (beyond scope):** no new network egress and no new `innerHTML`/user-input boundary; the cache holds only the public app shell, never IndexedDB / task data (invariant 1).
- **🟠 ×3:** (1) *SW scope on a shared `*.github.io` origin* — must equal `BASE_URL`, never root, or it hijacks sibling Pages projects → named in invariant 2 + asserted in the base-path E2E. (2) *Navigation cached without `res.ok`* — a 5xx / captive-portal / redirect could poison the offline shell → `if (res.ok)` guard + edge-case row. (3) *"Offline after one visit" optimism* — hashed assets runtime-cache only once the worker controls fetches → corrected to second-load-onward (the dynamic `app.js` chunk can't be precached without a static import or a JS-bundle scan; deferred — see plan flag).
- **🟡 ×3:** `VERSION`-bump semantics (online users self-heal via network-first; the bump is hygiene + offline refresh) → invariant 3 reworded; interim-icon contrast on the `#0f0f10` splash/tile → a11y line added; iOS ~7-day SW-cache eviction → edge-case row + accepted limitation.
- **+1 surfaced while folding (8th change):** registering the worker in `vite dev` would cache-first stale modules during development → registration gated on `import.meta.env.PROD` (so `vite preview` + Pages still register it, `vite dev` doesn't).
- **Considered and rejected:** `skipWaiting` stranding a lazy chunk (grep-verified — only the boot `import('./app.js')` exists); offline-indicator UI (app works identically offline); `display:standalone` back-chrome (the v0.2 shell always offers a way home); shared-device discoverability (IndexedDB was already local pre-PWA); `cache.addAll` install atomicity (already named in the spec).

No open questions.
