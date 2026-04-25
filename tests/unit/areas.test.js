import { afterEach, describe, expect, it } from "vitest";
import { createAreaModel } from "../../src/model/areas.js";
import { openDB } from "../../src/model/db.js";

let openHandles = [];
async function freshModel() {
	const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
	openHandles.push(db);
	return { db, model: await createAreaModel(db) };
}

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

describe("createAreaModel — CRUD", () => {
	it("create adds an area with a uuid, returns the record", async () => {
		const { model } = await freshModel();
		const created = await model.create({ name: "Projects" });
		expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(created.name).toBe("Projects");
	});

	it("list returns all created areas", async () => {
		const { model } = await freshModel();
		await model.create({ name: "Projects" });
		await model.create({ name: "Shopping" });
		const all = await model.list();
		expect(all.map((a) => a.name).sort()).toEqual([
			"Focus",
			"Projects",
			"Shopping",
		]);
	});

	it("update patches fields", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "Original" });
		await model.update(a.id, { name: "Renamed" });
		const fetched = (await model.list()).find((x) => x.id === a.id);
		expect(fetched.name).toBe("Renamed");
	});

	it("remove deletes a user area", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "Tmp" });
		await model.remove(a.id);
		const fetched = (await model.list()).find((x) => x.id === a.id);
		expect(fetched).toBeUndefined();
	});
});

describe("createAreaModel — subscribe/notify", () => {
	it("notifies subscribers on create / update / remove", async () => {
		const { model } = await freshModel();
		let calls = 0;
		const unsubscribe = model.subscribe(() => {
			calls++;
		});
		const a = await model.create({ name: "X" });
		await model.update(a.id, { name: "Y" });
		await model.remove(a.id);
		unsubscribe();
		await model.create({ name: "ShouldNotNotify" });
		expect(calls).toBe(3);
	});
});

describe("createAreaModel — Focus seed", () => {
	it("seeds the Focus area on first construction", async () => {
		const { model } = await freshModel();
		const all = await model.list();
		const focus = all.find((a) => a.id === "focus");
		expect(focus).toBeDefined();
		expect(focus.name).toBe("Focus");
	});

	it("is idempotent — constructing twice does not duplicate Focus", async () => {
		const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
		openHandles.push(db);
		await createAreaModel(db);
		const model2 = await createAreaModel(db);
		const all = await model2.list();
		const focuses = all.filter((a) => a.id === "focus");
		expect(focuses.length).toBe(1);
	});

	it("refuses to delete the Focus area", async () => {
		const { model } = await freshModel();
		await expect(model.remove("focus")).rejects.toThrow(/cannot delete focus/i);
		const stillThere = (await model.list()).find((a) => a.id === "focus");
		expect(stillThere).toBeDefined();
	});
});
