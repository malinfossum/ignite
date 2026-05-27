// createToastView(rootEl) → { show, update, isActive, destroy }
//
// One toast at a time. show() replaces any existing toast (and its timer).
// update() mutates the active toast's message + resets timer in place.
// isActive(key) returns true iff the active toast matches the given key.
//
// Pause/resume (WCAG 2.2.1): mouseenter OR focusin on the .toast div pauses
// the dismiss timer; resume requires both mouseleave AND focusout.
// Pause/resume are idempotent.
//
// Closure-state reset contract: clearActive() resets EVERY closure variable
// on every exit path (undo / dismiss / replace-on-show / destroy). Without
// the enumeration, stale state (e.g. elapsedAtPause from a prior paused
// toast) leaks into the next show and the resume math goes wrong.
//
// aria-live placement: the live region is the message span only, NOT the
// toast root. With focus on the Undo button (sibling of the message span,
// outside the live region), update() textContent changes still announce
// to screen readers. (Per W3C: focus INSIDE a live region suppresses
// change announcements in some SRs.)

import { escapeHtml } from "../utils/dom.js";

const DEFAULT_DURATION_MS = 5_000;

// Identifies the task-delete aggregation batch. Single source of truth so
// a typo silently disabling aggregation is impossible — controller imports
// this constant rather than hard-coding the string.
export const TASK_DELETE_BATCH_KEY = "task-delete";

export function createToastView(rootEl) {
	let timer = null;
	let timerStartedAt = null;
	let elapsedAtPause = 0;
	let durationMs = null;
	let activeKey = null;
	let activeUndoHandler = null;
	let activeOnDismiss = null;
	let isHovered = false;
	let isFocused = false;

	function clearActive() {
		if (timer) clearTimeout(timer);
		timer = null;
		timerStartedAt = null;
		elapsedAtPause = 0;
		durationMs = null;
		activeKey = null;
		activeUndoHandler = null;
		activeOnDismiss = null;
		isHovered = false;
		isFocused = false;
		rootEl.innerHTML = ""; // detaches .toast div + its listeners
	}

	function pause() {
		if (timer === null) return; // idempotent
		clearTimeout(timer);
		elapsedAtPause += Date.now() - timerStartedAt;
		timer = null;
		timerStartedAt = null;
	}

	function resume() {
		if (timer !== null) return; // idempotent
		if (durationMs === null) return; // no active toast
		const remainingMs = Math.max(0, durationMs - elapsedAtPause);
		timerStartedAt = Date.now();
		timer = setTimeout(onTimerExpire, remainingMs);
	}

	function onTimerExpire() {
		const onDismiss = activeOnDismiss;
		clearActive();
		if (onDismiss) onDismiss();
	}

	function attachInteractionListeners(toastEl) {
		toastEl.addEventListener("mouseenter", () => {
			isHovered = true;
			pause();
		});
		toastEl.addEventListener("mouseleave", () => {
			isHovered = false;
			if (!isFocused) resume();
		});
		toastEl.addEventListener("focusin", () => {
			isFocused = true;
			pause();
		});
		toastEl.addEventListener("focusout", () => {
			isFocused = false;
			if (!isHovered) resume();
		});
	}

	function show({ message, onUndo, onDismiss, durationMs: d, key } = {}) {
		// Fire prior toast's onDismiss before replacing (so its closure state
		// is committed — e.g. taskDeleteBatch in controller clears).
		const priorOnDismiss = activeOnDismiss;
		clearActive();
		if (priorOnDismiss) priorOnDismiss();

		const dur = d ?? DEFAULT_DURATION_MS;
		durationMs = dur;
		activeKey = key ?? null;
		activeOnDismiss = onDismiss ?? null;

		rootEl.innerHTML = `
			<div class="toast">
				<span class="toast__message" role="status" aria-live="polite">${escapeHtml(message ?? "")}</span>
				<button class="toast__undo" type="button">Undo</button>
			</div>
		`;

		const toastEl = rootEl.querySelector(".toast");
		const undoBtn = rootEl.querySelector(".toast__undo");

		activeUndoHandler = () => {
			clearActive();
			if (onUndo) onUndo();
		};
		undoBtn.addEventListener("click", activeUndoHandler, { once: true });

		attachInteractionListeners(toastEl);

		timerStartedAt = Date.now();
		timer = setTimeout(onTimerExpire, dur);
	}

	function update({ message, durationMs: d } = {}) {
		if (durationMs === null) return; // no-op when no active toast
		const messageEl = rootEl.querySelector(".toast__message");
		if (messageEl) messageEl.textContent = message ?? "";

		// Reset timer state for the fresh duration.
		const dur = d ?? DEFAULT_DURATION_MS;
		durationMs = dur;
		elapsedAtPause = 0;
		if (timer !== null) {
			// Running: restart fresh.
			clearTimeout(timer);
			timerStartedAt = Date.now();
			timer = setTimeout(onTimerExpire, dur);
		}
		// If paused: leave timer null; resume() will use the new durationMs
		// with elapsedAtPause=0 = full fresh window on un-hover.
	}

	function isActive(key) {
		return activeKey !== null && activeKey === key;
	}

	return {
		show,
		update,
		isActive,
		destroy() {
			clearActive();
		},
	};
}
