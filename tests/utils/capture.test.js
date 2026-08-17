import { describe, expect, it } from "vitest";
import {
	captureChipLabel,
	captureDestination,
} from "../../src/utils/capture.js";

const sec = (id, areaId, order, name = id) => ({ id, areaId, order, name });

describe("captureDestination", () => {
	it("routes the Focus/landing route to the notepad", () => {
		expect(captureDestination({ name: "focus" }, [])).toEqual({
			kind: "focus",
		});
	});

	it("routes an unknown or missing route to the notepad", () => {
		expect(captureDestination(undefined, [])).toEqual({ kind: "focus" });
		expect(captureDestination({ name: "wat" }, [])).toEqual({ kind: "focus" });
	});

	it("writes directly when the area has exactly one section", () => {
		const sections = [sec("s1", "a1", 0), sec("s9", "other", 0)];
		expect(captureDestination({ name: "area", id: "a1" }, sections)).toEqual({
			kind: "direct",
			sectionId: "s1",
		});
	});

	it("asks when the area has more than one section, ordered by `order`", () => {
		const sections = [sec("b", "a1", 1), sec("a", "a1", 0), sec("c", "a1", 2)];
		const out = captureDestination({ name: "area", id: "a1" }, sections);
		expect(out.kind).toBe("pick");
		expect(out.sections.map((s) => s.id)).toEqual(["a", "b", "c"]);
	});

	it("reports `none` when the area has no sections at all", () => {
		const sections = [sec("s9", "other", 0)];
		expect(captureDestination({ name: "area", id: "a1" }, sections)).toEqual({
			kind: "none",
		});
	});

	it("reports `none` when sections is omitted entirely (the `sections ?? []` guard)", () => {
		expect(captureDestination({ name: "area", id: "a1" })).toEqual({
			kind: "none",
		});
	});
});

describe("captureChipLabel", () => {
	it("names Focus on the landing route", () => {
		expect(captureChipLabel({ kind: "focus" })).toBe("Focus");
	});

	it("names the single section when writing directly", () => {
		expect(
			captureChipLabel({ kind: "direct", sectionId: "s1" }, "Appointments"),
		).toBe("Appointments");
	});

	it("falls back to a neutral label when the section name is missing", () => {
		expect(captureChipLabel({ kind: "direct", sectionId: "s1" })).toBe(
			"This section",
		);
	});

	it("prompts when a choice is required", () => {
		expect(captureChipLabel({ kind: "pick", sections: [] })).toBe(
			"Choose section…",
		);
	});

	it("explains itself when the area has no sections", () => {
		expect(captureChipLabel({ kind: "none" })).toBe("Add a section first");
	});

	it("throws on an unrecognized kind instead of silently mislabelling it as `none`", () => {
		expect(() => captureChipLabel({ kind: "bogus" })).toThrow(
			/Unknown capture destination kind/,
		);
	});
});
