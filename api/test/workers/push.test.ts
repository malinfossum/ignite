import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type Change,
	MAX_BODY_BYTES,
	MAX_CHANGES,
	PROTOCOL_VERSION,
	type PushResponse,
	type Row,
} from "../../../shared/protocol.ts";
import { connect } from "../../src/db.ts";
import { handlePush } from "../../src/push.ts";
import { tasks, tombstones } from "../../src/schema.ts";
import { call, deleteUsers, signUp, testEnv, withDb } from "./helpers.ts";

const A = "push-a@ignite.test";
const B = "push-b@ignite.test";
let a: { userId: string; cookie: string };
let b: { userId: string; cookie: string };

beforeAll(async () => {
	await deleteUsers([A, B]);
	a = await signUp(A);
	b = await signUp(B);
});
afterAll(() => deleteUsers([A, B]));

const at = (minute: number) =>
	new Date(Date.UTC(2026, 0, 1, 8, minute)).toISOString();

const taskRecord = (id: string, title: string, updatedAt: string): Row => ({
	id,
	sectionId: "focus-default",
	title,
	notes: "",
	completed: false,
	starred: false,
	critical: false,
	dueAt: null,
	hasTime: false,
	recurrence: { type: "weekly", interval: 1, weekdays: [1, 3] },
	lastCompletedAt: null,
	completedCount: 0,
	leadTime: 0,
	scheduledTags: [],
	createdAt: at(0),
	order: 0,
	updatedAt,
});
const put = (record: Row): Change => ({
	store: "tasks",
	id: String(record.id),
	op: "put",
	record,
});
const del = (id: string, deletedAt: string): Change => ({
	store: "tasks",
	id,
	op: "delete",
	deletedAt,
});

async function push(userId: string, changes: Change[]): Promise<PushResponse> {
	return withDb(async (db) => {
		const res = await handlePush(db, userId, {
			protocol: PROTOCOL_VERSION,
			changes,
		});
		expect(res.status).toBe(200);
		return res.json as PushResponse;
	});
}

describe("push against Neon dev", () => {
	it("never lets user A overwrite user B's row with the same id", async () => {
		const id = `shared-${crypto.randomUUID()}`;
		await push(b.userId, [put(taskRecord(id, "B's task", at(1)))]);
		const res = await push(a.userId, [put(taskRecord(id, "A's task", at(2)))]);
		expect(res.accepted).toEqual([`tasks:${id}`]);

		const rows = await withDb((db) =>
			db
				.select({ userId: tasks.userId, title: tasks.title })
				.from(tasks)
				.where(eq(tasks.id, id)),
		);
		const titles = new Map(rows.map((r) => [r.userId, r.title]));
		expect(titles.get(b.userId)).toBe("B's task");
		expect(titles.get(a.userId)).toBe("A's task");
	});

	it("answers a retried push with lost and an identical row", async () => {
		const record = taskRecord(crypto.randomUUID(), "Once", at(3));
		expect((await push(a.userId, [put(record)])).accepted).toHaveLength(1);
		const retry = await push(a.userId, [put(record)]);
		expect(retry.accepted).toEqual([]);
		expect(retry.lost).toEqual([
			{ store: "tasks", id: record.id, kind: "row", record },
		]);
	});

	it("brings a task back when an edit is newer than its delete", async () => {
		const id = crypto.randomUUID();
		await push(a.userId, [put(taskRecord(id, "First", at(1)))]);
		expect((await push(a.userId, [del(id, at(2))])).accepted).toEqual([
			`tasks:${id}`,
		]);
		const back = await push(a.userId, [put(taskRecord(id, "Back", at(3)))]);
		expect(back.accepted).toEqual([`tasks:${id}`]);

		await withDb(async (db) => {
			const rows = await db
				.select({ title: tasks.title })
				.from(tasks)
				.where(and(eq(tasks.userId, a.userId), eq(tasks.id, id)));
			const tombs = await db
				.select()
				.from(tombstones)
				.where(and(eq(tombstones.userId, a.userId), eq(tombstones.id, id)));
			expect(rows).toEqual([{ title: "Back" }]);
			expect(tombs).toEqual([]);
		});
	});

	it("clamps a fast clock to server time plus 5 seconds", async () => {
		const id = crypto.randomUUID();
		const before = Date.now();
		await push(a.userId, [
			put(taskRecord(id, "Fast clock", "2099-01-01T00:00:00.000Z")),
		]);
		const [row] = await withDb((db) =>
			db
				.select({ updatedAt: tasks.updatedAt })
				.from(tasks)
				.where(and(eq(tasks.userId, a.userId), eq(tasks.id, id))),
		);
		expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
		expect(row.updatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
	});

	it("reports an invalid change with the server's version and applies the rest", async () => {
		const good = taskRecord(crypto.randomUUID(), "Good", at(1));
		const res = await push(a.userId, [
			put(good),
			put({ ...taskRecord("bad-one", "Bad", at(1)), user_id: b.userId }),
		]);
		expect(res.accepted).toEqual([`tasks:${good.id}`]);
		expect(res.invalid).toEqual([
			{ store: "tasks", id: "bad-one", kind: "none" },
		]);
	});

	it("makes a second push wait while a first push's transaction holds the lock", async () => {
		const first = await connect(testEnv);
		const second = await connect(testEnv);
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let locked = () => {};
		const lockTaken = new Promise<void>((resolve) => {
			locked = resolve;
		});
		try {
			// Stands in for a push that is still inside its transaction.
			const holder = first.db.transaction(async (tx) => {
				await tx.execute(
					sql`select pg_advisory_xact_lock(hashtext(${a.userId}))`,
				);
				locked();
				await gate;
			});
			await lockTaken;

			let done = false;
			const pushing = handlePush(second.db, a.userId, {
				protocol: PROTOCOL_VERSION,
				changes: [put(taskRecord(crypto.randomUUID(), "Waits", at(1)))],
			}).then((res) => {
				done = true;
				return res;
			});

			await new Promise((resolve) => setTimeout(resolve, 750));
			expect(done).toBe(false);

			release();
			await holder;
			expect((await pushing).status).toBe(200);
			expect(done).toBe(true);
		} finally {
			release();
			await first.close();
			await second.close();
		}
	});
});

describe("push over HTTP", () => {
	const PUSH = "/api/sync/push";

	it("answers 426 to another protocol", async () => {
		const res = await call(PUSH, {
			body: { protocol: 2, changes: [] },
			cookie: a.cookie,
		});
		expect(res.status).toBe(426);
	});

	it("answers 413 to more than MAX_CHANGES changes", async () => {
		const changes = Array.from({ length: MAX_CHANGES + 1 }, () => ({}));
		const res = await call(PUSH, {
			body: { protocol: PROTOCOL_VERSION, changes },
			cookie: a.cookie,
		});
		expect(res.status).toBe(413);
	});

	it("answers 413 to a body over MAX_BODY_BYTES", async () => {
		const res = await call(PUSH, {
			raw: JSON.stringify({ padding: "x".repeat(MAX_BODY_BYTES) }),
			cookie: a.cookie,
		});
		expect(res.status).toBe(413);
	});

	it("answers 400 to a body that isn't JSON", async () => {
		const res = await call(PUSH, { raw: "{not json", cookie: a.cookie });
		expect(res.status).toBe(400);
	});

	it("applies a real push end to end", async () => {
		const record = taskRecord(crypto.randomUUID(), "Over HTTP", at(4));
		const res = await call(PUSH, {
			body: { protocol: PROTOCOL_VERSION, changes: [put(record)] },
			cookie: a.cookie,
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as PushResponse).accepted).toEqual([
			`tasks:${record.id}`,
		]);
	});

	it("answers 200 to a NUL in a title, with only that change invalid", async () => {
		// Postgres text refuses a NUL. Without validate.ts's check this push
		// would fail as a whole with a 500, and the queue would jam on it.
		const good = taskRecord(crypto.randomUUID(), "Good", at(5));
		const bad = taskRecord(crypto.randomUUID(), "Ring\u0000", at(5));
		const res = await call(PUSH, {
			body: { protocol: PROTOCOL_VERSION, changes: [put(good), put(bad)] },
			cookie: a.cookie,
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as PushResponse;
		expect(json.accepted).toEqual([`tasks:${good.id}`]);
		expect(json.invalid).toEqual([
			{ store: "tasks", id: bad.id, kind: "none" },
		]);
	});
});
