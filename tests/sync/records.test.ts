import { describe, expect, it } from "vitest";
import { EPOCH } from "../../shared/protocol";
import { fromWire, mergeSettings, toWire } from "../../src/sync/records";

const storedTask = {
	id: "t1",
	sectionId: "s1",
	title: "A",
	notes: "n",
	completed: 0,
	starred: 1,
	critical: 0,
	dueAt: "2026-10-01T08:00:00.000Z",
	hasTime: 1,
	recurrence: { type: "daily", interval: 1 },
	lastCompletedAt: null,
	completedCount: 2,
	leadTime: 15,
	scheduledTags: ["x"],
	createdAt: "2026-01-01T00:00:00.000Z",
	order: 4,
	updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("toWire", () => {
	it("turns the task model's 0/1 flags into booleans", () => {
		const wire = toWire("tasks", storedTask);
		expect(wire.completed).toBe(false);
		expect(wire.starred).toBe(true);
		expect(wire.hasTime).toBe(true);
	});

	it("drops fields the server does not know", () => {
		const wire = toWire("areas", {
			id: "a1",
			name: "Home",
			icon: "",
			critical: false,
			order: 0,
			updatedAt: "2026-01-02T00:00:00.000Z",
			legacyField: "x",
		});
		expect(wire).not.toHaveProperty("legacyField");
	});

	it("fills defaults for a task written before hasTime, leadTime and scheduledTags existed", () => {
		const wire = toWire("tasks", {
			id: "t1",
			sectionId: "s1",
			title: "Old",
			completed: 0,
			starred: 0,
			critical: 0,
			dueAt: null,
			order: 3,
			createdAt: "2026-04-20T10:00:00.000Z",
		});
		expect(wire).toMatchObject({
			notes: "",
			hasTime: false,
			recurrence: null,
			lastCompletedAt: null,
			completedCount: 0,
			leadTime: 0,
			scheduledTags: [],
			updatedAt: EPOCH,
		});
	});

	it("sends only the synced settings fields", () => {
		const wire = toWire("settings", {
			id: "app",
			quietStart: 22,
			quietEnd: 6,
			theme: "dark",
			sidebarCollapsed: true,
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
		expect(wire).toEqual({
			id: "app",
			quietStart: 22,
			quietEnd: 6,
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
	});
});

describe("fromWire", () => {
	it("turns task booleans back into 0/1 for IndexedDB", () => {
		const row = fromWire("tasks", {
			id: "t1",
			completed: true,
			starred: false,
			critical: false,
			hasTime: true,
		});
		expect(row).toMatchObject({
			completed: 1,
			starred: 0,
			critical: 0,
			hasTime: 1,
		});
	});

	it("round-trips a stored task unchanged", () => {
		expect(fromWire("tasks", toWire("tasks", storedTask))).toEqual(storedTask);
	});
});

describe("mergeSettings", () => {
	it("takes only the quiet hours and updatedAt from the account", () => {
		const local = {
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "light",
			sidebarCollapsed: true,
			updatedAt: EPOCH,
		};
		const merged = mergeSettings(local, {
			id: "app",
			quietStart: 21,
			quietEnd: 8,
			updatedAt: "2026-02-01T00:00:00.000Z",
		});
		expect(merged).toEqual({
			id: "app",
			quietStart: 21,
			quietEnd: 8,
			theme: "light",
			sidebarCollapsed: true,
			updatedAt: "2026-02-01T00:00:00.000Z",
		});
	});
});
