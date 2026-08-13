// renderTabStrip({ activeTab, counts }) → string
//
// Pure template for the Focus surface's tab strip. ARIA APG tabs: a
// role="tablist" of role="tab" buttons with ROVING TABINDEX — exactly one tab
// stop for the whole strip, arrows traverse (focus.js wires the keys through
// utils/menu-keyboard.js). Four extra tab stops in a keyboard-first capture
// flow is the failure this avoids; it is the same treatment the icon picker
// already gets, for the same reason.
//
// aria-controls is set ONLY on the selected tab. Just one panel is in the DOM at
// a time, so putting aria-controls on the other three would point at ids that do
// not exist — the kind of "technically ARIA" attribute that axe flags and that
// already cost this project once (aria-expanded on the capture input).
//
// Nothing here is user-authored: labels and ids come from the TABS literal and
// counts are numbers, so there is no escaping to do.

export const TABS = [
	{ id: "today", label: "Today" },
	{ id: "tomorrow", label: "Tomorrow" },
	{ id: "starred", label: "Starred" },
	{ id: "focus", label: "Focus" },
];

export function renderTabStrip({ activeTab, counts }) {
	const tabs = TABS.map((tab) => {
		const selected = tab.id === activeTab;
		const controls = selected ? ` aria-controls="focus-panel-${tab.id}"` : "";
		return `
			<button class="focus-tab${selected ? " is-active" : ""}" type="button"
				role="tab"
				id="focus-tab-${tab.id}"
				data-action="select-tab"
				data-tab="${tab.id}"
				aria-selected="${selected}"${controls}
				tabindex="${selected ? "0" : "-1"}">${tab.label} <span class="focus-tab__count">${counts?.[tab.id] ?? 0}</span></button>
		`;
	}).join("");

	return `
		<div class="focus-tabs" role="tablist" aria-label="Focus views">${tabs}</div>
	`;
}
