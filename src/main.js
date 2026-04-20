// main.js — app entry point.
// Responsibilities: register the Service Worker, then import ./app.js.
// No application logic here.

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch((err) => {
			console.error("Service Worker registration failed:", err);
		});
	});
}

import("./app.js");
