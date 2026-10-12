export type SyncStatus =
	| { kind: "local" }
	| { kind: "syncing" }
	| { kind: "synced"; at: string }
	| { kind: "offline"; pending: number }
	| { kind: "needs-sign-in" }
	| { kind: "needs-reload" }
	| { kind: "invalid"; count: number };

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

export function statusText(status: SyncStatus, now: Date): string {
	switch (status.kind) {
		case "local":
			return "Not signed in";
		case "syncing":
			return "Syncing…";
		case "synced": {
			const minutes = Math.floor(
				(now.getTime() - Date.parse(status.at)) / 60_000,
			);
			return minutes < 1 ? "Synced just now" : `Synced ${minutes} min ago`;
		}
		case "offline":
			return `Offline, ${plural(status.pending, "change", "changes")} waiting`;
		case "needs-sign-in":
			return "Sign in again to sync";
		case "needs-reload":
			return "Ignite has updated. Reload to keep syncing.";
		case "invalid":
			return `${plural(status.count, "change", "changes")} couldn't sync`;
	}
}

export function needsAttention(status: SyncStatus): boolean {
	return (
		status.kind === "needs-sign-in" ||
		status.kind === "needs-reload" ||
		status.kind === "invalid"
	);
}
