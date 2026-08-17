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
//     rename(id, name) → Promise<void>,
//     swapOrder(idA, idB) → Promise<void>,
//     remove(id) → Promise<void>,
//     removeMany(ids) → Promise<void>,
//     restore(snapshot) → Promise<Area>,
//     restoreMany(snapshots) → Promise<void>,
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
			// max(order)+1, NOT the count — a delete leaves a hole, so the count
			// can equal an order still in use, and two areas sharing an order make
			// swapOrder a silent no-op (see tasks.create for the full note).
			const order = all.reduce((max, a) => Math.max(max, a.order), -1) + 1;
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

		async rename(id, name) {
			const cleaned = capitalizeFirst(name);
			if (!cleaned) throw new Error("rename(area): name cannot be empty");
			const existing = await db.get("areas", id);
			if (!existing) throw new Error(`Area not found: ${id}`);
			await db.put("areas", { ...existing, name: cleaned });
			notify();
		},

		async swapOrder(idA, idB) {
			const [a, b] = await Promise.all([
				db.get("areas", idA),
				db.get("areas", idB),
			]);
			if (!a) throw new Error(`Area not found: ${idA}`);
			if (!b) throw new Error(`Area not found: ${idB}`);
			await Promise.all([
				db.put("areas", { ...a, order: b.order }),
				db.put("areas", { ...b, order: a.order }),
			]);
			notify(); // single notify after both writes
		},

		async remove(id) {
			if (id === FOCUS_ID) {
				throw new Error("Cannot delete Focus area");
			}
			await db.delete("areas", id);
			notify();
		},

		async removeMany(ids) {
			if (ids.some((id) => id === FOCUS_ID)) {
				throw new Error("Cannot delete Focus area");
			}
			await Promise.all(ids.map((id) => db.delete("areas", id)));
			notify(); // single notify after all deletes
		},

		async restore(snapshot) {
			await db.put("areas", { ...snapshot });
			notify();
			return snapshot;
		},

		async restoreMany(snapshots) {
			await Promise.all(snapshots.map((s) => db.put("areas", { ...s })));
			notify(); // single notify after all writes
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
