// Only for `npx auth@1.7.6 generate`. The Better Auth CLI loads this file to
// learn which tables Better Auth needs. The Worker never imports it: its real
// instance is createAuth() in auth.ts, which needs a request's env and database.
//
// Keep the options that shape the schema in step with auth.ts: email and
// password sign-in, and rate limiting stored in the database (which adds the
// rateLimit table). Nothing else in auth.ts changes a table.

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";

export const auth = betterAuth({
	// drizzle.mock() is a typed database with no connection. Generating the
	// schema reads the config only, so it never needs one.
	database: drizzleAdapter(drizzle.mock(), { provider: "pg" }),
	emailAndPassword: { enabled: true },
	rateLimit: { enabled: true, storage: "database" },
});
