// Pure helper: returns a new sections array with the target section's
// `order` value swapped with its immediate neighbour (sorted by `order`).
// At an edge ("up" on the first, "down" on the last) it returns the
// input unchanged. Handles non-contiguous order values defensively.
//
// direction: "up" | "down"

export function reorderSections(sections, sectionId, direction) {
	const sorted = [...sections].sort((a, b) => a.order - b.order);
	const idx = sorted.findIndex((s) => s.id === sectionId);
	if (idx === -1) return sections;

	const neighbourIdx = direction === "up" ? idx - 1 : idx + 1;
	if (neighbourIdx < 0 || neighbourIdx >= sorted.length) return sections;

	const target = sorted[idx];
	const neighbour = sorted[neighbourIdx];

	// Return a NEW array (no mutation). Other sections are unchanged.
	return sections.map((s) => {
		if (s.id === target.id) return { ...s, order: neighbour.order };
		if (s.id === neighbour.id) return { ...s, order: target.order };
		return s;
	});
}

// Pure helper: returns the id of the section immediately before `sectionId`
// when sorted by `order`, or null when it is first, absent, or the list is
// empty. Caller passes ONE area's sections (the peers) — same contract as
// reorderSections above. Handles non-contiguous and unsorted input.
//
// Used for cascade-delete focus routing: the deleted section's ⋯ button is
// gone after the delete, so focus is routed to its predecessor's ⋯ instead
// of dropping to <body>. A null return means "no predecessor" — the caller
// falls back to the area's "＋ New section" button.

export function previousSectionId(sections, sectionId) {
	const sorted = [...sections].sort((a, b) => a.order - b.order);
	const idx = sorted.findIndex((s) => s.id === sectionId);
	if (idx <= 0) return null; // -1 = not found, 0 = first → no predecessor
	return sorted[idx - 1].id;
}
