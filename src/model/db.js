// Thin promise wrapper over IndexedDB. Exposes:
//   openDB(name?) → Promise<DBWrapper>
//   wrapper.get / getAll / getByIndex / put / delete / close / raw
//
// Schema version is baked into `CURRENT_VERSION`. Bump it and extend
// `runUpgrade` when a new store or index is needed later.

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
	return {
		raw: db,
		close: () => db.close(),
		// CRUD methods added in Task 8.
	};
}
