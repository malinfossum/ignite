// Pure capture-destination policy. Given the current route and the full
// section list, decide where a captured task should go — and what the
// capture bar's chip should say about it.
//
// Returns `{ kind: "focus" }` rather than a section id so this file stays
// ignorant of model constants; the controller maps "focus" to
// FOCUS_DEFAULT_SECTION_ID. utils/ never imports from model/.
//
// Destination =
//   { kind: "focus" }                  — the Focus notepad
//   { kind: "direct", sectionId }      — the area's only section
//   { kind: "pick", sections }         — ask, ordered by `order`
//   { kind: "none" }                   — the area has no sections; capture off

export function captureDestination(route, sections) {
	if (route?.name !== "area") return { kind: "focus" };

	const inArea = (sections ?? [])
		.filter((s) => s.areaId === route.id)
		.sort((a, b) => a.order - b.order);

	if (inArea.length === 0) return { kind: "none" };
	if (inArea.length === 1) return { kind: "direct", sectionId: inArea[0].id };
	return { kind: "pick", sections: inArea };
}

export function captureChipLabel(destination, sectionName) {
	switch (destination.kind) {
		case "focus":
			return "Focus";
		case "direct":
			return sectionName ?? "This section";
		case "pick":
			return "Choose section…";
		case "none":
			return "Add a section first";
		default:
			// Was the catch-all for "none" too, which silently mislabelled a
			// future fifth destination.kind with "none"'s own text. Now that
			// "none" is its own case, an unrecognized kind here is a real bug
			// in captureDestination — throw rather than guess a label.
			// Mirrors model/recurrence.js's exhaustive-switch guard.
			throw new Error(`Unknown capture destination kind: ${destination.kind}`);
	}
}
