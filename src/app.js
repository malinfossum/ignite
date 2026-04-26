// app.js — application wiring.
// M1 milestone: constructs the data layer only. Models are created here
// but not yet consumed by any view — that arrives in M2.

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

	// Sanity log — proves the boot path works. Remove in M2.
	const areaList = await areas.list();
	console.log(
		`Ignite booted. Areas: ${areaList.length} (focus seeded: ${areaList.some(
			(a) => a.id === "focus",
		)}).`,
	);

	// Expose for quick DevTools inspection during M1 — drop in M2.
	window.ignite = { db, areas, sections, tasks, settings };
}

boot().catch((err) => {
	console.error("Ignite failed to boot:", err);
});
