// Small text helpers — no DOM, no model dependencies.

// Trims whitespace, then uppercases the first character. Preserves the
// rest verbatim (NOT title case). Empty / null input returns empty string.
//
// Sentence-case feels natural for task titles and section names where
// users may type lowercase mid-flow and expect the UI to clean up.

export function capitalizeFirst(s) {
	const trimmed = String(s ?? "").trim();
	if (!trimmed) return trimmed;
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
