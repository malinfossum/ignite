// Serialise and validate an Ignite backup. Pure: no DOM, no IndexedDB.
//
// Records are in MODEL shape (task booleans true/false). The writer projects
// every record onto the schema-v1 field list and fills the defaults
// tasks.create gives, because tasks made before some fields existed lack them
// (completedCount before 24.06.2026, hasTime before 13.08.2026). A value the
// reader would refuse is reset the same way. Without that, the strict reader
// would refuse a backup Ignite made itself, and the safety backup taken before
// every replace would be a file that can't be restored.

import { FOCUS_DEFAULT_SECTION_ID, FOCUS_ID } from "../model/areas.js";
import { isValidRecurrence, RECURRENCE_KEYS } from "../model/recurrence.js";
import { fileStamp } from "./backup-due.js";

export const BACKUP_APP = "ignite";
export const SCHEMA_VERSION = 1;
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export const NOT_A_BACKUP = "This file isn't an Ignite backup.";
export const BACKUP_TOO_BIG =
	"This file is over 10 MB, so it can't be an Ignite backup.";
const NEWER = "This backup was made by a newer Ignite. Update Ignite first.";

const TOP_KEYS = new Set([
	"app",
	"schemaVersion",
	"appVersion",
	"exportedAt",
	"areas",
	"sections",
	"tasks",
]);

const SCHEMA = {
	areas: {
		label: "area",
		fields: {
			id: "id",
			name: "string",
			icon: "string",
			critical: "boolean",
			order: "number",
		},
	},
	sections: {
		label: "section",
		fields: {
			id: "id",
			areaId: "id",
			name: "string",
			collapsed: "boolean",
			order: "number",
		},
	},
	tasks: {
		label: "task",
		fields: {
			id: "id",
			sectionId: "id",
			title: "title",
			notes: "string",
			completed: "boolean",
			starred: "boolean",
			critical: "boolean",
			dueAt: "isoOrNull",
			hasTime: "boolean",
			recurrence: "recurrence",
			lastCompletedAt: "isoOrNull",
			completedCount: "count",
			leadTime: "minutes",
			scheduledTags: "tags",
			createdAt: "iso",
			order: "number",
		},
	},
};
const STORES = Object.keys(SCHEMA);

// Defaults match tasks.create / sections.create / areas.create.
const DEFAULTS = {
	string: "",
	boolean: false,
	number: 0,
	isoOrNull: null,
	recurrence: null,
	count: 0,
	minutes: 0,
};

const ISO_RE =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isIso = (v) =>
	typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
const isPlainObject = (v) =>
	v !== null && typeof v === "object" && !Array.isArray(v);

const CHECKS = {
	id: (v) => typeof v === "string" && v.length > 0,
	string: (v) => typeof v === "string",
	title: (v) => typeof v === "string" && v.trim().length > 0,
	boolean: (v) => typeof v === "boolean",
	number: (v) => typeof v === "number" && Number.isFinite(v),
	count: (v) => Number.isInteger(v) && v >= 0,
	minutes: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
	iso: isIso,
	isoOrNull: (v) => v === null || isIso(v),
	recurrence: (v) => v === null || isValidRecurrence(v),
	tags: (v) => Array.isArray(v) && v.every((t) => typeof t === "string"),
};

// Coerce first (0/1 booleans, dates Date.parse can read, rule keys the model
// doesn't know), then keep the value only if the reader's own check passes.
// Anything else gets the default. Ids are never invented: a record without
// one can't exist in IndexedDB (it's the keyPath), and a missing areaId or
// sectionId is left for the reader to name.
function normalizeValue(value, kind) {
	if (kind === "boolean") return value === true || value === 1;
	if (
		(kind === "iso" || kind === "isoOrNull") &&
		typeof value === "string" &&
		!isIso(value)
	) {
		const ms = Date.parse(value);
		return Number.isNaN(ms) ? value : new Date(ms).toISOString();
	}
	if (kind === "recurrence" && isPlainObject(value)) {
		return Object.fromEntries(
			Object.entries(value).filter(([k]) => RECURRENCE_KEYS.has(k)),
		);
	}
	return value;
}

function normalizeRecord(record, fields, fallbackIso) {
	const out = {};
	for (const [key, kind] of Object.entries(fields)) {
		const value = normalizeValue(record[key], kind);
		if (value !== undefined && CHECKS[kind](value)) out[key] = value;
		else if (kind === "id") {
			if (value !== undefined) out[key] = value;
		} else if (kind === "title") out[key] = "Untitled task";
		else if (kind === "iso") out[key] = fallbackIso;
		else if (kind === "tags") out[key] = [];
		else out[key] = DEFAULTS[kind];
	}
	return out;
}

export function buildBackup(data, { appVersion, now }) {
	const exportedAt = now.toISOString();
	const backup = {
		app: BACKUP_APP,
		schemaVersion: SCHEMA_VERSION,
		appVersion,
		exportedAt,
	};
	for (const store of STORES) {
		backup[store] = data[store].map((r) =>
			normalizeRecord(r, SCHEMA[store].fields, exportedAt),
		);
	}
	return backup;
}

export const backupToJson = (backup) => JSON.stringify(backup, null, 2);
export const backupFileName = (now) => `ignite-backup-${fileStamp(now)}.json`;

const fail = (reason) => ({ ok: false, reason });
const damaged = (problem) => fail(`This backup is damaged: ${problem}.`);
const quote = (key) => `"${String(key).slice(0, 40)}"`;

function checkStore(store, records) {
	const { label, fields } = SCHEMA[store];
	const seen = new Set();
	for (let i = 0; i < records.length; i++) {
		const r = records[i];
		const n = i + 1;
		if (!isPlainObject(r)) return `${label} ${n} isn't a record`;
		for (const key of Object.keys(r)) {
			if (!Object.hasOwn(fields, key))
				return `${label} ${n} has an unknown field ${quote(key)}`;
		}
		for (const [key, kind] of Object.entries(fields)) {
			const missing = !Object.hasOwn(r, key);
			if (kind === "title" && (missing || !CHECKS.title(r[key])))
				return `${label} ${n} has no title`;
			if (missing) return `${label} ${n} has no ${key}`;
			if (!CHECKS[kind](r[key])) return `${label} ${n} has a bad ${key}`;
		}
		if (seen.has(r.id)) return `two ${label}s share the id ${quote(r.id)}`;
		seen.add(r.id);
	}
	return null;
}

function repairLinks({ areas, sections, tasks }) {
	const areaIds = new Set(areas.map((a) => a.id));
	const taskCount = new Map();
	for (const t of tasks)
		taskCount.set(t.sectionId, (taskCount.get(t.sectionId) ?? 0) + 1);

	const kept = [];
	const droppedIds = new Set();
	let droppedEmptySections = 0;
	for (const s of sections) {
		if (areaIds.has(s.areaId)) kept.push({ ...s });
		else {
			droppedIds.add(s.id);
			if (!taskCount.get(s.id)) droppedEmptySections++;
		}
	}
	const keptIds = new Set(kept.map((s) => s.id));
	let focusOrder = tasks
		.filter((t) => t.sectionId === FOCUS_DEFAULT_SECTION_ID)
		.reduce((max, t) => Math.max(max, t.order), -1);
	let tasksFromMissingArea = 0;
	let tasksFromMissingSection = 0;
	const outTasks = tasks.map((t) => {
		if (keptIds.has(t.sectionId)) return { ...t };
		if (droppedIds.has(t.sectionId)) tasksFromMissingArea++;
		else tasksFromMissingSection++;
		focusOrder += 1;
		return { ...t, sectionId: FOCUS_DEFAULT_SECTION_ID, order: focusOrder };
	});
	return {
		data: {
			areas: areas.map((a) => ({ ...a })),
			sections: kept,
			tasks: outTasks,
		},
		repairs: {
			droppedEmptySections,
			tasksFromMissingArea,
			tasksFromMissingSection,
		},
	};
}

export function validateBackup(text) {
	if (typeof text !== "string") return fail(NOT_A_BACKUP);
	if (text.length > MAX_BACKUP_BYTES) return fail(BACKUP_TOO_BIG);
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		return fail(NOT_A_BACKUP);
	}
	if (!isPlainObject(json) || json.app !== BACKUP_APP)
		return fail(NOT_A_BACKUP);
	if (!Number.isInteger(json.schemaVersion) || json.schemaVersion < 1)
		return fail(NOT_A_BACKUP);
	if (json.schemaVersion > SCHEMA_VERSION) return fail(NEWER);
	// schemaVersion 1 is the only version so far. A later version adds a
	// migration step here that lifts older files forward before the checks.
	for (const key of Object.keys(json)) {
		if (!TOP_KEYS.has(key))
			return damaged(`it has an unknown field ${quote(key)}`);
	}
	if (!isIso(json.exportedAt)) return damaged("it has no export date");
	for (const store of STORES) {
		if (!Array.isArray(json[store]))
			return damaged(`it has no ${SCHEMA[store].label} list`);
		const problem = checkStore(store, json[store]);
		if (problem) return damaged(problem);
	}
	if (!json.areas.some((a) => a.id === FOCUS_ID))
		return damaged("the Focus area is missing");
	if (
		!json.sections.some(
			(s) => s.id === FOCUS_DEFAULT_SECTION_ID && s.areaId === FOCUS_ID,
		)
	) {
		return damaged("the Focus notepad is missing");
	}
	const { data, repairs } = repairLinks(json);
	return { ok: true, data, repairs };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function describeRepairs({
	droppedEmptySections,
	tasksFromMissingArea,
	tasksFromMissingSection,
}) {
	const lines = [];
	if (droppedEmptySections > 0) {
		lines.push(
			`${plural(droppedEmptySections, "empty section")} whose area is missing ${droppedEmptySections === 1 ? "is" : "are"} left out.`,
		);
	}
	if (tasksFromMissingArea > 0) {
		lines.push(
			`${plural(tasksFromMissingArea, "task")} whose area is missing ${tasksFromMissingArea === 1 ? "goes" : "go"} to the Focus notepad.`,
		);
	}
	if (tasksFromMissingSection > 0) {
		lines.push(
			`${plural(tasksFromMissingSection, "task")} whose section is missing ${tasksFromMissingSection === 1 ? "goes" : "go"} to the Focus notepad.`,
		);
	}
	return lines;
}

export function describeCounts({ areas, sections, tasks }) {
	return `${plural(areas.length, "area")}, ${plural(sections.length, "section")} and ${plural(tasks.length, "task")}`;
}
