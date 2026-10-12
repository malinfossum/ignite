import { describe, expect, it } from "vitest";
import type { Change } from "../../shared/protocol";
import { isSeedOnly, quietChanged, splitBatches } from "../../src/sync/rules";

describe("quietChanged", () => {
	it("is false when only the theme changed", () => {
		expect(
			quietChanged(
				{ quietStart: 23, quietEnd: 7, theme: "dark" },
				{ quietStart: 23, quietEnd: 7, theme: "light" },
			),
		).toBe(false);
	});
	it("is true when a quiet hour changed", () => {
		expect(
			quietChanged(
				{ quietStart: 23, quietEnd: 7 },
				{ quietStart: 22, quietEnd: 7 },
			),
		).toBe(true);
	});
	it("is false for the first write of the row (the seed)", () => {
		expect(quietChanged(undefined, { quietStart: 23, quietEnd: 7 })).toBe(
			false,
		);
	});
});

describe("isSeedOnly", () => {
	it("is true for a fresh install", () => {
		expect(
			isSeedOnly({
				areas: [{ id: "focus" }],
				sections: [{ id: "focus-default" }],
				tasks: [],
			}),
		).toBe(true);
	});
	it("is false once there is one task, even in the seeded section", () => {
		expect(
			isSeedOnly({
				areas: [{ id: "focus" }],
				sections: [{ id: "focus-default" }],
				tasks: [{}],
			}),
		).toBe(false);
	});
	it("is false with a user-made area and no tasks", () => {
		expect(
			isSeedOnly({
				areas: [{ id: "focus" }, { id: "a1" }],
				sections: [{ id: "focus-default" }],
				tasks: [],
			}),
		).toBe(false);
	});
});

const put = (id: string, title = "x"): Change => ({
	store: "tasks",
	id,
	op: "put",
	record: { id, title },
});

describe("splitBatches", () => {
	it("splits at the change count", () => {
		const changes = Array.from({ length: 450 }, (_, i) => put(`t${i}`));
		expect(splitBatches(changes, 200, 1_000_000).map((b) => b.length)).toEqual([
			200, 200, 50,
		]);
	});
	it("counts bytes as UTF-8, not string length", () => {
		const big = "é".repeat(300_000); // 600 kB as UTF-8
		const changes = [put("a", big), put("b", big), put("c")];
		expect(splitBatches(changes, 200, 1_000_000).map((b) => b.length)).toEqual([
			1, 2,
		]);
	});
	it("puts one oversized change in a batch of its own", () => {
		const changes = [put("a"), put("huge", "x".repeat(2_000_000)), put("b")];
		expect(
			splitBatches(changes, 200, 1_000_000).map((b) => b.map((c) => c.id)),
		).toEqual([["a"], ["huge"], ["b"]]);
	});
	it("returns no batches for no changes", () => {
		expect(splitBatches([], 200, 1_000_000)).toEqual([]);
	});
});
