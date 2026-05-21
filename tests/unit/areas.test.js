import { afterEach, describe, expect, it } from "vitest";
import {
	createAreaModel,
	FOCUS_DEFAULT_SECTION_ID,
} from "../../src/model/areas.js";
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

describe("Focus default section seed", () => {
	it("seeds the default Focus section with a stable id on first construction", async () => {
		const { db } = await freshModel();
		const section = await db.get("sections", FOCUS_DEFAULT_SECTION_ID);
		expect(section).toBeDefined();
		expect(section.areaId).toBe("focus");
	});

	it("does not duplicate the default section on re-construction", async () => {
		const { db } = await freshModel();
		await createAreaModel(db);
		const all = await db.getAll("sections");
		const focusSections = all.filter((s) => s.areaId === "focus");
		expect(focusSections).toHaveLength(1);
	});
});

describe("ensureFocus — section name migration", () => {
	it("renames the focus-default section from empty to 'Tasks' on boot", async () => {
		// Simulate an M2 record: Focus area + focus-default section with name "".
		const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
		try {
			await db.put("areas", {
				id: "focus",
				name: "Focus",
				icon: "🔥",
				critical: false,
				order: 0,
			});
			await db.put("sections", {
				id: "focus-default",
				areaId: "focus",
				name: "",
				collapsed: false,
				order: 0,
			});

			await createAreaModel(db);

			const section = await db.get("sections", "focus-default");
			expect(section.name).toBe("Tasks");
		} finally {
			db.close();
		}
	});

	it("does not overwrite a renamed focus-default section", async () => {
		const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
		try {
			await db.put("areas", {
				id: "focus",
				name: "Focus",
				icon: "🔥",
				critical: false,
				order: 0,
			});
			await db.put("sections", {
				id: "focus-default",
				areaId: "focus",
				name: "Inbox",
				collapsed: false,
				order: 0,
			});

			await createAreaModel(db);

			const section = await db.get("sections", "focus-default");
			expect(section.name).toBe("Inbox");
		} finally {
			db.close();
		}
	});

	it("seeds focus-default with name 'Tasks' on a fresh DB", async () => {
		const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
		try {
			await createAreaModel(db);
			const section = await db.get("sections", "focus-default");
			expect(section.name).toBe("Tasks");
		} finally {
			db.close();
		}
	});
});

describe("createAreaModel — name capitalization", () => {
	it("capitalizes the first character of name on create", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "projects" });
		expect(a.name).toBe("Projects");
	});
});

describe("createAreaModel — rename", () => {
	it("trims, capitalizes, and updates the name in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "Projects" });

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.rename(a.id, "  studies  ");
		const stored = (await model.list()).find((x) => x.id === a.id);
		expect(stored.name).toBe("Studies");
		expect(calls).toEqual(["notified"]);
	});

	it("rejects empty / whitespace-only names and missing ids", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "Old" });
		await expect(model.rename(a.id, "")).rejects.toThrow(/empty/i);
		await expect(model.rename(a.id, "   ")).rejects.toThrow(/empty/i);
		await expect(model.rename("no-such-id", "New")).rejects.toThrow(
			/not found/i,
		);
		const stored = (await model.list()).find((x) => x.id === a.id);
		expect(stored.name).toBe("Old");
	});
});

describe("createAreaModel — swapOrder", () => {
	it("swaps order values between two areas in one notify", async () => {
		const { model } = await freshModel();
		const a = await model.create({ name: "A" }); // order = 1 (Focus is 0)
		const b = await model.create({ name: "B" }); // order = 2

		const calls = [];
		model.subscribe(() => calls.push("notified"));

		await model.swapOrder(a.id, b.id);
		const list = (await model.list()).filter((x) => x.id !== "focus");
		list.sort((x, y) => x.order - y.order);
		expect(list[0].id).toBe(b.id);
		expect(list[1].id).toBe(a.id);
		expect(calls).toEqual(["notified"]); // single notify after both writes
	});

	it("throws when either area id is missing", async () => {
		const { model } = await freshModel();
		await expect(model.swapOrder("nope-a", "nope-b")).rejects.toThrow(
			/Area not found/,
		);
		const a = await model.create({ name: "A" });
		await expect(model.swapOrder(a.id, "nope-b")).rejects.toThrow(
			/Area not found/,
		);
	});
});
