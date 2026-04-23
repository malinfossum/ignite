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
