// Deletes one account and everything it owns (spec §5.4, §14). ON DELETE
// CASCADE removes its sessions, its rows and its tombstones in the same statement.
// Usage: node api/scripts/delete-user.ts <email>
// Targets DATABASE_URL (.env's dev branch unless the shell sets main).

import { eq } from "drizzle-orm";
import { user } from "../src/auth-schema.ts";
import { openDatabase, readLine } from "./lib.ts";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
	console.error("Usage: node api/scripts/delete-user.ts <email>");
	process.exit(1);
}

const { db, target, close } = await openDatabase();
try {
	console.log(`Database: ${target}`);
	const typed = await readLine(
		"Type the email again to delete the account and all its data: ",
	);
	if (typed.trim().toLowerCase() !== email) {
		throw new Error("The emails differ. Nothing was deleted.");
	}
	const deleted = await db
		.delete(user)
		.where(eq(user.email, email))
		.returning({ id: user.id });
	if (deleted.length === 0) {
		console.log("No account with that email. Nothing was deleted.");
	} else {
		console.log(
			"Deleted the account, its sessions, its data and its tombstones.",
		);
		// Neon Free keeps a 6-hour restore window (checked 2026-09-30).
		console.log("Neon's restore history still holds it for up to 6 hours.");
	}
} finally {
	await close();
}
