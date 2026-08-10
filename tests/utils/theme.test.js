import { describe, expect, it } from "vitest";
import {
	DEFAULT_CHOICE,
	nextThemeChoice,
	resolveTheme,
	THEME_CHOICES,
} from "../../src/utils/theme.js";

describe("resolveTheme", () => {
	it("resolves an explicit choice to itself, ignoring the OS", () => {
		expect(resolveTheme("light", true)).toBe("light");
		expect(resolveTheme("dark", false)).toBe("dark");
	});

	it("resolves system against the OS preference", () => {
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
	});

	it("treats null and undefined as system", () => {
		expect(resolveTheme(null, false)).toBe("light");
		expect(resolveTheme(undefined, true)).toBe("dark");
	});

	it("treats unrecognised input as system rather than dead-ending", () => {
		expect(resolveTheme("purple", false)).toBe("light");
		expect(resolveTheme("", true)).toBe("dark");
		expect(resolveTheme(0, true)).toBe("dark");
	});
});

describe("nextThemeChoice", () => {
	it("cycles system to light to dark and back", () => {
		expect(nextThemeChoice("system")).toBe("light");
		expect(nextThemeChoice("light")).toBe("dark");
		expect(nextThemeChoice("dark")).toBe("system");
	});

	it("returns to the start after a full cycle", () => {
		let choice = "system";
		for (let i = 0; i < 3; i++) choice = nextThemeChoice(choice);
		expect(choice).toBe("system");
	});

	it("never strands the user — every choice has a successor in the cycle", () => {
		for (const choice of THEME_CHOICES) {
			expect(THEME_CHOICES).toContain(nextThemeChoice(choice));
		}
	});

	it("enters the cycle at a defined point for unrecognised input", () => {
		expect(nextThemeChoice("purple")).toBe("light");
		expect(nextThemeChoice(null)).toBe("light");
	});
});

describe("the theme vocabulary", () => {
	it("separates choices from resolved themes, in cycle order", () => {
		// The array order IS the cycle the control walks. Asserted explicitly so a
		// reorder shows up here rather than as a control that cycles the wrong way.
		expect(THEME_CHOICES).toEqual(["system", "light", "dark"]);
		expect(DEFAULT_CHOICE).toBe("system");
	});
});
