import { describe, expect, it } from "vitest";
import { nextOccurrence } from "../../src/model/recurrence.js";

describe("nextOccurrence — daily", () => {
	it("advances the date by one day, preserving time-of-day", () => {
		const from = new Date("2026-04-20T09:30:00");
		const next = nextOccurrence({ type: "daily" }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-04-21T09:30:00").toISOString(),
		);
	});

	it("rolls over month boundaries", () => {
		const from = new Date("2026-04-30T08:00:00");
		const next = nextOccurrence({ type: "daily" }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-05-01T08:00:00").toISOString(),
		);
	});
});

describe("nextOccurrence — weekly", () => {
	// JS Date.getDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
	it("picks the next weekday in the list (simple case)", () => {
		// Mon 2026-04-20, rule = Mon/Wed/Fri → Wed 2026-04-22
		const from = new Date("2026-04-20T09:00:00");
		const next = nextOccurrence({ type: "weekly", weekdays: [1, 3, 5] }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-04-22T09:00:00").toISOString(),
		);
	});

	it("wraps across the week", () => {
		// Fri 2026-04-24, rule = Mon → Mon 2026-04-27
		const from = new Date("2026-04-24T09:00:00");
		const next = nextOccurrence({ type: "weekly", weekdays: [1] }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-04-27T09:00:00").toISOString(),
		);
	});

	it("never returns the same day even if today is in the list", () => {
		// Mon 2026-04-20, rule = Mon/Wed → must advance to Wed
		const from = new Date("2026-04-20T09:00:00");
		const next = nextOccurrence({ type: "weekly", weekdays: [1, 3] }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-04-22T09:00:00").toISOString(),
		);
	});
});

describe("nextOccurrence — monthly", () => {
	it("returns the same day of the next month", () => {
		const from = new Date("2026-04-15T10:00:00");
		const next = nextOccurrence({ type: "monthly", day: 15 }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-05-15T10:00:00").toISOString(),
		);
	});

	it("clamps to last day when target month is shorter", () => {
		// Jan 31 → Feb 28 (non-leap year)
		const from = new Date("2027-01-31T10:00:00");
		const next = nextOccurrence({ type: "monthly", day: 31 }, from);
		expect(next.toISOString()).toBe(
			new Date("2027-02-28T10:00:00").toISOString(),
		);
	});

	it("rolls over the year boundary", () => {
		const from = new Date("2026-12-10T10:00:00");
		const next = nextOccurrence({ type: "monthly", day: 10 }, from);
		expect(next.toISOString()).toBe(
			new Date("2027-01-10T10:00:00").toISOString(),
		);
	});
});

describe("nextOccurrence — yearly", () => {
	it("returns the same month+day next year", () => {
		const from = new Date("2026-04-07T09:00:00");
		const next = nextOccurrence({ type: "yearly", month: 4, day: 7 }, from);
		expect(next.toISOString()).toBe(
			new Date("2027-04-07T09:00:00").toISOString(),
		);
	});

	it("clamps Feb 29 to Feb 28 in non-leap years", () => {
		// 2028 is a leap year. From Feb 29 2028, next year is 2029 (non-leap)
		// → should clamp to Feb 28.
		const from = new Date("2028-02-29T09:00:00");
		const next = nextOccurrence({ type: "yearly", month: 2, day: 29 }, from);
		expect(next.toISOString()).toBe(
			new Date("2029-02-28T09:00:00").toISOString(),
		);
	});

	it("throws on unknown recurrence type", () => {
		expect(() =>
			nextOccurrence({ type: "garbage" }, new Date("2026-04-20")),
		).toThrow(/Unknown recurrence type/);
	});
});

describe("nextOccurrence — interval", () => {
	it("daily every N advances by N days, preserving time-of-day", () => {
		const from = new Date("2026-04-20T09:30:00");
		const next = nextOccurrence({ type: "daily", interval: 3 }, from);
		expect(next.toISOString()).toBe(
			new Date("2026-04-23T09:30:00").toISOString(),
		);
	});

	it("weekly every 2 weeks jumps to the next on-week (single weekday)", () => {
		// Mon 2026-04-20, [Mon], interval 2 → Mon +14 = 2026-05-04
		const from = new Date("2026-04-20T09:00:00");
		const next = nextOccurrence(
			{ type: "weekly", interval: 2, weekdays: [1] },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2026-05-04T09:00:00").toISOString(),
		);
	});

	it("weekly every 2 weeks from a mid-week selected day jumps +12 to the on-week start", () => {
		// Wed 2026-04-22, [Mon,Wed], interval 2 → Mon two weeks out = 2026-05-04 (+12)
		const from = new Date("2026-04-22T09:00:00");
		const next = nextOccurrence(
			{ type: "weekly", interval: 2, weekdays: [1, 3] },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2026-05-04T09:00:00").toISOString(),
		);
	});

	it("weekly interval still picks a later same-week day before jumping", () => {
		// Mon 2026-04-20, [Mon,Wed], interval 2 → Wed THIS week (same-week wins)
		const from = new Date("2026-04-20T09:00:00");
		const next = nextOccurrence(
			{ type: "weekly", interval: 2, weekdays: [1, 3] },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2026-04-22T09:00:00").toISOString(),
		);
	});

	it("monthly every 2 months, clamping short target months", () => {
		// Dec 31 2026, interval 2 → Feb 2027 → clamp to 28
		const from = new Date("2026-12-31T10:00:00");
		const next = nextOccurrence(
			{ type: "monthly", interval: 2, day: 31 },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2027-02-28T10:00:00").toISOString(),
		);
	});

	it("yearly every 2 years", () => {
		const from = new Date("2026-04-07T09:00:00");
		const next = nextOccurrence(
			{ type: "yearly", interval: 2, month: 4, day: 7 },
			from,
		);
		expect(next.toISOString()).toBe(
			new Date("2028-04-07T09:00:00").toISOString(),
		);
	});

	it("treats absent / zero / negative / fractional interval as 1 (back-compat + robustness)", () => {
		const from = new Date("2026-04-20T09:30:00");
		const expected = new Date("2026-04-21T09:30:00").toISOString();
		expect(nextOccurrence({ type: "daily" }, from).toISOString()).toBe(
			expected,
		);
		expect(
			nextOccurrence({ type: "daily", interval: 0 }, from).toISOString(),
		).toBe(expected);
		expect(
			nextOccurrence({ type: "daily", interval: -5 }, from).toISOString(),
		).toBe(expected);
		expect(
			nextOccurrence({ type: "daily", interval: 1.9 }, from).toISOString(),
		).toBe(expected);
	});
});
