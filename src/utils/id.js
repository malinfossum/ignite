// Thin wrapper so every caller imports from one place.
// Swap-able later if we ever need a custom id format.
export function uuid() {
	return crypto.randomUUID();
}
