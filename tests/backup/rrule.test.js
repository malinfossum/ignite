import { describe, expect, it } from "vitest";
import {
	RRULE_REASONS as R,
	rruleToRecurrence,
} from "../../src/backup/rrule.js";
import { isValidRecurrence } from "../../src/model/recurrence.js";

const START = new Date(2026, 10, 12, 9, 0); // Thursday 12.11.2026 09:00 local
const ok = (rule) => rruleToRecurrence(rule, START).recurrence;
const why = (rule, start = START) => rruleToRecurrence(rule, start).reason;

describe("rruleToRecurrence, supported", () => {
	it("daily with an interval", () => {
		expect(ok("FREQ=DAILY;INTERVAL=3")).toEqual({ type: "daily", interval: 3 });
	});
	it("weekly on listed days, Sunday = 0", () => {
		expect(ok("FREQ=WEEKLY;BYDAY=TH,MO,SU")).toEqual({
			type: "weekly",
			interval: 1,
			weekdays: [0, 1, 4],
		});
	});
	it("weekly with no BYDAY takes the start's weekday", () => {
		expect(ok("FREQ=WEEKLY")).toEqual({
			type: "weekly",
			interval: 1,
			weekdays: [4],
		});
	});
	it("monthly on a day", () => {
		expect(ok("FREQ=MONTHLY;BYMONTHDAY=1")).toEqual({
			type: "monthly",
			interval: 1,
			day: 1,
		});
	});
	it("monthly on the last day becomes day 31", () => {
		expect(ok("FREQ=MONTHLY;BYMONTHDAY=-1")).toEqual({
			type: "monthly",
			interval: 1,
			day: 31,
		});
	});
	it("monthly with no BYMONTHDAY takes the start's day", () => {
		expect(ok("FREQ=MONTHLY;INTERVAL=2")).toEqual({
			type: "monthly",
			interval: 2,
			day: 12,
		});
	});
	it("yearly, explicit and from the start", () => {
		expect(ok("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=14")).toEqual({
			type: "yearly",
			interval: 1,
			month: 2,
			day: 14,
		});
		expect(ok("FREQ=YEARLY")).toEqual({
			type: "yearly",
			interval: 1,
			month: 11,
			day: 12,
		});
	});
	it("reads past a DTSTART line and an RRULE: prefix", () => {
		expect(ok("DTSTART:20261112T090000Z\nRRULE:FREQ=DAILY")).toEqual({
			type: "daily",
			interval: 1,
		});
	});
	it("accepts WKST when it can't change anything", () => {
		expect(ok("FREQ=WEEKLY;WKST=MO;BYDAY=MO")).toEqual({
			type: "weekly",
			interval: 1,
			weekdays: [1],
		});
		expect(ok("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH")).toEqual({
			type: "weekly",
			interval: 2,
			weekdays: [1, 4],
		});
		expect(ok("FREQ=WEEKLY;INTERVAL=2;WKST=SU;BYDAY=SU,MO")).toEqual({
			type: "weekly",
			interval: 2,
			weekdays: [0, 1],
		});
	});
	it("every result is a rule the model accepts", () => {
		for (const rule of [
			"FREQ=DAILY",
			"FREQ=WEEKLY",
			"FREQ=MONTHLY;BYMONTHDAY=-1",
			"FREQ=YEARLY",
		]) {
			expect(isValidRecurrence(ok(rule))).toBe(true);
		}
	});
	it("daily on listed weekdays is a weekly rule (RFC 5545)", () => {
		expect(ok("FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR")).toEqual({
			type: "weekly",
			interval: 1,
			weekdays: [1, 2, 3, 4, 5],
		});
	});
});

describe("rruleToRecurrence, refused with a reason", () => {
	it.each([
		["FREQ=MONTHLY;BYDAY=1MO", R.position],
		["FREQ=MONTHLY;BYSETPOS=1;BYDAY=MO", R.position],
		["FREQ=WEEKLY;BYDAY=1MO", R.position],
		["FREQ=MONTHLY;BYDAY=MO", R.weekdayRule],
		["FREQ=DAILY;INTERVAL=2;BYDAY=MO", R.unknown],
		["FREQ=DAILY;BYDAY=MO;BYMONTH=1", R.unknown],
		["FREQ=DAILY;BYDAY=MO;BYMONTHDAY=1", R.unknown],
		["FREQ=DAILY;COUNT=5", R.ends],
		["FREQ=DAILY;UNTIL=20261231T000000Z", R.ends],
		["FREQ=DAILY;BYHOUR=9", R.hours],
		["FREQ=MONTHLY;BYMONTHDAY=1,15", R.severalDays],
		["FREQ=MONTHLY;BYMONTHDAY=-2", R.fromEnd],
		["FREQ=YEARLY;BYMONTH=1,7", R.severalMonths],
		["FREQ=HOURLY", R.frequency],
		["FREQ=DAILY;FOO=1", R.unknown],
		["FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO", R.weekStart],
		["FREQ=WEEKLY;INTERVAL=2;WKST=TU;BYDAY=MO,TH", R.weekStart],
		["FREQ=WEEKLY;WKST=XX;BYDAY=MO", R.unreadable],
		["FREQ=DAILY;INTERVAL=0", R.unreadable],
		["INTERVAL=2", R.unreadable],
		[
			"DTSTART:20261112T090000Z\nRDATE:20261120T090000Z\nRRULE:FREQ=DAILY",
			R.unknown,
		],
		["", R.empty],
	])("%s", (rule, reason) => {
		expect(why(rule)).toBe(reason);
	});

	it("needs a start date when the rule leaves the day out", () => {
		expect(why("FREQ=WEEKLY", null)).toBe(R.noStart);
		expect(why("FREQ=MONTHLY", null)).toBe(R.noStart);
	});

	it("never guesses: an unknown part wins over everything else", () => {
		expect(
			rruleToRecurrence("FREQ=DAILY;X-THING=1", START).recurrence,
		).toBeNull();
	});
});
