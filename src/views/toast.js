// createToastView(rootEl) → { show({ message, onUndo, onDismiss }), destroy() }
//
// One toast at a time. show() replaces any existing toast (and its timer).
// The toast auto-dismisses after 5 seconds, calling onDismiss if provided.

const DURATION_MS = 5_000;

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

	function show({ message, onUndo, onDismiss } = {}) {
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
		}, DURATION_MS);
	}

	return {
		show,
		destroy() {
			clearActive();
		},
	};
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
