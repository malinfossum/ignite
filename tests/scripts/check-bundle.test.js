import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
	BASELINE_BYTES,
	BUDGET_BYTES,
	gzipTotal,
	overBudget,
} from "../../scripts/bundle-size.mjs";

const CLI = fileURLToPath(
	new URL("../../scripts/check-bundle.mjs", import.meta.url),
);

let dirs = [];
function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "ignite-bundle-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	dirs = [];
});

const gz = (text) => gzipSync(text, { level: 9 }).length;

describe("gzipTotal", () => {
	it("sums the gzipped size of every .js file", () => {
		const dir = tempDir();
		const a = "export const a = 1;\n".repeat(50);
		const b = "console.log('b');\n";
		writeFileSync(join(dir, "index-abc.js"), a);
		writeFileSync(join(dir, "chunk-def.js"), b);
		expect(gzipTotal(dir)).toBe(gz(a) + gz(b));
	});

	it("ignores source maps, CSS and fonts", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "index-abc.js"), "export {};\n");
		writeFileSync(join(dir, "index-abc.js.map"), "{}".repeat(1000));
		writeFileSync(join(dir, "index-abc.css"), "a{}".repeat(1000));
		writeFileSync(join(dir, "font.woff2"), randomBytes(1000));
		expect(gzipTotal(dir)).toBe(gz("export {};\n"));
	});
});

describe("overBudget", () => {
	it("allows growth up to exactly the budget", () => {
		expect(overBudget(20_000 + 10_240, 20_000, 10_240)).toBe(false);
	});

	it("fails one byte past it", () => {
		expect(overBudget(20_000 + 10_241, 20_000, 10_240)).toBe(true);
	});

	it("defaults to the measured baseline and a 10 240-byte budget", () => {
		expect(BUDGET_BYTES).toBe(10_240);
		expect(overBudget(BASELINE_BYTES + BUDGET_BYTES)).toBe(false);
		expect(overBudget(BASELINE_BYTES + BUDGET_BYTES + 1)).toBe(true);
	});

	it("pins the baseline measured before any sync code", () => {
		// Step 12's number. Raising it would quietly grow the budget, so it
		// changes only with my yes (R2), and this test makes that a visible edit.
		expect(BASELINE_BYTES).toBe(19_949);
	});
});

describe("check-bundle command", () => {
	const run = (dir) =>
		spawnSync(process.execPath, [CLI, dir], { encoding: "utf8" });

	it("passes a bundle inside the budget", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "index.js"), "export const a = 1;\n");
		const result = run(dir);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Bundle gate:");
	});

	it("exits 1 when the bundle is over the limit", () => {
		const dir = tempDir();
		// Random bytes don't compress, so the gzipped size stays over the limit.
		writeFileSync(
			join(dir, "index.js"),
			randomBytes(BASELINE_BYTES + BUDGET_BYTES + 5_000),
		);
		const result = run(dir);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("over the limit");
	});

	it("exits 1 when there is no JS, so a missing build can't pass", () => {
		const result = run(tempDir());
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("no JS files");
	});
});
