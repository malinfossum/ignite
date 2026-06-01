// Thin promise wrapper over IndexedDB. Exposes:
//   openDB(name?) → Promise<DBWrapper>
//   wrapper.get(store, id)
//   wrapper.getAll(store)
//   wrapper.getByIndex(store, indexName, value)
//   wrapper.put(store, record)
//   wrapper.delete(store, id)
//   wrapper.close()
//   wrapper.raw       // underlying IDBDatabase — for tests/diagnostics only

const DEFAULT_NAME = "ignite";
const CURRENT_VERSION = 1;

export function openDB(name = DEFAULT_NAME) {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, CURRENT_VERSION);
		req.onupgradeneeded = (event) => {
			runUpgrade(req.result, event.oldVersion);
		};
		req.onsuccess = () => resolve(wrap(req.result));
		req.onerror = () => reject(req.error);
		req.onblocked = () => reject(new Error(`openDB blocked for "${name}"`));
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
}

function wrap(db) {
	const run = (storeName, mode, fn) =>
		new Promise((resolve, reject) => {
			const tx = db.transaction(storeName, mode);
			const store = tx.objectStore(storeName);
			const req = fn(store);
			let result;
			req.onsuccess = () => {
				result = req.result;
			};
			req.onerror = () => reject(req.error);
			// Resolve on transaction COMMIT, not request success: a write isn't
			// durable until the tx commits, so resolving on req.onsuccess can report
			// success for data that never lands. tx.onerror/onabort surface commit-time
			// failures (e.g. quota exceeded) that would otherwise be swallowed silently.
			tx.oncomplete = () => resolve(result);
			tx.onerror = () => reject(tx.error);
			tx.onabort = () =>
				reject(tx.error ?? new Error(`Transaction aborted on "${storeName}"`));
		});

	return {
		raw: db,
		close: () => db.close(),
		get: (store, id) => run(store, "readonly", (s) => s.get(id)),
		getAll: (store) => run(store, "readonly", (s) => s.getAll()),
		getByIndex: (store, indexName, value) =>
			run(store, "readonly", (s) => s.index(indexName).getAll(value)),
		put: (store, record) => run(store, "readwrite", (s) => s.put(record)),
		delete: (store, id) => run(store, "readwrite", (s) => s.delete(id)),
	};
}
