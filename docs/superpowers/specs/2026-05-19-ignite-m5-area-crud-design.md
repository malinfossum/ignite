# M5 — Area-level CRUD

**Date:** 2026-05-19
**Milestone:** M5 (Sidebar area management)
**Scope:** ~280-line sidebar view rewrite + ~5 new model methods + cascade-delete in controller + 10 new tests
**Predecessors:** M4 (Task reorder) shipped 2026-05-19. 93 tests green.

## Why

Areas are the top-level container in Ignite. M3 shipped CRUD inside an area (sections); M5 surfaces CRUD on areas themselves. Without `+ New area`, the user is stuck with the single seeded Focus area. Without rename and delete, the app can't model anything beyond "tasks I'm doing right now."

M5 mirrors the M3 section-CRUD pattern at the area level. Same `⋯` menu, same inline rename, same cascade-delete + undo. The architectural lift is that the sidebar — currently an ~85-line stateless renderer — becomes a stateful view with closure flags parallel to `area.js`.

## Scope

**In scope**

- `＋ New area` button as the last `<li>` of `<ul class="sidebar__areas">`, after the area list.
- Per-area `⋯` menu with **Rename / Move up / Move down / Delete**. Verbatim mirror of `renderMenu` in `section.js`.
- Inline rename in the sidebar row (input replaces the name span; canonical name display = canonical rename location).
- Cascade delete (area → all sections under it → all tasks under those sections) with 8s toast undo. Restore order is **reverse-cascade** (areas → sections → tasks) to keep view filters consistent.
- Auto-navigate on create: `areas.create` → set hash to `#area/<new-id>` → `sidebar.enterRename(id)` → rename input focused + selected.
- Focus area (`id: "focus"`) participates in reorder; only **Delete** is suppressed via `isUndeletable` (parallel to `focus-default` section).
- Auto-capitalize first char of area names at model layer (parallel to `tasks.create`, `sections.create`).
- Sidebar collapse force-closes any open menu and commits-or-cancels any active rename.
- New `pendingRenameValue` closure flag preserves in-progress typing across tick re-renders (closes a latent M3 bug too — see Async invariants).

**Out of scope**

- Icon editing. Defer to a future picker milestone; new areas default to empty icon (`""`) which renders as `•` fallback.
- `critical` flag editing. No renderer consumes it yet.
- Drag-to-reorder. On backlog.
- Per-area capture-bar routing. Capture stays Focus-only.
- Auto-focus toast Undo button after cascade-delete. M3/M4 inherited limitation.
- Compacting `order` indices after delete + restore. See Known limitations.
- Toast queueing for sequential cascade-deletes. On backlog.

## UX

**Sidebar layout (expanded):**

```
┌─────────────────────┐
│ Ignite              │  ← wordmark (Today link)
│ ≡                   │  ← toggle button
│ ─────────────────── │
│ 🔥 Focus       3   │  ← area row + ⋯ on hover
│ 📚 Studies     8   │
│ 🏠 Personal    2   │
│ ─────────────────── │
│ ＋ New area         │  ← create
└─────────────────────┘
```

**Sidebar layout (collapsed):**

```
┌──┐
│≡ │
│──│
│🔥│
│📚│
│🏠│
└──┘
```

`＋ New area` and all `⋯` buttons are CSS-hidden when `body.is-sidebar-collapsed`.

### Create flow

1. User clicks `＋ New area`.
2. Controller awaits `areas.create({ name: "New area" })` — returns `newArea`.
3. Controller sets `window.location.hash = "#area/" + newArea.id`. Hash change is async; queued event will fire `onHashChange`.
4. Controller immediately calls `sidebar.enterRename(newArea.id)`. This sets `renamingAreaId` + `pendingRenameSelect = true` and triggers `doRender()`. Render may run against stale `lastState` (without the new area) — see **Async-safe enterRename invariant** below.
5. Subsequent `applyState` (from create's notify and from hashchange) re-renders sidebar with the new row. Input mounts. `pendingRenameSelect` consumed → focus + select.
6. User types name → Enter or blur commits via `areas.rename(id, name)`. Trim, capitalize, validate non-empty. Empty trim ⇒ cancel.
7. Esc cancels rename. Focus returns to the row's `⋯` button.

### Rename flow

1. User clicks `⋯` → Rename.
2. View sets `renamingAreaId = areaId`, `pendingRenameSelect = true`, `openAreaMenuId = null`, doRender. Input mounts, focused + selected.
3. Enter or blur commits. Esc cancels. Both restore focus to `⋯` via `pendingFocusAreaId`.

### Move up / Move down

1. User clicks `⋯` → Move up (or Move down).
2. View closes menu (`openAreaMenuId = null`), sets `pendingFocusAreaId = areaId`, calls `callbacks.onMoveAreaUp({ areaId })`.
3. Controller's `moveArea(areaId, "up")` reads the sorted area list, finds neighbour, awaits `areas.swapOrder(target.id, neighbour.id)`.
4. Notify-driven re-render runs; post-render lookup focuses the moved row's `⋯`.
5. At edges, the corresponding button is `disabled` (native HTML attribute; tab order skips it). `isFirst` and `isLast` derive from sorted area list.

### Delete flow (cascade)

1. User clicks `⋯` → Delete (Focus area: button absent — `isUndeletable` suppresses it).
2. View closes menu and calls `callbacks.onDeleteArea({ areaId })`.
3. Controller:
   - **Snapshot first**: read `area`, `sectionsInArea = sections.listByArea(areaId)`, `tasksInArea = tasks.listByArea(areaId)`. *(Adds `tasks.listByArea(areaId)` helper — see Model.)*
   - **Redirect-if-active**: if `currentRoute.name === "area" && currentRoute.id === areaId`, set `window.location.hash = "#today"`. **This must precede any model write.** The synchronous hash assignment queues `onHashChange`, which mounts the Today view. Subsequent applyStates render Today, not the dying area page. Without this ordering, applyState fires between `areas.remove` and the redirect and the user sees an `<h1>Area not found.</h1>` flash.
   - **Remove in cascade order**: `await tasks.removeMany(tasksInArea.map(t => t.id))` → `await sections.removeMany(sectionsInArea.map(s => s.id))` → `await areas.remove(areaId)`.
   - **Show toast** with 8s duration. `onUndo` restores in **reverse-cascade order** (parents before children): `await areas.restore(areaSnapshot)` → `await sections.restoreMany(sectionSnapshots)` → `await tasks.restoreMany(taskSnapshots)`.
4. Toast `aria-live="polite"` announces "<Name> deleted" with cascade count if non-zero (e.g., `"Personal" and 4 tasks deleted` or `"Personal" and 2 sections, 4 tasks deleted`).
5. No auto-navigate-back on undo: the user explicitly navigated elsewhere; respect that. Restored area is reachable via the sidebar.

## Architecture

### Model — `src/model/areas.js`

**Export `FOCUS_ID`.** Currently `const FOCUS_ID = "focus"` is module-local. Change to `export const FOCUS_ID = "focus"` so the sidebar view and controller can reference it for the `isUndeletable` UX hint and the cascade-delete defensive guard.

Expand mutator surface to mirror `src/model/sections.js`:

```js
async rename(id, name) {
    const cleaned = capitalizeFirst(name);
    if (!cleaned) throw new Error("rename(area): name cannot be empty");
    const existing = await db.get("areas", id);
    if (!existing) throw new Error(`Area not found: ${id}`);
    await db.put("areas", { ...existing, name: cleaned });
    notify();
},

async swapOrder(idA, idB) {
    const [a, b] = await Promise.all([
        db.get("areas", idA),
        db.get("areas", idB),
    ]);
    if (!a) throw new Error(`Area not found: ${idA}`);
    if (!b) throw new Error(`Area not found: ${idB}`);
    await Promise.all([
        db.put("areas", { ...a, order: b.order }),
        db.put("areas", { ...b, order: a.order }),
    ]);
    notify();
},

async removeMany(ids) {
    if (ids.some((id) => id === FOCUS_ID)) {
        throw new Error("Cannot delete Focus area");
    }
    await Promise.all(ids.map((id) => db.delete("areas", id)));
    notify();
},

async restore(snapshot) {
    await db.put("areas", { ...snapshot });
    notify();
    return snapshot;
},

async restoreMany(snapshots) {
    await Promise.all(snapshots.map((s) => db.put("areas", { ...s })));
    notify();
},
```

Update `create` to apply `capitalizeFirst(name)` (parallel to sections). `remove(id)` keeps its existing Focus-area throw.

Also update the JSDoc public-API list at the top of the file.

### Model — `src/model/sections.js`

Add `restoreMany`:

```js
async restoreMany(snapshots) {
    await Promise.all(snapshots.map((s) => db.put("sections", { ...s })));
    notify();
},
```

### Model — `src/model/tasks.js`

Add `listByArea(areaId)` helper. Reads all sections in the area, then all tasks whose `sectionId` is in that set, ordered. Used by cascade snapshot.

```js
async listByArea(areaId) {
    const allSections = await db.getAll("sections");
    const sectionIds = new Set(
        allSections.filter((s) => s.areaId === areaId).map((s) => s.id),
    );
    const allTasks = await db.getAll("tasks");
    return allTasks.filter((t) => sectionIds.has(t.sectionId));
},
```

### View — `src/views/sidebar.js`

Full rewrite from stateless renderer (~85 lines) to stateful view (~280 lines). Mirrors `area.js` patterns verbatim where the situation is identical; differences below.

**Closure state:**

```
openAreaMenuId          - area id whose ⋯ menu is open, or null
renamingAreaId          - area id currently in rename mode, or null
pendingFocusAreaId      - after the next render, focus this area's ⋯ button
pendingMenuFocusAreaId  - after the next render, focus first menu item of this area's menu
pendingRenameSelect     - true → next render focuses + selects rename input
pendingRenameValue      - last typed value of the rename input, or null
prevSidebarCollapsed    - tracks settings.sidebarCollapsed across renders
isRendering             - true during innerHTML rewrite (re-entrancy guard for blur listener)
```

**Why `pendingRenameValue`:** the 60s tick (or any unrelated model notify) re-renders the sidebar. The template emits `<input value="${escapeHtml(area.name)}">` — the **last committed** name. After `innerHTML` rewrite, the new input is a fresh DOM element with that old value; the user's in-progress typing is lost. The closure flag is updated on every input event and used in the template instead of `area.name` when `renamingAreaId === area.id`.

**Template use:**
```js
const renameValue = renamingAreaId === area.id
    ? (pendingRenameValue ?? area.name)
    : area.name;
// ... value="${escapeHtml(renameValue)}"
```

**Listener attachment — at the end of `doRender`, after the `innerHTML` rewrite, gated by `isRendering`.** The input element is destroyed and recreated on every render; listeners attached during view construction wouldn't survive. The `isRendering` flag wraps the rewrite so the blur handler can distinguish "user navigated away" from "DOM detached during re-render":

```js
function doRender() {
    if (!lastState) return;

    isRendering = true;
    try {
        rootEl.innerHTML = template(...);
    } finally {
        // try/finally so a defensive template throw doesn't strand
        // isRendering = true and silently swallow all future blur-commits.
        isRendering = false;
    }

    const input = rootEl.querySelector(".sidebar__rename-input");
    if (input) {
        // Update closure on every keystroke; survives subsequent renders.
        input.addEventListener("input", (e) => {
            pendingRenameValue = e.target.value;
        });
        // Blur commits non-empty trimmed value — but ONLY for user-initiated
        // blur. When innerHTML rewrites during tick re-render, the focused
        // input is detached and a synthetic blur fires; we must NOT commit
        // in that case (the rename mode should persist across re-renders).
        // The { once: true } prevents double-commit if Enter also fires.
        input.addEventListener("blur", () => {
            if (isRendering) return;
            if (renamingAreaId) commitRenameFromInput(input);
        }, { once: true });
    }

    // ... focus handling, post-render lookups
}
```

**Why the `isRendering` guard is load-bearing:** modern browsers fire `blur` on a focused element when it's removed from the DOM (via `innerHTML` assignment, `remove()`, etc.). Without the guard, every tick re-render of an active rename would:

1. Capture `template(..., renamingAreaId = X, ...)`.
2. Assign `innerHTML` → old input detached → synthetic blur fires.
3. Blur handler reads `input.value` (still accessible on detached element), commits rename.
4. `renamingAreaId` becomes null mid-rewrite.
5. New input mounts briefly (template was rendered with X), then post-render focus management moves focus to the `⋯` button.

Net: rename mode auto-exits on every tick. The user's typed text is *preserved as a commit*, but they're surprised by being kicked out of rename mode. The guard prevents the spurious commit so rename mode persists across re-renders.

> **Backlog note:** `area.js` for section rename has the same bug today (no guard, blur fires on detach). The unify-and-harden pass must lift this `isRendering` pattern into area.js too.

**Reset rules:**
- `enterRename(id)` — set to `null` BEFORE doRender. New rename starts fresh; the template falls back to `area.name`.
- `commitRenameFromInput` — set to `null` on commit.
- Cancel-rename (Esc, empty commit, collapse-while-renaming) — set to `null`.
- `destroy()` — set to `null` alongside the other closure flags.

> **Note for the unify-and-harden pass on backlog:** the same bug exists in `area.js` for section rename. M5 fixes it for the sidebar; the harden pass should lift the pattern to area.js (and any future task rename) so both views share the invariant.

**Async-safe enterRename invariant:** `enterRename(areaId)` is called from the controller immediately after `areas.create` resolves and the hash is set. `sidebar.lastState` may still be pre-create at that moment (applyState's await buildState in flight). The pending flag survives stale renders — `pendingRenameSelect` stays `true` until whichever render first finds the matching DOM. **Do not await applyState before calling enterRename.** The closure-flag-survives-stale-render pattern is the contract.

**`enterRename` implementation:**

```js
enterRename(areaId) {
    renamingAreaId = areaId;
    pendingRenameSelect = true;
    pendingRenameValue = null; // start fresh — fall back to area.name in template
    openAreaMenuId = null;     // mutually exclusive with menu being open
    doRender();
}
```

**Sidebar collapse force-close:** at the top of `render(state)`, before doRender:

```js
const nextCollapsed = !!state.settings.sidebarCollapsed;
if (prevSidebarCollapsed === false && nextCollapsed === true) {
    // transition expanded → collapsed
    openAreaMenuId = null;
    if (renamingAreaId) {
        const input = rootEl.querySelector(".sidebar__rename-input");
        const value = (input?.value ?? "").trim();
        if (value) callbacks.onCommitAreaRename({ areaId: renamingAreaId, name: value });
        renamingAreaId = null;
        pendingRenameValue = null;
    }
}
prevSidebarCollapsed = nextCollapsed;
```

**Destroy-commit:** mirror `area.js` destroy with explicit flag enumeration:

```js
destroy() {
    if (renamingAreaId) {
        const input = rootEl.querySelector(".sidebar__rename-input");
        const value = (input?.value ?? "").trim();
        if (value) callbacks.onCommitAreaRename({ areaId: renamingAreaId, name: value });
    }
    unbindClick();
    unbindKeys();
    document.removeEventListener("click", docClickHandler);
    document.removeEventListener("keydown", docKeyHandler);
    rootEl.innerHTML = "";

    // Clear every closure flag — explicit list, not "etc."
    lastState = null;
    openAreaMenuId = null;
    renamingAreaId = null;
    pendingFocusAreaId = null;
    pendingMenuFocusAreaId = null;
    pendingRenameSelect = false;
    pendingRenameValue = null;
    prevSidebarCollapsed = null;
    isRendering = false;
}
```

**bindActions wiring** — most handlers mirror `area.js`'s equivalents exactly. The `rename-area` handler has one extra line (`pendingRenameValue = null`) that the mirror would miss, so it's shown explicitly:

```js
"toggle-sidebar":      () => onToggleCollapse(),
"go-today":            () => onGoToday(),
"open-area":           (_, el) => onOpenArea(el.dataset.id),
"add-area":            () => onAddArea(),
"open-area-menu":      (event, el) => { /* mirror open-section-menu */ },
"commit-area-rename":  (_, el) => commitRenameFromInput(el),
"move-area-up":        (_, el) => { /* mirror move-up */ },
"move-area-down":      (_, el) => { /* mirror move-down */ },
"delete-area":         (_, el) => { /* mirror delete-section */ },

"rename-area": (_event, actionEl) => {
    const a = areaFromEvent(actionEl);
    if (!a) return;
    openAreaMenuId = null;
    renamingAreaId = a.id;
    pendingRenameSelect = true;
    pendingRenameValue = null;  // start fresh — required by pendingRenameValue contract
    doRender();
},
```

(`areaFromEvent(actionEl)` mirrors `sectionFromEvent` in area.js — walks up to the `[data-area-id]` ancestor and looks up the area in `lastState.areas`.)

**View helpers** — shown explicitly because each has a sidebar-specific adaptation (`pendingRenameValue` clears, `commit-area-rename` action name, area-id lookup) that a generic "mirror area.js" sketch would miss:

```js
function areaFromEvent(actionEl) {
    const rowEl = actionEl.closest("[data-area-id]");
    if (!rowEl || !lastState) return null;
    return lastState.areas.find((a) => a.id === rowEl.dataset.areaId) ?? null;
}

function commitRenameFromInput(inputEl) {
    const id = inputEl?.dataset?.areaId ?? renamingAreaId;
    if (!id) return;
    const value = (inputEl?.value ?? "").trim();
    renamingAreaId = null;
    pendingFocusAreaId = id;
    pendingRenameValue = null;  // clear after commit/cancel
    if (value) {
        callbacks.onCommitAreaRename({ areaId: id, name: value });
        // model write is async; the model-notify-driven re-render picks
        // up pendingFocusAreaId and focuses the new ⋯ button.
    } else {
        doRender(); // empty/cancel — re-render now to consume the flag
    }
}

function cancelRename() {
    if (!renamingAreaId) return;
    pendingFocusAreaId = renamingAreaId;
    renamingAreaId = null;
    pendingRenameValue = null;  // clear on Esc
    doRender();
}

function closeMenu() {
    if (!openAreaMenuId) return;
    pendingFocusAreaId = openAreaMenuId;
    openAreaMenuId = null;
    doRender();
}

const docClickHandler = (event) => {
    if (rootEl.contains(event.target)) return;
    if (openAreaMenuId) closeMenu();
};
document.addEventListener("click", docClickHandler);

// Esc lives on document, not rootEl. After doRender rewrites innerHTML
// the previously-focused element is detached and focus drops to <body>,
// outside rootEl. A keydown on body bubbles to document only — never
// to rootEl. Matches the area.js pattern.
const docKeyHandler = (event) => {
    if (event.key !== "Escape") return;
    if (renamingAreaId) { cancelRename(); return; }
    if (openAreaMenuId) { closeMenu(); return; }
};
document.addEventListener("keydown", docKeyHandler);

// bindKeys Enter handler — commit on Enter for the rename input.
// The action name is `commit-area-rename` (NOT `commit-rename` like sections).
const unbindKeys = bindKeys(rootEl, {
    Enter: (event, actionEl) => {
        if (renamingAreaId && actionEl?.dataset?.action === "commit-area-rename") {
            event.preventDefault();
            commitRenameFromInput(actionEl);
        }
    },
});
```

**Template:**

```js
function template(state) {
    const route = state.route ?? { name: "today" };
    const todayActive = route.name === "today";
    const items = state.areas
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((area, i) => renderAreaRow(area, state, route, {
            isFirst: i === 0,
            isLast: i === state.areas.length - 1,
            isUndeletable: area.id === FOCUS_ID,
        }))
        .join("");
    return `
        <button class="sidebar__home ${todayActive ? "is-active" : ""}" type="button"
            data-action="go-today"
            ${todayActive ? 'aria-current="page"' : ""}>Ignite</button>
        <button class="sidebar__toggle" type="button"
            data-action="toggle-sidebar" aria-label="Toggle sidebar">
            <span class="sidebar__toggle-glyph" aria-hidden="true">≡</span>
        </button>
        <ul class="sidebar__areas">
            ${items}
            <li class="sidebar__add-area-row">
                <button type="button" class="sidebar__add-area" data-action="add-area">
                    ＋ New area
                </button>
            </li>
        </ul>
    `;
}
```

`renderAreaRow` outputs three states: navigation row (default), navigation row with open menu, rename row. Edge-disabled Move buttons via `isFirst`/`isLast`. Delete item suppressed when `isUndeletable`. Sample render of the navigation state:

```html
<li class="sidebar__area-row" data-area-id="${escapeHtml(area.id)}">
    <button type="button" class="sidebar__area ${active ? "is-active" : ""}"
        data-action="open-area" data-id="${escapeHtml(area.id)}"
        ${active && !isRenaming ? 'aria-current="page"' : ""}>
        <span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
        <span class="sidebar__name">${escapeHtml(area.name)}</span>
        <span class="sidebar__count">${count}</span>
    </button>
    <button type="button" class="sidebar__menu-btn"
        data-action="open-area-menu"
        aria-haspopup="menu"
        aria-expanded="${isOpen}"
        aria-label="Area options: ${escapeHtml(area.name)}">⋯</button>
    ${isOpen ? renderAreaMenu({ isFirst, isLast, isUndeletable }) : ""}
</li>
```

`aria-current="page"` is **not** emitted during rename mode (the row's primary action is editing, not navigating).

Rename state:

```html
<li class="sidebar__area-row sidebar__area-row--editing" data-area-id="${escapeHtml(area.id)}">
    <span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
    <input
        type="text"
        class="sidebar__rename-input"
        value="${escapeHtml(renameValue)}"
        data-action="commit-area-rename"
        data-area-id="${escapeHtml(area.id)}"
        aria-label="Rename area: ${escapeHtml(area.name)}"
        autofocus />
    <!-- aria-label includes the "from" name so SR users know which area is
         being renamed. `autofocus` is redundant with `pendingRenameSelect`
         (which calls input.focus() + input.select() in doRender). Kept for
         parity with section.js's rename input and defense-in-depth on
         first render. -->
</li>
```

`renderAreaMenu`:

```html
<ul class="sidebar-menu" role="menu">
    <li role="none"><button role="menuitem" type="button" class="sidebar-menu__item"
        data-action="rename-area">Rename</button></li>
    <li role="none"><button role="menuitem" type="button" class="sidebar-menu__item"
        data-action="move-area-up" ${upDisabled}>Move up</button></li>
    <li role="none"><button role="menuitem" type="button" class="sidebar-menu__item"
        data-action="move-area-down" ${downDisabled}>Move down</button></li>
    ${isUndeletable ? "" : `<li role="none"><button role="menuitem" type="button"
        class="sidebar-menu__item" data-action="delete-area">Delete</button></li>`}
</ul>
```

CSS class is `.sidebar-menu__item` (not shared with `.section-menu__item`), in keeping with the M4 "section ↔ task menu CSS parity" lesson: separate classes, shared appearance enforced by CSS parity convention. When one changes, mirror in the other.

### Controller — `src/controller.js`

`createController` gains `sidebarCallbacks()`:

```js
function sidebarCallbacks() {
    return {
        onAddArea: async () => {
            const area = await areas.create({ name: "New area" });
            window.location.hash = `#area/${area.id}`;
            sidebar.enterRename(area.id);
        },
        onCommitAreaRename: async ({ areaId, name }) => {
            try { await areas.rename(areaId, name); }
            catch (err) {
                // race: area was just cascade-deleted. Silent drop.
                if (/Area not found/.test(err.message)) return;
                throw err;
            }
        },
        onMoveAreaUp:   async ({ areaId }) => { await moveArea(areaId, "up"); },
        onMoveAreaDown: async ({ areaId }) => { await moveArea(areaId, "down"); },
        onDeleteArea:   async ({ areaId }) => { await deleteAreaCascade(areaId); },
    };
}

async function moveArea(areaId, direction) {
    const all = await areas.list();
    const peers = all.slice().sort((a, b) => a.order - b.order);
    const idx = peers.findIndex((a) => a.id === areaId);
    if (idx < 0) return;
    const neighbourIdx = direction === "up" ? idx - 1 : idx + 1;
    if (neighbourIdx < 0 || neighbourIdx >= peers.length) return;
    const neighbour = peers[neighbourIdx];
    await areas.swapOrder(areaId, neighbour.id);
}

async function deleteAreaCascade(areaId) {
    // 0. Defensive guard — Focus area is never deletable.
    // The UI's `isUndeletable` already hides the Delete item; this guard
    // protects against programmatic calls (dev tools, future bugs).
    // Without it, the cascade would partial-execute: tasks.removeMany
    // would succeed, then sections.removeMany would throw on
    // `focus-default`, leaving Focus's tasks gone and no toast shown.
    if (areaId === FOCUS_ID) return;

    // 1. Snapshot
    const all = await areas.list();
    const areaSnapshot = all.find((a) => a.id === areaId);
    if (!areaSnapshot) return;
    const sectionSnapshots = await sections.listByArea(areaId);
    const taskSnapshots = await tasks.listByArea(areaId);

    // 2. Redirect-if-active — BEFORE any model write
    if (currentRoute.name === "area" && currentRoute.id === areaId) {
        window.location.hash = "#today";
    }

    // 3. Cascade: tasks → sections → area
    await tasks.removeMany(taskSnapshots.map((t) => t.id));
    await sections.removeMany(sectionSnapshots.map((s) => s.id));
    await areas.remove(areaId);

    // 4. Toast — reverse-cascade restore
    toast.show({
        message: cascadeAreaMessage(areaSnapshot.name, sectionSnapshots.length, taskSnapshots.length),
        durationMs: CASCADE_TOAST_MS,
        onUndo: async () => {
            await areas.restore(areaSnapshot);
            await sections.restoreMany(sectionSnapshots);
            await tasks.restoreMany(taskSnapshots);
        },
    });
}

function cascadeAreaMessage(name, sectionCount, taskCount) {
    if (sectionCount === 0 && taskCount === 0) return `"${name}" deleted`;
    const parts = [];
    if (sectionCount === 1) parts.push("1 section");
    else if (sectionCount > 1) parts.push(`${sectionCount} sections`);
    if (taskCount === 1) parts.push("1 task");
    else if (taskCount > 1) parts.push(`${taskCount} tasks`);
    return `"${name}" and ${parts.join(", ")} deleted`;
}
```

`onCommitRename` (the section rename callback in `areaCallbacks`) gains the same swallow-not-found guard, since cascade-delete may race destroy-commit. Change in `controller.js` `areaCallbacks()`:

```js
// Before:
onCommitRename: async ({ sectionId, name }) => {
    await sections.rename(sectionId, name);
},

// After:
onCommitRename: async ({ sectionId, name }) => {
    try { await sections.rename(sectionId, name); }
    catch (err) {
        // Race: section was cascade-deleted (e.g., user deleted the
        // parent area while mid-rename of one of its sections). Drop silently.
        if (/Section not found/.test(err.message)) return;
        throw err;
    }
},
```

`createSidebarView` signature grows: `createSidebarView(rootEl, { onToggleCollapse, onGoToday, onOpenArea, ...sidebarCallbacks })`.

### CSS — `src/main.css`

Additions:

- `.sidebar__area-row` becomes a flex/grid container so `.sidebar__menu-btn` sits to the right of the navigation button. The current `.sidebar__area` (flex row of icon | name | count) stays a child.
- `.sidebar__menu-btn` styling parallel to `.section__menu-btn` (44×44, hover via `--color-bg-hover`, `:focus-visible` outline).
- `.sidebar-menu` styling parallel to `.section-menu` (`position: absolute`, dropdown anchored to row).
- `.sidebar-menu__item` styling parallel to `.section-menu__item` (44px min-block-size, hover, `:disabled` visual disable, `:focus-visible`).
- `.sidebar__rename-input` styling parallel to `.section__rename-input` (inherits sidebar typography, padding to match name span height).
- `.sidebar__add-area` button styling — full-width like `.area__add-section`, muted hover.
- `body.is-sidebar-collapsed`:
  - `.sidebar__menu-btn { display: none; }`
  - `.sidebar__add-area-row { display: none; }`
  - `.sidebar__rename-input { display: none; }` (defensive; rename should already be force-closed on collapse, but this prevents a half-rendered state).
- `prefers-reduced-motion`: no animations introduced; nothing to gate.

No new tokens. Reuse `--color-bg-hover` (M3 token).

## Security

Every user-input interpolation must go through `escapeHtml`. Enumerated sites (sidebar template):

| Site | Source | Risk if unescaped |
|------|--------|-------------------|
| `data-area-id="${...}"` | `area.id` (uuid, system-generated, but escape defensively) | Attribute breakout |
| `.sidebar__icon` text | `area.icon` (user-input later, "" for now) | DOM injection |
| `.sidebar__name` text | `area.name` (user-input) | DOM injection / XSS |
| `aria-label="Area options: ${...}"` | `area.name` | Attribute breakout |
| `value="${...}"` (rename input) | `area.name` or `pendingRenameValue` | Attribute breakout |
| `data-id="${...}"` (nav button) | `area.id` | Attribute breakout |
| Toast message: `"${name}" deleted` | `area.name` (in `cascadeAreaMessage`, then escaped in `toast.show` via `escapeHtml(message)`) | XSS via toast |

Every interpolation in the spec's code samples shows `escapeHtml(...)` literally so the implementer cannot miss it.

`areas.removeMany` validates against `FOCUS_ID` server-side (model layer); the view's `isUndeletable` is a UX hint, not the security boundary.

No new network calls; cascade snapshots live in closure scope and GC after toast dismissal.

## Accessibility

- **Keyboard reachability:** every action is a `<button>`. Tab order: wordmark → toggle → area-1 nav → area-1 `⋯` → area-2 nav → area-2 `⋯` → … → `＋ New area`.
- **`⋯` button:** `aria-haspopup="menu"`, `aria-expanded="${isOpen}"`, `aria-label="Area options: ${escapeHtml(area.name)}"`.
- **Menu:** `role="menu"` on `<ul>`, `role="menuitem"` on each `<button>`. Mouse-opened: focus stays on `⋯`. Keyboard-opened (Enter on `⋯`, detected via `event.detail === 0` heuristic): focus moves to first menu item via `pendingMenuFocusAreaId`.
- **Rename input:** `aria-label="Rename area"`. The visible label (name span) is replaced by the input, so the input must announce its purpose. Visible-label invariant for the surrounding `<li>` is preserved via `<span class="sidebar__icon" aria-hidden="true">` keeping the area's icon visible during rename.
- **`aria-current="page"`:** preserved on the area-navigation `<button>` (not the `<li>`). Conditional on `route.name === "area" && route.id === area.id && !isRenaming`. Wordmark gets `aria-current="page"` when `route.name === "today"`.
- **Touch targets:** `.sidebar-menu__item` and `.sidebar__menu-btn` ≥ 44×44 px.
- **`prefers-reduced-motion`:** no animations on rename/move/delete; nothing to gate.
- **Toast:** `aria-live="polite"` (existing toast view). Cascade message announces the area name and count.
- **No SR live announcement on move.** Focus return is the only audible feedback; visual position change is implicit. Matches M3/M4 reorder behavior.

## Privacy

All M5 state stays in IndexedDB. No new network calls. No telemetry. No third-party requests. Cascade snapshots held in JS closures, GC'd after toast dismissal.

## Async-safe invariants

Pulled out for emphasis — these are easy to misunderstand and break.

1. **`enterRename` survives stale lastState.** Calling `sidebar.enterRename(newId)` immediately after `areas.create` resolves is safe even though `lastState` doesn't yet include the new area. `pendingRenameSelect` stays `true` until whichever render first finds the matching DOM. **Do not await applyState before calling enterRename.**

2. **`pendingRenameValue` survives tick re-renders.** The 60s tick (or any unrelated notify) fires `applyState` → `sidebar.render(state)` → `doRender()` → `innerHTML` rewrite. The new input element is fresh; the user's in-progress typing would be lost without the closure-flag pattern. Update on every `input` event; use in `template()`; clear on commit/cancel.

3. **Cascade-delete sequence: snapshot → redirect → remove (tasks → sections → area) → toast.** Redirect **before** any model write. Without this ordering, applyState fires between `areas.remove` and the redirect and the user sees an "Area not found" flash.

4. **Cascade-restore reverse-order: areas → sections → tasks.** Parents before children. View filters rely on parent records existing during intermediate states.

5. **Rename-commit silently drops `Area not found` and `Section not found`.** Both renames can race with cascade-delete. Suppress the throw in the controller's `onCommitAreaRename` and `onCommitRename` rather than coupling views to cascade state.

6. **Sidebar collapse force-closes menus + commits rename.** `prev → next` boolean transition detected in `render(state)` triggers cleanup. Without this, closure state desyncs and re-expanding the sidebar shows a stale menu / orphaned rename input.

## Known limitations (M5 documents, doesn't fix)

- **Tied `order` indices after cascade-undo + intervening create.** Restored area may share `order` with a newly created area. Sort is stable; visual position is deterministic but the user sees two rows at "the same logical position." Out of scope; reconciliation would require recomputing order on every mutation. Backlog: "compact order indices" pass.
- **Mainroot flash during auto-navigate-create.** Between `mountMainView(area)` destroying the previous view and the first applyState's render, `mainRoot` is empty (~30ms). Existing M2/M3 behavior for every route change. Not new to M5.
- **Toast last-wins.** Sequential cascade-deletes within 8s: the second toast replaces the first; first's undo is lost (snapshot becomes unreachable, GC'd). On backlog.
- **No auto-focus to toast Undo button.** Sighted keyboard users must Tab to Undo. SR users hear `aria-live`. M3/M4 inherited.
- **`pendingFocusAreaId` ↔ 60s tick race.** Same shape as `pendingFocusSectionId` / `pendingFocusTaskId`: tick re-render between the move click and the swap-driven re-render can consume the flag prematurely. Window is small. Unify-and-harden pass on backlog.
- **Section rename retains its own `pendingRenameValue` gap** until the unify-and-harden pass lifts the pattern from sidebar.js into area.js. M5 closes the sidebar-side bug; area.js gets the fix in the unify pass.
- **Rapid `＋ New area` clicks create multiple stale "New area" rows.** Each click fires an independent `areas.create` + hash change + `enterRename`. Only the last `enterRename` is interactive; earlier ones blur-commit with the default name "New area." Net: user has duplicate "New area" rows to rename or delete manually. Not worth a debounce or button-disable in M5 — accept.

## Tests

TDD on the model seam. **Expected new tests: 10.** Test count 93 → 103.

`tests/unit/areas.test.js` — new or extended:

1. `areas.rename` writes the new name with `capitalizeFirst` applied.
2. `areas.rename` throws on missing id and on empty/whitespace name.
3. `areas.swapOrder` swaps order values between two areas in one notify.
4. `areas.swapOrder` throws on either id missing.
5. `areas.removeMany` deletes all and fires one notify.
6. `areas.removeMany` throws if any id is `FOCUS_ID` (defensive — UX layer already blocks).
7. `areas.restore` writes the snapshot back and notifies.
8. `areas.restoreMany` writes all and fires one notify.

`tests/unit/sections.test.js` — extended:

9. `sections.restoreMany` writes all and fires one notify.

`tests/unit/tasks.test.js` — extended:

10. `tasks.listByArea(areaId)` returns all tasks whose section belongs to the area, regardless of section.

Controller and view changes are verified manually (E2E walkthrough).

## Done criteria

1. `npm test` reports 103/103 green.
2. `npx biome check .` is clean.
3. In a real browser:
   - **Create**: click `＋ New area` → URL becomes `#area/<new-id>` → sidebar shows row in rename mode with "New area" selected → type "Test" → Enter → row reads "🔥 Test" (or `•` icon).
   - **Rename**: `⋯` → Rename → input mounts with current name selected → type → Enter commits. Esc cancels. Blur commits non-empty trimmed value.
   - **Tick test**: enter rename, type a partial name, wait for the next 60s tick (or fire one via `setInterval` callback). Typed text **persists** in the input. (M5 fix verified.)
   - **Move**: `⋯` → Move up/down → row moves; focus returns to `⋯`. Edges have correct `disabled` state. Focus area can move down past user-created areas; user-created can move up past Focus.
   - **Delete cascade**:
     - Delete from a non-active area: sidebar drops the row, toast appears ("X and N tasks deleted" or variants), main view unchanged. Undo restores everything; sidebar reappears.
     - Delete from the active area: URL changes to `#today`, sidebar drops the row, toast appears. No "Area not found" flash. Undo restores; user stays on Today.
   - **Focus area**: `⋯` menu shows Rename / Move up / Move down only; no Delete item. `Cannot delete Focus area` error is impossible to trigger via UI.
   - **Sidebar collapse mid-rename**: toggle the sidebar while a rename input is active. Rename commits (if value non-empty) or cancels (if empty). Re-expanding shows no orphaned input.
   - **Sidebar collapse mid-menu**: toggle while a menu is open. Menu closes. Re-expanding shows no stale menu.
   - **Screen reader (Narrator or NVDA)**: `⋯` button reads "Area options: Personal, collapsed/expanded." Rename input reads "Rename area, edit." Toast reads "Personal and 2 tasks deleted."
4. M3 section CRUD still works (regression check).
5. M4 task reorder still works (regression check).
6. Capture bar still works on both routes (regression check).

## Out-of-scope follow-ups noted

- Icon picker for areas (defer).
- `critical` flag editing + rendering (defer).
- Drag-to-reorder areas + sections + tasks (backlog).
- Compact `order` indices after delete (backlog).
- Toast queueing for sequential cascade-deletes (backlog).
- Auto-focus toast Undo button after cascade-delete (backlog).
- Per-area capture-bar default section (backlog).
- Unify-and-harden pass on `pending*` closure flags + `pendingRenameValue` lift to area.js (backlog).
- `aria-live` announcement on reorder (backlog).
