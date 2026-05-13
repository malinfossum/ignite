// createSidebarView(rootEl, { onToggleCollapse, onGoToday, onOpenArea })
//   → { render(state), destroy() }
//
// state expected: { areas, sections, tasks, settings, route, now }
// route:
//   { name: "today" }            → wordmark gets aria-current="page"
//   { name: "area", id: "..." }  → matching area row gets aria-current="page"
//
// Renders the wordmark, the toggle button, and the areas list.
// CSS owns the expanded/collapsed visual; the template is the same in both.

import { bindActions, escapeHtml } from "../utils/dom.js";

export function createSidebarView(
	rootEl,
	{ onToggleCollapse, onGoToday, onOpenArea },
) {
	const unbind = bindActions(rootEl, {
		"toggle-sidebar": () => onToggleCollapse(),
		"go-today": () => onGoToday(),
		"open-area": (_event, actionEl) => {
			const id = actionEl.dataset.id;
			if (id) onOpenArea(id);
		},
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
	const route = state.route ?? { name: "today" };
	const todayActive = route.name === "today";
	const wordmarkAria = todayActive ? 'aria-current="page"' : "";
	const wordmarkActive = todayActive ? "is-active" : "";

	const items = state.areas
		.slice()
		.sort((a, b) => a.order - b.order)
		.map((area) => renderAreaItem(area, state, route))
		.join("");

	return `
		<button class="sidebar__home ${wordmarkActive}" type="button"
			data-action="go-today" ${wordmarkAria}>Ignite</button>
		<button class="sidebar__toggle" type="button"
			data-action="toggle-sidebar" aria-label="Toggle sidebar">
			<span class="sidebar__toggle-glyph" aria-hidden="true">≡</span>
		</button>
		<ul class="sidebar__areas">${items}</ul>
	`;
}

function renderAreaItem(area, state, route) {
	const sectionIds = new Set(
		state.sections.filter((s) => s.areaId === area.id).map((s) => s.id),
	);
	const count = state.tasks.filter(
		(t) => sectionIds.has(t.sectionId) && !t.completed,
	).length;

	const active = route.name === "area" && route.id === area.id;
	const aria = active ? 'aria-current="page"' : "";
	const activeClass = active ? "is-active" : "";

	return `
		<li class="sidebar__area-row" data-area-id="${escapeHtml(area.id)}">
			<button type="button" class="sidebar__area ${activeClass}"
				data-action="open-area" data-id="${escapeHtml(area.id)}" ${aria}>
				<span class="sidebar__icon" aria-hidden="true">${escapeHtml(area.icon || "•")}</span>
				<span class="sidebar__name">${escapeHtml(area.name)}</span>
				<span class="sidebar__count">${count}</span>
			</button>
		</li>
	`;
}
