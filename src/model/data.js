// createDataModel(db) → { snapshot(), replaceAll(data) }
//
// Whole-database reads and writes for backup, restore and import. Both work
// in MODEL shape: task booleans are true/false here and 0/1 in IndexedDB.
// Areas and sections are stored as-is by their models, so they pass through.

import { taskFromStorage, taskToStorage } from "./tasks.js";

const DATA_STORES = ["areas", "sections", "tasks"];

export function createDataModel(db) {
	return {
		async snapshot() {
			const out = await db.readAll(DATA_STORES);
			return {
				areas: out.areas,
				sections: out.sections,
				tasks: out.tasks.map(taskFromStorage),
			};
		},

		replaceAll({ areas, sections, tasks }) {
			return db.replaceAll({
				areas,
				sections,
				tasks: tasks.map(taskToStorage),
			});
		},
	};
}
