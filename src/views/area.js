// createAreaView(rootEl, { areaId, callbacks }) → { render(state), destroy(), enterRename(id) }
//
// Renders one area page: title, sections list, "＋ New section" footer.
//
// Closure state:
//   openMenuId             - section id whose ⋯ menu is open, or null
//   openTaskMenuId         - task id whose ⋯ menu is open, or null
//   renamingId             - section id currently in rename mode, or null
//   pendingFocusSectionId  - after the next render, look up this section's
//                            ⋯ button and focus it. Used for menu-close,
//                            rename commit/cancel, and post-create rename.
//   pendingMenuFocusSectionId - after the next render, look up the first
//                            [role="menuitem"] inside this section's menu
//                            and focus it. Used when the menu opens via
//                            keyboard (Enter on ⋯) — see open-section-menu.
//   pendingRenameSelect    - true when entering rename; on the next render
//                            the input is .focus()-ed AND .select()-ed.
//                            Cleared after that one render so subsequent
//                            re-renders (60s tick, unrelated notifies)
//                            preserve cursor position.
//   pendingFocusTaskId     - mirror of pendingFocusSectionId for task rows.
//                            After the next render, look up the task's
//                            ⋯ button by data-id and focus it. Used for
//                            Move up / Move down AND menu-close focus return.
//   pendingMenuFocusTaskId - after the next render, focus the first
//                            [role="menuitem"] inside this task's menu.
//                            Used when the task menu opens via keyboard.
//   pendingRenameValue     - in-progress rename text, preserved across
//                            re-renders (60s tick, unrelated notifies) so
//                            typing isn't lost. "" on create (empty box),
//                            null on menu rename (prefill committed name).
//   isRendering            - true during the innerHTML rewrite; the blur
//                            listener checks it to ignore the synthetic blur
//                            fired when the focused input is detached.
//
// We do NOT capture element references for focus return. Across an
// innerHTML rewrite, captured elements detach and .focus() on them is a
// silent no-op. The pending* flags + post-render lookups by data-attribute
// work because they query the freshly-rendered DOM.
//
// callbacks:
//   onAddSection({ areaId })
//   onToggleSection({ sectionId, collapsed })
//   onCommitRename({ sectionId, name })   - empty/whitespace ⇒ cancel
//   onMoveUp({ sectionId })
//   onMoveDown({ sectionId })
//   onMoveTaskUp({ taskId })
//   onMoveTaskDown({ taskId })
//   onDeleteSection({ sectionId })
//   onDeleteTask(task)
//   onToggleComplete(taskId)
//   onToggleStar(taskId, currentStarred)

import { bindActions, bindKeys, escapeHtml } from "../utils/dom.js";
import { renderSection } from "./section.js";

export function createAreaView(rootEl, { areaId, callbacks }) {
	let lastState = null;
	let openMenuId = null;
	let openTaskMenuId = null;
	let renamingId = null;
	let pendingFocusSectionId = null;
	let pendingMenuFocusSectionId = null;
	let pendingRenameSelect = false;
	let pendingFocusTaskId = null;
	let pendingMenuFocusTaskId = null;
	let pendingRenameValue = null;
	let isRendering = false;

	// returnFocus=false on click-outside dismiss: focus follows the click
	// (e.g. into the capture input), not back to the ⋯. Esc / menu-action /
	// toggle close use the default (true) to restore focus to the ⋯ button.
	const closeMenu = (returnFocus = true) => {
		if (!openMenuId) return;
		if (returnFocus) pendingFocusSectionId = openMenuId;
		openMenuId = null;
		doRender();
	};

	const closeTaskMenu = (returnFocus = true) => {
		if (!openTaskMenuId) return;
		if (returnFocus) pendingFocusTaskId = openTaskMenuId;
		openTaskMenuId = null;
		doRender();
	};

	const cancelRename = () => {
		if (!renamingId) return;
		pendingFocusSectionId = renamingId;
		renamingId = null;
		pendingRenameValue = null;
		doRender();
	};

	const docClickHandler = (event) => {
		if (rootEl.contains(event.target)) return;
		// Outside click: close without focus return so focus stays where the
		// user clicked (e.g. the capture input, a sibling outside #main-root).
		if (openMenuId) closeMenu(false);
		if (openTaskMenuId) closeTaskMenu(false);
	};
	document.addEventListener("click", docClickHandler);

	// Esc lives on document, not rootEl. After doRender() rewrites innerHTML
	// the previously-focused element is detached and focus drops to <body>,
	// which is outside rootEl. A keydown on body bubbles up to document only —
	// it never visits rootEl. Matches the today.js pattern.
	const docKeyHandler = (event) => {
		if (event.key !== "Escape") return;
		if (renamingId) {
			cancelRename();
			return;
		}
		if (openMenuId) {
			closeMenu();
			return;
		}
		if (openTaskMenuId) {
			closeTaskMenu();
		}
	};
	document.addEventListener("keydown", docKeyHandler);

	const sectionFromEvent = (actionEl) => {
		const sectionEl = actionEl.closest("[data-section-id]");
		if (!sectionEl || !lastState) return null;
		return (
			lastState.sections.find((s) => s.id === sectionEl.dataset.sectionId) ??
			null
		);
	};

	const taskFromEvent = (actionEl) => {
		const taskEl = actionEl.closest("[data-id]");
		if (!taskEl || !lastState) return null;
		return lastState.tasks.find((t) => t.id === taskEl.dataset.id) ?? null;
	};

	const unbindClick = bindActions(rootEl, {
		"add-section": () => callbacks.onAddSection({ areaId }),

		"toggle-section": (_event, actionEl) => {
			const s = sectionFromEvent(actionEl);
			if (s)
				callbacks.onToggleSection({ sectionId: s.id, collapsed: !s.collapsed });
		},

		"open-section-menu": (event, actionEl) => {
			event.stopPropagation();
			const s = sectionFromEvent(actionEl);
			if (!s) return;
			if (openMenuId === s.id) {
				closeMenu();
				return;
			}
			// Mutual exclusion with task menu
			openTaskMenuId = null;
			openMenuId = s.id;
			// Heuristic: keyboard activations (Enter/Space) report
			// event.detail === 0; mouse clicks report >= 1. When opened
			// via keyboard we move focus to the first menu item; mouse
			// users keep focus on ⋯ (their pointer is what they care about).
			if (event.detail === 0) {
				pendingMenuFocusSectionId = s.id;
			}
			doRender();
		},

		"rename-section": (_event, actionEl) => {
			const s = sectionFromEvent(actionEl);
			if (!s) return;
			openMenuId = null;
			renamingId = s.id;
			pendingRenameSelect = true;
			pendingRenameValue = null; // menu rename → prefill committed name
			doRender();
		},

		// No "commit-rename" click action: the rename input carries
		// data-action="commit-rename" only so the Enter key handler (bindKeys,
		// which reads the attribute) can find it. Wiring it as a CLICK action
		// too would commit + exit rename whenever the user clicks inside the
		// field to position the cursor. Enter and blur are the only commit paths.

		"move-up": (_event, actionEl) => {
			const s = sectionFromEvent(actionEl);
			openMenuId = null;
			if (s) {
				pendingFocusSectionId = s.id;
				callbacks.onMoveUp({ sectionId: s.id });
			}
		},

		"move-down": (_event, actionEl) => {
			const s = sectionFromEvent(actionEl);
			openMenuId = null;
			if (s) {
				pendingFocusSectionId = s.id;
				callbacks.onMoveDown({ sectionId: s.id });
			}
		},

		"delete-section": (_event, actionEl) => {
			const s = sectionFromEvent(actionEl);
			openMenuId = null;
			// No pendingFocusSectionId — the section is about to vanish.
			// The toast appears (announced via aria-live) and the user
			// Tabs to Undo from there.
			if (s) callbacks.onDeleteSection({ sectionId: s.id });
		},

		"toggle-complete": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (t) callbacks.onToggleComplete(t.id);
		},

		"toggle-star": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (t) callbacks.onToggleStar(t.id, t.starred);
		},

		"open-menu": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			if (openTaskMenuId === t.id) {
				closeTaskMenu();
				return;
			}
			// Mutual exclusion with section menu
			openMenuId = null;
			openTaskMenuId = t.id;
			// Keyboard activations report event.detail === 0; on keyboard-open
			// move focus to the first menu item (mirrors open-section-menu).
			if (event.detail === 0) {
				pendingMenuFocusTaskId = t.id;
			}
			doRender();
		},

		"move-task-up": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			openTaskMenuId = null;
			if (t) {
				pendingFocusTaskId = t.id;
				callbacks.onMoveTaskUp({ taskId: t.id });
			}
		},

		"move-task-down": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			openTaskMenuId = null;
			if (t) {
				pendingFocusTaskId = t.id;
				callbacks.onMoveTaskDown({ taskId: t.id });
			}
		},

		"delete-task": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			openTaskMenuId = null;
			if (t) callbacks.onDeleteTask(t);
		},
	});

	const unbindKeys = bindKeys(rootEl, {
		Enter: (event, actionEl) => {
			if (renamingId && actionEl?.dataset?.action === "commit-rename") {
				event.preventDefault(); // prevent form-like default
				commitRenameFromInput(actionEl);
			}
		},
	});

	function commitRenameFromInput(inputEl) {
		const id = inputEl?.dataset?.sectionId ?? renamingId;
		if (!id) return;
		const value = (inputEl?.value ?? "").trim();
		renamingId = null;
		pendingFocusSectionId = id;
		pendingRenameValue = null;
		if (value) {
			callbacks.onCommitRename({ sectionId: id, name: value });
			// Model write is async; the model-notify-driven re-render will
			// pick up pendingFocusSectionId and focus the new ⋯ button.
		} else {
			doRender(); // empty/cancel — re-render now to consume the flag
		}
	}

	function doRender() {
		if (!lastState) return;

		isRendering = true;
		try {
			rootEl.innerHTML = template(lastState, areaId, {
				openMenuId,
				renamingId,
				openTaskMenuId,
				pendingRenameValue,
			});
		} finally {
			// try/finally so a defensive template throw can't strand
			// isRendering=true and silently swallow all future blur-commits.
			isRendering = false;
		}

		// Re-attach input + blur listeners on the NEW input (recreated each
		// render). The input listener mirrors typing into pendingRenameValue so
		// it survives re-renders; the blur listener commits, but skips the
		// synthetic blur fired when an innerHTML rewrite detaches the input.
		const input = rootEl.querySelector(".section__rename-input");
		if (input) {
			input.addEventListener("input", (e) => {
				pendingRenameValue = e.target.value;
			});
			input.addEventListener(
				"blur",
				() => {
					if (isRendering) return;
					if (renamingId) commitRenameFromInput(input);
				},
				{ once: true },
			);

			// Only select() on first render after entering rename mode.
			// Subsequent re-renders preserve cursor.
			if (pendingRenameSelect) {
				input.focus();
				input.select();
				pendingRenameSelect = false;
			} else if (document.activeElement !== input) {
				input.focus();
			}
		}

		// Post-render lookup: focus the section's ⋯ button by data-attribute.
		// This is how we restore focus after innerHTML rewrites — element
		// references captured BEFORE the rewrite are detached and can't
		// receive focus.
		if (pendingFocusSectionId) {
			const trigger = rootEl.querySelector(
				`[data-section-id="${CSS.escape(pendingFocusSectionId)}"] .section__menu-btn`,
			);
			trigger?.focus();
			pendingFocusSectionId = null;
		}

		if (pendingFocusTaskId) {
			const trigger = rootEl.querySelector(
				`[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
			);
			trigger?.focus();
			pendingFocusTaskId = null;
		}

		// Post-render lookup: when a menu was opened via keyboard, move focus
		// to its first menu item. Menus now OMIT boundary moves rather than
		// disabling them, so no item is disabled today; :not([disabled]) is
		// kept as a defensive guard (.focus() on a disabled button is a silent
		// no-op that drops focus to <body>). querySelector returns the first
		// match in document order.
		if (pendingMenuFocusSectionId) {
			const firstItem = rootEl.querySelector(
				`[data-section-id="${CSS.escape(pendingMenuFocusSectionId)}"] [role="menu"] [role="menuitem"]:not([disabled])`,
			);
			firstItem?.focus();
			pendingMenuFocusSectionId = null;
		}

		if (pendingMenuFocusTaskId) {
			const firstItem = rootEl.querySelector(
				`[data-id="${CSS.escape(pendingMenuFocusTaskId)}"] [role="menu"] [role="menuitem"]:not([disabled])`,
			);
			firstItem?.focus();
			pendingMenuFocusTaskId = null;
		}
	}

	return {
		render(state) {
			lastState = state;
			doRender();
		},
		// Public hook for the controller to flip a freshly-created section
		// into rename mode without the view subscribing to model changes.
		enterRename(sectionId) {
			renamingId = sectionId;
			pendingRenameSelect = true;
			pendingRenameValue = ""; // start EMPTY — "New section" needn't be deleted
			openMenuId = null;
			doRender();
		},
		destroy() {
			// Destroy-commit: if a rename is in flight and the input has a
			// non-empty trimmed value, commit it before tearing down so
			// typed work isn't silently lost.
			if (renamingId) {
				const input = rootEl.querySelector(".section__rename-input");
				const value = (input?.value ?? "").trim();
				if (value) {
					callbacks.onCommitRename({ sectionId: renamingId, name: value });
				}
				renamingId = null;
			}
			unbindClick();
			unbindKeys();
			document.removeEventListener("click", docClickHandler);
			document.removeEventListener("keydown", docKeyHandler);
			rootEl.innerHTML = "";
			lastState = null;
			openMenuId = null;
			openTaskMenuId = null;
			pendingFocusSectionId = null;
			pendingFocusTaskId = null;
			pendingMenuFocusSectionId = null;
			pendingMenuFocusTaskId = null;
			pendingRenameSelect = false;
			pendingRenameValue = null;
			isRendering = false;
		},
	};
}

function template(
	state,
	areaId,
	{ openMenuId, renamingId, openTaskMenuId, pendingRenameValue },
) {
	const area = state.areas.find((a) => a.id === areaId);
	if (!area) {
		return `
			<section class="area area--not-found">
				<h1 class="area__title">Area not found.</h1>
				<p class="area__not-found-help">
					<a href="#today" class="area__back-link">Back to Today</a>
				</p>
			</section>
		`;
	}

	const sections = state.sections
		.filter((s) => s.areaId === areaId)
		.sort((a, b) => a.order - b.order);

	const tasksBySection = new Map();
	for (const t of state.tasks) {
		if (!t.completed) {
			const list = tasksBySection.get(t.sectionId) ?? [];
			list.push(t);
			tasksBySection.set(t.sectionId, list);
		}
	}
	for (const list of tasksBySection.values()) {
		list.sort((a, b) => a.order - b.order);
	}

	const sectionHtml = sections
		.map((s, i) =>
			renderSection({
				section: s,
				tasks: tasksBySection.get(s.id) ?? [],
				isUndeletable: s.id === "focus-default",
				isFirst: i === 0,
				isLast: i === sections.length - 1,
				openMenuId,
				renamingId,
				openTaskMenuId,
				pendingRenameValue,
				now: state.now,
			}),
		)
		.join("");

	const titleHtml = area.name
		? `<h1 class="area__title">${escapeHtml(area.name)}</h1>`
		: "";

	return `
		<section class="area" data-area-id="${escapeHtml(area.id)}">
			<header class="area__header">${titleHtml}</header>
			<div class="area__sections">${sectionHtml}</div>
			<footer class="area__footer">
				<button type="button" class="area__add-section" data-action="add-section">＋ New section</button>
			</footer>
		</section>
	`;
}
