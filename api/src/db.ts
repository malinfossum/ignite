// One pg Client per request, through Hyperdrive (Cloudflare's recommended
// pattern). Hyperdrive pools the real connections to Neon per transaction,
// which is why push takes a transaction-scoped advisory lock (spec §6.1).

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import type { Env } from "./env.ts";
import * as schema from "./schema.ts";

export type Database = NodePgDatabase<typeof schema>;

export async function connect(
	env: Env,
): Promise<{ db: Database; close: () => Promise<void> }> {
	const client = new Client({
		connectionString: env.HYPERDRIVE.connectionString,
	});
	// Without a listener, an error event on the client is thrown as an
	// unhandled rejection. pg-cloudflare reports its own socket closing after
	// end() as one, so that is expected and ignored. Anything earlier also
	// fails the query in flight; the log names the error only (spec §9).
	let closing = false;
	client.on("error", (error) => {
		if (closing) return;
		console.error(JSON.stringify({ source: "db", error: error.name }));
	});
	await client.connect();
	return {
		db: drizzle({ client, schema }),
		close: () => {
			closing = true;
			return client.end();
		},
	};
}
