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
