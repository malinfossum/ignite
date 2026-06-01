// createTodayView(rootEl, { onToggleComplete, onToggleStar, onDelete })
//   → { render(state), destroy() }
//
// state expected: { tasks, sections, areas, settings, now }
// onDelete receives the full task object so the controller can restore it.

import { bindActions, bindKeys } from "../utils/dom.js";
import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../utils/menu-keyboard.js";
import { groupTasksForToday, pickNextTask } from "../utils/time.js";
import { renderMovePicker } from "./move-picker.js";
import { renderTaskRow } from "./task.js";

export function createTodayView(rootEl, callbacks) {
	let lastState = null;
	let openMenuTaskId = null;
	let pendingFocusTaskId = null;
	// Set in open-menu when event.detail === 0 (keyboard activation): after
	// the next render, focus the first [role="menuitem"] inside this task's
	// menu. Mirrors pendingMenuFocusTaskId in area.js / sidebar.js.
	let pendingMenuFocusTaskId = null;
	// Inline task rename — mirrors area.js / sidebar.js patterns:
	//   renamingTaskId          - task id in rename mode, or null
	//   pendingRenameTaskValue  - in-progress text; survives 60s ticks. ?? not ||.
	//   pendingRenameTaskSelect - true on first render after enter → focus+select
	//   isRendering             - true during innerHTML rewrite; blur-listener
	//                             early-returns to ignore the synthetic blur
	//                             fired when the focused input is detached.
	let renamingTaskId = null;
	let pendingRenameTaskValue = null;
	let pendingRenameTaskSelect = false;
	let isRendering = false;
	// Sub-face of the open task menu: 'actions' (default) | 'picker'.
	// RESET to 'actions' on every open-menu; destroy resets it too.
	let taskMenuMode = "actions";

	// returnFocus=false on click-outside dismiss: focus follows the click
	// (e.g. into the capture input), not back to the ⋯. Esc / menu-action /
	// toggle close use the default (true) to restore focus to the ⋯ button.
	const closeMenu = (returnFocus = true) => {
		if (!openMenuTaskId) return;
		if (returnFocus) pendingFocusTaskId = openMenuTaskId;
		openMenuTaskId = null;
		taskMenuMode = "actions"; // hygiene — next open resets it anyway
		doRender();
	};

	const cancelTaskRename = () => {
		if (!renamingTaskId) return;
		pendingFocusTaskId = renamingTaskId;
		renamingTaskId = null;
		pendingRenameTaskValue = null;
		doRender();
	};

	const docClickHandler = (event) => {
		if (!openMenuTaskId) return;
		if (rootEl.contains(event.target)) return;
		closeMenu(false);
	};

	function findOpenMenuInToday(target) {
		if (!openMenuTaskId) return null;
		const menu = rootEl.querySelector(
			`[data-id="${CSS.escape(openMenuTaskId)}"] [role="menu"]`,
		);
		return menu?.contains(target) ? menu : null;
	}

	const docKeyHandler = (event) => {
		if (event.key === "Escape") {
			if (renamingTaskId) {
				cancelTaskRename();
				return;
			}
			closeMenu();
			return;
		}

		const menuEl = findOpenMenuInToday(event.target);
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
				closeMenu(true);
				return;
			default:
				return;
		}

		event.preventDefault();
		if (nextIdx >= 0) menuItems[nextIdx].focus();
	};
	document.addEventListener("click", docClickHandler);
	document.addEventListener("keydown", docKeyHandler);

	const taskFromEvent = (actionEl) => {
		const li = actionEl.closest("[data-id]");
		if (!li || !lastState) return null;
		return lastState.tasks.find((t) => t.id === li.dataset.id) ?? null;
	};

	const unbind = bindActions(rootEl, {
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
			if (openMenuTaskId === t.id) {
				closeMenu();
				return;
			}
			openMenuTaskId = t.id;
			taskMenuMode = "actions"; // always open in the actions face
			// Keyboard activations (Enter/Space) report event.detail === 0;
			// on keyboard-open move focus to the first menu item. Mouse users
			// (detail >= 1) keep focus on ⋯. Mirrors area.js / sidebar.js.
			if (event.detail === 0) {
				pendingMenuFocusTaskId = t.id;
			}
			doRender();
		},
		"rename-task": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			if (!t) return;
			openMenuTaskId = null;
			renamingTaskId = t.id;
			pendingRenameTaskSelect = true;
			pendingRenameTaskValue = null; // menu rename → prefill committed title
			doRender();
		},
		"delete-task": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			openMenuTaskId = null;
			if (t) callbacks.onDelete(t);
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
			openMenuTaskId = null;
			taskMenuMode = "actions"; // reset for next open
			pendingFocusTaskId = t.id; // the task stays in Today; refocus its ⋯
			callbacks.onMoveTaskToSection({ taskId: t.id, targetSectionId });
			// No doRender() — the model-notify re-render consumes the focus flag
			// (same as the area view). Toast is the only visible feedback here.
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
	});

	const unbindKeys = bindKeys(rootEl, {
		Enter: (event, actionEl) => {
			if (
				renamingTaskId &&
				actionEl?.dataset?.action === "commit-task-rename"
			) {
				event.preventDefault();
				commitTaskRenameFromInput(actionEl);
			}
		},
	});

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

		// Preserve the caret across the re-render. The rename input is recreated
		// every render, so the .focus() call below would otherwise drop the caret
		// to position 0 on each re-render (e.g. the 60s tick) while the user is
		// mid-rename. Capture the OLD input's selection before the rewrite detaches
		// it; restore it after .focus().
		const prevTaskInput = rootEl.querySelector(".task__rename-input");
		const taskCaret = prevTaskInput
			? { start: prevTaskInput.selectionStart, end: prevTaskInput.selectionEnd }
			: null;

		isRendering = true;
		try {
			rootEl.innerHTML = template(
				lastState,
				openMenuTaskId,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
			);
		} finally {
			// try/finally so a defensive template throw can't strand
			// isRendering=true and silently swallow all future blur-commits.
			isRendering = false;
		}

		// Re-attach task-rename input listeners on the NEW input (recreated
		// each render). pendingRenameTaskValue mirrors typing so it survives
		// re-renders; blur commits but skips the synthetic blur fired when
		// an innerHTML rewrite detaches the input.
		const taskRenameInput = rootEl.querySelector(".task__rename-input");
		if (taskRenameInput) {
			taskRenameInput.addEventListener("input", (e) => {
				pendingRenameTaskValue = e.target.value;
			});
			taskRenameInput.addEventListener(
				"blur",
				() => {
					if (isRendering) return;
					if (renamingTaskId) commitTaskRenameFromInput(taskRenameInput);
				},
				{ once: true },
			);

			// Only select() on first render after entering rename mode.
			// Subsequent re-renders (60s tick, unrelated notifies) preserve cursor.
			if (pendingRenameTaskSelect) {
				taskRenameInput.focus();
				taskRenameInput.select();
				pendingRenameTaskSelect = false;
			} else if (document.activeElement !== taskRenameInput) {
				taskRenameInput.focus();
				if (taskCaret) {
					taskRenameInput.setSelectionRange(taskCaret.start, taskCaret.end);
				}
			}
		}

		// Post-render lookup: focus the task's ⋯ button by data-attribute.
		// Captured element refs go stale across innerHTML rewrites, so we
		// query the freshly-rendered DOM. Mirrors area.js's pendingFocusTaskId.
		if (pendingFocusTaskId) {
			const trigger = rootEl.querySelector(
				`[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
			);
			trigger?.focus();
			pendingFocusTaskId = null;
		}

		// Post-render lookup: when the task menu was opened via keyboard,
		// move focus to its first menu item. :not([disabled]) is a defensive
		// guard — .focus() on a disabled button is a silent no-op that drops
		// focus to <body>. Mirrors area.js / sidebar.js.
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
		destroy() {
			// Destroy-commit: if a task rename is in flight and the input has
			// a non-empty trimmed value, commit it BEFORE listener unbinding so
			// the typed value isn't silently lost on route change.
			if (renamingTaskId) {
				const input = rootEl.querySelector(".task__rename-input");
				const value = (input?.value ?? "").trim();
				if (value) {
					callbacks.onCommitTaskRename({ taskId: renamingTaskId, name: value });
				}
				renamingTaskId = null;
			}
			unbind();
			unbindKeys();
			document.removeEventListener("click", docClickHandler);
			document.removeEventListener("keydown", docKeyHandler);
			rootEl.innerHTML = "";
			lastState = null;
			openMenuTaskId = null;
			pendingFocusTaskId = null;
			pendingMenuFocusTaskId = null;
			pendingRenameTaskValue = null;
			pendingRenameTaskSelect = false;
			isRendering = false;
			taskMenuMode = "actions";
		},
	};
}

function template(
	state,
	openMenuTaskId,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
) {
	const next = pickNextTask(state.tasks, state.now);
	const groups = groupTasksForToday(state.tasks, state.now);
	const visible = (list) => list.filter((t) => t.id !== next?.id);

	const overdue = visible(groups.overdue);
	const today = visible(groups.today);
	const starred = visible(groups.starred);

	const allEmpty =
		!next && overdue.length === 0 && today.length === 0 && starred.length === 0;

	if (allEmpty) {
		return `<p class="empty">You're clear. Nice.</p>`;
	}

	// ≥1 section other than any task's own ⇒ a valid move target exists.
	const hasMoveTargets = state.sections.length > 1;

	// Compute the picker only for the open task in picker mode.
	let movePickerHtml = null;
	if (openMenuTaskId && taskMenuMode === "picker") {
		const openTask = state.tasks.find((t) => t.id === openMenuTaskId);
		if (openTask) {
			movePickerHtml = renderMovePicker({
				task: openTask,
				areas: state.areas,
				sections: state.sections,
			});
		}
	}

	return `
		${next ? renderNextCard(next, state.now, openMenuTaskId, renamingTaskId, pendingRenameTaskValue, taskMenuMode, movePickerHtml, hasMoveTargets) : ""}
		${renderGroup("Overdue", "group--overdue", overdue, state.now, openMenuTaskId, true, renamingTaskId, pendingRenameTaskValue, taskMenuMode, movePickerHtml, hasMoveTargets)}
		${renderGroup("Today", "group--today", today, state.now, openMenuTaskId, true, renamingTaskId, pendingRenameTaskValue, taskMenuMode, movePickerHtml, hasMoveTargets)}
		${renderGroup("Starred", "group--starred", starred, state.now, openMenuTaskId, false, renamingTaskId, pendingRenameTaskValue, taskMenuMode, movePickerHtml, hasMoveTargets)}
	`;
}

function renderNextCard(
	task,
	now,
	openMenuTaskId,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	movePickerHtml,
	hasMoveTargets,
) {
	return `
		<article class="next-card">
			<h2 class="next-card__label">NEXT</h2>
			<ul class="next-card__list">
				${renderTaskRowWithMenu(task, now, openMenuTaskId, renamingTaskId, pendingRenameTaskValue, taskMenuMode, movePickerHtml, hasMoveTargets)}
			</ul>
		</article>
	`;
}

function renderGroup(
	heading,
	modifierClass,
	tasks,
	now,
	openMenuTaskId,
	showCount,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	movePickerHtml,
	hasMoveTargets,
) {
	if (tasks.length === 0) return "";
	const headingText = showCount ? `${heading} (${tasks.length})` : heading;
	const rows = tasks
		.map((t) =>
			renderTaskRowWithMenu(
				t,
				now,
				openMenuTaskId,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
				movePickerHtml,
				hasMoveTargets,
			),
		)
		.join("");
	return `
		<section class="group ${modifierClass}">
			<h3 class="group__heading">${headingText}</h3>
			<ul class="group__list">${rows}</ul>
		</section>
	`;
}

function renderTaskRowWithMenu(
	task,
	now,
	openMenuTaskId,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	movePickerHtml,
	hasMoveTargets,
) {
	const isRenaming = renamingTaskId === task.id;
	if (isRenaming) {
		// Rename input replaces the row's children — no menu injection,
		// no checkbox / star / ⋯. Mutually exclusive with menu state.
		return renderTaskRow(task, {
			now,
			renaming: true,
			pendingRenameValue: pendingRenameTaskValue,
		});
	}

	const isOpen = openMenuTaskId === task.id;
	const row = renderTaskRow(task, { now, isOpen });
	if (!isOpen) return row;

	// Picker face: replace the action menu with the pre-rendered picker.
	// The menu injects inside the <li> as its last child (the <li> is
	// position: relative so the absolute menu anchors to the row).
	if (taskMenuMode === "picker" && movePickerHtml) {
		return row.replace("</li>", `${movePickerHtml}</li>`);
	}

	// Actions face. Today menu: [Rename, Move to…, Delete]. No Move up/down —
	// today is a sorted view, not a manual order.
	const moveToItem = hasMoveTargets
		? `<button class="task-menu__item" type="button" data-action="move-task-to" role="menuitem" tabindex="-1" aria-haspopup="menu">Move to…</button>`
		: "";
	return row.replace(
		"</li>",
		`<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="rename-task" role="menuitem" tabindex="-1">Rename</button>
			${moveToItem}
			<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
}
