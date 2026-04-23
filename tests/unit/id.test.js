import { describe, expect, it } from "vitest";
import { uuid } from "../../src/utils/id.js";

describe("uuid", () => {
	it("returns a string matching the standard UUID shape", () => {
		expect(uuid()).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
	});

	it("returns a different value on each call", () => {
		expect(uuid()).not.toBe(uuid());
	});
});
