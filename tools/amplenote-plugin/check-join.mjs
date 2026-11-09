// Local check, counts only. Compares an Amplenote ZIP with a repeats file.
// Usage: node tools/amplenote-plugin/check-join.mjs <export.zip> <repeats.json>
// Prints no titles, note names, task text or paths, so the output is safe to paste.

import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";

const [zipPath, repeatsPath] = process.argv.slice(2);
if (!zipPath || !repeatsPath) {
	console.error("Usage: node check-join.mjs <export.zip> <repeats.json>");
	process.exit(1);
}

const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
const names = Object.keys(entries);
const md = names.filter((n) => n.toLowerCase().endsWith(".md"));
const other = names.filter(
	(n) => !n.toLowerCase().endsWith(".md") && !n.endsWith("/"),
);
const depth = (n) => n.split("/").length - 1;
const mdStems = new Set(md.map((n) => n.replace(/\.md$/i, "")));
const otherBesideNote = other.filter((n) =>
	mdStems.has(n.split("/")[0]),
).length;

const decoder = new TextDecoder();
const TASK = /^(\s*)[-*+] \[([ xX])\] (.*)$/;
const frontKeys = new Set();
const commentKeys = new Set();
let withFront = 0;
// Indented front-matter lines that aren't list items: a folded long title,
// for example. Task 9's reader turns such a note into a header problem.
let frontContinuationLines = 0;
let openTop = 0;
let openIndented = 0;
let brokenComment = 0;
let imageLines = 0;
let crlf = 0;
const zipUuids = new Set();

for (const name of md) {
	const text = decoder.decode(entries[name]);
	if (text.includes("\r\n")) crlf++;
	const lines = text.replace(/^﻿/, "").split(/\r?\n/);
	let start = 0;
	if (lines[0] === "---") {
		const end = lines.indexOf("---", 1);
		if (end > 0) {
			withFront++;
			for (const l of lines.slice(1, end)) {
				const m = l.match(/^([A-Za-z_][\w-]*):/);
				if (m) frontKeys.add(m[1]);
				else if (/^\s+\S/.test(l) && !/^\s*-\s/.test(l))
					frontContinuationLines++;
			}
			start = end + 1;
		}
	}
	for (const line of lines.slice(start)) {
		if (/!\[[^\]]*\]\([^)]*\)/.test(line)) imageLines++;
		const t = line.match(TASK);
		if (t?.[2] !== " ") continue;
		const idx = t[3].lastIndexOf("<!--");
		let meta = null;
		if (idx !== -1) {
			const m = t[3].slice(idx).match(/^<!--\s*(\{.*\})\s*-->\s*$/);
			try {
				meta = m ? JSON.parse(m[1]) : null;
			} catch {
				meta = null;
			}
		}
		if (!meta) {
			brokenComment++;
			continue;
		}
		if (meta.completedAt || meta.dismissedAt || meta.crossedOutAt) continue;
		for (const k of Object.keys(meta)) commentKeys.add(k);
		if (t[1].length > 0) openIndented++;
		else openTop++;
		if (typeof meta.uuid === "string") zipUuids.add(meta.uuid.toLowerCase());
	}
}

const repeats = JSON.parse(readFileSync(repeatsPath, "utf8"));
const fileUuids = new Set(
	Object.keys(repeats.tasks ?? {}).map((k) => k.toLowerCase()),
);
const entriesList = Object.values(repeats.tasks ?? {});
const partNames = new Set();
const freqs = new Set();
let dtstartLines = 0;
let rrulePrefix = 0;
for (const { repeat } of entriesList) {
	if (typeof repeat !== "string") continue;
	for (const line of repeat.split(/\r?\n/)) {
		if (/^DTSTART/i.test(line)) {
			dtstartLines++;
			continue;
		}
		if (/^RRULE:/i.test(line)) rrulePrefix++;
		for (const part of line.replace(/^RRULE:/i, "").split(";")) {
			const [name, value] = part.split("=");
			if (!name) continue;
			partNames.add(name.toUpperCase());
			if (name.toUpperCase() === "FREQ") freqs.add(String(value).toUpperCase());
		}
	}
}

const matched = [...zipUuids].filter((u) => fileUuids.has(u)).length;
console.log({
	zip: {
		markdownEntries: md.length,
		otherEntries: other.length,
		otherEntriesBesideANoteFolder: otherBesideNote,
		maxEntryDepth: Math.max(0, ...names.map(depth)),
		notesWithFrontMatter: withFront,
		notesWithCRLF: crlf,
		frontMatterKeys: [...frontKeys].sort(),
		frontMatterContinuationLines: frontContinuationLines,
		openTasksTopLevel: openTop,
		openTasksIndented: openIndented,
		taskLinesWithBrokenOrMissingComment: brokenComment,
		taskCommentKeys: [...commentKeys].sort(),
		imageLines,
	},
	repeatsFile: {
		app: repeats.app,
		version: repeats.version,
		entries: fileUuids.size,
		isRepeatingTrue: entriesList.filter((e) => e.isRepeating === true).length,
		repeatingWithNoRule: entriesList.filter((e) => e.isRepeating && !e.repeat)
			.length,
		rrulePartNames: [...partNames].sort(),
		freqValues: [...freqs].sort(),
		dtstartLines,
		rrulePrefix,
	},
	join: {
		zipTaskUuids: zipUuids.size,
		matched,
		inZipOnly: zipUuids.size - matched,
		inFileOnly: [...fileUuids].filter((u) => !zipUuids.has(u)).length,
	},
});
