// Shared wiring for an inline-rename <input> that is recreated on every
// innerHTML rewrite. area.js, today.js and sidebar.js each carried a verbatim
// copy of this — it's the trickiest focus code in the app, so it lives once here.
//
// The VIEW still owns its rename STATE (which id is editing, the pending text,
// the select-on-enter flag). This module owns only the mechanical DOM wiring
// that was identical across the three views.
//
// Use the two functions in a pair around the innerHTML rewrite in doRender():
//
//   const caret = readRenameCaret(rootEl, SELECTOR);   // BEFORE the rewrite
//   rootEl.innerHTML = template(...);                  // recreates the input
//   const attached = attachRenameInput(rootEl, SELECTOR, { ... , caret });
//   if (attached) pendingSelect = false;               // consume the select-once flag

// Read the caret of the live rename input before an innerHTML rewrite detaches
// it. Returns null when no rename input is on screen (not in rename mode).
export function readRenameCaret(rootEl, selector) {
	const input = rootEl.querySelector(selector);
	return input
		? { start: input.selectionStart, end: input.selectionEnd }
		: null;
}

// Re-attach listeners and restore focus on the freshly-rendered rename input.
// Returns true when an input was found and wired, false otherwise — the caller
// uses that to clear its select-once flag only when the input actually rendered.
//
//   onInput(value)  - mirror typing into the view's pending value (survives the
//                     60s-tick re-render, so text isn't lost mid-rename)
//   onCommit(input) - commit the rename from the input element
//   isRendering()   - true while the view is mid innerHTML rewrite; the blur
//                     listener skips the synthetic blur fired on input detach
//   isEditing()     - true while the view is still in rename mode
//   selectOnFocus   - first render after entering rename → focus + select all
//   caret           - {start,end}|null from readRenameCaret; restored otherwise
export function attachRenameInput(
	rootEl,
	selector,
	{ onInput, onCommit, isRendering, isEditing, selectOnFocus, caret },
) {
	const input = rootEl.querySelector(selector);
	if (!input) return false;

	input.addEventListener("input", (event) => onInput(event.target.value));
	input.addEventListener(
		"blur",
		() => {
			if (isRendering()) return;
			if (isEditing()) onCommit(input);
		},
		{ once: true },
	);

	if (selectOnFocus) {
		input.focus();
		input.select();
	} else if (document.activeElement !== input) {
		input.focus();
		if (caret) input.setSelectionRange(caret.start, caret.end);
	}

	return true;
}
