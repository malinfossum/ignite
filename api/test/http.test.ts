import { describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES } from "../../shared/protocol.ts";
import {
	errorResponse,
	isJson,
	json,
	readJsonBody,
	SECURITY_HEADERS,
	safeBackground,
	sameOrigin,
	withSecurityHeaders,
} from "../src/http.ts";

const request = (headers: Record<string, string>, body?: string) =>
	new Request("https://ignite.test/api/sync/push", {
		method: body === undefined ? "GET" : "POST",
		headers,
		body,
	});

describe("sameOrigin", () => {
	it("is true only for the Worker's own origin", () => {
		expect(sameOrigin(request({ Origin: "https://ignite.test" }))).toBe(true);
		expect(sameOrigin(request({ Origin: "https://evil.test" }))).toBe(false);
		expect(sameOrigin(request({ Origin: "http://ignite.test" }))).toBe(false);
		expect(sameOrigin(request({}))).toBe(false);
	});
});

describe("isJson", () => {
	it("accepts application/json with or without a charset", () => {
		expect(isJson(request({ "Content-Type": "application/json" }, "{}"))).toBe(
			true,
		);
		expect(
			isJson(
				request({ "Content-Type": "Application/JSON; charset=utf-8" }, "{}"),
			),
		).toBe(true);
	});
	it("refuses what a cross-site form can send", () => {
		expect(isJson(request({ "Content-Type": "text/plain" }, "{}"))).toBe(false);
		expect(
			isJson(
				request({ "Content-Type": "application/x-www-form-urlencoded" }, "a=1"),
			),
		).toBe(false);
		expect(isJson(request({}))).toBe(false);
	});
});

describe("readJsonBody", () => {
	it("parses a JSON body", async () => {
		expect(await readJsonBody(request({}, '{"a":1}'))).toEqual({
			ok: true,
			body: { a: 1 },
		});
	});
	it("answers 400 to a body that isn't JSON", async () => {
		expect(await readJsonBody(request({}, "not json"))).toEqual({
			ok: false,
			status: 400,
		});
	});
	it("answers 413 past MAX_BODY_BYTES, counted in bytes", async () => {
		// 500,001 characters, but 1,000,002 bytes as UTF-8.
		const body = JSON.stringify("é".repeat(500_000));
		expect(new TextEncoder().encode(body).length).toBeGreaterThan(
			MAX_BODY_BYTES,
		);
		expect(await readJsonBody(request({}, body))).toEqual({
			ok: false,
			status: 413,
		});
	});
	it("answers 413 from a declared Content-Length without reading", async () => {
		const res = await readJsonBody(
			request({ "Content-Length": String(MAX_BODY_BYTES + 1) }, "{}"),
		);
		expect(res).toEqual({ ok: false, status: 413 });
	});
});

describe("responses", () => {
	it("json() sets the status and a JSON content type", async () => {
		const res = json(201, { a: 1 });
		expect(res.status).toBe(201);
		expect(res.headers.get("Content-Type")).toBe(
			"application/json; charset=utf-8",
		);
		expect(await res.json()).toEqual({ a: 1 });
	});

	it("errorResponse() carries only a generic message", async () => {
		const res = errorResponse(401);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "Sign in to sync" });
	});

	it("withSecurityHeaders() adds every header and keeps status and cookies", () => {
		const res = new Response("x", {
			status: 201,
			headers: [
				["Set-Cookie", "a=1"],
				["Set-Cookie", "b=2"],
			],
		});
		const out = withSecurityHeaders(res);
		expect(out.status).toBe(201);
		expect(out.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			expect(out.headers.get(name)).toBe(value);
		}
	});
});

describe("safeBackground", () => {
	it("logs a failed background write by its error name only", async () => {
		const lines: unknown[][] = [];
		const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
			lines.push(args);
		});
		try {
			// Shaped like a failed insert that quotes its parameters.
			const failure = new TypeError(
				"insert into session values ('owner@ignite.test', 'token-abc')",
			);
			await safeBackground(Promise.reject(failure));
		} finally {
			spy.mockRestore();
		}
		expect(lines).toEqual([['{"source":"background","error":"TypeError"}']]);
		expect(JSON.stringify(lines)).not.toContain("owner@ignite.test");
	});
});
