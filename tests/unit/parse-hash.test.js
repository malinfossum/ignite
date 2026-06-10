import { describe, expect, it } from "vitest";
import { parseHash } from "../../src/controller.js";

// parseHash maps the location hash to a route object. Two routes exist:
//   { name: "today" }            — the default, and the fallback for anything unknown
//   { name: "area", id: "<id>" } — an area page
describe("parseHash", () => {
	it("treats an empty hash as Today", () => {
		expect(parseHash("")).toEqual({ name: "today" });
	});

	it("treats a bare # as Today", () => {
		expect(parseHash("#")).toEqual({ name: "today" });
	});

	it("parses #today as Today", () => {
		expect(parseHash("#today")).toEqual({ name: "today" });
	});

	it("parses a hash with no leading # as Today", () => {
		expect(parseHash("today")).toEqual({ name: "today" });
	});

	it("parses #area/<id> into an area route", () => {
		expect(parseHash("#area/abc123")).toEqual({ name: "area", id: "abc123" });
	});

	it("keeps the full id after area/, including dashes", () => {
		expect(parseHash("#area/focus-default")).toEqual({
			name: "area",
			id: "focus-default",
		});
	});

	it("falls back to Today on an unknown route", () => {
		expect(parseHash("#settings")).toEqual({ name: "today" });
	});

	it("falls back to Today when area/ has no id", () => {
		// /^area\/(.+)$/ requires at least one character after the slash.
		expect(parseHash("#area/")).toEqual({ name: "today" });
	});

	it("treats null and undefined as Today (hash may be unset)", () => {
		expect(parseHash(null)).toEqual({ name: "today" });
		expect(parseHash(undefined)).toEqual({ name: "today" });
	});
});
