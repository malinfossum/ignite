import { describe, expect, it } from "vitest";
import { focusCounts, focusSectionIds } from "../../src/utils/focus-counts.js";

const NOW = new Date("2026-04-28T14:00:00");

const section = (overrides) => ({
	id: "s1",
	areaId: "focus",
	name: "Tasks",
	collapsed: false,
	order: 0,
	...overrides,
});

const task = (overrides) => ({
	id: "t1",
	sectionId: "s1",
	title: "Test task",
	notes: "",
	completed: false,
	starred: false,
	critical: false,
	dueAt: null,
	hasTime: false,
	recurrence: null,
	leadTime: 0,
	scheduledTags: [],
	createdAt: "2026-04-28T08:00:00.000Z",
	order: 0,
	...overrides,
});

describe("focusSectionIds", () => {
	it("returns every section belonging to the focus area", () => {
		const sections = [
			section({ id: "a" }),
			section({ id: "b" }),
			section({ id: "c", areaId: "work" }),
		];
		expect(focusSectionIds(sections, "focus")).toEqual(["a", "b"]);
	});

	it("returns an empty array when no section matches", () => {
		expect(focusSectionIds([section({ areaId: "work" })], "focus")).toEqual([]);
	});

	it("returns an empty array for an empty section list", () => {
		expect(focusSectionIds([], "focus")).toEqual([]);
	});
});

describe("focusCounts", () => {
	it("counts overdue and due-today separately and sums them into attention", () => {
		const sections = [section({ id: "s1" })];
		const tasks = [
			task({ id: "t1", dueAt: "2026-04-27T09:00:00.000Z" }),
			task({ id: "t2", dueAt: "2026-04-28T09:00:00.000Z" }),
			task({ id: "t3", dueAt: "2026-04-28T18:00:00.000Z" }),
		];
		const result = focusCounts(sections, tasks, NOW, "focus");
		expect(result.overdue).toBe(1);
		expect(result.dueToday).toBe(2);
		expect(result.attention).toBe(3);
	});

	it("ignores completed tasks", () => {
		const sections = [section({ id: "s1" })];
		const tasks = [
			task({ id: "t1", dueAt: "2026-04-28T09:00:00.000Z", completed: true }),
		];
		expect(focusCounts(sections, tasks, NOW, "focus").attention).toBe(0);
	});

	it("returns zeroes when there are no sections and no tasks", () => {
		const result = focusCounts([], [], NOW, "focus");
		expect(result.sectionIds).toEqual([]);
		expect(result.overdue).toBe(0);
		expect(result.dueToday).toBe(0);
		expect(result.attention).toBe(0);
	});

	it("exposes the same groups object groupTasksForFocus produces", () => {
		const sections = [section({ id: "s1" })];
		const tasks = [task({ id: "t1", starred: true })];
		const result = focusCounts(sections, tasks, NOW, "focus");
		expect(result.groups.starred).toHaveLength(1);
		expect(result.groups.starred[0].id).toBe("t1");
	});
});
