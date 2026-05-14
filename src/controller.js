// createController({ models, els }) → { start(), stop() }
//
// Wires sidebar (always-on), capture (always-on; CSS-hidden on area route),
// toast (always-on), and a route-driven main view (Today or Area). Subscribes
// to all model notifies; rebuilds state and re-renders sidebar + currentMainView.
// Owns the 60s clock tick that calls currentMainView.render(state) only.

import { FOCUS_DEFAULT_SECTION_ID } from "./model/areas.js";
import { createAreaView } from "./views/area.js";
import { createCaptureView } from "./views/capture.js";
import { createSidebarView } from "./views/sidebar.js";
import { createToastView } from "./views/toast.js";
import { createTodayView } from "./views/today.js";

const TICK_MS = 60_000;

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

	function mountMainView(route) {
		currentMainView?.destroy();
		currentMainView = null;

		if (route.name === "today") {
			currentMainView = createTodayView(mainRoot, {
				onToggleComplete: (id) => tasks.toggleCompleted(id),
				onToggleStar: (id, currentStarred) =>
					tasks.update(id, { starred: !currentStarred }),
				onDelete: (taskData) => {
					tasks.remove(taskData.id);
					toast.show({
						message: "Task deleted",
						onUndo: () => tasks.restore(taskData),
					});
				},
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
		// STUBS — Task 12 fills these in. Wired now so the area view boots
		// and routing can be manually verified in isolation.
		return {
			onAddSection: ({ areaId }) => {
				console.log("[stub] onAddSection", areaId);
			},
			onToggleSection: ({ sectionId, collapsed }) => {
				console.log("[stub] onToggleSection", sectionId, collapsed);
			},
			onCommitRename: ({ sectionId, name }) => {
				console.log("[stub] onCommitRename", sectionId, name);
			},
			onMoveUp: ({ sectionId }) => {
				console.log("[stub] onMoveUp", sectionId);
			},
			onMoveDown: ({ sectionId }) => {
				console.log("[stub] onMoveDown", sectionId);
			},
			onDeleteSection: ({ sectionId }) => {
				console.log("[stub] onDeleteSection", sectionId);
			},
			onToggleComplete: (id) => tasks.toggleCompleted(id),
			onToggleStar: (id, currentStarred) =>
				tasks.update(id, { starred: !currentStarred }),
		};
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
