// Pure theme logic. No DOM, no storage — the caller supplies every input.
//
// TWO VOCABULARIES, deliberately separate:
//   choice   — "system" | "dark" | "light"; what the user picks and what persists
//   resolved — "dark" | "light"; what actually reaches data-theme
//
// The control cycles three states rather than toggling two. A binary toggle
// starting from "system" could only ever write "dark" or "light", so the first
// tap would permanently end OS-following with no way back through the UI.

// The ARRAY ORDER IS THE CYCLE: system → light → dark → system. Reordering this
// reorders what the control does.
export const THEME_CHOICES = ["system", "light", "dark"];
export const DEFAULT_CHOICE = "system";

export function resolveTheme(choice, prefersDark) {
	if (choice === "dark" || choice === "light") return choice;
	// Anything else — "system", null, a stale value from an older build — follows
	// the OS. Treating unknown input as "system" keeps a corrupted setting
	// recoverable instead of stranding the user on a theme they cannot leave.
	return prefersDark ? "dark" : "light";
}

export function nextThemeChoice(choice) {
	const i = THEME_CHOICES.indexOf(choice);
	// Unrecognised input already RESOLVES as "system" (see resolveTheme), so it has
	// to take system's successor. Letting indexOf's -1 fall through to index 0
	// would return "system" itself — and the control would appear to do nothing.
	const from = i === -1 ? THEME_CHOICES.indexOf(DEFAULT_CHOICE) : i;
	return THEME_CHOICES[(from + 1) % THEME_CHOICES.length];
}
