// createController({ models, els }) → { start(), stop() }
//
// Wires sidebar (always-on), capture (always-on; CSS-hidden on area route),
// toast (always-on), and a route-driven main view (Today or Area). Subscribes
// to all model notifies; rebuilds state and re-renders sidebar + currentMainView.
// Owns the 60s clock tick that calls currentMainView.render(state) only.

import { FOCUS_DEFAULT_SECTION_ID, FOCUS_ID } from "./model/areas.js";
import { formatTaskDeleteMessage } from "./utils/text.js";
import { createAreaView } from "./views/area.js";
import { createCaptureView } from "./views/capture.js";
import { createSidebarView } from "./views/sidebar.js";
import { createToastView, TASK_DELETE_BATCH_KEY } from "./views/toast.js";
import { createTodayView } from "./views/today.js";

const TICK_MS = 60_000;
const CASCADE_TOAST_MS = 8_000;

export function parseHash(hash) {
	const raw = (hash || "").replace(/^#/, "");
	if (raw === "" || raw === "today") return { name: "today" };
	const areaMatch = raw.match(/^area\/(.+)$/);
	if (areaMatch) return { name: "area", id: areaMatch[1] };
	return { name: "today" };
}

export function createController({ models, els }) {
	const { areas, sections, tasks, settings } = models;
	const { sidebarRoot, captureRoot, mainRoot, toastRoot } = els;

	let sidebar = null;
	let capture = null;
	let toast = null;
	let currentMainView = null;
	let currentRoute = { name: "today" };
	let tickHandle = null;
	let unsubs = [];
	let taskDeleteBatch = null; // null | { tasks: Array<TaskSnapshot> }

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

	function mountMainView(route) {
		currentMainView?.destroy();
		currentMainView = null;

		if (route.name === "today") {
			currentMainView = createTodayView(mainRoot, {
				onToggleComplete: (id) => tasks.toggleCompleted(id),
				onToggleStar: (id, currentStarred) =>
					tasks.update(id, { starred: !currentStarred }),
				onDelete: (task) => handleTaskDelete(task),
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

				await tasks.removeMany(taskSnapshots.map((t) => t.id));
				await sections.remove(sectionId);

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

			onToggleComplete: (id) => tasks.toggleCompleted(id),

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

	function onHashChange() {
		currentRoute = parseHash(window.location.hash);
		mountMainView(currentRoute);
		applyState();
	}

	function start() {
		toast = createToastView(toastRoot);

		sidebar = createSidebarView(sidebarRoot, {
			onToggleCollapse: async () => {
				const current = await settings.get();
				await settings.setSidebarCollapsed(
					!(current.sidebarCollapsed ?? false),
				);
			},
			onGoToday: () => {
				window.location.hash = "#today";
			},
			onOpenArea: (id) => {
				window.location.hash = `#area/${id}`;
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

		tickHandle = setInterval(applyState, TICK_MS);
	}

	function stop() {
		clearInterval(tickHandle);
		tickHandle = null;
		window.removeEventListener("hashchange", onHashChange);
		for (const unsub of unsubs) unsub();
		unsubs = [];
		currentMainView?.destroy();
		capture?.destroy();
		sidebar?.destroy();
		toast?.destroy();
		currentMainView = null;
		capture = null;
		sidebar = null;
		toast = null;
	}

	return { start, stop };
}
