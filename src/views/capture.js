// createCaptureView(rootEl, { onSubmit, focusSectionId }) → { destroy() }
//
// onSubmit(title: string, sectionId: string) is called for non-empty trimmed
// input on Enter. Esc inside the input clears the typed value (no submit, no
// model write) — unless the section picker is open, in which case Esc closes
// the picker and leaves the text.
// Mounts once, never re-renders — preserves the input cursor across
// model notifies and route changes.

import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../utils/menu-keyboard.js";
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
				aria-haspopup="menu"
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
		// Idempotent teardown first: a reentrant call (e.g. the input regains
		// focus while the picker is still open, then Enter fires again) would
		// otherwise reassign docClickHandler while the old listener is still
		// attached to document, and it could then never be removed.
		closePicker();
		pickerRoot.innerHTML = renderCapturePicker({
			sections: destination.sections ?? [],
		});
		pickerOpen = true;
		pickerRoot.querySelector('[role="menuitem"]')?.focus();

		// Outside click closes and KEEPS the text. Registered async so the
		// submit that opened the picker doesn't immediately close it.
		// `handler` is a local const the timeout closes over, so the function
		// that gets added to document is always the one this call scheduled —
		// never whatever docClickHandler happens to point to by the time the
		// timeout fires.
		const handler = (event) => {
			if (rootEl.contains(event.target)) return;
			closePicker();
		};
		docClickHandler = handler;
		setTimeout(() => document.addEventListener("click", handler), 0);
	}

	// Closing NEVER clears the input. The typed title is the thing the user
	// was trying not to lose; discarding it is the failure this whole feature
	// exists to prevent. Spec §4.2.
	//
	// restoreFocus defaults to true — every dismissal path (Escape, Cancel,
	// outside click, Tab, the controller's onHashChange) wants focus back on
	// the input. destroy() is the one caller that passes false: it's about
	// to wipe the subtree, so focusing the input first would only get
	// immediately discarded, dropping focus to <body> instead of leaving it
	// wherever destroy()'s caller intends.
	function closePicker({ restoreFocus = true } = {}) {
		if (!pickerOpen) return;
		pickerRoot.innerHTML = "";
		pickerOpen = false;
		if (docClickHandler) {
			document.removeEventListener("click", docClickHandler);
			docClickHandler = null;
		}
		if (restoreFocus) input.focus();
	}

	async function commit(sectionId) {
		const value = input.value.trim();
		if (!value) return;
		try {
			await onSubmit(value, sectionId);
			input.value = "";
		} catch (err) {
			// Write failed (quota, private mode, …) — leave the typed text in
			// place. Clearing it here would be exactly the data loss this
			// whole feature exists to prevent. No toast: out of scope.
			console.error("Ignite: capture failed to save", err);
		}
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
	//
	// Below Escape: ARIA APG menu navigation for the picker, guarded on
	// pickerOpen AND the event target being inside the picker — same double
	// guard as the ⋯-menu handlers in focus.js / area.js (area.js:216-217),
	// extending this single rootEl listener rather than adding a second one.
	// The second half matters here specifically: clicking back into the
	// input does NOT close the picker (the outside-click handler returns
	// early for anything inside rootEl), so "picker open, focus in the
	// input" is reachable. Without this guard, Home/End would yank focus
	// out of the input into the menu instead of moving the caret, and
	// ArrowUp would compute currentIndex === -1 (the input isn't a
	// menuitem) and land on the wrong item.
	const keydownHandler = (event) => {
		if (event.key === "Escape") {
			if (pickerOpen) {
				closePicker();
				return;
			}
			input.value = "";
			return;
		}

		// Tab closes the picker whenever it's open, regardless of where focus
		// sits inside the capture root — deliberately NOT gated on
		// pickerRoot.contains(event.target) like the Arrow/Home/End guard
		// below. Clicking back into the input is a reachable state (the
		// outside-click handler early-returns for anything inside rootEl),
		// and picker items are tabindex="-1", so without this Tab from the
		// input would jump past the open menu and leave it open.
		if (event.key === "Tab" && pickerOpen) {
			event.preventDefault();
			closePicker();
			return;
		}

		if (!pickerOpen) return;
		if (!pickerRoot.contains(event.target)) return;

		const menuItems = Array.from(
			pickerRoot.querySelectorAll('[role="menuitem"]'),
		);
		const currentIndex = menuItems.indexOf(event.target);
		const items = menuItems.map((el) => ({ disabled: el.disabled }));

		let nextIdx = -1;
		switch (event.key) {
			case "ArrowDown":
				nextIdx = nextEnabledIndex(items, currentIndex, 1);
				break;
			case "ArrowUp":
				nextIdx = nextEnabledIndex(items, currentIndex, -1);
				break;
			case "Home":
				nextIdx = firstEnabledIndex(items);
				break;
			case "End":
				nextIdx = lastEnabledIndex(items);
				break;
			default:
				return;
		}

		event.preventDefault();
		if (nextIdx >= 0) menuItems[nextIdx].focus();
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
			closePicker({ restoreFocus: false });
			form.removeEventListener("submit", handler);
			rootEl.removeEventListener("keydown", keydownHandler);
			pickerRoot.removeEventListener("click", pickerClickHandler);
			rootEl.innerHTML = "";
		},
	};
}
