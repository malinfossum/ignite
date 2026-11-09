import { describe, expect, it } from "vitest";
import {
	BACKUP_TOO_BIG,
	backupFileName,
	backupToJson,
	buildBackup,
	describeCounts,
	describeRepairs,
	MAX_BACKUP_BYTES,
	NOT_A_BACKUP,
	validateBackup,
} from "../../src/backup/backup-format.js";

const NOW = new Date(2026, 10, 9, 13, 20);
const focusArea = {
	id: "focus",
	name: "Focus",
	icon: "🔥",
	critical: false,
	order: 0,
};
const focusSection = {
	id: "focus-default",
	areaId: "focus",
	name: "Tasks",
	collapsed: false,
	order: 0,
};
const area = { id: "a1", name: "Home", icon: "🏠", critical: false, order: 1 };
const section = {
	id: "s1",
	areaId: "a1",
	name: "Chores",
	collapsed: false,
	order: 0,
};
const task = (over = {}) => ({
	id: "t1",
	sectionId: "s1",
	title: "Water plants",
	notes: "",
	completed: false,
	starred: true,
	critical: false,
	dueAt: "2026-11-10T08:00:00.000Z",
	hasTime: true,
	recurrence: { type: "weekly", interval: 1, weekdays: [1] },
	lastCompletedAt: null,
	completedCount: 2,
	leadTime: 15,
	scheduledTags: [],
	createdAt: "2026-10-01T10:00:00.000Z",
	order: 0,
	...over,
});
// A task as the database holds it for rows made before hasTime, completedCount
// and lastCompletedAt existed: those keys are absent, not null.
const legacyTask = (over = {}) => ({
	id: "t9",
	sectionId: "s1",
	title: "From April",
	completed: false,
	starred: false,
	critical: false,
	dueAt: null,
	recurrence: null,
	leadTime: 0,
	scheduledTags: [],
	createdAt: "2026-04-26T10:00:00.000Z",
	order: 1,
	notes: "",
	...over,
});
const db = (over = {}) => ({
	areas: [focusArea, area],
	sections: [focusSection, section],
	tasks: [task()],
	...over,
});
const text = (data) =>
	backupToJson(buildBackup(data, { appVersion: "0.9.0", now: NOW }));
const damaged = (mutate) => {
	const json = JSON.parse(text(db()));
	mutate(json);
	return validateBackup(JSON.stringify(json));
};

describe("buildBackup", () => {
	it("writes the header", () => {
		const b = buildBackup(db(), { appVersion: "0.9.0", now: NOW });
		expect(b.app).toBe("ignite");
		expect(b.schemaVersion).toBe(1);
		expect(b.appVersion).toBe("0.9.0");
		expect(b.exportedAt).toBe(NOW.toISOString());
	});

	it("fills defaults for fields an old record never had (Review Focus 1)", () => {
		const old = legacyTask();
		expect(Object.hasOwn(old, "hasTime")).toBe(false);
		expect(Object.hasOwn(old, "completedCount")).toBe(false);
		expect(Object.hasOwn(old, "lastCompletedAt")).toBe(false);
		const b = buildBackup(db({ tasks: [old] }), {
			appVersion: "0.9.0",
			now: NOW,
		});
		expect(b.tasks[0]).toMatchObject({
			hasTime: false,
			completedCount: 0,
			lastCompletedAt: null,
		});
		expect(validateBackup(backupToJson(b)).ok).toBe(true);
	});

	it("drops keys outside the schema and coerces stored 0/1 booleans", () => {
		const b = buildBackup(
			db({ areas: [focusArea, { ...area, critical: 1, legacy: "x" }] }),
			{ appVersion: "0.9.0", now: NOW },
		);
		expect(b.areas[1]).toEqual({ ...area, critical: true });
	});

	it("writes a file its own reader accepts, whatever an odd record holds", () => {
		// A backup that can't be restored is no backup. Every value the reader
		// would refuse is reset to the default tasks.create gives.
		const odd = {
			id: "t8",
			sectionId: "s1",
			title: " ",
			notes: null,
			completed: 0,
			starred: "yes",
			critical: undefined,
			dueAt: "Tue, 10 Nov 2026 07:00:00 GMT",
			hasTime: 1,
			recurrence: { type: "weekly", interval: 1, weekdays: [1], legacy: true },
			lastCompletedAt: "garbage",
			completedCount: -1,
			leadTime: null,
			scheduledTags: null,
			createdAt: 5,
			order: Number.NaN,
		};
		const b = buildBackup(db({ tasks: [odd] }), {
			appVersion: "0.9.0",
			now: NOW,
		});
		expect(validateBackup(backupToJson(b)).ok).toBe(true);
		expect(b.tasks[0]).toMatchObject({
			title: "Untitled task",
			notes: "",
			completed: false,
			starred: false,
			critical: false,
			dueAt: "2026-11-10T07:00:00.000Z",
			hasTime: true,
			recurrence: { type: "weekly", interval: 1, weekdays: [1] },
			lastCompletedAt: null,
			completedCount: 0,
			leadTime: 0,
			scheduledTags: [],
			createdAt: NOW.toISOString(),
			order: 0,
		});
	});
});

describe("validateBackup round trip", () => {
	it("restores what it wrote", () => {
		const result = validateBackup(text(db()));
		expect(result.ok).toBe(true);
		expect(result.data).toEqual(db());
		expect(result.repairs).toEqual({
			droppedEmptySections: 0,
			tasksFromMissingArea: 0,
			tasksFromMissingSection: 0,
		});
	});

	it("restores a backup of a database whose tasks predate newer fields", () => {
		const old = legacyTask({ dueAt: "2026-05-01T08:00:00.000Z" });
		const result = validateBackup(text(db({ tasks: [old] })));
		expect(result.ok).toBe(true);
		expect(result.data.tasks[0]).toMatchObject({
			hasTime: false,
			completedCount: 0,
			lastCompletedAt: null,
		});
	});
});

describe("validateBackup refusals", () => {
	it("refuses text that isn't JSON", () => {
		expect(validateBackup("{nope")).toEqual({
			ok: false,
			reason: NOT_A_BACKUP,
		});
	});
	it("refuses a file over 10 MB before parsing", () => {
		expect(validateBackup(" ".repeat(MAX_BACKUP_BYTES + 1))).toEqual({
			ok: false,
			reason: BACKUP_TOO_BIG,
		});
	});
	it("refuses another app's file", () => {
		expect(
			damaged((j) => {
				j.app = "other";
			}),
		).toEqual({ ok: false, reason: NOT_A_BACKUP });
	});
	it("refuses a newer schema", () => {
		expect(
			damaged((j) => {
				j.schemaVersion = 2;
			}).reason,
		).toBe("This backup was made by a newer Ignite. Update Ignite first.");
	});
	it("names a missing title", () => {
		expect(
			damaged((j) => {
				delete j.tasks[0].title;
			}).reason,
		).toBe("This backup is damaged: task 1 has no title.");
	});
	it("names an empty title", () => {
		expect(
			damaged((j) => {
				j.tasks[0].title = "  ";
			}).reason,
		).toBe("This backup is damaged: task 1 has no title.");
	});
	it("names a missing field", () => {
		expect(
			damaged((j) => {
				delete j.sections[1].areaId;
			}).reason,
		).toBe("This backup is damaged: section 2 has no areaId.");
	});
	it("names a wrong type", () => {
		expect(
			damaged((j) => {
				j.tasks[0].starred = "yes";
			}).reason,
		).toBe("This backup is damaged: task 1 has a bad starred.");
	});
	it("refuses a bad date", () => {
		expect(
			damaged((j) => {
				j.tasks[0].dueAt = "next week";
			}).reason,
		).toBe("This backup is damaged: task 1 has a bad dueAt.");
	});
	it("refuses a bad recurrence", () => {
		expect(
			damaged((j) => {
				j.tasks[0].recurrence = { type: "weekly", weekdays: [] };
			}).reason,
		).toBe("This backup is damaged: task 1 has a bad recurrence.");
	});
	it("refuses an unknown key", () => {
		expect(
			damaged((j) => {
				j.areas[0].colour = "red";
			}).reason,
		).toBe('This backup is damaged: area 1 has an unknown field "colour".');
	});
	it("refuses a __proto__ key without polluting anything", () => {
		const raw = text(db()).replace(
			'"title": "Water plants"',
			'"title": "Water plants", "__proto__": { "polluted": true }',
		);
		expect(validateBackup(raw).reason).toBe(
			'This backup is damaged: task 1 has an unknown field "__proto__".',
		);
		expect({}.polluted).toBeUndefined();
	});
	it("refuses a duplicate id", () => {
		expect(
			damaged((j) => {
				j.tasks.push({ ...j.tasks[0] });
			}).reason,
		).toBe('This backup is damaged: two tasks share the id "t1".');
	});
	it("refuses a missing Focus area", () => {
		expect(
			damaged((j) => {
				j.areas.shift();
			}).reason,
		).toBe("This backup is damaged: the Focus area is missing.");
	});
	it("refuses a missing Focus notepad", () => {
		expect(
			damaged((j) => {
				j.sections.shift();
			}).reason,
		).toBe("This backup is damaged: the Focus notepad is missing.");
	});
});

describe("orphan repairs", () => {
	it("drops a section with no area and no tasks", () => {
		const orphan = {
			id: "s9",
			areaId: "gone",
			name: "Lost",
			collapsed: false,
			order: 0,
		};
		const result = validateBackup(
			text(db({ sections: [focusSection, section, orphan] })),
		);
		expect(result.ok).toBe(true);
		expect(result.data.sections.map((s) => s.id)).toEqual([
			"focus-default",
			"s1",
		]);
		expect(result.repairs.droppedEmptySections).toBe(1);
	});

	it("moves the tasks of an area-less section to the Focus notepad", () => {
		const orphan = {
			id: "s9",
			areaId: "gone",
			name: "Lost",
			collapsed: false,
			order: 0,
		};
		const inFocus = task({ id: "f1", sectionId: "focus-default", order: 4 });
		const lost = task({ id: "t9", sectionId: "s9" });
		const result = validateBackup(
			text(
				db({
					sections: [focusSection, section, orphan],
					tasks: [inFocus, lost],
				}),
			),
		);
		const moved = result.data.tasks.find((t) => t.id === "t9");
		expect(moved.sectionId).toBe("focus-default");
		expect(moved.order).toBe(5);
		expect(result.repairs.tasksFromMissingArea).toBe(1);
	});

	it("moves a task with no section to the Focus notepad", () => {
		const result = validateBackup(
			text(db({ tasks: [task({ sectionId: "nowhere" })] })),
		);
		expect(result.data.tasks[0].sectionId).toBe("focus-default");
		expect(result.repairs.tasksFromMissingSection).toBe(1);
	});

	it("restores a backup of a database holding an orphan section row", () => {
		// The case Malin's dev database is in: a sections row whose areaId matches no area.
		const orphan = {
			id: "s9",
			areaId: "gone",
			name: "Lost",
			collapsed: false,
			order: 0,
		};
		expect(
			validateBackup(text(db({ sections: [focusSection, section, orphan] })))
				.ok,
		).toBe(true);
	});
});

describe("descriptions", () => {
	it("describes repairs in counts", () => {
		expect(
			describeRepairs({
				droppedEmptySections: 1,
				tasksFromMissingArea: 2,
				tasksFromMissingSection: 1,
			}),
		).toEqual([
			"1 empty section whose area is missing is left out.",
			"2 tasks whose area is missing go to the Focus notepad.",
			"1 task whose section is missing goes to the Focus notepad.",
		]);
		expect(
			describeRepairs({
				droppedEmptySections: 0,
				tasksFromMissingArea: 0,
				tasksFromMissingSection: 0,
			}),
		).toEqual([]);
	});
	it("describes counts", () => {
		expect(describeCounts(db())).toBe("2 areas, 2 sections and 1 task");
	});
	it("names the file", () => {
		expect(backupFileName(NOW)).toBe("ignite-backup-2026-11-09-1320.json");
	});
});
