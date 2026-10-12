// Better Auth: email and password only (spec §5.4, §9).

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import type { Database } from "./db.ts";
import type { Env } from "./env.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import * as schema from "./schema.ts";

const SIXTY_DAYS = 60 * 60 * 24 * 60;
const ONE_DAY = 60 * 60 * 24;

// The same message for every refused sign-up, so the allowlist can't be read
// off the answer (spec §5.4).
export const SIGN_UP_REFUSED = "Sign-up failed";

// Better Auth lowercases the email before the hook sees it but never trims.
// Trimming and lowercasing both sides here makes the setting forgiving too.
export function parseAllowlist(value: string): Set<string> {
	return new Set(
		value
			.split(",")
			.map((email) => email.trim().toLowerCase())
			.filter((email) => email.length > 0),
	);
}

export function createAuth(env: Env, db: Database, ctx: ExecutionContext) {
	const allowed = parseAllowlist(env.ALLOWED_EMAILS);
	return betterAuth({
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [env.BETTER_AUTH_URL],
		database: drizzleAdapter(db, { provider: "pg", schema }),
		// 15 characters: NIST SP 800-63B's floor for a password used on its own.
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 15,
			password: { hash: hashPassword, verify: verifyPassword },
		},
		// "Stay signed in": 60 days, renewed once a day while in use (D12).
		// Unchecked (rememberMe false): a browser-session cookie and a one-day
		// server session.
		session: { expiresIn: SIXTY_DAYS, updateAge: ONE_DAY },
		// Stored in Postgres: in-memory counters reset whenever Cloudflare starts
		// a new Worker instance. Better Auth's own sign-in rule is 3 per 10
		// seconds, and the locked copy says "Try again in a minute", so both
		// routes get a one-minute window that makes the copy true.
		rateLimit: {
			enabled: true,
			storage: "database",
			customRules: {
				"/sign-in/email": { window: 60, max: 5 },
				"/sign-up/email": { window: 60, max: 5 },
			},
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						if (!allowed.has(user.email.trim().toLowerCase())) {
							throw new APIError("BAD_REQUEST", { message: SIGN_UP_REFUSED });
						}
					},
				},
			},
		},
		advanced: {
			useSecureCookies: true,
			// Better Auth's default is Lax. Ignite never needs its cookie on a
			// request that starts on another site.
			defaultCookieAttributes: {
				sameSite: "strict",
				httpOnly: true,
				secure: true,
			},
			ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
			backgroundTasks: { handler: (promise) => ctx.waitUntil(promise) },
		},
		// Only the level and Better Auth's fixed message. Its extra arguments can
		// carry an email, and logs never hold one (spec §9).
		logger: {
			level: "warn",
			log: (level, message) => {
				console.log(JSON.stringify({ source: "auth", level, message }));
			},
		},
		telemetry: { enabled: false },
	});
}
