// The one place a test under api/ imports from src/: it proves the client's
// wire records and the server's schemas describe the same thing.

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { EPOCH, STORES, type Store } from "../../shared/protocol.ts";
import { toWire } from "../../src/sync/records.ts";
import { tableFor } from "../src/records.ts";
import { parseChange } from "../src/validate.ts";

// Rows as IndexedDB holds them today, including an old task written before
// hasTime, leadTime and scheduledTags existed, and the seeded rows.
const STORED: Record<Store, Record<string, unknown>[]> = {
	areas: [
		{ id: "focus", name: "Focus", icon: "🔥", critical: false, order: 0 },
		{
			id: "a1",
			name: "Home",
			icon: "",
			critical: true,
			order: 1,
			updatedAt: "2026-09-01T10:00:00.000Z",
		},
	],
	sections: [
		{
			id: "focus-default",
			areaId: "focus",
			name: "Tasks",
			collapsed: false,
			order: 0,
		},
	],
	tasks: [
		{
			id: "t-old",
			sectionId: "s1",
			title: "Old",
			completed: 0,
			starred: 0,
			critical: 0,
			dueAt: null,
			order: 3,
			createdAt: "2026-04-20T10:00:00.000Z",
		},
		{
			id: "t-new",
			sectionId: "focus-default",
			title: "New",
			notes: "n",
			completed: 1,
			starred: 1,
			critical: 0,
			dueAt: "2026-10-01T08:00:00.000Z",
			hasTime: 1,
			recurrence: { type: "monthly", interval: 1, day: 31 },
			lastCompletedAt: "2026-09-01T08:00:00.000Z",
			completedCount: 2,
			leadTime: 15,
			scheduledTags: ["x"],
			createdAt: "2026-01-01T00:00:00.000Z",
			order: 4,
			updatedAt: "2026-09-02T00:00:00.000Z",
		},
	],
	settings: [
		{
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "system",
			sidebarCollapsed: false,
			updatedAt: EPOCH,
		},
	],
};

describe("toWire output is exactly what the server accepts", () => {
	for (const store of STORES) {
		for (const row of STORED[store]) {
			it(`${store} ${row.id}`, () => {
				const record = toWire(store, row);
				const parsed = parseChange({ store, id: row.id, op: "put", record });
				expect(parsed).toEqual({
					ok: true,
					change: { store, id: row.id, op: "put", record },
				});
			});
		}
	}
});

describe("toWire's fields are exactly the table's columns", () => {
	for (const store of STORES) {
		it(store, () => {
			const columns = Object.keys(getTableColumns(tableFor(store)))
				.filter((key) => key !== "userId" && key !== "serverSeq")
				.sort();
			const fields = Object.keys(toWire(store, { id: "x" })).sort();
			expect(fields).toEqual(columns);
		});
	}
});
