import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type Change,
	PROTOCOL_VERSION,
	type PullResponse,
	type PushResponse,
	type Row,
} from "../../../shared/protocol.ts";
import { readSince } from "../../src/pull.ts";
import { handlePush } from "../../src/push.ts";
import { tasks, tombstones } from "../../src/schema.ts";
import { call, deleteUsers, signUp, withDb } from "./helpers.ts";

const A = "pull-a@ignite.test";
const B = "pull-b@ignite.test";
const C = "pull-c@ignite.test";
let a: { userId: string; cookie: string };
let b: { userId: string; cookie: string };
let c: { userId: string; cookie: string };

beforeAll(async () => {
	await deleteUsers([A, B, C]);
	a = await signUp(A);
	b = await signUp(B);
	c = await signUp(C);
});
afterAll(() => deleteUsers([A, B, C]));

const AT = "2026-01-01T08:00:00.000Z";

const taskRecord = (id: string, title: string): Row => ({
	id,
	sectionId: "focus-default",
	title,
	notes: "Pulled back exactly as sent",
	completed: true,
	starred: false,
	critical: true,
	dueAt: "2026-10-01T08:00:00.000Z",
	hasTime: true,
	recurrence: { type: "yearly", interval: 1, month: 10, day: 1 },
	lastCompletedAt: AT,
	completedCount: 1,
	leadTime: 15,
	scheduledTags: ["x"],
	createdAt: AT,
	order: 1,
	updatedAt: AT,
});
const put = (record: Row): Change => ({
	store: "tasks",
	id: String(record.id),
	op: "put",
	record,
});

async function push(userId: string, changes: Change[]): Promise<PushResponse> {
	return withDb(async (db) => {
		const res = await handlePush(db, userId, {
			protocol: PROTOCOL_VERSION,
			changes,
		});
		return res.json as PushResponse;
	});
}

describe("pull", () => {
	it("returns a row the moment it was pushed, exactly as sent", async () => {
		const record = taskRecord(crypto.randomUUID(), "Fresh");
		const pushed = await call("/api/sync/push", {
			body: { protocol: PROTOCOL_VERSION, changes: [put(record)] },
			cookie: a.cookie,
		});
		expect(pushed.status).toBe(200);

		const res = await call(
			`/api/sync/pull?since=0&protocol=${PROTOCOL_VERSION}`,
			{
				cookie: a.cookie,
				origin: null,
			},
		);
		expect(res.status).toBe(200);
		const page = (await res.json()) as PullResponse;
		const found = page.changes.find((ch) => ch.id === record.id);
		expect(found).toMatchObject({ store: "tasks", kind: "row", record });
		expect(page.cursor).toBeGreaterThanOrEqual(
			found?.seq ?? Number.POSITIVE_INFINITY,
		);
	});

	it("never shows one user's rows to another", async () => {
		const id = crypto.randomUUID();
		await push(a.userId, [put(taskRecord(id, "A's only"))]);
		const page = await withDb((db) => readSince(db, b.userId, 0));
		expect(page.changes.some((ch) => ch.id === id)).toBe(false);
	});

	it("pages with more, oldest first, and includes tombstones", async () => {
		const ids = [1, 2, 3, 4].map(() => crypto.randomUUID());
		await push(
			c.userId,
			ids.map((id, i) => put(taskRecord(id, `Task ${i}`))),
		);
		await push(c.userId, [
			{
				store: "tasks",
				id: ids[0],
				op: "delete",
				deletedAt: "2026-01-02T00:00:00.000Z",
			},
		]);

		// Visible now: three rows and one tombstone (the deleted row is gone).
		const seen: { id: string; kind: string; seq: number }[] = [];
		let since = 0;
		let pages = 0;
		for (;;) {
			const page = await withDb((db) => readSince(db, c.userId, since, 3));
			pages++;
			for (const ch of page.changes)
				seen.push({ id: ch.id, kind: ch.kind, seq: ch.seq });
			expect(page.cursor).toBeGreaterThanOrEqual(since);
			since = page.cursor;
			if (!page.more) break;
		}

		expect(pages).toBe(2);
		expect(seen.map((s) => s.seq)).toEqual(
			[...seen.map((s) => s.seq)].sort((x, y) => x - y),
		);
		expect(
			seen
				.filter((s) => s.kind === "row")
				.map((s) => s.id)
				.sort(),
		).toEqual(ids.slice(1).sort());
		expect(seen.filter((s) => s.kind === "tombstone").map((s) => s.id)).toEqual(
			[ids[0]],
		);
	});

	it("reads one snapshot, so a push between two reads is never skipped", async () => {
		const kept = crypto.randomUUID();
		const deleted = crypto.randomUUID();
		await push(b.userId, [put(taskRecord(deleted, "Deleted mid-pull"))]);

		const page = await withDb((db) =>
			readSince(db, b.userId, 0, undefined, {
				// Commits on a second connection after the data tables were read and
				// before the tombstones are: a new task, then a delete.
				afterRows: async () => {
					await push(b.userId, [put(taskRecord(kept, "Pushed mid-pull"))]);
					await push(b.userId, [
						{
							store: "tasks",
							id: deleted,
							op: "delete",
							deletedAt: "2026-01-02T00:00:00.000Z",
						},
					]);
				},
			}),
		);

		// Every change at or below the cursor must be in the page, or the next
		// pull starts after it and the device never sees it.
		const seqs = await withDb(async (db) => {
			const rows = await db
				.select({ seq: tasks.serverSeq })
				.from(tasks)
				.where(eq(tasks.userId, b.userId));
			const tombs = await db
				.select({ seq: tombstones.serverSeq })
				.from(tombstones)
				.where(eq(tombstones.userId, b.userId));
			return [...rows, ...tombs].map((r) => r.seq);
		});
		const returned = new Set(page.changes.map((ch) => ch.seq));
		expect(
			seqs.filter((seq) => seq <= page.cursor && !returned.has(seq)),
		).toEqual([]);
	});

	it("answers 400 to a bad cursor and 426 to another protocol", async () => {
		expect(
			(await call("/api/sync/pull?since=abc&protocol=1", { cookie: a.cookie }))
				.status,
		).toBe(400);
		expect(
			(await call("/api/sync/pull?since=0&protocol=2", { cookie: a.cookie }))
				.status,
		).toBe(426);
	});
});
