import { defineConfig } from "vite";

export default defineConfig({
	// Served from a GitHub Pages project site at https://malinfossum.github.io/ignite/.
	// Applies to dev, preview, and build alike so the PWA scope and asset paths stay consistent.
	base: "/ignite/",
	server: {
		port: 5173,
		open: false,
	},
	build: {
		target: "es2022",
		outDir: "dist",
		sourcemap: true,
	},
});
