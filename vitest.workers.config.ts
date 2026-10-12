import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Handler tests run inside workerd against the Neon dev branch. Local only:
// CI holds no database secret and never runs this file (spec §10).
try {
	process.loadEnvFile();
} catch {
	// No .env: DATABASE_URL must come from the environment.
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error("Set DATABASE_URL in .env to the Neon dev branch first.");
}

// pg require()s pg-protocol and pg-cloudflare, but the plugin resolves those
// calls with the "import" condition and gets each package's ES module, which
// a require() can't load. Pointing both at their CommonJS builds fixes the
// tests only: wrangler's own bundler resolves them correctly.
const commonJs = (path: string) =>
	fileURLToPath(new URL(`./node_modules/${path}`, import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^pg-protocol$/,
				replacement: commonJs("pg-protocol/dist/index.js"),
			},
			{
				find: /^pg-cloudflare$/,
				replacement: commonJs("pg-cloudflare/dist/index.js"),
			},
		],
	},
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				hyperdrives: { HYPERDRIVE: databaseUrl },
				bindings: {
					BETTER_AUTH_URL: "https://ignite.test",
					BETTER_AUTH_SECRET: "handler-tests-only-0123456789abcdef0123456789",
					// Spaces and capitals on purpose: the allowlist trims and lowercases.
					ALLOWED_EMAILS:
						" Owner@ignite.test, cookie@ignite.test,push-a@ignite.test, push-b@ignite.test,pull-a@ignite.test,pull-b@ignite.test,pull-c@ignite.test ",
				},
			},
		}),
	],
	test: {
		include: ["api/test/workers/**/*.test.ts"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
