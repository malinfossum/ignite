import { uuid } from "../utils/id.js";

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

export async function createAreaModel(db) {
	const listeners = new Set();
	const notify = () => {
		for (const fn of listeners) fn();
	};

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
			const area = { id: uuid(), name, icon, critical, order };
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
			await db.delete("areas", id);
			notify();
		},
	};
}
