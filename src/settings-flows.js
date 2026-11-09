// createSettingsFlows(deps) → the backup, restore and import flows.
//
// Lives beside controller.js so the controller only routes and wires. It
// touches the DOM only through the Settings view, the dialogs and the toast it
// is handed. getView() returns the mounted Settings view or null: every flow
// re-checks it after an await, so a result that arrives after I left the page
// is dropped instead of reaching a removed view.

import {
	BACKUP_TOO_BIG,
	backupFileName,
	backupToJson,
	buildBackup,
	describeCounts,
	describeRepairs,
	MAX_BACKUP_BYTES,
	NOT_A_BACKUP,
	validateBackup,
} from "./backup/backup-format.js";
import { downloadFile } from "./backup/download.js";

const ALERT_TOAST_MS = 8_000;

export function createSettingsFlows({
	models,
	toast,
	getView,
	appVersion,
	confirmDialog,
	setModal,
	applyState,
	channel,
}) {
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

	let replacing = false;
	let lastReplace = null; // { snapshot, safetyName } until the next app start
	let returnFocus = null;

	function openConfirm({ onReturnFocus, ...opts }) {
		returnFocus = onReturnFocus;
		setModal(true);
		confirmDialog.open({ ...opts, onCancel: () => closeConfirm() });
	}

	function closeConfirm({ restoreFocus = true } = {}) {
		if (!confirmDialog.isOpen()) return;
		confirmDialog.close();
		setModal(false);
		if (restoreFocus) returnFocus?.();
		returnFocus = null;
	}

	// Every replace: snapshot, safety download, stamp, one-transaction write,
	// tell other tabs, re-render. Returns { ok: true } only when the data was
	// replaced, else { ok: false, message } for the caller to show once its
	// dialog has closed (an alert written behind `inert` isn't announced).
	async function replace(newData, safetyName, { replaceFailMessage } = {}) {
		if (replacing) return { ok: false, message: null };
		replacing = true;
		try {
			const now = new Date();
			let snapshot;
			try {
				// Reading the current data is part of the safety backup: if it
				// fails, there is nothing safe to fall back to, so stop here.
				snapshot = await data.snapshot();
				await downloadBackupOf(snapshot, safetyName, now);
			} catch {
				return {
					ok: false,
					message: "Couldn't save the safety backup, so nothing was replaced.",
				};
			}
			try {
				await data.replaceAll(newData);
			} catch {
				return {
					ok: false,
					message:
						replaceFailMessage ??
						"Couldn't replace your data. Nothing was changed.",
				};
			}
			lastReplace = { snapshot, safetyName };
			// Another open tab still holds the old ids and would write into
			// sections that no longer exist. It reloads on this message.
			channel?.postMessage({ type: "replaced" });
			getView()?.setUndoAvailable(true);
			await applyState();
			return { ok: true };
		} finally {
			replacing = false;
		}
	}

	async function restoreFromFile(file) {
		const view = getView();
		view?.setAlert("backup", "");
		view?.setRestoreFileName(file.name);
		if (file.size > MAX_BACKUP_BYTES) {
			view?.setAlert("backup", BACKUP_TOO_BIG);
			return;
		}
		let text;
		try {
			text = await file.text();
		} catch {
			view?.setAlert("backup", NOT_A_BACKUP);
			return;
		}
		if (getView() !== view) return;
		const result = validateBackup(text);
		if (!result.ok) {
			view.setAlert("backup", result.reason);
			return;
		}
		let current;
		try {
			current = await data.snapshot();
		} catch {
			alertIn(
				"backup",
				"Couldn't save the safety backup, so nothing was replaced.",
			);
			return;
		}
		if (getView() !== view) return;
		const safetyName = backupFileName(new Date());
		openConfirm({
			title: "Restore from this backup?",
			lines: [
				`Replace ${describeCounts(current)} with ${describeCounts(result.data)}.`,
				...describeRepairs(result.repairs),
				`Your current data downloads first as ${safetyName}.`,
			],
			confirmLabel: "Replace",
			onReturnFocus: () => getView()?.focusControl("restore"),
			onConfirm: async () => {
				let outcome = { ok: false, message: null };
				try {
					outcome = await replace(result.data, safetyName);
				} finally {
					// Always close, even if the render after the write throws: a
					// dialog left open with its buttons disabled, Esc ignored and
					// the background inert is a keyboard trap.
					closeConfirm();
				}
				if (!outcome.ok) {
					if (outcome.message) alertIn("backup", outcome.message);
					return;
				}
				toast.show({
					message: `Restored from ${file.name}.`,
					actionLabel: "Undo",
					onAction: () => undoLastReplace(),
				});
			},
		});
	}

	async function undoLastReplace() {
		if (!lastReplace) return;
		const target = lastReplace;
		const outcome = await replace(target.snapshot, backupFileName(new Date()), {
			replaceFailMessage: `Couldn't undo. Your data from before is in ${target.safetyName}.`,
		});
		if (!outcome.ok) {
			if (outcome.message) alertIn("backup", outcome.message);
			return;
		}
		lastReplace = null;
		getView()?.setUndoAvailable(false);
		toast.show({ message: "Replace undone." });
	}

	return {
		backUpNow,
		restoreFromFile,
		undoLastReplace,
		canUndo: () => lastReplace !== null,
		closeDialogs: () => closeConfirm({ restoreFocus: false }),
	};
}
