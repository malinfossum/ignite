// Shared by the admin scripts. Never bundled into the Worker.

import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";

export async function openDatabase(): Promise<{
	db: NodePgDatabase;
	target: string;
	close: () => Promise<void>;
}> {
	try {
		process.loadEnvFile();
	} catch {
		// No .env: DATABASE_URL must come from the shell.
	}
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("Set DATABASE_URL to the Neon branch to change.");
	const client = new Client({ connectionString: url });
	await client.connect();
	// The host names the Neon branch endpoint, so I can see dev from main.
	// The password in the URL is never printed.
	return {
		db: drizzle({ client }),
		target: new URL(url).host,
		close: () => client.end(),
	};
}

export async function readLine(prompt: string): Promise<string> {
	const rl = createInterface({ input: stdin, output: stdout });
	try {
		return await rl.question(prompt);
	} finally {
		rl.close();
	}
}

// Reads a line without echoing it, so a password never shows on screen or
// lands in shell history: no characters and no stars are printed. This goes
// through readline because raw-mode "data" events on stdin never arrived on
// Windows once readline had used stdin earlier in the same script. Readline
// also handles Backspace and paste. Ctrl+C rejects with "Cancelled.".
export async function readHidden(prompt: string): Promise<string> {
	if (!stdin.isTTY) {
		throw new Error("Run this in PowerShell or Windows Terminal.");
	}
	let muted = false;
	const output = new Writable({
		write(chunk, encoding, callback) {
			if (muted) callback();
			else stdout.write(chunk, encoding, callback);
		},
	});
	const rl = createInterface({ input: stdin, output, terminal: true });
	const controller = new AbortController();
	rl.on("SIGINT", () => controller.abort());
	try {
		stdout.write(prompt);
		muted = true;
		return await rl.question("", { signal: controller.signal });
	} catch (error) {
		if (controller.signal.aborted) throw new Error("Cancelled.");
		throw error;
	} finally {
		rl.close();
		stdout.write("\n");
	}
}
