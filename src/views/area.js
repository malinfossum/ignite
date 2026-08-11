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
//   pendingFocusAddSectionId - after the next render, look up this section's
//                            add-task input and focus it. Set on Enter in the
//                            inline add row so a run of tasks can be typed
//                            without reaching for the mouse.
//   pendingAddValue        - Map<sectionId, string> of in-progress "Add task"
//                            text, kept current on every keystroke via a
//                            delegated input listener (not just for the
//                            focused section — a user can type in one
//                            section's row, then something else re-renders
//                            while a DIFFERENT input has focus). Rendered
//                            back into each add-input's value; cleared for a
//                            section only when its add commits successfully.
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
//   renamingTaskId         - task id currently in rename mode, or null.
//                            Parallel to renamingId (sections), with full
//                            cross-type mutual exclusion in rename-task /
//                            rename-section action handlers.
//   pendingRenameTaskValue - in-progress task-rename text, preserved across
//                            re-renders. null on menu rename (prefill
//                            committed title). Must read with ??, not ||.
//   pendingRenameTaskSelect - true when entering task rename; on the next
//                            render the input is .focus()'d AND .select()'d.
//                            Cleared after one render so subsequent re-renders
//                            (60s tick) preserve cursor position.
//   isRendering            - true during the innerHTML rewrite; the blur
//                            listener checks it to ignore the synthetic blur
//                            fired when the focused input is detached.
//                            (Shared between section-rename and task-rename;
//                            one rewrite guards both.)
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
import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../utils/menu-keyboard.js";
import { attachRenameInput, readRenameCaret } from "../utils/rename-input.js";
import { renderMovePicker } from "./move-picker.js";
import { renderSection } from "./section.js";

export function createAreaView(rootEl, { areaId, callbacks }) {
	let lastState = null;
	let openMenuId = null;
	let openTaskMenuId = null;
	let renamingId = null;
	let pendingFocusSectionId = null;
	// After adding a task inline, re-focus that section's add input so a run
	// of tasks can be typed without reaching for the mouse.
	let pendingFocusAddSectionId = null;
	// Map<sectionId, string> — in-flight "Add task" text per section. See
	// the closure-state doc comment above.
	let pendingAddValue = new Map();
	let pendingMenuFocusSectionId = null;
	let pendingRenameSelect = false;
	let pendingFocusTaskId = null;
	let pendingMenuFocusTaskId = null;
	let pendingRenameValue = null;
	let renamingTaskId = null;
	let pendingRenameTaskValue = null;
	let pendingRenameTaskSelect = false;
	let isRendering = false;
	// Sub-face of the open task menu: 'actions' (default) | 'picker'.
	// RESET to 'actions' on every open-menu; destroy resets it too.
	let taskMenuMode = "actions";
	// area.js-only cross-area focus fallback: source sectionId of a moved task.
	// In doRender, if the moved task's ⋯ lookup MISSES (cross-area move → the
	// task left this page), focus the source section's ⋯ instead of dropping
	// focus to <body>.
	let pendingFocusMoveSourceSectionId = null;
	// null | { prevSectionId: string | null } — the object wrapper matters:
	// prevSectionId is legitimately null ("focus ＋ New section"), so a bare
	// null flag couldn't distinguish "not set" from "set to no-predecessor".
	let pendingFocusAfterSectionDelete = null;

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
		taskMenuMode = "actions"; // hygiene — next open resets it anyway
		doRender();
	};

	const cancelRename = () => {
		if (!renamingId) return;
		pendingFocusSectionId = renamingId;
		renamingId = null;
		pendingRenameValue = null;
		doRender();
	};

	const cancelTaskRename = () => {
		if (!renamingTaskId) return;
		pendingFocusTaskId = renamingTaskId;
		renamingTaskId = null;
		pendingRenameTaskValue = null;
		doRender();
	};

	// Single entry points into rename — shared by the ⋯-menu actions, the F2
	// shortcut, and (tasks only) the title double-click. Idempotent. Each
	// preserves the bidirectional cross-type mutual exclusion: entering one
	// rename clears the other's state so they can never be live at once.
	const enterSectionRename = (s) => {
		if (!s || renamingId === s.id) return;
		openMenuId = null;
		renamingId = s.id;
		pendingRenameSelect = true;
		pendingRenameValue = null; // prefill the committed name
		renamingTaskId = null;
		pendingRenameTaskValue = null;
		pendingRenameTaskSelect = false;
		doRender();
	};

	const enterTaskRename = (t) => {
		if (!t || renamingTaskId === t.id) return;
		openTaskMenuId = null;
		renamingTaskId = t.id;
		pendingRenameTaskSelect = true;
		pendingRenameTaskValue = null; // prefill the committed title
		renamingId = null;
		pendingRenameValue = null;
		pendingRenameSelect = false;
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
	function findOpenMenuInArea(target) {
		if (openMenuId) {
			const menu = rootEl.querySelector(
				`[data-section-id="${CSS.escape(openMenuId)}"] [role="menu"]`,
			);
			if (menu?.contains(target)) return menu;
		}
		if (openTaskMenuId) {
			const menu = rootEl.querySelector(
				`[data-id="${CSS.escape(openTaskMenuId)}"] [role="menu"]`,
			);
			if (menu?.contains(target)) return menu;
		}
		return null;
	}

	const docKeyHandler = (event) => {
		if (event.key === "Escape") {
			if (renamingId) {
				cancelRename();
				return;
			}
			if (renamingTaskId) {
				cancelTaskRename();
				return;
			}
			if (openMenuId) {
				closeMenu();
				return;
			}
			if (openTaskMenuId) {
				closeTaskMenu();
			}
			return;
		}

		const menuEl = findOpenMenuInArea(event.target);
		if (!menuEl) return;

		const menuItems = Array.from(menuEl.querySelectorAll('[role="menuitem"]'));
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
			case "Tab":
				event.preventDefault();
				if (openMenuId) closeMenu(true);
				else if (openTaskMenuId) closeTaskMenu(true);
				return;
			default:
				return;
		}

		event.preventDefault();
		if (nextIdx >= 0) menuItems[nextIdx].focus();
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

	// Double-click a task title to rename. Delegated on rootEl (survives
	// re-renders), scoped to .task__title only. Section titles live inside the
	// collapse-toggle button, so they intentionally do NOT get double-click.
	const dblclickHandler = (event) => {
		if (!event.target.closest(".task__title")) return;
		const t = taskFromEvent(event.target);
		if (t) enterTaskRename(t);
	};
	rootEl.addEventListener("dblclick", dblclickHandler);

	// Mirrors the rename inputs' onInput mirroring, but delegated rather than
	// attached per-element: rename-input.js's attachRenameInput assumes a
	// single live input (rootEl.querySelector(selector) — first match only),
	// which doesn't fit here since every section renders its own add-input
	// at once. A delegated listener on rootEl survives each innerHTML
	// rewrite without re-wiring, and keeps pendingAddValue current for every
	// section's row, not just whichever one currently has focus.
	const addInputHandler = (event) => {
		const el = event.target;
		if (!el.classList?.contains("section__add-input")) return;
		const sectionId = el.dataset.sectionId;
		if (sectionId) pendingAddValue.set(sectionId, el.value);
	};
	rootEl.addEventListener("input", addInputHandler);

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
			enterSectionRename(sectionFromEvent(actionEl));
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
			// Focus is routed by the controller AFTER the cascade writes land,
			// via focusAfterSectionDelete → see onDeleteSection in controller.js.
			// Do not set a focus flag here: it would be consumed by an
			// in-flight notify-render and then wiped by the next one.
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
			taskMenuMode = "actions"; // always open in the actions face
			// Keyboard activations report event.detail === 0; on keyboard-open
			// move focus to the first menu item (mirrors open-section-menu).
			if (event.detail === 0) {
				pendingMenuFocusTaskId = t.id;
			}
			doRender();
		},

		"rename-task": (_event, actionEl) => {
			enterTaskRename(taskFromEvent(actionEl));
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

		"open-repeat": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			openTaskMenuId = null;
			taskMenuMode = "actions"; // reset (move-picker invariant)
			doRender(); // close the menu visually BEFORE the controller sets inert
			callbacks.onOpenRepeatEditor?.(t.id);
		},

		"move-task-to": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			// Menu already open on this task — just flip its face to the picker.
			// stopPropagation: doRender() below rewrites innerHTML synchronously,
			// detaching event.target; without it the click bubbles on to the
			// document click-outside handler, which sees the detached target as
			// "outside" and closes the still-open menu. Mirrors open-menu.
			taskMenuMode = "picker";
			pendingMenuFocusTaskId = t.id; // focus first target after render
			doRender();
		},

		"pick-move-target": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			const targetSectionId = actionEl?.dataset?.targetSectionId;
			if (!t || !targetSectionId) return;
			openTaskMenuId = null;
			taskMenuMode = "actions"; // reset for next open
			pendingFocusTaskId = t.id; // focus follows the task if still visible
			pendingFocusMoveSourceSectionId = t.sectionId; // cross-area fallback
			callbacks.onMoveTaskToSection({ taskId: t.id, targetSectionId });
			// No doRender() — the model-notify re-render consumes the focus flags
			// (same as move-task-up/down). Self-heal on the swallowed-error path:
			// every moveToSection throw cause is a deletion that fires its own
			// notify → re-render → the (already-null) menu closes.
		},

		"move-picker-back": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			// stopPropagation: same reason as move-task-to — doRender() detaches
			// event.target, so the click must not reach the click-outside handler.
			taskMenuMode = "actions";
			pendingMenuFocusTaskId = t.id; // focus first action item (Rename)
			doRender();
		},

		// File is a shortcut, not a new mechanism: it opens the task's own ⋯
		// menu already switched to picker mode, so pick-move-target, its drain
		// and the move undo toast all apply unchanged.
		//
		// stopPropagation is REQUIRED. The synchronous doRender below detaches
		// this button, after which the document click handler would see a
		// detached target and close the menu it just opened — the same trap
		// documented for move-task-to.
		"file-task": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			openMenuId = null;
			openTaskMenuId = t.id;
			taskMenuMode = "picker";
			doRender();
		},
	});

	const unbindKeys = bindKeys(rootEl, {
		Enter: async (event, actionEl) => {
			if (event.isComposing) return; // IME mid-composition: Enter confirms the candidate, doesn't commit
			if (actionEl?.dataset?.action === "commit-section-add") {
				event.preventDefault();
				const title = actionEl.value.trim();
				const sectionId = actionEl.dataset.sectionId;
				if (!title || !sectionId) return;
				// Await and clear only on success — mirrors capture.js's commit().
				// Clearing eagerly (the old behaviour) ate the typed text on any
				// rejected write; the held pendingAddValue must survive a failure
				// too, or C2's re-render protection loses the same text a
				// different way.
				try {
					await callbacks.onAddTaskToSection({ sectionId, title });
					actionEl.value = "";
					pendingAddValue.delete(sectionId);
					pendingFocusAddSectionId = sectionId;
				} catch {
					// Write failed (quota, private mode, …) — leave the typed
					// text and the held value in place. No toast: out of scope.
				}
				return;
			}
			if (renamingId && actionEl?.dataset?.action === "commit-rename") {
				event.preventDefault(); // prevent form-like default
				commitRenameFromInput(actionEl);
				return;
			}
			if (
				renamingTaskId &&
				actionEl?.dataset?.action === "commit-task-rename"
			) {
				event.preventDefault();
				commitTaskRenameFromInput(actionEl);
			}
		},
		F2: (event) => {
			// Innermost match wins: a focused task control resolves to its
			// [data-id] before the enclosing section's [data-section-id]; a
			// section-header control resolves only to the section.
			const t = taskFromEvent(event.target);
			if (t) {
				enterTaskRename(t);
				return;
			}
			const s = sectionFromEvent(event.target);
			if (s) enterSectionRename(s);
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

	function commitTaskRenameFromInput(inputEl) {
		const id = inputEl?.dataset?.taskId ?? renamingTaskId;
		if (!id) return;
		const value = (inputEl?.value ?? "").trim();
		renamingTaskId = null;
		pendingFocusTaskId = id;
		pendingRenameTaskValue = null;
		if (value) {
			callbacks.onCommitTaskRename({ taskId: id, name: value });
			// Model write is async; the model-notify-driven re-render picks up
			// pendingFocusTaskId and focuses the renamed task's ⋯ button.
		} else {
			doRender(); // empty/cancel — re-render now to consume the flag
		}
	}

	function doRender() {
		if (!lastState) return;

		// Carets are read BEFORE the rewrite detaches the live inputs; the shared
		// helper re-focuses and restores them after re-render. See utils/rename-input.js.
		const sectionCaret = readRenameCaret(rootEl, ".section__rename-input");
		const taskCaret = readRenameCaret(rootEl, ".task__rename-input");

		// C2: same idea for whichever add-input has focus, if any — captured
		// before the rewrite detaches it. Doesn't reuse readRenameCaret (it
		// takes a single selector and returns the FIRST match; multiple
		// section__add-input elements are on screen at once, so "first" is
		// not necessarily "focused").
		const focusedAddEl = document.activeElement;
		const addFocus =
			focusedAddEl?.classList?.contains("section__add-input") &&
			rootEl.contains(focusedAddEl)
				? {
						sectionId: focusedAddEl.dataset.sectionId,
						start: focusedAddEl.selectionStart,
						end: focusedAddEl.selectionEnd,
					}
				: null;

		isRendering = true;
		try {
			rootEl.innerHTML = template(lastState, areaId, {
				openMenuId,
				renamingId,
				openTaskMenuId,
				pendingRenameValue,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
				pendingAddValue,
			});
		} finally {
			// try/finally so a defensive template throw can't strand
			// isRendering=true and silently swallow all future blur-commits.
			isRendering = false;
		}

		// Re-wire the section-rename input (recreated each render). The shared
		// helper mirrors typing, commits on user blur (not the synthetic detach
		// blur), and focuses+selects or restores the caret. See utils/rename-input.js.
		const sectionAttached = attachRenameInput(
			rootEl,
			".section__rename-input",
			{
				onInput: (value) => {
					pendingRenameValue = value;
				},
				onCommit: commitRenameFromInput,
				isRendering: () => isRendering,
				isEditing: () => !!renamingId,
				selectOnFocus: pendingRenameSelect,
				caret: sectionCaret,
			},
		);
		if (sectionAttached) pendingRenameSelect = false;

		// Re-wire the task-rename input. Same harness, separate state — section
		// and task rename are mutually exclusive (see the action handlers above).
		const taskAttached = attachRenameInput(rootEl, ".task__rename-input", {
			onInput: (value) => {
				pendingRenameTaskValue = value;
			},
			onCommit: commitTaskRenameFromInput,
			isRendering: () => isRendering,
			isEditing: () => !!renamingTaskId,
			selectOnFocus: pendingRenameTaskSelect,
			caret: taskCaret,
		});
		if (taskAttached) pendingRenameTaskSelect = false;

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

		if (pendingFocusAddSectionId) {
			const el = rootEl.querySelector(
				`[data-section-id="${CSS.escape(pendingFocusAddSectionId)}"] .section__add-input`,
			);
			pendingFocusAddSectionId = null;
			el?.focus();
		} else if (addFocus) {
			// C2: no explicit post-commit focus request (the branch above), but
			// an add-input had focus going into this rewrite — restore it, the
			// value it already carries (rendered from pendingAddValue, see
			// template()), and the caret.
			const el = rootEl.querySelector(
				`.section__add-input[data-section-id="${CSS.escape(addFocus.sectionId)}"]`,
			);
			if (el) {
				el.focus();
				el.setSelectionRange(addFocus.start, addFocus.end);
			}
		}

		if (pendingFocusTaskId) {
			const trigger = rootEl.querySelector(
				`[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
			);
			if (trigger) {
				trigger.focus();
			} else if (pendingFocusMoveSourceSectionId) {
				// Cross-area move: the task left this page. Fall back to the
				// source section's ⋯ so focus doesn't drop to <body>.
				rootEl
					.querySelector(
						`[data-section-id="${CSS.escape(pendingFocusMoveSourceSectionId)}"] .section__menu-btn`,
					)
					?.focus();
			}
			pendingFocusTaskId = null;
			pendingFocusMoveSourceSectionId = null;
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

		// Post-render lookup: a cascade delete removed the section whose ⋯ had
		// focus, so focus would fall to <body>. Route it to the previous
		// section's ⋯, or "＋ New section" when the deleted one was first/only
		// (or when the predecessor is itself gone — a cascade race).
		//
		// Consumed LAST and cleared UNCONDITIONALLY: a rename input that
		// claimed focus above must win, and a flag set for a render that never
		// reaches this branch must not leak into a later, unrelated render.
		if (pendingFocusAfterSectionDelete) {
			const { prevSectionId } = pendingFocusAfterSectionDelete;
			pendingFocusAfterSectionDelete = null;
			if (!renamingId && !renamingTaskId) {
				const prevTrigger = prevSectionId
					? rootEl.querySelector(
							`[data-section-id="${CSS.escape(prevSectionId)}"] .section__menu-btn`,
						)
					: null;
				(prevTrigger ?? rootEl.querySelector(".area__add-section"))?.focus();
			}
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
		// Controller hook: after a Save/Remove re-render, restore focus to this
		// task's ⋯. Sets the pending flag only — the model-notify re-render (or the
		// controller's applyState on Cancel/Esc) consumes it via doRender's
		// pendingFocusTaskId lookup. Mirrors the move-handler focus pattern.
		focusTaskMenu(taskId) {
			pendingFocusTaskId = taskId;
		},
		// Controller hook: after a section cascade delete, route focus to a
		// surviving neighbour. Sets the pending flag ONLY — the controller's
		// applyState() after its model writes provides the consuming render.
		// Setting it before those writes would let the first notify's render
		// consume it, and the second render's innerHTML rewrite would then
		// detach the focused button anyway. Mirrors focusTaskMenu.
		focusAfterSectionDelete(prevSectionId) {
			pendingFocusAfterSectionDelete = { prevSectionId };
		},
		destroy() {
			// Destroy-commit: if a section rename is in flight and the input has
			// a non-empty trimmed value, commit it before tearing down.
			if (renamingId) {
				const input = rootEl.querySelector(".section__rename-input");
				const value = (input?.value ?? "").trim();
				if (value) {
					callbacks.onCommitRename({ sectionId: renamingId, name: value });
				}
				renamingId = null;
			}
			// Destroy-commit: same for an in-flight task rename. Order doesn't
			// matter (different inputs, different IDs); both fire BEFORE
			// listener unbinding so the typed value isn't lost.
			if (renamingTaskId) {
				const input = rootEl.querySelector(".task__rename-input");
				const value = (input?.value ?? "").trim();
				if (value) {
					callbacks.onCommitTaskRename({ taskId: renamingTaskId, name: value });
				}
				renamingTaskId = null;
			}
			unbindClick();
			unbindKeys();
			rootEl.removeEventListener("dblclick", dblclickHandler);
			rootEl.removeEventListener("input", addInputHandler);
			document.removeEventListener("click", docClickHandler);
			document.removeEventListener("keydown", docKeyHandler);
			rootEl.innerHTML = "";
			lastState = null;
			openMenuId = null;
			openTaskMenuId = null;
			pendingFocusSectionId = null;
			pendingFocusAddSectionId = null;
			pendingAddValue = new Map();
			pendingFocusTaskId = null;
			pendingMenuFocusSectionId = null;
			pendingMenuFocusTaskId = null;
			pendingRenameSelect = false;
			pendingRenameValue = null;
			pendingRenameTaskValue = null;
			pendingRenameTaskSelect = false;
			isRendering = false;
			taskMenuMode = "actions";
			pendingFocusMoveSourceSectionId = null;
			pendingFocusAfterSectionDelete = null;
		},
	};
}

function template(
	state,
	areaId,
	{
		openMenuId,
		renamingId,
		openTaskMenuId,
		pendingRenameValue,
		renamingTaskId,
		pendingRenameTaskValue,
		taskMenuMode,
		pendingAddValue,
	},
) {
	const area = state.areas.find((a) => a.id === areaId);
	if (!area) {
		return `
			<section class="area area--not-found">
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

	// ≥1 section other than any task's own ⇒ a valid move target exists.
	const hasMoveTargets = state.sections.length > 1;

	// Compute the picker only for the open task in picker mode — guarded so
	// it's skipped on every normal render.
	let movePickerHtml = null;
	if (openTaskMenuId && taskMenuMode === "picker") {
		const openTask = state.tasks.find((t) => t.id === openTaskMenuId);
		if (openTask) {
			movePickerHtml = renderMovePicker({
				task: openTask,
				areas: state.areas,
				sections: state.sections,
			});
		}
	}

	const sectionHtml = sections
		.map((s, i) =>
			renderSection({
				section: s,
				tasks: tasksBySection.get(s.id) ?? [],
				isUndeletable: s.id === "focus-default",
				showFile: s.id === "focus-default",
				isFirst: i === 0,
				isLast: i === sections.length - 1,
				openMenuId,
				renamingId,
				openTaskMenuId,
				pendingRenameValue,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
				movePickerHtml,
				hasMoveTargets,
				now: state.now,
				pendingAddValue: pendingAddValue.get(s.id),
			}),
		)
		.join("");

	return `
		<section class="area" data-area-id="${escapeHtml(area.id)}">
			<div class="area__sections">${sectionHtml}</div>
			<footer class="area__footer">
				<button type="button" class="area__add-section" data-action="add-section">＋ New section</button>
			</footer>
		</section>
	`;
}
