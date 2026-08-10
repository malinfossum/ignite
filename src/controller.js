// createController({ models, els }) → { start(), stop() }
//
// Wires sidebar (always-on), capture (always-on; CSS-hidden on area route),
// toast (always-on), and a route-driven main view (Today or Area). Subscribes
// to all model notifies; rebuilds state and re-renders sidebar + currentMainView.
// Owns the 60s clock tick that calls currentMainView.render(state) only.

import { FOCUS_DEFAULT_SECTION_ID, FOCUS_ID } from "./model/areas.js";
import { previousSectionId } from "./utils/sections.js";
import { describeRecurrence, formatTaskDeleteMessage } from "./utils/text.js";
import {
	DEFAULT_CHOICE,
	nextThemeChoice,
	resolveTheme,
} from "./utils/theme.js";
import { formatOccurrenceLabel } from "./utils/time.js";
import { createAreaView } from "./views/area.js";
import { createCaptureView } from "./views/capture.js";
import { createRecurrenceDialog } from "./views/recurrence-dialog.js";
import { createSidebarView } from "./views/sidebar.js";
import { createToastView, TASK_DELETE_BATCH_KEY } from "./views/toast.js";
import { createTodayView } from "./views/today.js";
import { createTopbarView } from "./views/topbar.js";

const TICK_MS = 60_000;
const CASCADE_TOAST_MS = 8_000;
// A move is non-destructive — same urgency as a single-task delete-undo
// (5s), not the 8s cascade window reserved for destructive multi-item ops.
const MOVE_TOAST_MS = 5_000;
// Completing a recurring task is reversible (Undo restores the prior schedule)
// — same 5s urgency as a move/single-delete.
const COMPLETE_TOAST_MS = 5_000;

export function parseHash(hash) {
	const raw = (hash || "").replace(/^#/, "");
	if (raw === "" || raw === "today") return { name: "today" };
	const areaMatch = raw.match(/^area\/(.+)$/);
	if (areaMatch) return { name: "area", id: areaMatch[1] };
	return { name: "today" };
}

export function createController({ models, els }) {
	const { areas, sections, tasks, settings } = models;
	const {
		sidebarRoot,
		topbarRoot,
		scrimEl,
		mainEl,
		captureRoot,
		mainRoot,
		toastRoot,
		repeatDialogRoot,
	} = els;

	let sidebar = null;
	let topbar = null;
	let capture = null;
	let toast = null;
	let currentMainView = null;
	let currentRoute = { name: "today" };
	let tickHandle = null;
	let unsubs = [];
	let taskDeleteBatch = null; // null | { tasks: Array<TaskSnapshot> }
	let drawerOpen = false; // transient UI state — NOT a model field (mirrors is-area-route)
	let drawerMq = null; // matchMedia("(min-width: 768px)") — stored for teardown
	let drawerMqHandler = null;
	let recurrenceDialog = null;
	let repeatEditorTaskId = null; // transient UI state — NOT a model field
	const completing = new Set(); // task ids mid-completion (re-entry guard)
	let currentChoice = null; // "system" | "dark" | "light" — mirrors the model
	let currentTheme = null; // resolved "dark" | "light" — what is on the document
	let themeMq = null; // matchMedia("(prefers-color-scheme: dark)")
	let themeMqHandler = null;

	// Applies the resolved theme to the document. The settings model is the source
	// of truth; localStorage is a derived paint-time cache read only by the inline
	// <head> snippet, and stores the CHOICE (including "system") so the snippet can
	// re-resolve it the same way on the next boot.
	function applyTheme(choice, theme) {
		const choiceChanged = choice !== currentChoice;
		const themeChanged = theme !== currentTheme;
		currentChoice = choice;
		currentTheme = theme;
		if (choiceChanged) localStorage.setItem("ignite:theme", choice);
		if (!themeChanged) return;
		document.documentElement.dataset.theme = theme;
		const meta = document.querySelector('meta[name="theme-color"]');
		meta?.setAttribute("content", theme === "dark" ? "#0b0a0a" : "#f6f8fa");
	}

	async function buildState() {
		const [areaList, sectionList, taskList, settingsRecord] = await Promise.all(
			[areas.list(), sections.list(), tasks.list(), settings.get()],
		);
		return {
			areas: areaList,
			sections: sectionList,
			tasks: taskList,
			settings: settingsRecord,
			route: currentRoute,
			now: new Date(),
		};
	}

	async function applyState() {
		const state = await buildState();
		const choice = state.settings.theme ?? DEFAULT_CHOICE;
		applyTheme(
			choice,
			resolveTheme(
				choice,
				window.matchMedia("(prefers-color-scheme: dark)").matches,
			),
		);
		state.themeChoice = currentChoice;
		state.theme = currentTheme;
		document.body.classList.toggle(
			"is-sidebar-collapsed",
			!!(state.settings.sidebarCollapsed ?? false),
		);
		document.body.classList.toggle(
			"is-area-route",
			currentRoute.name === "area",
		);
		sidebar?.render(state);
		currentMainView?.render(state);
	}

	async function handleToggleComplete(id) {
		// Re-entry guard: a fast double-click/tap must advance a recurring task
		// exactly once. Added synchronously at the top so two queued activations
		// can't both pass before either marks the id. Coalescing a genuine
		// double-fire to one toggle is also right for plain tasks.
		if (completing.has(id)) return;
		completing.add(id);
		try {
			const task = (await tasks.list()).find((t) => t.id === id);
			if (!task) return; // race: already gone
			// Non-recurring, or un-checking a (defensively) completed one → unchanged.
			if (!task.recurrence || task.completed) {
				await tasks.toggleCompleted(id);
				return;
			}
			const snapshot = {
				dueAt: task.dueAt,
				lastCompletedAt: task.lastCompletedAt,
				completedCount: task.completedCount,
			};
			try {
				await tasks.completeOccurrence(id);
			} catch (err) {
				if (/not found/i.test(err.message)) return; // cascade race
				throw err;
			}
			const updated = (await tasks.list()).find((t) => t.id === id);
			toast.show({
				message: `Done · next ${formatOccurrenceLabel(updated.dueAt, new Date())}`,
				durationMs: COMPLETE_TOAST_MS,
				onUndo: async () => {
					try {
						await tasks.update(id, snapshot); // restore date, stamp, count
					} catch (err) {
						if (/not found/i.test(err.message)) return;
						throw err;
					}
				},
			});
		} finally {
			completing.delete(id);
		}
	}

	function handleTaskDelete(task) {
		tasks.remove(task.id);

		if (toast.isActive(TASK_DELETE_BATCH_KEY)) {
			taskDeleteBatch.tasks.push(task);
			toast.update({
				message: formatTaskDeleteMessage(taskDeleteBatch.tasks.length),
				durationMs: 5000,
			});
		} else {
			taskDeleteBatch = { tasks: [task] };
			toast.show({
				message: formatTaskDeleteMessage(1),
				key: TASK_DELETE_BATCH_KEY,
				durationMs: 5000,
				onUndo: () => {
					const batch = taskDeleteBatch;
					taskDeleteBatch = null;
					for (const t of [...batch.tasks].reverse()) {
						tasks.restore(t);
					}
				},
				onDismiss: () => {
					taskDeleteBatch = null;
				},
			});
		}
	}

	async function handleMoveTaskToSection({ taskId, targetSectionId }) {
		// Snapshot BEFORE the move (for undo).
		const snapshot = (await tasks.list()).find((t) => t.id === taskId);
		if (!snapshot) return; // task already gone (race)
		const fromSectionId = snapshot.sectionId;
		const fromOrder = snapshot.order;
		if (fromSectionId === targetSectionId) return; // no-op (also omitted in picker)

		try {
			await tasks.moveToSection(taskId, targetSectionId);
		} catch (err) {
			// Cascade race: task OR target section deleted mid-flow. The
			// triggering deletion fires its own notify → re-render closes the
			// (already-null) menu. Mirrors onCommitRename's swallow.
			if (/not found/i.test(err.message)) return;
			throw err;
		}

		// Friendly "Area › Section" label for the toast.
		const targetSection = (await sections.list()).find(
			(s) => s.id === targetSectionId,
		);
		const targetArea = targetSection
			? (await areas.list()).find((a) => a.id === targetSection.areaId)
			: null;
		const label = !targetSection
			? "section"
			: targetArea
				? `${targetArea.name} › ${targetSection.name}`
				: targetSection.name;

		toast.show({
			message: `Moved to ${label}`,
			durationMs: MOVE_TOAST_MS,
			onUndo: async () => {
				// Exact restore — the move touched only this task (append left
				// peers untouched; the source kept the gap this task vacated).
				try {
					await tasks.update(taskId, {
						sectionId: fromSectionId,
						order: fromOrder,
					});
				} catch (err) {
					if (/not found/i.test(err.message)) return; // task deleted since the move
					throw err;
				}
			},
		});
	}

	function mountMainView(route) {
		currentMainView?.destroy();
		currentMainView = null;

		if (route.name === "today") {
			currentMainView = createTodayView(mainRoot, {
				onToggleComplete: handleToggleComplete,
				onToggleStar: (id, currentStarred) =>
					tasks.update(id, { starred: !currentStarred }),
				onDelete: (task) => handleTaskDelete(task),
				onCommitTaskRename: async ({ taskId, name }) => {
					try {
						await tasks.rename(taskId, name);
					} catch (err) {
						// Race: task was cascade-deleted (e.g., section/area cascade fired
						// while mid-rename, or destroy-commit raced cascade). Drop silently —
						// toast undo restores the task with its pre-rename title; typed text
						// is lost. Mirrors onCommitRename for sections.
						if (/Task not found/.test(err.message)) return;
						throw err;
					}
				},
				onMoveTaskToSection: handleMoveTaskToSection,
				onOpenRepeatEditor: openRecurrenceEditor,
			});
			return;
		}

		// route.name === "area"
		currentMainView = createAreaView(mainRoot, {
			areaId: route.id,
			callbacks: areaCallbacks(),
		});
	}

	function areaCallbacks() {
		return {
			onAddSection: async ({ areaId }) => {
				const section = await sections.create({
					areaId,
					name: "New section",
				});
				currentMainView?.enterRename?.(section.id);
			},

			onToggleSection: async ({ sectionId, collapsed }) => {
				await sections.setCollapsed(sectionId, collapsed);
			},

			onCommitRename: async ({ sectionId, name }) => {
				try {
					await sections.rename(sectionId, name);
				} catch (err) {
					// Race: section was cascade-deleted (e.g., user deleted the parent
					// area while mid-rename of one of its sections, or destroy-commit
					// raced cascade). Drop silently — toast undo will restore the
					// section with its pre-rename name; the typed text is lost.
					if (/Section not found/.test(err.message)) return;
					throw err;
				}
			},

			onCommitTaskRename: async ({ taskId, name }) => {
				try {
					await tasks.rename(taskId, name);
				} catch (err) {
					// Race: task cascade-deleted mid-rename. Drop silently — toast
					// undo restores the task with its pre-rename title; typed text is
					// lost. Mirrors onCommitRename above.
					if (/Task not found/.test(err.message)) return;
					throw err;
				}
			},
			onMoveTaskToSection: handleMoveTaskToSection,

			onMoveUp: async ({ sectionId }) => {
				await moveSection(sectionId, "up");
			},

			onMoveDown: async ({ sectionId }) => {
				await moveSection(sectionId, "down");
			},

			onMoveTaskUp: async ({ taskId }) => {
				await moveTask(taskId, "up");
			},

			onMoveTaskDown: async ({ taskId }) => {
				await moveTask(taskId, "down");
			},

			onDeleteSection: async ({ sectionId }) => {
				const allSections = await sections.list();
				const sectionSnapshot = allSections.find((s) => s.id === sectionId);
				if (!sectionSnapshot) return;
				const taskSnapshots = await tasks.listBySection(sectionId);

				// Focus target computed BEFORE the writes — afterwards the section
				// and its ordering context are gone from state.
				const peers = allSections.filter(
					(s) => s.areaId === sectionSnapshot.areaId,
				);
				const prevId = previousSectionId(peers, sectionId);

				// Empty-layer guard: removeMany([]) still notifies, adding another
				// in-flight render to the pile the drain below has to absorb.
				// Mirrors deleteAreaCascade.
				if (taskSnapshots.length) {
					await tasks.removeMany(taskSnapshots.map((t) => t.id));
				}
				await sections.remove(sectionId);

				// DRAIN, then flag, then one final render. notify() is synchronous
				// and does NOT await its subscribers, so the last write's own
				// notify-render is still queued when remove() resolves — our
				// continuation is a microtask and beats it. Flagging here without
				// the drain lets that queued render consume the flag and focus
				// correctly, and then THIS applyState's render rewrites innerHTML
				// and drops focus to <body>. The drain is safe because the pending
				// renders queued their IDB reads first and reads complete FIFO
				// (engine behaviour in practice, not an IDB spec guarantee — the
				// same assumption every notify-driven render here already makes),
				// and no notify fires after the last write.
				await applyState();
				currentMainView?.focusAfterSectionDelete?.(prevId);
				await applyState();

				toast.show({
					message: cascadeMessage(sectionSnapshot.name, taskSnapshots.length),
					durationMs: CASCADE_TOAST_MS,
					onUndo: async () => {
						await sections.restore(sectionSnapshot);
						await tasks.restoreMany(taskSnapshots);
					},
				});
			},

			onDeleteTask: (task) => handleTaskDelete(task),

			onToggleComplete: handleToggleComplete,

			onOpenRepeatEditor: openRecurrenceEditor,

			onToggleStar: (id, currentStarred) =>
				tasks.update(id, { starred: !currentStarred }),
		};
	}

	async function moveSection(sectionId, direction) {
		const all = await sections.list();
		const target = all.find((s) => s.id === sectionId);
		if (!target) return;
		const peers = all
			.filter((s) => s.areaId === target.areaId)
			.sort((a, b) => a.order - b.order);
		const idx = peers.findIndex((s) => s.id === sectionId);
		const neighbourIdx = direction === "up" ? idx - 1 : idx + 1;
		if (neighbourIdx < 0 || neighbourIdx >= peers.length) return;
		const neighbour = peers[neighbourIdx];
		await sections.swapOrder(target.id, neighbour.id);
	}

	async function moveArea(areaId, direction) {
		// Focus is pinned to the top — it never moves and nothing moves above it.
		if (areaId === FOCUS_ID) return;
		const all = await areas.list();
		const peers = all
			.filter((a) => a.id !== FOCUS_ID)
			.sort((a, b) => a.order - b.order);
		const idx = peers.findIndex((a) => a.id === areaId);
		if (idx < 0) return;
		const neighbourIdx = direction === "up" ? idx - 1 : idx + 1;
		if (neighbourIdx < 0 || neighbourIdx >= peers.length) return;
		const neighbour = peers[neighbourIdx];
		await areas.swapOrder(areaId, neighbour.id);
	}

	async function deleteAreaCascade(areaId) {
		// 0. Defensive guard — Focus area is never deletable.
		// The UI's `isUndeletable` already hides the Delete item; this guard
		// protects against programmatic calls (dev tools, future bugs).
		// Without it, the cascade would partial-execute: tasks.removeMany
		// would succeed, then sections.removeMany would throw on
		// `focus-default`, leaving Focus's tasks gone and no toast shown.
		if (areaId === FOCUS_ID) return;

		// Snapshot BEFORE the redirect below. That redirect fires hashchange,
		// whose onHashChange runs closeDrawer() — setting drawerOpen = false and
		// focusing .topbar__menu — while the awaits below yield. Reading
		// drawerOpen later would report false on mobile, and we'd then focus
		// .sidebar__home inside a visibility:hidden drawer, losing focus to
		// <body>: exactly the bug this routing exists to fix.
		const wasDrawerOpen = drawerOpen;

		// 1. Snapshot all three layers BEFORE any write.
		const all = await areas.list();
		const areaSnapshot = all.find((a) => a.id === areaId);
		if (!areaSnapshot) return;
		const sectionSnapshots = await sections.listByArea(areaId);
		const taskSnapshots = await tasks.listByArea(areaId);

		// 2. Redirect-if-active — BEFORE any model write.
		// Without this, applyState fires between areas.remove and the redirect
		// and the user sees an "Area not found" flash.
		if (currentRoute.name === "area" && currentRoute.id === areaId) {
			window.location.hash = "#today";
		}

		// 3. Cascade: tasks → sections → area. Guard empty layers —
		// removeMany([]) still notifies, adding redundant re-render passes.
		if (taskSnapshots.length) {
			await tasks.removeMany(taskSnapshots.map((t) => t.id));
		}
		if (sectionSnapshots.length) {
			await sections.removeMany(sectionSnapshots.map((s) => s.id));
		}
		await areas.remove(areaId);

		// DRAIN, then flag, then one final render — same reasoning as
		// onDeleteSection above, plus one extra competitor here: the redirect's
		// onHashChange fires its own un-awaited applyState().
		await applyState();
		// Desktop only. On mobile the drawer was the user's path to this menu,
		// and closeDrawer's return-to-.topbar__menu is already correct — defer
		// to it rather than compete.
		if (!wasDrawerOpen) sidebar.focusHome();
		await applyState();

		// 4. Toast — reverse-cascade restore (parents before children).
		toast.show({
			message: cascadeAreaMessage(
				areaSnapshot.name,
				sectionSnapshots.length,
				taskSnapshots.length,
			),
			durationMs: CASCADE_TOAST_MS,
			onUndo: async () => {
				// Reverse-cascade restore (parents before children); same
				// empty-layer guard as the delete above.
				await areas.restore(areaSnapshot);
				if (sectionSnapshots.length) {
					await sections.restoreMany(sectionSnapshots);
				}
				if (taskSnapshots.length) {
					await tasks.restoreMany(taskSnapshots);
				}
			},
		});
	}

	function cascadeAreaMessage(name, sectionCount, taskCount) {
		if (sectionCount === 0 && taskCount === 0) return `"${name}" deleted`;
		const parts = [];
		if (sectionCount === 1) parts.push("1 section");
		else if (sectionCount > 1) parts.push(`${sectionCount} sections`);
		if (taskCount === 1) parts.push("1 task");
		else if (taskCount > 1) parts.push(`${taskCount} tasks`);
		return `"${name}" and ${parts.join(", ")} deleted`;
	}

	function sidebarCallbacks() {
		return {
			onAddArea: async () => {
				const area = await areas.create({ name: "New area" });
				window.location.hash = `#area/${area.id}`;
				sidebar.enterRename(area.id);
			},
			onCommitAreaRename: async ({ areaId, name }) => {
				try {
					await areas.rename(areaId, name);
				} catch (err) {
					// Race: area was just cascade-deleted (e.g., user clicked Delete
					// before the destroy-commit fired). Drop silently.
					if (/Area not found/.test(err.message)) return;
					throw err;
				}
			},
			onMoveAreaUp: async ({ areaId }) => {
				await moveArea(areaId, "up");
			},
			onMoveAreaDown: async ({ areaId }) => {
				await moveArea(areaId, "down");
			},
			onDeleteArea: async ({ areaId }) => {
				await deleteAreaCascade(areaId);
			},
			onPickAreaIcon: async (areaId, icon) => {
				try {
					await areas.update(areaId, { icon });
					// THE DRAIN IS LOAD-BEARING. notify() is synchronous and does not
					// await its subscribers, so this write's own notify-render is still
					// queued here — and this continuation, being a microtask, beats it.
					// Setting the focus flag without draining means the queued render
					// consumes it, and the NEXT render's innerHTML rewrite detaches the
					// button again. See the cascade focus routing notes in invariants.md.
					await applyState();
					sidebar?.focusAreaIcon?.(areaId, icon);
					await applyState();
				} catch (err) {
					// Cascade race: the area was deleted mid-edit. Matches how the other
					// area handlers swallow this exact case.
					if (!/not found/i.test(err.message)) throw err;
				}
			},
		};
	}

	async function moveTask(taskId, direction) {
		const allTasks = await tasks.list();
		const target = allTasks.find((t) => t.id === taskId);
		if (!target) return;
		const peers = (await tasks.listBySection(target.sectionId)).filter(
			(t) => !t.completed,
		); // already sorted by order in listBySection
		const idx = peers.findIndex((t) => t.id === taskId);
		const neighbourIdx = direction === "up" ? idx - 1 : idx + 1;
		if (neighbourIdx < 0 || neighbourIdx >= peers.length) return;
		const neighbour = peers[neighbourIdx];
		await tasks.swapOrder(target.id, neighbour.id);
	}

	function cascadeMessage(name, count) {
		if (count === 0) return `"${name}" deleted`;
		if (count === 1) return `"${name}" and 1 task deleted`;
		return `"${name}" and ${count} tasks deleted`;
	}

	function openDrawer() {
		if (drawerOpen) return;
		drawerOpen = true;
		document.body.classList.add("is-drawer-open"); // CSS: slide in + scrim + scroll-lock
		topbar.setExpanded(true); // menu button aria-expanded="true"
		// Modal dialog semantics — controller-set so sidebar.js stays unchanged.
		// openDrawer only ever runs on mobile, so these never exist on desktop.
		sidebarRoot.setAttribute("role", "dialog");
		sidebarRoot.setAttribute("aria-modal", "true");
		sidebarRoot.setAttribute("aria-label", "Navigation");
		// Background becomes inert → focus is contained in the drawer, AT ignores it.
		// The scrim is NOT inert — it must stay tappable to close.
		for (const el of [topbarRoot, mainEl, toastRoot]) el.inert = true;
		// Move focus into the drawer (first focusable: the "Ignite" home button).
		sidebarRoot.querySelector(".sidebar__home")?.focus();
	}

	function closeDrawer() {
		if (!drawerOpen) return;
		drawerOpen = false;
		document.body.classList.remove("is-drawer-open");
		for (const el of [topbarRoot, mainEl, toastRoot]) el.inert = false;
		// Restore the permanent navigation landmark (index.html sets role="navigation");
		// openDrawer overrode it with role="dialog" while open. Restore rather than
		// remove so the sidebar never reverts to a bare, non-landmark <div> (which would
		// drop it out of any landmark on a drawer-open → desktop resize).
		sidebarRoot.setAttribute("role", "navigation");
		for (const attr of ["aria-modal", "aria-label"]) {
			sidebarRoot.removeAttribute(attr);
		}
		topbar.setExpanded(false);
		// Return focus to the menu trigger via DOM lookup, never a stored ref
		// (the topbar is render-once, so the lookup is stable).
		topbarRoot.querySelector(".topbar__menu")?.focus();
	}

	async function openRecurrenceEditor(taskId) {
		const task = (await tasks.list()).find((t) => t.id === taskId);
		if (!task) return; // deleted between menu render and click
		repeatEditorTaskId = taskId;
		document.body.classList.add("is-repeat-open"); // scroll-lock (CSS)
		// Background inert → focus contained in the dialog, AT ignores it. The
		// dialog root + backdrop are body children, outside every inert subtree.
		for (const el of [topbarRoot, sidebarRoot, mainEl, toastRoot]) {
			el.inert = true;
		}
		recurrenceDialog.open(task);
	}

	// rerender=true forces a consuming render for no-model-change closes
	// (Cancel / Esc / backdrop). Save/Remove pass false, then their tasks.update
	// notify provides the consuming render. Either way the pending-focus flag set
	// here is consumed by the view's doRender.
	function closeRecurrenceEditor({ rerender = true } = {}) {
		if (!repeatEditorTaskId) return;
		const taskId = repeatEditorTaskId;
		repeatEditorTaskId = null;
		recurrenceDialog.close();
		document.body.classList.remove("is-repeat-open");
		for (const el of [topbarRoot, sidebarRoot, mainEl, toastRoot]) {
			el.inert = false;
		}
		currentMainView?.focusTaskMenu?.(taskId); // best-effort on route change
		if (rerender) applyState();
	}

	async function onSaveRecurrence({ taskId, recurrence, dueAt }) {
		closeRecurrenceEditor({ rerender: false }); // clears inert + sets focus flag
		try {
			await tasks.update(taskId, { recurrence, dueAt }); // notify → render consumes flag
		} catch (err) {
			if (/not found/i.test(err.message)) return; // cascade race
			throw err;
		}
		toast.show({
			message: `Repeats ${describeRecurrence(recurrence)}`,
			durationMs: COMPLETE_TOAST_MS,
		});
	}

	async function onRemoveRecurrence({ taskId }) {
		closeRecurrenceEditor({ rerender: false });
		try {
			await tasks.update(taskId, { recurrence: null }); // dueAt kept
		} catch (err) {
			if (/not found/i.test(err.message)) return;
			throw err;
		}
		toast.show({ message: "Repeat removed", durationMs: COMPLETE_TOAST_MS });
	}

	function onHashChange() {
		closeDrawer(); // close on ALL route changes incl. browser back/forward
		closeRecurrenceEditor({ rerender: false }); // route change closes the dialog
		currentRoute = parseHash(window.location.hash);
		mountMainView(currentRoute);
		applyState();
	}

	function start() {
		toast = createToastView(toastRoot);

		recurrenceDialog = createRecurrenceDialog(repeatDialogRoot, {
			onSave: onSaveRecurrence,
			onRemove: onRemoveRecurrence,
			onClose: () => closeRecurrenceEditor({ rerender: true }),
		});

		topbar = createTopbarView(topbarRoot, {
			onToggleDrawer: () => (drawerOpen ? closeDrawer() : openDrawer()),
			onGoToday: () => {
				window.location.hash = "#today";
				closeDrawer(); // same-hash tap of "Ignite" on #today fires no hashchange
			},
		});

		sidebar = createSidebarView(sidebarRoot, {
			onToggleCollapse: async () => {
				const current = await settings.get();
				await settings.setSidebarCollapsed(
					!(current.sidebarCollapsed ?? false),
				);
			},
			onGoToday: () => {
				window.location.hash = "#today";
				closeDrawer();
			},
			onOpenArea: (id) => {
				window.location.hash = `#area/${id}`;
				closeDrawer();
			},
			onCloseDrawer: () => closeDrawer(),
			onCycleTheme: async () => {
				await settings.setTheme(nextThemeChoice(currentChoice));
			},
			...sidebarCallbacks(),
		});

		capture = createCaptureView(captureRoot, {
			onSubmit: (title) =>
				tasks.create({
					sectionId: FOCUS_DEFAULT_SECTION_ID,
					title,
					starred: true,
				}),
		});

		unsubs.push(
			areas.subscribe(applyState),
			sections.subscribe(applyState),
			tasks.subscribe(applyState),
			settings.subscribe(applyState),
		);

		currentRoute = parseHash(window.location.hash);
		mountMainView(currentRoute);
		applyState();

		window.addEventListener("hashchange", onHashChange);

		scrimEl.addEventListener("click", closeDrawer);

		// Crossing to the desktop layout must clear is-drawer-open, the inert
		// flags, and the scroll-lock — otherwise an open-drawer resize strands
		// them on the desktop grid.
		drawerMq = matchMedia("(min-width: 768px)");
		drawerMqHandler = (event) => {
			if (event.matches) closeDrawer();
		};
		drawerMq.addEventListener("change", drawerMqHandler);

		themeMq = window.matchMedia("(prefers-color-scheme: dark)");
		themeMqHandler = () => {
			// Early-return unless the user is actually following the OS. applyState
			// is a four-model read plus a full innerHTML rewrite of the sidebar and
			// main view — far too expensive to run for a guaranteed no-op.
			if (currentChoice !== "system") return;
			applyState();
		};
		themeMq.addEventListener("change", themeMqHandler);

		tickHandle = setInterval(applyState, TICK_MS);
	}

	function stop() {
		closeRecurrenceEditor({ rerender: false }); // clears inert + is-repeat-open first
		closeDrawer(); // clears is-drawer-open, inert, scroll-lock, dialog ARIA in one place
		clearInterval(tickHandle);
		tickHandle = null;
		window.removeEventListener("hashchange", onHashChange);
		scrimEl.removeEventListener("click", closeDrawer);
		drawerMq?.removeEventListener("change", drawerMqHandler);
		drawerMq = null;
		drawerMqHandler = null;
		themeMq?.removeEventListener("change", themeMqHandler);
		themeMq = null;
		themeMqHandler = null;
		for (const unsub of unsubs) unsub();
		unsubs = [];
		currentMainView?.destroy();
		capture?.destroy();
		sidebar?.destroy();
		topbar?.destroy();
		toast?.destroy();
		recurrenceDialog?.destroy();
		currentMainView = null;
		capture = null;
		sidebar = null;
		topbar = null;
		toast = null;
		recurrenceDialog = null;
		drawerOpen = false;
	}

	return { start, stop };
}
