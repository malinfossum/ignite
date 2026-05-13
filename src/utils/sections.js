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
