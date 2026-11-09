import { describe, expect, it } from "vitest";
import { buildRepeatsFile } from "../../tools/amplenote-plugin/build-repeats.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-09T12:00:00.000Z");

describe("buildRepeatsFile", () => {
	it("has the app, version and export time", () => {
		const file = buildRepeatsFile([], NOW);
		expect(file).toEqual({
			app: "ignite-amplenote-repeats",
			version: 1,
			exportedAt: "2026-11-09T12:00:00.000Z",
			tasks: {},
		});
	});

	it("includes every open task, repeating or not", () => {
		const file = buildRepeatsFile(
			[
				{ uuid: A, repeat: "FREQ=DAILY", isRepeating: true },
				{ uuid: B, repeat: null, isRepeating: false },
				{ uuid: C, isRepeating: true },
			],
			NOW,
		);
		expect(file.tasks[A]).toEqual({ repeat: "FREQ=DAILY", isRepeating: true });
		expect(file.tasks[B]).toEqual({ repeat: null, isRepeating: false });
		expect(file.tasks[C]).toEqual({ repeat: null, isRepeating: true });
	});

	it("treats a repeat string as repeating even if isRepeating is missing", () => {
		const file = buildRepeatsFile([{ uuid: A, repeat: "FREQ=WEEKLY" }], NOW);
		expect(file.tasks[A].isRepeating).toBe(true);
	});

	it("skips done and dismissed tasks and bad uuids", () => {
		const file = buildRepeatsFile(
			[
				{ uuid: A, completedAt: 1 },
				{ uuid: B, dismissedAt: 1 },
				{ uuid: "__proto__", repeat: "FREQ=DAILY" },
				{ uuid: "not-a-uuid" },
				null,
			],
			NOW,
		);
		expect(Object.keys(file.tasks)).toEqual([]);
	});

	it("never writes a title or a note name", () => {
		const file = buildRepeatsFile(
			[{ uuid: A, content: "Ring the dentist", noteUUID: B, repeat: null }],
			NOW,
		);
		const text = JSON.stringify(file);
		expect(text).not.toContain("Ring the dentist");
		expect(text).not.toContain(B);
	});
});
