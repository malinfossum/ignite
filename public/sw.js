// public/sw.js — Ignite service worker (hand-rolled). Caches the app SHELL (code);
// task DATA already lives offline in IndexedDB and is never touched here.
const VERSION = "ignite-v2"; // bump to invalidate all caches (hygiene; online users self-heal)
const SCOPE = self.registration.scope; // base-correct, e.g. https://host/ignite/

const SHELL = [
	"./",
	"./manifest.webmanifest",
	"./icon.svg",
	"./icons/icon-192.png",
	"./icons/icon-512.png",
	"./icons/icon-512-maskable.png",
	"./icons/apple-touch-icon-180.png",
].map((path) => new URL(path, SCOPE).toString());

// Font families this app actually renders — see the filter in `install`.
const FONT_FAMILIES = ["bricolage-grotesque", "hanken-grotesk"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		self.caches
			.open(VERSION)
			.then(async (cache) => {
				await cache.addAll(SHELL);
				// Also precache the hashed build assets, discovered by parsing the shell HTML.
				// Runtime caching alone is unreliable — the browser serves these from its memory
				// cache on reload, bypassing the worker — so they may never land in the cache.
				try {
					const html = await (await fetch(new URL("./", SCOPE))).text();
					const assets = [
						...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g),
					].map((m) => new URL(m[1], SCOPE).toString());
					if (assets.length) await cache.addAll(assets);

					// Second hop: fonts are url() references INSIDE the bundled CSS, so the
					// HTML regex above never sees them. Without this, an installed offline
					// Ignite falls back to system-ui and loses its type identity entirely.
					const fonts = new Set();
					for (const styleUrl of assets.filter((u) => u.endsWith(".css"))) {
						const css = await (await fetch(styleUrl)).text();
						for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
							const resolved = new URL(m[1], styleUrl);
							// Strict origin equality, matching the fetch handler's own rule
							// (a startsWith prefix test would accept evil-<origin>.example).
							// This also drops data: URIs, which need no caching.
							if (resolved.origin !== self.location.origin) continue;
							const href = resolved.toString();
							// The design system declares @font-face for all nine families its
							// palettes share, so an unfiltered sweep precaches ~236 KB of which
							// ~164 KB never renders here. Ignite only uses these two; anything
							// else still resolves via the runtime cache-first handler below.
							if (
								/\.woff2?(?:$|\?)/i.test(href) &&
								!FONT_FAMILIES.some((family) => href.includes(family))
							)
								continue;
							fonts.add(href);
						}
					}
					// Per-item, NOT cache.addAll: addAll is atomic, so a single stale url()
					// reference would reject the whole batch into the catch below and leave
					// ZERO fonts precached — silently reintroducing the exact bug this task
					// exists to fix, one layer up.
					await Promise.allSettled([...fonts].map((url) => cache.add(url)));
				} catch {
					// best-effort: anything not precached falls back to runtime cache-first
				}
			})
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		self.caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key !== VERSION)
						.map((key) => self.caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;
	if (new URL(request.url).origin !== self.location.origin) return;

	// Navigations → network-first, fall back to the cached shell when offline.
	if (request.mode === "navigate") {
		const shell = new URL("./", SCOPE).toString();
		event.respondWith(
			fetch(request)
				.then((res) => {
					if (res.ok)
						self.caches
							.open(VERSION)
							.then((cache) => cache.put(shell, res.clone()));
					return res;
				})
				.catch(() => self.caches.match(shell)),
		);
		return;
	}

	// Static assets (hashed /assets/*, icons, …) → cache-first, runtime-populate.
	event.respondWith(
		self.caches.match(request).then(
			(cached) =>
				cached ||
				fetch(request).then((res) => {
					if (res.ok && res.type === "basic") {
						self.caches
							.open(VERSION)
							.then((cache) => cache.put(request, res.clone()));
					}
					return res;
				}),
		),
	);
});
