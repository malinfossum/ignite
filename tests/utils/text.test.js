import { describe, expect, it } from "vitest";
import {
	capitalizeFirst,
	formatTaskDeleteMessage,
} from "../../src/utils/text.js";

describe("capitalizeFirst", () => {
	it("uppercases the first char and trims; leaves the rest verbatim", () => {
		expect(capitalizeFirst("hello world")).toBe("Hello world");
		expect(capitalizeFirst("  hello  ")).toBe("Hello");
		expect(capitalizeFirst("Hello")).toBe("Hello");
		expect(capitalizeFirst("")).toBe("");
		expect(capitalizeFirst(null)).toBe("");
		expect(capitalizeFirst("123abc")).toBe("123abc");
		expect(capitalizeFirst("æble")).toBe("Æble"); // Unicode safety
	});
});

describe("formatTaskDeleteMessage", () => {
	it("returns the singular form for count = 1", () => {
		expect(formatTaskDeleteMessage(1)).toBe("Task deleted");
	});

	it("returns the plural form for count = 2", () => {
		expect(formatTaskDeleteMessage(2)).toBe("2 tasks deleted");
	});

	it("returns the plural form for larger counts", () => {
		expect(formatTaskDeleteMessage(10)).toBe("10 tasks deleted");
	});
});
