// createSettingsView(rootEl, callbacks) → { render, setAlert, focusControl, destroy }
//
// Renders ONCE. applyState calls render(state) on every model notify and every
// 60 s tick; render only updates values in place, so a notify never destroys
// the control that has focus (spec §6 step 6). Alert lines are role="alert"
// regions rendered empty with the page and filled with textContent.

import { formatBackupStamp } from "../backup/backup-due.js";

export function createSettingsView(rootEl, { onBackUp }) {
	rootEl.innerHTML = `
		<div class="settings">
			<section class="card stack settings-card" aria-labelledby="backup-heading">
				<h2 class="settings-card__heading" id="backup-heading">Backup</h2>
				<dl class="settings-meta">
					<dt class="settings-meta__label">Last backup</dt>
					<dd class="settings-meta__value" data-role="last-backup">Never</dd>
				</dl>
				<p class="settings-card__note">The file holds all your tasks in plain text. Keep it somewhere private.</p>
				<div class="cluster settings-actions" data-role="backup-actions">
					<button type="button" class="repeat-btn repeat-btn--primary" data-action="back-up">Back up now</button>
				</div>
				<p class="settings-alert" role="alert" data-role="backup-alert"></p>
			</section>
		</div>
	`;

	const $ = (selector) => rootEl.querySelector(selector);

	const onClick = (event) => {
		const action = event.target.closest("[data-action]")?.dataset.action;
		if (action === "back-up") onBackUp();
	};
	rootEl.addEventListener("click", onClick);

	return {
		render(state) {
			$('[data-role="last-backup"]').textContent = formatBackupStamp(
				state.settings.lastBackupAt ?? null,
			);
		},
		setAlert(group, text) {
			const el = $(`[data-role="${group}-alert"]`);
			if (el) el.textContent = text;
		},
		focusControl(name) {
			const selectors = {
				"back-up": '[data-action="back-up"]',
				restore: "#restore-file",
				import: '[data-action="import"]',
			};
			$(selectors[name])?.focus();
		},
		destroy() {
			rootEl.removeEventListener("click", onClick);
			rootEl.innerHTML = "";
		},
	};
}
