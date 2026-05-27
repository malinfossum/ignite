// Pure helpers for ARIA APG menu keyboard navigation.
// No DOM, no view dependencies. The view code maps menuitem DOM nodes
// to the `items` shape:
//   Array.from(menuEl.querySelectorAll('[role="menuitem"]'))
//     .map(el => ({ disabled: el.disabled }))

// Returns the index of the first non-disabled item.
// -1 if none (including empty array).
export function firstEnabledIndex(items) {
	for (let i = 0; i < items.length; i++) {
		if (!items[i].disabled) return i;
	}
	return -1;
}

// Returns the index of the last non-disabled item.
// -1 if none (including empty array).
export function lastEnabledIndex(items) {
	for (let i = items.length - 1; i >= 0; i--) {
		if (!items[i].disabled) return i;
	}
	return -1;
}

// Returns the next non-disabled index in `direction` (+1 = forward, -1 = backward),
// wrapping around the array boundary. Returns `currentIndex` if it's the only
// enabled item. Returns -1 if no item is enabled (including empty array).
export function nextEnabledIndex(items, currentIndex, direction) {
	if (items.length === 0) return -1;
	let idx = currentIndex;
	for (let step = 0; step < items.length; step++) {
		idx = (idx + direction + items.length) % items.length;
		if (!items[idx].disabled) return idx;
	}
	return -1; // all disabled
}
