// Delegated click dispatcher.
// Usage:
//   const unbind = bindActions(rootEl, {
//     "toggle-complete": (e, actionEl) => { ... },
//     "open-menu":       (e, actionEl) => { ... },
//   });
//   ...later: unbind();
//
// Any element with `data-action="<key>"` inside `rootEl` will dispatch on click.
// Returns an unbind function so views can clean up in destroy().

export function bindActions(rootEl, actionMap) {
	const handler = (event) => {
		const actionEl = event.target.closest("[data-action]");
		if (!actionEl || !rootEl.contains(actionEl)) return;
		const fn = actionMap[actionEl.dataset.action];
		if (fn) fn(event, actionEl);
	};
	rootEl.addEventListener("click", handler);
	return () => rootEl.removeEventListener("click", handler);
}

// Delegated keydown dispatcher.
// Usage:
//   const unbind = bindKeys(rootEl, {
//     Escape: (event, actionEl) => { ... },
//     Enter:  (event, actionEl) => { ... },
//   });
//
// Looks up event.key in the map. actionEl is the closest [data-action]
// ancestor of event.target, or rootEl itself if none. Handlers MUST be
// idempotent — keydown fires repeatedly while a key is held.

export function bindKeys(rootEl, keyMap) {
	const handler = (event) => {
		const fn = keyMap[event.key];
		if (!fn) return;
		const actionEl = event.target.closest("[data-action]") ?? rootEl;
		if (!rootEl.contains(actionEl) && actionEl !== rootEl) return;
		fn(event, actionEl);
	};
	rootEl.addEventListener("keydown", handler);
	return () => rootEl.removeEventListener("keydown", handler);
}

// HTML-escape a string for safe interpolation inside template literals
// that get assigned to innerHTML. Always pass user-provided strings
// (titles, names, notes) through this before interpolating.

export function escapeHtml(s) {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
