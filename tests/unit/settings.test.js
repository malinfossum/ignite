import { afterEach, describe, expect, it } from "vitest";
import { openDB } from "../../src/model/db.js";
import { createSettingsModel } from "../../src/model/settings.js";

let openHandles = [];
async function freshModel() {
	const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
	openHandles.push(db);
	return { db, model: await createSettingsModel(db) };
}

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

describe("createSettingsModel", () => {
	it("seeds default settings on first construction", async () => {
		const { model } = await freshModel();
		const s = await model.get();
		expect(s.id).toBe("app");
		expect(s.quietStart).toBe(23);
		expect(s.quietEnd).toBe(7);
		expect(s.lastKnownPermission).toBe("default");
		expect(s.lastView).toBe("#today");
	});

	it("is idempotent — does not overwrite existing settings", async () => {
		const db = await openDB(`ignite-test-${crypto.randomUUID()}`);
		openHandles.push(db);
		const m1 = await createSettingsModel(db);
		await m1.update({ quietStart: 22 });
		const m2 = await createSettingsModel(db);
		const s = await m2.get();
		expect(s.quietStart).toBe(22);
	});

	it("update patches fields and notifies", async () => {
		const { model } = await freshModel();
		let calls = 0;
		model.subscribe(() => {
			calls++;
		});
		await model.update({ quietEnd: 6, lastView: "#area/focus" });
		const s = await model.get();
		expect(s.quietEnd).toBe(6);
		expect(s.lastView).toBe("#area/focus");
		expect(s.quietStart).toBe(23); // untouched
		expect(calls).toBe(1);
	});
});
