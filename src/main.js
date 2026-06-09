// main.js — app entry point.

import("./app.js");

// Production builds only — `vite preview` + Pages register the worker; `vite dev` does not,
// so editing source during development never serves a stale cached module.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		const base = import.meta.env.BASE_URL; // "/" or "/ignite/"
		navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
	});
}
