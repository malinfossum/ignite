// createCaptureView(rootEl, { onSubmit }) → { destroy() }
//
// onSubmit(title: string) is called for non-empty trimmed input on Enter.
// Esc inside the input clears the typed value (no submit, no model write).
// Mounts once, never re-renders — preserves the input cursor across
// model notifies and route changes.

export function createCaptureView(rootEl, { onSubmit }) {
	rootEl.innerHTML = `
		<form class="capture__form" autocomplete="off">
			<input
				class="capture__input"
				type="text"
				name="title"
				placeholder="What's next?"
				aria-label="Capture a new task"
				aria-describedby="capture-destination"
			/>
			<span class="capture__chip" id="capture-destination"></span>
		</form>
		<div class="capture__picker-root"></div>
	`;

	const form = rootEl.querySelector(".capture__form");
	const input = rootEl.querySelector(".capture__input");
	const chip = rootEl.querySelector(".capture__chip");

	const handler = (event) => {
		event.preventDefault();
		const value = input.value.trim();
		if (!value) return;
		onSubmit(value);
		input.value = "";
		input.focus();
	};
	form.addEventListener("submit", handler);

	const keydownHandler = (event) => {
		if (event.key === "Escape") {
			input.value = "";
		}
	};
	input.addEventListener("keydown", keydownHandler);

	return {
		// Targeted text write ONLY. An innerHTML rewrite here would destroy the
		// input's cursor position on every model notify — the whole reason this
		// view mounts once and never re-renders.
		setDestination(next, label) {
			chip.textContent = label;
			input.disabled = next.kind === "none";
		},

		destroy() {
			form.removeEventListener("submit", handler);
			input.removeEventListener("keydown", keydownHandler);
			rootEl.innerHTML = "";
		},
	};
}
