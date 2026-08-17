import { describe, expect, it } from "vitest";
import { parseHash } from "../../src/controller.js";

// parseHash maps the location hash to a route object. Two routes exist:
//   { name: "focus" }            — the landing surface, and the fallback for anything unknown
//   { name: "area", id: "<id>" } — an area page
// "#today" is kept as an accepted alias so pre-v3 bookmarks still resolve.
describe("parseHash", () => {
	it("treats an empty hash as Focus", () => {
		expect(parseHash("")).toEqual({ name: "focus" });
	});

	it("treats a bare # as Focus", () => {
		expect(parseHash("#")).toEqual({ name: "focus" });
	});

	it("parses #focus as Focus", () => {
		expect(parseHash("#focus")).toEqual({ name: "focus" });
	});

	it("still parses the legacy #today as Focus", () => {
		expect(parseHash("#today")).toEqual({ name: "focus" });
	});

	it("parses a hash with no leading # as Focus", () => {
		expect(parseHash("focus")).toEqual({ name: "focus" });
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

	it("still parses #area/focus as an area route (the controller redirects it)", () => {
		// parseHash stays pure — the redirect is a side effect and belongs to the
		// controller, which owns FOCUS_ID. utils and pure parsers never import model/.
		expect(parseHash("#area/focus")).toEqual({ name: "area", id: "focus" });
	});

	it("falls back to Focus on an unknown route", () => {
		expect(parseHash("#settings")).toEqual({ name: "focus" });
	});

	it("falls back to Focus when area/ has no id", () => {
		// /^area\/(.+)$/ requires at least one character after the slash.
		expect(parseHash("#area/")).toEqual({ name: "focus" });
	});

	it("treats null and undefined as Focus (hash may be unset)", () => {
		expect(parseHash(null)).toEqual({ name: "focus" });
		expect(parseHash(undefined)).toEqual({ name: "focus" });
	});
});
