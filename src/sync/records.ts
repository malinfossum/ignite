// Stored row ↔ wire record. The server's schemas are strict, so the wire record
// is BUILT from a field list with defaults, never forwarded as the stored row.

import { EPOCH, type Store } from "../../shared/protocol";

type Row = Record<string, unknown>;

const TASK_FLAGS = ["completed", "starred", "critical", "hasTime"] as const;

// Field → default when the stored row lacks it (rows from older versions).
// The defaults match createTaskModel().create() and createAreaModel().create().
const FIELDS: Record<Store, Row> = {
	areas: {
		id: undefined,
		name: "",
		icon: "",
		critical: false,
		order: 0,
		updatedAt: EPOCH,
	},
	sections: {
		id: undefined,
		areaId: undefined,
		name: "",
		collapsed: false,
		order: 0,
		updatedAt: EPOCH,
	},
	tasks: {
		id: undefined,
		sectionId: undefined,
		title: "",
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
		createdAt: undefined,
		order: 0,
		updatedAt: EPOCH,
	},
	settings: { id: undefined, quietStart: 23, quietEnd: 7, updatedAt: EPOCH },
};

export function toWire(store: Store, row: Row): Row {
	const out: Row = {};
	for (const [field, fallback] of Object.entries(FIELDS[store])) {
		out[field] = row[field] ?? fallback;
	}
	if (store === "tasks") {
		for (const flag of TASK_FLAGS)
			out[flag] = row[flag] === 1 || row[flag] === true;
		// A task from before createdAt existed borrows its edit time.
		out.createdAt ??= out.updatedAt;
	}
	return out;
}

export function fromWire(store: Store, record: Row): Row {
	const out: Row = { ...record };
	if (store === "tasks") {
		for (const flag of TASK_FLAGS) {
			if (flag in out) out[flag] = out[flag] ? 1 : 0;
		}
	}
	return out;
}

// Settings sync only the quiet hours. The theme and the sidebar state belong to
// this device and survive every pull.
export function mergeSettings(local: Row | undefined, remote: Row): Row {
	return {
		...(local ?? { id: remote.id }),
		quietStart: remote.quietStart,
		quietEnd: remote.quietEnd,
		updatedAt: remote.updatedAt,
	};
}
