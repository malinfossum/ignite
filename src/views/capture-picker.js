// renderCapturePicker({ sections }) → string
//
// Pure template. The section chooser shown when capture is submitted inside
// an area with more than one section.
//
// This is NOT renderMovePicker. That one excludes a task's current section
// (there is no task yet), groups across every area (we want exactly one),
// and its Back row is wired to the task ⋯ menu. Same conventions —
// role="menu" / role="menuitem" / tabindex="-1" / escapeHtml on names AND
// ids — different template.
//
// Cancel is LAST so "focus the first menuitem" lands on a real target.

import { escapeHtml } from "../utils/dom.js";

export function renderCapturePicker({ sections }) {
	const items = sections
		.map(
			(s) =>
				`<button class="task-menu__item" type="button" role="menuitem" tabindex="-1"
					data-action="pick-capture-section"
					data-target-section-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`,
		)
		.join("");

	return `
		<div class="task-menu capture-picker" role="menu" aria-label="Choose a section">
			${items}
			<button class="task-menu__item task-menu__item--back" type="button" role="menuitem" tabindex="-1"
				data-action="cancel-capture-picker">← Cancel</button>
		</div>
	`;
}
