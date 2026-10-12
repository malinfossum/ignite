import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../../src/http.ts";
import { user } from "../../src/schema.ts";
import {
	call,
	cookieHeader,
	deleteUsers,
	PASSWORD,
	withDb,
} from "./helpers.ts";

const OWNER = "owner@ignite.test";
const COOKIE = "cookie@ignite.test";
const STRANGER = "stranger@ignite.test";
const EMAILS = [OWNER, COOKIE, STRANGER];

beforeAll(() => deleteUsers(EMAILS));
afterAll(() => deleteUsers(EMAILS));

const signUpBody = (email: string) => ({
	name: email,
	email,
	password: PASSWORD,
	rememberMe: false,
});

describe("sign-up allowlist", () => {
	it("refuses an email that isn't on the list, with the generic message", async () => {
		const res = await call("/api/auth/sign-up/email", {
			body: signUpBody(STRANGER),
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as { message?: string }).message).toBe(
			"Sign-up failed",
		);
		const rows = await withDb((db) =>
			db.select().from(user).where(eq(user.email, STRANGER)),
		);
		expect(rows).toEqual([]);
	});

	it("matches the list whatever the case, and sign-in does too", async () => {
		// The list holds " Owner@ignite.test".
		const up = await call("/api/auth/sign-up/email", {
			body: signUpBody("Owner@Ignite.TEST"),
		});
		expect(up.status).toBe(200);
		const signIn = await call("/api/auth/sign-in/email", {
			body: {
				email: "OWNER@ignite.test",
				password: PASSWORD,
				rememberMe: false,
			},
		});
		expect(signIn.status).toBe(200);
	});

	it("answers a wrong password with 401", async () => {
		const res = await call("/api/auth/sign-in/email", {
			body: { email: OWNER, password: `${PASSWORD}!`, rememberMe: false },
		});
		expect(res.status).toBe(401);
	});

	// Task 12's client maps these two answers to its own copy, so they are
	// pinned here against the real Better Auth.
	it("answers an email that already has an account with 422", async () => {
		// OWNER signed up two tests above.
		const res = await call("/api/auth/sign-up/email", {
			body: signUpBody(OWNER),
		});
		expect(res.status).toBe(422);
		expect(((await res.json()) as { code?: string }).code).toBe(
			"USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
		);
	});

	it("answers a 14-character password with 400 PASSWORD_TOO_SHORT", async () => {
		// COOKIE is on the list and has no account yet. Nothing is created.
		const res = await call("/api/auth/sign-up/email", {
			body: { ...signUpBody(COOKIE), password: "x".repeat(14) },
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as { code?: string }).code).toBe(
			"PASSWORD_TOO_SHORT",
		);
	});
});

describe("the session cookie", () => {
	it("is HttpOnly, Secure and SameSite=Strict", async () => {
		const res = await call("/api/auth/sign-up/email", {
			body: signUpBody(COOKIE),
		});
		expect(res.status).toBe(200);
		const session = res.headers
			.getSetCookie()
			.find((cookie) => cookie.includes("session_token="));
		expect(session).toBeDefined();
		expect(session).toMatch(/;\s*HttpOnly/i);
		expect(session).toMatch(/;\s*Secure/i);
		expect(session).toMatch(/;\s*SameSite=Strict/i);
	});

	it("is cleared on sign-out with Clear-Site-Data, and the session ends", async () => {
		const signIn = await call("/api/auth/sign-in/email", {
			body: { email: COOKIE, password: PASSWORD, rememberMe: false },
		});
		const cookie = cookieHeader(signIn);
		const out = await call("/api/auth/sign-out", { body: {}, cookie });
		expect(out.status).toBe(200);
		expect(out.headers.get("Clear-Site-Data")).toBe('"cookies"');

		const session = await call("/api/auth/get-session", { cookie });
		expect(await session.json()).toBeNull();
	});
});

describe("Better Auth responses", () => {
	it("carry the security headers", async () => {
		const res = await call("/api/auth/get-session");
		expect(res.status).toBe(200);
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			expect(res.headers.get(name)).toBe(value);
		}
	});
});
