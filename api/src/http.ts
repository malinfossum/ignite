// Responses and request checks shared by every API route (spec §9).

import { MAX_BODY_BYTES } from "../../shared/protocol.ts";

// On every Worker response. The static app gets its own set from _headers
// (Task 17); _headers never applies to a response the Worker makes. A JSON
// response never loads or runs anything, so its CSP allows nothing.
export const SECURITY_HEADERS: Record<string, string> = {
	"Content-Security-Policy":
		"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
	"Strict-Transport-Security": "max-age=31536000",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "same-origin",
	"Permissions-Policy":
		"camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	"Cache-Control": "no-store",
};

// Generic on purpose: an error body never says more than this.
export const ERROR_TEXT = {
	400: "Bad request",
	401: "Sign in to sync",
	403: "Forbidden",
	404: "Not found",
	405: "Method not allowed",
	413: "Too large",
	426: "Ignite has updated. Reload to keep syncing.",
	500: "Something went wrong",
} as const;

export function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

export function errorResponse(status: keyof typeof ERROR_TEXT): Response {
	return json(status, { error: ERROR_TEXT[status] });
}

export function withSecurityHeaders(res: Response): Response {
	// A copy, because a Response from fetch() or Better Auth may have
	// immutable headers. Copying keeps every Set-Cookie.
	const out = new Response(res.body, res);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		out.headers.set(name, value);
	}
	return out;
}

export function sameOrigin(request: Request): boolean {
	const origin = request.headers.get("Origin");
	return origin !== null && origin === new URL(request.url).origin;
}

// A cross-site form can only send text/plain, urlencoded or multipart bodies,
// so requiring JSON closes that door (spec §9).
export function isJson(request: Request): boolean {
	const type = request.headers.get("Content-Type") ?? "";
	return type.split(";")[0].trim().toLowerCase() === "application/json";
}

// Reads at most MAX_BODY_BYTES, counted in bytes, then parses. A declared
// Content-Length over the limit is refused without reading anything.
export async function readJsonBody(
	request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }> {
	if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) {
		return { ok: false, status: 413 };
	}
	if (!request.body) return { ok: false, status: 400 };
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BODY_BYTES) {
			await reader.cancel();
			return { ok: false, status: 413 };
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
	} catch {
		return { ok: false, status: 400 };
	}
}

// What index.ts hands to waitUntil instead of the raw promise. The runtime logs
// a rejected waitUntil promise in full, and a failed Better Auth background
// write can quote its query parameters: a session token, an IP, a user agent.
// Only the error's name is logged here (spec §9).
export function safeBackground(promise: Promise<unknown>): Promise<unknown> {
	return promise.catch((error: unknown) =>
		console.error(
			JSON.stringify({
				source: "background",
				error: error instanceof Error ? error.name : "unknown",
			}),
		),
	);
}
