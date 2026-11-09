// createConfirmDialog(rootEl) → { open, close, isOpen, destroy }
//
// The Replace/Cancel dialog for restore and import. Same pattern as the
// schedule dialog (recurrence-dialog.js): role="dialog", aria-modal, labelled
// by its heading, Esc and the backdrop cancel. The CONTROLLER owns background
// `inert` and where focus goes afterwards. Focus starts on Cancel, because
// Replace overwrites everything.
//
// Replace disables itself (and Cancel) on the first press, so a double press
// can't start two replaces.

import { escapeHtml } from "../utils/dom.js";

export function createConfirmDialog(rootEl) {
	let current = null;
	let busy = false;
	let clickHandler = null;
	let keyHandler = null;

	function close() {
		if (clickHandler) rootEl.removeEventListener("click", clickHandler);
		if (keyHandler) document.removeEventListener("keydown", keyHandler);
		clickHandler = null;
		keyHandler = null;
		current = null;
		busy = false;
		rootEl.innerHTML = "";
	}

	function open(opts) {
		close();
		current = opts;
		rootEl.innerHTML = `
			<div class="repeat-backdrop" data-action="confirm-backdrop">
				<div class="repeat-panel confirm-panel" role="dialog" aria-modal="true"
					aria-labelledby="confirm-heading" aria-describedby="confirm-body">
					<h2 class="repeat-panel__heading" id="confirm-heading">${escapeHtml(opts.title)}</h2>
					<div class="confirm-panel__body" id="confirm-body">
						${opts.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
					</div>
					<footer class="repeat-footer">
						<button type="button" class="repeat-btn" data-action="confirm-cancel">Cancel</button>
						<button type="button" class="repeat-btn repeat-btn--primary" data-action="confirm-ok">${escapeHtml(opts.confirmLabel)}</button>
					</footer>
				</div>
			</div>
		`;
		clickHandler = (event) => {
			const actionEl = event.target.closest("[data-action]");
			const action = actionEl?.dataset.action;
			if (!action || busy) return;
			if (action === "confirm-backdrop" && event.target !== actionEl) return;
			if (action === "confirm-ok") {
				busy = true;
				for (const b of rootEl.querySelectorAll("button")) b.disabled = true;
				current.onConfirm();
				return;
			}
			current.onCancel();
		};
		keyHandler = (event) => {
			if (event.key !== "Escape" || busy) return;
			event.preventDefault();
			current.onCancel();
		};
		rootEl.addEventListener("click", clickHandler);
		document.addEventListener("keydown", keyHandler);
		rootEl.querySelector('[data-action="confirm-cancel"]').focus();
	}

	return {
		open,
		close,
		isOpen: () => current !== null,
		destroy: close,
	};
}
