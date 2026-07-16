import { describe, expect, it } from "vitest";
import {
	previousSectionId,
	reorderSections,
} from "../../src/utils/sections.js";

const make = (id, order) => ({ id, areaId: "focus", name: id, order });

describe("reorderSections", () => {
	it("moves a middle section up by swapping order with its predecessor", () => {
		const input = [make("a", 0), make("b", 1), make("c", 2)];
		const out = reorderSections(input, "b", "up");
		const byId = Object.fromEntries(out.map((s) => [s.id, s.order]));
		expect(byId).toEqual({ a: 1, b: 0, c: 2 });
	});

	it("moves a middle section down by swapping order with its successor", () => {
		const input = [make("a", 0), make("b", 1), make("c", 2)];
		const out = reorderSections(input, "b", "down");
		const byId = Object.fromEntries(out.map((s) => [s.id, s.order]));
		expect(byId).toEqual({ a: 0, b: 2, c: 1 });
	});

	it("returns the input unchanged when moving the first section up (no-op)", () => {
		const input = [make("a", 0), make("b", 1)];
		const out = reorderSections(input, "a", "up");
		expect(out.map((s) => s.order)).toEqual([0, 1]);
		expect(out.map((s) => s.id)).toEqual(["a", "b"]);
	});

	it("returns the input unchanged when moving the last section down (no-op)", () => {
		const input = [make("a", 0), make("b", 1)];
		const out = reorderSections(input, "b", "down");
		expect(out.map((s) => s.order)).toEqual([0, 1]);
		expect(out.map((s) => s.id)).toEqual(["a", "b"]);
	});

	it("swaps correctly when order values are non-contiguous", () => {
		// Defensive: tied/non-contiguous orders could happen after a restore.
		const input = [make("a", 0), make("b", 5), make("c", 10)];
		const out = reorderSections(input, "b", "down");
		const byId = Object.fromEntries(out.map((s) => [s.id, s.order]));
		expect(byId).toEqual({ a: 0, b: 10, c: 5 });
	});

	it("does not mutate the input array", () => {
		const input = [make("a", 0), make("b", 1)];
		const snapshot = input.map((s) => ({ ...s }));
		reorderSections(input, "a", "down");
		expect(input).toEqual(snapshot);
	});
});

describe("previousSectionId", () => {
	it("returns the predecessor's id for a middle section", () => {
		const input = [make("a", 0), make("b", 1), make("c", 2)];
		expect(previousSectionId(input, "b")).toBe("a");
	});

	it("returns null for the first section", () => {
		const input = [make("a", 0), make("b", 1)];
		expect(previousSectionId(input, "a")).toBeNull();
	});

	it("returns null for the only section", () => {
		expect(previousSectionId([make("a", 0)], "a")).toBeNull();
	});

	it("returns null for an unknown id", () => {
		const input = [make("a", 0), make("b", 1)];
		expect(previousSectionId(input, "nope")).toBeNull();
	});

	it("returns null for an empty list", () => {
		expect(previousSectionId([], "a")).toBeNull();
	});

	it("sorts by order — non-contiguous values", () => {
		// Defensive: non-contiguous orders happen after a restore.
		const input = [make("a", 0), make("b", 5), make("c", 99)];
		expect(previousSectionId(input, "c")).toBe("b");
	});

	it("sorts by order — input array not already sorted", () => {
		const input = [make("c", 2), make("a", 0), make("b", 1)];
		expect(previousSectionId(input, "c")).toBe("b");
	});

	it("does not mutate the input array", () => {
		const input = [make("b", 1), make("a", 0)];
		const snapshot = input.map((s) => ({ ...s }));
		previousSectionId(input, "b");
		expect(input).toEqual(snapshot);
	});
});
