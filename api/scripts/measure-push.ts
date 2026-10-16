// Measures the deployed Worker for spec §12: sign-up, sign-in, a push of
// MAX_CHANGES tasks (typical, full-size, and a retry of the full one) and a
// full pull page. CPU time comes from Workers Logs; this script only sends the
// requests and prints status and wall time.
// Usage: node api/scripts/measure-push.ts https://ignite.<subdomain>.workers.dev [--sign-up]

import {
	type Change,
	MAX_BODY_BYTES,
	MAX_CHANGES,
	PROTOCOL_VERSION,
	type PullResponse,
	type PushResponse,
} from "../../shared/protocol.ts";
import { readHidden, readLine } from "./lib.ts";

const RUNS = 3;

// count new tasks in a section that doesn't exist, so they never show in the app.
export function makeChanges(
	count: number,
	notesLength: number,
	now: Date,
): Change[] {
	const at = now.toISOString();
	return Array.from({ length: count }, (_, i) => {
		const id = crypto.randomUUID();
		const change: Change = {
			store: "tasks",
			id,
			op: "put",
			record: {
				id,
				sectionId: "cpu-measurement",
				title: `Measured task ${i + 1}`,
				notes: "n".repeat(notesLength),
				completed: false,
				starred: i % 5 === 0,
				critical: false,
				dueAt: i % 3 === 0 ? at : null,
				hasTime: false,
				recurrence:
					i % 4 === 0
						? { type: "weekly", interval: 1, weekdays: [1, 3] }
						: null,
				lastCompletedAt: null,
				completedCount: 0,
				leadTime: 0,
				scheduledTags: [],
				createdAt: at,
				order: i,
				updatedAt: at,
			},
		};
		return change;
	});
}

// Notes long enough to bring the whole body within 2 kB of MAX_BODY_BYTES.
function fullNotesLength(now: Date): number {
	const empty = JSON.stringify({
		protocol: PROTOCOL_VERSION,
		changes: makeChanges(MAX_CHANGES, 0, now),
	}).length;
	return Math.floor((MAX_BODY_BYTES - 2_048 - empty) / MAX_CHANGES);
}

const base = process.argv[2]?.replace(/\/$/, "");
if (!base?.startsWith("https://")) {
	console.error(
		"Usage: node api/scripts/measure-push.ts https://ignite.<subdomain>.workers.dev [--sign-up]",
	);
	process.exit(1);
}
const signUpFirst = process.argv.includes("--sign-up");

async function post(path: string, body: unknown, cookie = "") {
	const started = performance.now();
	const res = await fetch(`${base}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: base as string,
			...(cookie ? { Cookie: cookie } : {}),
		},
		body: JSON.stringify(body),
	});
	return { res, ms: Math.round(performance.now() - started) };
}

// A same-origin GET carries no Origin header, so none is sent here either.
async function get(path: string, cookie: string) {
	const started = performance.now();
	const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
	return { res, ms: Math.round(performance.now() - started) };
}

function report(label: string, status: number, ms: number, extra = "") {
	console.log(
		`${label.padEnd(18)} ${status}  ${String(ms).padStart(5)} ms wall  ${extra}`,
	);
}

const email = (await readLine("Email: ")).trim();
const password = await readHidden("Password (a throwaway, 15+ characters): ");
console.log(
	`Started ${new Date().toISOString()}. Look for requests after this time.`,
);

if (signUpFirst) {
	const { res, ms } = await post("/api/auth/sign-up/email", {
		name: email,
		email,
		password,
		rememberMe: false,
	});
	report("sign-up", res.status, ms);
}

let cookie = "";
for (let run = 1; run <= RUNS; run++) {
	// auth.ts allows 5 sign-ins per IP, reset only after a minute with no
	// attempt. The three runs fit; a second run of this script needs that
	// minute of quiet first.
	await new Promise((resolve) => setTimeout(resolve, 4_000));
	const { res, ms } = await post("/api/auth/sign-in/email", {
		email,
		password,
		rememberMe: false,
	});
	report(`sign-in ${run}`, res.status, ms);
	cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}
if (!cookie)
	throw new Error("No session cookie. Check the email and password.");

const payloads = [
	{ label: "push typical", notes: 200 },
	{ label: "push full", notes: fullNotesLength(new Date()) },
];
let lastBody: unknown = null;
for (const { label, notes } of payloads) {
	for (let run = 1; run <= RUNS; run++) {
		const body = {
			protocol: PROTOCOL_VERSION,
			changes: makeChanges(MAX_CHANGES, notes, new Date()),
		};
		lastBody = body;
		const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
		const { res, ms } = await post("/api/sync/push", body, cookie);
		const json = res.ok ? ((await res.json()) as PushResponse) : null;
		report(
			`${label} ${run}`,
			res.status,
			ms,
			`${bytes} bytes, ${json?.accepted.length ?? 0} accepted, ${json?.lost.length ?? 0} lost`,
		);
	}
}

// The last full body once more, as a client resends after a lost answer.
// Every change loses on equal time, so all of them come back with the server's
// full row: the heaviest answer a push can give.
const retry = await post("/api/sync/push", lastBody, cookie);
const retried = retry.res.ok
	? ((await retry.res.json()) as PushResponse)
	: null;
report(
	"push full retry",
	retry.res.status,
	retry.ms,
	`${retried?.accepted.length ?? 0} accepted, ${retried?.lost.length ?? 0} lost`,
);

// 1,200 measured tasks are more than one page, so each pull is a full one.
for (let run = 1; run <= RUNS; run++) {
	const { res, ms } = await get(
		`/api/sync/pull?since=0&protocol=${PROTOCOL_VERSION}`,
		cookie,
	);
	const page = res.ok ? ((await res.json()) as PullResponse) : null;
	report(
		`pull ${run}`,
		res.status,
		ms,
		`${page?.changes.length ?? 0} changes, more: ${page?.more ?? "?"}`,
	);
}

const { res } = await post("/api/auth/sign-out", {}, cookie);
report("sign-out", res.status, 0);
