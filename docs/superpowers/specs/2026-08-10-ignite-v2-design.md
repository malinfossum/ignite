# Ignite v2 — visual redesign

**Date:** 2026-08-10
**Status:** design approved, plan not yet written
**Baseline:** v0.3.0 + cascade focus routing (`4fc05df`) — 174 tests, Biome clean, build clean

Ignite v2 adopts the workbench design system, switches to the `ignite` brand palette,
adds a light theme with a user-facing toggle, and re-lays-out the Today view and sidebar.
It is a restyle plus layout change. No new features beyond the theme toggle and an emoji
picker for the area icon field that already exists.

---

## 1. Why

v1's visual layer is eight custom properties and 25 KB of hand-written CSS. It works, but
the app reads as unfinished: a 960px column of near-weightless rows floating in a large
dark void, one type size at one weight, and a Today view whose `<h1>` is visually hidden,
so the home screen has no visible title at all.

The workbench design system already ships an `ignite` palette tuned for this app — flame
accent on a greyer, wider-spread OLED ground, Bricolage Grotesque headings over Hanken
Grotesk body. Adopting it replaces bespoke values with a maintained system and gives the
app a type identity it has never had.

## 2. Decisions

| Decision | Choice | Rejected |
|---|---|---|
| Scope | Restyle **and** layout | Restyle only; full rethink |
| Palette | Workbench design system, `data-palette="ignite"` | Bespoke palette |
| Light mode | Full toggle, shipped in v2 | Dark only; follow-OS with no toggle |
| Toggle location | A control in the sidebar footer | A `#settings` route; hidden in a menu |
| Area icons | Curated emoji grid picker | Free text input; inline SVG set |
| System delivery | Full `extract.mjs`, unmodified | Trimmed fonts; hand-picked subset |

### 2.1 Why not a `#settings` route

A settings surface is real scope — new route, new view, focus management, mobile drawer
behaviour — and it is the blocker for the deferred `/` capture shortcut (a single-character
shortcut needs a reachable disable toggle under WCAG 2.1.4 Level A). The theme toggle is a
*visual* control and ships with the visual redesign. The settings surface remains its own
future spec and absorbs this control when it lands.

### 2.2 Why fonts are not trimmed

The extracted `assets/fonts/` carries nine families; Ignite uses two. Deleting the other
seven would save repo and `dist/` weight but permanently drift the extracted copy from
canonical, so `extract.mjs --check` would report drift forever. Drift-free wins.

**Corrected during implementation.** This section originally justified that with "an unused
`@font-face` never downloads, so the runtime cost of keeping them is zero." That is true of
the browser but false of the service worker: §5's precache walks every `url()` in the bundled
CSS, so it would pull all **15 emitted `.woff2` files (236,600 bytes)** on install, of which
Ignite renders **4 (72,096 bytes)** — 164 KB of dead weight per install.

The fix keeps the extract pristine and filters at the point of cost instead: `sw.js` holds a
`FONT_FAMILIES` allowlist (`bricolage-grotesque`, `hanken-grotesk`) and precaches only those.
The filter applies to font files only — other same-origin `url()` assets still precache —
and anything omitted still resolves through the runtime cache-first handler.

---

## 3. How the system lands

Run the workbench extractor:

```
node tools/extract.mjs design-system C:\Users\Nugget\Documents\Development\GitHub\repos\ignite
```

This creates `ignite/design-system/` containing `tokens/`, `base/`, `primitives/`,
`components/`, `compositions/`, `utilities/`, `theme/`, `assets/` (per `extract.json`;
`gallery/`, `sandbox/`, `docs/` are excluded).

**`design-system/` is read-only in this repo.** Never edit the extracted copy. Anything that
needs changing is either a local override in `main.css` or an issue filed against workbench.

### 3.1 Wiring

- `biome.json` — add `design-system/` to the ignore list.
- `index.html` — `<html lang="en" data-palette="ignite">`.
- Root `base.css` — **deleted.** Superseded by `design-system/base/reset.css` +
  `base/base.css`. Its `<link>` at `index.html:12` is removed.
- `main.css` — becomes the composition root. Imports first, in the system's own layer order,
  then Ignite's own styles:

```css
@import url("./design-system/tokens/index.css");
@import url("./design-system/base/reset.css");
@import url("./design-system/base/base.css");
@import url("./design-system/primitives/container.css");
@import url("./design-system/primitives/stack.css");
@import url("./design-system/primitives/cluster.css");
@import url("./design-system/components/index.css");
@import url("./design-system/utilities/index.css");
```

Two deliberate omissions:

`compositions/` is **not** imported. `.app-shell` and `.main-shell` are page patterns
(`--section-space` block padding of 3–5rem), wrong for a task app.

`primitives/index.css` is **not** imported either — it pulls in `primitives/sidebar.css`,
whose `.sidebar-layout` breaks at `max-width: 62rem`: both a max-width query, which violates
the project's mobile-first rule, and the wrong breakpoint (Ignite's drawer flips at 768px).
Ignite keeps its own app shell. The three primitives that are actually useful are imported
individually instead; `grid`, `split` and `center` have no consumer here.

Vite bundles and hashes the whole `@import` chain into one `/ignite/assets/index-*.css`,
exactly as it already does for `base.css` + `main.css` today.

---

## 4. Theme

### 4.1 Two writers, one owner

`settings.theme` holds the user's **choice** — `"system"` | `"dark"` | `"light"` — on the
existing settings model (`src/model/settings.js`), added to `DEFAULTS` as `theme: "system"`
with a `setTheme` method alongside `setSidebarCollapsed`.

The choice is distinct from the **resolved** theme (`"dark"` | `"light"`), which is what
reaches the DOM. `"system"` resolves against `prefers-color-scheme`; the other two resolve to
themselves. Keeping the two vocabularies separate is what makes the control reversible —
see §4.4.

`localStorage["ignite:theme"]` is a **paint-time cache only**, holding the same choice.
IndexedDB is async and cannot be read before first paint; localStorage is synchronous and
can. Without it, the app paints dark and then flips to light on boot for a light-theme user.

Flow:

1. An inline `<head>` snippet reads `localStorage["ignite:theme"]`, resolves it against
   `prefers-color-scheme`, and sets `data-theme` on `<html>` before any stylesheet is parsed.
2. The controller, on boot, reads `settings.theme`. If the resolved result disagrees with
   what the snippet applied — a restored profile, a cleared localStorage, a second device —
   the controller corrects `data-theme` and rewrites the cache.
3. Every change writes the model first, then mirrors the choice to localStorage, then updates
   `data-theme` and the `theme-color` meta.

The model is authoritative; localStorage is derived and disposable.

**Second persistence surface.** Until v2, everything Ignite stored lived in IndexedDB, which
is what lets the app say your data stays on your device in one place. `localStorage["ignite:theme"]`
is now a second one. It is not sensitive, but any future "delete all my data", export, or
reset feature must clear it too, or it will be quietly missed.

### 4.2 The init snippet

`design-system/theme/theme-init-snippet.html` is **adapted, not copied verbatim**. Canonical
reads unprefixed `"theme"` and `"palette"`, and defaults palette to `"default"`. Ignite pins
the palette (it is not user-switchable) and uses a prefixed key:

```html
<script>
	(function () {
		var root = document.documentElement;
		root.dataset.theme = localStorage.getItem("ignite:theme") || "dark";
		root.dataset.palette = "ignite";
	})();
</script>
```

Placed in `<head>` **before** the stylesheet links.

`design-system/theme/theme-toggle.js` is **not shipped**. It writes localStorage directly,
which would bypass the settings model and break the single-owner rule. The controller owns
the toggle.

### 4.3 theme-color

`index.html:6` currently hardcodes `<meta name="theme-color" content="#0f0f10">`. The
controller updates its `content` on every theme change:

- dark → `#0b0a0a` (the `ignite` palette's `--surface-1`)
- light → `#f6f8fa` (the base light `--surface-1`)

### 4.4 The sidebar control

A footer row in the sidebar, below "＋ New area", separated by a hairline:

```html
<button class="sidebar__theme" type="button" data-action="cycle-theme">
	<span class="sidebar__theme-icon" aria-hidden="true">☾</span>
	<span class="sidebar__theme-text">Theme: system</span>
</button>
```

**It cycles three states — system → light → dark → system — not two.** A two-state toggle
would be a one-way door: `theme` starts at `"system"`, and a binary control can only ever
write `"dark"` or `"light"`, so the first tap would permanently end OS-following with no path
back short of clearing both localStorage and IndexedDB. Introducing a default the user cannot
return to is worse than not having it.

The accessible name is the visible text and changes with the state — "Theme: system",
"Theme: light", "Theme: dark". This is the standard cycling-button pattern; screen readers
announce the focused control's new name after activation.

Deliberately **not** used here:

- `aria-pressed`, which describes a binary on/off and cannot express three states.
- `aria-live` on the value, which would be a live region containing the focused element —
  the same trap documented for the toast, where focus inside a live region suppresses
  re-announcement in some screen readers.

In the 48px collapsed rail the text takes `.sr-only` rather than `display: none`, so the
control keeps its accessible name while rendering icon-only — matching how the rest of the
sidebar collapses.

It sits **outside** the area `<ul>`, so it does not enter area keyboard navigation, and it
does not disturb `.sidebar__home` — the focus target the cascade-delete routing lands on.

---

## 5. Fonts and the service worker

**This is the highest-risk part of v2.**

The `ignite` palette sets `--font-sans: "Hanken Grotesk"` and `--font-display:
"Bricolage Grotesque"`. Vite emits the four required `.woff2` files (Bricolage 600/700,
Hanken 400/500, ~70 KB total) into `/ignite/assets/`, referenced from the **bundled CSS**.

`public/sw.js`'s `install` handler precaches by fetching `index.html` and regexing it for
`src|href="…/assets/…"`. Fonts appear in neither a `src` nor an `href` attribute in that
document — they are `url()` references inside a stylesheet. **They will not be precached.**
An installed, offline Ignite would silently fall back to system-ui, losing exactly the type
identity this redesign exists to add.

### 5.1 Fix

Extend the existing parse one level deeper. After `install` has collected the asset URLs from
`index.html`, fetch each `.css` among them, regex its `url(...)` references, resolve them
against the stylesheet URL, and add them to the precache list. Same technique, same file, one
extra hop.

The runtime cache-first `fetch` handler stays as the fallback — it is not sufficient on its
own (the browser serves `<script crossorigin>` and `<link>` from memory cache on reload,
bypassing the worker), which is why the precache exists in the first place.

### 5.2 Cache version

Bump `ignite-v1` → `ignite-v2`. The existing `activate` handler prunes non-current caches, so
the old shell is dropped on upgrade.

`skipWaiting()` + `clients.claim()` stay paired. If an update toast is ever added, `skipWaiting`
must be dropped — unchanged from v1.

### 5.3 Verification

This must be verified against a **real build** via the `ignite-preview` launch config
(`npm run preview`, :4173) — the service worker is PROD-guarded and does not register under
`vite dev`. Reasoning about it is not sufficient. Test: load, go offline, hard reload, confirm
the rendered font is Bricolage/Hanken and not system-ui.

---

## 6. Overrides Ignite must add

The design system is built for documents. Ignite is an app. These are layer-6 project-UI
overrides in `main.css`, placed after the imports.

### 6.1 List text colour — required

`design-system/base/base.css` sets `p, li { color: var(--text-muted) }`.

Ignite renders `<li class="task">` (`src/views/task.js:43`) and
`<li class="sidebar__area-row">` (`src/views/sidebar.js:510`). Dropped in unmodified, **every
task title and every area name in the app turns grey.** This is the most consequential
collision in the whole migration.

Fix: reset the task title and area name to `var(--text)` explicitly.

### 6.2 Heading scale — required

`base.css` sets `h1 { font-size: var(--text-4xl) }` — `clamp(2.5rem, 5vw, 3.75rem)`, up to
60px. Area pages carry a visible `<h1>`, and Today gains one in v2. At 60px it would dominate
a task list.

Fix: app-scoped `h1` at `--text-2xl`, `h2` at `--text-xl`.

### 6.3 Border temperature — light theme only

**Corrected during implementation.** This section originally claimed the `ignite` palette
inherits cool blue-grey borders and muted text from base `colors.css`, and prescribed a local
override for both themes. That was wrong: `ignite.css`'s own header points at
`tokens/palettes/_oled.css`, a shared foundation the original reading missed, and it
**already** warms the dark ground for this palette:

```
--text: #faf9f5;  --text-muted: #beb9ad;  --text-faint: #8a8478;
--border: #2b2622;  --border-strong: #3a342c;  --border-soft: #1c1814;
```

So no dark override is needed, and none ships. Adding one would only shadow the design
system with near-identical numbers — exactly the drift the read-only policy exists to
prevent.

`_oled.css` has **no light-theme block**, though. Under `[data-theme="light"]` the tokens
fall back to base `colors.css`, which is cool blue-grey (`--border: #d8dee4`,
`--text-muted: #52606d`). So Ignite ships one override, light only:

```css
[data-theme="light"][data-palette="ignite"] { /* warm borders + muted text */ }
```

Verified live: dark resolves to `#2b2622` / `#beb9ad` from `_oled.css`; light resolves to the
local warm values. No workbench issue is warranted — canonical is correct as it stands.

### 6.4 `.visually-hidden` is retired

`utilities/index.css` ships `.sr-only`. Ignite defines its own `.visually-hidden` in
`main.css:24`, used in exactly two places — `src/views/today.js:383` and `:403`, both of them
Today's `<h1>`.

v2 makes that heading visible (§7.1), which leaves `.visually-hidden` with no consumers. So
it is **deleted from `main.css`**, and anything in v2 that needs the behaviour uses the
system's `.sr-only` instead — specifically the theme control's label in the collapsed 48px
rail, which must stay in the accessible name tree while hidden visually.

---

## 7. Layout changes

### 7.1 Today view (`src/views/today.js`)

Today is the app's home screen and currently has no visible heading — the `<h1>` is
`.visually-hidden` (added in the 2026-06-24 a11y pass to satisfy axe `page-has-heading-one`).

- **Visible `<h1>Today</h1>`** in the display face, with the date beneath in
  `--text-faint`. The `.visually-hidden` class comes off both the empty (`:383`) and
  populated (`:403`) branches; axe's `page-has-heading-one` is satisfied *better* by a real
  heading than a hidden one. Area pages already have a visible `<h1>`, so this makes the two
  consistent. Both branches must keep an `<h1>` — the empty state is a real route.
- **Group headings** move from letter-spaced caps at 9px to sentence case in the display
  face, with the count as a separate muted span. `renderGroup` currently builds
  `headingText` as `` `${heading} (${tasks.length})` `` — split into heading plus
  `<span class="group__count">`.
- **Rows sit in a bordered surface.** `.group__list` gets `--panel-bg`, a border,
  `--radius-md`, and hairline separators between rows. This is the change that fixes the
  floating-in-a-void reading, more than any colour does.
- **NEXT card** gains a full border with an accent tint, replacing the single left rule, plus
  its relative time label. (Single-sided borders and rounded corners do not combine well; a
  full border is both better-looking and simpler.)
- **Empty state** — `"You're clear. Nice."` keeps its copy, restyled.

### 7.2 Content width

`--main-max-width` drops from 960px to the system's `--reading-width` (42rem / 672px), so
content does not strand across a wide desktop viewport.

### 7.3 Sidebar (`src/views/sidebar.js`)

- Active area row gets an accent-tinted background and accent count, replacing the current
  undifferentiated row.
- Area icons render from the existing `icon` field (see §8).
- Theme control in the footer (§4.4).

### 7.4 Everything else

`area.js`, `section.js`, `task.js`, `capture.js`, `toast.js`, `move-picker.js`,
`recurrence-dialog.js`, `topbar.js` — retokenized to system values (`--space-*`,
`--radius-*`, `--surface-*`, `--duration-*`). Structural markup unchanged except where §9
explicitly permits.

The toast adopts the system's `.toast` visual tokens but keeps Ignite's own positioning, its
`--capture-h` lift, and its `aria-live` structure (§9).

---

## 8. Emoji picker

`areas` already has an `icon` field. `src/model/areas.js:10` seeds Focus with `"🔥"`;
`create({ name, icon = "", critical })` accepts one; `sidebar.js:482` and `:513` already
render `${escapeHtml(area.icon || "•")}` with `aria-hidden="true"`. The bullets visible in v1
are the fallback — every area except Focus simply has `icon: ""`.

So this needs **only a picker UI**. No model change, no DB migration (the field is not
indexed), no render work.

- A new small view: a grid of 24 curated emoji plus a "none" option that clears back to the
  dot fallback.
- Surfaced in the area create flow and the area rename flow in `sidebar.js`.
- Writes through the existing `areas.update(id, { icon })`.
- The `aria-hidden="true"` on the icon span in the sidebar row **stays** — the area name
  carries the accessible meaning there, and emoji announce inconsistently across screen
  readers. Inside the picker each option needs its own name, so labels are written out.

### 8.1 It is a radio group, not 25 toggles

An area has exactly one icon, so this is single-select. The picker is
`role="radiogroup"` with `role="radio"` + `aria-checked` on each option — **not** 25 buttons
with `aria-pressed`, which would present one choice as 25 independent toggles.

**Roving tabindex, one tab stop.** The selected option carries `tabindex="0"` and every other
carries `tabindex="-1"`; arrow keys move between them, reusing the `nextEnabledIndex` /
`firstEnabledIndex` / `lastEnabledIndex` helpers already in `src/utils/menu-keyboard.js`.

Without this the picker sits in the natural tab order inside the rename row, putting **25 tab
stops between the rename input and the next control**. The rename flow is keyboard-first; 25
stops makes it hostile.

### 8.2 Focus must survive the re-render

Picking an icon writes the model, which notifies, which re-renders the sidebar.
`src/utils/rename-input.js` then re-focuses the rename input on every render, so without
intervention each pick ejects the user from the picker back to the text field — unusable for
keyboard selection.

A `pendingFocusAreaIcon` flag on the sidebar view, consumed last in the render and cleared
unconditionally, restores focus to the picked option. **The drain rule in §9 applies:** a
single write's notify-render is still in flight when `await areas.update()` resolves, so the
flag must be set after a draining `applyState()`, never before.

### 8.3 Targets and columns

Options are 44px minimum, per the design system's touch-target rule and matching the task
rows.

**Corrected during implementation.** This section originally specified a fixed count — 4
columns at the mobile baseline, 6 from `min-width: 768px`. That is wrong in both directions,
because **the desktop sidebar (240px) is narrower than the mobile drawer (`min(80vw, 300px)`)**,
so "more columns on wider screens" is backwards here. Six 44px columns fit neither.

The grid uses `repeat(auto-fit, minmax(2.75rem, 1fr))` instead, packing as many 44px targets
as the container actually has room for: **3 columns in the desktop sidebar, 4 in the mobile
drawer**, verified live. It also stays correct if the sidebar width ever changes.

The picker is a flex child of the editing row, so it also needs `flex: 1 0 100%` — the row
wraps, and without a full basis the picker lands on its own line but shrinks to content,
collapsing the grid to one column.

### 8.4 Escape

Escape from within the picker exits the rename, exactly as Escape from the rename input does.
The sidebar's existing Escape tail already orders rename → menu → drawer; the picker adds no
new level. Stated explicitly because unstated precedence is how precedence bugs ship.

---

## 9. Invariants

These class names and structures are load-bearing, not cosmetic. Full detail lives in this
project's `invariants.md` memory file, which must be read before touching `src/`, `main.css`,
`index.html`, `sw.js`, or `vite.config.js`. The ones this work can plausibly break:

- **Focus targets** — `.section__menu-btn`, `.area__add-section`, `.sidebar__home`,
  `.topbar__menu`. The cascade-delete focus routing lands on these by class. Restyle them;
  never rename them.
- **The drain rule.** `notify()` is synchronous and does not await its subscribers, so when
  an `await`ed model write resolves, that write's own notify-render is still queued — and the
  caller's continuation, being a microtask, beats it. Any new code that sets a focus flag
  after a write must **drain first**: `await write(); await applyState(); setFlag();
  await applyState();`. It looks redundant and is the only reason cascade focus routing
  works. This binds `pendingFocusAreaIcon` in §8.2.
- **`--capture-h`** stays the single source for both `#main` bottom padding and the toast
  lift. New spacing must not introduce a second source.
- **Toast `aria-live`** stays on `.toast__message`, never on `.toast`. Focus inside a live
  region suppresses re-announcement in some screen readers.
- **`tabindex="-1"`** stays on every `role="menuitem"` across all four view files.
- **`inert`** target lists stay exactly as they are: 3 elements for the drawer
  (`topbarRoot`, `mainEl`, `toastRoot` — never the scrim), 4 for the recurrence dialog
  (those plus `sidebarRoot`).
- **`commit-*-rename`** is read only by each view's `bindKeys` Enter handler. Never wire it
  as a `bindActions` click — it would commit and exit on every cursor-positioning click.
- **Scrim** is a CSS-class route (`body.is-drawer-open #scrim`). The controller never touches
  `scrimEl.hidden`.
- **Closed drawer** stays `visibility: hidden`, not merely transformed off-screen — that is
  what removes it from the tab order and the accessibility tree.
- **Mobile-first** — baseline styles target the smallest screen; layer up with `min-width`.
  No `max-width` queries, including any inherited from system primitives.

---

## 10. Verification

### 10.1 Tests

Two new pure seams, TDD:

- `settings.setTheme(choice)` — against fake-indexeddb, mirroring the existing
  `setSidebarCollapsed` tests. Accepts `"system"`, `"dark"`, `"light"`; rejects anything else.
- `resolveTheme(choice, prefersDark)` — pure, in `src/utils/theme.js`. Covers: explicit
  choices resolve to themselves; `"system"` follows `prefersDark`; absent or unrecognised
  input is treated as `"system"`.
- `nextThemeChoice(choice)` — pure. Covers the full cycle system → light → dark → system, and
  that unrecognised input enters the cycle at a defined point rather than dead-ending.
- `renderIconPicker(selected)` — pure. Covers `role="radio"` / `aria-checked` output, the
  roving `tabindex` (exactly one `0`), and the clear option.

Everything else in v2 is CSS and view markup, which this project verifies in the browser, not
JSDOM. The 174 existing tests must stay green — none of them assert on styling.

### 10.2 Browser

Via the Preview MCP `ignite-dev` config, then `ignite-preview` for the service worker:

1. Today, Area, empty states — dark and light
2. Task menu, section menu, area menu, move picker — dark and light, **including the ⋯ menu
   on the last row of a group**, which is where a clipping ancestor would show up
3. Recurrence dialog — dark and light
4. Toast, including the aggregated and undo variants — dark and light
5. Mobile drawer open/close, capture bar, `--capture-h` lift
6. Sidebar collapsed rail, including the theme control
7. Theme toggle: persistence across reload, no flash on first paint, `theme-color` update
8. Emoji picker: create flow, rename flow, "none" clears to the dot fallback
9. **Offline font check** on `ignite-preview` (§5.3)
10. axe-core clean across every surface, in **both** themes
11. Keyboard: full paths through menus, rename, drawer, and the new theme control
12. 0 console errors

Light mode is the large new surface here. Every menu, the drawer, the toast, and the
recurrence dialog have only ever been seen dark.

---

## 11. Out of scope

- **The `/` capture shortcut** and `settings.shortcutsEnabled` — still blocked on a real
  settings surface. The sidebar toggle is a single control, not a settings surface. Design
  preserved in Appendix A of `2026-07-16-ignite-cascade-focus-design.md`, including the
  Norwegian Shift+7 trap.
- **Drag-to-reorder**, task date editing, richer task metadata.
- **The definitive app icon** — the interim flame stays; filenames are stable and
  drop-in replaceable.
- **A custom install prompt.**
- **The three known cascade-focus follow-ups** (`wasDrawerOpen` on non-active mobile areas,
  first-section-delete jumping to the footer, undo focus) — behaviour, not visual.

## 12. Upstream

Unrelated to Ignite, found while reading canonical: `design-system/base/base.css`'s
`.skip-link` uses `var(--motion-base)` and `var(--ease-out)`, and `tokens/motion.css` defines
neither — they are `--duration-base` and `--ease-standard`. The transition is dead. Ignite has
no skip link so it does not bite here. File against workbench.
