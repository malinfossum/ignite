import { afterEach, describe, expect, it } from "vitest";
import { createDataModel } from "../../src/model/data.js";
import { openDB } from "../../src/model/db.js";

let handles = [];
afterEach(() => {
	for (const db of handles) db.close();
	handles = [];
});
async function fresh() {
	const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
	handles.push(db);
	return db;
}

const task = {
	id: "t",
	sectionId: "s",
	title: "T",
	notes: "",
	completed: false,
	starred: true,
	critical: false,
	dueAt: null,
	hasTime: true,
	recurrence: null,
	lastCompletedAt: null,
	completedCount: 0,
	leadTime: 0,
	scheduledTags: [],
	createdAt: "2026-11-09T12:00:00.000Z",
	order: 0,
};

describe("createDataModel", () => {
	it("writes task booleans as 0/1 and reads them back as booleans", async () => {
		const db = await fresh();
		const data = createDataModel(db);
		await data.replaceAll({ areas: [], sections: [], tasks: [task] });
		const raw = await db.get("tasks", "t");
		expect(raw.starred).toBe(1);
		expect(raw.hasTime).toBe(1);
		expect(raw.completed).toBe(0);
		const snap = await data.snapshot();
		expect(snap.tasks).toEqual([task]);
	});

	it("snapshots areas and sections as stored", async () => {
		const db = await fresh();
		const area = { id: "a", name: "A", icon: "🏠", critical: false, order: 1 };
		await db.put("areas", area);
		const snap = await createDataModel(db).snapshot();
		expect(snap).toEqual({ areas: [area], sections: [], tasks: [] });
	});
});
