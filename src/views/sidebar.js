// createSidebarView(rootEl, { onToggleCollapse }) → { render(state), destroy() }
//
// Renders a toggle button + the areas list with active-task counts.
// CSS owns the expanded/collapsed visual; the template is the same in both.

import { bindActions, escapeHtml } from "../utils/dom.js";

export function createSidebarView(rootEl, { onToggleCollapse }) {
	const unbind = bindActions(rootEl, {
		"toggle-sidebar": () => onToggleCollapse(),
	});

	return {
		render(state) {
			rootEl.innerHTML = template(state);
		},
		destroy() {
			unbind();
			rootEl.innerHTML = "";
		},
	};
}

function template(state) {
	const items = state.areas
		.slice()
		.sort((a, b) => a.order - b.order)
		.map((area) => renderAreaItem(area, state))
		.join("");

	return `
		<button class="sidebar__toggle" type="button" data-action="toggle-sidebar" aria-label="Toggle sidebar">
			<span class="sidebar__toggle-glyph" aria-hidden="true">≡</span>
		</button>
		<ul class="sidebar__areas">${items}</ul>
	`;
}

function renderAreaItem(area, state) {
	const sectionIds = new Set(
		state.sections.filter((s) => s.areaId === area.id).map((s) => s.id),
	);
	const count = state.tasks.filter(
		(t) => sectionIds.has(t.sectionId) && !t.completed,
	).length;

	return `
		<li class="sidebar__area" data-area-id="${escapeHtml(area.id)}">
			<span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
			<span class="sidebar__name">${escapeHtml(area.name)}</span>
			<span class="sidebar__count">${count}</span>
		</li>
	`;
}
