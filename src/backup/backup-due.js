// Pure helpers for the backup reminder and backup file names. No DOM.

const DAY_MS = 86_400_000;
export const BACKUP_STALE_MS = 7 * DAY_MS;

const pad = (n) => String(n).padStart(2, "0");

function parseStamp(iso) {
	if (typeof iso !== "string") return null;
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? null : ms;
}

// Banner text, or null when no banner should show. A new user with an empty
// database never sees it. A stamp in the future (a clock set back) counts as
// "just now".
export function backupReminder({ lastBackupAt, taskCount, now }) {
	if (taskCount === 0) return null;
	const last = parseStamp(lastBackupAt);
	if (last === null) return "You haven't made a backup yet.";
	const age = now.getTime() - last;
	if (age <= BACKUP_STALE_MS) return null;
	return `Your last backup was ${Math.floor(age / DAY_MS)} days ago.`;
}

// "09.11.2026 13:20" in local time, or "Never".
export function formatBackupStamp(iso) {
	const ms = parseStamp(iso);
	if (ms === null) return "Never";
	const d = new Date(ms);
	return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "2026-11-09-1320" in local time, so backup files sort in order.
export function fileStamp(now) {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}
