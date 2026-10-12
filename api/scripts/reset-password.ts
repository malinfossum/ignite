// Sets a new password for one account and signs it out everywhere (spec §5.4).
// Usage: node api/scripts/reset-password.ts <email>
// Targets DATABASE_URL (.env's dev branch unless the shell sets main).

import { and, eq } from "drizzle-orm";
import { account, session, user } from "../src/auth-schema.ts";
import { hashPassword } from "../src/password.ts";
import { openDatabase, readHidden } from "./lib.ts";

const MIN_LENGTH = 15;

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
	console.error("Usage: node api/scripts/reset-password.ts <email>");
	process.exit(1);
}

const { db, target, close } = await openDatabase();
try {
	console.log(`Database: ${target}`);
	const [found] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email));
	if (!found) throw new Error("No account with that email.");

	const password = await readHidden(
		`New password (at least ${MIN_LENGTH} characters): `,
	);
	if (password.length < MIN_LENGTH) {
		throw new Error(`Password must be at least ${MIN_LENGTH} characters.`);
	}
	if ((await readHidden("Type it again: ")) !== password) {
		throw new Error("The two passwords differ. Nothing changed.");
	}

	// The same function the Worker's sign-in verifies with.
	const hash = await hashPassword(password);
	const updated = await db
		.update(account)
		.set({ password: hash, updatedAt: new Date() })
		.where(
			and(eq(account.userId, found.id), eq(account.providerId, "credential")),
		)
		.returning({ id: account.id });
	if (updated.length === 0)
		throw new Error("That account has no password sign-in.");

	await db.delete(session).where(eq(session.userId, found.id));
	console.log(
		"Password changed. Every session for this account is signed out.",
	);
} finally {
	await close();
}
