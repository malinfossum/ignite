// PBKDF2-SHA-256, chosen in Task 1 because Better Auth's scrypt costs more than
// Workers Free's 10 ms of CPU (spec §12). Better Auth calls these through
// emailAndPassword.password, and api/scripts/reset-password.ts calls the same
// hashPassword, so a reset password always verifies.
//
// Stored as pbkdf2$<iterations>$<saltB64>$<hashB64>. The count travels with the
// hash, so raising PBKDF2_ITERATIONS later never breaks an older password.

// The count Task 1 chose to stay inside the CPU limit (spec §12).
// Production workerd refuses WebCrypto PBKDF2 above 100,000.
export const PBKDF2_ITERATIONS = 15_000;

const SALT_BYTES = 16;
const HASH_BYTES = 32;
// Guards against a corrupted stored string asking for an absurd amount of work.
const MAX_STORED_ITERATIONS = 10_000_000;
const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derive(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password.normalize("NFKC")),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
		key,
		HASH_BYTES * 8,
	);
	return new Uint8Array(bits);
}

// Looks at every byte, so the time taken never says where two hashes differ.
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derive(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword({
	hash,
	password,
}: {
	hash: string;
	password: string;
}): Promise<boolean> {
	const parts = hash.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
	const iterations = Number(parts[1]);
	if (
		!Number.isInteger(iterations) ||
		iterations < 1 ||
		iterations > MAX_STORED_ITERATIONS
	) {
		return false;
	}
	let salt: Uint8Array;
	let expected: Uint8Array;
	try {
		salt = fromBase64(parts[2]);
		expected = fromBase64(parts[3]);
	} catch {
		return false;
	}
	if (salt.length === 0 || expected.length !== HASH_BYTES) return false;
	return equalBytes(await derive(password, salt, iterations), expected);
}
