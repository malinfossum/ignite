// Shared by the admin scripts. Never bundled into the Worker.

import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
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
// lands in shell history. Paste works; Backspace removes one character.
export function readHidden(prompt: string): Promise<string> {
	if (!stdin.isTTY) {
		return Promise.reject(
			new Error("Run this in PowerShell or Windows Terminal."),
		);
	}
	stdout.write(prompt);
	stdin.setRawMode(true);
	stdin.resume();
	stdin.setEncoding("utf8");
	let value = "";
	return new Promise((resolve, reject) => {
		const finish = () => {
			stdin.off("data", onData);
			stdin.setRawMode(false);
			stdin.pause();
			stdout.write("\n");
		};
		const onData = (chunk: string) => {
			for (const char of chunk) {
				if (char === "\r" || char === "\n") {
					finish();
					resolve(value);
					return;
				}
				if (char === "\u0003") {
					finish();
					reject(new Error("Cancelled."));
					return;
				}
				if (char === "\u007f" || char === "\b") {
					value = [...value].slice(0, -1).join("");
				} else {
					value += char;
				}
			}
		};
		stdin.on("data", onData);
	});
}
