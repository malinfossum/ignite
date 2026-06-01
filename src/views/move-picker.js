// renderMovePicker({ task, areas, sections }) → string
//
// Pure template. Renders the move-target picker as a sub-face of the task
// ⋯ menu: every section in every area EXCEPT the task's current section,
// grouped by area, with a "← Back" row LAST. Shared by area.js (threaded
// through section.js) and today.js.
//
// The returned markup is itself role="menu", so it reuses the views'
// existing menu machinery (findOpenMenu*, arrow-key nav, isRendering blur
// guard, post-render focus) unchanged. Targets are role="menuitem"; the
// group label <p> is NOT a menuitem (arrow-nav skips it) and is
// aria-hidden — the role="group" aria-label already names the area for SRs.
//
// Back is LAST so the "focus first [role=menuitem]" machinery lands on the
// first TARGET when the picker opens, not on Back.
//
// Empty-picker race: "Move to…" is gated upstream by hasMoveTargets, but the
// other sections can be deleted between opening the picker and its re-render.
// If zero target groups remain, render a single DISABLED "No other sections"
// menuitem before Back so the picker is never a bare Back-only dead-end
// (nextEnabledIndex + the :not([disabled]) focus guard skip it).
//
// escapeHtml is applied to area names (group aria-label + visible label),
// section names, AND data-target-section-id — names are user-controlled and
// IDs are escaped as defense-in-depth (matches the rename spec).

import { escapeHtml } from "../utils/dom.js";

export function renderMovePicker({ task, areas, sections }) {
	const currentSectionId = task.sectionId;
	const areasSorted = [...areas].sort((a, b) => a.order - b.order);

	const groups = areasSorted
		.map((area) => {
			const targets = sections
				.filter((s) => s.areaId === area.id && s.id !== currentSectionId)
				.sort((a, b) => a.order - b.order);
			// Skip the area entirely if it has no valid targets.
			if (targets.length === 0) return "";
			const items = targets
				.map(
					(s) =>
						`<button class="task-menu__item" type="button" role="menuitem" tabindex="-1"
							data-action="pick-move-target"
							data-target-section-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`,
				)
				.join("");
			return `
				<div class="task-menu__group" role="group" aria-label="${escapeHtml(area.name)}">
					<p class="task-menu__group-label" aria-hidden="true">${escapeHtml(area.name)}</p>
					${items}
				</div>
			`;
		})
		.join("");

	const emptyHint =
		groups.trim() === ""
			? `<button class="task-menu__item" type="button" role="menuitem" tabindex="-1" disabled>No other sections</button>`
			: "";

	return `
		<div class="task-menu task-menu--picker" role="menu" aria-label="Move to section">
			${groups}
			${emptyHint}
			<button class="task-menu__item task-menu__item--back" type="button" role="menuitem" tabindex="-1"
				data-action="move-picker-back">← Back</button>
		</div>
	`;
}
