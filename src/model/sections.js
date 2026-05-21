import { uuid } from "../utils/id.js";
import { capitalizeFirst } from "../utils/text.js";
import { FOCUS_DEFAULT_SECTION_ID } from "./areas.js";

// createSectionModel(db) → Promise<SectionModel>
//
// SectionModel = {
//   subscribe(fn) → unsubscribe,
//   list() → Promise<Section[]>,
//   listByArea(areaId) → Promise<Section[]>,  // ordered by `order`
//   create({ areaId, name, collapsed? }) → Promise<Section>,
//   update(id, patch) → Promise<Section>,
//   remove(id) → Promise<void>,
//   removeMany(ids) → Promise<void>,
//   setCollapsed(id, value) → Promise<void>,
//   rename(id, name) → Promise<void>,
//   swapOrder(idA, idB) → Promise<void>,
//   restore(snapshot) → Promise<Section>,
//   restoreMany(snapshots) → Promise<void>,
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
			const section = {
				id: uuid(),
				areaId,
				name: capitalizeFirst(name),
				collapsed,
				order,
			};
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
			if (id === FOCUS_DEFAULT_SECTION_ID) {
				throw new Error("Cannot delete default Focus section");
			}
			await db.delete("sections", id);
			notify();
		},

		async setCollapsed(id, value) {
			const existing = await db.get("sections", id);
			if (!existing) throw new Error(`Section not found: ${id}`);
			await db.put("sections", { ...existing, collapsed: !!value });
			notify();
		},

		async rename(id, name) {
			const cleaned = capitalizeFirst(name);
			if (!cleaned) throw new Error("rename(section): name cannot be empty");
			const existing = await db.get("sections", id);
			if (!existing) throw new Error(`Section not found: ${id}`);
			await db.put("sections", { ...existing, name: cleaned });
			notify();
		},

		async swapOrder(idA, idB) {
			const [a, b] = await Promise.all([
				db.get("sections", idA),
				db.get("sections", idB),
			]);
			if (!a) throw new Error(`Section not found: ${idA}`);
			if (!b) throw new Error(`Section not found: ${idB}`);
			await Promise.all([
				db.put("sections", { ...a, order: b.order }),
				db.put("sections", { ...b, order: a.order }),
			]);
			notify(); // single notify after both writes
		},

		async restore(snapshot) {
			await db.put("sections", { ...snapshot });
			notify();
			return snapshot;
		},

		async removeMany(ids) {
			if (ids.some((id) => id === FOCUS_DEFAULT_SECTION_ID)) {
				throw new Error("Cannot delete default Focus section");
			}
			await Promise.all(ids.map((id) => db.delete("sections", id)));
			notify(); // single notify after all deletes
		},

		async restoreMany(snapshots) {
			await Promise.all(snapshots.map((s) => db.put("sections", { ...s })));
			notify(); // single notify after all writes
		},
	};
}
