// app.js — application wiring.
// M2: builds DOM scaffolding, constructs models, hands off to the controller.

import { createController } from "./controller.js";
import { createAreaModel } from "./model/areas.js";
import { openDB } from "./model/db.js";
import { createSectionModel } from "./model/sections.js";
import { createSettingsModel } from "./model/settings.js";
import { createTaskModel } from "./model/tasks.js";

async function boot() {
	const db = await openDB();
	const areas = await createAreaModel(db);
	const sections = await createSectionModel(db);
	const tasks = await createTaskModel(db);
	const settings = await createSettingsModel(db);

	const sidebarRoot = document.getElementById("sidebar");
	const mainEl = document.getElementById("main");

	mainEl.innerHTML = `
		<section class="capture" id="capture-root"></section>
		<section class="today" id="today-root"></section>
	`;

	const toastRoot = document.createElement("div");
	toastRoot.id = "toast-root";
	document.body.appendChild(toastRoot);

	const controller = createController({
		models: { areas, sections, tasks, settings },
		els: {
			sidebarRoot,
			captureRoot: document.getElementById("capture-root"),
			todayRoot: document.getElementById("today-root"),
			toastRoot,
		},
	});
	controller.start();
}

boot().catch((err) => {
	console.error("Ignite failed to boot:", err);
});
