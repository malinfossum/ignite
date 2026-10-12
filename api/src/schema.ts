// Server tables (spec §5.2). Real columns that mirror the client's records, and
// the TypeScript keys are the wire field names (see records.ts).
//
// Every data table is keyed by (user_id, id): every install seeds the same
// "focus" and "focus-default" ids, so an id alone is not unique across accounts.
// There are no foreign keys between data tables, on purpose: a task can arrive
// before its section.

import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgSequence,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import type { Store } from "../../shared/protocol.ts";
import { user } from "./auth-schema.ts";

export * from "./auth-schema.ts";

// One sequence for every data table and for tombstones, so a single cursor
// orders all of a user's changes.
export const serverSeq = pgSequence("server_seq_seq");
export const NEXT_SERVER_SEQ = sql`nextval('server_seq_seq')`;

export type Recurrence =
	| { type: "daily"; interval?: number }
	| { type: "weekly"; interval?: number; weekdays: number[] }
	| { type: "monthly"; interval?: number; day: number }
	| { type: "yearly"; interval?: number; month: number; day: number };

// Deleting a user deletes every row and tombstone they own (spec §5.2, §14).
const owner = () =>
	text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" });
const seq = () =>
	bigint("server_seq", { mode: "number" }).notNull().default(NEXT_SERVER_SEQ);
const instant = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });

export const areas = pgTable(
	"areas",
	{
		userId: owner(),
		id: text("id").notNull(),
		name: text("name").notNull(),
		icon: text("icon").notNull(),
		critical: boolean("critical").notNull(),
		order: integer("order").notNull(),
		updatedAt: instant("updated_at").notNull(),
		serverSeq: seq(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.id] }),
		index("areas_user_seq_idx").on(t.userId, t.serverSeq),
	],
);

export const sections = pgTable(
	"sections",
	{
		userId: owner(),
		id: text("id").notNull(),
		areaId: text("area_id").notNull(),
		name: text("name").notNull(),
		collapsed: boolean("collapsed").notNull(),
		order: integer("order").notNull(),
		updatedAt: instant("updated_at").notNull(),
		serverSeq: seq(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.id] }),
		index("sections_user_seq_idx").on(t.userId, t.serverSeq),
	],
);

export const tasks = pgTable(
	"tasks",
	{
		userId: owner(),
		id: text("id").notNull(),
		sectionId: text("section_id").notNull(),
		title: text("title").notNull(),
		notes: text("notes").notNull(),
		completed: boolean("completed").notNull(),
		starred: boolean("starred").notNull(),
		critical: boolean("critical").notNull(),
		dueAt: instant("due_at"),
		hasTime: boolean("has_time").notNull(),
		recurrence: jsonb("recurrence").$type<Recurrence>(),
		lastCompletedAt: instant("last_completed_at"),
		completedCount: integer("completed_count").notNull(),
		leadTime: integer("lead_time").notNull(),
		scheduledTags: jsonb("scheduled_tags").$type<string[]>().notNull(),
		createdAt: instant("created_at").notNull(),
		order: integer("order").notNull(),
		updatedAt: instant("updated_at").notNull(),
		serverSeq: seq(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.id] }),
		index("tasks_user_seq_idx").on(t.userId, t.serverSeq),
	],
);

// Only the synced settings fields (spec §4.3). The theme and the sidebar state
// never leave the device.
export const settings = pgTable(
	"settings",
	{
		userId: owner(),
		id: text("id").notNull(),
		quietStart: integer("quiet_start").notNull(),
		quietEnd: integer("quiet_end").notNull(),
		updatedAt: instant("updated_at").notNull(),
		serverSeq: seq(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.id] }),
		index("settings_user_seq_idx").on(t.userId, t.serverSeq),
	],
);

// A deleted row leaves a tombstone with no content (spec §5.2, D5), so a
// deleted title does not live on here.
export const tombstones = pgTable(
	"tombstones",
	{
		userId: owner(),
		store: text("store").$type<Store>().notNull(),
		id: text("id").notNull(),
		deletedAt: instant("deleted_at").notNull(),
		serverSeq: seq(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.store, t.id] }),
		index("tombstones_user_seq_idx").on(t.userId, t.serverSeq),
	],
);
