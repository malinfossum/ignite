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

// Aggregated task-delete toast message. Singular for the first deletion,
// plural with a count once a batch has more than one task. The aggregation
// itself lives in the controller; this helper is just the string formatter.
export function formatTaskDeleteMessage(count) {
	if (count === 1) return "Task deleted";
	return `${count} tasks deleted`;
}

// Human-readable cadence text for a recurrence rule. "daily" / "every 2 weeks".
// Returns "" for a null / unknown rule so callers can interpolate safely.
const RECURRENCE_ADVERB = {
	daily: "daily",
	weekly: "weekly",
	monthly: "monthly",
	yearly: "yearly",
};
const RECURRENCE_UNIT = {
	daily: "day",
	weekly: "week",
	monthly: "month",
	yearly: "year",
};

export function describeRecurrence(rule) {
	if (!rule || typeof rule !== "object") return "";
	const unit = RECURRENCE_UNIT[rule.type];
	if (!unit) return "";
	const interval =
		Number.isInteger(rule.interval) && rule.interval >= 1 ? rule.interval : 1;
	if (interval === 1) return RECURRENCE_ADVERB[rule.type];
	return `every ${interval} ${unit}s`;
}
