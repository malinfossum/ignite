// createFocusView(rootEl, { onToggleComplete, onToggleStar, onDelete })
//   → { render, focusTaskMenu, selectTab, getActiveTab, destroy }
//
// state expected: { tasks, sections, areas, settings, now }
// onDelete receives the full task object so the controller can restore it.

import { FOCUS_ID } from "../model/areas.js";
import { areaForTask } from "../utils/areas.js";
import { bindActions, bindKeys } from "../utils/dom.js";
import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../utils/menu-keyboard.js";
import { attachRenameInput, readRenameCaret } from "../utils/rename-input.js";
import { groupTasksForFocus, pickNextTask } from "../utils/time.js";
import { renderTabStrip, TABS } from "./focus-tabs.js";
import { renderMovePicker } from "./move-picker.js";
import { renderTaskRow } from "./task.js";

export function createFocusView(rootEl, callbacks) {
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
	// Which tab is showing. VIEW-owned, not a model field and not controller
	// state: every step of a tab switch acts on state that lives in this closure
	// (the open menu, the live rename), and "always resets to Today on mount"
	// then comes for free — leaving Focus for an area destroys the view, so
	// coming back always lands here again. Spec §3.3.
	let activeTab = "today";
	// After the next render, focus this tab's button. Consumed last in doRender,
	// cleared unconditionally, reset in destroy() — same contract as every other
	// pending-focus flag in this file.
	let pendingFocusTab = null;

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

	// Single entry point into task rename — shared by the ⋯-menu "Rename"
	// action, the F2 shortcut, and the title double-click. Idempotent: a
	// second trigger on the already-renaming task is a no-op.
	const enterTaskRename = (t) => {
		if (!t || renamingTaskId === t.id) return;
		openMenuTaskId = null;
		renamingTaskId = t.id;
		pendingRenameTaskSelect = true;
		pendingRenameTaskValue = null; // prefill the committed title
		doRender();
	};

	// Switching tab is a lifecycle event, not just a re-render: the panel is
	// rewritten, which detaches everything inside it. In order (spec §3.3):
	//   1. close any open task menu
	//   2. resolve a live rename by COMMITTING it, matching Enter — never
	//      discard what the user typed
	//   3. render the new tab
	//   4. move focus to the newly-selected tab button
	//
	// Step 3 is deliberately conditional. When a rename commit fires, the model
	// write's own notify-render is the render that must consume pendingFocusTab.
	// Rendering here as well would focus the tab button and then let that queued
	// render rewrite innerHTML underneath it, dropping focus to <body> — the trap
	// the cascade-focus drain exists to prevent, and a view cannot drain, only
	// the controller can await applyState(). commitTaskRenameFromInput below
	// renders in exactly one branch for exactly this reason.
	const selectTab = (next) => {
		if (!TABS.some((t) => t.id === next)) return;

		openMenuTaskId = null;
		taskMenuMode = "actions";
		pendingMenuFocusTaskId = null;
		// Never route focus back to a ⋯ button that is about to be detached.
		pendingFocusTaskId = null;

		let renameCommitted = false;
		if (renamingTaskId) {
			const input = rootEl.querySelector(".task__rename-input");
			const value = (input?.value ?? "").trim();
			const id = renamingTaskId;
			renamingTaskId = null;
			pendingRenameTaskValue = null;
			pendingRenameTaskSelect = false;
			if (value) {
				callbacks.onCommitTaskRename({ taskId: id, name: value });
				renameCommitted = true;
			}
		}

		activeTab = next;
		pendingFocusTab = next;
		if (!renameCommitted) doRender();
	};

	const docClickHandler = (event) => {
		if (!openMenuTaskId) return;
		if (rootEl.contains(event.target)) return;
		closeMenu(false);
	};

	function findOpenMenuInFocus(target) {
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

		const menuEl = findOpenMenuInFocus(event.target);
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

	// Double-click a task title to rename. Delegated on rootEl (survives
	// re-renders). Scoped to .task__title — the checkbox / star / ⋯ are
	// excluded, and section titles / area names aren't rendered here.
	const dblclickHandler = (event) => {
		if (!event.target.closest(".task__title")) return;
		const t = taskFromEvent(event.target);
		if (t) enterTaskRename(t);
	};
	rootEl.addEventListener("dblclick", dblclickHandler);

	const unbind = bindActions(rootEl, {
		"select-tab": (_event, actionEl) => {
			const next = actionEl?.dataset?.tab;
			if (next) selectTab(next);
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
			enterTaskRename(taskFromEvent(actionEl));
		},
		"delete-task": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			openMenuTaskId = null;
			if (t) callbacks.onDelete(t);
		},

		"open-repeat": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			openMenuTaskId = null; // focus.js names it openMenuTaskId
			taskMenuMode = "actions";
			doRender();
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

		// File is a shortcut, not a new mechanism: it opens this task's own ⋯ menu
		// already switched to picker mode, so pick-move-target, the move undo
		// toast and the picker's a11y all apply unchanged.
		//
		// stopPropagation is REQUIRED. The synchronous doRender below detaches
		// this button, after which the document click handler would see a detached
		// target as "outside" and close the menu it just opened — the same trap
		// documented for move-task-to.
		"file-task": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			openMenuTaskId = t.id;
			taskMenuMode = "picker";
			pendingMenuFocusTaskId = t.id; // §4.2: the picker opens on its first item
			doRender();
		},

		"pick-move-target": (_event, actionEl) => {
			const t = taskFromEvent(actionEl);
			const targetSectionId = actionEl?.dataset?.targetSectionId;
			if (!t || !targetSectionId) return;
			openMenuTaskId = null;
			taskMenuMode = "actions"; // reset for next open
			if (activeTab === "focus") {
				// Filing is precisely what takes the row off this tab, so the ⋯ we
				// would return to will not exist after the render. The Focus tab
				// button always does.
				pendingFocusTab = "focus";
			} else {
				// A move changes neither dueAt nor starred, so the task stays on
				// this tab; refocus its ⋯.
				pendingFocusTaskId = t.id;
			}
			callbacks.onMoveTaskToSection({ taskId: t.id, targetSectionId });
			// No doRender() — the model-notify re-render consumes the focus flag.
			// Toast is the only visible feedback here.
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
			if (event.isComposing) return; // IME mid-composition: Enter confirms the candidate, doesn't commit
			if (
				renamingTaskId &&
				actionEl?.dataset?.action === "commit-task-rename"
			) {
				event.preventDefault();
				commitTaskRenameFromInput(actionEl);
			}
		},
		F2: (event) => {
			// F2 renames the focused row's task (no default browser action).
			const t = taskFromEvent(event.target);
			if (t) enterTaskRename(t);
		},
		ArrowRight: (event) => moveTabFocus(event, 1),
		ArrowLeft: (event) => moveTabFocus(event, -1),
		Home: (event) => moveTabFocus(event, 0, firstEnabledIndex),
		End: (event) => moveTabFocus(event, 0, lastEnabledIndex),
	});

	// Roving-tabindex traversal for the tab strip, mirroring the icon picker.
	// Guarded on the event target actually being a tab, so it never competes with
	// the ⋯ menu's own Home/End handling (which is guarded on being inside an
	// open menu) or with a caret moving inside a rename input.
	//
	// Activation is automatic: arrowing to a tab selects it, per the APG pattern
	// for cheap panels. selectTab moves the focus, so nothing is needed here
	// beyond choosing the target.
	function moveTabFocus(event, direction, pick) {
		if (!event.target.closest('[role="tab"]')) return;
		const items = TABS.map(() => ({ disabled: false }));
		const currentIndex = TABS.findIndex((t) => t.id === activeTab);
		const nextIdx = pick
			? pick(items)
			: nextEnabledIndex(items, currentIndex, direction);
		if (nextIdx < 0) return;
		event.preventDefault();
		selectTab(TABS[nextIdx].id);
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

		// Caret is read BEFORE the rewrite detaches the live input; the shared
		// helper re-focuses and restores it after re-render. See utils/rename-input.js.
		const taskCaret = readRenameCaret(rootEl, ".task__rename-input");

		// The 60s tick and every model notify rewrite this subtree with no user
		// action behind them, detaching whatever held focus. Without this, focus
		// parked on a tab drops to <body> once a minute — and the tab strip is now
		// the whole surface's navigation, so that is not a small loss.
		//
		// Only ever re-asserts focus that was ALREADY on a tab, and the guard means
		// it never overrides a tab switch that has explicitly asked for focus.
		if (!pendingFocusTab) {
			pendingFocusTab =
				document.activeElement?.closest?.(".focus-tab")?.dataset?.tab ?? null;
		}

		isRendering = true;
		try {
			rootEl.innerHTML = template(
				lastState,
				openMenuTaskId,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
				activeTab,
			);
		} finally {
			// try/finally so a defensive template throw can't strand
			// isRendering=true and silently swallow all future blur-commits.
			isRendering = false;
		}

		// Re-wire the inline-rename input (recreated on every render). The shared
		// helper mirrors typing, commits on user blur (not the synthetic detach
		// blur), and focuses+selects or restores the caret. See utils/rename-input.js.
		const attached = attachRenameInput(rootEl, ".task__rename-input", {
			onInput: (value) => {
				pendingRenameTaskValue = value;
			},
			onCommit: commitTaskRenameFromInput,
			isRendering: () => isRendering,
			isEditing: () => !!renamingTaskId,
			selectOnFocus: pendingRenameTaskSelect,
			caret: taskCaret,
		});
		if (attached) pendingRenameTaskSelect = false;

		// Post-render lookup: focus the task's ⋯ button by data-attribute.
		// Captured element refs go stale across innerHTML rewrites, so we query
		// the freshly-rendered DOM.
		if (pendingFocusTaskId) {
			const trigger = rootEl.querySelector(
				`[data-id="${CSS.escape(pendingFocusTaskId)}"] .task__menu-btn`,
			);
			// The task may have left this tab entirely between the flag being set
			// and this render — rescheduling it to next week from the Schedule
			// dialog is enough, and that is now the ordinary outcome rather than an
			// edge case. Without the fallback, `?.focus()` silently no-ops and focus
			// stays wherever the closed dialog left it: <body>.
			if (trigger) trigger.focus();
			else
				rootEl
					.querySelector(`.focus-tab[data-tab="${CSS.escape(activeTab)}"]`)
					?.focus();
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

		// Last flag consumed, cleared unconditionally. selectTab nulls the two
		// above before setting this one, so it is mutually exclusive with them
		// THERE — but the pre-rewrite capture at the top of this function (the
		// `if (!pendingFocusTab)` fallback that reads document.activeElement
		// before the rewrite) sets this flag directly without touching
		// pendingFocusTaskId or pendingMenuFocusTaskId, so that exclusivity is
		// not a property of every path that sets it.
		if (pendingFocusTab) {
			rootEl
				.querySelector(`.focus-tab[data-tab="${CSS.escape(pendingFocusTab)}"]`)
				?.focus();
			pendingFocusTab = null;
		}
	}

	return {
		render(state) {
			lastState = state;
			doRender();
		},
		focusTaskMenu(taskId) {
			pendingFocusTaskId = taskId;
		},
		selectTab,
		getActiveTab: () => activeTab,
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
			rootEl.removeEventListener("dblclick", dblclickHandler);
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
			activeTab = "today";
			pendingFocusTab = null;
		},
	};
}

function template(
	state,
	openMenuTaskId,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	activeTab,
) {
	// Which sections belong to Focus. Resolved here, then passed as data, because
	// utils/time.js must stay ignorant of FOCUS_ID. Every Focus section counts,
	// not just focus-default — §12.4 keeps pre-merge extra sections from
	// orphaning their tasks now that the surface has no section headings.
	const focusSectionIds = state.sections
		.filter((s) => s.areaId === FOCUS_ID)
		.map((s) => s.id);

	const groups = groupTasksForFocus(state.tasks, state.now, focusSectionIds);
	const counts = {
		today: groups.overdue.length + groups.today.length,
		tomorrow: groups.tomorrow.length,
		starred: groups.starred.length,
		focus: groups.notepad.length,
	};

	// >=1 section other than any task's own ⇒ a valid move target exists.
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

	const rowOpts = {
		now: state.now,
		openMenuTaskId,
		renamingTaskId,
		pendingRenameTaskValue,
		taskMenuMode,
		movePickerHtml,
		hasMoveTargets,
		areas: state.areas,
		sections: state.sections,
		// The notepad is entirely Focus-area tasks, so a badge there would say
		// "Focus" on every row. File is the notepad's own affordance: one tap to
		// move a captured thought out, so it never rots for costing two levels of
		// menu to file. Spec D7.
		//
		// File is gated on hasMoveTargets for the same reason "Move to…" is. With
		// only the Focus area and its one section there is nowhere to file to, and
		// an ungated button would render on every row purely to open a picker
		// holding nothing but the disabled "No other sections" hint and Back.
		showBadge: activeTab !== "focus",
		showFile: activeTab === "focus" && hasMoveTargets,
	};

	return `
		${renderTabStrip({ activeTab, counts })}
		${renderPanel(activeTab, groups, state, rowOpts)}
	`;
}

// One panel at a time — the other three are not in the DOM, which is what keeps
// aria-controls honest and stops four lists of rows from competing for ids.
function renderPanel(activeTab, groups, state, rowOpts) {
	// isEmpty comes back as a flag rather than being sniffed out of the HTML.
	// Testing `body.includes('class="empty"')` would work today — escapeHtml
	// turns a `"` in a task title into `&quot;`, so no row can forge it — but it
	// couples this decision to a class name inside a string and breaks silently
	// the first time someone adds a class or reorders an attribute.
	const { html, isEmpty } = panelBody(activeTab, groups, state, rowOpts);
	// A panel full of rows already holds checkboxes and buttons, so adding a tab
	// stop would just be one more thing to Tab past. An EMPTY panel holds nothing
	// at all, and without tabindex the message is unreachable from the keyboard.
	const focusable = isEmpty ? ' tabindex="0"' : "";
	return `
		<div class="focus-panel" id="focus-panel-${activeTab}" role="tabpanel"
			aria-labelledby="focus-tab-${activeTab}"${focusable}>${html}</div>
	`;
}

// Every tab needs an empty state. A blank surface with no message is
// indistinguishable from a broken render, and one of these four (Focus) is the
// very first thing a new user sees.
//
// The Focus copy deliberately does NOT say where the capture bar is. The bar is
// pinned to the BOTTOM on phones and sits at the top from 768px up (decision
// D9), so any directional word is wrong on one of the two — and wrong on the
// primary form factor if it says "above".
const EMPTY_STATE = {
	today: "Nothing due today.",
	tomorrow: "Nothing scheduled for tomorrow.",
	starred: "Star a task to pull it into your day.",
	focus: "Anything you capture lands here.",
};

// Returns { html, isEmpty }. The caller needs the flag, not a guess at it — see
// renderPanel above.
function panelBody(activeTab, groups, state, rowOpts) {
	if (activeTab === "tomorrow") {
		const html = renderGroup(
			"Tomorrow",
			"group--tomorrow",
			groups.tomorrow,
			true,
			rowOpts,
		);
		return html ? { html, isEmpty: false } : renderEmpty("tomorrow");
	}
	if (activeTab === "starred") {
		const html = renderGroup(
			"Starred",
			"group--starred",
			groups.starred,
			false,
			rowOpts,
		);
		return html ? { html, isEmpty: false } : renderEmpty("starred");
	}
	if (activeTab === "focus") {
		const html = renderGroup(
			"Focus",
			"group--notepad",
			groups.notepad,
			false,
			rowOpts,
		);
		return html ? { html, isEmpty: false } : renderEmpty("focus");
	}

	const next = pickNextTask(groups, state.now);
	if (!next) return renderEmpty("today");
	const visible = (list) => list.filter((t) => t.id !== next.id);
	return {
		html: `
			${renderNextCard(next, rowOpts)}
			${renderGroup("Overdue", "group--overdue", visible(groups.overdue), true, rowOpts)}
			${renderGroup("Today", "group--today", visible(groups.today), true, rowOpts)}
		`,
		isEmpty: false,
	};
}

function renderEmpty(tab) {
	return { html: `<p class="empty">${EMPTY_STATE[tab]}</p>`, isEmpty: true };
}

function renderNextCard(task, rowOpts) {
	return `
		<article class="next-card">
			<h2 class="next-card__label">Next</h2>
			<ul class="next-card__list">
				${renderTaskRowWithMenu(task, rowOpts)}
			</ul>
		</article>
	`;
}

function renderGroup(heading, modifierClass, tasks, showCount, rowOpts) {
	if (tasks.length === 0) return "";
	// The count is a separate element, not part of the heading string: it is
	// metadata, and styling it as such is what lets the heading itself read as a
	// heading rather than a label.
	const countHtml = showCount
		? `<span class="group__count">${tasks.length}</span>`
		: "";
	const rows = tasks.map((t) => renderTaskRowWithMenu(t, rowOpts)).join("");
	return `
		<section class="group ${modifierClass}">
			<h3 class="group__heading">${heading}${countHtml}</h3>
			<ul class="group__list">${rows}</ul>
		</section>
	`;
}

function renderTaskRowWithMenu(task, rowOpts) {
	const {
		now,
		openMenuTaskId,
		renamingTaskId,
		pendingRenameTaskValue,
		taskMenuMode,
		movePickerHtml,
		hasMoveTargets,
		areas,
		sections,
		showBadge,
		showFile,
	} = rowOpts;

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
	const areaName = showBadge
		? (areaForTask(task, sections, areas)?.name ?? null)
		: null;
	const row = renderTaskRow(task, { now, isOpen, areaName, showFile });
	if (!isOpen) return row;

	// Picker face: replace the action menu with the pre-rendered picker.
	// The menu injects inside the <li> as its last child (the <li> is
	// position: relative so the absolute menu anchors to the row).
	//
	// The replacement is a FUNCTION, not a string. A string replacement treats
	// `$&`, `$'` and "$`" as substitution patterns, and escapeHtml does not touch
	// `$` — so an area or section named `$&` reaches here through the picker
	// markup and expands to the matched `</li>`, injecting a stray closing tag.
	// Not script execution (the match is always the literal `</li>`), but real
	// DOM corruption. A function replacement never interprets `$`.
	if (taskMenuMode === "picker" && movePickerHtml) {
		return row.replace("</li>", () => `${movePickerHtml}</li>`);
	}

	// Actions face. Focus menu: [Rename, Move to…, Schedule…, Delete]. No Move
	// up/down — every tab here is a sorted view, not a manual order.
	const moveToItem = hasMoveTargets
		? `<button class="task-menu__item" type="button" data-action="move-task-to" role="menuitem" tabindex="-1" aria-haspopup="menu">Move to…</button>`
		: "";
	// Function replacement here too — same `$&` reasoning as the picker face
	// above. Nothing user-authored is in this string today, but the two call
	// sites must not drift apart.
	return row.replace(
		"</li>",
		() => `<div class="task-menu" role="menu">
			<button class="task-menu__item" type="button" data-action="rename-task" role="menuitem" tabindex="-1">Rename</button>
			${moveToItem}
			<button class="task-menu__item" type="button" data-action="open-repeat" role="menuitem" tabindex="-1" aria-haspopup="dialog">Schedule…</button>
			<button class="task-menu__item" type="button" data-action="delete-task" role="menuitem" tabindex="-1">Delete</button>
		</div></li>`,
	);
}
