import { uuid } from "../utils/id.js";
import { capitalizeFirst } from "../utils/text.js";

// createTaskModel(db) → Promise<TaskModel>
//
// TaskModel = {
//   subscribe(fn) → unsubscribe,
//   list() → Promise<Task[]>,
//   listBySection(sectionId) → Promise<Task[]>,  // ordered by `order`
//   listByArea(areaId) → Promise<Task[]>,  // all tasks whose section is in this area
//   create({ sectionId, title, ...metadata }) → Promise<Task>,
//   update(id, patch) → Promise<Task>,
//   toggleCompleted(id) → Promise<Task>,
//   remove(id) → Promise<void>,
//   removeMany(ids) → Promise<void>,
//   swapOrder(idA, idB) → Promise<void>,
//   restore(snapshot) → Promise<Task>,
//   restoreMany(snapshots) → Promise<void>,
// }
//
// Storage note: IndexedDB can't index booleans. We persist `completed`,
// `starred`, and `critical` as 0/1 and convert at the model boundary, so the
// public API always uses true/false.

const BOOL_FIELDS = ["completed", "starred", "critical"];

export async function createTaskModel(db) {
	const listeners = new Set();
	const notify = () => {
		for (const fn of listeners) fn();
	};

	return {
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},

		async list() {
			const rows = await db.getAll("tasks");
			return rows.map(fromStorage);
		},

		async listBySection(sectionId) {
			const rows = await db.getByIndex("tasks", "sectionId", sectionId);
			return rows.map(fromStorage).sort((a, b) => a.order - b.order);
		},

		async listByArea(areaId) {
			const allSections = await db.getAll("sections");
			const sectionIds = new Set(
				allSections.filter((s) => s.areaId === areaId).map((s) => s.id),
			);
			const allTasks = await db.getAll("tasks");
			return allTasks
				.filter((t) => sectionIds.has(t.sectionId))
				.map(fromStorage);
		},

		async create({
			sectionId,
			title,
			notes = "",
			starred = false,
			critical = false,
			dueAt = null,
			recurrence = null,
			leadTime = 0,
		}) {
			if (!sectionId) throw new Error("create(task): sectionId is required");
			if (!title) throw new Error("create(task): title is required");
			const siblings = await db.getByIndex("tasks", "sectionId", sectionId);
			const order = siblings.length;
			const task = {
				id: uuid(),
				sectionId,
				title: capitalizeFirst(title),
				notes,
				completed: false,
				starred,
				critical,
				dueAt,
				recurrence,
				leadTime,
				scheduledTags: [],
				createdAt: new Date().toISOString(),
				order,
			};
			await db.put("tasks", toStorage(task));
			notify();
			return task;
		},

		async update(id, patch) {
			const stored = await db.get("tasks", id);
			if (!stored) throw new Error(`Task not found: ${id}`);
			const merged = { ...fromStorage(stored), ...patch, id };
			await db.put("tasks", toStorage(merged));
			notify();
			return merged;
		},

		async toggleCompleted(id) {
			const stored = await db.get("tasks", id);
			if (!stored) throw new Error(`Task not found: ${id}`);
			const current = fromStorage(stored);
			const updated = { ...current, completed: !current.completed };
			await db.put("tasks", toStorage(updated));
			notify();
			return updated;
		},

		async remove(id) {
			await db.delete("tasks", id);
			notify();
		},

		async restore(taskData) {
			await db.put("tasks", toStorage(taskData));
			notify();
			return taskData;
		},

		async removeMany(ids) {
			await Promise.all(ids.map((id) => db.delete("tasks", id)));
			notify();
		},

		async swapOrder(idA, idB) {
			const [a, b] = await Promise.all([
				db.get("tasks", idA),
				db.get("tasks", idB),
			]);
			if (!a) throw new Error(`Task not found: ${idA}`);
			if (!b) throw new Error(`Task not found: ${idB}`);
			await Promise.all([
				db.put("tasks", { ...a, order: b.order }),
				db.put("tasks", { ...b, order: a.order }),
			]);
			notify(); // single notify after both writes
		},

		async restoreMany(snapshots) {
			await Promise.all(
				snapshots.map((snap) => db.put("tasks", toStorage(snap))),
			);
			notify();
		},
	};
}

function toStorage(task) {
	const out = { ...task };
	for (const f of BOOL_FIELDS) out[f] = task[f] ? 1 : 0;
	return out;
}

function fromStorage(row) {
	const out = { ...row };
	for (const f of BOOL_FIELDS) out[f] = row[f] === 1;
	return out;
}
