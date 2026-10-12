import { describe, expect, expectTypeOf, it } from "vitest";
import {
	CLOCK_SKEW_MS,
	EPOCH,
	keyOf,
	MAX_BODY_BYTES,
	MAX_CHANGES,
	PROTOCOL_VERSION,
	PULL_LIMIT,
	type PushRequest,
	STORES,
	type Store,
	SYNCED_STORES,
} from "../../shared/protocol";

describe("shared protocol", () => {
	it("names the four synced stores", () => {
		expect(STORES).toEqual(["areas", "sections", "tasks", "settings"]);
		expect(SYNCED_STORES).toBe(STORES);
		// Checked by tsc --noEmit (npm run check), not at runtime.
		expectTypeOf<Store>().toEqualTypeOf<
			"areas" | "sections" | "tasks" | "settings"
		>();
	});

	it("builds a key as store:id", () => {
		expect(keyOf("tasks", "t1")).toBe("tasks:t1");
		expect(keyOf("settings", "app")).toBe("settings:app");
	});

	it("keeps everything after the first colon as the id", () => {
		// Anything that splits a key must split at the first colon only.
		expect(keyOf("tasks", "a:b")).toBe("tasks:a:b");
	});

	it("puts EPOCH at the Unix epoch, so any real edit is newer", () => {
		expect(new Date(EPOCH).getTime()).toBe(0);
		expect(new Date(EPOCH).toISOString()).toBe(EPOCH);
	});

	it("matches the limits in the spec", () => {
		expect(PROTOCOL_VERSION).toBe(1); // §5.3
		expect(MAX_CHANGES).toBe(200); // §5.3, §6.1
		expect(MAX_BODY_BYTES).toBe(1_000_000); // §5.3
		expect(PULL_LIMIT).toBe(500); // §6.2
		expect(CLOCK_SKEW_MS).toBe(5_000); // §6.1
		expectTypeOf<PushRequest["protocol"]>().toEqualTypeOf<1>();
	});
});
