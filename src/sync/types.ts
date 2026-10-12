import type { Store } from "../../shared/protocol";

export type Row = Record<string, unknown>;

export interface TxHandle {
	get(store: string, key: string): Promise<Row | undefined>;
	getAll(store: string): Promise<Row[]>;
	getByIndex(store: string, index: string, value: unknown): Promise<Row[]>;
	put(store: string, value: Row): Promise<unknown>;
	delete(store: string, key: string): Promise<unknown>;
	clear(store: string): Promise<unknown>;
}

export interface Db {
	raw: IDBDatabase;
	close(): void;
	transact<T>(
		stores: string | string[],
		mode: IDBTransactionMode,
		fn: (t: TxHandle) => Promise<T> | T,
	): Promise<T>;
	get(store: string, id: string): Promise<Row | undefined>;
	getAll(store: string): Promise<Row[]>;
	getByIndex(store: string, index: string, value: unknown): Promise<Row[]>;
	put(store: string, record: Row): Promise<unknown>;
	delete(store: string, id: string): Promise<unknown>;
}

export type OutboxEntry = {
	key: string;
	store: Store;
	id: string;
	op: "put" | "delete";
	rev: number;
	deletedAt?: string;
};

export type SyncMeta = {
	id: "sync";
	mode: "local" | "account";
	cursor: number;
	userEmail: string | null;
	lastSyncedAt: string | null;
};

export const LOCAL_META: SyncMeta = {
	id: "sync",
	mode: "local",
	cursor: 0,
	userEmail: null,
	lastSyncedAt: null,
};
