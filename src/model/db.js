// Thin promise wrapper over IndexedDB. Exposes:
//   openDB(name?, { onBlocked?, onVersionChange? }) → Promise<DBWrapper>
//   wrapper.get(store, id)
//   wrapper.getAll(store)
//   wrapper.getByIndex(store, indexName, value)
//   wrapper.put(store, record)
//   wrapper.delete(store, id)
//   wrapper.transact(storeNames, mode, fn)   // one transaction across stores
//   wrapper.close()
//   wrapper.raw       // underlying IDBDatabase, for tests/diagnostics only

const DEFAULT_NAME = "ignite";
export const DB_VERSION = 2;

export function openDB(
	name = DEFAULT_NAME,
	{ onBlocked, onVersionChange } = {},
) {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, DB_VERSION);
		req.onupgradeneeded = (event) => {
			runUpgrade(req.result, event.oldVersion);
		};
		req.onsuccess = () => {
			const db = req.result;
			// A newer version (another tab after a deploy) is waiting on this
			// connection. Closing it lets that upgrade run instead of blocking it.
			// Every later write on this tab then rejects with InvalidStateError, so
			// onVersionChange lets the UI say "reload" instead of losing a task.
			db.onversionchange = () => {
				db.close();
				onVersionChange?.();
			};
			resolve(wrap(db));
		};
		req.onerror = () => reject(req.error);
		// Another tab still runs older code and holds the database open. Rejecting
		// here would fail the boot. Waiting lets the open finish the moment that
		// tab closes; onBlocked lets the UI ask the user to close it.
		req.onblocked = () => onBlocked?.();
	});
}

function runUpgrade(db, oldVersion) {
	if (oldVersion < 1) {
		db.createObjectStore("areas", { keyPath: "id" });
		db.createObjectStore("sections", { keyPath: "id" });
		const tasks = db.createObjectStore("tasks", { keyPath: "id" });
		tasks.createIndex("sectionId", "sectionId");
		tasks.createIndex("dueAt", "dueAt");
		tasks.createIndex("completed", "completed");
		tasks.createIndex("starred", "starred");
		db.createObjectStore("settings", { keyPath: "id" });
	}
	if (oldVersion < 2) {
		// Sync bookkeeping. The outbox holds keys ("tasks:<id>") plus a rev, never
		// copies of rows; meta holds the single { id: "sync" } record.
		db.createObjectStore("outbox", { keyPath: "key" });
		db.createObjectStore("meta", { keyPath: "id" });
	}
}

// Runs fn inside ONE transaction over storeNames and resolves on COMMIT with
// fn's return value. Resolving on commit, not on request success, is what makes
// a write durable: tx.onerror/onabort surface commit-time failures (quota) that
// would otherwise be swallowed.
//
// fn must only await t.* calls. Awaiting anything else lets the transaction
// auto-commit, and the next t.* call throws TransactionInactiveError.
function transact(db, storeNames, mode, fn) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeNames, mode);
		const request = (req) =>
			new Promise((res, rej) => {
				req.onsuccess = () => res(req.result);
				req.onerror = () => rej(req.error);
			});
		const t = {
			get: (store, key) => request(tx.objectStore(store).get(key)),
			getAll: (store) => request(tx.objectStore(store).getAll()),
			getByIndex: (store, indexName, value) =>
				request(tx.objectStore(store).index(indexName).getAll(value)),
			put: (store, value) => request(tx.objectStore(store).put(value)),
			delete: (store, key) => request(tx.objectStore(store).delete(key)),
			clear: (store) => request(tx.objectStore(store).clear()),
		};
		let result;
		let failed = false;
		// The microtask runs before control returns to the event loop, so the
		// transaction is still active for fn's first request.
		Promise.resolve()
			.then(() => fn(t))
			.then(
				(value) => {
					result = value;
				},
				(err) => {
					failed = true;
					try {
						tx.abort();
					} catch {
						// already finished; the rejection below still reports err
					}
					reject(err);
				},
			);
		tx.oncomplete = () => resolve(result);
		tx.onerror = () => {
			if (!failed) reject(tx.error);
		};
		tx.onabort = () => {
			if (!failed)
				reject(
					tx.error ??
						new Error(
							`Transaction aborted on "${[storeNames].flat().join(", ")}"`,
						),
				);
		};
	});
}

function wrap(db) {
	return {
		raw: db,
		close: () => db.close(),
		transact: (storeNames, mode, fn) => transact(db, storeNames, mode, fn),
		get: (store, id) =>
			transact(db, store, "readonly", (t) => t.get(store, id)),
		getAll: (store) => transact(db, store, "readonly", (t) => t.getAll(store)),
		getByIndex: (store, indexName, value) =>
			transact(db, store, "readonly", (t) =>
				t.getByIndex(store, indexName, value),
			),
		put: (store, record) =>
			transact(db, store, "readwrite", (t) => t.put(store, record)),
		delete: (store, id) =>
			transact(db, store, "readwrite", (t) => t.delete(store, id)),
	};
}
