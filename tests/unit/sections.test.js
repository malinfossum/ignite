import { afterEach, describe, expect, it } from "vitest";
import { createAreaModel } from "../../src/model/areas.js";
import { openDB } from "../../src/model/db.js";
import { createSectionModel } from "../../src/model/sections.js";

let openHandles = [];
async function freshModel() {
	const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
	openHandles.push(db);
	return { db, model: await createSectionModel(db) };
}

// Used by the focus-default guard tests, which need the seed in place.
async function seededModel() {
	const { db, model } = await freshModel();
	await createAreaModel(db); // seeds focus area + focus-default section
	return { db, model };
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

describe("createSectionModel — setCollapsed", () => {
	it("flips the collapsed flag and notifies", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Daily" });
		expect(s.collapsed).toBe(false);

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.setCollapsed(s.id, true);
		const [stored] = await model.listByArea("focus");
		expect(stored.collapsed).toBe(true);
		expect(calls).toEqual(["notified"]);
	});
});

describe("createSectionModel — rename", () => {
	it("trims and updates the name", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Old" });
		await model.rename(s.id, "  Routines  ");
		const [stored] = await model.listByArea("focus");
		expect(stored.name).toBe("Routines");
	});

	it("rejects empty / whitespace-only names", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Old" });
		await expect(model.rename(s.id, "")).rejects.toThrow(/empty/i);
		await expect(model.rename(s.id, "   ")).rejects.toThrow(/empty/i);
		const [stored] = await model.listByArea("focus");
		expect(stored.name).toBe("Old");
	});
});

describe("createSectionModel — swapOrder", () => {
	it("swaps order values between two sections in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ areaId: "focus", name: "A" });
		const b = await model.create({ areaId: "focus", name: "B" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.swapOrder(a.id, b.id);
		const list = await model.listByArea("focus");
		expect(list[0].id).toBe(b.id);
		expect(list[1].id).toBe(a.id);
		expect(calls).toEqual(["notified"]); // single notify
	});
});

describe("createSectionModel — restore", () => {
	it("re-inserts a deleted section with the same id and order", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Daily" });
		await model.remove(s.id);
		await model.restore(s);
		const list = await model.listByArea("focus");
		expect(list).toHaveLength(1);
		expect(list[0].id).toBe(s.id);
		expect(list[0].order).toBe(s.order);
		expect(list[0].name).toBe("Daily");
	});

	it("notifies subscribers", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "x" });
		await model.remove(s.id);

		const calls = [];
		model.subscribe(() => calls.push("notified"));
		await model.restore(s);
		expect(calls).toEqual(["notified"]);
	});
});

describe("createSectionModel — removeMany", () => {
	it("deletes multiple sections in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ areaId: "focus", name: "A" });
		const b = await model.create({ areaId: "focus", name: "B" });
		await model.create({ areaId: "focus", name: "C" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.removeMany([a.id, b.id]);
		const list = await model.listByArea("focus");
		expect(list.map((s) => s.name)).toEqual(["C"]);
		expect(calls).toEqual(["notified"]); // single notify, not two
	});
});

describe("createSectionModel — focus-default undeletable guard", () => {
	it("rejects remove(FOCUS_DEFAULT_SECTION_ID) and leaves the seed intact", async () => {
		const { model } = await seededModel();
		await expect(model.remove("focus-default")).rejects.toThrow(
			/cannot delete/i,
		);
		const stored = await model.list();
		expect(stored.some((s) => s.id === "focus-default")).toBe(true);
	});

	it("rejects removeMany when the id list contains FOCUS_DEFAULT_SECTION_ID", async () => {
		const { model } = await seededModel();
		const other = await model.create({ areaId: "focus", name: "Routines" });
		await expect(model.removeMany([other.id, "focus-default"])).rejects.toThrow(
			/cannot delete/i,
		);
		// Reject before any delete — both records still present.
		const stored = await model.list();
		expect(stored.some((s) => s.id === "focus-default")).toBe(true);
		expect(stored.some((s) => s.id === other.id)).toBe(true);
	});
});

describe("createSectionModel — name capitalization", () => {
	it("capitalizes the first character of name on create", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "inbox" });
		expect(s.name).toBe("Inbox");
	});

	it("capitalizes the first character on rename", async () => {
		const { model } = await freshModel();
		const s = await model.create({ areaId: "focus", name: "Old" });
		await model.rename(s.id, "  routines  ");
		const [stored] = await model.listByArea("focus");
		expect(stored.name).toBe("Routines");
	});
});

describe("createSectionModel — restoreMany", () => {
	it("re-inserts multiple deleted sections in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ areaId: "focus", name: "A" });
		const b = await model.create({ areaId: "focus", name: "B" });
		await model.removeMany([a.id, b.id]);

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.restoreMany([a, b]);
		const list = await model.listByArea("focus");
		expect(list.map((s) => s.name).sort()).toEqual(["A", "B"]);
		expect(calls).toEqual(["notified"]); // single notify
	});
});
