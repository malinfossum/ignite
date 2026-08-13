// createRecurrenceDialog(rootEl, { onSave, onRemove, onClose })
//   → { open(task), close(), destroy() }
//
// A modal repeat-rule editor. Render-once-per-open: open(task) seeds form state
// from the task and writes the panel HTML; the panel is NEVER re-rendered by the
// app's applyState, so a 60s tick or model-notify under the dialog can't wipe an
// in-progress form (the reason a dialog beat an inline editor).
//
// The dialog owns its form state + internal focus + Esc/backdrop close. The
// CONTROLLER owns background `inert` and focus restoration to the task's ⋯
// (mirrors the mobile-drawer split).
//
//   onSave({ taskId, recurrence, dueAt }) — a valid rule was built + confirmed
//   onRemove({ taskId })                  — an existing rule was cleared
//   onClose()                             — dismissed (Cancel / Esc / backdrop)

import { escapeHtml } from "../utils/dom.js";

const CADENCES = [
	{ value: "none", label: "Does not repeat" },
	{ value: "daily", label: "Daily" },
	{ value: "weekly", label: "Weekly" },
	{ value: "monthly", label: "Monthly" },
	{ value: "yearly", label: "Yearly" },
];
// 0 = Sunday (matches Date.getDay()). Single visible letter; full name for SRs.
const WEEKDAYS = [
	{ value: 0, short: "S", name: "Sunday" },
	{ value: 1, short: "M", name: "Monday" },
	{ value: 2, short: "T", name: "Tuesday" },
	{ value: 3, short: "W", name: "Wednesday" },
	{ value: 4, short: "T", name: "Thursday" },
	{ value: 5, short: "F", name: "Friday" },
	{ value: 6, short: "S", name: "Saturday" },
];
const UNIT = {
	daily: "day",
	weekly: "week",
	monthly: "month",
	yearly: "year",
};

function pad2(n) {
	return String(n).padStart(2, "0");
}

export function createRecurrenceDialog(rootEl, { onSave, onRemove, onClose }) {
	// Form state — lives in this closure, never in the model.
	let taskId = null;
	let taskTitle = "";
	let wasRecurring = false;
	let cadence = "daily";
	let interval = 1;
	let weekdays = new Set();
	let dateStr = ""; // YYYY-MM-DD
	let timeStr = ""; // HH:MM, "" = no time of day

	let formHandler = null;
	let keyHandler = null;

	function open(task) {
		taskId = task.id;
		taskTitle = task.title ?? "";
		wasRecurring = !!task.recurrence;

		const seed = task.dueAt ? new Date(task.dueAt) : new Date();
		dateStr = `${seed.getFullYear()}-${pad2(seed.getMonth() + 1)}-${pad2(seed.getDate())}`;
		// Only a task that actually carries a time seeds one. A task stored at
		// local midnight with hasTime false must open with an EMPTY time field,
		// or every save would silently pin it to 00:00.
		timeStr = task.hasTime
			? `${pad2(seed.getHours())}:${pad2(seed.getMinutes())}`
			: "";

		const rule = task.recurrence;
		// A task with no rule opens as non-repeating. Pre-selecting Daily made
		// sense when this dialog only created repeats; in a schedule dialog it
		// would hand every one-off task a repeat it never asked for.
		cadence = rule?.type ?? "none";
		interval =
			Number.isInteger(rule?.interval) && rule.interval >= 1
				? rule.interval
				: 1;
		// Default the chips to the start date's weekday so the default flow is
		// self-consistent.
		weekdays = new Set(
			Array.isArray(rule?.weekdays) && rule.weekdays.length
				? rule.weekdays
				: [seed.getDay()],
		);

		rootEl.innerHTML = render();
		wire();
		syncRepeatVisibility();
		syncValidity();
		// Open focus → the date field. It is now the first control in the panel
		// and the reason the dialog was opened. The old `.repeat-cadence__input`
		// target sat third after this restructure, and that selector takes the
		// FIRST radio regardless of which is checked — so a weekly task opened
		// with focus parked on "Does not repeat".
		rootEl.querySelector("#repeat-date")?.focus();
	}

	function close() {
		if (formHandler) {
			rootEl.removeEventListener("change", formHandler);
			rootEl.removeEventListener("input", formHandler);
			rootEl.removeEventListener("click", formHandler);
		}
		if (keyHandler) document.removeEventListener("keydown", keyHandler);
		formHandler = null;
		keyHandler = null;
		rootEl.innerHTML = ""; // detaches the panel
		taskId = null;
		timeStr = "";
	}

	function render() {
		const cadenceInputs = CADENCES.map(
			(c) => `
			<label class="repeat-cadence__option">
				<input class="repeat-cadence__input" type="radio" name="repeat-cadence"
					value="${c.value}" ${c.value === cadence ? "checked" : ""} />
				<span>${c.label}</span>
			</label>`,
		).join("");

		const chips = WEEKDAYS.map(
			(d) => `
			<button type="button" class="repeat-weekday" data-action="toggle-weekday"
				data-weekday="${d.value}" aria-pressed="${weekdays.has(d.value)}"
				aria-label="${d.name}">${d.short}</button>`,
		).join("");

		const removeBtn = wasRecurring
			? `<button type="button" class="repeat-btn repeat-btn--remove" data-action="repeat-remove">Remove repeat</button>`
			: "";

		return `
			<div class="repeat-backdrop" data-action="repeat-backdrop">
				<div class="repeat-panel" role="dialog" aria-modal="true" aria-labelledby="repeat-heading">
					<h2 class="repeat-panel__heading" id="repeat-heading">Schedule — ${escapeHtml(taskTitle)}</h2>

					<div class="repeat-field repeat-field--when">
						<div class="repeat-field__col">
							<label for="repeat-date" data-role="date-label">${dateLabel()}</label>
							<input class="repeat-input" id="repeat-date" type="date" value="${escapeHtml(dateStr)}" />
						</div>
						<div class="repeat-field__col">
							<label for="repeat-time">Time</label>
							<input class="repeat-input" id="repeat-time" type="time" value="${escapeHtml(timeStr)}" />
						</div>
					</div>

					<fieldset class="repeat-fieldset">
						<legend class="repeat-fieldset__legend">Repeats</legend>
						<div class="repeat-cadence" role="radiogroup" aria-label="Cadence">${cadenceInputs}</div>
					</fieldset>

					<div class="repeat-field repeat-field--interval" data-role="interval">
						<label for="repeat-interval">Every</label>
						<input class="repeat-input repeat-input--interval" id="repeat-interval"
							type="number" min="1" step="1" inputmode="numeric" value="${interval}" />
						<span class="repeat-field__unit" data-role="interval-unit">${unitLabel()}</span>
					</div>

					<fieldset class="repeat-fieldset" data-role="weekdays">
						<legend class="repeat-fieldset__legend">Days of the week</legend>
						<div class="repeat-weekdays">${chips}</div>
					</fieldset>

					<footer class="repeat-footer">
						${removeBtn}
						<button type="button" class="repeat-btn" data-action="repeat-cancel">Cancel</button>
						<button type="button" class="repeat-btn repeat-btn--primary" data-action="repeat-save">Save</button>
					</footer>
				</div>
			</div>
		`;
	}

	function unitLabel() {
		const u = UNIT[cadence];
		return interval > 1 ? `${u}s` : u;
	}
	function dateLabel() {
		if (cadence === "none") return "Date";
		return cadence === "weekly" ? "Starting" : "Next date";
	}

	function wire() {
		// One handler for change + input + click, routed by target. Idempotent
		// (re-reads values), so binding it to multiple event types is safe.
		formHandler = (event) => {
			const t = event.target;

			if (event.type === "click") {
				const actionEl = t.closest("[data-action]");
				const action = actionEl?.dataset?.action;
				if (!action) return;
				// Backdrop closes only when the click is the backdrop itself, not a
				// bubbled click from inside the panel.
				if (action === "repeat-backdrop") {
					if (t === actionEl) onClose();
					return;
				}
				if (action === "toggle-weekday") {
					const day = Number(actionEl.dataset.weekday);
					if (weekdays.has(day)) weekdays.delete(day);
					else weekdays.add(day);
					actionEl.setAttribute("aria-pressed", String(weekdays.has(day)));
					syncValidity();
					return;
				}
				if (action === "repeat-save") {
					if (isValid()) {
						onSave({
							taskId,
							recurrence: buildRule(),
							dueAt: buildDueAt(),
							hasTime: parseTime(timeStr) !== null,
						});
					}
					return;
				}
				if (action === "repeat-remove") {
					onRemove({ taskId });
					return;
				}
				if (action === "repeat-cancel") onClose();
				return;
			}

			// change / input
			if (t.name === "repeat-cadence") {
				cadence = t.value;
				syncRepeatVisibility();
				syncUnit();
				syncDateLabel();
				syncValidity();
			} else if (t.id === "repeat-interval") {
				const n = Math.floor(Number(t.value));
				interval = Number.isFinite(n) ? n : 0; // raw; isValid() rejects < 1
				if (event.type === "change") {
					// Clamp + reflect on blur only — never fight mid-typing.
					if (interval < 1) interval = 1;
					t.value = String(interval);
				}
				syncUnit();
				syncValidity();
			} else if (t.id === "repeat-date") {
				dateStr = t.value;
				syncValidity();
			} else if (t.id === "repeat-time") {
				timeStr = t.value;
				syncValidity(); // a malformed time must not reach buildDueAt
			}
		};
		rootEl.addEventListener("change", formHandler);
		rootEl.addEventListener("input", formHandler);
		rootEl.addEventListener("click", formHandler);

		// Esc closes — on document because focus may sit on any control.
		keyHandler = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		};
		document.addEventListener("keydown", keyHandler);
	}

	function syncRepeatVisibility() {
		const repeating = cadence !== "none";
		const intervalField = rootEl.querySelector('[data-role="interval"]');
		if (intervalField) intervalField.hidden = !repeating;
		const weekdayField = rootEl.querySelector('[data-role="weekdays"]');
		if (weekdayField) {
			weekdayField.hidden = !(repeating && cadence === "weekly");
		}
	}
	function syncUnit() {
		const el = rootEl.querySelector('[data-role="interval-unit"]');
		if (el) el.textContent = unitLabel();
	}
	function syncDateLabel() {
		const el = rootEl.querySelector('[data-role="date-label"]');
		if (el) el.textContent = dateLabel();
	}
	function syncValidity() {
		const saveBtn = rootEl.querySelector('[data-action="repeat-save"]');
		if (saveBtn) saveBtn.disabled = !isValid();
	}

	// `input[type=date]` and `[type=time]` constrain their own values, but both
	// degrade to a TEXT input where unsupported — and then `new Date(NaN)` throws
	// RangeError out of `toISOString()`, inside the Save handler, BEFORE
	// `closeRecurrenceEditor` clears `inert`. That wedges the app behind an open
	// dialog. Parse defensively and let `isValid()` gate Save instead.
	function parseDate(value) {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
		if (!m) return null;
		const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
		const date = new Date(y, mo - 1, d);
		// Also rejects 2026-02-31, which Date silently rolls forward into March.
		return date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
	}

	function parseTime(value) {
		const m = /^(\d{2}):(\d{2})/.exec(value ?? "");
		if (!m) return null;
		const hh = Number(m[1]);
		const mm = Number(m[2]);
		return hh <= 23 && mm <= 59 ? { hh, mm } : null;
	}

	function isValid() {
		if (!parseDate(dateStr)) return false;
		if (timeStr && !parseTime(timeStr)) return false;
		if (cadence === "none") return true;
		if (interval < 1) return false;
		if (cadence === "weekly" && weekdays.size === 0) return false;
		return true;
	}

	function buildDueAt() {
		const date = parseDate(dateStr); // non-null: isValid() gates Save
		const time = parseTime(timeStr);
		if (time) date.setHours(time.hh, time.mm, 0, 0);
		return date.toISOString(); // untimed → local midnight, as before
	}

	function buildRule() {
		if (cadence === "none") return null;
		const date = parseDate(dateStr); // non-null: isValid() gates Save
		if (cadence === "daily") return { type: "daily", interval };
		if (cadence === "weekly") {
			return {
				type: "weekly",
				interval,
				weekdays: [...weekdays].sort((a, b) => a - b),
			};
		}
		if (cadence === "monthly") {
			return { type: "monthly", interval, day: date.getDate() };
		}
		return {
			type: "yearly",
			interval,
			month: date.getMonth() + 1,
			day: date.getDate(),
		};
	}

	return {
		open,
		close,
		destroy() {
			close();
		},
	};
}
