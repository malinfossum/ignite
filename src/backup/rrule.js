// RRULE string → Ignite recurrence, or null with a reason. Pure.
//
// Only the rule part is read. Parts the rule leaves out come from startAt in
// LOCAL time, as RFC 5545 does with DTSTART. A rule is never guessed: any part
// Ignite can't follow exactly returns null with a reason for the report.

const WEEKDAY = new Map([
	["SU", 0],
	["MO", 1],
	["TU", 2],
	["WE", 3],
	["TH", 4],
	["FR", 5],
	["SA", 6],
]);
const FREQS = new Map([
	["DAILY", "daily"],
	["WEEKLY", "weekly"],
	["MONTHLY", "monthly"],
	["YEARLY", "yearly"],
]);
const TOO_OFTEN = new Set(["HOURLY", "MINUTELY", "SECONDLY"]);
const KNOWN = new Set([
	"FREQ",
	"INTERVAL",
	"BYDAY",
	"BYMONTHDAY",
	"BYMONTH",
	"WKST",
	"COUNT",
	"UNTIL",
	"BYSETPOS",
	"BYHOUR",
	"BYMINUTE",
	"BYSECOND",
	"BYYEARDAY",
	"BYWEEKNO",
]);

export const RRULE_REASONS = {
	empty: "No repeat rule was found.",
	unreadable: "The repeat rule couldn't be read.",
	unknown: "It uses a repeat rule Ignite doesn't know.",
	frequency: "It repeats more often than daily.",
	ends: "It stops after a set number of times or on a date.",
	position: "It repeats on a numbered weekday, such as the first Monday.",
	hours: "It repeats at set hours or minutes.",
	weekdayRule: "It repeats on weekdays within a month or year.",
	severalDays: "It repeats on several days of the month.",
	fromEnd: "It counts days back from the end of the month.",
	severalMonths: "It repeats in several months.",
	weekStart:
		"It repeats every few weeks on several days, counted from a week start Ignite doesn't use.",
	noStart: "It has no start date to take the day from.",
};

const none = (key) => ({ recurrence: null, reason: RRULE_REASONS[key] });

function extractRule(input) {
	if (typeof input !== "string") return { key: "empty" };
	const lines = input
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	let rule = null;
	for (const line of lines) {
		const upper = line.toUpperCase();
		if (upper.startsWith("DTSTART")) continue;
		// Extra or skipped dates change which days the rule hits.
		if (upper.startsWith("RDATE") || upper.startsWith("EXDATE"))
			return { key: "unknown" };
		if (rule !== null) return { key: "unreadable" };
		rule = upper.startsWith("RRULE:") ? line.slice(6) : line;
	}
	return rule === null ? { key: "empty" } : { rule };
}

// "MO,TH" → { weekdays: [1, 4] }, or { key } with the reason to refuse it.
function parseWeekdays(byDay) {
	const days = [];
	for (const token of byDay.split(",")) {
		if (/^[+-]?\d/.test(token)) return { key: "position" };
		if (!WEEKDAY.has(token)) return { key: "unreadable" };
		days.push(WEEKDAY.get(token));
	}
	return { weekdays: [...new Set(days)].sort((a, b) => a - b) };
}

function readMonthDay(raw, start) {
	if (raw === undefined) return start ? start.getDate() : "noStart";
	if (raw.includes(",")) return "severalDays";
	if (raw === "-1") return 31; // Ignite clamps 31 to the month's last day
	if (/^-\d+$/.test(raw)) return "fromEnd";
	if (!/^\+?\d+$/.test(raw)) return "unreadable";
	const day = Number(raw.replace("+", ""));
	return day >= 1 && day <= 31 ? day : "unreadable";
}

export function rruleToRecurrence(input, startAt) {
	const extracted = extractRule(input);
	if (extracted.key) return none(extracted.key);

	const parts = new Map();
	for (const piece of extracted.rule.split(";")) {
		if (piece === "") continue;
		const eq = piece.indexOf("=");
		if (eq <= 0) return none("unreadable");
		const name = piece.slice(0, eq).toUpperCase();
		const value = piece.slice(eq + 1).toUpperCase();
		if (parts.has(name) || value === "") return none("unreadable");
		parts.set(name, value);
	}
	for (const name of parts.keys()) if (!KNOWN.has(name)) return none("unknown");
	if (parts.has("COUNT") || parts.has("UNTIL")) return none("ends");
	if (parts.has("BYSETPOS")) return none("position");
	if (parts.has("BYHOUR") || parts.has("BYMINUTE") || parts.has("BYSECOND"))
		return none("hours");
	if (parts.has("BYYEARDAY") || parts.has("BYWEEKNO")) return none("unknown");

	const freq = parts.get("FREQ");
	if (freq === undefined) return none("unreadable");
	if (TOO_OFTEN.has(freq)) return none("frequency");
	const type = FREQS.get(freq);
	if (!type) return none("unknown");

	let interval = 1;
	if (parts.has("INTERVAL")) {
		const raw = parts.get("INTERVAL");
		if (!/^\d+$/.test(raw) || Number(raw) < 1) return none("unreadable");
		interval = Number(raw);
	}

	const byDay = parts.get("BYDAY");
	const byMonthDay = parts.get("BYMONTHDAY");
	const byMonth = parts.get("BYMONTH");
	if (byDay !== undefined && type !== "weekly") {
		if (/\d/.test(byDay)) return none("position");
		if (type !== "daily") return none("weekdayRule");
		// RFC 5545: BYDAY on a DAILY rule limits it to those weekdays. With
		// INTERVAL 1 that is exactly a weekly rule. Every N weeks would need the
		// week-start check below, so it is refused.
		if (interval > 1 || byMonthDay !== undefined || byMonth !== undefined)
			return none("unknown");
		const parsed = parseWeekdays(byDay);
		if (parsed.key) return none(parsed.key);
		return {
			recurrence: { type: "weekly", interval: 1, weekdays: parsed.weekdays },
		};
	}
	if (byMonthDay !== undefined && (type === "daily" || type === "weekly"))
		return none("unknown");
	if (byMonth !== undefined && type !== "yearly") return none("unknown");

	const start =
		startAt instanceof Date && !Number.isNaN(startAt.getTime())
			? startAt
			: null;

	if (type === "daily") return { recurrence: { type, interval } };

	if (type === "weekly") {
		let weekdays;
		if (byDay === undefined) {
			if (!start) return none("noStart");
			weekdays = [start.getDay()];
		} else {
			const parsed = parseWeekdays(byDay);
			if (parsed.key) return none(parsed.key);
			weekdays = parsed.weekdays;
		}
		// Ignite's weeks run Sunday to Saturday (Date.getDay). RFC 5545 weeks
		// start on WKST, Monday by default. With one weekday, or every week,
		// the two always agree. For every N weeks with several days they agree
		// when WKST is Sunday, and when it is Monday unless Sunday is one of
		// the days. Any other WKST can group the days into different weeks, so
		// it is refused rather than guessed.
		const wkst = parts.get("WKST") ?? "MO";
		if (!WEEKDAY.has(wkst)) return none("unreadable");
		if (interval > 1 && weekdays.length > 1) {
			const agrees = wkst === "SU" || (wkst === "MO" && !weekdays.includes(0));
			if (!agrees) return none("weekStart");
		}
		return { recurrence: { type, interval, weekdays } };
	}

	const day = readMonthDay(byMonthDay, start);
	if (typeof day === "string") return none(day);

	if (type === "monthly") return { recurrence: { type, interval, day } };

	let month;
	if (byMonth === undefined) {
		if (!start) return none("noStart");
		month = start.getMonth() + 1;
	} else {
		if (byMonth.includes(",")) return none("severalMonths");
		if (!/^\d+$/.test(byMonth) || Number(byMonth) < 1 || Number(byMonth) > 12)
			return none("unreadable");
		month = Number(byMonth);
	}
	return { recurrence: { type: "yearly", interval, month, day } };
}
