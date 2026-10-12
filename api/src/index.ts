// The one Worker (spec §3, §5.1). /api/auth/* goes to Better Auth, the two sync
// routes to their handlers, and every other path to the static app. Three
// prefixes need no router library.

import { createAuth } from "./auth.ts";
import { connect } from "./db.ts";
import type { Env } from "./env.ts";
import {
	errorResponse,
	isJson,
	json,
	readJsonBody,
	safeBackground,
	sameOrigin,
	withSecurityHeaders,
} from "./http.ts";
import { handlePull } from "./pull.ts";
import { handlePush } from "./push.ts";

const PUSH = "/api/sync/push";
const PULL = "/api/sync/pull";
const SIGN_OUT = "/api/auth/sign-out";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		// run_worker_first sends only /api/* here in production. The fallback
		// keeps any other path working if that setting ever changes.
		if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

		let res: Response;
		try {
			res = await routeApi(request, url, env, ctx);
		} catch (error) {
			// The error's name only: a message or a stack can carry row content.
			console.error(
				JSON.stringify({
					route: url.pathname,
					status: 500,
					error: error instanceof Error ? error.name : "unknown",
				}),
			);
			res = errorResponse(500);
		}
		console.log(JSON.stringify({ route: url.pathname, status: res.status }));
		return withSecurityHeaders(res);
	},
} satisfies ExportedHandler<Env>;

async function routeApi(
	request: Request,
	url: URL,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const path = url.pathname;
	const isAuth = path.startsWith("/api/auth/");
	if (!isAuth && path !== PUSH && path !== PULL) return errorResponse(404);

	if (path === PUSH) {
		if (request.method !== "POST") return errorResponse(405);
		// CSRF (spec §9): a cross-site form can't send JSON, and a cross-site
		// fetch carries its own Origin.
		if (!sameOrigin(request) || !isJson(request)) return errorResponse(403);
	}
	if (path === PULL) {
		if (request.method !== "GET") return errorResponse(405);
		// Browsers omit Origin on a same-origin GET, so only a foreign one is refused.
		if (request.headers.has("Origin") && !sameOrigin(request)) {
			return errorResponse(403);
		}
	}

	const { db, close } = await connect(env);
	const pending: Promise<unknown>[] = [];
	try {
		const auth = createAuth(env, db, trackWaitUntil(ctx, pending));

		if (isAuth) {
			const res = await auth.handler(request);
			if (path !== SIGN_OUT || !res.ok) return res;
			// Better Auth has no Clear-Site-Data of its own (spec §7, §15).
			const out = new Response(res.body, res);
			out.headers.set("Clear-Site-Data", '"cookies"');
			return out;
		}

		// user_id comes from the session, never from the body (spec §9), and a
		// request without one is refused before its body is read.
		const found = await auth.api.getSession({
			headers: request.headers,
			returnHeaders: true,
		});
		if (!found.response) return errorResponse(401);
		const userId = found.response.user.id;

		let result: { status: number; json: unknown };
		if (path === PUSH) {
			const body = await readJsonBody(request);
			if (!body.ok) return errorResponse(body.status);
			result = await handlePush(db, userId, body.body);
		} else {
			result = await handlePull(db, userId, url);
		}
		const res = json(result.status, result.json);
		// A session renewed during this request sends its new cookie here.
		for (const cookie of found.headers.getSetCookie()) {
			res.headers.append("Set-Cookie", cookie);
		}
		return res;
	} finally {
		// Better Auth's background tasks run after the response through
		// waitUntil and still need the connection, so it closes after them.
		ctx.waitUntil(
			drain(pending)
				.then(close)
				.catch(() => {
					// The response is already sent. A failed close only costs a pooled connection.
				}),
		);
	}
}

// The real context, except that waitUntil also records each promise.
function trackWaitUntil(
	ctx: ExecutionContext,
	pending: Promise<unknown>[],
): ExecutionContext {
	return new Proxy(ctx, {
		get(target, property) {
			if (property === "waitUntil") {
				return (promise: Promise<unknown>) => {
					// Never the raw promise: the runtime would log its rejection in
					// full, and a Better Auth write can carry a session token.
					const safe = safeBackground(promise);
					pending.push(safe);
					target.waitUntil(safe);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

// A background task may start another one, so drain until none are left.
async function drain(pending: Promise<unknown>[]): Promise<void> {
	while (pending.length > 0) await Promise.allSettled(pending.splice(0));
}
