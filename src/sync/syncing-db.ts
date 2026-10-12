// The one seam (spec D3). Models write through this and never know sync exists.
// Reads pass straight through. Writes stamp updatedAt and, in account mode, leave
// an outbox entry in the SAME transaction, so a row never lands without its entry.

import { EPOCH, keyOf, type Store, SYNCED_STORES } from "../../shared/protocol";
import { quietChanged } from "./rules";
import type { Db, OutboxEntry, Row, SyncMeta, TxHandle } from "./types";

const isSynced = (store: string): store is Store =>
	(SYNCED_STORES as readonly string[]).includes(store);

async function queue(
	t: TxHandle,
	store: Store,
	id: string,
	op: "put" | "delete",
	now: string,
) {
	const key = keyOf(store, id);
	const prev = (await t.get("outbox", key)) as OutboxEntry | undefined;
	const entry: OutboxEntry = { key, store, id, op, rev: (prev?.rev ?? 0) + 1 };
	if (op === "delete") entry.deletedAt = now;
	await t.put("outbox", entry);
}

export function createSyncingDb(
	db: Db,
	{
		now = () => new Date(),
		onQueued = () => {},
	}: { now?: () => Date; onQueued?: () => void } = {},
): Db {
	return {
		...db,

		async put(store, record) {
			if (!isSynced(store)) return db.put(store, record);
			const stamp = now().toISOString();
			const didQueue = await db.transact(
				[store, "outbox", "meta"],
				"readwrite",
				async (t) => {
					const meta = (await t.get("meta", "sync")) as SyncMeta | undefined;
					const account = meta?.mode === "account";
					let row: Row;
					let shouldQueue = account;
					if (store === "settings") {
						const prev = await t.get("settings", record.id as string);
						const changed = quietChanged(prev, record);
						row = {
							...record,
							updatedAt: changed ? stamp : (prev?.updatedAt ?? EPOCH),
						};
						shouldQueue = account && changed;
					} else {
						row = { ...record, updatedAt: stamp };
					}
					await t.put(store, row);
					if (shouldQueue)
						await queue(t, store, record.id as string, "put", stamp);
					return shouldQueue;
				},
			);
			if (didQueue) onQueued();
			return record.id;
		},

		async delete(store, id) {
			if (!isSynced(store)) return db.delete(store, id);
			const stamp = now().toISOString();
			const didQueue = await db.transact(
				[store, "outbox", "meta"],
				"readwrite",
				async (t) => {
					const meta = (await t.get("meta", "sync")) as SyncMeta | undefined;
					await t.delete(store, id);
					if (meta?.mode !== "account") return false;
					await queue(t, store, id, "delete", stamp);
					return true;
				},
			);
			if (didQueue) onQueued();
		},
	};
}
