// Pure functions. No I/O. Given a recurrence rule and a reference date,
// returns the next Date the task should fire.

export function nextOccurrence(rule, fromDate) {
	switch (rule.type) {
		case "daily":
			return addDays(fromDate, 1);
		case "weekly":
			return nextWeekday(fromDate, rule.weekdays);
		case "monthly":
			return nextMonth(fromDate, rule.day);
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
	throw new Error("weekly recurrence has no valid weekdays");
}

function nextMonth(from, targetDay) {
	// JS Date normalizes month values > 11 into the following year.
	const year = from.getFullYear();
	const month = from.getMonth() + 1;
	const lastDayOfNextMonth = new Date(year, month + 1, 0).getDate();
	const day = Math.min(targetDay, lastDayOfNextMonth);
	return new Date(
		year,
		month,
		day,
		from.getHours(),
		from.getMinutes(),
		from.getSeconds(),
		from.getMilliseconds(),
	);
}
