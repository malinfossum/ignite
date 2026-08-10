import { describe, expect, it } from "vitest";
import { AREA_ICONS, renderIconPicker } from "../../src/views/icon-picker.js";

// Attributes are laid out across several lines in the template, so raw substring
// assertions are whitespace-brittle. Flatten before matching.
const flat = (s) => s.replace(/\s+/g, " ");

describe("AREA_ICONS", () => {
	it("offers 24 icons", () => {
		expect(AREA_ICONS).toHaveLength(24);
	});

	it("has no duplicates", () => {
		expect(new Set(AREA_ICONS).size).toBe(AREA_ICONS.length);
	});

	it("includes the flame Focus is seeded with", () => {
		expect(AREA_ICONS).toContain("🔥");
	});
});

describe("renderIconPicker", () => {
	it("renders one option per icon plus a clear option", () => {
		const html = renderIconPicker("");
		expect(html.match(/data-action="pick-area-icon"/g)).toHaveLength(
			AREA_ICONS.length + 1,
		);
	});

	it("is a radio group, not a row of toggles", () => {
		const html = renderIconPicker("🔥");
		expect(html).toContain('role="radiogroup"');
		expect(html.match(/role="radio"/g)).toHaveLength(AREA_ICONS.length + 1);
		expect(html).not.toContain("aria-pressed");
	});

	it("checks exactly the selected icon", () => {
		const html = flat(renderIconPicker("🔥"));
		expect(html).toContain('data-icon="🔥" aria-checked="true"');
		expect(html).toContain('data-icon="🎯" aria-checked="false"');
		expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
	});

	it("checks the clear option when no icon is set", () => {
		const html = flat(renderIconPicker(""));
		expect(html).toContain('data-icon="" aria-checked="true"');
		expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
	});

	it("exposes exactly one tab stop — the roving tabindex", () => {
		const html = renderIconPicker("🔥");
		expect(html.match(/tabindex="0"/g)).toHaveLength(1);
		expect(html.match(/tabindex="-1"/g)).toHaveLength(AREA_ICONS.length);
	});

	it("puts the tab stop on the clear option when nothing is selected", () => {
		const html = flat(renderIconPicker(""));
		expect(html).toContain('data-icon="" aria-checked="true" tabindex="0"');
		// Exclusivity, not just presence: an off-by-one in the tabStop fallback
		// could leave a second option tabbable and still satisfy the line above.
		expect(html.match(/tabindex="0"/g)).toHaveLength(1);
		expect(html.match(/tabindex="-1"/g)).toHaveLength(AREA_ICONS.length);
	});

	it("still exposes one tab stop for an icon outside the curated set", () => {
		// A value from an older build or a future import must not strand the
		// keyboard user with zero reachable options.
		const html = renderIconPicker("🦊");
		expect(html.match(/tabindex="0"/g)).toHaveLength(1);
		expect(html.match(/tabindex="-1"/g)).toHaveLength(AREA_ICONS.length);
		// The tab stop lands on the clear option, since no visible option
		// represents the unrecognised value.
		expect(flat(html)).toContain(
			'data-icon="" aria-checked="false" tabindex="0"',
		);
	});

	it("names the group as well as every option", () => {
		const html = renderIconPicker("");
		// The group itself must be named — an unnamed role="radiogroup" announces
		// as a bare "radio group". So the expected count is every option (icons
		// plus the clear option) PLUS the group wrapper.
		expect(flat(html)).toContain('role="radiogroup" aria-label="Area icon"');
		expect(html.match(/aria-label="[^"]+"/g)).toHaveLength(
			AREA_ICONS.length + 2,
		);
	});
});
