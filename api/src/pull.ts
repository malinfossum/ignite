// Replaced in Task 10. Until then a signed-in pull gets a plain 501.
import type { Database } from "./db.ts";

export async function handlePull(
	_db: Database,
	_userId: string,
	_url: URL,
): Promise<{ status: number; json: unknown }> {
	return { status: 501, json: { error: "Not built yet" } };
}
