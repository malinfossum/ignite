import { describe, expect, it } from "vitest";
import { needsAttention, statusText } from "../../src/sync/status";

const now = new Date("2026-10-01T12:00:00.000Z");

describe("statusText", () => {
	it("says how long ago the last sync was", () => {
		expect(
			statusText({ kind: "synced", at: "2026-10-01T11:58:00.000Z" }, now),
		).toBe("Synced 2 min ago");
		expect(
			statusText({ kind: "synced", at: "2026-10-01T11:59:40.000Z" }, now),
		).toBe("Synced just now");
	});
	it("counts waiting changes when offline", () => {
		expect(statusText({ kind: "offline", pending: 3 }, now)).toBe(
			"Offline, 3 changes waiting",
		);
		expect(statusText({ kind: "offline", pending: 1 }, now)).toBe(
			"Offline, 1 change waiting",
		);
	});
	it("has the fixed copy for the other states", () => {
		expect(statusText({ kind: "syncing" }, now)).toBe("Syncing…");
		expect(statusText({ kind: "needs-sign-in" }, now)).toBe(
			"Sign in again to sync",
		);
		expect(statusText({ kind: "needs-reload" }, now)).toBe(
			"Ignite has updated. Reload to keep syncing.",
		);
		expect(statusText({ kind: "invalid", count: 1 }, now)).toBe(
			"1 change couldn't sync",
		);
		expect(statusText({ kind: "invalid", count: 2 }, now)).toBe(
			"2 changes couldn't sync",
		);
	});
});

describe("needsAttention", () => {
	it("flags only the states the user must act on", () => {
		expect(needsAttention({ kind: "needs-sign-in" })).toBe(true);
		expect(needsAttention({ kind: "needs-reload" })).toBe(true);
		expect(needsAttention({ kind: "invalid", count: 1 })).toBe(true);
		expect(needsAttention({ kind: "offline", pending: 2 })).toBe(false);
		expect(needsAttention({ kind: "local" })).toBe(false);
	});
});
