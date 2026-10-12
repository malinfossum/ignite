import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../../../shared/protocol.ts";
import { SECURITY_HEADERS } from "../../src/http.ts";
import { call } from "./helpers.ts";

const PUSH = "/api/sync/push";
const PULL = `/api/sync/pull?since=0&protocol=${PROTOCOL_VERSION}`;
const body = { protocol: PROTOCOL_VERSION, changes: [] };

describe("sync routes without a session", () => {
	it("answer a push with 401 before reading the body", async () => {
		const res = await call(PUSH, { raw: "this is not JSON" });
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "Sign in to sync" });
	});

	it("answer a pull with 401", async () => {
		expect((await call(PULL)).status).toBe(401);
	});

	it("carry the security headers", async () => {
		const res = await call(PULL);
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			expect(res.headers.get(name)).toBe(value);
		}
	});
});

describe("cross-site requests", () => {
	it("refuse a push from another origin", async () => {
		expect(
			(await call(PUSH, { body, origin: "https://evil.test" })).status,
		).toBe(403);
	});

	it("refuse a push with no Origin", async () => {
		expect((await call(PUSH, { body, origin: null })).status).toBe(403);
	});

	it("refuse a push sent the way a form can (text/plain)", async () => {
		expect((await call(PUSH, { body, contentType: "text/plain" })).status).toBe(
			403,
		);
	});

	it("refuse a pull from another origin", async () => {
		expect((await call(PULL, { origin: "https://evil.test" })).status).toBe(
			403,
		);
	});

	it("let a pull with no Origin through, as a browser sends a same-origin GET", async () => {
		expect((await call(PULL, { origin: null })).status).toBe(401);
	});
});

describe("everything else", () => {
	it("answers an unknown API path with a JSON 404", async () => {
		const res = await call("/api/nothing-here");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Not found" });
	});

	it("answers the wrong method with 405", async () => {
		expect((await call(PUSH, { method: "GET" })).status).toBe(405);
	});

	it("serves the app for a path outside /api/", async () => {
		const res = await call("/", { origin: null });
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/html");
	});
});
