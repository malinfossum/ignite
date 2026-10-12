import { describe, expect, it } from "vitest";
import { parseAllowlist } from "../src/auth.ts";

describe("parseAllowlist", () => {
	it("trims and lowercases every entry, and drops empty ones", () => {
		expect(parseAllowlist(" Owner@Ignite.TEST ,second@ignite.test,, ")).toEqual(
			new Set(["owner@ignite.test", "second@ignite.test"]),
		);
	});
	it("is empty for an empty setting, so nobody can sign up by mistake", () => {
		expect(parseAllowlist("")).toEqual(new Set());
	});
});
