// Saves text as a file through a temporary <a download>. The page can't tell
// whether the browser actually saved it (a "where to save" prompt can be
// cancelled), which is why every replace also keeps an in-memory undo.

const REVOKE_AFTER_MS = 60_000;

export function downloadFile(content, fileName, type) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	try {
		const a = document.createElement("a");
		a.href = url;
		a.download = fileName;
		a.hidden = true;
		document.body.append(a);
		a.click();
		a.remove();
	} finally {
		// Revoking at once can cancel the download in some browsers.
		setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
	}
}
