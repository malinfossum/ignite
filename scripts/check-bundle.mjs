// scripts/check-bundle.mjs: the bundle-size gate (spec R2, §10).
// `npm run build` runs it after `vite build`, so a client bundle that grew past
// the budget fails the build locally and in CI.
// Usage: node scripts/check-bundle.mjs [dir]   (dir defaults to dist/assets)
import {
	BASELINE_BYTES,
	BUDGET_BYTES,
	gzipTotal,
	overBudget,
} from "./bundle-size.mjs";

const dir = process.argv[2] ?? "dist/assets";
const total = gzipTotal(dir);
const limit = BASELINE_BYTES + BUDGET_BYTES;

if (total === 0) {
	// A missing build must never pass the gate by measuring nothing.
	console.error(`Bundle gate: no JS files in ${dir}. Run vite build first.`);
	process.exitCode = 1;
} else if (overBudget(total)) {
	console.error(
		`Bundle gate: ${total} bytes of gzipped JS is over the limit of ${limit} (baseline ${BASELINE_BYTES} + budget ${BUDGET_BYTES}). See spec R2.`,
	);
	process.exitCode = 1;
} else {
	console.log(
		`Bundle gate: ${total} of ${limit} bytes of gzipped JS (${limit - total} left).`,
	);
}
