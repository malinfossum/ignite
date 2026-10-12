// The sync protocol, shared by the client (src/sync/) and the Worker (api/).
// Types and constants only. Nothing here imports anything, so this file can
// never pull server code into the client bundle or client code into the Worker.

export const PROTOCOL_VERSION = 1;
export const STORES = ["areas", "sections", "tasks", "settings"] as const;
export type Store = (typeof STORES)[number];
export const SYNCED_STORES = STORES;
export const EPOCH = "1970-01-01T00:00:00.000Z";
export const MAX_CHANGES = 200;
export const MAX_BODY_BYTES = 1_000_000;
export const PULL_LIMIT = 500;
export const CLOCK_SKEW_MS = 5_000;
export const keyOf = (store: Store, id: string): string => `${store}:${id}`;

export type Row = Record<string, unknown>;
export type PutChange = { store: Store; id: string; op: "put"; record: Row };
export type DeleteChange = {
	store: Store;
	id: string;
	op: "delete";
	deletedAt: string;
};
export type Change = PutChange | DeleteChange;
export type PushRequest = {
	protocol: typeof PROTOCOL_VERSION;
	changes: Change[];
};

// What the server holds for one key.
export type ServerVersion =
	| { store: Store; id: string; kind: "row"; record: Row }
	| { store: Store; id: string; kind: "tombstone"; deletedAt: string }
	| { store: Store; id: string; kind: "none" };

// accepted: keys (keyOf). lost: the winner (row or tombstone). invalid: the key
// plus the server's current version (row, tombstone or none). An invalid change
// whose store/id cannot even be read is dropped by the server silently; it has
// no key to report.
export type PushResponse = {
	accepted: string[];
	lost: ServerVersion[];
	invalid: ServerVersion[];
};

export type PulledChange =
	| { store: Store; id: string; seq: number; kind: "row"; record: Row }
	| {
			store: Store;
			id: string;
			seq: number;
			kind: "tombstone";
			deletedAt: string;
	  };
export type PullResponse = {
	changes: PulledChange[];
	cursor: number;
	more: boolean;
};
