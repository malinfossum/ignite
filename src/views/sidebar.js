// createSidebarView(rootEl, {
//   onToggleCollapse, onGoToday, onOpenArea,
//   onAddArea, onCommitAreaRename, onMoveAreaUp, onMoveAreaDown, onDeleteArea,
// }) → { render(state), enterRename(areaId), destroy() }
//
// state expected: { areas, sections, tasks, settings, route, now }
// route:
//   { name: "today" }            → wordmark gets aria-current="page"
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

export function createSidebarView(
	rootEl,
	{
		onToggleCollapse,
		onGoToday,
		onOpenArea,
		onAddArea,
		onCommitAreaRename,
		onMoveAreaUp,
		onMoveAreaDown,
		onDeleteArea,
	},
) {
	let lastState = null;
	let openAreaMenuId = null;
	let renamingAreaId = null;
	let pendingFocusAreaId = null;
	let pendingFocusAreaButtonId = null;
	let pendingMenuFocusAreaId = null;
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
	const docKeyHandler = (event) => {
		if (event.key !== "Escape") return;
		if (renamingAreaId) {
			cancelRename();
			return;
		}
		if (openAreaMenuId) {
			closeMenu();
		}
	};
	document.addEventListener("keydown", docKeyHandler);

	const unbindClick = bindActions(rootEl, {
		"toggle-sidebar": () => onToggleCollapse(),
		"go-today": () => onGoToday(),

		"open-area": (_event, actionEl) => {
			const id = actionEl.dataset.id;
			if (id) onOpenArea(id);
		},

		"add-area": () => onAddArea(),

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
			const a = areaFromEvent(actionEl);
			if (!a) return;
			openAreaMenuId = null;
			renamingAreaId = a.id;
			pendingRenameSelect = true;
			pendingRenameValue = null; // start fresh — required by pendingRenameValue contract
			doRender();
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
	});

	const unbindKeys = bindKeys(rootEl, {
		Enter: (event, actionEl) => {
			if (
				renamingAreaId &&
				actionEl?.dataset?.action === "commit-area-rename"
			) {
				event.preventDefault();
				commitRenameFromInput(actionEl);
			}
		},
	});

	function doRender() {
		if (!lastState) return;

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

		// Re-attach input + blur listeners on the NEW input. Both must be
		// re-attached on every render because the element is recreated.
		const input = rootEl.querySelector(".sidebar__rename-input");
		if (input) {
			input.addEventListener("input", (e) => {
				pendingRenameValue = e.target.value;
			});
			// Blur commits, but ONLY for user-initiated blur. When innerHTML
			// rewrites during tick re-render, the focused input is detached
			// and a synthetic blur fires; we must NOT commit in that case
			// (rename mode should persist across re-renders).
			input.addEventListener(
				"blur",
				() => {
					if (isRendering) return;
					if (renamingAreaId) commitRenameFromInput(input);
				},
				{ once: true },
			);

			// Rename input focus handling — only select() on first render
			// after entering rename mode. Subsequent re-renders preserve cursor.
			if (pendingRenameSelect) {
				input.focus();
				input.select();
				pendingRenameSelect = false;
			} else if (document.activeElement !== input) {
				input.focus();
			}
		}

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
	const route = state.route ?? { name: "today" };
	const todayActive = route.name === "today";
	const wordmarkAria = todayActive ? 'aria-current="page"' : "";
	const wordmarkActive = todayActive ? "is-active" : "";

	const sorted = state.areas.slice().sort((a, b) => a.order - b.order);
	// Focus is pinned to the top; only user areas reorder among themselves.
	const userAreas = sorted.filter((a) => a.id !== FOCUS_ID);
	const firstUserAreaId = userAreas[0]?.id ?? null;
	const lastUserAreaId = userAreas[userAreas.length - 1]?.id ?? null;
	const items = sorted
		.map((area) => {
			const isFocus = area.id === FOCUS_ID;
			return renderAreaRow(area, state, route, {
				// Focus is pinned (no moves). A user area can move up unless it's
				// directly below Focus, and down unless it's the last row.
				canMoveUp: !isFocus && area.id !== firstUserAreaId,
				canMoveDown: !isFocus && area.id !== lastUserAreaId,
				isUndeletable: isFocus,
				openAreaMenuId,
				renamingAreaId,
				pendingRenameValue,
			});
		})
		.join("");

	return `
		<button class="sidebar__home ${wordmarkActive}" type="button"
			data-action="go-today" ${wordmarkAria}>Ignite</button>
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

	return `
		<li class="sidebar__area-row" data-area-id="${escapeHtml(area.id)}">
			<button type="button" class="sidebar__area ${activeClass}"
				data-action="open-area" data-id="${escapeHtml(area.id)}" ${aria}>
				<span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
				<span class="sidebar__name">${escapeHtml(area.name)}</span>
				<span class="sidebar__count">${count}</span>
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
				<button role="menuitem" type="button" class="sidebar-menu__item"
					data-action="move-area-up">Move up</button>
			</li>`
		: "";
	const moveDownItem = canMoveDown
		? `<li role="none">
				<button role="menuitem" type="button" class="sidebar-menu__item"
					data-action="move-area-down">Move down</button>
			</li>`
		: "";
	const deleteItem = isUndeletable
		? ""
		: `<li role="none">
				<button role="menuitem" type="button" class="sidebar-menu__item"
					data-action="delete-area">Delete</button>
			</li>`;
	return `
		<ul class="sidebar-menu" role="menu">
			<li role="none">
				<button role="menuitem" type="button" class="sidebar-menu__item"
					data-action="rename-area">Rename</button>
			</li>
			${moveUpItem}
			${moveDownItem}
			${deleteItem}
		</ul>
	`;
}
