# Ignite — the collapsed sidebar rail, and Focus's front door

**Date:** 2026-08-17
**Status:** design agreed · stress-tested 2026-08-17 (11 findings folded in) · verification sweep run 2026-08-17 (see §10 "Verified" — 10 of 12 manual steps PASS, plus the light-theme repeat of 1/2/7; steps 10 and 11 NOT VERIFIED for tooling reasons, neither blocking; axe-core itself could not be run, substituted with a manual DOM/ARIA + contrast check)
**Supersedes:** nothing. Amends decision D1 of `2026-08-11-ignite-v3-focus-design.md` (see §5).
**Covers:** items 5 and 6 of the 2026-08-14 follow-up list. Item 3 is a named non-goal (§9).

---

## 1. The problem

The 48px collapsed rail was never designed. It is the expanded sidebar with things switched off, and every complaint about it follows from that.

Three `display: none` rules do the switching off:

```css
/* main.css:198 */
body.is-sidebar-collapsed .sidebar__name,
body.is-sidebar-collapsed .sidebar__count { display: none; }

/* main.css:1121 */
body.is-sidebar-collapsed .sidebar__menu-btn,
body.is-sidebar-collapsed .sidebar__add-area-row,
body.is-sidebar-collapsed .sidebar__rename-input { display: none; }
```

**The area buttons have no accessible name at all.** `.sidebar__area` contains exactly three children: the icon `<span>`, which is `aria-hidden="true"`, `.sidebar__name`, and `.sidebar__count` ([`sidebar.js:575`](../../../src/views/sidebar.js)). Removing the last two from the render tree removes the button's entire accessible name. This is not a degraded name; it is an unnamed button.

**Renaming is unusable and drops focus.** The `--editing` row still renders — the row, the icon, and the icon picker — but not the field. The user is put into a rename mode with nothing to type into, and because `attachRenameInput` focuses an element that is `display: none`, focus falls to `<body>`.

**The active tint renders as a block that overflows the rail.** `#sidebar` keeps `padding: 1rem` at desktop ([`main.css:93`](../../../main.css), untouched by the `min-width: 768px` block at `main.css:137`), so a 48px rail has **16px of content width**. `.sidebar__area` still carries `padding: 0.5rem 0.75rem`, `.sidebar__home` still renders the word "Ignite" at `1.1rem/700` with `padding: 0.75rem 1rem`, and `.sidebar__area.is-active` paints `--accent-soft` across the resulting overflow.

Separately, Plan 3 removed Focus from the sidebar list on the reasoning that the wordmark is the home nav item ([`sidebar.js:488`](../../../src/views/sidebar.js), spec D1). In use it does not read as a nav item — it reads as a logo, and the app's landing surface has no visible front door.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | The rail is a **navigation strip that also reports status**, with **no loss of function** | Collapsing should cost width, not capability |
| D2 | The rail is a **CSS variant of one DOM**, never a second template branch | `sidebarCollapsed` is also true on mobile, where the drawer is full width and labels must stay — so the view cannot branch on it (§3.1) |
| D3 | Accessible names live on the **button** via `aria-label`, with painted children `aria-hidden` | A clipped label cannot work on area rows — `.sidebar__name` is the *visible* label when expanded. One name, stated once, correct in both states (§3.3) |
| D4 | Counts become **corner badges** on the tile | Same number as the expanded row, different presentation |
| D5 | The ⋯ menu trigger moves to the **tile's bottom-right corner**, revealed on `:hover` / `:focus-within` and always visible under `@media (hover: none)`, always in the tab order | Same mental model and same keyboard path as the expanded sidebar. Desktop-only does not mean pointer-only — a touchscreen laptop gets the rail with no hover state (§3.3) |
| D6 | Rename becomes a **popover anchored to the tile**, carrying the field and the icon picker | Restyling the existing `--editing` row; no DOM change, so every closure flag keeps working |
| D7 | The wordmark becomes the **Focus hero card** — brand and landing surface as one promoted control | Gives Focus a real front door without adding a second control pointing at one page |
| D8 | Focus and area counts come from **one shared helper** | The `focusSectionIds` derivation is already duplicated; a third copy is how the page header and the sidebar start disagreeing |
| D9 | `onAddArea` **seeds a default section** | The rail's ＋ makes it one click to create an area nothing can be filed into |
| D10 | The **controller** composes area + section creation; the area model does not write to the sections store | One model, one store — a cross-store write skips the section model's notify (§7) |
| D11 | The **toggle is a rail tile**, specified rather than inherited | It is the only way out of the rail, and today it has no collapsed-state rule at all (§3.6) |

---

## 3. The rail

### 3.1 Why CSS-only

`settings.sidebarCollapsed` is a single boolean applied at every viewport ([`controller.js:193`](../../../src/controller.js) toggles `body.is-sidebar-collapsed` unconditionally), but the rail only exists at `min-width: 768px`. Below that the sidebar is a full-width off-canvas drawer where labels must stay visible. A template that branched on `sidebarCollapsed` would therefore strip labels from the mobile drawer.

**Every rail rule lives inside `@media (min-width: 768px)`.** This is the same constraint that produced the clip hack at `main.css:230-252`; that hack stops being an exception and becomes the pattern.

Popovers can escape the rail: `#sidebar` is set to `overflow-y: visible` at desktop ([`main.css:141`](../../../main.css)), and `.sidebar-menu` is already `position: absolute` inside a `position: relative` row ([`main.css:1029`](../../../main.css)). No new component is required — only new anchoring.

> **Invariant — `#sidebar { overflow-y: visible }` at ≥768px is load-bearing.**
> It is the only reason a menu or rename popover can render outside a 48px column. Setting it to `auto` or `hidden` clips every rail popover back inside the rail, which is precisely the defect this spec exists to remove. A long area list *will* eventually overflow the column; the fix for that is a scroll container that is **not** the popover's clipping ancestor, never a change to this property.

**Layering.** `.sidebar-menu` is `z-index: 10` ([`main.css:1033`](../../../main.css)). That has never mattered, because the 240px column does not overlap `.capture-picker` (`z-index: 70`) or `#toast-root` (`z-index: 100`). Rail popovers project into the content column, so the geometry becomes real for the first time. It is not reachable today — `docClickHandler` closes an open menu on any outside click, and `attachRenameInput`'s blur handler commits a rename before focus can reach capture — but the margin is accidental. **Rail popovers get an explicit layer above 100**, recorded here so it is not re-derived later.

### 3.2 Geometry

| Property | Expanded | Rail |
|---|---|---|
| Column width | `--sidebar-width` (240px) | `--sidebar-rail-width` (48px) |
| `#sidebar` padding | `1rem` | `0.375rem` block, `0` inline |
| Tile | full-width row, 44px tall | 36×36px, centred |
| Usable content width | 208px | 48px |

The padding change is the fix for the overflow. Tiles centre themselves inside the rail rather than inheriting the row's asymmetric padding.

**Reduced motion.** Collapsing animates `grid-template-columns` on `body` ([`main.css:131`](../../../main.css)), and the reduced-motion block at [`main.css:1250`](../../../main.css) lists only `#sidebar` and `#scrim` — so reduced-motion users get the full 240px→48px slide today, and this spec adds an opacity fade on the ⋯ on top of it. Add `body` and `.sidebar__menu-btn` to that block.

The 36px tile is deliberately below the 44px touch-target rule the project applies elsewhere. That rule protects touch input; the rail never renders on touch, because it is gated behind `min-width: 768px` and mobile uses the drawer.

**The painted tile and the hit area are different boxes.** The button keeps `min-block-size: 44px` and full rail width; the 36×36 rounded surface is drawn by the button's own background box inset with padding. Do not implement this by shrinking the button to 36px and spacing it with margin — that produces 36px targets with dead gaps between them.

### 3.3 Tiles

Each area tile shows:

- the area icon, centred, `--text-lg`
- `.sidebar__name`, not painted in the rail. The name is not lost, because `.sidebar__area` carries `aria-label="<name>, <N> open"` and both spans are `aria-hidden` — see D3
- `.sidebar__count` as a badge pinned to the top-right corner. The badge overhangs the tile; at 48px with 36px tiles that leaves ~2px to the rail's border, so it **must render inside the rail's inline bounds** — it may not extend past the sidebar's right edge
- `.sidebar__menu-btn` pinned to the bottom-right corner, `opacity: 0` until the row is hovered or contains focus. Its **painted** glyph is ~15px; its **target** is at least 24×24px, per WCAG 2.5.8 (AA). It overlaps the tile — that is intended, and it is why the tile's own click target is the remaining area, not the full 36px square

**The reveal selector is `.sidebar__area-row:hover, .sidebar__area-row:focus-within`.** Not `:focus-visible` — the row is an `<li>`, it never receives focus, and there is no `:focus-visible-within`. Written against the row's own focus state the rule would never match for a keyboard user, which would re-create the dead keyboard path this spec exists to fix.

**Hover is not a safe assumption at ≥768px.** The rail is gated on width, and a Windows touchscreen laptop at 1280px gets the rail with no hover state at all. An `opacity: 0` element is still hit-testable, so on such a device the first tap on the tile's bottom-right corner opens an invisible menu instead of the area. Add:

```css
@media (hover: none) {
    /* no hover to reveal on — the affordance is permanent */
    body.is-sidebar-collapsed .sidebar__menu-btn { opacity: 1; }
}
```

The badge shows the **same number the expanded row shows** — open (non-completed) tasks in the area's sections. A different number in the same sidebar's two states would be a bug, not a feature.

**The count does not land in the accessible name as a bare integer.** The button's `aria-label` states it with a unit — "Hjemme, 3 open" — and `.sidebar__count` is `aria-hidden`, so the painted badge never contributes a stray number.

Badge legibility is a real constraint at this size and must be checked in **both themes**: the light palette's accent is `#c64e16` ([`ignite.css:42`](../../../design-system/tokens/palettes/ignite.css)) against a light ground, and badge text sits on the accent fill.

Zero is not rendered. An area with nothing open shows a bare icon.

### 3.4 The ⋯ menu

Click on the tile opens the area. The corner ⋯ opens the menu, anchored `left: 100%; top: 0` from the row instead of `top: 100%; right: 0.5rem`, so it lands beside the tile rather than inside the rail or below it.

Everything else is unchanged: `aria-haspopup="menu"`, `aria-expanded`, the roving arrow-key handling in `docKeyHandler`, `Tab` closing the menu, and the `event.detail === 0` keyboard heuristic that moves focus to the first item.

**The affordance must not be hidden with `visibility` or `display`.** It is revealed visually only; it stays in the tab order and the accessibility tree at all times, so a keyboard user reaches it by tabbing and a screen-reader user finds it by control listing.

### 3.5 Rename

The `--editing` row becomes a popover anchored to the tile, containing the text field and the icon picker. `main.css:1583`'s `body.is-sidebar-collapsed .icon-picker { display: none }` is deleted — the picker now has a container wide enough to render into.

Because the DOM does not change, the closure machinery in [`sidebar.js`](../../../src/views/sidebar.js) is untouched: `pendingRenameSelect`, `pendingRenameValue`, the caret read/restore through `utils/rename-input.js`, the `isRendering` blur guard, and the destroy-commit all behave as they do today.

**One deletion:** the expanded→collapsed force-close at [`sidebar.js:400-411`](../../../src/views/sidebar.js). It exists because collapsing used to destroy the rename input, leaving `renamingAreaId` set against a field that no longer rendered. With parity there is nothing to force-close, and keeping it would commit a rename the user is still typing whenever they collapse the sidebar.

Delete `prevSidebarCollapsed` with it — the flag exists only to drive that branch. That means three places: the declaration, its reset in `destroy()`, and its line in the closure-state comment block at [`sidebar.js:19`](../../../src/views/sidebar.js). Left behind it is tracked and documented state that does nothing.

### 3.6 The toggle

`.sidebar__toggle` is the only way out of the rail, and it currently has **no collapsed-state rule at all**: it is a 32px box with `align-self: flex-start` ([`main.css:151`](../../../main.css)) whose position comes entirely from the `1rem` padding §3.2 removes.

It becomes a rail tile like any other — same 36px painted surface, same 44px hit area, centred — pinned directly below the hero card and above the area list. Its `aria-label="Toggle sidebar"` is unchanged, and it keeps its existing `display: none` below 768px, where the drawer has no collapse concept.

### 3.7 New area

`.sidebar__add-area-row` becomes a ＋ tile at the end of the list rather than being hidden. Its accessible name stays "New area" via the same clipping treatment.

---

## 4. The Focus hero card

`.sidebar__home` stops being a bare wordmark and becomes a bordered, `--accent-soft`-tinted card:

```
┌─────────────────────────┐
│ ◆  Ignite               │
│    Focus · 3 due today  │
└─────────────────────────┘
```

In the rail it collapses to a single promoted tile: a bordered 38px tile with the flame glyph and a badge, sitting above the divider that separates it from the area tiles.

It remains **one control**, so `aria-current="page"` ([`sidebar.js:480`](../../../src/views/sidebar.js)) and the `focusHome()` post-cascade focus target ([`controller.js:675`](../../../src/controller.js)) keep working without change.

**Counts on the card.** The card's second line reports the same numbers as the page header — overdue emphasised when non-zero, then due today. The rail badge shows `overdue + dueToday`, tinted `--danger` when `overdue > 0`.

**Accessible name.** The card's name must read as one coherent phrase — "Ignite, Focus, 3 due today" — not as a wordmark with orphaned numbers after it.

---

## 5. Relationship to Plan 3's D1

Plan 3 decided Focus is not a listed area, because listing it would create a second door onto the same tasks and would expose rename and icon controls belonging to a surface that no longer exists. **That reasoning holds and is not reversed.** `userAreas = sorted.filter(a => a.id !== FOCUS_ID)` at [`sidebar.js:488`](../../../src/views/sidebar.js) stays exactly as it is.

What changes is only the *presentation* of the existing single door: the wordmark is promoted so it reads as the nav item it already was. Focus still has no ⋯ menu, no rename, and no icon picker.

---

## 6. The shared count helper

`focusSectionIds` is derived identically in two places today:

- [`controller.js:149`](../../../src/controller.js), for the page header summary
- [`focus.js:570`](../../../src/views/focus.js), for the tab counts

The hero card needs the same derivation, which would make three copies. Extract one helper — `utils/focus-counts.js`, taking `(sections, tasks, now)` and returning the section ids plus the `{ overdue, dueToday }` summary — and have all three call it.

This is in scope because this change is what makes the duplication load-bearing: a one-sided edit would silently desync the sidebar card from the page header, on the same screen, at the same time.

---

## 7. New areas get a section

`onAddArea` ([`controller.js:712`](../../../src/controller.js)) calls `areas.create({ name: "New area" })` and nothing else. The area has no section, so nothing can be filed into it and it is not a valid move target until the user adds one by hand.

A new area is created **with one section, named "Tasks"**, matching the Focus seed in `ensureFocus` ([`areas.js:138`](../../../src/model/areas.js)).

**The controller orchestrates it; the area model does not write to the sections store.** `onAddArea` calls `areas.create` and then `sections.create`. Putting the section write inside `areas.create` would notify `areas` listeners only, leaving anything subscribed to `sections` unaware of a section that now exists. That happens to be invisible today — the controller subscribes to all four models ([`controller.js:979`](../../../src/controller.js)) and `buildState` re-reads every store on each notify — but it is an accident of the current wiring, not a contract, and it breaks the one-model-one-store boundary the project's MVC layering depends on. `ensureFocus` gets away with the cross-store write only because it runs before any subscriber exists.

The section-creation behaviour sits on the pure-function seam and is covered by unit tests per the project's TDD boundary.

---

## 8. Accessibility contract

Every one of these must hold in the rail, and each is a regression the current code has:

| Requirement | Today | After |
|---|---|---|
| Area buttons have an accessible name | ✗ none | ✓ clipped label |
| Rename is operable when collapsed | ✗ no field | ✓ popover |
| Rename does not drop focus to `<body>` | ✗ drops | ✓ field is focusable |
| ⋯ reachable by keyboard | ✗ `display: none` | ✓ always in tab order |
| New area reachable when collapsed | ✗ hidden | ✓ ＋ tile |
| Badge contrast passes in both themes | n/a | ✓ verified by hand |
| ⋯ reachable without hover (touchscreen laptop) | ✗ `display: none` | ✓ `@media (hover: none)` |
| Toggle reachable and correctly placed in the rail | ~ unstyled | ✓ specified (§3.6) |
| Collapse respects `prefers-reduced-motion` | ✗ animates | ✓ `body` added to the block |
| Count reads with a unit, not as a bare integer | ✗ | ✓ clipped label carries the phrase |

An **axe pass on the sidebar in both states and both themes** is part of this work. Scope axe to `#sidebar`; `page-has-heading-one` and `landmark-one-main` fire on the inert background whenever a dialog is open and are known artifacts.

This does **not** discharge the two axe passes already owed on the schedule dialog and the Focus surface.

---

## 9. Non-goals

- **The mobile drawer.** Nothing below 768px changes.
- **Drag-to-reorder.** Move up / move down stay as they are.
- **Focus gaining a ⋯ menu, rename, or icon.** See §5.
- **Changing what an area count counts.** Same derivation, new presentation.
- **Tooltips on rail tiles.** The clipped label serves assistive tech; a visual tooltip is a separate hover-panel design with its own WCAG 1.4.13 obligations.
- **Section titles (follow-up item 3).** Deliberately not folded in — it is a type pass across `.section__title` and `.group__heading` on the main surface, unrelated to the sidebar, and mixing them would make both harder to review.

---

## 10. Verification

**Unit tests** (the pure-function seam only, per project convention):

- `utils/focus-counts.js` — section-id derivation and the `{ overdue, dueToday }` summary, including the empty-sections and all-completed cases.

Note the consequence of §7's orchestration decision: because the seeding moves to `onAddArea`, it lands in the controller, which has **no unit coverage by design**. `sections.create` is already covered; the composition is not, and is verified by hand at step 6 below. That is the cost of keeping the model boundary clean, and it is accepted deliberately rather than by omission.

**By hand, in the browser** — views and the controller have no unit coverage by design:

1. Collapse at desktop. Every tile has a visible icon, no overflow, no stray tint.
2. Tab through the rail. Every stop announces a name. The ⋯ is reachable on each area.
3. Rename an area while collapsed. The popover opens, the field takes focus with the text selected, Enter commits, Esc cancels, and focus returns to the tile.
4. Collapse *while* renaming. The rename survives; nothing is force-committed.
5. Delete an area while collapsed. Focus lands on the Focus card, not `<body>`.
6. Create an area from the rail's ＋. It opens with a section already present and is immediately a valid move target.
7. Switch to light theme and repeat 1 and 2. Check badge contrast specifically.
8. Resize below 768px with `sidebarCollapsed` true. The drawer shows full labels — no rail rule leaks.
9. Collapse and re-expand using only the toggle. It is visible, centred, and reachable by Tab in both states.
10. Turn on `prefers-reduced-motion` and collapse. No slide, no fade.
11. Emulate a coarse pointer at desktop width (DevTools → touch emulation, or a real touchscreen laptop). The ⋯ is permanently visible and the tile still opens the area on tap.
12. Open an area's rail menu, then click into the capture bar. The menu closes rather than being painted under anything.

**Owed and not dischargeable here:** a real-device pass. Every "device" check available in this environment is desktop Chromium at a resized viewport, which cannot confirm touch targets or the on-screen keyboard. The rail is desktop-only so it is largely out of that risk, but step 8 in particular deserves a real phone.

### Verified (2026-08-17)

Run via the preview dev server, desktop Chromium at 1280×800, driven through `javascript_tool` (dispatched synthetic events + `getBoundingClientRect`/computed-style measurement — no real Tab/Enter/Arrow keypresses were available in this pane; every keyboard interaction below was a dispatched `KeyboardEvent`, not a physical key). `npm run check` and `npm run test:run` both green (0 Biome warnings; 258 tests / 17 files). Full detail, every measurement, and the test data used and restored: `.superpowers/sdd/task-9-report.md`.

**§10 steps 1-9, 12 — PASS**, each confirmed with `getBoundingClientRect()` or computed-style evidence (no overflow past the 48px rail, 36px tiles, 44px hit targets, correct tint scoping, correct focus targets after rename-commit/cancel/delete, section present immediately on area creation, drawer showing full labels below 768px with no rail rule leaking, toggle round-tripping visibly/centred/reachable, and the rail menu closing on an outside click into the capture bar).

**Light-theme repeat of steps 1, 2, 7 — PASS.** Badge contrast measured by hand (relative-luminance formula, not axe): **6.43:1 in dark, 4.66:1 in light** — both clear the 4.5:1 AA floor for the badge's 11px text and match the ratios already documented in §3.3's code comment.

**§10 step 10 (reduced motion) and step 11 (coarse-pointer emulation at desktop width) — NOT VERIFIED.** Neither `prefers-reduced-motion` nor a coarse pointer combined with a ≥768px viewport can be forced through the available browser tooling in this environment (the resize tool exposes only width/height/color-scheme). Confirmed instead by static reading of `main.css`: the reduced-motion block (~line 1555) lists `body`, `#sidebar`, `#scrim`, `.sidebar__menu-btn`; the `@media (hover: none)` block (~line 1424) sets the ⋯ trigger's opacity to 1. Neither claim was exercised at runtime.

**Axe — NOT RUN.** axe-core is not a project dependency and was not added; no remote script was injected. No devtools accessibility-audit panel was reachable through the available tools. Substituted with a manual pass in all four combinations (collapsed/expanded × dark/light): zero unnamed buttons inside `#sidebar` in any combination, `aria-haspopup="menu"`/`aria-expanded` correct on the ⋯ trigger, no duplicate ids, plus the contrast measurement above. This is **not** equivalent to an axe audit — it does not check landmark structure, full focus-order rules, or the rest of axe's ruleset.

**Owed axe passes confirmed still owed, untouched by this sweep:** the schedule dialog and the Focus surface.

---

## 11. Risks

- **Badge legibility at 48px in light theme** is the most likely thing to come back for a second pass. It is checked by hand in both themes before the work is called done.
- **`opacity`-based reveal of the ⋯** must not become `visibility: hidden` during implementation — that would re-break the keyboard path this spec exists to fix.
- **Deleting the force-close** (§3.5) changes behaviour on mobile too, where `sidebarCollapsed` can flip without any visual change. The rename simply survives, which is the correct outcome, but it is a behaviour change outside the rail and should be exercised in step 4.
- **`overflow-y: visible` will look like a bug to a future reader.** The invariant in §3.1 is the mitigation; if the area list ever needs to scroll, re-read it before touching the property.
- **Moving the seeding to the controller trades unit coverage for a clean model boundary** (§7, §10). If that trade turns out wrong, the alternative is a pure helper the controller calls — not a cross-store write in the area model.
