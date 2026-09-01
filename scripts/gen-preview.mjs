// scripts/gen-preview.mjs — regenerate docs/desktop_preview.png, the README hero.
// Dev-only (sharp is a devDependency, never shipped to the browser).
// Run: npm run gen:preview
//
// Starts Vite, drives headless Brave over the DevTools protocol, seeds invented
// demo content into that throwaway profile's IndexedDB, and captures the Focus
// surface in dark mode. Brave's one-shot --screenshot flag never writes a file
// on this machine; as a persistent CDP host it works fine.
//
// Point BRAVE_BIN at another Chromium if Brave moves or you are on another box.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const BRAVE =
	process.env.BRAVE_BIN ??
	"C:\\Program Files\\BraveSoftware\\Brave-Origin\\Application\\brave.exe";
const OUT = "docs/desktop_preview.png";

// 1024 keeps the >=1024px layout (the task rows show their area badge and time
// column there) while leaving only a modest margin beside #main's 672px cap.
// The height is a floor: it grows to the content so no scrollbar is captured.
const CSS_W = 1024;
const CSS_H = 720;
const DSF = 2;
// Matches the width of the asset this replaced, so the README renders the same.
const FINAL_W = 1638;

// Split on ESC rather than matching it. A regex literal cannot hold the escape
// character (Biome's noControlCharactersInRegex) and building one with
// `new RegExp` trips useRegexLiterals, so the character comes from a char code
// and the surviving literal only ever sees the "[1m" tail.
const ESC = String.fromCharCode(27);
const stripAnsi = (s) =>
	s
		.split(ESC)
		.map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, "")))
		.join("");

// --- Vite -----------------------------------------------------------------

const vite = spawn(
	process.execPath,
	["node_modules/vite/bin/vite.js", "--strictPort"],
	{ stdio: ["ignore", "pipe", "pipe"] },
);

const appUrl = await new Promise((res, rej) => {
	let buf = "";
	const t = setTimeout(
		() => rej(new Error("vite did not report a URL")),
		30000,
	);
	vite.stdout.on("data", (d) => {
		// Vite bolds the port INSIDE the URL, so the raw line reads
		// "http://localhost:<esc>[1m5173<esc>[22m/ignite/" — the escapes have to
		// come out before matching, or the pattern stops at the first one.
		buf += stripAnsi(d.toString());
		const m = buf.match(/https?:\/\/localhost:[0-9]+[A-Za-z0-9./_%-]*/);
		if (m) {
			clearTimeout(t);
			res(m[0]);
		}
	});
	vite.on("exit", (c) => rej(new Error(`vite exited early (${c})`)));
});
console.log(`vite serving ${appUrl}`);

// --- Brave as a CDP host ---------------------------------------------------

const profile = await mkdtemp(join(tmpdir(), "ignite-preview-"));
const brave = spawn(BRAVE, [
	"--headless",
	"--disable-gpu",
	"--no-first-run",
	"--no-default-browser-check",
	`--user-data-dir=${profile}`,
	"--remote-debugging-port=0",
	"about:blank",
]);

const wsUrl = await new Promise((res, rej) => {
	let buf = "";
	const t = setTimeout(() => rej(new Error("no CDP endpoint in 20s")), 20000);
	brave.stderr.on("data", (d) => {
		buf += d.toString();
		const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
		if (m) {
			clearTimeout(t);
			res(m[1]);
		}
	});
	brave.on("exit", (c) => rej(new Error(`brave exited early (${c}): ${buf}`)));
});

const ws = new WebSocket(wsUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));

let nextId = 0;
const pending = new Map();
const waiters = [];
ws.addEventListener("message", (ev) => {
	const msg = JSON.parse(ev.data);
	if (msg.id !== undefined && pending.has(msg.id)) {
		const { res, rej } = pending.get(msg.id);
		pending.delete(msg.id);
		if (msg.error) rej(new Error(JSON.stringify(msg.error)));
		else res(msg.result);
		return;
	}
	for (let i = waiters.length - 1; i >= 0; i--) {
		if (waiters[i].method === msg.method) {
			waiters[i].res(msg.params);
			waiters.splice(i, 1);
		}
	}
});
const send = (method, params = {}, sessionId) =>
	new Promise((res, rej) => {
		const id = ++nextId;
		pending.set(id, { res, rej });
		ws.send(JSON.stringify({ id, method, params, sessionId }));
	});
const once = (method) => new Promise((res) => waiters.push({ method, res }));

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", {
	targetId,
	flatten: true,
});
const call = (m, p) => send(m, p, sessionId);

const setViewport = (height) =>
	call("Emulation.setDeviceMetricsOverride", {
		width: CSS_W,
		height,
		deviceScaleFactor: DSF,
		mobile: false,
	});

const evaluate = async (expression) => {
	const r = await call("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (r.exceptionDetails) {
		const d =
			r.exceptionDetails.exception?.description ??
			JSON.stringify(r.exceptionDetails);
		throw new Error(`page threw: ${d}`);
	}
	return r.result.value;
};

const goto = async (url) => {
	const loaded = once("Page.loadEventFired");
	await call("Page.navigate", { url });
	await loaded;
	await new Promise((r) => setTimeout(r, 900)); // fonts + first render
};

await call("Page.enable");
await call("Runtime.enable");
await setViewport(CSS_H);

// --- Demo content ----------------------------------------------------------

// Invented tasks, seeded into the throwaway profile. Never real user data, and
// never the local dev database — this origin starts empty and is deleted below.
// The spread across the four tabs is deliberate: it gives the tab strip real
// counts, and the earliest-due task becomes the Next card.
const SEED = `(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("ignite"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const put = (s, rec) => new Promise((res, rej) => { const tx = db.transaction(s, "readwrite"); tx.objectStore(s).put(rec); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const tom = (h, m) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const T = (id, title, extra) => Object.assign({ id: id, sectionId: "focus-default", title: title, notes: "", completed: 0, starred: 0, critical: 0, dueAt: null, hasTime: 0, recurrence: null, lastCompletedAt: null, completedCount: 0, leadTime: 0, scheduledTags: [], createdAt: new Date().toISOString(), order: 0 }, extra || {});

  await put("areas", { id: "demo-home", name: "Home", icon: "\\uD83C\\uDFE1", critical: false, order: 1 });
  await put("areas", { id: "demo-studies", name: "Studies", icon: "\\uD83D\\uDCDA", critical: false, order: 2 });
  await put("sections", { id: "demo-home-s", areaId: "demo-home", name: "Tasks", collapsed: false, order: 0 });
  await put("sections", { id: "demo-studies-s", areaId: "demo-studies", name: "Tasks", collapsed: false, order: 0 });
  await put("tasks", T("demo-h1", "Book the annual service", { sectionId: "demo-home-s", order: 0 }));
  await put("tasks", T("demo-h2", "Sort the recycling run", { sectionId: "demo-home-s", order: 1 }));
  await put("tasks", T("demo-s1", "Summarise the reading list", { sectionId: "demo-studies-s", order: 0 }));

  await put("tasks", T("demo-t1", "Read chapter four", { dueAt: at(9, 30), hasTime: 1, order: 0 }));
  await put("tasks", T("demo-t2", "Reply to the housing office", { dueAt: at(13, 0), hasTime: 1, order: 1 }));
  await put("tasks", T("demo-t3", "Draft the project outline", { dueAt: at(16, 30), hasTime: 1, order: 2 }));
  await put("tasks", T("demo-t4", "Pick up the parcel", { dueAt: at(0, 0), hasTime: 0, order: 3 }));
  await put("tasks", T("demo-m1", "Submit the timesheet", { dueAt: tom(10, 0), hasTime: 1, order: 4 }));
  await put("tasks", T("demo-m2", "Water the plants", { dueAt: tom(18, 0), hasTime: 1, order: 5 }));
  await put("tasks", T("demo-st1", "Compare the two bike routes", { starred: 1, order: 6 }));
  await put("tasks", T("demo-n1", "Ideas for the spring trip", { order: 7 }));

  const cur = await new Promise((res) => { const q = db.transaction("settings", "readonly").objectStore("settings").get("app"); q.onsuccess = () => res(q.result); });
  await put("settings", Object.assign({}, cur, { theme: "dark" }));
  db.close();
  return "ok";
})()`;

// Boot once so ensureFocus() creates the focus area and its default section,
// then seed and reload into the populated, dark-themed Today tab.
await goto(appUrl);
if ((await evaluate(SEED)) !== "ok") throw new Error("seeding failed");
await goto(appUrl);

// --- Fit, then prove the shot is clean -------------------------------------

// A scrollbar rendered into the image and the sidebar's theme control clipped
// off the bottom were both real defects in the first attempt. Grow the viewport
// to the content so neither can recur at any amount of seeded content.
const needed = await evaluate(
	"Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)",
);
if (needed > CSS_H) {
	await setViewport(needed);
	await new Promise((r) => setTimeout(r, 500));
}

// An image cannot be re-checked once written, so assert rather than eyeball.
const CHECKS = `(() => ({
  vScroll: document.documentElement.scrollHeight - window.innerHeight,
  hScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  theme: document.documentElement.dataset.theme,
  heading: (document.querySelector(".page-header__title") || {}).textContent,
  tabs: [].slice.call(document.querySelectorAll(".focus-tab")).length,
  nextCard: !!document.querySelector(".next-card"),
  groups: [].slice.call(document.querySelectorAll(".group__heading")).map(function (h) { return h.textContent.trim(); }),
  areas: [].slice.call(document.querySelectorAll(".sidebar__name")).map(function (e) { return e.textContent.trim(); }),
  themeControlInView: (function () {
    const el = document.querySelector(".sidebar__theme, [data-action='cycle-theme']");
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  })(),
  clipped: [].slice.call(document.querySelectorAll(".task__title")).filter(function (e) { return e.scrollWidth > e.clientWidth + 1; }).map(function (e) { return e.textContent.trim(); })
}))()`;
const c = await evaluate(CHECKS);
console.log("pre-capture checks:", JSON.stringify(c, null, 2));

const problems = [];
if (c.vScroll !== 0) problems.push(`vertical scrollbar (${c.vScroll}px)`);
if (c.hScroll !== 0) problems.push(`horizontal overflow (${c.hScroll}px)`);
if (c.theme !== "dark") problems.push(`theme is ${c.theme}, expected dark`);
if (c.heading !== "Focus") problems.push(`heading is ${c.heading}`);
if (c.tabs !== 4) problems.push(`${c.tabs} tabs, expected 4`);
if (!c.nextCard) problems.push("no Next card");
if (!c.groups.includes("Today3"))
	problems.push(`groups: ${c.groups.join(", ")}`);
if (c.areas.length < 2) problems.push(`${c.areas.length} areas in the sidebar`);
if (!c.themeControlInView) problems.push("theme control clipped");
if (c.clipped.length)
	problems.push(`ellipsised titles: ${c.clipped.join(", ")}`);
if (problems.length)
	throw new Error(`bad capture:\n  - ${problems.join("\n  - ")}`);

// --- Capture ---------------------------------------------------------------

const { data } = await call("Page.captureScreenshot", {
	format: "png",
	captureBeyondViewport: false,
});

// palette: true costs nothing visible on this flat dark UI and roughly thirds
// the file. Eyeball the logo and Next-card gradients if the design ever gains
// smoother ramps — that is where banding would show up first.
const info = await sharp(Buffer.from(data, "base64"))
	.resize({ width: FINAL_W })
	.png({ compressionLevel: 9, palette: true })
	.toFile(OUT);
console.log(`wrote ${OUT} (${info.width}x${info.height}, ${info.size} bytes)`);

// --- Teardown --------------------------------------------------------------

ws.close();
brave.kill();
vite.kill();
await new Promise((r) => setTimeout(r, 400));
await rm(profile, { recursive: true, force: true });
