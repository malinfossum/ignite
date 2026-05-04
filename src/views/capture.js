// createCaptureView(rootEl, { onSubmit }) → { destroy() }
//
// onSubmit(title: string) is called for non-empty trimmed input.
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
			/>
		</form>
	`;

	const form = rootEl.querySelector(".capture__form");
	const input = rootEl.querySelector(".capture__input");

	const handler = (event) => {
		event.preventDefault();
		const value = input.value.trim();
		if (!value) return;
		onSubmit(value);
		input.value = "";
		input.focus();
	};
	form.addEventListener("submit", handler);

	return {
		destroy() {
			form.removeEventListener("submit", handler);
			rootEl.innerHTML = "";
		},
	};
}
