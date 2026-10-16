import { describe, expect, it } from "vitest";
import type { PulledChange } from "../../shared/protocol.ts";
import type { Database } from "../src/db.ts";
import { handlePull, pageOf } from "../src/pull.ts";

const row = (seq: number): PulledChange => ({
	store: "tasks",
	id: `t${seq}`,
	seq,
	kind: "row",
	record: { id: `t${seq}` },
});
const tomb = (seq: number): PulledChange => ({
	store: "areas",
	id: `a${seq}`,
	seq,
	kind: "tombstone",
	deletedAt: "2026-01-01T00:00:00.000Z",
});

describe("pageOf", () => {
	it("merges the tables oldest first and cuts at the limit", () => {
		const page = pageOf([row(5), tomb(2), row(9), tomb(7)], 3, 0);
		expect(page.changes.map((c) => c.seq)).toEqual([2, 5, 7]);
		expect(page.cursor).toBe(7);
		expect(page.more).toBe(true);
	});

	it("says there is no more when everything fits", () => {
		const page = pageOf([row(4), row(3)], 3, 0);
		expect(page.changes.map((c) => c.seq)).toEqual([3, 4]);
		expect(page.more).toBe(false);
	});

	it("keeps the cursor where it was when nothing is new", () => {
		expect(pageOf([], 500, 42)).toEqual({
			changes: [],
			cursor: 42,
			more: false,
		});
	});
});

describe("handlePull parameters", () => {
	// Refused before the database is touched, so no database is needed.
	const db = {} as Database;
	const url = (query: string) =>
		new URL(`https://ignite.test/api/sync/pull?${query}`);

	it("answers 426 to another protocol, or none", async () => {
		expect((await handlePull(db, "u1", url("since=0&protocol=2"))).status).toBe(
			426,
		);
		expect((await handlePull(db, "u1", url("since=0"))).status).toBe(426);
	});

	it("answers 400 to a since that isn't a whole number", async () => {
		for (const since of ["", "-1", "1.5", "abc", "1e3", "9".repeat(16)]) {
			const res = await handlePull(db, "u1", url(`since=${since}&protocol=1`));
			expect(res.status).toBe(400);
		}
		expect((await handlePull(db, "u1", url("protocol=1"))).status).toBe(400);
	});
});
