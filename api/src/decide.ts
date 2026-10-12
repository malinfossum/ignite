// Last write wins, per row (spec §6.1, D7). Pure: push.ts calls it under the
// advisory lock with what the database holds for each key.

import { CLOCK_SKEW_MS } from "../../shared/protocol.ts";

// A device whose clock runs a year fast would win every conflict for a year.
// Capping at server time plus a few seconds stops that. iso has passed
// validate.ts, so it is a real toISOString() value.
export function clampUpdatedAt(iso: string, serverNow: Date): string {
	const cap = serverNow.getTime() + CLOCK_SKEW_MS;
	return Date.parse(iso) > cap ? new Date(cap).toISOString() : iso;
}

// currentAt is the stored row's updatedAt or the tombstone's deletedAt, or null
// when the server holds nothing for the key. Equal is not newer, so a retried
// push loses and gets back an identical row (spec §6.1).
export function decide(
	incomingAt: string,
	currentAt: string | null,
): "apply" | "lose" {
	if (currentAt === null) return "apply";
	return Date.parse(incomingAt) > Date.parse(currentAt) ? "apply" : "lose";
}
