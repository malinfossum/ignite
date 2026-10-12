// POST /api/sync/push (spec §6.1). One transaction per push, serialised per
// user by a transaction-scoped advisory lock, so server_seq values become
// visible in the order they were handed out and a pull can never skip one (D13).

import {
	and,
	eq,
	getTableColumns,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import {
	keyOf,
	type PushResponse,
	type Row,
	type ServerVersion,
	STORES,
	type Store,
} from "../../shared/protocol.ts";
import type { Database } from "./db.ts";
import { clampUpdatedAt, decide } from "./decide.ts";
import { ERROR_TEXT } from "./http.ts";
import {
	type DataInsert,
	type DataTable,
	recordToRow,
	rowToRecord,
	tableFor,
} from "./records.ts";
import { NEXT_SERVER_SEQ, tombstones } from "./schema.ts";
import {
	type ParsedChange,
	parseChange,
	parsePushRequest,
} from "./validate.ts";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type PushPlan = {
	upserts: { store: Store; record: Row }[];
	deletes: { store: Store; id: string; deletedAt: string }[];
	clearTombstones: { store: Store; id: string }[];
	response: PushResponse;
};

function keyParts(parsed: ParsedChange): { store: Store; id: string } | null {
	if (parsed.ok) return { store: parsed.change.store, id: parsed.change.id };
	return parsed.store && parsed.id
		? { store: parsed.store, id: parsed.id }
		: null;
}

function serverVersion(
	store: Store,
	id: string,
	rows: Map<string, Row>,
	tombs: Map<string, string>,
): ServerVersion {
	const key = keyOf(store, id);
	const record = rows.get(key);
	if (record) return { store, id, kind: "row", record };
	const deletedAt = tombs.get(key);
	if (deletedAt) return { store, id, kind: "tombstone", deletedAt };
	return { store, id, kind: "none" };
}

// Pure: decides every change against what the server holds. A key has a row or
// a tombstone, never both, so "current" is whichever exists.
export function planPush(
	parsed: ParsedChange[],
	rows: Map<string, Row>,
	tombs: Map<string, string>,
	now: Date,
): PushPlan {
	const plan: PushPlan = {
		upserts: [],
		deletes: [],
		clearTombstones: [],
		response: { accepted: [], lost: [], invalid: [] },
	};

	const seen = new Map<string, number>();
	for (const p of parsed) {
		const parts = keyParts(p);
		if (parts) {
			const key = keyOf(parts.store, parts.id);
			seen.set(key, (seen.get(key) ?? 0) + 1);
		}
	}

	const reported = new Set<string>();
	for (const p of parsed) {
		const parts = keyParts(p);
		if (!parts) continue; // nothing to report it under
		const key = keyOf(parts.store, parts.id);
		const current = serverVersion(parts.store, parts.id, rows, tombs);

		if (!p.ok || (seen.get(key) ?? 0) > 1) {
			if (!reported.has(key)) {
				reported.add(key);
				plan.response.invalid.push(current);
			}
			continue;
		}

		const currentAt =
			current.kind === "row"
				? String(current.record.updatedAt)
				: current.kind === "tombstone"
					? current.deletedAt
					: null;
		const change = p.change;

		if (change.op === "put") {
			const record = {
				...change.record,
				updatedAt: clampUpdatedAt(String(change.record.updatedAt), now),
			};
			if (decide(record.updatedAt, currentAt) === "lose") {
				plan.response.lost.push(current);
				continue;
			}
			plan.upserts.push({ store: change.store, record });
			if (current.kind === "tombstone") {
				plan.clearTombstones.push({ store: change.store, id: change.id });
			}
		} else {
			const deletedAt = clampUpdatedAt(change.deletedAt, now);
			if (decide(deletedAt, currentAt) === "lose") {
				plan.response.lost.push(current);
				continue;
			}
			plan.deletes.push({ store: change.store, id: change.id, deletedAt });
		}
		plan.response.accepted.push(key);
	}
	return plan;
}

function idsByStore(
	items: { store: Store; id: string }[],
): Map<Store, string[]> {
	const out = new Map<Store, string[]>();
	for (const { store, id } of items) {
		const list = out.get(store) ?? [];
		list.push(id);
		out.set(store, list);
	}
	return out;
}

async function readCurrent(
	tx: Tx,
	userId: string,
	keys: { store: Store; id: string }[],
): Promise<{ rows: Map<string, Row>; tombs: Map<string, string> }> {
	const rows = new Map<string, Row>();
	for (const [store, ids] of idsByStore(keys)) {
		const table = tableFor(store);
		const found = await tx
			.select()
			.from(table)
			.where(and(eq(table.userId, userId), inArray(table.id, ids)));
		for (const row of found) rows.set(keyOf(store, row.id), rowToRecord(row));
	}

	const tombs = new Map<string, string>();
	const allIds = [...new Set(keys.map((k) => k.id))];
	if (allIds.length > 0) {
		const found = await tx
			.select()
			.from(tombstones)
			.where(
				and(eq(tombstones.userId, userId), inArray(tombstones.id, allIds)),
			);
		for (const t of found)
			tombs.set(keyOf(t.store, t.id), t.deletedAt.toISOString());
	}
	return { rows, tombs };
}

// ON CONFLICT … DO UPDATE SET col = excluded.col for every column but the key,
// and a fresh server_seq, so an accepted edit always moves the cursor.
function excludedSet(table: DataTable): Record<string, SQL> {
	const set: Record<string, SQL> = {};
	for (const [key, column] of Object.entries(getTableColumns(table))) {
		if (key === "userId" || key === "id") continue;
		set[key] =
			key === "serverSeq"
				? NEXT_SERVER_SEQ
				: sql`excluded.${sql.identifier(column.name)}`;
	}
	return set;
}

async function writePlan(
	tx: Tx,
	userId: string,
	plan: PushPlan,
): Promise<void> {
	for (const store of STORES) {
		const table = tableFor(store);
		const values: DataInsert[] = plan.upserts
			.filter((u) => u.store === store)
			.map((u) => recordToRow(userId, u.record));
		if (values.length > 0) {
			await tx
				.insert(table)
				.values(values)
				.onConflictDoUpdate({
					target: [table.userId, table.id],
					set: excludedSet(table),
				});
		}
		const deleted = plan.deletes
			.filter((d) => d.store === store)
			.map((d) => d.id);
		if (deleted.length > 0) {
			await tx
				.delete(table)
				.where(and(eq(table.userId, userId), inArray(table.id, deleted)));
		}
	}

	// A put that beat a tombstone brings the row back: the tombstone goes.
	if (plan.clearTombstones.length > 0) {
		const byStore = [...idsByStore(plan.clearTombstones)].map(([store, ids]) =>
			and(eq(tombstones.store, store), inArray(tombstones.id, ids)),
		);
		await tx
			.delete(tombstones)
			.where(and(eq(tombstones.userId, userId), or(...byStore)));
	}

	// A delete leaves a content-free tombstone that competes like a row (D5).
	if (plan.deletes.length > 0) {
		await tx
			.insert(tombstones)
			.values(
				plan.deletes.map((d) => ({
					userId,
					store: d.store,
					id: d.id,
					deletedAt: new Date(d.deletedAt),
				})),
			)
			.onConflictDoUpdate({
				target: [tombstones.userId, tombstones.store, tombstones.id],
				set: {
					deletedAt: sql`excluded.deleted_at`,
					serverSeq: NEXT_SERVER_SEQ,
				},
			});
	}
}

export async function handlePush(
	db: Database,
	userId: string,
	body: unknown,
	now: Date = new Date(),
): Promise<{ status: number; json: unknown }> {
	const request = parsePushRequest(body);
	if (!request.ok) {
		return {
			status: request.status,
			json: { error: ERROR_TEXT[request.status] },
		};
	}
	const parsed = request.changes.map(parseChange);
	const keys = parsed.map(keyParts).filter((k) => k !== null);

	const response = await db.transaction(async (tx) => {
		// First statement, always: one push per user at a time (D13).
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
		const { rows, tombs } = await readCurrent(tx, userId, keys);
		const plan = planPush(parsed, rows, tombs, now);
		await writePlan(tx, userId, plan);
		return plan.response;
	});

	// Counts only: never a key, a title or an email (spec §9).
	console.log(
		JSON.stringify({
			route: "push",
			changes: parsed.length,
			accepted: response.accepted.length,
			lost: response.lost.length,
			invalid: response.invalid.length,
		}),
	);
	return { status: 200, json: response };
}
