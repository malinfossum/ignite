// renderSection(opts) → string
//
// Pure template. Renders one section's HTML for the area view to
// concatenate. Event wiring lives in createAreaView; this file only
// produces markup.
//
// opts:
//   section                - the section record
//   tasks                  - tasks in this section (already filtered + sorted)
//   isUndeletable          - true for focus-default; suppresses Delete in menu
//   isFirst, isLast        - edge flags for Move up/down disabled state
//   openMenuId             - section id whose menu is currently open, or null
//   renamingId             - section id currently in rename mode, or null
//   openTaskMenuId         - task id whose ⋯ menu is currently open, or null
//   pendingRenameValue     - in-progress section-rename text (survives re-renders), or null
//   renamingTaskId         - task id currently in rename mode, or null
//   pendingRenameTaskValue - in-progress task-rename text (survives re-renders), or null
//   now                    - Date used by renderTaskRow for time labels

import { escapeHtml } from "../utils/dom.js";
import { renderTaskRow } from "./task.js";

export function renderSection({
	section,
	tasks,
	isUndeletable,
	isFirst,
	isLast,
	openMenuId,
	renamingId,
	openTaskMenuId,
	pendingRenameValue,
	renamingTaskId,
	pendingRenameTaskValue,
	now,
}) {
	const isOpen = openMenuId === section.id;
	const isRenaming = renamingId === section.id;
	const collapsed = !!section.collapsed;

	const header = isRenaming
		? renderRenameHeader(section, pendingRenameValue)
		: renderHeader(section, collapsed, isOpen);

	const menu =
		isOpen && !isRenaming ? renderMenu({ isFirst, isLast, isUndeletable }) : "";

	const body = renderBody(
		tasks,
		now,
		openTaskMenuId,
		renamingTaskId,
		pendingRenameTaskValue,
	);

	return `
		<section
			class="section"
			data-section-id="${escapeHtml(section.id)}"
			data-collapsed="${collapsed}">
			${header}
			${menu}
			${body}
		</section>
	`;
}

function renderHeader(section, collapsed, isOpen) {
	// Glyph is ALWAYS ▾. CSS rotates it -90° when [data-collapsed="true"]
	// so it points right when collapsed. Earlier drafts swapped the glyph
	// in the template AND rotated in CSS, which double-flipped.
	return `
		<header class="section__header">
			<button
				type="button"
				class="section__toggle"
				data-action="toggle-section"
				aria-expanded="${!collapsed}">
				<span class="section__chevron" aria-hidden="true">▾</span>
				<h2 class="section__title">${escapeHtml(section.name)}</h2>
			</button>
			<button
				type="button"
				class="section__menu-btn"
				data-action="open-section-menu"
				aria-haspopup="menu"
				aria-expanded="${isOpen}"
				aria-label="Section options: ${escapeHtml(section.name)}">⋯</button>
		</header>
	`;
}

function renderRenameHeader(section, pendingRenameValue) {
	// pendingRenameValue ?? section.name: a `""` create value renders an empty
	// box (`"" ?? x === ""`) with the placeholder hinting the default name;
	// `null` (menu rename) prefills the committed name. Must be ??, not ||.
	const renameValue = pendingRenameValue ?? section.name;
	return `
		<header class="section__header section__header--editing">
			<span class="section__chevron" aria-hidden="true">▾</span>
			<input
				type="text"
				class="section__rename-input"
				value="${escapeHtml(renameValue)}"
				data-action="commit-rename"
				data-section-id="${escapeHtml(section.id)}"
				aria-label="Rename section: ${escapeHtml(section.name)}"
				placeholder="${escapeHtml(section.name)}"
				autofocus />
		</header>
	`;
}

function renderMenu({ isFirst, isLast, isUndeletable }) {
	// Boundary moves are OMITTED (not greyed) — mirrors the area menu in
	// sidebar.js. isFirst ⇒ no Move up; isLast ⇒ no Move down.
	const moveUpItem = isFirst
		? ""
		: `<li role="none">
				<button role="menuitem" tabindex="-1" type="button" class="section-menu__item"
					data-action="move-up">Move up</button>
			</li>`;
	const moveDownItem = isLast
		? ""
		: `<li role="none">
				<button role="menuitem" tabindex="-1" type="button" class="section-menu__item"
					data-action="move-down">Move down</button>
			</li>`;
	const deleteItem = isUndeletable
		? ""
		: `<li role="none">
				<button role="menuitem" tabindex="-1" type="button" class="section-menu__item"
					data-action="delete-section">Delete</button>
			</li>`;
	return `
		<ul class="section-menu" role="menu">
			<li role="none">
				<button role="menuitem" tabindex="-1" type="button" class="section-menu__item"
					data-action="rename-section">Rename</button>
			</li>
			${moveUpItem}
			${moveDownItem}
			${deleteItem}
		</ul>
	`;
}

function renderBody(
	tasks,
	now,
	openTaskMenuId,
	renamingTaskId,
	pendingRenameTaskValue,
) {
	const rows = tasks
		.map((t, i) =>
			renderTaskRowWithMenu(t, {
				now,
				isFirst: i === 0,
				isLast: i === tasks.length - 1,
				openTaskMenuId,
				renamingTaskId,
				pendingRenameTaskValue,
			}),
		)
		.join("");
	return `
		<div class="section__body">
			<ul class="section__tasks">${rows}</ul>
		</div>
	`;
}

function renderTaskRowWithMenu(
	task,
	{
		now,
		isFirst,
		isLast,
		openTaskMenuId,
		renamingTaskId,
		pendingRenameTaskValue,
	},
) {
	const isRenaming = renamingTaskId === task.id;
	if (isRenaming) {
		// Rename input replaces the row's children — no menu injection,
		// no checkbox / star / ⋯ . Mutually exclusive with menu state.
		return renderTaskRow(task, {
			now,
			renaming: true,
			pendingRenameValue: pendingRenameTaskValue,
		});
	}

	const isOpen = openTaskMenuId === task.id;
	const row = renderTaskRow(task, { now, isOpen });
	if (!isOpen) return row;
	// Boundary moves are OMITTED (not greyed) — mirrors the section + area menus.
	const moveUpItem = isFirst
		? ""
		: `<button class="task-menu__item" type="button" data-action="move-task-up"
				role="menuitem" tabindex="-1">Move up</button>`;
	const moveDownItem = isLast
		? ""
		: `<button class="task-menu__item" type="button" data-action="move-task-down"
				role="menuitem" tabindex="-1">Move down</button>`;
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="rename-task"
				role="menuitem" tabindex="-1">Rename</button>
			${moveUpItem}
			${moveDownItem}
			<button class="task-menu__item" type="button" data-action="delete-task"
				role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
}
