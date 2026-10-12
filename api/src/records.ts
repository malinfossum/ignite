// Server row ↔ wire record. The table keys are the wire field names, so this
// only drops the two server columns and converts dates.

import type { Row, Store } from "../../shared/protocol.ts";
import { areas, sections, settings, tasks } from "./schema.ts";

// Drizzle's types can't narrow a union of four tables, so code that loops over
// stores sees every data table as the tasks table. At runtime Drizzle always
// uses the real table object. Such code may only name the columns all four
// share: userId, id, updatedAt and serverSeq.
export type DataTable = typeof tasks;
export type DataInsert = typeof tasks.$inferInsert;

const TABLES = { areas, sections, tasks, settings };

export function tableFor(store: Store): DataTable {
	return TABLES[store] as unknown as DataTable;
}

const DATE_FIELDS = ["dueAt", "lastCompletedAt", "createdAt", "updatedAt"];

export function rowToRecord(row: Record<string, unknown>): Row {
	const out: Row = {};
	for (const [key, value] of Object.entries(row)) {
		if (key === "userId" || key === "serverSeq") continue;
		out[key] = value instanceof Date ? value.toISOString() : value;
	}
	return out;
}

// The record has passed validate.ts. userId always comes from the session.
export function recordToRow(userId: string, record: Row): DataInsert {
	const out: Record<string, unknown> = { ...record, userId };
	for (const field of DATE_FIELDS) {
		const value = out[field];
		if (typeof value === "string") out[field] = new Date(value);
	}
	return out as DataInsert;
}
