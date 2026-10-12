// scripts/bundle-size.mjs: the pure half of the bundle gate (spec R2, §10).
// scripts/check-bundle.mjs is the command that runs it. The two are split so
// the tests can import these functions without running the gate.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// Gzipped JS in dist/assets before any sync or auth code existed: gzipTotal()
// over a `vite build` of main at 3823fcb (PR #34), measured 2026-10-12.
// To re-measure: `npx vite build`, then `node scripts/check-bundle.mjs` and
// read the first number it prints.
export const BASELINE_BYTES = 19_949;

// Spec R2: sync and auth may add at most 10 kB gzipped to the client JS.
export const BUDGET_BYTES = 10_240;

// Gzip level 9 on every .js file directly in dir. Source maps, CSS and fonts
// are not client JS, so they don't count.
export function gzipTotal(dir) {
	let total = 0;
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".js")) continue;
		total += gzipSync(readFileSync(join(dir, name)), { level: 9 }).length;
	}
	return total;
}

// Exactly baseline + budget still passes. One byte more fails.
export function overBudget(
	bytes,
	baseline = BASELINE_BYTES,
	budget = BUDGET_BYTES,
) {
	return bytes > baseline + budget;
}
