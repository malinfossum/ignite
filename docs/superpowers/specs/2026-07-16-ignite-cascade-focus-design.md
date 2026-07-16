# Ignite — Cascade focus routing (design)

**Date:** 2026-07-16
**Status:** Design — stress-tested, pending implementation plan
**Baseline:** `15f7956` (166 tests, Biome clean, build clean)

After a cascade delete, focus drops to `document.body`. Keyboard users lose their place; screen-reader users get silence. This routes focus to a surviving neighbour instead.

No CSS. No model change, no DB version bump. `base.css` and `design-system/` untouched.

---

## 1. Scope

**In:** focus routing for the two cascade deletes — **section delete** (`onDeleteSection`) and **area delete** (`deleteAreaCascade`).

**Out, each for a stated reason:**

- **`/` capture shortcut — deferred to the settings work, not cancelled.** `/` is a single-character key shortcut, and WCAG 2.1.4 (Character Key Shortcuts, **Level A**) requires that such a shortcut can be turned off, remapped, or is active only on focus. Ignite offers none of the three, and **axe cannot detect 2.1.4** — it is a manual-only check, so the axe-clean result of 2026-06-24 gives no cover. The honest fix is a `settings.shortcutsEnabled` toggle, and a toggle needs a settings surface to live on; a boolean nobody can reach is a dead field, not a mechanism. A settings surface is coming and likely overlaps the visual redesign, so `/` rides with it rather than shipping a known Level A regression in the interim. **The design work is preserved in Appendix A** — it is decided, not lost.
- **`n` (new section) — rejected outright.** "New section" needs an `areaId`; the Today route has no such concept. A shortcut that silently does nothing on half the app teaches the user it's broken.
- **Single task delete focus — follow-up.** Same defect class, but it isn't a cascade and it would drag `today.js` into work that otherwise never enters it.
- **Undo focus — out of scope, deliberately named.** After a cascade the user presses the toast's Undo; the toast dismisses, its button is removed, focus falls to body, and the restore's `innerHTML` rewrite drops it again. So this spec fixes the delete half of the journey and not the undo half, which is a real asymmetry. It stays out because undo-focus is a property of **every toast**, not of these two cascades — fixing it here would fix it in one of the places it's broken and imply it was fixed everywhere. It deserves its own pass across all undo paths.

---

## 2. Why now

Both cascades are invisible defects to a mouse user and hostile to everyone else. After any `innerHTML` rewrite focus falls to `document.body`; after a cascade delete there is nothing to return to, so a keyboard user loses their position in the list and a screen-reader user hears nothing. This is pure a11y gain with no countervailing cost — no new affordance to learn, no new key to intercept, no compliance question.

---

## 3. Architecture

### 3.1 New pure seam — `previousSectionId` in `src/utils/sections.js`

```js
export function previousSectionId(sections, sectionId) → string | null
```

Returns the id of the section immediately before `sectionId` by `order`, or `null` when it is first, when it is absent, or when the list is empty. Caller passes the **area's own sections** (the peers), matching `reorderSections`' existing contract in the same file — that helper takes the relevant set and sorts defensively, and this one does the same.

This is the bundle's only TDD seam. Placing it beside `reorderSections` keeps the sort-by-`order` + `findIndex` logic in one file with one test file, rather than growing a second copy inside the controller.

### 3.2 Views — new methods

**`area.js`:** `focusAfterSectionDelete(prevSectionId: string | null)` — sets a pending flag, does **not** `doRender`. Precedent: `focusTaskMenu` (`area.js:640`).

**`sidebar.js`:** `focusHome()` — same shape.

Both flags are consumed by the next `doRender` via a **post-render DOM lookup**, never a stored element ref (the standing post-`innerHTML` invariant: a captured ref is detached by the rewrite and `.focus()` on it is a silent no-op). Both are cleared in `destroy()`, per the explicit-list rule.

**Flag precedence in `doRender`:** the delete flag is consumed **last**, after the existing rename/menu pending-focus blocks, and only if no rename input has claimed focus. It is cleared **unconditionally** — consumed or not — so a flag set during a render that never reaches its branch cannot leak into a later, unrelated render. In practice the two can't collide (entering a rename nulls `openMenuId`, so a delete can't be triggered from a menu mid-rename), but the ordering is specified rather than left to luck.

---

## 4. Data flow

### 4.1 The ordering trap — why the flag is set *after* the writes

A section delete fires **two** notifies:

```js
await tasks.removeMany(taskSnapshots.map(t => t.id));  // notify #1 → render
await sections.remove(sectionId);                      // notify #2 → render
```

A flag set *before* these is consumed by render #1 — where the section still exists and focus lands correctly — and then render #2's `innerHTML` rewrite **detaches that very button and drops focus back to body**. It would pass code review and fail in the browser.

**And "set the flag after both awaits, then `applyState()`" is NOT sufficient** — that was this spec's original prescription, and it loses to the same race. `notify()` is synchronous and does **not await its subscribers** (`model/sections.js:24-26`: `for (const fn of listeners) fn();`). So `sections.remove()` fires `notify()`, the launched `applyState` immediately suspends on its IndexedDB reads, and *then* `remove()` returns. The caller's `await` continuation is a **microtask**, so it runs before those reads complete — the flag gets set while that render is still queued, and the explicit `applyState()` queues a second render behind it. Two renders land after the flag: the first consumes it and focuses, the second rewrites `innerHTML` and drops focus to `<body>`.

(`closeRecurrenceEditor({ rerender: true })` at `controller.js:543` looks like a counter-example but isn't: it performs **no write**, so no notify-render competes with it.)

So: **drain, then flag, then one final render.**

```js
await tasks.removeMany(...);
await sections.remove(sectionId);
await applyState();          // drain the in-flight notify-renders
currentMainView?.focusAfterSectionDelete?.(prevId);
await applyState();          // now THIS is genuinely the last render
toast.show({ ... });
```

The drain works because the pending renders queued their IDB reads **before** ours, and read transactions complete FIFO — an ordering assumption already load-bearing across this codebase. After the final write no further notifies fire, so nothing can queue a render behind our last one. Cost: one extra render per delete, imperceptible.

**Empty layers must be guarded for the same reason.** `removeMany([])` still notifies, adding another in-flight render to precisely the pile that causes this. `deleteAreaCascade` already guards (`controller.js:425-430`); `onDeleteSection` must too.

### 4.2 Section delete — target chain

The peers come from the snapshot the controller **already takes** (`controller.js:308`), before any write:

```js
const peers = allSections.filter(s => s.areaId === sectionSnapshot.areaId);
const prevId = previousSectionId(peers, sectionId);
```

`doRender` consumes it with a fallback chain:

1. `[data-section-id="${CSS.escape(prevId)}"] .section__menu-btn` — the previous section's `⋯`.
2. `.area__add-section` — when the deleted section was first or only (`prevId === null`), or when the previous section is itself gone (cascade race).

(Class selectors, not `data-action`: every existing focus lookup targets the class — `area.js:574`, `area.js:582`, `sidebar.js:301`. `data-action` is the click-delegation contract; classes are the focus contract.)
3. Neither exists → `?.focus()` no-ops → body. That is today's behaviour, so the worst case is **no regression**.

**`CSS.escape` is mandatory, not decorative.** All eight existing interpolated-id selectors escape (`area.js:179,185,607,615`; `sidebar.js:122,321`; `today.js:81,319`). Ids are `crypto.randomUUID()` today, so nothing is exploitable — but `id.js` explicitly advertises itself as swappable ("Swap-able later if we ever need a custom id format"), and an id containing a quote or backslash turns a render into a thrown `DOMException`. Follow the convention.

**Tied `order` values are a known ambiguity.** Two sections sharing an `order` make "previous sibling" arbitrary, since the tie's resolution isn't guaranteed across engines. This matches existing `moveSection` (`controller.js:341`) behaviour exactly. Documented, not fixed — a real fix is an ordering-scheme change, far outside this bundle.

### 4.3 Area delete — and the mobile race

`deleteAreaCascade` redirects (`window.location.hash = "#today"`) **before** its writes. That redirect fires `hashchange` → `onHashChange` → **`closeDrawer()`, which focuses `.topbar__menu`** (`controller.js:513`) and sets `drawerOpen = false`.

On mobile the drawer is *how* the user reached the area's `⋯` menu, so the sidebar must not claim focus there — `.sidebar__home` sits inside a drawer that is now `visibility:hidden`, and focusing it loses focus to body: the exact bug this spec exists to fix.

**The guard must snapshot `drawerOpen` at the top of the function, before the redirect.** Reading it later is a race that silently defeats itself: `hashchange` is queued as a task and runs while the IndexedDB awaits yield, so `closeDrawer()` has already set `drawerOpen = false` by the time a late guard evaluates. The late version looks correct and fails on exactly the surface it was written for.

```js
async function deleteAreaCascade(areaId) {
  if (areaId === FOCUS_ID) return;
  const wasDrawerOpen = drawerOpen;        // BEFORE the redirect — see above
  // … snapshots, redirect, cascade writes …
  await areas.remove(areaId);
  await applyState();                      // drain in-flight notify-renders — see §4.1
  if (!wasDrawerOpen) sidebar.focusHome(); // desktop only
  await applyState();                      // the final, consuming render
  toast.show({ ... });
}
```

The drain matters more here than in §4.2: besides the three cascade writes' notifies, the redirect's `onHashChange` fires its own un-awaited `applyState()`. Same rule, one more competitor.

On mobile, `closeDrawer`'s existing return-to-trigger focus is already the right answer, so the guard defers to it rather than competing.

**There is no separate "Today" nav item to focus.** The `Ignite` wordmark **is** it: `.sidebar__home`, `data-action="go-today"`, takes `aria-current="page"` on Today (`sidebar.js:424`). It is also what `openDrawer` already focuses — so this reuses an established target rather than inventing an affordance.

---

## 5. Error handling

- View methods called with `?.` — after an area delete the route is already Today, whose view has no `focusAfterSectionDelete`.
- `?.focus()` throughout: a missing target no-ops to body (status quo), never throws.
- Pending flags cleared in each view's `destroy()` (explicit-list invariant — no "etc.").
- No new throw paths. Existing `/not found/i` swallows untouched.

---

## 6. Testing

### 6.1 Unit (TDD)

`tests/utils/sections.test.js` — extend the existing file for `previousSectionId`:

| Case | Expected |
|---|---|
| middle section | previous section's id |
| first section | `null` |
| only section | `null` |
| unknown id | `null` |
| empty list | `null` |
| non-contiguous `order` values (0, 5, 99) | correct previous — sorts, doesn't assume contiguity |
| unsorted input array | correct previous — sorts defensively |

### 6.2 Manual E2E (Preview MCP — views are not unit-tested here)

1. Delete a middle section → focus on the previous section's `⋯`.
2. Delete the **first** section (others remain) → focus on "＋ New section".
3. Delete the **only** section → focus on "＋ New section".
4. Delete an area (desktop) → focus on `.sidebar__home`.
5. Delete an area (mobile, from the drawer) → focus on `.topbar__menu`, drawer closed.
6. Delete a section **that contains tasks** → focus is on the previous `⋯` and **still there once both notifies have settled** (the two-notify trap of §4.1). Probe `document.activeElement` after awaiting a tick, not immediately — an implementation that sets the flag too early passes an immediate probe and fails this one.

Per the E2E lesson: assert with `document.activeElement` probes inside a **single** `preview_eval`, not screenshots — wall-clock between separate evals is not deterministic, and `preview_screenshot` can hang while eval stays live.

---

## 7. Files touched

| File | Change |
|---|---|
| `src/utils/sections.js` | `+ previousSectionId()` — pure |
| `tests/utils/sections.test.js` | `+` TDD cases for the above |
| `src/views/area.js` | `+ focusAfterSectionDelete()`, flag, doRender block, destroy reset |
| `src/views/sidebar.js` | `+ focusHome()`, flag, doRender block, destroy reset |
| `src/controller.js` | focus routing in `onDeleteSection` + `deleteAreaCascade` (incl. `wasDrawerOpen`) |

No CSS. No `base.css`. No `design-system/`. No model or DB change.

---

## 8. Invariants this work must not break

- Post-`innerHTML` focus = **pending flag → post-render DOM lookup**, never a stored ref.
- `inert` subtrees cannot receive focus (why `wasDrawerOpen` exists).
- **Interpolated ids in selectors are always `CSS.escape`d.**
- Views clear every closure flag in `destroy()` with an explicit list.
- `closeDrawer` restores `role="navigation"` and returns focus to `.topbar__menu`. Untouched here — and depended upon by §4.3.
- The four rename surfaces' `commit-*-rename` attributes are key-handler-only, never click actions. Untouched here.

---

## Appendix A — Deferred: `/` capture shortcut

Kept so the settings work inherits decisions already made rather than re-deriving them.

**Blocker:** WCAG 2.1.4 (Level A). Ship `/` only alongside a reachable `settings.shortcutsEnabled` toggle (default true). The `settings` model already exists; `sidebarCollapsed` is the precedent for the field, but it is driven by a button, so there is no settings screen for a toggle to live on yet.

**Design, already settled:**

- **Pure seam** `shouldIgnoreShortcut(event)` in `src/utils/shortcuts.js` → `true` when the keystroke belongs to something else: `event.isComposing` (the `520f2f4` IME rule), `ctrlKey || metaKey || altKey`, target is `INPUT`/`TEXTAREA`/`SELECT`, or `target.isContentEditable`. Plain event-like object in → testable with no JSDOM, matching `menu-keyboard.js`.
- **`shiftKey` must NOT be a blocker.** On the Norwegian layout `/` is **Shift+7**. Blocking shift would make the shortcut dead on the author's own keyboard while passing every test on a US layout. Match on `event.key === "/"` — `key` reports the produced character, not the physical key. This needs a regression test, or it will be "cleaned up" later by someone reading `shiftKey` as an oversight.
- **Listener** on `document` (after a `doRender`, focus sits on body and never visits `rootEl`), registered in `start()` **after** `createCaptureView` (`controller.js:615`), removed in `stop()`, calling `capture?.focus()`.
- **Bail order:** `event.key !== "/"` → `shouldIgnoreShortcut` → **`preventDefault()` here**, so a guarded `/` can't open Firefox's quick-find over a modal → `drawerOpen` (capture is inside the inert `mainEl`; `.focus()` there is a silent no-op) → `repeatEditorTaskId` (modal owns the keyboard) → `document.querySelector('[role="menu"]')` (an open menu owns arrow/Tab/Esc). **The menu check is verified valid:** menu markup is conditionally rendered, not hidden — `section.js:52` emits it only when `isOpen && !isRenaming`, and `section.js:216` returns the bare row when closed.
- **`capture.js`** gains `focus()` → `input.focus()`, no `select()` (leftover unsubmitted text must survive), plus `aria-keyshortcuts="/"` on the input to advertise the shortcut to AT.
- **Reality check on who benefits:** NVDA/JAWS browse mode intercepts single keys before the page sees them, and speech-recognition users are the population 2.1.4 protects. `/` mostly serves sighted keyboard users — a real group, but narrower than "accessibility win".
