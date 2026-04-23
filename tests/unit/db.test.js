import { afterEach, describe, expect, it } from "vitest";
import { openDB } from "../../src/model/db.js";

// fake-indexeddb is loaded in tests/setup.js. We use a unique db name per
// test so state never leaks between cases.
let openHandles = [];
async function fresh(name = `ignite-test-${crypto.randomUUID()}`) {
	const db = await openDB(name);
	openHandles.push(db);
	return db;
}

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

describe("openDB — schema v1", () => {
	it("creates the four object stores", async () => {
		const db = await fresh();
		const names = Array.from(db.raw.objectStoreNames).sort();
		expect(names).toEqual(["areas", "sections", "settings", "tasks"]);
	});

	it("creates indexes on the tasks store", async () => {
		const db = await fresh();
		const tx = db.raw.transaction("tasks", "readonly");
		const store = tx.objectStore("tasks");
		const indexNames = Array.from(store.indexNames).sort();
		expect(indexNames).toEqual(["completed", "dueAt", "sectionId", "starred"]);
	});
});

describe("DBWrapper CRUD", () => {
	it("put then get returns the record", async () => {
		const db = await fresh();
		await db.put("areas", {
			id: "a1",
			name: "Test",
			icon: "",
			critical: false,
			order: 0,
		});
		const read = await db.get("areas", "a1");
		expect(read.name).toBe("Test");
	});

	it("getAll returns every record in a store", async () => {
		const db = await fresh();
		await db.put("areas", {
			id: "a1",
			name: "One",
			icon: "",
			critical: false,
			order: 0,
		});
		await db.put("areas", {
			id: "a2",
			name: "Two",
			icon: "",
			critical: false,
			order: 1,
		});
		const all = await db.getAll("areas");
		expect(all.length).toBe(2);
	});

	it("delete removes a record", async () => {
		const db = await fresh();
		await db.put("areas", {
			id: "a1",
			name: "Test",
			icon: "",
			critical: false,
			order: 0,
		});
		await db.delete("areas", "a1");
		expect(await db.get("areas", "a1")).toBeUndefined();
	});

	it("getByIndex filters records by an indexed field", async () => {
		const db = await fresh();
		await db.put("tasks", {
			id: "t1",
			sectionId: "s1",
			title: "A",
			completed: 0,
			starred: 0,
			createdAt: new Date().toISOString(),
			order: 0,
		});
		await db.put("tasks", {
			id: "t2",
			sectionId: "s2",
			title: "B",
			completed: 0,
			starred: 0,
			createdAt: new Date().toISOString(),
			order: 0,
		});
		const inS1 = await db.getByIndex("tasks", "sectionId", "s1");
		expect(inS1.map((t) => t.id)).toEqual(["t1"]);
	});
});
