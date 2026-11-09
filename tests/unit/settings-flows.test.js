import { beforeEach, describe, expect, it, vi } from "vitest";
import { backupToJson, buildBackup } from "../../src/backup/backup-format.js";
import { downloadFile } from "../../src/backup/download.js";
import { createSettingsFlows } from "../../src/settings-flows.js";

vi.mock("../../src/backup/download.js", () => ({ downloadFile: vi.fn() }));

// replace() is the one choke point for restore and undo. R2: the current data
// is read and downloaded as a safety backup BEFORE anything is written, and a
// failure at any step stops everything after it. These tests drive it through
// the public flows with fake models, toast, dialog and view (no DOM).

const SNAPSHOT = { areas: [], sections: [], tasks: [] };
const RESTORED = {
	areas: [{ id: "focus", name: "Focus", icon: "x", critical: false, order: 0 }],
	sections: [
		{
			id: "focus-default",
			areaId: "focus",
			name: "Tasks",
			collapsed: false,
			order: 0,
		},
	],
	tasks: [],
};

function backupFile(name = "backup.json") {
	const text = backupToJson(
		buildBackup(RESTORED, {
			appVersion: "0.9.0",
			now: new Date("2026-11-09T12:00:00.000Z"),
		}),
	);
	return { name, size: text.length, text: async () => text };
}

function setup({ steps = {} } = {}) {
	const calls = [];
	const record = (name, impl) =>
		vi.fn(async (...args) => {
			calls.push(name);
			if (steps[name]) throw new Error(`${name} failed`);
			return impl?.(...args);
		});
	const models = {
		data: {
			snapshot: record("snapshot", () => SNAPSHOT),
			replaceAll: record("replaceAll"),
		},
		settings: { setLastBackupAt: record("stamp") },
	};
	downloadFile.mockImplementation(() => {
		calls.push("download");
		if (steps.download) throw new Error("download failed");
	});
	let dialog = null;
	const confirmDialog = {
		open: (opts) => {
			dialog = opts;
		},
		close: () => {
			dialog = null;
		},
		isOpen: () => dialog !== null,
	};
	const view = {
		setAlert: vi.fn(),
		setRestoreFileName: vi.fn(),
		setUndoAvailable: vi.fn(),
		focusControl: vi.fn(),
	};
	const toast = { show: vi.fn() };
	const flows = createSettingsFlows({
		models,
		toast,
		getView: () => view,
		appVersion: "0.9.0",
		confirmDialog,
		setModal: vi.fn(),
		applyState: vi.fn(async () => {
			calls.push("applyState");
		}),
		channel: null,
	});
	return { flows, view, models, calls, toast, getDialog: () => dialog };
}

// Picks a valid file, then presses Replace in the confirm dialog.
async function restore(ctx) {
	await ctx.flows.restoreFromFile(backupFile());
	const dialog = ctx.getDialog();
	expect(dialog).not.toBeNull();
	ctx.calls.length = 0; // only count what the confirm triggers
	await dialog.onConfirm();
}

beforeEach(() => {
	downloadFile.mockReset();
});

describe("replace() through restoreFromFile", () => {
	it("runs snapshot, safety download, stamp, replaceAll, then re-renders, in that order", async () => {
		const ctx = setup();
		await restore(ctx);
		expect(ctx.calls).toEqual([
			"snapshot",
			"download",
			"stamp",
			"replaceAll",
			"applyState",
		]);
		expect(ctx.flows.canUndo()).toBe(true);
	});

	it("never calls replaceAll when the snapshot fails", async () => {
		const ctx = setup();
		await ctx.flows.restoreFromFile(backupFile());
		const dialog = ctx.getDialog();
		ctx.models.data.snapshot.mockImplementationOnce(async () => {
			ctx.calls.push("snapshot");
			throw new Error("snapshot failed");
		});
		ctx.calls.length = 0;
		await dialog.onConfirm();
		expect(ctx.calls).toEqual(["snapshot"]);
		expect(ctx.models.data.replaceAll).not.toHaveBeenCalled();
		expect(ctx.flows.canUndo()).toBe(false);
	});

	it("never calls replaceAll when the safety download fails", async () => {
		const ctx = setup({ steps: { download: true } });
		await restore(ctx);
		expect(ctx.calls).toEqual(["snapshot", "download"]);
		expect(ctx.models.data.replaceAll).not.toHaveBeenCalled();
		expect(ctx.flows.canUndo()).toBe(false);
	});

	it("never replaces when stamping the backup time fails", async () => {
		const ctx = setup({ steps: { stamp: true } });
		await restore(ctx);
		expect(ctx.calls).toEqual(["snapshot", "download", "stamp"]);
		expect(ctx.models.data.replaceAll).not.toHaveBeenCalled();
		expect(ctx.flows.canUndo()).toBe(false);
	});

	it("leaves nothing to undo and skips the re-render when replaceAll fails", async () => {
		const ctx = setup({ steps: { replaceAll: true } });
		await restore(ctx);
		expect(ctx.calls).toEqual(["snapshot", "download", "stamp", "replaceAll"]);
		expect(ctx.flows.canUndo()).toBe(false);
	});

	it("refuses a second replace while one is running", async () => {
		const ctx = setup();
		let release;
		ctx.models.data.replaceAll.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					ctx.calls.push("replaceAll");
					release = resolve;
				}),
		);
		await ctx.flows.restoreFromFile(backupFile());
		const dialog = ctx.getDialog();
		ctx.calls.length = 0;
		const first = dialog.onConfirm();
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		await dialog.onConfirm();
		expect(ctx.models.data.replaceAll).toHaveBeenCalledTimes(1);
		expect(downloadFile).toHaveBeenCalledTimes(1);
		release();
		await first;
	});
});

describe("undo", () => {
	it("undoLastReplace takes its own safety download before replacing", async () => {
		const ctx = setup();
		await restore(ctx);
		ctx.calls.length = 0;
		await ctx.flows.undoLastReplace();
		expect(ctx.calls).toEqual([
			"snapshot",
			"download",
			"stamp",
			"replaceAll",
			"applyState",
		]);
		expect(ctx.models.data.replaceAll).toHaveBeenLastCalledWith(SNAPSHOT);
		expect(ctx.flows.canUndo()).toBe(false);
	});

	it("the persistent button asks first and replaces nothing until confirmed", async () => {
		const ctx = setup();
		await restore(ctx);
		ctx.calls.length = 0;
		ctx.flows.confirmUndoReplace();
		expect(ctx.getDialog()).not.toBeNull();
		expect(ctx.calls).toEqual([]);
		await ctx.getDialog().onConfirm();
		expect(ctx.calls).toContain("replaceAll");
		expect(ctx.flows.canUndo()).toBe(false);
	});
});
