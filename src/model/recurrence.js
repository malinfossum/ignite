// Pure functions. No I/O. Given a recurrence rule and a reference date,
// returns the next Date the task should fire.
//
// Rule shapes:
//   { type: "daily" }
//   { type: "weekly", weekdays: [0..6] }   // 0 = Sunday
//   { type: "monthly", day: 1..31 }        // clamped to last day of target month
//   { type: "yearly", month: 1..12, day: 1..31 }

export function nextOccurrence(rule, fromDate) {
	switch (rule.type) {
		case "daily":
			return addDays(fromDate, 1);
		case "weekly":
			return nextWeekday(fromDate, rule.weekdays);
		case "monthly":
			return nextMonth(fromDate, rule.day);
		case "yearly":
			return nextYear(fromDate, rule.month, rule.day);
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

function nextYear(from, ruleMonth1Based, targetDay) {
	const year = from.getFullYear() + 1;
	const monthIndex = ruleMonth1Based - 1;
	const lastDayOfThatMonth = new Date(year, monthIndex + 1, 0).getDate();
	const day = Math.min(targetDay, lastDayOfThatMonth);
	return new Date(
		year,
		monthIndex,
		day,
		from.getHours(),
		from.getMinutes(),
		from.getSeconds(),
		from.getMilliseconds(),
	);
}
