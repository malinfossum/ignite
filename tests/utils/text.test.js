import { describe, expect, it } from "vitest";
import { capitalizeFirst } from "../../src/utils/text.js";

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
