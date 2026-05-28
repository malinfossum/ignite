// createTodayView(rootEl, { onToggleComplete, onToggleStar, onDelete })
//   → { render(state), destroy() }
//
// state expected: { tasks, sections, areas, settings, now }
// onDelete receives the full task object so the controller can restore it.

import { bindActions } from "../utils/dom.js";
import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../utils/menu-keyboard.js";
import { groupTasksForToday, pickNextTask } from "../utils/time.js";
import { renderTaskRow } from "./task.js";

export function createTodayView(rootEl, callbacks) {
	let lastState = null;
	let openMenuTaskId = null;
	let pendingFocusTaskId = null;
	// Set in open-menu when event.detail === 0 (keyboard activation): after
	// the next render, focus the first [role="menuitem"] inside this task's
	// menu. Mirrors pendingMenuFocusTaskId in area.js / sidebar.js.
	let pendingMenuFocusTaskId = null;

	// returnFocus=false on click-outside dismiss: focus follows the click
	// (e.g. into the capture input), not back to the ⋯. Esc / menu-action /
	// toggle close use the default (true) to restore focus to the ⋯ button.
	const closeMenu = (returnFocus = true) => {
		if (!openMenuTaskId) return;
		if (returnFocus) pendingFocusTaskId = openMenuTaskId;
		openMenuTaskId = null;
		doRender();
	};

	const docClickHandler = (event) => {
		if (!openMenuTaskId) return;
		if (rootEl.contains(event.target)) return;
		closeMenu(false);
	};

	function findOpenMenuInToday(target) {
		if (!openMenuTaskId) return null;
		const menu = rootEl.querySelector(
			`[data-id="${CSS.escape(openMenuTaskId)}"] [role="menu"]`,
		);
		return menu?.contains(target) ? menu : null;
	}

	const docKeyHandler = (event) => {
		if (event.key === "Escape") {
			closeMenu();
			return;
		}

		const menuEl = findOpenMenuInToday(event.target);
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
				closeMenu(true);
				return;
			default:
				return;
		}

		event.preventDefault();
		if (nextIdx >= 0) menuItems[nextIdx].focus();
	};
	document.addEventListener("click", docClickHandler);
	document.addEventListener("keydown", docKeyHandler);

	const taskFromEvent = (actionEl) => {
		const li = actionEl.closest("[data-id]");
		if (!li || !lastState) return null;
		return lastState.tasks.find((t) => t.id === li.dataset.id) ?? null;
	};

	const unbind = bindActions(rootEl, {
		"toggle-complete": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (t) callbacks.onToggleComplete(t.id);
		},
		"toggle-star": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (t) callbacks.onToggleStar(t.id, t.starred);
		},
		"open-menu": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			if (openMenuTaskId === t.id) {
				closeMenu();
				return;
			}
			openMenuTaskId = t.id;
			// Keyboard activations (Enter/Space) report event.detail === 0;
			// on keyboard-open move focus to the first menu item. Mouse users
			// (detail >= 1) keep focus on ⋯. Mirrors area.js / sidebar.js.
			if (event.detail === 0) {
				pendingMenuFocusTaskId = t.id;
			}
			doRender();
		},
		"delete-task": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			openMenuTaskId = null;
			if (t) callbacks.onDelete(t);
		},
	});

	function doRender() {
		if (!lastState) return;
		rootEl.innerHTML = template(lastState, openMenuTaskId);

		// Post-render lookup: focus the task's ⋯ button by data-attribute.
		// Captured element refs go stale across innerHTML rewrites, so we
		// query the freshly-rendered DOM. Mirrors area.js's pendingFocusTaskId.
		if (pendingFocusTaskId) {
			const trigger = rootEl.querySelector(
				`[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
			);
			trigger?.focus();
			pendingFocusTaskId = null;
		}

		// Post-render lookup: when the task menu was opened via keyboard,
		// move focus to its first menu item. :not([disabled]) is a defensive
		// guard — .focus() on a disabled button is a silent no-op that drops
		// focus to <body>. Mirrors area.js / sidebar.js.
		if (pendingMenuFocusTaskId) {
			const firstItem = rootEl.querySelector(
				`[data-id="${CSS.escape(pendingMenuFocusTaskId)}"] [role="menu"] [role="menuitem"]:not([disabled])`,
			);
			firstItem?.focus();
			pendingMenuFocusTaskId = null;
		}
	}

	return {
		render(state) {
			lastState = state;
			doRender();
		},
		destroy() {
			unbind();
			document.removeEventListener("click", docClickHandler);
			document.removeEventListener("keydown", docKeyHandler);
			rootEl.innerHTML = "";
			lastState = null;
			openMenuTaskId = null;
			pendingFocusTaskId = null;
			pendingMenuFocusTaskId = null;
		},
	};
}

function template(state, openMenuTaskId) {
	const next = pickNextTask(state.tasks, state.now);
	const groups = groupTasksForToday(state.tasks, state.now);
	const visible = (list) => list.filter((t) => t.id !== next?.id);

	const overdue = visible(groups.overdue);
	const today = visible(groups.today);
	const starred = visible(groups.starred);

	const allEmpty =
		!next && overdue.length === 0 && today.length === 0 && starred.length === 0;

	if (allEmpty) {
		return `<p class="empty">You're clear. Nice.</p>`;
	}

	return `
		${next ? renderNextCard(next, state.now, openMenuTaskId) : ""}
		${renderGroup("Overdue", "group--overdue", overdue, state.now, openMenuTaskId, true)}
		${renderGroup("Today", "group--today", today, state.now, openMenuTaskId, true)}
		${renderGroup("Starred", "group--starred", starred, state.now, openMenuTaskId, false)}
	`;
}

function renderNextCard(task, now, openMenuTaskId) {
	return `
		<article class="next-card">
			<h2 class="next-card__label">NEXT</h2>
			<ul class="next-card__list">
				${renderTaskRowWithMenu(task, now, openMenuTaskId)}
			</ul>
		</article>
	`;
}

function renderGroup(
	heading,
	modifierClass,
	tasks,
	now,
	openMenuTaskId,
	showCount,
) {
	if (tasks.length === 0) return "";
	const headingText = showCount ? `${heading} (${tasks.length})` : heading;
	const rows = tasks
		.map((t) => renderTaskRowWithMenu(t, now, openMenuTaskId))
		.join("");
	return `
		<section class="group ${modifierClass}">
			<h3 class="group__heading">${headingText}</h3>
			<ul class="group__list">${rows}</ul>
		</section>
	`;
}

function renderTaskRowWithMenu(task, now, openMenuTaskId) {
	const isOpen = openMenuTaskId === task.id;
	const row = renderTaskRow(task, { now, isOpen });
	if (!isOpen) return row;
	// Inject the menu inside the <li> as its last child. The <li> is set to
	// position: relative in CSS, so the menu's absolute positioning anchors
	// against the row. (Putting it after </li> would make it a direct child
	// of <ul>, which is invalid HTML.)
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
}
