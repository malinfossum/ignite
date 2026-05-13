// Renders one task row. Returned as a string so the parent template can
// concatenate. Always escape user-provided fields before interpolating —
// titles can contain `<` and would otherwise execute as HTML.

import { escapeHtml } from "../utils/dom.js";
import { formatTimeLabel } from "../utils/time.js";

export function renderTaskRow(task, { now } = { now: new Date() }) {
	const checked = task.completed ? "checked" : "";
	const starredAttr = task.starred
		? 'aria-pressed="true"'
		: 'aria-pressed="false"';
	const starGlyph = task.starred ? "★" : "☆";
	const recurring = task.recurrence
		? '<span class="task__recurring" aria-hidden="true">⟲</span>'
		: "";
	const timeLabel = task.dueAt
		? `<span class="task__time-label">${escapeHtml(formatTimeLabel(task.dueAt, now))}</span>`
		: "";

	return `
		<li class="task" data-id="${escapeHtml(task.id)}">
			<input type="checkbox" class="task__check" data-action="toggle-complete" ${checked} />
			<span class="task__title">${escapeHtml(task.title)}</span>
			<button class="task__star" type="button" data-action="toggle-star" ${starredAttr}>${starGlyph}</button>
			${recurring}
			${timeLabel}
			<button class="task__menu-btn" type="button" data-action="open-menu" aria-haspopup="menu">⋯</button>
		</li>
	`;
}
