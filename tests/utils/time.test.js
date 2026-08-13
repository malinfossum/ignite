import { describe, expect, it } from "vitest";
import {
	formatDueSummary,
	formatOccurrenceLabel,
	formatTimeLabel,
	groupTasksForToday,
	pickNextTask,
	sortByDueThenUntimed,
} from "../../src/utils/time.js";

const NOW = new Date("2026-04-28T14:00:00");
// Helper: build a task with sensible defaults.
const task = (overrides) => ({
	id: "t1",
	sectionId: "focus-default",
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

describe("formatTimeLabel", () => {
	it("returns 'now' for dueAt within the next minute", () => {
		const dueAt = new Date(NOW.getTime() + 30_000).toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("now");
	});

	it("returns 'in N min' for dueAt within the next hour", () => {
		const dueAt = new Date(NOW.getTime() + 45 * 60_000).toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("in 45 min");
	});

	it("returns the time of day for dueAt later today (24h)", () => {
		const dueAt = new Date("2026-04-28T18:30:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("18:30");
	});

	it("returns 'was HH:MM' for dueAt earlier today", () => {
		const dueAt = new Date("2026-04-28T09:00:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("was 09:00");
	});

	it("returns 'Tomorrow HH:MM' for dueAt tomorrow", () => {
		const dueAt = new Date("2026-04-29T09:00:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("Tomorrow 09:00");
	});

	it("returns 'Ddd HH:MM' for dueAt within the next 7 days", () => {
		const dueAt = new Date("2026-05-01T09:00:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("Fri 09:00");
	});

	it("returns 'Mon DD · HH:MM' for dueAt beyond 7 days", () => {
		const dueAt = new Date("2026-05-15T09:00:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW)).toBe("May 15 · 09:00");
	});

	it("respects 12-hour format when requested", () => {
		const dueAt = new Date("2026-04-28T18:30:00").toISOString();
		expect(formatTimeLabel(dueAt, NOW, "12h")).toBe("6:30 PM");
	});
});

describe("groupTasksForToday", () => {
	it("partitions tasks into overdue, today, and starred", () => {
		const tasks = [
			task({ id: "a", dueAt: "2026-04-27T09:00:00.000Z" }), // overdue (yesterday)
			task({ id: "b", dueAt: "2026-04-28T18:00:00.000Z" }), // today
			task({ id: "c", starred: true, dueAt: null }), // starred undated
			task({ id: "d", dueAt: "2026-05-10T09:00:00.000Z" }), // future, ignored
		];
		const result = groupTasksForToday(tasks, NOW);
		expect(result.overdue.map((t) => t.id)).toEqual(["a"]);
		expect(result.today.map((t) => t.id)).toEqual(["b"]);
		expect(result.starred.map((t) => t.id)).toEqual(["c"]);
	});

	it("excludes completed tasks from every group", () => {
		const tasks = [
			task({ id: "a", completed: true, dueAt: "2026-04-27T09:00:00.000Z" }),
			task({ id: "b", completed: true, dueAt: "2026-04-28T18:00:00.000Z" }),
			task({ id: "c", completed: true, starred: true }),
		];
		const result = groupTasksForToday(tasks, NOW);
		expect(result.overdue).toEqual([]);
		expect(result.today).toEqual([]);
		expect(result.starred).toEqual([]);
	});

	it("keeps same-day past-due tasks in Today (with 'was' label), not Overdue", () => {
		const tasks = [task({ id: "a", dueAt: "2026-04-28T09:00:00.000Z" })];
		const result = groupTasksForToday(tasks, NOW);
		expect(result.overdue).toEqual([]);
		expect(result.today.map((t) => t.id)).toEqual(["a"]);
	});

	it("sorts today by dueAt ascending and starred by order ascending", () => {
		// Both dated tasks are TIMED: sorting by clock time is only meaningful
		// for tasks that carry one. Untimed peers sort by createdAt instead.
		const tasks = [
			task({ id: "b", dueAt: "2026-04-28T18:00:00.000Z", hasTime: true }),
			task({ id: "a", dueAt: "2026-04-28T16:00:00.000Z", hasTime: true }),
			task({ id: "z", starred: true, order: 2 }),
			task({ id: "y", starred: true, order: 0 }),
		];
		const result = groupTasksForToday(tasks, NOW);
		expect(result.today.map((t) => t.id)).toEqual(["a", "b"]);
		expect(result.starred.map((t) => t.id)).toEqual(["y", "z"]);
	});
});

describe("pickNextTask", () => {
	it("picks the earliest upcoming time-dated task", () => {
		const tasks = [
			task({ id: "a", dueAt: "2026-04-28T18:00:00.000Z" }),
			task({ id: "b", dueAt: "2026-04-28T16:00:00.000Z" }),
		];
		expect(pickNextTask(tasks, NOW)?.id).toBe("b");
	});

	it("falls back to oldest overdue when nothing is upcoming", () => {
		const tasks = [
			task({ id: "a", dueAt: "2026-04-26T09:00:00.000Z" }),
			task({ id: "b", dueAt: "2026-04-27T09:00:00.000Z" }),
		];
		expect(pickNextTask(tasks, NOW)?.id).toBe("a");
	});

	it("falls back to first starred undated when nothing is dated", () => {
		const tasks = [
			task({ id: "a", starred: true, order: 2 }),
			task({ id: "b", starred: true, order: 0 }),
		];
		expect(pickNextTask(tasks, NOW)?.id).toBe("b");
	});

	it("returns null on empty input", () => {
		expect(pickNextTask([], NOW)).toBeNull();
	});

	it("ignores completed tasks", () => {
		const tasks = [
			task({ id: "a", completed: true, dueAt: "2026-04-28T18:00:00.000Z" }),
			task({ id: "b", starred: true, order: 0 }),
		];
		expect(pickNextTask(tasks, NOW)?.id).toBe("b");
	});
});

describe("formatOccurrenceLabel", () => {
	const NOW = new Date("2026-04-28T14:00:00"); // Tue

	it("returns 'Today' for a dueAt on the same day", () => {
		expect(formatOccurrenceLabel("2026-04-28T00:00:00", NOW)).toBe("Today");
	});

	it("returns 'Tomorrow' for the next day", () => {
		expect(formatOccurrenceLabel("2026-04-29T00:00:00", NOW)).toBe("Tomorrow");
	});

	it("returns the short weekday for 2–6 days out", () => {
		// 2026-05-01 is a Friday, 3 days after Tue 2026-04-28
		expect(formatOccurrenceLabel("2026-05-01T00:00:00", NOW)).toBe("Fri");
	});

	it("returns 'Mon D' for a week or more out", () => {
		expect(formatOccurrenceLabel("2026-07-06T00:00:00", NOW)).toBe("Jul 6");
	});
});

describe("sortByDueThenUntimed", () => {
	const at = (iso, overrides) =>
		task({ dueAt: new Date(iso).toISOString(), hasTime: true, ...overrides });

	it("orders timed tasks ascending by time", () => {
		const list = [
			at("2026-04-28T16:00:00", { id: "late" }),
			at("2026-04-28T09:00:00", { id: "early" }),
		];
		expect(sortByDueThenUntimed(list).map((t) => t.id)).toEqual([
			"early",
			"late",
		]);
	});

	it("puts untimed tasks after every timed task, whatever the clock says", () => {
		// The untimed task is stored at 00:00 — earlier than both timed tasks.
		// It must still sort last: untimed means "sometime today", not midnight.
		const list = [
			at("2026-04-28T00:00:00", { id: "untimed", hasTime: false }),
			at("2026-04-28T16:00:00", { id: "late" }),
			at("2026-04-28T09:00:00", { id: "early" }),
		];
		expect(sortByDueThenUntimed(list).map((t) => t.id)).toEqual([
			"early",
			"late",
			"untimed",
		]);
	});

	it("breaks ties between untimed peers by createdAt ascending", () => {
		const list = [
			at("2026-04-28T00:00:00", {
				id: "newer",
				hasTime: false,
				createdAt: "2026-04-28T11:00:00.000Z",
			}),
			at("2026-04-28T00:00:00", {
				id: "older",
				hasTime: false,
				createdAt: "2026-04-28T08:00:00.000Z",
			}),
		];
		expect(sortByDueThenUntimed(list).map((t) => t.id)).toEqual([
			"older",
			"newer",
		]);
	});

	it("breaks ties between timed peers at the same minute by createdAt", () => {
		const list = [
			at("2026-04-28T09:00:00", {
				id: "newer",
				createdAt: "2026-04-28T11:00:00.000Z",
			}),
			at("2026-04-28T09:00:00", {
				id: "older",
				createdAt: "2026-04-28T08:00:00.000Z",
			}),
		];
		expect(sortByDueThenUntimed(list).map((t) => t.id)).toEqual([
			"older",
			"newer",
		]);
	});

	it("orders by calendar day before applying the untimed rule", () => {
		// The untimed-last rule is scoped to a single day. Across days, an older
		// untimed task must still sort above a newer timed one — otherwise the
		// oldest thing you have missed sits at the bottom of Overdue.
		const list = [
			at("2026-04-28T09:00:00", { id: "today-timed" }),
			at("2026-04-07T00:00:00", { id: "three-weeks-ago", hasTime: false }),
		];
		expect(sortByDueThenUntimed(list).map((t) => t.id)).toEqual([
			"three-weeks-ago",
			"today-timed",
		]);
	});

	it("does not mutate its argument", () => {
		const list = [at("2026-04-28T16:00:00"), at("2026-04-28T09:00:00")];
		const before = [...list];
		sortByDueThenUntimed(list);
		expect(list).toEqual(before);
	});
});

describe("groupTasksForToday — untimed ordering", () => {
	it("sorts today's untimed tasks after its timed ones", () => {
		const tasks = [
			task({
				id: "untimed",
				dueAt: new Date("2026-04-28T00:00:00").toISOString(),
				hasTime: false,
			}),
			task({
				id: "timed",
				dueAt: new Date("2026-04-28T18:00:00").toISOString(),
				hasTime: true,
			}),
		];
		expect(groupTasksForToday(tasks, NOW).today.map((t) => t.id)).toEqual([
			"timed",
			"untimed",
		]);
	});
});

describe("formatDueSummary", () => {
	const NOW = new Date("2026-04-28T14:00:00"); // Tue

	it("returns the day alone when the task has no time", () => {
		const dueAt = new Date("2026-04-28T00:00:00").toISOString();
		expect(formatDueSummary(dueAt, false, NOW)).toBe("Today");
	});

	it("appends the clock time when the task has one", () => {
		const dueAt = new Date("2026-04-28T09:00:00").toISOString();
		expect(formatDueSummary(dueAt, true, NOW)).toBe("Today at 09:00");
	});

	it("stays absolute for a time earlier today", () => {
		// The row label says "was 09:00" and ticks live. A confirmation of what
		// you just saved must not, or it reads "Due was 09:00".
		const dueAt = new Date("2026-04-28T09:00:00").toISOString();
		expect(formatDueSummary(dueAt, true, NOW)).not.toMatch(/was/);
	});

	it("stays absolute for a time in the next hour", () => {
		const dueAt = new Date(NOW.getTime() + 40 * 60_000).toISOString();
		expect(formatDueSummary(dueAt, true, NOW)).toBe("Today at 14:40");
	});

	it("uses the weekday for a date later this week", () => {
		const dueAt = new Date("2026-05-01T09:00:00").toISOString();
		expect(formatDueSummary(dueAt, true, NOW)).toBe("Fri at 09:00");
	});

	it("uses the short date beyond a week", () => {
		const dueAt = new Date("2026-07-06T09:00:00").toISOString();
		expect(formatDueSummary(dueAt, true, NOW)).toBe("Jul 6 at 09:00");
	});

	it("respects 12-hour format when requested", () => {
		const dueAt = new Date("2026-04-29T18:30:00").toISOString();
		expect(formatDueSummary(dueAt, true, NOW, "12h")).toBe(
			"Tomorrow at 6:30 PM",
		);
	});
});
