import { afterEach, describe, expect, it } from "vitest";
import { openDB } from "../../src/model/db.js";
import { createTaskModel } from "../../src/model/tasks.js";

let openHandles = [];
async function freshModel() {
	const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
	openHandles.push(db);
	return { db, model: await createTaskModel(db) };
}

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

describe("createTaskModel — create", () => {
	it("persists a task with defaults", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Call mom" });
		expect(t.id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(t.title).toBe("Call mom");
		expect(t.completed).toBe(false);
		expect(t.starred).toBe(false);
		expect(t.critical).toBe(false);
		expect(t.dueAt).toBeNull();
		expect(t.recurrence).toBeNull();
		expect(t.leadTime).toBe(0);
		expect(t.scheduledTags).toEqual([]);
		expect(t.notes).toBe("");
		expect(typeof t.createdAt).toBe("string");
	});

	it("defaults hasTime to false", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Call mom" });
		expect(t.hasTime).toBe(false);
	});

	it("accepts hasTime on create and round-trips it as a boolean", async () => {
		const { model } = await freshModel();
		await model.create({ sectionId: "s1", title: "Standup", hasTime: true });
		const [stored] = await model.list();
		expect(stored.hasTime).toBe(true);
	});

	it("requires sectionId and title", async () => {
		const { model } = await freshModel();
		await expect(model.create({ title: "X" })).rejects.toThrow(/sectionId/i);
		await expect(model.create({ sectionId: "s1" })).rejects.toThrow(/title/i);
	});

	it("accepts explicit metadata on create", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "Meeting",
			starred: true,
			critical: true,
			dueAt: "2026-04-21T10:00:00.000Z",
			leadTime: 15,
			notes: "bring laptop",
		});
		expect(t.starred).toBe(true);
		expect(t.critical).toBe(true);
		expect(t.dueAt).toBe("2026-04-21T10:00:00.000Z");
		expect(t.leadTime).toBe(15);
		expect(t.notes).toBe("bring laptop");
	});
});

describe("createTaskModel — queries", () => {
	it("listBySection returns only that section's tasks, ordered", async () => {
		const { model } = await freshModel();
		const a = await model.create({ sectionId: "s1", title: "A" });
		const b = await model.create({ sectionId: "s1", title: "B" });
		await model.create({ sectionId: "s2", title: "C" });
		const got = await model.listBySection("s1");
		expect(got.map((t) => t.id)).toEqual([a.id, b.id]);
	});

	it("exposes booleans on read even though they are stored as 0/1", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "T",
			starred: true,
		});
		const [reread] = await model.listBySection("s1");
		expect(reread.starred).toBe(true);
		expect(reread.id).toBe(t.id);
	});
});

describe("createTaskModel — update / toggle / remove", () => {
	it("update patches fields", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Old" });
		await model.update(t.id, { title: "New", starred: true });
		const [got] = await model.listBySection("s1");
		expect(got.title).toBe("New");
		expect(got.starred).toBe(true);
	});

	it("toggleCompleted flips the flag", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "T" });
		await model.toggleCompleted(t.id);
		let [got] = await model.listBySection("s1");
		expect(got.completed).toBe(true);
		await model.toggleCompleted(t.id);
		[got] = await model.listBySection("s1");
		expect(got.completed).toBe(false);
	});

	it("remove deletes the task", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "T" });
		await model.remove(t.id);
		expect((await model.listBySection("s1")).length).toBe(0);
	});

	it("notifies subscribers on every mutation", async () => {
		const { model } = await freshModel();
		let calls = 0;
		model.subscribe(() => {
			calls++;
		});
		const t = await model.create({ sectionId: "s1", title: "T" });
		await model.update(t.id, { title: "U" });
		await model.toggleCompleted(t.id);
		await model.remove(t.id);
		expect(calls).toBe(4);
	});
});

describe("createTaskModel — restore", () => {
	it("re-inserts a deleted task with the same id and fields", async () => {
		const { model } = await freshModel();
		const original = await model.create({
			sectionId: "s1",
			title: "Buy bread",
			starred: true,
		});
		await model.remove(original.id);
		await model.restore(original);
		const list = await model.list();
		expect(list).toHaveLength(1);
		expect(list[0].id).toBe(original.id);
		expect(list[0].title).toBe("Buy bread");
		expect(list[0].starred).toBe(true);
	});

	it("notifies subscribers", async () => {
		const { model } = await freshModel();
		const original = await model.create({ sectionId: "s1", title: "x" });
		await model.remove(original.id);

		const calls = [];
		model.subscribe(() => calls.push("notified"));
		await model.restore(original);
		expect(calls).toEqual(["notified"]);
	});
});

describe("createTaskModel — removeMany", () => {
	it("deletes multiple tasks in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ sectionId: "s1", title: "A" });
		const b = await model.create({ sectionId: "s1", title: "B" });
		const c = await model.create({ sectionId: "s1", title: "C" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.removeMany([a.id, b.id]);
		const list = await model.list();
		expect(list.map((t) => t.id)).toEqual([c.id]);
		expect(calls).toEqual(["notified"]);
	});
});

describe("createTaskModel — restoreMany", () => {
	it("re-inserts multiple tasks with original ids in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({
			sectionId: "s1",
			title: "A",
			starred: true,
		});
		const b = await model.create({ sectionId: "s1", title: "B" });
		await model.removeMany([a.id, b.id]);

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.restoreMany([a, b]);
		const list = await model.list();
		expect(list).toHaveLength(2);
		expect(list.find((t) => t.id === a.id).starred).toBe(true);
		expect(list.find((t) => t.id === b.id).title).toBe("B");
		expect(calls).toEqual(["notified"]);
	});
});

describe("createTaskModel — title capitalization", () => {
	it("capitalizes the first character of title on create", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "hello world" });
		expect(t.title).toBe("Hello world");
	});
});

describe("createTaskModel — swapOrder", () => {
	it("swaps order values between two tasks in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ sectionId: "s1", title: "A" });
		const b = await model.create({ sectionId: "s1", title: "B" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.swapOrder(a.id, b.id);
		const list = await model.listBySection("s1");
		expect(list[0].id).toBe(b.id);
		expect(list[1].id).toBe(a.id);
		expect(calls).toEqual(["notified"]); // single notify
	});

	it("throws when either task id is missing", async () => {
		const { model } = await freshModel();
		await expect(model.swapOrder("nope-a", "nope-b")).rejects.toThrow(
			/Task not found/,
		);
		const a = await model.create({ sectionId: "s1", title: "A" });
		await expect(model.swapOrder(a.id, "nope-b")).rejects.toThrow(
			/Task not found/,
		);
	});
});

describe("createTaskModel — listByArea", () => {
	it("returns all tasks whose section belongs to the area, regardless of section", async () => {
		const { db, model } = await freshModel();
		// Seed two sections in "focus" area and one in "other" area.
		await db.put("sections", {
			id: "s1",
			areaId: "focus",
			name: "S1",
			order: 0,
			collapsed: false,
		});
		await db.put("sections", {
			id: "s2",
			areaId: "focus",
			name: "S2",
			order: 1,
			collapsed: false,
		});
		await db.put("sections", {
			id: "s3",
			areaId: "other",
			name: "S3",
			order: 0,
			collapsed: false,
		});
		const t1 = await model.create({ sectionId: "s1", title: "T1" });
		const t2 = await model.create({ sectionId: "s2", title: "T2" });
		await model.create({ sectionId: "s3", title: "T3" });

		const focusTasks = await model.listByArea("focus");
		expect(focusTasks.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
	});
});

describe("createTaskModel — rename", () => {
	it("trims and capitalizes the new title, persists, returns nothing", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Old" });
		const result = await model.rename(t.id, "  buy bread  ");
		expect(result).toBeUndefined();
		const [stored] = await model.listBySection("s1");
		expect(stored.title).toBe("Buy bread");
	});

	it("rejects empty / whitespace-only titles", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Old" });
		await expect(model.rename(t.id, "")).rejects.toThrow(/empty/i);
		await expect(model.rename(t.id, "   ")).rejects.toThrow(/empty/i);
		const [stored] = await model.listBySection("s1");
		expect(stored.title).toBe("Old");
	});

	it("throws Task not found for a missing id", async () => {
		const { model } = await freshModel();
		await expect(model.rename("nope-id", "New")).rejects.toThrow(
			/Task not found/,
		);
	});

	it("preserves all other fields (order, sectionId, starred, completed, dueAt, recurrence)", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "Meeting",
			starred: true,
			dueAt: "2026-06-01T10:00:00.000Z",
			recurrence: "weekly",
			leadTime: 15,
		});
		await model.toggleCompleted(t.id);
		await model.rename(t.id, "renamed");
		const list = await model.list();
		const updated = list.find((x) => x.id === t.id);
		expect(updated.title).toBe("Renamed");
		expect(updated.sectionId).toBe("s1");
		expect(updated.starred).toBe(true);
		expect(updated.completed).toBe(true);
		expect(updated.dueAt).toBe("2026-06-01T10:00:00.000Z");
		expect(updated.recurrence).toBe("weekly");
		expect(updated.leadTime).toBe(15);
		expect(updated.order).toBe(t.order);
	});

	it("notifies subscribers exactly once per rename", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Old" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.rename(t.id, "New");
		expect(calls).toEqual(["notified"]);
	});

	it("does NOT notify on failure (empty title or missing id)", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Old" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await expect(model.rename(t.id, "")).rejects.toThrow();
		await expect(model.rename("nope-id", "Whatever")).rejects.toThrow();
		expect(calls).toEqual([]);
	});
});

describe("createTaskModel — recurrence fields", () => {
	it("defaults lastCompletedAt:null and completedCount:0 on create", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "T" });
		expect(t.lastCompletedAt).toBeNull();
		expect(t.completedCount).toBe(0);
	});

	it("round-trips the two fields through storage uncoerced", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "T" });
		await model.update(t.id, {
			lastCompletedAt: "2026-05-01T10:00:00.000Z",
			completedCount: 4,
		});
		const [reread] = await model.listBySection("s1");
		expect(reread.lastCompletedAt).toBe("2026-05-01T10:00:00.000Z");
		expect(reread.completedCount).toBe(4);
	});
});

describe("createTaskModel — completeOccurrence", () => {
	const dailyRule = { type: "daily", interval: 1 };

	it("advances dueAt via the engine, stamps last-done, bumps count, stays unchecked, notifies once", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "Water plants",
			recurrence: dailyRule,
			dueAt: "2026-05-01T09:00:00.000Z",
		});

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		const now = new Date("2026-05-01T12:00:00.000Z");
		await model.completeOccurrence(t.id, now);

		const [got] = await model.listBySection("s1");
		expect(got.dueAt).toBe(new Date("2026-05-02T09:00:00.000Z").toISOString());
		expect(got.lastCompletedAt).toBe(now.toISOString());
		expect(got.completedCount).toBe(1);
		expect(got.completed).toBe(false);
		expect(calls).toEqual(["notified"]); // single notify
	});

	it("no-backlog: a badly stale dueAt advances to the first future occurrence", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "Stale daily",
			recurrence: dailyRule,
			dueAt: "2026-01-01T09:00:00.000Z",
		});
		const now = new Date("2026-01-05T12:00:00.000Z");
		await model.completeOccurrence(t.id, now);
		const [got] = await model.listBySection("s1");
		expect(new Date(got.dueAt).getTime()).toBeGreaterThan(now.getTime());
		expect(got.dueAt).toBe(new Date("2026-01-06T09:00:00.000Z").toISOString());
	});

	it("anchors on `now` when dueAt is null", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "No date",
			recurrence: dailyRule,
			dueAt: null,
		});
		const now = new Date("2026-05-10T08:00:00.000Z");
		await model.completeOccurrence(t.id, now);
		const [got] = await model.listBySection("s1");
		expect(new Date(got.dueAt).getTime()).toBeGreaterThan(now.getTime());
	});

	it("throws 'is not recurring' for a non-recurring task", async () => {
		const { model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Plain" });
		await expect(model.completeOccurrence(t.id, new Date())).rejects.toThrow(
			/is not recurring/i,
		);
	});

	it("throws 'Task not found' for a missing id", async () => {
		const { model } = await freshModel();
		await expect(
			model.completeOccurrence("nope-id", new Date()),
		).rejects.toThrow(/Task not found/);
	});

	it("accumulates completedCount across multiple completions", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "Daily",
			recurrence: dailyRule,
			dueAt: "2026-05-01T09:00:00.000Z",
		});
		await model.completeOccurrence(t.id, new Date("2026-05-01T12:00:00.000Z"));
		await model.completeOccurrence(t.id, new Date("2026-05-02T12:00:00.000Z"));
		const [got] = await model.listBySection("s1");
		expect(got.completedCount).toBe(2);
	});
});

describe("createTaskModel — moveToSection", () => {
	async function seedSection(db, id, areaId = "a1", order = 0) {
		await db.put("sections", { id, areaId, name: id, order, collapsed: false });
	}

	it("re-points sectionId and appends to the target end, notifying once", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		await seedSection(db, "s2");
		const t = await model.create({ sectionId: "s1", title: "Move me" });
		await model.create({ sectionId: "s2", title: "Existing" }); // order 0 in s2

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		const result = await model.moveToSection(t.id, "s2");
		expect(result).toBeUndefined();

		const inS2 = await model.listBySection("s2");
		const moved = inS2.find((x) => x.id === t.id);
		expect(moved.sectionId).toBe("s2");
		expect(moved.order).toBe(1); // appended after the existing order-0 task
		expect(calls).toEqual(["notified"]); // single notify
	});

	it("is gap-robust: appends max(order)+1, not a colliding value", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		await seedSection(db, "s2");
		// Two tasks in s2, then delete the first → leaves orders [_, 1] (gap at 0).
		const keep0 = await model.create({ sectionId: "s2", title: "Zero" }); // order 0
		const keep1 = await model.create({ sectionId: "s2", title: "One" }); // order 1
		await model.remove(keep0.id); // s2 now has only order 1
		const t = await model.create({ sectionId: "s1", title: "Move me" });

		await model.moveToSection(t.id, "s2");

		const inS2 = await model.listBySection("s2");
		const moved = inS2.find((x) => x.id === t.id);
		expect(moved.order).toBe(2); // max(1)+1, not 1 (no collision with keep1)
		expect(keep1.order).toBe(1);
	});

	it("appends order 0 into an empty target section", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		await seedSection(db, "s2");
		const t = await model.create({ sectionId: "s1", title: "Move me" });

		await model.moveToSection(t.id, "s2");

		const [moved] = await model.listBySection("s2");
		expect(moved.id).toBe(t.id);
		expect(moved.order).toBe(0);
	});

	it("no-ops without notifying when already in the target section", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		const t = await model.create({ sectionId: "s1", title: "Stay" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.moveToSection(t.id, "s1");
		expect(calls).toEqual([]); // no notify, no write
		const [reread] = await model.listBySection("s1");
		expect(reread.order).toBe(t.order); // unchanged
	});

	it("throws Task not found for a missing task id", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s2");
		await expect(model.moveToSection("nope-id", "s2")).rejects.toThrow(
			/Task not found/,
		);
	});

	it("throws Section not found for a missing target section", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		const t = await model.create({ sectionId: "s1", title: "Move me" });
		await expect(model.moveToSection(t.id, "ghost-section")).rejects.toThrow(
			/Section not found/,
		);
	});

	it("preserves every other field on the moved task", async () => {
		const { db, model } = await freshModel();
		await seedSection(db, "s1");
		await seedSection(db, "s2");
		const t = await model.create({
			sectionId: "s1",
			title: "Meeting",
			starred: true,
			critical: true,
			dueAt: "2026-06-01T10:00:00.000Z",
			recurrence: "weekly",
			leadTime: 15,
			notes: "bring laptop",
		});

		await model.moveToSection(t.id, "s2");

		const [moved] = await model.listBySection("s2");
		expect(moved.title).toBe("Meeting");
		expect(moved.starred).toBe(true);
		expect(moved.critical).toBe(true);
		expect(moved.completed).toBe(false);
		expect(moved.dueAt).toBe("2026-06-01T10:00:00.000Z");
		expect(moved.recurrence).toBe("weekly");
		expect(moved.leadTime).toBe(15);
		expect(moved.notes).toBe("bring laptop");
		expect(moved.createdAt).toBe(t.createdAt);
	});
});

describe("createTaskModel — hasTime migration", () => {
	it("reads a row written before hasTime existed as false", async () => {
		const { db, model } = await freshModel();
		const t = await model.create({ sectionId: "s1", title: "Legacy" });
		// Simulate a pre-hasTime row: the field simply is not there.
		const row = await db.get("tasks", t.id);
		delete row.hasTime;
		await db.put("tasks", row);

		const [read] = await model.list();
		expect(read.hasTime).toBe(false);
	});

	it("survives an update that does not mention hasTime", async () => {
		const { model } = await freshModel();
		const t = await model.create({
			sectionId: "s1",
			title: "Standup",
			hasTime: true,
		});
		await model.rename(t.id, "Standup, moved");
		const [read] = await model.list();
		expect(read.hasTime).toBe(true);
	});
});
