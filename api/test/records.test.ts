import { describe, expect, it } from "vitest";
import { recordToRow, rowToRecord, tableFor } from "../src/records.ts";
import { areas, sections, settings, tasks } from "../src/schema.ts";

describe("tableFor", () => {
	it("hands back the real table object for each store", () => {
		expect(tableFor("areas")).toBe(areas as unknown);
		expect(tableFor("sections")).toBe(sections as unknown);
		expect(tableFor("tasks")).toBe(tasks);
		expect(tableFor("settings")).toBe(settings as unknown);
	});
});

describe("rowToRecord", () => {
	it("drops the owner and the sequence, and writes dates as ISO strings", () => {
		const record = rowToRecord({
			userId: "u1",
			id: "t1",
			title: "A",
			dueAt: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-02T03:04:05.678Z"),
			serverSeq: 42,
		});
		expect(record).toEqual({
			id: "t1",
			title: "A",
			dueAt: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T03:04:05.678Z",
		});
	});
});

describe("recordToRow", () => {
	it("adds the owner from the session and turns ISO strings into dates", () => {
		const row = recordToRow("u1", {
			id: "t1",
			dueAt: "2026-10-01T08:00:00.000Z",
			lastCompletedAt: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
		expect(row.userId).toBe("u1");
		expect(row.dueAt).toEqual(new Date("2026-10-01T08:00:00.000Z"));
		expect(row.lastCompletedAt).toBeNull();
		expect(row.updatedAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
	});

	it("round-trips through rowToRecord unchanged", () => {
		const record = {
			id: "a1",
			name: "Home",
			icon: "🔥",
			critical: false,
			order: 2,
			updatedAt: "2026-01-02T00:00:00.000Z",
		};
		expect(rowToRecord({ ...recordToRow("u1", record), serverSeq: 7 })).toEqual(
			record,
		);
	});
});
