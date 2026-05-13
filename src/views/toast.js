// createToastView(rootEl) → { show({ message, onUndo, onDismiss, durationMs }), destroy() }
//
// One toast at a time. show() replaces any existing toast (and its timer).
// The toast auto-dismisses after durationMs (default 5000ms), calling onDismiss
// if provided. Cascade-delete passes 8000ms; single task-delete uses the default.

import { escapeHtml } from "../utils/dom.js";

const DEFAULT_DURATION_MS = 5_000;

export function createToastView(rootEl) {
	let timer = null;
	let activeUndoHandler = null;

	function clearActive() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		activeUndoHandler = null;
		rootEl.innerHTML = "";
	}

	function show({ message, onUndo, onDismiss, durationMs } = {}) {
		clearActive();

		rootEl.innerHTML = `
			<div class="toast" role="status" aria-live="polite">
				<span class="toast__message">${escapeHtml(message ?? "")}</span>
				<button class="toast__undo" type="button">Undo</button>
			</div>
		`;
		const undoBtn = rootEl.querySelector(".toast__undo");

		activeUndoHandler = () => {
			if (timer) clearTimeout(timer);
			timer = null;
			activeUndoHandler = null;
			rootEl.innerHTML = "";
			if (onUndo) onUndo();
		};
		undoBtn.addEventListener("click", activeUndoHandler, { once: true });

		timer = setTimeout(() => {
			timer = null;
			activeUndoHandler = null;
			rootEl.innerHTML = "";
			if (onDismiss) onDismiss();
		}, durationMs ?? DEFAULT_DURATION_MS);
	}

	return {
		show,
		destroy() {
			clearActive();
		},
	};
}
