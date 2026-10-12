import { describe, expect, it } from "vitest";
import type { Row } from "../../shared/protocol.ts";
import { planPush } from "../src/push.ts";
import type { ParsedChange } from "../src/validate.ts";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const at = (hour: number) => new Date(Date.UTC(2026, 8, 1, hour)).toISOString();

const record = (id: string, updatedAt: string, title = "A"): Row => ({
	id,
	title,
	updatedAt,
});
const put = (id: string, updatedAt: string, title?: string): ParsedChange => ({
	ok: true,
	change: {
		store: "tasks",
		id,
		op: "put",
		record: record(id, updatedAt, title),
	},
});
const del = (id: string, deletedAt: string): ParsedChange => ({
	ok: true,
	change: { store: "tasks", id, op: "delete", deletedAt },
});
const bad = (store: "tasks" | null, id: string | null): ParsedChange => ({
	ok: false,
	store,
	id,
});

const noRows = new Map<string, Row>();
const noTombs = new Map<string, string>();

describe("planPush: puts", () => {
	it("accepts a key the server has never seen", () => {
		const plan = planPush([put("t1", at(1))], noRows, noTombs, NOW);
		expect(plan.upserts).toEqual([
			{ store: "tasks", record: record("t1", at(1)) },
		]);
		expect(plan.response).toEqual({
			accepted: ["tasks:t1"],
			lost: [],
			invalid: [],
		});
	});

	it("accepts a newer edit", () => {
		const rows = new Map([["tasks:t1", record("t1", at(1), "old")]]);
		const plan = planPush([put("t1", at(2), "new")], rows, noTombs, NOW);
		expect(plan.upserts).toHaveLength(1);
		expect(plan.response.accepted).toEqual(["tasks:t1"]);
	});

	it("loses to a newer row and hands the winner back", () => {
		const winner = record("t1", at(2), "theirs");
		const rows = new Map([["tasks:t1", winner]]);
		const plan = planPush([put("t1", at(1), "mine")], rows, noTombs, NOW);
		expect(plan.upserts).toEqual([]);
		expect(plan.response.lost).toEqual([
			{ store: "tasks", id: "t1", kind: "row", record: winner },
		]);
	});

	it("loses a retried push (equal time) with an identical row", () => {
		const stored = record("t1", at(1));
		const rows = new Map([["tasks:t1", stored]]);
		const plan = planPush([put("t1", at(1))], rows, noTombs, NOW);
		expect(plan.response.lost).toEqual([
			{ store: "tasks", id: "t1", kind: "row", record: stored },
		]);
	});

	it("brings a deleted task back when the edit is newer than the delete", () => {
		const tombs = new Map([["tasks:t1", at(1)]]);
		const plan = planPush([put("t1", at(2))], noRows, tombs, NOW);
		expect(plan.upserts).toHaveLength(1);
		expect(plan.clearTombstones).toEqual([{ store: "tasks", id: "t1" }]);
		expect(plan.response.accepted).toEqual(["tasks:t1"]);
	});

	it("loses to a newer delete and hands the tombstone back", () => {
		const tombs = new Map([["tasks:t1", at(2)]]);
		const plan = planPush([put("t1", at(1))], noRows, tombs, NOW);
		expect(plan.upserts).toEqual([]);
		expect(plan.response.lost).toEqual([
			{ store: "tasks", id: "t1", kind: "tombstone", deletedAt: at(2) },
		]);
	});

	it("clamps a time from a fast clock before deciding and before storing", () => {
		const plan = planPush(
			[put("t1", "2099-01-01T00:00:00.000Z")],
			noRows,
			noTombs,
			NOW,
		);
		expect(plan.upserts[0].record.updatedAt).toBe("2026-10-01T12:00:05.000Z");
	});
});

describe("planPush: deletes", () => {
	it("deletes a row with a newer delete and writes a tombstone", () => {
		const rows = new Map([["tasks:t1", record("t1", at(1))]]);
		const plan = planPush([del("t1", at(2))], rows, noTombs, NOW);
		expect(plan.deletes).toEqual([
			{ store: "tasks", id: "t1", deletedAt: at(2) },
		]);
		expect(plan.response.accepted).toEqual(["tasks:t1"]);
	});

	it("loses a delete older than the stored edit", () => {
		const winner = record("t1", at(2));
		const rows = new Map([["tasks:t1", winner]]);
		const plan = planPush([del("t1", at(1))], rows, noTombs, NOW);
		expect(plan.deletes).toEqual([]);
		expect(plan.response.lost).toEqual([
			{ store: "tasks", id: "t1", kind: "row", record: winner },
		]);
	});

	it("writes a tombstone for a key the server has never seen", () => {
		const plan = planPush([del("t1", at(1))], noRows, noTombs, NOW);
		expect(plan.deletes).toEqual([
			{ store: "tasks", id: "t1", deletedAt: at(1) },
		]);
	});
});

describe("planPush: invalid changes", () => {
	it("reports the server's row for an invalid change", () => {
		const stored = record("t1", at(1));
		const rows = new Map([["tasks:t1", stored]]);
		const plan = planPush([bad("tasks", "t1")], rows, noTombs, NOW);
		expect(plan.response.invalid).toEqual([
			{ store: "tasks", id: "t1", kind: "row", record: stored },
		]);
	});

	it("reports none when the server holds nothing for the key", () => {
		const plan = planPush([bad("tasks", "t1")], noRows, noTombs, NOW);
		expect(plan.response.invalid).toEqual([
			{ store: "tasks", id: "t1", kind: "none" },
		]);
	});

	it("drops a change with no readable key", () => {
		const plan = planPush(
			[bad(null, "t1"), bad("tasks", null)],
			noRows,
			noTombs,
			NOW,
		);
		expect(plan.response).toEqual({ accepted: [], lost: [], invalid: [] });
	});

	it("refuses every copy of a key sent twice, and reports it once", () => {
		const plan = planPush(
			[put("t1", at(1)), put("t2", at(1)), del("t1", at(2))],
			noRows,
			noTombs,
			NOW,
		);
		expect(plan.upserts.map((u) => u.record.id)).toEqual(["t2"]);
		expect(plan.deletes).toEqual([]);
		expect(plan.response.accepted).toEqual(["tasks:t2"]);
		expect(plan.response.invalid).toEqual([
			{ store: "tasks", id: "t1", kind: "none" },
		]);
	});
});
