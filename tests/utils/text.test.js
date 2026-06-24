import { describe, expect, it } from "vitest";
import {
	capitalizeFirst,
	describeRecurrence,
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

describe("describeRecurrence", () => {
	it("returns the bare adverb when interval is 1 or absent", () => {
		expect(describeRecurrence({ type: "daily" })).toBe("daily");
		expect(describeRecurrence({ type: "weekly", interval: 1 })).toBe("weekly");
		expect(describeRecurrence({ type: "monthly" })).toBe("monthly");
		expect(describeRecurrence({ type: "yearly", interval: 1 })).toBe("yearly");
	});

	it("returns 'every N units' (pluralised) for interval > 1", () => {
		expect(describeRecurrence({ type: "daily", interval: 2 })).toBe(
			"every 2 days",
		);
		expect(describeRecurrence({ type: "weekly", interval: 2 })).toBe(
			"every 2 weeks",
		);
		expect(describeRecurrence({ type: "monthly", interval: 3 })).toBe(
			"every 3 months",
		);
		expect(describeRecurrence({ type: "yearly", interval: 5 })).toBe(
			"every 5 years",
		);
	});

	it("returns '' for a null or unknown rule (defensive)", () => {
		expect(describeRecurrence(null)).toBe("");
		expect(describeRecurrence({ type: "garbage" })).toBe("");
		expect(describeRecurrence(undefined)).toBe("");
	});
});
