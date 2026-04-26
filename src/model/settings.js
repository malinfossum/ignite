// createSettingsModel(db) → Promise<SettingsModel>
//
// Singleton: one record at id === "app". Seeded with defaults on first boot,
// then left alone — re-constructing the model never overwrites saved values.

const SETTINGS_ID = "app";
const DEFAULTS = {
	id: SETTINGS_ID,
	quietStart: 23,
	quietEnd: 7,
	lastKnownPermission: "default",
	lastView: "#today",
};

export async function createSettingsModel(db) {
	const listeners = new Set();
	const notify = () => {
		for (const fn of listeners) fn();
	};

	const existing = await db.get("settings", SETTINGS_ID);
	if (!existing) await db.put("settings", { ...DEFAULTS });

	return {
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},

		get() {
			return db.get("settings", SETTINGS_ID);
		},

		async update(patch) {
			const current = await db.get("settings", SETTINGS_ID);
			const updated = { ...current, ...patch, id: SETTINGS_ID };
			await db.put("settings", updated);
			notify();
			return updated;
		},
	};
}
