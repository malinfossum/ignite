// createBackupBanner(rootEl, { onBackUp, onDismiss }) → { render, destroy }
//
// render(message) rewrites only when the message changes, so the 60 s tick
// never destroys a focused banner button.

import { escapeHtml } from "../utils/dom.js";

export function createBackupBanner(rootEl, { onBackUp, onDismiss }) {
	let shown = null;

	const onClick = (event) => {
		const action = event.target.closest("[data-action]")?.dataset.action;
		if (action === "banner-back-up") onBackUp();
		else if (action === "banner-dismiss") onDismiss();
	};
	rootEl.addEventListener("click", onClick);

	return {
		render(message) {
			if (message === shown) return;
			shown = message;
			rootEl.innerHTML = message
				? `<div class="backup-banner" role="region" aria-label="Backup reminder">
						<p class="backup-banner__text">${escapeHtml(message)}</p>
						<div class="cluster backup-banner__actions">
							<button type="button" class="repeat-btn repeat-btn--primary" data-action="banner-back-up">Back up now</button>
							<button type="button" class="repeat-btn" data-action="banner-dismiss">Not now</button>
						</div>
					</div>`
				: "";
		},
		destroy() {
			rootEl.removeEventListener("click", onClick);
			rootEl.innerHTML = "";
		},
	};
}
