import { describe, expect, it } from "vitest";
import {
	firstEnabledIndex,
	lastEnabledIndex,
	nextEnabledIndex,
} from "../../src/utils/menu-keyboard.js";

describe("firstEnabledIndex", () => {
	it("returns 0 when all items are enabled", () => {
		expect(
			firstEnabledIndex([
				{ disabled: false },
				{ disabled: false },
				{ disabled: false },
			]),
		).toBe(0);
	});

	it("skips leading disabled items", () => {
		expect(
			firstEnabledIndex([
				{ disabled: true },
				{ disabled: true },
				{ disabled: false },
				{ disabled: false },
			]),
		).toBe(2);
	});

	it("returns -1 when all items are disabled (or array is empty)", () => {
		expect(firstEnabledIndex([])).toBe(-1);
		expect(firstEnabledIndex([{ disabled: true }, { disabled: true }])).toBe(
			-1,
		);
	});
});

describe("lastEnabledIndex", () => {
	it("returns the last index when all items are enabled", () => {
		expect(
			lastEnabledIndex([
				{ disabled: false },
				{ disabled: false },
				{ disabled: false },
			]),
		).toBe(2);
	});

	it("skips trailing disabled items", () => {
		expect(
			lastEnabledIndex([
				{ disabled: false },
				{ disabled: false },
				{ disabled: true },
				{ disabled: true },
			]),
		).toBe(1);
	});

	it("returns -1 when all items are disabled (or array is empty)", () => {
		expect(lastEnabledIndex([])).toBe(-1);
		expect(lastEnabledIndex([{ disabled: true }, { disabled: true }])).toBe(-1);
	});
});

describe("nextEnabledIndex", () => {
	const allEnabled = [
		{ disabled: false },
		{ disabled: false },
		{ disabled: false },
		{ disabled: false },
	];

	it("moves forward by one from the middle", () => {
		expect(nextEnabledIndex(allEnabled, 1, 1)).toBe(2);
	});

	it("wraps forward from last to first", () => {
		expect(nextEnabledIndex(allEnabled, 3, 1)).toBe(0);
	});

	it("moves backward by one from the middle", () => {
		expect(nextEnabledIndex(allEnabled, 2, -1)).toBe(1);
	});

	it("wraps backward from first to last", () => {
		expect(nextEnabledIndex(allEnabled, 0, -1)).toBe(3);
	});

	it("skips disabled items going forward", () => {
		expect(
			nextEnabledIndex(
				[
					{ disabled: false }, // 0
					{ disabled: true }, // 1
					{ disabled: true }, // 2
					{ disabled: false }, // 3
				],
				0,
				1,
			),
		).toBe(3);
	});

	it("skips disabled items going backward", () => {
		expect(
			nextEnabledIndex(
				[
					{ disabled: false }, // 0
					{ disabled: true }, // 1
					{ disabled: true }, // 2
					{ disabled: false }, // 3
				],
				3,
				-1,
			),
		).toBe(0);
	});

	it("returns currentIndex when it's the only enabled item", () => {
		expect(
			nextEnabledIndex(
				[{ disabled: true }, { disabled: false }, { disabled: true }],
				1,
				1,
			),
		).toBe(1);
		expect(
			nextEnabledIndex(
				[{ disabled: true }, { disabled: false }, { disabled: true }],
				1,
				-1,
			),
		).toBe(1);
	});

	it("returns -1 when all items are disabled (or array is empty)", () => {
		expect(nextEnabledIndex([], 0, 1)).toBe(-1);
		expect(
			nextEnabledIndex([{ disabled: true }, { disabled: true }], 0, 1),
		).toBe(-1);
	});
});
