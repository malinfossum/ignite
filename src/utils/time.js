// Pure helpers for time-based view logic. No DOM, no globals — `now` always
// arrives as a parameter so tests are deterministic.

const ONE_MIN = 60_000;
const ONE_DAY_MS = 24 * 60 * 60_000;
const SHORT_WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTH = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function startOfDay(date) {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

function isSameDay(a, b) {
	return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function pad2(n) {
	return n.toString().padStart(2, "0");
}

function formatHM(date, format) {
	if (format === "12h") {
		const h24 = date.getHours();
		const period = h24 >= 12 ? "PM" : "AM";
		const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
		return `${h12}:${pad2(date.getMinutes())} ${period}`;
	}
	return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatTimeLabel(dueAtIso, now, format = "24h") {
	const due = new Date(dueAtIso);
	const diffMs = due.getTime() - now.getTime();

	if (diffMs >= 0 && diffMs < ONE_MIN) return "now";
	if (diffMs > 0 && diffMs < 60 * ONE_MIN) {
		return `in ${Math.round(diffMs / ONE_MIN)} min`;
	}

	if (isSameDay(due, now)) {
		const hm = formatHM(due, format);
		return diffMs < 0 ? `was ${hm}` : hm;
	}

	const tomorrow = new Date(startOfDay(now).getTime() + ONE_DAY_MS);
	if (isSameDay(due, tomorrow)) return `Tomorrow ${formatHM(due, format)}`;

	const dayDelta = Math.floor(
		(startOfDay(due).getTime() - startOfDay(now).getTime()) / ONE_DAY_MS,
	);
	if (dayDelta > 0 && dayDelta < 7) {
		return `${SHORT_WEEKDAY[due.getDay()]} ${formatHM(due, format)}`;
	}

	return `${SHORT_MONTH[due.getMonth()]} ${due.getDate()} · ${formatHM(due, format)}`;
}

// Date-only label for a recurrence's next occurrence — no time-of-day, since
// recurring dueAts are stored at local midnight. Used by the completion toast
// ("Done · next Jul 6") and the ⟲ badge aria-label.
export function formatOccurrenceLabel(dueAtIso, now) {
	const due = new Date(dueAtIso);
	if (isSameDay(due, now)) return "Today";

	const tomorrow = new Date(startOfDay(now).getTime() + ONE_DAY_MS);
	if (isSameDay(due, tomorrow)) return "Tomorrow";

	const dayDelta = Math.floor(
		(startOfDay(due).getTime() - startOfDay(now).getTime()) / ONE_DAY_MS,
	);
	if (dayDelta > 0 && dayDelta < 7) return SHORT_WEEKDAY[due.getDay()];

	return `${SHORT_MONTH[due.getMonth()]} ${due.getDate()}`;
}

export function groupTasksForToday(tasks, now) {
	const startToday = startOfDay(now).getTime();
	const startTomorrow = startToday + ONE_DAY_MS;

	const overdue = [];
	const today = [];
	const starred = [];

	for (const t of tasks) {
		if (t.completed) continue;
		if (t.dueAt) {
			const due = new Date(t.dueAt).getTime();
			if (due < startToday) overdue.push(t);
			else if (due < startTomorrow) today.push(t);
		} else if (t.starred) {
			starred.push(t);
		}
	}

	overdue.sort(byDueAtAsc);
	today.sort(byDueAtAsc);
	starred.sort((a, b) => a.order - b.order);

	return { overdue, today, starred };
}

export function pickNextTask(tasks, now) {
	const active = tasks.filter((t) => !t.completed);
	const dated = active.filter((t) => t.dueAt).sort(byDueAtAsc);
	const upcoming = dated.find(
		(t) => new Date(t.dueAt).getTime() > now.getTime(),
	);
	if (upcoming) return upcoming;

	const overdue = dated.find(
		(t) => new Date(t.dueAt).getTime() <= now.getTime(),
	);
	if (overdue) return overdue;

	const starred = active
		.filter((t) => t.starred && !t.dueAt)
		.sort((a, b) => a.order - b.order);
	return starred[0] ?? null;
}

function byDueAtAsc(a, b) {
	return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}
