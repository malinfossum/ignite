import { describe, expect, it } from "vitest";
import { areaForTask } from "../../src/utils/areas.js";

const SECTIONS = [
	{ id: "s1", areaId: "work" },
	{ id: "s2", areaId: "home" },
	{ id: "orphan", areaId: "deleted-area" },
];
const AREAS = [
	{ id: "work", name: "Work" },
	{ id: "home", name: "Home" },
];

describe("areaForTask", () => {
	it("resolves the area through the task's section", () => {
		const result = areaForTask({ id: "t", sectionId: "s2" }, SECTIONS, AREAS);
		expect(result?.name).toBe("Home");
	});

	it("returns null when the section is missing", () => {
		expect(
			areaForTask({ id: "t", sectionId: "gone" }, SECTIONS, AREAS),
		).toBeNull();
	});

	it("returns null when the section points at a missing area", () => {
		expect(
			areaForTask({ id: "t", sectionId: "orphan" }, SECTIONS, AREAS),
		).toBeNull();
	});

	it("returns null for a missing task or missing lists", () => {
		expect(areaForTask(null, SECTIONS, AREAS)).toBeNull();
		expect(areaForTask({ id: "t", sectionId: "s1" })).toBeNull();
	});
});
