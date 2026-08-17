// createTopbarView(rootEl, { onToggleDrawer, onGoFocus }) → { setExpanded(open), destroy() }
//
// Mobile-only top bar: the ☰ menu button (opens the off-canvas drawer) and the
// "Ignite" wordmark (a one-tap home shortcut → Focus). Hidden on desktop via CSS.
//
// Render-once (mirrors capture.js): the content is static (☰ + "Ignite"), so it
// never re-renders from state. The only imperative update is setExpanded(bool),
// which reflects drawer open/closed state on the ☰ button's aria-expanded.
// Content is static — no user data — so no escapeHtml is needed.

import { bindActions } from "../utils/dom.js";

export function createTopbarView(rootEl, { onToggleDrawer, onGoFocus }) {
	rootEl.innerHTML = `
		<button class="topbar__menu" type="button"
			data-action="toggle-drawer"
			aria-label="Open menu" aria-expanded="false" aria-controls="sidebar">☰</button>
		<button class="topbar__wordmark" type="button" data-action="go-focus">Ignite</button>
	`;

	const menuBtn = rootEl.querySelector(".topbar__menu");

	const unbindClick = bindActions(rootEl, {
		"toggle-drawer": () => onToggleDrawer(),
		"go-focus": () => onGoFocus(),
	});

	return {
		setExpanded(open) {
			menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
		},
		destroy() {
			unbindClick();
			rootEl.innerHTML = "";
		},
	};
}
