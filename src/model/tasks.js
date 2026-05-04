import { uuid } from "../utils/id.js";

// createTaskModel(db) → Promise<TaskModel>
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
				title,
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
