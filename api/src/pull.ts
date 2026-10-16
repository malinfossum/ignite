// GET /api/sync/pull?since=<seq>&protocol=1 (spec §6.2). This user's rows and
// tombstones with server_seq > since, oldest first, in pages of PULL_LIMIT.

import { and, asc, eq, gt } from "drizzle-orm";
import {
	PROTOCOL_VERSION,
	PULL_LIMIT,
	type PulledChange,
	type PullResponse,
	STORES,
} from "../../shared/protocol.ts";
import type { Database } from "./db.ts";
import { ERROR_TEXT } from "./http.ts";
import { rowToRecord, tableFor } from "./records.ts";
import { tombstones } from "./schema.ts";

// Pure: merges what the five reads returned and cuts one page.
export function pageOf(
	changes: PulledChange[],
	limit: number,
	since: number,
): PullResponse {
	const sorted = [...changes].sort((x, y) => x.seq - y.seq);
	const page = sorted.slice(0, limit);
	return {
		changes: page,
		cursor: page.length > 0 ? page[page.length - 1].seq : since,
		more: sorted.length > limit,
	};
}

// Test hooks only. afterRows runs between the data-table reads and the
// tombstone read, so a test can commit a push in that gap.
export type ReadHooks = { afterRows?: () => Promise<void> };

export async function readSince(
	db: Database,
	userId: string,
	since: number,
	limit: number = PULL_LIMIT,
	hooks: ReadHooks = {},
): Promise<PullResponse> {
	const found = await db.transaction(
		async (tx) => {
			const out: PulledChange[] = [];
			for (const store of STORES) {
				const table = tableFor(store);
				const rows = await tx
					.select()
					.from(table)
					.where(and(eq(table.userId, userId), gt(table.serverSeq, since)))
					.orderBy(asc(table.serverSeq))
					.limit(limit + 1);
				for (const row of rows) {
					out.push({
						store,
						id: row.id,
						seq: row.serverSeq,
						kind: "row",
						record: rowToRecord(row),
					});
				}
			}
			await hooks.afterRows?.();
			const tombs = await tx
				.select()
				.from(tombstones)
				.where(
					and(eq(tombstones.userId, userId), gt(tombstones.serverSeq, since)),
				)
				.orderBy(asc(tombstones.serverSeq))
				.limit(limit + 1);
			for (const t of tombs) {
				out.push({
					store: t.store,
					id: t.id,
					seq: t.serverSeq,
					kind: "tombstone",
					deletedAt: t.deletedAt.toISOString(),
				});
			}
			return out;
		},
		// One snapshot for all five reads, so a push committing in between can't
		// move the cursor past a row an earlier read missed.
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
	return pageOf(found, limit, since);
}

export async function handlePull(
	db: Database,
	userId: string,
	url: URL,
): Promise<{ status: number; json: unknown }> {
	if (url.searchParams.get("protocol") !== String(PROTOCOL_VERSION)) {
		return { status: 426, json: { error: ERROR_TEXT[426] } };
	}
	const since = url.searchParams.get("since");
	// A whole number of at most 15 digits stays inside Number's exact range.
	if (since === null || !/^\d{1,15}$/.test(since)) {
		return { status: 400, json: { error: ERROR_TEXT[400] } };
	}
	const page = await readSince(db, userId, Number(since));
	// Counts only (spec §9).
	console.log(
		JSON.stringify({
			route: "pull",
			changes: page.changes.length,
			more: page.more,
		}),
	);
	return { status: 200, json: page };
}
