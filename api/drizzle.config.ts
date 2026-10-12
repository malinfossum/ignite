import { defineConfig } from "drizzle-kit";

// DATABASE_URL is the Neon dev branch in .env on my machine. CI sets it from
// the NEON_DATABASE_URL secret (the main branch) and has no .env.
try {
	process.loadEnvFile();
} catch {
	// No .env: DATABASE_URL must come from the environment.
}

export default defineConfig({
	dialect: "postgresql",
	schema: "./api/src/schema.ts",
	out: "./api/drizzle",
	dbCredentials: { url: process.env.DATABASE_URL ?? "" },
	strict: true,
	verbose: true,
});
