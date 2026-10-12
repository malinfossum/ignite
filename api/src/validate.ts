// The push boundary (spec §5.3). The client is not trusted: every change is
// parsed here before it reaches Drizzle. Records are strict (an unknown key
// fails the change), sized, and typed at least as strictly as their columns,
// so a bad row fails here as `invalid` instead of failing the whole push
// transaction in Postgres.

import { z } from "zod";
import {
	type Change,
	MAX_CHANGES,
	PROTOCOL_VERSION,
	STORES,
	type Store,
} from "../../shared/protocol.ts";

export const NAME_MAX = 1_000;
export const NOTES_MAX = 20_000;
const ICON_MAX = 32;
const ID_MAX = 100;
const TAGS_MAX = 100;

// Counts code points, not UTF-16 units: an emoji is one character to a person
// but two units to String.length, which is what Zod's .max() counts. A string
// never has more code points than units, and a code point is at most two units,
// so only strings between max and 2 × max units need counting.
export function withinLength(value: string, max: number): boolean {
	if (value.length <= max) return true;
	if (value.length > max * 2) return false;
	return [...value].length <= max;
}

// Postgres text refuses a NUL byte, and jsonb refuses a lone surrogate. Either
// would fail the whole push transaction with a 500 and jam the queue, so they
// fail here as one invalid change. A regex, because the api lib is ES2023 and
// String.prototype.isWellFormed() is ES2024.
const BAD_TEXT =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the NUL is what this rejects.
	/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const text = (max: number) =>
	z
		.string()
		.refine((value) => !BAD_TEXT.test(value), "Not storable text")
		.refine((value) => withinLength(value, max), `At most ${max} characters`);

// Exactly what Date.prototype.toISOString() produces. The round trip rejects
// days that don't exist (JavaScript rolls 2026-02-31 into March, Postgres
// refuses it), and it means a date comes back from Postgres byte for byte.
const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isIsoDate(value: string): boolean {
	if (!ISO_SHAPE.test(value)) return false;
	const time = Date.parse(value);
	return Number.isFinite(time) && new Date(time).toISOString() === value;
}

const isoDate = z.string().refine(isIsoDate, "Not an ISO date");
const id = z
	.string()
	.min(1)
	.max(ID_MAX)
	.refine((value) => !BAD_TEXT.test(value), "Not storable text");
const count = z.int32().min(0);
const interval = z.number().optional();

const recurrence = z
	.discriminatedUnion("type", [
		z.strictObject({ type: z.literal("daily"), interval }),
		z.strictObject({
			type: z.literal("weekly"),
			interval,
			weekdays: z.array(z.int().min(0).max(6)).max(7),
		}),
		z.strictObject({
			type: z.literal("monthly"),
			interval,
			day: z.int().min(1).max(31),
		}),
		z.strictObject({
			type: z.literal("yearly"),
			interval,
			month: z.int().min(1).max(12),
			day: z.int().min(1).max(31),
		}),
	])
	.nullable();

// One schema per store, field for field what toWire() builds (Task 4).
const RECORDS = {
	areas: z.strictObject({
		id,
		name: text(NAME_MAX),
		icon: text(ICON_MAX),
		critical: z.boolean(),
		order: z.int32(),
		updatedAt: isoDate,
	}),
	sections: z.strictObject({
		id,
		areaId: id,
		name: text(NAME_MAX),
		collapsed: z.boolean(),
		order: z.int32(),
		updatedAt: isoDate,
	}),
	tasks: z.strictObject({
		id,
		sectionId: id,
		title: text(NAME_MAX),
		notes: text(NOTES_MAX),
		completed: z.boolean(),
		starred: z.boolean(),
		critical: z.boolean(),
		dueAt: isoDate.nullable(),
		hasTime: z.boolean(),
		recurrence,
		lastCompletedAt: isoDate.nullable(),
		completedCount: count,
		leadTime: count,
		scheduledTags: z.array(text(NAME_MAX)).max(TAGS_MAX),
		createdAt: isoDate,
		order: z.int32(),
		updatedAt: isoDate,
	}),
	// Only the synced fields (spec §4.3). A theme here fails the change.
	settings: z.strictObject({
		id: z.literal("app"),
		quietStart: z.int().min(0).max(23),
		quietEnd: z.int().min(0).max(23),
		updatedAt: isoDate,
	}),
} satisfies Record<Store, z.ZodType>;

const store = z.enum(STORES);

const envelope = z.discriminatedUnion("op", [
	z.strictObject({ store, id, op: z.literal("put"), record: z.unknown() }),
	z.strictObject({ store, id, op: z.literal("delete"), deletedAt: isoDate }),
]);

export type ParsedChange =
	| { ok: true; change: Change }
	| { ok: false; store: Store | null; id: string | null };

// The body is already JSON-parsed and under MAX_BODY_BYTES (index.ts checks
// the bytes). The protocol is checked first, so a client from another
// protocol gets 426 whatever shape its body has.
export function parsePushRequest(
	body: unknown,
): { ok: true; changes: unknown[] } | { ok: false; status: 400 | 413 | 426 } {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return { ok: false, status: 400 };
	}
	const request = body as Record<string, unknown>;
	if (request.protocol !== PROTOCOL_VERSION) return { ok: false, status: 426 };
	if (!Array.isArray(request.changes)) return { ok: false, status: 400 };
	if (request.changes.length > MAX_CHANGES) return { ok: false, status: 413 };
	return { ok: true, changes: request.changes };
}

// A failure reports whatever store and id could be read, so push can answer
// with the server's version of that key. A change with neither has no key to
// report and is dropped silently (shared/protocol.ts, PushResponse).
export function parseChange(raw: unknown): ParsedChange {
	const fields =
		typeof raw === "object" && raw !== null
			? (raw as Record<string, unknown>)
			: {};
	const readStore = store.safeParse(fields.store);
	const readId = id.safeParse(fields.id);
	const failed: ParsedChange = {
		ok: false,
		store: readStore.success ? readStore.data : null,
		id: readId.success ? readId.data : null,
	};

	const parsed = envelope.safeParse(raw);
	if (!parsed.success) return failed;
	const change = parsed.data;
	if (change.op === "delete") return { ok: true, change };

	const record = RECORDS[change.store].safeParse(change.record);
	if (!record.success || record.data.id !== change.id) return failed;
	return {
		ok: true,
		change: {
			store: change.store,
			id: change.id,
			op: "put",
			record: record.data,
		},
	};
}
