// Pure functions. No I/O. Given a recurrence rule and a reference date,
// returns the next Date the task should fire.

export function nextOccurrence(rule, fromDate) {
	switch (rule.type) {
		case "daily":
			return addDays(fromDate, 1);
		case "weekly":
			return nextWeekday(fromDate, rule.weekdays);
		default:
			throw new Error(`Unknown recurrence type: ${rule.type}`);
	}
}

function addDays(d, n) {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}

function nextWeekday(from, weekdays) {
	if (!Array.isArray(weekdays) || weekdays.length === 0) {
		throw new Error("weekly recurrence requires weekdays[]");
	}
	for (let i = 1; i <= 7; i++) {
		const candidate = addDays(from, i);
		if (weekdays.includes(candidate.getDay())) return candidate;
	}
	// Unreachable: 7 consecutive days cover every weekday.
	throw new Error("weekly recurrence has no valid weekdays");
}
