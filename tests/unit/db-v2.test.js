import { afterEach, describe, expect, it } from "vitest";
import { DB_VERSION, openDB } from "../../src/model/db.js";

let openHandles = [];
const uniqueName = () => `ignite-test-${crypto.randomUUID()}`;

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

// Opens a raw version-1 database the way v0.9.0 did, with no onversionchange
// handler, so it blocks an upgrade exactly like an old tab would.
function openV1Raw(name) {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			db.createObjectStore("areas", { keyPath: "id" });
			db.createObjectStore("sections", { keyPath: "id" });
			const tasks = db.createObjectStore("tasks", { keyPath: "id" });
			tasks.createIndex("sectionId", "sectionId");
			tasks.createIndex("dueAt", "dueAt");
			tasks.createIndex("completed", "completed");
			tasks.createIndex("starred", "starred");
			db.createObjectStore("settings", { keyPath: "id" });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

describe("openDB: version 2 upgrade", () => {
	it("is version 2", () => {
		expect(DB_VERSION).toBe(2);
	});

	it("keeps version 1 rows through the upgrade", async () => {
		const name = uniqueName();
		const v1 = await openV1Raw(name);
		await new Promise((resolve, reject) => {
			const tx = v1.transaction("tasks", "readwrite");
			tx.objectStore("tasks").put({ id: "t1", title: "Keep me" });
			tx.oncomplete = resolve;
			tx.onerror = () => reject(tx.error);
		});
		v1.close();

		const db = await openDB(name);
		openHandles.push(db);
		expect((await db.get("tasks", "t1")).title).toBe("Keep me");
		expect(Array.from(db.raw.objectStoreNames)).toContain("outbox");
	});

	it("waits (does not reject) while a version 1 tab holds the database open", async () => {
		const name = uniqueName();
		const v1 = await openV1Raw(name);
		let blockedCalls = 0;
		const opening = openDB(name, { onBlocked: () => blockedCalls++ });

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(blockedCalls).toBe(1);

		v1.close(); // the old tab goes away
		const db = await opening;
		openHandles.push(db);
		expect(Array.from(db.raw.objectStoreNames)).toContain("meta");
	});

	it("closes itself when a newer version asks, so it never blocks one", async () => {
		const name = uniqueName();
		const db = await openDB(name);
		openHandles.push(db);
		const v3 = await new Promise((resolve, reject) => {
			const req = indexedDB.open(name, 3);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
			req.onblocked = () => reject(new Error("blocked by the v2 connection"));
		});
		v3.close();
	});

	it("tells the app after it closed for a newer version", async () => {
		const name = uniqueName();
		let versionChanges = 0;
		const db = await openDB(name, {
			onVersionChange: () => versionChanges++,
		});
		openHandles.push(db);
		const v3 = await new Promise((resolve, reject) => {
			const req = indexedDB.open(name, 3);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		v3.close();
		// Without the callback a typed task would vanish: the closed connection
		// rejects every later write, and nothing on screen says so.
		expect(versionChanges).toBe(1);
		await expect(db.put("tasks", { id: "t1" })).rejects.toThrow();
	});
});

describe("transact", () => {
	it("commits writes to several stores together", async () => {
		const db = await openDB(uniqueName());
		openHandles.push(db);
		await db.transact(["tasks", "outbox"], "readwrite", async (t) => {
			await t.put("tasks", { id: "t1", title: "A" });
			await t.put("outbox", {
				key: "tasks:t1",
				store: "tasks",
				id: "t1",
				op: "put",
				rev: 1,
			});
		});
		expect(await db.get("tasks", "t1")).toBeDefined();
		expect(await db.get("outbox", "tasks:t1")).toBeDefined();
	});

	it("rolls back every store when fn throws", async () => {
		const db = await openDB(uniqueName());
		openHandles.push(db);
		await expect(
			db.transact(["tasks", "outbox"], "readwrite", async (t) => {
				await t.put("tasks", { id: "t1", title: "A" });
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await db.get("tasks", "t1")).toBeUndefined();
	});

	it("resolves with fn's return value after commit", async () => {
		const db = await openDB(uniqueName());
		openHandles.push(db);
		const value = await db.transact("meta", "readwrite", async (t) => {
			await t.put("meta", { id: "sync", mode: "local" });
			return (await t.get("meta", "sync")).mode;
		});
		expect(value).toBe("local");
	});
});
