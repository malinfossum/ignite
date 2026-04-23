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
