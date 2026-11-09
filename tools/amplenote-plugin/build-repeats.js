// Pure builder for the repeats file. It calls no Amplenote API, so vitest can
// test it. build-note.mjs pastes this file into the plugin's code block, so it
// must stay self-contained: no imports, only this constant and this function.

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildRepeatsFile(tasks, now) {
	const out = {};
	for (const task of tasks) {
		if (!task || typeof task.uuid !== "string" || !UUID_RE.test(task.uuid)) {
			continue;
		}
		if (task.completedAt || task.dismissedAt) continue;
		const repeat =
			typeof task.repeat === "string" && task.repeat !== ""
				? task.repeat
				: null;
		out[task.uuid] = {
			repeat,
			isRepeating: task.isRepeating === true || repeat !== null,
		};
	}
	return {
		app: "ignite-amplenote-repeats",
		version: 1,
		exportedAt: now.toISOString(),
		tasks: out,
	};
}
