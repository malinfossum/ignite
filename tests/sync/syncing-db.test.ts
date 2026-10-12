import { afterEach, describe, expect, it } from "vitest";
import { EPOCH } from "../../shared/protocol";
import { openDB } from "../../src/model/db.js";
import { createSyncingDb } from "../../src/sync/syncing-db";
import type { Db, TxHandle } from "../../src/sync/types";

let handles: Db[] = [];
afterEach(() => {
	for (const h of handles) h.close();
	handles = [];
});

const T0 = new Date("2026-10-01T10:00:00.000Z");

async function setup(mode: "local" | "account") {
	const raw = (await openDB(`ignite-test-${crypto.randomUUID()}`)) as Db;
	handles.push(raw);
	await raw.put("meta", {
		id: "sync",
		mode,
		cursor: 0,
		userEmail: null,
		lastSyncedAt: null,
	});
	let queued = 0;
	const db = createSyncingDb(raw, { now: () => T0, onQueued: () => queued++ });
	return { raw, db, queued: () => queued };
}

describe("createSyncingDb: account mode", () => {
	it("stamps updatedAt and queues a put in the same write", async () => {
		const { raw, db, queued } = await setup("account");
		await db.put("tasks", { id: "t1", title: "A" });
		expect((await raw.get("tasks", "t1"))?.updatedAt).toBe(T0.toISOString());
		expect(await raw.get("outbox", "tasks:t1")).toEqual({
			key: "tasks:t1",
			store: "tasks",
			id: "t1",
			op: "put",
			rev: 1,
		});
		expect(queued()).toBe(1);
	});

	it("coalesces ten edits into one entry whose rev counts them", async () => {
		const { raw, db } = await setup("account");
		for (let i = 0; i < 10; i++)
			await db.put("tasks", { id: "t1", title: `v${i}` });
		const entries = await raw.getAll("outbox");
		expect(entries).toHaveLength(1);
		expect(entries[0].rev).toBe(10);
	});

	it("turns a queued put into a delete, keeping the rev moving", async () => {
		const { raw, db } = await setup("account");
		await db.put("tasks", { id: "t1", title: "A" });
		await db.delete("tasks", "t1");
		expect(await raw.get("tasks", "t1")).toBeUndefined();
		expect(await raw.get("outbox", "tasks:t1")).toEqual({
			key: "tasks:t1",
			store: "tasks",
			id: "t1",
			op: "delete",
			rev: 2,
			deletedAt: T0.toISOString(),
		});
	});

	it("writes nothing when the row's put fails: no entry without its row", async () => {
		const { raw, db } = await setup("account");
		// No keyPath value, so the row's put throws inside the transaction.
		await expect(db.put("tasks", { title: "no id" })).rejects.toBeDefined();
		expect(await raw.getAll("outbox")).toEqual([]);
	});

	it("writes nothing when the outbox put fails: no row without its entry", async () => {
		const { raw, db } = await setup("account");
		const storeLists: string[][] = [];
		const transact = raw.transact;
		// Same transaction, but the second write (the outbox entry) throws.
		raw.transact = <T>(
			stores: string | string[],
			mode: IDBTransactionMode,
			fn: (t: TxHandle) => Promise<T> | T,
		): Promise<T> => {
			storeLists.push([stores].flat());
			return transact(stores, mode, (t) =>
				fn({
					...t,
					put: (store, value) => {
						if (store === "outbox") throw new Error("outbox full");
						return t.put(store, value);
					},
				}),
			);
		};
		try {
			await expect(db.put("tasks", { id: "t1", title: "A" })).rejects.toThrow(
				"outbox full",
			);
		} finally {
			raw.transact = transact;
		}
		expect(await raw.get("tasks", "t1")).toBeUndefined();
		expect(storeLists[0]).toEqual(expect.arrayContaining(["tasks", "outbox"]));
	});

	it("does not queue a settings write that only changed the theme", async () => {
		const { raw, db } = await setup("account");
		await raw.put("settings", {
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "dark",
			updatedAt: "2026-09-01T00:00:00.000Z",
		});
		await db.put("settings", {
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "light",
		});
		expect(await raw.getAll("outbox")).toEqual([]);
		const row = await raw.get("settings", "app");
		expect(row?.theme).toBe("light");
		// Unchanged, so it can't beat a newer quiet-hours edit from another device.
		expect(row?.updatedAt).toBe("2026-09-01T00:00:00.000Z");
	});

	it("queues a settings write that changed quiet hours, with a fresh updatedAt", async () => {
		const { raw, db } = await setup("account");
		await raw.put("settings", {
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "dark",
			updatedAt: "2026-09-01T00:00:00.000Z",
		});
		await db.put("settings", {
			id: "app",
			quietStart: 22,
			quietEnd: 7,
			theme: "dark",
		});
		expect((await raw.get("settings", "app"))?.updatedAt).toBe(
			T0.toISOString(),
		);
		expect(await raw.get("outbox", "settings:app")).toBeDefined();
	});

	it("stamps the first settings row (the seed) with EPOCH so it never wins", async () => {
		const { raw, db } = await setup("account");
		await db.put("settings", { id: "app", quietStart: 23, quietEnd: 7 });
		expect((await raw.get("settings", "app"))?.updatedAt).toBe(EPOCH);
		expect(await raw.getAll("outbox")).toEqual([]);
	});
});

describe("createSyncingDb: local mode", () => {
	it("stamps updatedAt and queues nothing", async () => {
		const { raw, db, queued } = await setup("local");
		await db.put("tasks", { id: "t1", title: "A" });
		await db.delete("areas", "a1");
		expect((await raw.get("tasks", "t1"))?.updatedAt).toBe(T0.toISOString());
		expect(await raw.getAll("outbox")).toEqual([]);
		expect(queued()).toBe(0);
	});

	it("treats a missing meta record as local mode", async () => {
		const raw = (await openDB(`ignite-test-${crypto.randomUUID()}`)) as Db;
		handles.push(raw);
		const db = createSyncingDb(raw);
		await db.put("tasks", { id: "t1", title: "A" });
		expect(await raw.getAll("outbox")).toEqual([]);
	});

	it("passes reads straight through", async () => {
		const { raw, db } = await setup("local");
		await raw.put("tasks", { id: "t1", title: "A", sectionId: "s1" });
		expect((await db.get("tasks", "t1"))?.title).toBe("A");
		expect(await db.getByIndex("tasks", "sectionId", "s1")).toHaveLength(1);
	});
});
