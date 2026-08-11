// createCaptureView(rootEl, { onSubmit, focusSectionId }) → { destroy() }
//
// onSubmit(title: string, sectionId: string) is called for non-empty trimmed
// input on Enter. Esc inside the input clears the typed value (no submit, no
// model write) — unless the section picker is open, in which case Esc closes
// the picker and leaves the text.
// Mounts once, never re-renders — preserves the input cursor across
// model notifies and route changes.

import { renderCapturePicker } from "./capture-picker.js";

export function createCaptureView(rootEl, { onSubmit, focusSectionId }) {
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

	const pickerRoot = rootEl.querySelector(".capture__picker-root");
	let pickerOpen = false;
	let docClickHandler = null;
	// Declared HERE, not in Task 3: this is the first task that reads it.
	let destination = { kind: "focus" };

	function openPicker() {
		pickerRoot.innerHTML = renderCapturePicker({
			sections: destination.sections ?? [],
		});
		pickerOpen = true;
		input.setAttribute("aria-expanded", "true");
		pickerRoot.querySelector('[role="menuitem"]')?.focus();

		// Outside click closes and KEEPS the text. Registered async so the
		// submit that opened the picker doesn't immediately close it.
		docClickHandler = (event) => {
			if (rootEl.contains(event.target)) return;
			closePicker();
		};
		setTimeout(() => document.addEventListener("click", docClickHandler), 0);
	}

	// Closing NEVER clears the input. The typed title is the thing the user
	// was trying not to lose; discarding it is the failure this whole feature
	// exists to prevent. Spec §4.2.
	function closePicker() {
		if (!pickerOpen) return;
		pickerRoot.innerHTML = "";
		pickerOpen = false;
		input.setAttribute("aria-expanded", "false");
		if (docClickHandler) {
			document.removeEventListener("click", docClickHandler);
			docClickHandler = null;
		}
		input.focus();
	}

	function commit(sectionId) {
		const value = input.value.trim();
		if (!value) return;
		onSubmit(value, sectionId);
		input.value = "";
		closePicker();
		input.focus();
	}

	const handler = (event) => {
		event.preventDefault();
		if (!input.value.trim()) return;
		if (destination.kind === "none") return;
		if (destination.kind === "pick") {
			openPicker();
			return;
		}
		commit(
			destination.kind === "direct" ? destination.sectionId : focusSectionId,
		);
	};
	form.addEventListener("submit", handler);

	const pickerClickHandler = (event) => {
		const actionEl = event.target.closest("[data-action]");
		if (!actionEl || !pickerRoot.contains(actionEl)) return;
		event.stopPropagation();
		if (actionEl.dataset.action === "cancel-capture-picker") {
			closePicker();
			return;
		}
		if (actionEl.dataset.action === "pick-capture-section") {
			commit(actionEl.dataset.targetSectionId);
		}
	};
	pickerRoot.addEventListener("click", pickerClickHandler);

	// Escape precedence: picker first, then clear. With the picker open,
	// Escape must close it and LEAVE the text — clearing would throw away
	// exactly what the user was protecting.
	const keydownHandler = (event) => {
		if (event.key !== "Escape") return;
		if (pickerOpen) {
			closePicker();
			return;
		}
		input.value = "";
	};
	rootEl.addEventListener("keydown", keydownHandler);

	return {
		// Targeted text write ONLY. An innerHTML rewrite here would destroy the
		// input's cursor position on every model notify — the whole reason this
		// view mounts once and never re-renders.
		setDestination(next, label) {
			destination = next;
			chip.textContent = label;
			input.disabled = next.kind === "none";
		},
		closePicker,
		destroy() {
			closePicker();
			form.removeEventListener("submit", handler);
			rootEl.removeEventListener("keydown", keydownHandler);
			pickerRoot.removeEventListener("click", pickerClickHandler);
			rootEl.innerHTML = "";
		},
	};
}
