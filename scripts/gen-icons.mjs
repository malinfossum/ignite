// scripts/gen-icons.mjs — one-off: rasterize public/icon.svg → the PWA PNG icon set.
// Dev-only (sharp is a devDependency, never shipped to the browser). Run: npm run gen:icons
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const SRC = "public/icon.svg";
const OUT = "public/icons";

mkdirSync(OUT, { recursive: true });

const targets = [
	{ file: "icon-192.png", size: 192 },
	{ file: "icon-512.png", size: 512 },
	{ file: "icon-512-maskable.png", size: 512 },
	{ file: "apple-touch-icon-180.png", size: 180, opaque: true },
];

for (const { file, size, opaque } of targets) {
	let img = sharp(SRC).resize(size, size);
	if (opaque) img = img.flatten({ background: "#0f0f10" });
	await img.png().toFile(`${OUT}/${file}`);
	console.log(`wrote ${OUT}/${file} (${size}x${size})`);
}
