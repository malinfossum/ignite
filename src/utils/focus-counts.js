// One derivation of "what is in Focus, and how much of it needs attention today".
//
// Before this file the section-id filter existed byte-for-byte in controller.js
// (for the page-header summary) and views/focus.js (for the tab counts). The
// sidebar's hero card is the third consumer, and a one-sided edit across three
// copies would silently desync numbers that sit on screen at the same time.
//
// `focusAreaId` arrives as a parameter, not an import: utils/ must stay ignorant
// of FOCUS_ID, the same contract utils/time.js keeps.

import { groupTasksForFocus, summariseDay } from "./time.js";

export function focusSectionIds(sections, focusAreaId) {
	return sections.filter((s) => s.areaId === focusAreaId).map((s) => s.id);
}

export function focusCounts(sections, tasks, now, focusAreaId) {
	const sectionIds = focusSectionIds(sections, focusAreaId);
	const groups = groupTasksForFocus(tasks, now, sectionIds);
	const { overdue, dueToday } = summariseDay(groups);
	// `attention` is what the collapsed rail's single badge shows: one number for
	// "needs looking at today". The expanded card spells out the breakdown.
	return {
		sectionIds,
		groups,
		overdue,
		dueToday,
		attention: overdue + dueToday,
	};
}
