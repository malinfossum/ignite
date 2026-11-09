// Prints the Amplenote plugin note: a settings table and one code block.
// Usage: node tools/amplenote-plugin/build-note.mjs > plugin-note.md
// The code block inlines build-repeats.js, so the tested function and the
// installed one can't drift apart.
// The plugin code must hold no < or >: Amplenote escapes them to &lt; and
// &gt; on paste, so an arrow function becomes a syntax error.

import { readFileSync } from "node:fs";

const source = readFileSync(
	new URL("./build-repeats.js", import.meta.url),
	"utf8",
)
	.replace(/^\/\/.*\n/gm, "")
	.replace(/^export /gm, "")
	.trim();

const body = source
	.split("\n")
	.map((line) => `\t\t\t${line}`)
	.join("\n");

const code = `{
	appOption: {
		"Export repeats for Ignite": async function (app) {
${body}

			const handles = await app.filterNotes({});
			const tasks = [];
			for (const handle of handles) {
				tasks.push(...(await app.getNoteTasks({ uuid: handle.uuid })));
			}
			const now = new Date();
			const file = buildRepeatsFile(tasks, now);
			function pad(n) {
				return String(n).padStart(2, "0");
			}
			const day = \`\${now.getFullYear()}-\${pad(now.getMonth() + 1)}-\${pad(now.getDate())}\`;
			const blob = new Blob([JSON.stringify(file, null, 2)], {
				type: "application/json",
			});
			await app.saveFile(blob, \`amplenote-repeats-\${day}.json\`);
			await app.alert(
				\`Saved repeat rules for \${Object.keys(file.tasks).length} open tasks.\`,
			);
		},
	},
}`;

process.stdout.write(`| | |
|-|-|
| name | Ignite repeats export |
| icon | repeat |
| description | Saves the repeat rule of every open task to a local file for Ignite. Sends nothing anywhere. |

\`\`\`js
${code}
\`\`\`
`);
