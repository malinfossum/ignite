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

// Absolute summary of when a task is due, for confirming a schedule the user
// just saved. Deliberately NOT relative: `formatTimeLabel` is the row label and
// its job is to tick live ("in 40 min", "was 09:00"), which does not compose
// with a prefix — scheduling something for earlier today read "Due was 09:00".
export function formatDueSummary(dueAtIso, hasTime, now, format = "24h") {
	const day = formatOccurrenceLabel(dueAtIso, now);
	if (!hasTime) return day;
	return `${day} at ${formatHM(new Date(dueAtIso), format)}`;
}

// The four Focus tabs, in one pass. Precedence is a cascade — a date beats a
// star, a star beats the notepad — so each task lands in at most one bucket and
// the tab counts sum to something meaningful.
//
// A dated task outside today/tomorrow deliberately falls off every tab rather
// than dropping through to Starred: the date is the strongest statement the
// user has made about it, and it is still visible in its own area.
//
// `focusSectionIds` arrives as a parameter because utils/ must never import
// FOCUS_ID from model/. The controller resolves it from the section list.
export function groupTasksForFocus(tasks, now, focusSectionIds) {
	const startToday = startOfDay(now).getTime();
	const startTomorrow = startToday + ONE_DAY_MS;
	const startDayAfter = startTomorrow + ONE_DAY_MS;
	const inFocus = new Set(focusSectionIds ?? []);

	const overdue = [];
	const today = [];
	const tomorrow = [];
	const starred = [];
	const notepad = [];

	for (const t of tasks) {
		if (t.completed) continue;
		if (t.dueAt) {
			const due = new Date(t.dueAt).getTime();
			if (due < startToday) overdue.push(t);
			else if (due < startTomorrow) today.push(t);
			else if (due < startDayAfter) tomorrow.push(t);
			continue;
		}
		if (t.starred) {
			starred.push(t);
			continue;
		}
		if (inFocus.has(t.sectionId)) notepad.push(t);
	}

	starred.sort((a, b) => a.order - b.order);
	// Newest first: the notepad is a capture stream, so what you just typed goes
	// on top. Sorting in the view keeps `order` semantics — and the M4 reorder
	// invariants that rest on them — untouched. Spec §12.2.
	notepad.sort((a, b) =>
		a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
	);

	return {
		overdue: sortByDueThenUntimed(overdue),
		today: sortByDueThenUntimed(today),
		tomorrow: sortByDueThenUntimed(tomorrow),
		starred,
		notepad,
	};
}

// Day ascending; within a day, timed tasks first by clock time, then untimed.
// An untimed task means "sometime that day", not 00:00, so it must not squat at
// the top of its day just because that is where its stored midnight puts it.
//
// The DAY comparison has to come first. This sorts `overdue` as well as `today`,
// and overdue spans many days — without it, an untimed task from three weeks ago
// would sort below this morning's 09:00.
export function sortByDueThenUntimed(tasks) {
	return [...tasks].sort(byDueThenUntimed);
}

function byDueThenUntimed(a, b) {
	const dayDelta =
		startOfDay(new Date(a.dueAt)).getTime() -
		startOfDay(new Date(b.dueAt)).getTime();
	if (dayDelta !== 0) return dayDelta;

	if (a.hasTime !== b.hasTime) return a.hasTime ? -1 : 1;
	if (a.hasTime) {
		const delta = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
		if (delta !== 0) return delta;
	}

	// Explicit tie-break rather than relying on sort stability, which is engine
	// behaviour and not a guarantee — without it the order shuffles between
	// renders as unrelated tasks change. A STRING compare is correct here only
	// because `createdAt` is always `new Date().toISOString()`: UTC, fixed width,
	// so lexicographic order IS chronological. Store a local-format date in that
	// field and this breaks silently.
	return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

// The Today tab's "Next up" hero. Takes the grouped buckets rather than the raw
// task list for two reasons: it can then never promote something due next week
// into a card labelled "Next", and an untimed task due today stays a candidate
// instead of being mistaken for overdue (its stored midnight is behind `now`
// from 00:01 onward).
//
// Candidate order: the next timed thing still ahead of you today → anything
// untimed today ("sometime today" is still ahead of you) → the earliest thing
// today that has already passed → the oldest overdue item. `groups.today` and
// `groups.overdue` both arrive sorted, so first-match is the right pick.
export function pickNextTask(groups, now) {
	const today = groups?.today ?? [];
	const upcoming = today.find(
		(t) => t.hasTime && new Date(t.dueAt).getTime() > now.getTime(),
	);
	if (upcoming) return upcoming;

	const untimed = today.find((t) => !t.hasTime);
	if (untimed) return untimed;

	return today[0] ?? groups?.overdue?.[0] ?? null;
}
