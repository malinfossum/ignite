import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["./tests/setup.js"],
		// Client tests and the Worker's pure logic. The Worker handler tests in
		// api/test/workers/ need Cloudflare's runtime and a Neon branch, so they
		// run through vitest.workers.config.ts, locally only, never here.
		include: ["tests/**/*.test.{js,ts}", "api/test/**/*.test.ts"],
		exclude: [...configDefaults.exclude, "api/test/workers/**"],
	},
});
