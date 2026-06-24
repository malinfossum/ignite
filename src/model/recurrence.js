// Pure functions. No I/O. Given a recurrence rule and a reference date,
// returns the next Date the task should fire (strictly after fromDate).
//
// Rule shapes (interval optional, defaults to 1; coerced to an integer >= 1):
//   { type: "daily",   interval }
//   { type: "weekly",  interval, weekdays: [0..6] }  // 0 = Sunday
//   { type: "monthly", interval, day: 1..31 }        // clamped to last day of target month
//   { type: "yearly",  interval, month: 1..12, day: 1..31 }

export function nextOccurrence(rule, fromDate) {
	const interval = coerceInterval(rule.interval);
	switch (rule.type) {
		case "daily":
			return addDays(fromDate, interval);
		case "weekly":
			return nextWeekday(fromDate, rule.weekdays, interval);
		case "monthly":
			return nextMonth(fromDate, rule.day, interval);
		case "yearly":
			return nextYear(fromDate, rule.month, rule.day, interval);
		default:
			throw new Error(`Unknown recurrence type: ${rule.type}`);
	}
}

// An interval is always an integer >= 1. Absent / 0 / negative / fractional /
// non-numeric all collapse to 1. This keeps back-compat AND guarantees the
// model's no-backlog `while (next <= now)` loop strictly advances.
function coerceInterval(n) {
	const i = Math.floor(Number(n));
	return Number.isFinite(i) && i >= 1 ? i : 1;
}

function addDays(d, n) {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}

function nextWeekday(from, weekdays, interval) {
	if (!Array.isArray(weekdays) || weekdays.length === 0) {
		throw new Error("weekly recurrence requires weekdays[]");
	}
	const sorted = [...new Set(weekdays)].sort((a, b) => a - b); // 0..6 asc
	const fromDay = from.getDay();
	// Another selected weekday LATER this same week? Take it (interval-agnostic).
	const later = sorted.find((d) => d > fromDay);
	if (later !== undefined) return addDays(from, later - fromDay);
	// Else jump `interval` weeks to the next on-week; take its first selected day.
	return addDays(from, interval * 7 - fromDay + sorted[0]);
}

function nextMonth(from, targetDay, interval) {
	const year = from.getFullYear();
	const month = from.getMonth() + interval;
	const lastDayOfTargetMonth = new Date(year, month + 1, 0).getDate();
	const day = Math.min(targetDay, lastDayOfTargetMonth);
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

function nextYear(from, ruleMonth1Based, targetDay, interval) {
	const year = from.getFullYear() + interval;
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
