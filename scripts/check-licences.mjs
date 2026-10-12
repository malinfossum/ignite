// Prints every package that is new in package-lock.json since main and whose
// licence is outside my allowlist. `npm view` only sees the packages I name,
// and this sees everything they pull in. Exits 1 when it lists any.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOWED = new Set([
	"MIT",
	"Apache-2.0",
	"ISC",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"0BSD",
	"CC0-1.0",
]);

// Only dev tooling reaches these, so they never ship. Wrangler's local
// simulator pulls in sharp's libvips binaries (decided 2026-10-07).
const ALLOWED_DEV = new Set([...ALLOWED, "LGPL-3.0-or-later"]);

/** True when every SPDX id in the expression is on the allowlist. */
function allowed(entry) {
	const list = entry.dev === true ? ALLOWED_DEV : ALLOWED;
	const ids = String(entry.license ?? "")
		.split(/\s+OR\s+|\s+AND\s+|[()]/)
		.map((id) => id.trim())
		.filter(Boolean);
	return ids.length > 0 && ids.every((id) => list.has(id));
}

const base = JSON.parse(
	execFileSync("git", ["show", "main:package-lock.json"], { encoding: "utf8" }),
).packages;
const current = JSON.parse(readFileSync("package-lock.json", "utf8")).packages;

// A package counts as new when main has no entry at that path, or a different
// version. Workspace links carry no licence of their own and are skipped.
const bad = Object.entries(current).filter(
	([path, entry]) =>
		path.includes("node_modules/") &&
		entry.link === undefined &&
		base[path]?.version !== entry.version &&
		!allowed(entry),
);

for (const [path, entry] of bad) {
	const name = path.slice(path.lastIndexOf("node_modules/") + 13);
	console.log(`${name} ${entry.version} ${entry.license ?? "(none)"}`);
}
console.log(`${bad.length} disallowed`);
process.exitCode = bad.length > 0 ? 1 : 0;
