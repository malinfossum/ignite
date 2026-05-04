// createController({ models, els }) → { start(), stop() }
//
// Wires sidebar (always-on), capture (always-on), main view (route-driven),
// toast (orchestrated by controller for delete-undo). Subscribes to all
// model notifies; rebuilds state and re-renders sidebar + currentMainView.
// Owns the 60s clock tick that calls currentMainView.render(state) only.

import { FOCUS_DEFAULT_SECTION_ID } from "./model/areas.js";
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
	const { sidebarRoot, captureRoot, todayRoot, toastRoot } = els;

	let sidebar = null;
	let capture = null;
	let toast = null;
	let currentMainView = null;
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
			now: new Date(),
		};
	}

	async function applyState() {
		const state = await buildState();
		document.body.classList.toggle(
			"is-sidebar-collapsed",
			!!(state.settings.sidebarCollapsed ?? false),
		);
		sidebar?.render(state);
		currentMainView?.render(state);
	}

	function mountMainView(name) {
		// M2: only "today" is wired. Everything else falls back to today.
		currentMainView?.destroy();
		currentMainView = null;

		// All recognized routes use the same #today-root container in M2.
		const rootMap = { today: todayRoot };
		const root = rootMap[name] ?? todayRoot;

		currentMainView = createTodayView(root, {
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
	}

	function onHashChange() {
		const route = parseHash(window.location.hash);
		mountMainView(route.name);
		applyState();
	}

	function start() {
		// Mount toast (above main).
		toast = createToastView(toastRoot);

		// Mount sidebar (always-on).
		sidebar = createSidebarView(sidebarRoot, {
			onToggleCollapse: async () => {
				const current = await settings.get();
				await settings.setSidebarCollapsed(
					!(current.sidebarCollapsed ?? false),
				);
			},
		});

		// Mount capture (always-on inside <main>).
		capture = createCaptureView(captureRoot, {
			onSubmit: (title) =>
				tasks.create({
					sectionId: FOCUS_DEFAULT_SECTION_ID,
					title,
					starred: true,
				}),
		});

		// Subscribe to model notifies.
		unsubs.push(
			areas.subscribe(applyState),
			sections.subscribe(applyState),
			tasks.subscribe(applyState),
			settings.subscribe(applyState),
		);

		// Initial route + render.
		const route = parseHash(window.location.hash);
		mountMainView(route.name);
		applyState();

		// Hash router.
		window.addEventListener("hashchange", onHashChange);

		// 60s tick — re-renders only the current main view.
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
