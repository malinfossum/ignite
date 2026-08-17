import { uuid } from "../utils/id.js";
import { capitalizeFirst } from "../utils/text.js";
import { nextOccurrence } from "./recurrence.js";

// createTaskModel(db) → Promise<TaskModel>
//
// TaskModel = {
//   subscribe(fn) → unsubscribe,
//   list() → Promise<Task[]>,
//   listBySection(sectionId) → Promise<Task[]>,  // ordered by `order`
//   listByArea(areaId) → Promise<Task[]>,  // all tasks whose section is in this area
//   create({ sectionId, title, ...metadata }) → Promise<Task>,
//   update(id, patch) → Promise<Task>,
//   rename(id, title) → Promise<void>,
//   toggleCompleted(id) → Promise<Task>,
//   completeOccurrence(id, now?) → Promise<void>,  // recurring: advance + stamp, never persists completed
//   remove(id) → Promise<void>,
//   removeMany(ids) → Promise<void>,
//   swapOrder(idA, idB) → Promise<void>,
//   moveToSection(id, targetSectionId) → Promise<void>,  // re-points sectionId, appends to target end
//   restore(snapshot) → Promise<Task>,
//   restoreMany(snapshots) → Promise<void>,
// }
//
// Storage note: IndexedDB can't index booleans. We persist `completed`,
// `starred`, and `critical` as 0/1 and convert at the model boundary, so the
// public API always uses true/false.

const BOOL_FIELDS = ["completed", "starred", "critical", "hasTime"];

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
			hasTime = false,
			recurrence = null,
			leadTime = 0,
		}) {
			if (!sectionId) throw new Error("create(task): sectionId is required");
			if (!title) throw new Error("create(task): title is required");
			const siblings = await db.getByIndex("tasks", "sectionId", sectionId);
			// max(order)+1, NOT siblings.length — the same gap-robustness
			// moveToSection already applies. A delete leaves a hole, so the count
			// can equal an order still in use: create three tasks (0,1,2), delete
			// the middle one, and the next create would take order 2 again. Two
			// tasks sharing an order make swapOrder a SILENT no-op (swapping equal
			// values changes nothing), which surfaces as a "Move down" that does
			// nothing, and it makes the sort order between the pair arbitrary.
			const order = siblings.reduce((max, t) => Math.max(max, t.order), -1) + 1;
			const task = {
				id: uuid(),
				sectionId,
				title: capitalizeFirst(title),
				notes,
				completed: false,
				starred,
				critical,
				dueAt,
				hasTime,
				recurrence,
				lastCompletedAt: null,
				completedCount: 0,
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

		async rename(id, title) {
			const cleaned = capitalizeFirst(title);
			if (!cleaned) throw new Error("rename(task): title cannot be empty");
			const stored = await db.get("tasks", id);
			if (!stored) throw new Error(`Task not found: ${id}`);
			const current = fromStorage(stored);
			const updated = { ...current, title: cleaned };
			await db.put("tasks", toStorage(updated));
			notify();
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

		async completeOccurrence(id, now = new Date()) {
			const stored = await db.get("tasks", id);
			if (!stored) throw new Error(`Task not found: ${id}`);
			const task = fromStorage(stored);
			if (!task.recurrence) throw new Error(`Task is not recurring: ${id}`);

			// No-backlog: advance from the schedule, but never land on/before `now`.
			// Bounded — the engine coerces interval >= 1 so each step strictly
			// advances; the break is a belt-and-braces guard against a non-advancing
			// rule (imported / dev-tools data) so the loop can never hang.
			const anchor = task.dueAt ? new Date(task.dueAt) : now;
			let next = nextOccurrence(task.recurrence, anchor);
			while (next <= now) {
				const advanced = nextOccurrence(task.recurrence, next);
				if (advanced <= next) break;
				next = advanced;
			}

			const updated = {
				...task,
				dueAt: next.toISOString(),
				lastCompletedAt: now.toISOString(),
				completedCount: (task.completedCount ?? 0) + 1,
				completed: false, // a recurring task NEVER persists completed — it advances
			};
			await db.put("tasks", toStorage(updated)); // one put
			notify(); // one notify
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

		async moveToSection(id, targetSectionId) {
			const stored = await db.get("tasks", id);
			if (!stored) throw new Error(`Task not found: ${id}`);
			const targetSection = await db.get("sections", targetSectionId);
			if (!targetSection)
				throw new Error(`Section not found: ${targetSectionId}`);
			const current = fromStorage(stored);
			// Already there → no-op, no notify (avoids a spurious re-render).
			if (current.sectionId === targetSectionId) return;
			// Append to the target END. max(order)+1 is gap-robust: delete/move
			// can leave holes, so we never reuse a count. This APPENDS and never
			// reorders peers, keeping clear of the M4 !completed reorder invariant.
			const siblings = await db.getByIndex(
				"tasks",
				"sectionId",
				targetSectionId,
			);
			const maxOrder = siblings.reduce((max, t) => Math.max(max, t.order), -1);
			const moved = {
				...current,
				sectionId: targetSectionId,
				order: maxOrder + 1,
			};
			await db.put("tasks", toStorage(moved));
			notify();
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
