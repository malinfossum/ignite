import { uuid } from "../utils/id.js";

// createSectionModel(db) → Promise<SectionModel>
//
// SectionModel = {
//   subscribe(fn) → unsubscribe,
//   list() → Promise<Section[]>,
//   listByArea(areaId) → Promise<Section[]>,  // ordered by `order`
//   create({ areaId, name, collapsed? }) → Promise<Section>,
//   update(id, patch) → Promise<Section>,
//   remove(id) → Promise<void>,
// }

export async function createSectionModel(db) {
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
			return db.getAll("sections");
		},

		async listByArea(areaId) {
			const all = await db.getAll("sections");
			return all
				.filter((s) => s.areaId === areaId)
				.sort((a, b) => a.order - b.order);
		},

		async create({ areaId, name, collapsed = false }) {
			if (!areaId) throw new Error("create(section): areaId is required");
			const siblings = (await db.getAll("sections")).filter(
				(s) => s.areaId === areaId,
			);
			const order = siblings.length;
			const section = { id: uuid(), areaId, name, collapsed, order };
			await db.put("sections", section);
			notify();
			return section;
		},

		async update(id, patch) {
			const existing = await db.get("sections", id);
			if (!existing) throw new Error(`Section not found: ${id}`);
			const updated = { ...existing, ...patch, id: existing.id };
			await db.put("sections", updated);
			notify();
			return updated;
		},

		async remove(id) {
			await db.delete("sections", id);
			notify();
		},
	};
}
