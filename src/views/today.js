// createTodayView(rootEl, { onToggleComplete, onToggleStar, onDelete })
//   → { render(state), destroy() }
//
// state expected: { tasks, sections, areas, settings, now }
// onDelete receives the full task object so the controller can restore it.

import { bindActions } from "../utils/dom.js";
import { groupTasksForToday, pickNextTask } from "../utils/time.js";
import { renderTaskRow } from "./task.js";

export function createTodayView(rootEl, callbacks) {
	let lastState = null;
	let openMenuTaskId = null;

	const closeMenu = () => {
		openMenuTaskId = null;
		if (lastState) doRender();
	};

	const docClickHandler = (event) => {
		if (!openMenuTaskId) return;
		if (rootEl.contains(event.target)) return;
		closeMenu();
	};
	const docKeyHandler = (event) => {
		if (event.key === "Escape") closeMenu();
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
			openMenuTaskId = openMenuTaskId === t.id ? null : t.id;
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
	const row = renderTaskRow(task, { now });
	if (openMenuTaskId !== task.id) return row;
	// Inject the menu inside the <li> as its last child. The <li> is set to
	// position: relative in CSS, so the menu's absolute positioning anchors
	// against the row. (Putting it after </li> would make it a direct child
	// of <ul>, which is invalid HTML.)
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem">Delete</button>
		</div></li>`,
	);
}
