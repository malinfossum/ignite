// createSettingsFlows(deps) → the backup, restore and import flows.
//
// Lives beside controller.js so the controller only routes and wires. It
// touches the DOM only through the Settings view, the dialogs and the toast it
// is handed. getView() returns the mounted Settings view or null: every flow
// re-checks it after an await, so a result that arrives after I left the page
// is dropped instead of reaching a removed view.

import {
	backupFileName,
	backupToJson,
	buildBackup,
} from "./backup/backup-format.js";
import { downloadFile } from "./backup/download.js";

const ALERT_TOAST_MS = 8_000;

export function createSettingsFlows({ models, toast, getView, appVersion }) {
	const { data, settings } = models;

	// Shows a failure in the group's alert line, or as a toast when the flow
	// started outside Settings (the banner) or the page has gone.
	function alertIn(group, message) {
		const view = getView();
		if (view) view.setAlert(group, message);
		else toast.show({ message, durationMs: ALERT_TOAST_MS });
	}

	async function downloadBackupOf(snapshot, fileName, now) {
		downloadFile(
			backupToJson(buildBackup(snapshot, { appVersion, now })),
			fileName,
			"application/json",
		);
		await settings.setLastBackupAt(now.toISOString());
	}

	async function backUpNow() {
		getView()?.setAlert("backup", "");
		const now = new Date();
		const fileName = backupFileName(now);
		try {
			await downloadBackupOf(await data.snapshot(), fileName, now);
		} catch {
			alertIn("backup", "Couldn't save the backup.");
			return false;
		}
		toast.show({ message: `Backup saved as ${fileName}.` });
		return true;
	}

	return { backUpNow };
}
