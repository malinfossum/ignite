import { env, exports } from "cloudflare:workers";
import { inArray } from "drizzle-orm";
import { connect, type Database } from "../../src/db.ts";
import type { Env } from "../../src/env.ts";
import { user } from "../../src/schema.ts";

export const ORIGIN = "https://ignite.test";
export const PASSWORD = "correct horse battery staple";
export const testEnv = env as unknown as Env;

// A fresh client IP per request, so Better Auth's rate limiter (5 sign-ins per
// 60 seconds per IP, auth.ts) never trips across tests.
function randomIp(): string {
	const [a, b, c] = crypto.getRandomValues(new Uint8Array(3));
	return `10.${a}.${b}.${c}`;
}

export type CallOptions = {
	method?: string;
	body?: unknown;
	raw?: string;
	cookie?: string;
	origin?: string | null;
	contentType?: string | null;
};

// A request to the Worker, shaped like the app's own: same Origin and JSON.
export function call(
	path: string,
	options: CallOptions = {},
): Promise<Response> {
	const body =
		options.raw ??
		(options.body === undefined ? undefined : JSON.stringify(options.body));
	const headers = new Headers({ "cf-connecting-ip": randomIp() });
	if (options.origin !== null) headers.set("Origin", options.origin ?? ORIGIN);
	if (body !== undefined && options.contentType !== null) {
		headers.set("Content-Type", options.contentType ?? "application/json");
	}
	if (options.cookie) headers.set("Cookie", options.cookie);
	return exports.default.fetch(
		new Request(`${ORIGIN}${path}`, {
			method: options.method ?? (body === undefined ? "GET" : "POST"),
			headers,
			body,
		}),
	);
}

// Every cookie the response set, as a Cookie request header.
export function cookieHeader(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
}

export async function signUp(
	email: string,
): Promise<{ userId: string; cookie: string }> {
	const res = await call("/api/auth/sign-up/email", {
		body: { name: email, email, password: PASSWORD, rememberMe: false },
	});
	if (res.status !== 200) throw new Error(`Sign-up answered ${res.status}`);
	const body = (await res.json()) as { user: { id: string } };
	return { userId: body.user.id, cookie: cookieHeader(res) };
}

export async function withDb<T>(fn: (db: Database) => Promise<T>): Promise<T> {
	const { db, close } = await connect(testEnv);
	try {
		return await fn(db);
	} finally {
		await close();
	}
}

// ON DELETE CASCADE takes each user's sessions, rows and tombstones with it.
export function deleteUsers(emails: string[]): Promise<void> {
	return withDb(async (db) => {
		await db.delete(user).where(
			inArray(
				user.email,
				emails.map((email) => email.toLowerCase()),
			),
		);
	});
}
