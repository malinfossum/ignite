// Pure area lookups for view code. No DOM, no model imports — the caller passes
// the full section and area lists it already has in `state`.

// areaForTask(task, sections, areas) → Area | null
//
// Resolves the area a task lives in, for the row's area badge. Returns null
// rather than throwing when either link is missing: a task whose section was
// cascade-deleted mid-render is a real race, and a badge is not worth a throw
// inside a template.
export function areaForTask(task, sections, areas) {
	if (!task) return null;
	const section = (sections ?? []).find((s) => s.id === task.sectionId);
	if (!section) return null;
	return (areas ?? []).find((a) => a.id === section.areaId) ?? null;
}
