import { describe, expect, it } from "vitest";
import {
	hashPassword,
	PBKDF2_ITERATIONS,
	verifyPassword,
} from "../src/password.ts";

const PASSWORD = "correct horse battery staple";

describe("PBKDF2 password hash", () => {
	it("stores a self-describing string with the iteration count", async () => {
		const hash = await hashPassword(PASSWORD);
		expect(hash).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
		expect(hash.split("$")[1]).toBe(String(PBKDF2_ITERATIONS));
	});

	it("verifies the right password and refuses a wrong one", async () => {
		const hash = await hashPassword(PASSWORD);
		expect(await verifyPassword({ hash, password: PASSWORD })).toBe(true);
		expect(await verifyPassword({ hash, password: `${PASSWORD}!` })).toBe(
			false,
		);
	});

	it("salts every hash, so one password never hashes the same twice", async () => {
		expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
	});

	it("reads the iteration count from the stored string", async () => {
		const [scheme, count, salt, key] = (await hashPassword(PASSWORD)).split(
			"$",
		);
		const tampered = [scheme, String(Number(count) - 1), salt, key].join("$");
		expect(await verifyPassword({ hash: tampered, password: PASSWORD })).toBe(
			false,
		);
	});

	it("treats a password the same after Unicode normalisation (NFKC)", async () => {
		const hash = await hashPassword("ﬁfteen characters");
		expect(await verifyPassword({ hash, password: "fifteen characters" })).toBe(
			true,
		);
	});

	it("refuses anything that isn't its own format", async () => {
		for (const hash of [
			"",
			"a1b2:c3d4",
			"pbkdf2$abc$AAAA$AAAA",
			"pbkdf2$0$AAAA$AAAA",
			"pbkdf2$1000$not base64!$AAAA",
		]) {
			expect(await verifyPassword({ hash, password: PASSWORD })).toBe(false);
		}
	});
});
