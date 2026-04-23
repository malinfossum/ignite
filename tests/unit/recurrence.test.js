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
