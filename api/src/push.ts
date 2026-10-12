// Replaced in Task 9. Until then a signed-in push gets a plain 501.
import type { Database } from "./db.ts";

export async function handlePush(
	_db: Database,
	_userId: string,
	_body: unknown,
	_now?: Date,
): Promise<{ status: number; json: unknown }> {
	return { status: 501, json: { error: "Not built yet" } };
}
