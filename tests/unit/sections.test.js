import { afterEach, describe, expect, it } from "vitest";
import { openDB } from "../../src/model/db.js";
import { createSectionModel } from "../../src/model/sections.js";

let openHandles = [];
async function freshModel() {
	const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
	openHandles.push(db);
	return { db, model: await createSectionModel(db) };
}

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

describe("createSectionModel", () => {
	it("create persists a section with defaults", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Daily" });
		expect(s.id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(s.areaId).toBe("focus");
		expect(s.name).toBe("Daily");
		expect(s.collapsed).toBe(false);
		expect(typeof s.order).toBe("number");
	});

	it("create requires areaId", async () => {
		const { model } = await freshModel();
		await expect(model.create({ name: "NoArea" })).rejects.toThrow(/areaId/i);
	});

	it("listByArea returns only sections in that area, ordered", async () => {
		const { model } = await freshModel();
		const a = await model.create({ areaId: "focus", name: "A" });
		const b = await model.create({ areaId: "focus", name: "B" });
		await model.create({ areaId: "other", name: "C" });
		const focusOnly = await model.listByArea("focus");
		expect(focusOnly.map((s) => s.id)).toEqual([a.id, b.id]);
	});

	it("update patches fields and notifies", async () => {
		const { model } = await freshModel();
		let calls = 0;
		model.subscribe(() => {
			calls++;
		});
		const s = await model.create({ areaId: "focus", name: "Old" });
		await model.update(s.id, { collapsed: true, name: "New" });
		const fetched = (await model.listByArea("focus")).find(
			(x) => x.id === s.id,
		);
		expect(fetched.collapsed).toBe(true);
		expect(fetched.name).toBe("New");
		expect(calls).toBe(2); // create + update
	});

	it("remove deletes and notifies", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Tmp" });
		await model.remove(s.id);
		const fetched = (await model.listByArea("focus")).find(
			(x) => x.id === s.id,
		);
		expect(fetched).toBeUndefined();
	});
});
