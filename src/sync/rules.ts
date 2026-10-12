import {
	type Change,
	MAX_BODY_BYTES,
	MAX_CHANGES,
} from "../../shared/protocol";

type Row = Record<string, unknown>;

// A settings write queues only when a synced field moved. Without this, a theme
// change would push this device's stale quiet hours with a fresh timestamp.
// The first write of the row (the seed) is not a change.
export function quietChanged(prev: Row | undefined, next: Row): boolean {
	if (!prev) return false;
	return prev.quietStart !== next.quietStart || prev.quietEnd !== next.quietEnd;
}

export function isSeedOnly(local: {
	areas: { id: string }[];
	sections: { id: string }[];
	tasks: unknown[];
}): boolean {
	return (
		local.tasks.length === 0 &&
		local.areas.every((a) => a.id === "focus") &&
		local.sections.every((s) => s.id === "focus-default")
	);
}

const encoder = new TextEncoder();
const sizeOf = (change: Change) =>
	encoder.encode(JSON.stringify(change)).length;

// Splits at maxChanges or maxBytes, whichever comes first. A single change over
// maxBytes gets a batch of its own: the server answers 413 and the engine drops
// it like an invalid change, so it can never jam the queue (spec §8).
export function splitBatches(
	changes: Change[],
	maxChanges = MAX_CHANGES,
	maxBytes = MAX_BODY_BYTES,
): Change[][] {
	const batches: Change[][] = [];
	let current: Change[] = [];
	let bytes = 0;
	for (const change of changes) {
		const size = sizeOf(change);
		if (
			current.length &&
			(current.length >= maxChanges || bytes + size > maxBytes)
		) {
			batches.push(current);
			current = [];
			bytes = 0;
		}
		current.push(change);
		bytes += size;
	}
	if (current.length) batches.push(current);
	return batches;
}
