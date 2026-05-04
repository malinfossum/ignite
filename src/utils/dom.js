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
