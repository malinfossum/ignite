// renderSection(opts) → string
//
// Pure template. Renders one section's HTML for the area view to
// concatenate. Event wiring lives in createAreaView; this file only
// produces markup.
//
// opts:
//   section          - the section record
//   tasks            - tasks in this section (already filtered + sorted)
//   isUndeletable    - true for focus-default; suppresses Delete in menu
//   isFirst, isLast  - edge flags for Move up/down disabled state
//   openMenuId       - section id whose menu is currently open, or null
//   renamingId       - section id currently in rename mode, or null
//   openTaskMenuId   - task id whose ⋯ menu is currently open, or null
//   pendingRenameValue - in-progress rename text (survives re-renders), or null
//   now              - Date used by renderTaskRow for time labels

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

	const body = renderBody(tasks, now, openTaskMenuId);

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
	const upDisabled = isFirst ? "disabled" : "";
	const downDisabled = isLast ? "disabled" : "";
	const deleteItem = isUndeletable
		? ""
		: `<li role="none">
				<button role="menuitem" type="button" class="section-menu__item"
					data-action="delete-section">Delete</button>
			</li>`;
	return `
		<ul class="section-menu" role="menu">
			<li role="none">
				<button role="menuitem" type="button" class="section-menu__item"
					data-action="rename-section">Rename</button>
			</li>
			<li role="none">
				<button role="menuitem" type="button" class="section-menu__item"
					data-action="move-up" ${upDisabled}>Move up</button>
			</li>
			<li role="none">
				<button role="menuitem" type="button" class="section-menu__item"
					data-action="move-down" ${downDisabled}>Move down</button>
			</li>
			${deleteItem}
		</ul>
	`;
}

function renderBody(tasks, now, openTaskMenuId) {
	const rows = tasks
		.map((t, i) =>
			renderTaskRowWithMenu(t, {
				now,
				isFirst: i === 0,
				isLast: i === tasks.length - 1,
				openTaskMenuId,
			}),
		)
		.join("");
	return `
		<div class="section__body">
			<ul class="section__tasks">${rows}</ul>
		</div>
	`;
}

function renderTaskRowWithMenu(task, { now, isFirst, isLast, openTaskMenuId }) {
	const isOpen = openTaskMenuId === task.id;
	const row = renderTaskRow(task, { now, isOpen });
	if (!isOpen) return row;
	const upDisabled = isFirst ? "disabled" : "";
	const downDisabled = isLast ? "disabled" : "";
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="move-task-up"
				role="menuitem" ${upDisabled}>Move up</button>
			<button class="task-menu__item" type="button" data-action="move-task-down"
				role="menuitem" ${downDisabled}>Move down</button>
			<button class="task-menu__item" type="button" data-action="delete-task"
				role="menuitem">Delete</button>
		</div></li>`,
	);
}
