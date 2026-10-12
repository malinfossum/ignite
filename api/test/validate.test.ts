import { describe, expect, it } from "vitest";
import { MAX_CHANGES, PROTOCOL_VERSION } from "../../shared/protocol.ts";
import {
	isIsoDate,
	parseChange,
	parsePushRequest,
	withinLength,
} from "../src/validate.ts";

const AT = "2026-10-01T08:00:00.000Z";

const task = (over: Record<string, unknown> = {}) => ({
	id: "t1",
	sectionId: "s1",
	title: "Ring the dentist",
	notes: "",
	completed: false,
	starred: false,
	critical: false,
	dueAt: null,
	hasTime: false,
	recurrence: null,
	lastCompletedAt: null,
	completedCount: 0,
	leadTime: 0,
	scheduledTags: [],
	createdAt: AT,
	order: 0,
	updatedAt: AT,
	...over,
});

const putTask = (record: Record<string, unknown>, id = "t1") => ({
	store: "tasks",
	id,
	op: "put",
	record,
});

const rejected = (store: string | null, id: string | null) => ({
	ok: false,
	store,
	id,
});

describe("parseChange accepts", () => {
	it("a full task", () => {
		expect(parseChange(putTask(task()))).toEqual({
			ok: true,
			change: putTask(task()),
		});
	});

	it("a task with a due date, a weekly rule and a completion", () => {
		const record = task({
			dueAt: AT,
			hasTime: true,
			recurrence: { type: "weekly", interval: 1, weekdays: [1, 3] },
			lastCompletedAt: AT,
			completedCount: 3,
		});
		expect(parseChange(putTask(record)).ok).toBe(true);
	});

	it("an area, a section and the settings row", () => {
		const area = {
			id: "focus",
			name: "Focus",
			icon: "🔥",
			critical: false,
			order: 0,
			updatedAt: AT,
		};
		const section = {
			id: "focus-default",
			areaId: "focus",
			name: "Tasks",
			collapsed: false,
			order: 0,
			updatedAt: AT,
		};
		const settings = { id: "app", quietStart: 23, quietEnd: 7, updatedAt: AT };
		expect(
			parseChange({ store: "areas", id: "focus", op: "put", record: area }).ok,
		).toBe(true);
		expect(
			parseChange({
				store: "sections",
				id: "focus-default",
				op: "put",
				record: section,
			}).ok,
		).toBe(true);
		expect(
			parseChange({ store: "settings", id: "app", op: "put", record: settings })
				.ok,
		).toBe(true);
	});

	it("a delete", () => {
		const change = { store: "tasks", id: "t1", op: "delete", deletedAt: AT };
		expect(parseChange(change)).toEqual({ ok: true, change });
	});
});

describe("parseChange must fail (spec §10)", () => {
	it("an unknown key in the record", () => {
		expect(parseChange(putTask(task({ colour: "red" })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a user_id smuggled into the record", () => {
		expect(parseChange(putTask(task({ user_id: "someone-else" })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a userId smuggled into the record", () => {
		expect(parseChange(putTask(task({ userId: "someone-else" })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a record id that differs from the change id", () => {
		expect(parseChange(putTask(task({ id: "t2" }), "t1"))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a store outside the four", () => {
		expect(
			parseChange({ store: "user", id: "t1", op: "put", record: task() }),
		).toEqual(rejected(null, "t1"));
	});

	it("a 1,001-character title", () => {
		expect(parseChange(putTask(task({ title: "x".repeat(1_001) })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("an unknown key on the change itself", () => {
		expect(parseChange({ ...putTask(task()), userId: "someone-else" })).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a put with no record", () => {
		expect(parseChange({ store: "tasks", id: "t1", op: "put" })).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("an op that is neither put nor delete", () => {
		expect(parseChange({ ...putTask(task()), op: "patch" })).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a device-only settings field", () => {
		const record = {
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "dark",
			updatedAt: AT,
		};
		expect(
			parseChange({ store: "settings", id: "app", op: "put", record }),
		).toEqual(rejected("settings", "app"));
	});

	it("a number where a boolean goes (the 0/1 the task model stores)", () => {
		expect(parseChange(putTask(task({ completed: 1 })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("an order Postgres can't store in an integer column", () => {
		expect(parseChange(putTask(task({ order: 2 ** 31 })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a change that isn't an object at all", () => {
		expect(parseChange("tasks:t1")).toEqual(rejected(null, null));
	});

	it("a NUL in a title (Postgres text refuses it)", () => {
		expect(parseChange(putTask(task({ title: "Ring\u0000" })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a NUL in the id, reported with no id so push never queries it", () => {
		expect(parseChange(putTask(task({ id: "t\u0000" }), "t\u0000"))).toEqual(
			rejected("tasks", null),
		);
	});

	it("a lone high surrogate in notes (jsonb refuses it)", () => {
		expect(parseChange(putTask(task({ notes: "x\uD83D" })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a lone low surrogate in a scheduled tag", () => {
		expect(parseChange(putTask(task({ scheduledTags: ["\uDE00x"] })))).toEqual(
			rejected("tasks", "t1"),
		);
	});
});

describe("length limits count characters, not UTF-16 units", () => {
	const emoji = "😀"; // one character, two UTF-16 units

	it("accepts a 1,000-character title", () => {
		expect(parseChange(putTask(task({ title: "x".repeat(1_000) }))).ok).toBe(
			true,
		);
	});

	it("accepts a title of 1,000 emoji (2,000 UTF-16 units)", () => {
		expect(parseChange(putTask(task({ title: emoji.repeat(1_000) }))).ok).toBe(
			true,
		);
	});

	it("accepts a note of 20,000 emoji (40,000 UTF-16 units)", () => {
		expect(parseChange(putTask(task({ notes: emoji.repeat(20_000) }))).ok).toBe(
			true,
		);
	});

	it("rejects a note of 20,001 emoji", () => {
		expect(parseChange(putTask(task({ notes: emoji.repeat(20_001) })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("counts correctly at the edges", () => {
		expect(withinLength("abc", 3)).toBe(true);
		expect(withinLength("abcd", 3)).toBe(false);
		expect(withinLength(emoji.repeat(3), 3)).toBe(true);
		expect(withinLength(emoji.repeat(4), 3)).toBe(false);
	});
});

describe("dates", () => {
	it("accepts exactly the shape toISOString() produces", () => {
		expect(isIsoDate(new Date().toISOString())).toBe(true);
		expect(isIsoDate(AT)).toBe(true);
	});

	it("rejects dates that don't exist, other shapes and offsets", () => {
		expect(isIsoDate("2026-02-31T00:00:00.000Z")).toBe(false);
		expect(isIsoDate("2026-10-01T08:00:00Z")).toBe(false);
		expect(isIsoDate("2026-10-01T10:00:00.000+02:00")).toBe(false);
		expect(isIsoDate("2026-10-01")).toBe(false);
		expect(isIsoDate("yesterday")).toBe(false);
	});

	it("fails a change whose date is not valid", () => {
		expect(
			parseChange(putTask(task({ dueAt: "2026-02-31T00:00:00.000Z" }))),
		).toEqual(rejected("tasks", "t1"));
		expect(
			parseChange({ store: "tasks", id: "t1", op: "delete", deletedAt: "now" }),
		).toEqual(rejected("tasks", "t1"));
	});
});

describe("parsePushRequest", () => {
	it("hands back the raw changes of a well-formed request", () => {
		expect(
			parsePushRequest({ protocol: PROTOCOL_VERSION, changes: [1, 2] }),
		).toEqual({ ok: true, changes: [1, 2] });
	});

	it("answers 426 to a protocol it doesn't speak, before anything else", () => {
		expect(parsePushRequest({ protocol: 2, changes: [] })).toEqual({
			ok: false,
			status: 426,
		});
		expect(parsePushRequest({ changes: [] })).toEqual({
			ok: false,
			status: 426,
		});
	});

	it("answers 400 to a body that isn't a request", () => {
		expect(parsePushRequest(null)).toEqual({ ok: false, status: 400 });
		expect(parsePushRequest([])).toEqual({ ok: false, status: 400 });
		expect(parsePushRequest({ protocol: PROTOCOL_VERSION })).toEqual({
			ok: false,
			status: 400,
		});
	});

	it("answers 413 to more than MAX_CHANGES changes", () => {
		const changes = Array.from({ length: MAX_CHANGES + 1 }, () => ({}));
		expect(parsePushRequest({ protocol: PROTOCOL_VERSION, changes })).toEqual({
			ok: false,
			status: 413,
		});
	});
});
