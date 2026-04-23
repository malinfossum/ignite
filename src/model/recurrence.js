// Pure functions. No I/O. Given a recurrence rule and a reference date,
// returns the next Date the task should fire. Model factories call this
// on complete-of-recurring-task to roll the dueAt forward.

export function nextOccurrence(rule, fromDate) {
	switch (rule.type) {
		case "daily":
			return addDays(fromDate, 1);
		default:
			throw new Error(`Unknown recurrence type: ${rule.type}`);
	}
}

function addDays(d, n) {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}
