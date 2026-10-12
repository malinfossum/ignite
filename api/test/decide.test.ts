import { describe, expect, it } from "vitest";
import { clampUpdatedAt, decide } from "../src/decide.ts";

const NOW = new Date("2026-10-01T12:00:00.000Z");

describe("clampUpdatedAt", () => {
	it("caps a time from a fast clock at server time plus 5 seconds", () => {
		expect(clampUpdatedAt("2027-10-01T12:00:00.000Z", NOW)).toBe(
			"2026-10-01T12:00:05.000Z",
		);
	});
	it("keeps a time inside the 5 seconds as it is", () => {
		expect(clampUpdatedAt("2026-10-01T12:00:04.999Z", NOW)).toBe(
			"2026-10-01T12:00:04.999Z",
		);
	});
	it("keeps a time in the past as it is", () => {
		expect(clampUpdatedAt("2026-01-01T00:00:00.000Z", NOW)).toBe(
			"2026-01-01T00:00:00.000Z",
		);
	});
});

describe("decide", () => {
	it("applies when the server holds nothing for the key", () => {
		expect(decide("2026-01-01T00:00:00.000Z", null)).toBe("apply");
	});
	it("applies a strictly newer change", () => {
		expect(decide("2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(
			"apply",
		);
	});
	it("loses on an equal time, so a retried push comes back as lost", () => {
		expect(decide("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(
			"lose",
		);
	});
	it("loses to a newer time on the server", () => {
		expect(decide("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z")).toBe(
			"lose",
		);
	});
});
