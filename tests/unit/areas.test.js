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
		expect(all.map((a) => a.name).sort()).toEqual(["Projects", "Shopping"]);
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
