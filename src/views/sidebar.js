// createSidebarView(rootEl, {
//   onToggleCollapse, onGoFocus, onOpenArea,
//   onAddArea, onCommitAreaRename, onMoveAreaUp, onMoveAreaDown, onDeleteArea,
//   onCloseDrawer, onCycleTheme, onPickAreaIcon,
// }) → { render(state), enterRename(areaId), destroy() }
//
// state expected: { areas, sections, tasks, settings, route, now, themeChoice, theme }
// route:
//   { name: "focus" }            → wordmark gets aria-current="page"
//   { name: "area", id: "..." }  → matching area row gets aria-current="page"
//
// Closure state (all reset to initial values in destroy()):
//   openAreaMenuId          - area id whose ⋯ menu is open, or null
//   renamingAreaId          - area id currently in rename mode, or null
//   pendingFocusAreaId      - after the next render, focus this area's ⋯ button
//   pendingMenuFocusAreaId  - after the next render, focus first menu item
//   pendingRenameSelect     - true → next render focuses + selects rename input
//   pendingRenameValue      - last typed value of rename input, or null
//   prevSidebarCollapsed    - tracks settings.sidebarCollapsed across renders
//   isRendering             - true during innerHTML rewrite (blur-listener re-entrancy guard)
//
// We do NOT capture element references for focus return. Across an innerHTML
// rewrite, captured elements detach and .focus() on them is a silent no-op.
// The pending* flags + post-render lookups by data-attribute work because
// they query the freshly-rendered DOM.

import { FOCUS_ID } from "../model/areas.js";
import { bindActions, bindKeys, escapeHtml } from "../utils/dom.js";
import { focusCounts } from "../utils/focus-counts.js";
import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../utils/menu-keyboard.js";
import { attachRenameInput, readRenameCaret } from "../utils/rename-input.js";
import { renderIconPicker } from "./icon-picker.js";

const THEME_GLYPH = { system: "◐", light: "☀", dark: "☾" };
const THEME_WORD = { system: "system", light: "light", dark: "dark" };

export function createSidebarView(
	rootEl,
	{
		onToggleCollapse,
		onGoFocus,
		onOpenArea,
		onAddArea,
		onCommitAreaRename,
		onMoveAreaUp,
		onMoveAreaDown,
		onDeleteArea,
		onCloseDrawer,
		onCycleTheme,
		onPickAreaIcon,
	},
) {
	let lastState = null;
	let openAreaMenuId = null;
	let renamingAreaId = null;
	let pendingFocusAreaId = null;
	let pendingFocusAreaButtonId = null;
	let pendingMenuFocusAreaId = null;
	let pendingFocusAreaIcon = null; // { areaId, icon } — consumed by the next render
	let pendingFocusHome = false; // → focus the "Ignite" wordmark (the Today nav item)
	let pendingRenameSelect = false;
	let pendingRenameValue = null;
	let prevSidebarCollapsed = null;
	let isRendering = false;

	function areaFromEvent(actionEl) {
		const rowEl = actionEl.closest("[data-area-id]");
		if (!rowEl || !lastState) return null;
		return lastState.areas.find((a) => a.id === rowEl.dataset.areaId) ?? null;
	}

	function closeMenu() {
		if (!openAreaMenuId) return;
		pendingFocusAreaId = openAreaMenuId;
		openAreaMenuId = null;
		doRender();
	}

	function cancelRename() {
		if (!renamingAreaId) return;
		pendingFocusAreaButtonId = renamingAreaId;
		renamingAreaId = null;
		pendingRenameValue = null;
		doRender();
	}

	// Single entry point into area rename — shared by the ⋯-menu "Rename"
	// action and the F2 shortcut. Idempotent on the already-renaming area.
	function enterAreaRename(a) {
		if (!a || renamingAreaId === a.id) return;
		openAreaMenuId = null;
		renamingAreaId = a.id;
		pendingRenameSelect = true;
		pendingRenameValue = null; // start fresh — pendingRenameValue contract
		doRender();
	}

	function commitRenameFromInput(inputEl) {
		const id = inputEl?.dataset?.areaId ?? renamingAreaId;
		if (!id) return;
		const value = (inputEl?.value ?? "").trim();
		renamingAreaId = null;
		pendingFocusAreaButtonId = id;
		pendingRenameValue = null;
		if (value) {
			onCommitAreaRename({ areaId: id, name: value });
			// Model write is async; the model-notify-driven re-render picks
			// up pendingFocusAreaButtonId and focuses the renamed area's row button.
		} else {
			doRender(); // empty/cancel — re-render now to consume the flag
		}
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
	function findOpenMenuInSidebar(target) {
		if (!openAreaMenuId) return null;
		const menu = rootEl.querySelector(
			`[data-area-id="${CSS.escape(openAreaMenuId)}"] [role="menu"]`,
		);
		return menu?.contains(target) ? menu : null;
	}

	const docKeyHandler = (event) => {
		if (event.key === "Escape") {
			if (renamingAreaId) {
				cancelRename();
				return;
			}
			if (openAreaMenuId) {
				closeMenu();
				return;
			}
			onCloseDrawer?.(); // nothing internal consumed Esc → ask controller to close the drawer
			return;
		}

		const menuEl = findOpenMenuInSidebar(event.target);
		if (!menuEl) return;

		const menuItems = Array.from(menuEl.querySelectorAll('[role="menuitem"]'));
		const currentIndex = menuItems.indexOf(event.target);
		const items = menuItems.map((el) => ({ disabled: el.disabled }));

		let nextIdx = -1;
		switch (event.key) {
			case "ArrowDown":
				nextIdx = nextEnabledIndex(items, currentIndex, 1);
				break;
			case "ArrowUp":
				nextIdx = nextEnabledIndex(items, currentIndex, -1);
				break;
			case "Home":
				nextIdx = firstEnabledIndex(items);
				break;
			case "End":
				nextIdx = lastEnabledIndex(items);
				break;
			case "Tab":
				event.preventDefault();
				closeMenu();
				return;
			default:
				return;
		}

		event.preventDefault();
		if (nextIdx >= 0) menuItems[nextIdx].focus();
	};
	document.addEventListener("keydown", docKeyHandler);

	const unbindClick = bindActions(rootEl, {
		"toggle-sidebar": () => onToggleCollapse(),
		"go-focus": () => onGoFocus(),

		"open-area": (_event, actionEl) => {
			const id = actionEl.dataset.id;
			if (id) onOpenArea(id);
		},

		"add-area": () => onAddArea(),

		"cycle-theme": () => onCycleTheme(),

		"open-area-menu": (event, actionEl) => {
			event.stopPropagation();
			const a = areaFromEvent(actionEl);
			if (!a) return;
			if (openAreaMenuId === a.id) {
				closeMenu();
				return;
			}
			openAreaMenuId = a.id;
			// Heuristic: keyboard activations (Enter/Space) report
			// event.detail === 0; mouse clicks report >= 1. When opened
			// via keyboard, move focus to the first menu item.
			if (event.detail === 0) {
				pendingMenuFocusAreaId = a.id;
			}
			doRender();
		},

		"rename-area": (_event, actionEl) => {
			enterAreaRename(areaFromEvent(actionEl));
		},

		// No "commit-area-rename" click action: the rename input carries
		// data-action="commit-area-rename" only so the Enter key handler
		// (bindKeys, which reads the attribute) can find it. Wiring it as a
		// CLICK action too would commit + exit rename whenever the user clicks
		// inside the field to position the cursor. Enter and blur are the only
		// commit paths.

		"move-area-up": (_event, actionEl) => {
			const a = areaFromEvent(actionEl);
			openAreaMenuId = null;
			if (a) {
				pendingFocusAreaId = a.id;
				onMoveAreaUp({ areaId: a.id });
			}
		},

		"move-area-down": (_event, actionEl) => {
			const a = areaFromEvent(actionEl);
			openAreaMenuId = null;
			if (a) {
				pendingFocusAreaId = a.id;
				onMoveAreaDown({ areaId: a.id });
			}
		},

		"delete-area": (_event, actionEl) => {
			const a = areaFromEvent(actionEl);
			openAreaMenuId = null;
			// No pendingFocusAreaId — the row is about to vanish.
			// The toast appears (announced via aria-live) and the user
			// Tabs to Undo from there.
			if (a) onDeleteArea({ areaId: a.id });
		},

		"pick-area-icon": (_event, actionEl) => {
			const row = actionEl.closest("[data-area-id]");
			if (row) onPickAreaIcon(row.dataset.areaId, actionEl.dataset.icon);
		},
	});

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

	const unbindKeys = bindKeys(rootEl, {
		Enter: (event, actionEl) => {
			if (event.isComposing) return; // IME mid-composition: Enter confirms the candidate, doesn't commit
			if (
				renamingAreaId &&
				actionEl?.dataset?.action === "commit-area-rename"
			) {
				event.preventDefault();
				commitRenameFromInput(actionEl);
			}
		},
		F2: (event) => {
			const a = areaFromEvent(event.target);
			if (a) enterAreaRename(a);
		},
		ArrowRight: (event) => moveIconFocus(event, 1),
		ArrowLeft: (event) => moveIconFocus(event, -1),
		ArrowDown: (event) => moveIconFocus(event, 1),
		ArrowUp: (event) => moveIconFocus(event, -1),
		Home: (event) => moveIconFocus(event, 0, firstEnabledIndex),
		End: (event) => moveIconFocus(event, 0, lastEnabledIndex),
	});

	function doRender() {
		if (!lastState) return;

		// Caret is read BEFORE the rewrite detaches the live input; the shared
		// helper re-focuses and restores it after re-render. See utils/rename-input.js.
		const renameCaret = readRenameCaret(rootEl, ".sidebar__rename-input");

		isRendering = true;
		try {
			rootEl.innerHTML = template(lastState, {
				openAreaMenuId,
				renamingAreaId,
				pendingRenameValue,
			});
		} finally {
			// try/finally so a defensive template throw doesn't strand
			// isRendering=true and silently swallow all future blur-commits.
			isRendering = false;
		}

		// Re-wire the inline-rename input (recreated on every render). The shared
		// helper mirrors typing, commits on user blur (not the synthetic detach
		// blur), and focuses+selects or restores the caret. See utils/rename-input.js.
		const attached = attachRenameInput(rootEl, ".sidebar__rename-input", {
			onInput: (value) => {
				pendingRenameValue = value;
			},
			onCommit: commitRenameFromInput,
			isRendering: () => isRendering,
			isEditing: () => !!renamingAreaId,
			selectOnFocus: pendingRenameSelect,
			caret: renameCaret,
		});
		if (attached) pendingRenameSelect = false;

		// Post-render lookup: focus the area's ⋯ button by data-attribute.
		// This is how we restore focus after innerHTML rewrites — element
		// references captured BEFORE the rewrite are detached and can't
		// receive focus.
		if (pendingFocusAreaId) {
			const trigger = rootEl.querySelector(
				`[data-area-id="${CSS.escape(pendingFocusAreaId)}"] .sidebar__menu-btn`,
			);
			trigger?.focus();
			pendingFocusAreaId = null;
		}

		// After a rename commit/cancel, return focus to the area's own button
		// (the renamed row), NOT the ⋯ menu button.
		if (pendingFocusAreaButtonId) {
			const areaBtn = rootEl.querySelector(
				`[data-area-id="${CSS.escape(pendingFocusAreaButtonId)}"] .sidebar__area`,
			);
			areaBtn?.focus();
			pendingFocusAreaButtonId = null;
		}

		// Post-render lookup: when the menu was opened via keyboard, move
		// focus to the first menu item.
		if (pendingMenuFocusAreaId) {
			const firstItem = rootEl.querySelector(
				`[data-area-id="${CSS.escape(pendingMenuFocusAreaId)}"] [role="menu"] [role="menuitem"]:first-child`,
			);
			firstItem?.focus();
			pendingMenuFocusAreaId = null;
		}

		// Post-render lookup: an area cascade delete removed the row whose ⋯
		// had focus and redirected to #focus, so focus would fall to <body>.
		// The wordmark IS the Focus nav item — focusing it lands the user
		// where the redirect took them.
		//
		// Cleared UNCONDITIONALLY; skipped while a rename is live so it can't
		// steal focus out of an open rename input.
		if (pendingFocusHome) {
			pendingFocusHome = false;
			if (!renamingAreaId) {
				rootEl.querySelector(".sidebar__home")?.focus();
			}
		}

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
	}

	return {
		render(state) {
			lastState = state;

			// Sidebar collapse force-close: when sidebar transitions from
			// expanded → collapsed, close any open menu and commit-or-cancel
			// any active rename. Without this, closure state desyncs and
			// re-expanding shows a stale menu or orphaned input.
			const nextCollapsed = !!state.settings.sidebarCollapsed;
			if (prevSidebarCollapsed === false && nextCollapsed === true) {
				openAreaMenuId = null;
				if (renamingAreaId) {
					const input = rootEl.querySelector(".sidebar__rename-input");
					const value = (input?.value ?? "").trim();
					if (value)
						onCommitAreaRename({ areaId: renamingAreaId, name: value });
					renamingAreaId = null;
					pendingRenameValue = null;
				}
			}
			prevSidebarCollapsed = nextCollapsed;

			doRender();
		},

		// Controller hook: after an area cascade delete, put focus on the
		// wordmark (= the Today nav item, where the redirect just sent the
		// user). Sets the pending flag ONLY — the controller's applyState()
		// after its model writes provides the consuming render.
		focusHome() {
			pendingFocusHome = true;
		},

		// Controller hook: after picking an area icon, put focus back on that
		// option. Sets the pending flag ONLY — the controller's second
		// applyState() after the drain provides the consuming render.
		focusAreaIcon(areaId, icon) {
			pendingFocusAreaIcon = { areaId, icon };
		},

		// Public hook for the controller to flip a freshly-created area
		// into rename mode without the view subscribing to model changes.
		enterRename(areaId) {
			renamingAreaId = areaId;
			pendingRenameSelect = true;
			pendingRenameValue = ""; // start EMPTY so the default "New area" name needn't be deleted
			openAreaMenuId = null; // mutually exclusive with menu being open
			doRender();
		},

		destroy() {
			// Destroy-commit: if a rename is in flight and the input has a
			// non-empty trimmed value, commit it before tearing down so
			// typed work isn't silently lost.
			if (renamingAreaId) {
				const input = rootEl.querySelector(".sidebar__rename-input");
				const value = (input?.value ?? "").trim();
				if (value) onCommitAreaRename({ areaId: renamingAreaId, name: value });
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
			pendingFocusAreaButtonId = null;
			pendingMenuFocusAreaId = null;
			pendingFocusHome = false;
			pendingFocusAreaIcon = null;
			pendingRenameSelect = false;
			pendingRenameValue = null;
			prevSidebarCollapsed = null;
			isRendering = false;
		},
	};
}

function template(
	state,
	{ openAreaMenuId, renamingAreaId, pendingRenameValue },
) {
	const route = state.route ?? { name: "focus" };
	const focusActive = route.name === "focus";
	const wordmarkAria = focusActive ? 'aria-current="page"' : "";
	const wordmarkActive = focusActive ? "is-active" : "";

	// Same derivation as the page-header summary and the Focus tab counts.
	const { overdue, dueToday, attention } = focusCounts(
		state.sections,
		state.tasks,
		state.now,
		FOCUS_ID,
	);
	const focusArea = state.areas.find((a) => a.id === FOCUS_ID);
	const focusMark = focusArea?.icon || "🔥";
	// Numbers only — no user-authored text reaches this string.
	const focusMeta =
		overdue > 0
			? `Focus · <strong class="sidebar__home-overdue">${overdue} overdue</strong> · ${dueToday} due today`
			: `Focus · ${dueToday} due today`;
	const focusName =
		overdue > 0
			? `Ignite, Focus, ${overdue} overdue, ${dueToday} due today`
			: `Ignite, Focus, ${dueToday} due today`;
	const homeBadgeClass =
		attention === 0 ? "sidebar__home-badge is-zero" : "sidebar__home-badge";

	const sorted = state.areas.slice().sort((a, b) => a.order - b.order);
	// Focus is no longer a listed area — it IS the landing surface, reached by
	// the wordmark above. Listing it as well would be a second door onto the same
	// tasks, and its rename and icon controls belong to a surface that no longer
	// exists here. Spec D1.
	const userAreas = sorted.filter((a) => a.id !== FOCUS_ID);
	const firstUserAreaId = userAreas[0]?.id ?? null;
	const lastUserAreaId = userAreas[userAreas.length - 1]?.id ?? null;
	const items = userAreas
		.map((area) =>
			renderAreaRow(area, state, route, {
				canMoveUp: area.id !== firstUserAreaId,
				canMoveDown: area.id !== lastUserAreaId,
				isUndeletable: false,
				openAreaMenuId,
				renamingAreaId,
				pendingRenameValue,
			}),
		)
		.join("");

	return `
		<button class="sidebar__home ${wordmarkActive}" type="button"
			data-action="go-focus" ${wordmarkAria} aria-label="${focusName}">
			<span class="sidebar__home-mark" aria-hidden="true">${escapeHtml(focusMark)}</span>
			<span class="sidebar__home-body" aria-hidden="true">
				<span class="sidebar__home-name">Ignite</span>
				<span class="sidebar__home-meta">${focusMeta}</span>
			</span>
			<span class="${homeBadgeClass}" aria-hidden="true">${attention}</span>
		</button>
		<button class="sidebar__toggle" type="button"
			data-action="toggle-sidebar" aria-label="Toggle sidebar">
			<span class="sidebar__toggle-glyph" aria-hidden="true">≡</span>
		</button>
		<ul class="sidebar__areas">
			${items}
			<li class="sidebar__add-area-row">
				<button type="button" class="sidebar__add-area" data-action="add-area"
					aria-label="New area">
					<span class="sidebar__add-glyph" aria-hidden="true">＋</span>
					<span class="sidebar__add-text" aria-hidden="true">New area</span>
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
}

function renderAreaRow(area, state, route, opts) {
	const {
		canMoveUp,
		canMoveDown,
		isUndeletable,
		openAreaMenuId,
		renamingAreaId,
		pendingRenameValue,
	} = opts;
	const isOpen = openAreaMenuId === area.id;
	const isRenaming = renamingAreaId === area.id;
	const active = route.name === "area" && route.id === area.id;

	if (isRenaming) {
		const renameValue = pendingRenameValue ?? area.name;
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
	}

	const sectionIds = new Set(
		state.sections.filter((s) => s.areaId === area.id).map((s) => s.id),
	);
	const count = state.tasks.filter(
		(t) => sectionIds.has(t.sectionId) && !t.completed,
	).length;

	const activeClass = active ? "is-active" : "";
	const aria = active ? 'aria-current="page"' : "";
	const menu = isOpen
		? renderAreaMenu({ canMoveUp, canMoveDown, isUndeletable })
		: "";

	// The accessible name lives on the button, not in its children. In the rail
	// the label and count are not painted, and a name assembled from painted
	// children would vanish with them — the exact defect this replaces. Both
	// spans are aria-hidden so the name is stated once, identically, in both
	// states. WCAG 2.5.3 holds: the visible "Hjemme" is contained in "Hjemme, 3 open".
	const countClass = count === 0 ? "sidebar__count is-zero" : "sidebar__count";

	return `
		<li class="sidebar__area-row" data-area-id="${escapeHtml(area.id)}">
			<button type="button" class="sidebar__area ${activeClass}"
				data-action="open-area" data-id="${escapeHtml(area.id)}" ${aria}
				aria-label="${escapeHtml(area.name)}, ${count} open">
				<span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
				<span class="sidebar__name" aria-hidden="true">${escapeHtml(area.name)}</span>
				<span class="${countClass}" aria-hidden="true">${count}</span>
			</button>
			<button type="button" class="sidebar__menu-btn"
				data-action="open-area-menu"
				aria-haspopup="menu"
				aria-expanded="${isOpen}"
				aria-label="Area options: ${escapeHtml(area.name)}">⋯</button>
			${menu}
		</li>
	`;
}

function renderAreaMenu({ canMoveUp, canMoveDown, isUndeletable }) {
	const moveUpItem = canMoveUp
		? `<li role="none">
				<button role="menuitem" tabindex="-1" type="button" class="sidebar-menu__item"
					data-action="move-area-up">Move up</button>
			</li>`
		: "";
	const moveDownItem = canMoveDown
		? `<li role="none">
				<button role="menuitem" tabindex="-1" type="button" class="sidebar-menu__item"
					data-action="move-area-down">Move down</button>
			</li>`
		: "";
	const deleteItem = isUndeletable
		? ""
		: `<li role="none">
				<button role="menuitem" tabindex="-1" type="button" class="sidebar-menu__item"
					data-action="delete-area">Delete</button>
			</li>`;
	return `
		<ul class="sidebar-menu" role="menu">
			<li role="none">
				<button role="menuitem" tabindex="-1" type="button" class="sidebar-menu__item"
					data-action="rename-area">Rename</button>
			</li>
			${moveUpItem}
			${moveDownItem}
			${deleteItem}
		</ul>
	`;
}
