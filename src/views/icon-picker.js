// renderIconPicker(selected) → HTML string
//
// A curated grid for the area `icon` field, which already exists on the model
// (areas.js seeds Focus with "🔥"). Emoji, not SVG, because that is what the
// field already holds — no migration, no assets, and it works offline.
//
// The icon itself stays aria-hidden wherever it renders in the sidebar: the area
// NAME carries the accessible meaning, and emoji announce inconsistently across
// screen readers. Here in the picker each button needs its own name, so the
// label is written out.

export const AREA_ICONS = [
	"🔥",
	"⭐",
	"🎯",
	"✅",
	"📌",
	"💡",
	"🧠",
	"📚",
	"💼",
	"🏠",
	"🧹",
	"🛒",
	"🍳",
	"💪",
	"🏃",
	"🌱",
	"🎨",
	"🎵",
	"💰",
	"✈️",
	"❤️",
	"🐾",
	"🔧",
	"📅",
];

const LABELS = {
	"🔥": "Flame",
	"⭐": "Star",
	"🎯": "Target",
	"✅": "Check",
	"📌": "Pin",
	"💡": "Idea",
	"🧠": "Brain",
	"📚": "Books",
	"💼": "Work",
	"🏠": "Home",
	"🧹": "Cleaning",
	"🛒": "Shopping",
	"🍳": "Cooking",
	"💪": "Strength",
	"🏃": "Running",
	"🌱": "Growth",
	"🎨": "Art",
	"🎵": "Music",
	"💰": "Money",
	"✈️": "Travel",
	"❤️": "Heart",
	"🐾": "Pets",
	"🔧": "Tools",
	"📅": "Calendar",
};

export function renderIconPicker(selected) {
	const current = selected ?? "";
	// One icon per area, so this is SINGLE-SELECT: role=radio + aria-checked, not
	// 24 independent aria-pressed toggles, which a screen reader would present as
	// 24 unrelated switches rather than one choice.
	//
	// Roving tabindex: exactly one option is tabbable, arrows move between them.
	// Without it the picker adds 25 tab stops between the rename input and the
	// next control, inside a rename flow that is keyboard-first.
	//
	// The tab stop sits on the checked option. When `current` is absent or is a
	// value outside the curated set, it falls to the clear option — so the group
	// always has exactly one tabbable entry and never strands a keyboard user.
	const tabStop = AREA_ICONS.includes(current) ? current : "";

	const option = (icon, label, extraClass = "") => `
			<button type="button" class="icon-picker__option${extraClass}"
				role="radio"
				data-action="pick-area-icon" data-icon="${icon}"
				aria-checked="${current === icon}" tabindex="${icon === tabStop ? "0" : "-1"}"
				aria-label="${label}">${icon || "•"}</button>`;

	// The group carries its own aria-label: a role="radiogroup" without an
	// accessible name announces as a bare "radio group" with no indication of
	// what it groups. The label count assertion in the tests accounts for it.
	return `
		<div class="icon-picker" role="radiogroup" aria-label="Area icon">
			${AREA_ICONS.map((icon) => option(icon, LABELS[icon])).join("")}
			${option("", "No icon", " icon-picker__option--clear")}
		</div>
	`;
}
