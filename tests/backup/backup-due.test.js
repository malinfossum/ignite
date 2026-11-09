import { describe, expect, it } from "vitest";
import {
	backupReminder,
	fileStamp,
	formatBackupStamp,
} from "../../src/backup/backup-due.js";

const NOW = new Date(2026, 10, 9, 13, 20); // local 09.11.2026 13:20
const daysAgo = (d, extraMs = 0) =>
	new Date(NOW.getTime() - d * 86_400_000 - extraMs).toISOString();

describe("backupReminder", () => {
	it("is silent on an empty database, even with no backup", () => {
		expect(
			backupReminder({ lastBackupAt: null, taskCount: 0, now: NOW }),
		).toBeNull();
	});
	it("asks for a first backup", () => {
		expect(backupReminder({ lastBackupAt: null, taskCount: 3, now: NOW })).toBe(
			"You haven't made a backup yet.",
		);
	});
	it("is silent at exactly 7 days", () => {
		expect(
			backupReminder({ lastBackupAt: daysAgo(7), taskCount: 3, now: NOW }),
		).toBeNull();
	});
	it("speaks just past 7 days", () => {
		expect(
			backupReminder({
				lastBackupAt: daysAgo(7, 60_000),
				taskCount: 3,
				now: NOW,
			}),
		).toBe("Your last backup was 7 days ago.");
	});
	it("counts whole days", () => {
		expect(
			backupReminder({ lastBackupAt: daysAgo(8), taskCount: 3, now: NOW }),
		).toBe("Your last backup was 8 days ago.");
	});
	it("treats a future stamp as just now", () => {
		expect(
			backupReminder({ lastBackupAt: daysAgo(-3), taskCount: 3, now: NOW }),
		).toBeNull();
	});
	it("treats an unreadable stamp as no backup", () => {
		expect(
			backupReminder({ lastBackupAt: "garbage", taskCount: 3, now: NOW }),
		).toBe("You haven't made a backup yet.");
	});
});

describe("formatBackupStamp", () => {
	it("uses periods for the date and a colon for the time", () => {
		expect(formatBackupStamp(NOW.toISOString())).toBe("09.11.2026 13:20");
	});
	it("says Never for null or garbage", () => {
		expect(formatBackupStamp(null)).toBe("Never");
		expect(formatBackupStamp("nope")).toBe("Never");
	});
});

describe("fileStamp", () => {
	it("sorts by time in local time", () => {
		expect(fileStamp(NOW)).toBe("2026-11-09-1320");
	});
});
