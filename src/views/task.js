// Renders one task row. Returned as a string so the parent template can
// concatenate. Always escape user-provided fields before interpolating —
// titles can contain `<` and would otherwise execute as HTML.
//
// Options:
//   now                - Date used by formatTimeLabel for the time label.
//   isOpen             - true when this task's ⋯ menu is open (controls
//                        aria-expanded on the menu button).
//   renaming           - true to render input-only rename mode (replaces
//                        checkbox / title / star / ⋯ with a single input).
//                        The <li> still carries data-id so taskFromEvent
//                        lookups resolve.
//   pendingRenameValue - in-progress rename text preserved across re-renders,
//                        or null. Falls back to task.title when null.
//                        MUST be ??, not || — a typed "" renders empty +
//                        placeholder.
//   areaName           - the task's area name, or null. Renders the area badge
//                        that appears at >=768px on the dated tabs. Escaped —
//                        area names are user-authored and this is a new
//                        interpolation site.

import { escapeHtml } from "../utils/dom.js";
import { describeRecurrence } from "../utils/text.js";
import { formatOccurrenceLabel, formatTimeLabel } from "../utils/time.js";

export function renderTaskRow(
	task,
	{
		now,
		isOpen = false,
		renaming = false,
		pendingRenameValue = null,
		showFile = false,
		areaName = null,
	} = { now: new Date() },
) {
	if (renaming) return renderRenameRow(task, pendingRenameValue);

	const checked = task.completed ? "checked" : "";
	const starredAttr = task.starred
		? 'aria-pressed="true"'
		: 'aria-pressed="false"';
	const starGlyph = task.starred ? "★" : "☆";
	const recurring = task.recurrence
		? `<span class="task__recurring" role="img" aria-label="${escapeHtml(recurrenceBadgeLabel(task, now))}">⟲</span>`
		: "";
	// `hasTime` is what separates "due sometime today" from "due at 00:00" —
	// without it a dateless-but-dated task reads "was 00:00" all afternoon.
	const timeLabel = task.dueAt
		? `<span class="task__time-label">${escapeHtml(
				task.hasTime
					? formatTimeLabel(task.dueAt, now)
					: formatOccurrenceLabel(task.dueAt, now),
			)}</span>`
		: "";
	// One-tap filing for notepad rows. Named per task, because a column of
	// buttons all called "File" is unusable by voice or screen reader.
	const fileBtn = showFile
		? `<button class="task__file" type="button" data-action="file-task"
				aria-haspopup="menu"
				aria-label="File ${escapeHtml(task.title)}">File</button>`
		: "";
	// The badge is a plain <span>, not a link or a button: it says where the task
	// lives, it does not navigate. main.css hides it below 768px.
	const areaBadge = areaName
		? `<span class="task__area-badge">${escapeHtml(areaName)}</span>`
		: "";

	return `
		<li class="task" data-id="${escapeHtml(task.id)}">
			<input type="checkbox" class="task__check" data-action="toggle-complete" ${checked}
				aria-label="Mark complete: ${escapeHtml(task.title)}" />
			<span class="task__title">${escapeHtml(task.title)}</span>
			${recurring}
			${areaBadge}
			${timeLabel}
			<button class="task__star" type="button" data-action="toggle-star" ${starredAttr}
				aria-label="Star: ${escapeHtml(task.title)}">${starGlyph}</button>
			${fileBtn}
			<button class="task__menu-btn" type="button" data-action="open-menu"
				aria-haspopup="menu"
				aria-expanded="${isOpen}"
				aria-label="Task options: ${escapeHtml(task.title)}">⋯</button>
		</li>
	`;
}

function renderRenameRow(task, pendingRenameValue) {
	// pendingRenameValue ?? task.title: a `""` value renders an empty box
	// (`"" ?? x === ""`) with the placeholder hinting the committed title;
	// `null` (menu rename) prefills the committed title. Must be ??, not ||.
	const renameValue = pendingRenameValue ?? task.title;
	return `
		<li class="task task--editing" data-id="${escapeHtml(task.id)}">
			<input type="text"
				class="task__rename-input"
				value="${escapeHtml(renameValue)}"
				data-action="commit-task-rename"
				data-task-id="${escapeHtml(task.id)}"
				aria-label="Rename task: ${escapeHtml(task.title)}"
				placeholder="${escapeHtml(task.title)}"
				autofocus />
		</li>
	`;
}

// "Repeats every 2 weeks; next Jul 6" — the badge's accessible name. Omits the
// "next" clause when the task has no dueAt (defensive; a saved rule always has one).
function recurrenceBadgeLabel(task, now) {
	const cadence = describeRecurrence(task.recurrence);
	const base = `Repeats ${cadence}`;
	return task.dueAt
		? `${base}; next ${formatOccurrenceLabel(task.dueAt, now)}`
		: base;
}
