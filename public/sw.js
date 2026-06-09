// public/sw.js — Ignite service worker (hand-rolled). Caches the app SHELL (code);
// task DATA already lives offline in IndexedDB and is never touched here.
const VERSION = "ignite-v1"; // bump to invalidate all caches (hygiene; online users self-heal)
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

self.addEventListener("install", (event) => {
	event.waitUntil(
		self.caches
			.open(VERSION)
			.then((cache) => cache.addAll(SHELL))
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
