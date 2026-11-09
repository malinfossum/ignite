import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const note = execFileSync(
	process.execPath,
	["tools/amplenote-plugin/build-note.mjs"],
	{ encoding: "utf8" },
);
const code = note.slice(note.indexOf("```js"));

describe("build-note", () => {
	// Amplenote escapes < and > to &lt; and &gt; when the note is pasted,
	// which turns `=>` into a syntax error and the plugin won't install.
	it("keeps < and > out of the plugin code", () => {
		expect(code).not.toMatch(/[<>]/);
	});

	it("wraps the code in one js block", () => {
		expect(code.startsWith("```js\n{")).toBe(true);
		expect(code.trimEnd().endsWith("}\n```")).toBe(true);
	});
});
