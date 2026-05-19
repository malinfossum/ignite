import { uuid } from "../utils/id.js";
import { capitalizeFirst } from "../utils/text.js";

export const FOCUS_ID = "focus";
export const FOCUS_DEFAULT_SECTION_ID = "focus-default";

const FOCUS_DEFAULTS = {
	id: FOCUS_ID,
	name: "Focus",
	icon: "🔥",
	critical: false,
	order: 0,
};

const FOCUS_DEFAULT_SECTION = {
	id: FOCUS_DEFAULT_SECTION_ID,
	areaId: FOCUS_ID,
	name: "Tasks",
	collapsed: false,
	order: 0,
};

// createAreaModel(db) → Promise<AreaModel>
//
//   AreaModel = {
//     subscribe(fn) → unsubscribe(),
//     list() → Promise<Area[]>,
//     create({ name, icon?, critical? }) → Promise<Area>,
//     update(id, patch) → Promise<Area>,
//     remove(id) → Promise<void>,
//   }
//
// Subscribe/notify pattern: every mutation writes the DB, then notifies.
// Focus area is seeded on first construction and cannot be deleted.

export async function createAreaModel(db) {
	const listeners = new Set();
	const notify = () => {
		for (const fn of listeners) fn();
	};

	await ensureFocus(db);

	return {
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},

		list() {
			return db.getAll("areas");
		},

		async create({ name, icon = "", critical = false }) {
			const all = await db.getAll("areas");
			const order = all.length;
			const area = {
				id: uuid(),
				name: capitalizeFirst(name),
				icon,
				critical,
				order,
			};
			await db.put("areas", area);
			notify();
			return area;
		},

		async update(id, patch) {
			const existing = await db.get("areas", id);
			if (!existing) throw new Error(`Area not found: ${id}`);
			const updated = { ...existing, ...patch, id: existing.id };
			await db.put("areas", updated);
			notify();
			return updated;
		},

		async remove(id) {
			if (id === FOCUS_ID) {
				throw new Error("Cannot delete Focus area");
			}
			await db.delete("areas", id);
			notify();
		},
	};
}

async function ensureFocus(db) {
	const existing = await db.get("areas", FOCUS_ID);
	if (!existing) await db.put("areas", { ...FOCUS_DEFAULTS });
	const existingSection = await db.get("sections", FOCUS_DEFAULT_SECTION_ID);
	if (!existingSection) {
		await db.put("sections", { ...FOCUS_DEFAULT_SECTION });
	} else if (existingSection.name === "") {
		// M2 → M3 migration: empty seed name → "Tasks".
		await db.put("sections", { ...existingSection, name: "Tasks" });
	}
}
