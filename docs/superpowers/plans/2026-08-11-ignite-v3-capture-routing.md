# Ignite v3 — Plan 1: Capture Routing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a captured task land where the user is standing, stop capture from starring everything, and give every section its own add row.

**Architecture:** A new pure function decides the capture destination from the current route and the section list; the controller maps that to a section id and hands it to the capture view. The capture view gains a destination chip and an inline section picker, both self-contained so the view still mounts once and never re-renders. The area view gains a per-section add row and a File shortcut that opens the *existing* move picker in one click.

**Tech Stack:** Vanilla JS (MVC), Vite, Vitest, Biome. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-11-ignite-v3-focus-design.md` — decisions D2, D4, D5, D6, D7.

## Global Constraints

- **Mobile-first CSS.** Baseline styles target the phone; layer up with `@media (min-width: 768px)`. No `max-width` queries.
- **`design-system/` is vendored and read-only.** Never hand-edit. All project CSS goes in `main.css` at the repo root (NOT `src/styles/main.css`).
- **Escape every user-authored string** through `escapeHtml` before interpolating into a template literal — section names, task titles, area names, and ids.
- **≥44×44 px** for every new interactive control.
- **Never wire a `data-action="commit-*"` attribute as a `bindActions` click.** Those attributes exist only so the `bindKeys` Enter handler can find the element. Wiring them to click commits and exits on every cursor-positioning click.
- **IME guard** `if (event.isComposing) return;` at the top of every new Enter handler on a free-text input.
- **Never put `overflow` on `.group__list` or `.group`** — menus inject inside the `<li>` and any clipping ancestor cuts them off.
- **No AI attribution in commit messages.** No `Co-Authored-By`, no "Generated with Claude Code".
- Run `npm run check` (Biome) before every commit. Zero warnings, zero `biome-ignore`.
- Green baseline before starting: **198 tests / 14 files**.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/utils/capture.js` | **create** | Pure: decide the capture destination and its chip label |
| `tests/utils/capture.test.js` | **create** | Tests for the above |
| `src/views/capture-picker.js` | **create** | Pure template: the section picker menu |
| `src/views/capture.js` | modify | Chip, picker host, Escape precedence, lifecycle |
| `src/views/task.js` | modify | Optional File button on a task row |
| `src/views/section.js` | modify | Inline add row; thread `showFile` through |
| `src/views/area.js` | modify | Add-row wiring + focus flag; File action |
| `src/controller.js` | modify | Drop the auto-star; feed the destination; close picker on route change |
| `main.css` | modify | Chip, picker, add row |
| `README.md` | modify | Line 34 stops being true |

### Two deliberate deviations from the spec

1. **§4.2 says "reuse the `move-picker.js` list machinery".** I am writing a *new* `capture-picker.js` that follows the same conventions instead. `renderMovePicker` excludes `task.sectionId` (there is no task yet), groups across **all** areas (we want one), and its `← Back` row is wired to `move-picker-back` inside the task ⋯ menu. Reusing it literally would mean passing a fake task and a dead Back action. Same role/tabindex/escaping conventions, different template.
2. **§5's File button reuses the move picker completely** — more than the spec assumed. File just opens the task's own ⋯ menu already switched to picker mode, so `pick-move-target`, the drain, and the move undo toast all apply unchanged. This is the lowest-risk possible implementation of D7.

### One gap the spec does not cover

**An area with zero sections.** `sections.remove` only guards `focus-default`, so any other area can be emptied. Capture would then have nowhere to write. Defined here as a fourth destination kind: the chip reads `Add a section first` and the input is **disabled**. Without this, capture on an empty area is a silent black hole — the exact failure this plan exists to remove.

---

## Task 1: Capture stops starring

**Files:**
- Modify: `src/controller.js:750-757`
- Modify: `README.md:34`

**Interfaces:**
- Consumes: nothing
- Produces: nothing. Behaviour-only change.

There is no pure seam here, so there is no unit test — matching the project rule that the controller has no unit coverage by design. Verification is in the browser.

- [ ] **Step 1: Remove the auto-star**

In `src/controller.js`, find:

```js
		capture = createCaptureView(captureRoot, {
			onSubmit: (title) =>
				tasks.create({
					sectionId: FOCUS_DEFAULT_SECTION_ID,
					title,
					starred: true,
				}),
		});
```

Replace with:

```js
		capture = createCaptureView(captureRoot, {
			// No `starred` — a star means "I chose this for today", and capture
			// setting it on everything made the signal worthless. Spec D2.
			onSubmit: (title) =>
				tasks.create({ sectionId: FOCUS_DEFAULT_SECTION_ID, title }),
		});
```

`tasks.create` already defaults `starred = false`, so nothing else changes.

- [ ] **Step 2: Run the suite to confirm nothing regressed**

Run: `npm run test:run`
Expected: PASS, 198 tests / 14 files.

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`, open the app, type a task into the capture bar, press Enter.
Expected: the new task appears in Focus with an **empty star** (`☆`), and does **not** appear in Today's Starred group.

- [ ] **Step 4: Update the README**

In `README.md`, replace line 34:

```markdown
- **Quick capture** — type and go; new tasks land in your **Focus** area
```

with:

```markdown
- **Quick capture** — type and go; new tasks land in the area you're in
```

- [ ] **Step 5: Lint and commit**

```bash
npm run check
git add src/controller.js README.md
git commit -m "feat(capture): stop starring every captured task"
```

---

## Task 2: The destination decision (pure seam)

**Files:**
- Create: `src/utils/capture.js`
- Test: `tests/utils/capture.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `captureDestination(route, sections) → Destination`
    where `Destination` is one of
    `{ kind: "focus" }` ·
    `{ kind: "direct", sectionId: string }` ·
    `{ kind: "pick", sections: Section[] }` ·
    `{ kind: "none" }`
  - `captureChipLabel(destination, sectionName) → string`

The util deliberately does **not** import `FOCUS_DEFAULT_SECTION_ID`. Returning `{ kind: "focus" }` keeps `utils/` ignorant of model ids; the controller maps it. Utils never import from `model/` anywhere else in this codebase and that stays true.

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/capture.test.js`:

```js
import { describe, expect, it } from "vitest";
import { captureChipLabel, captureDestination } from "../../src/utils/capture.js";

const sec = (id, areaId, order, name = id) => ({ id, areaId, order, name });

describe("captureDestination", () => {
	it("routes the Focus/landing route to the notepad", () => {
		expect(captureDestination({ name: "today" }, [])).toEqual({ kind: "focus" });
	});

	it("routes an unknown or missing route to the notepad", () => {
		expect(captureDestination(undefined, [])).toEqual({ kind: "focus" });
		expect(captureDestination({ name: "wat" }, [])).toEqual({ kind: "focus" });
	});

	it("writes directly when the area has exactly one section", () => {
		const sections = [sec("s1", "a1", 0), sec("s9", "other", 0)];
		expect(captureDestination({ name: "area", id: "a1" }, sections)).toEqual({
			kind: "direct",
			sectionId: "s1",
		});
	});

	it("asks when the area has more than one section, ordered by `order`", () => {
		const sections = [sec("b", "a1", 1), sec("a", "a1", 0), sec("c", "a1", 2)];
		const out = captureDestination({ name: "area", id: "a1" }, sections);
		expect(out.kind).toBe("pick");
		expect(out.sections.map((s) => s.id)).toEqual(["a", "b", "c"]);
	});

	it("reports `none` when the area has no sections at all", () => {
		const sections = [sec("s9", "other", 0)];
		expect(captureDestination({ name: "area", id: "a1" }, sections)).toEqual({
			kind: "none",
		});
	});
});

describe("captureChipLabel", () => {
	it("names Focus on the landing route", () => {
		expect(captureChipLabel({ kind: "focus" })).toBe("Focus");
	});

	it("names the single section when writing directly", () => {
		expect(captureChipLabel({ kind: "direct", sectionId: "s1" }, "Appointments")).toBe(
			"Appointments",
		);
	});

	it("falls back to a neutral label when the section name is missing", () => {
		expect(captureChipLabel({ kind: "direct", sectionId: "s1" })).toBe("This section");
	});

	it("prompts when a choice is required", () => {
		expect(captureChipLabel({ kind: "pick", sections: [] })).toBe("Choose section…");
	});

	it("explains itself when the area has no sections", () => {
		expect(captureChipLabel({ kind: "none" })).toBe("Add a section first");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/utils/capture.test.js`
Expected: FAIL — `Failed to resolve import "../../src/utils/capture.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/capture.js`:

```js
// Pure capture-destination policy. Given the current route and the full
// section list, decide where a captured task should go — and what the
// capture bar's chip should say about it.
//
// Returns `{ kind: "focus" }` rather than a section id so this file stays
// ignorant of model constants; the controller maps "focus" to
// FOCUS_DEFAULT_SECTION_ID. utils/ never imports from model/.
//
// Destination =
//   { kind: "focus" }                  — the Focus notepad
//   { kind: "direct", sectionId }      — the area's only section
//   { kind: "pick", sections }         — ask, ordered by `order`
//   { kind: "none" }                   — the area has no sections; capture off

export function captureDestination(route, sections) {
	if (route?.name !== "area") return { kind: "focus" };

	const inArea = (sections ?? [])
		.filter((s) => s.areaId === route.id)
		.sort((a, b) => a.order - b.order);

	if (inArea.length === 0) return { kind: "none" };
	if (inArea.length === 1) return { kind: "direct", sectionId: inArea[0].id };
	return { kind: "pick", sections: inArea };
}

export function captureChipLabel(destination, sectionName) {
	switch (destination.kind) {
		case "focus":
			return "Focus";
		case "direct":
			return sectionName ?? "This section";
		case "pick":
			return "Choose section…";
		default:
			return "Add a section first";
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/utils/capture.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:run`
Expected: PASS, 208 tests / 15 files.

- [ ] **Step 6: Lint and commit**

```bash
npm run check
git add src/utils/capture.js tests/utils/capture.test.js
git commit -m "feat(capture): add pure capture-destination policy"
```

---

## Task 3: The destination chip

**Files:**
- Modify: `src/views/capture.js`
- Modify: `src/controller.js`
- Modify: `main.css`

**Interfaces:**
- Consumes: `captureDestination`, `captureChipLabel` from Task 2
- Produces: on the capture view —
  `setDestination(destination: Destination, label: string) → void`

**The capture view must still mount once and never re-render.** Its own header comment says so: it preserves the input cursor across model notifies and route changes. `setDestination` therefore writes `chip.textContent` and toggles `input.disabled` — it must never touch `rootEl.innerHTML`.

- [ ] **Step 1: Add the chip to the template**

In `src/views/capture.js`, replace the `rootEl.innerHTML = ...` block with:

```js
	rootEl.innerHTML = `
		<form class="capture__form" autocomplete="off">
			<input
				class="capture__input"
				type="text"
				name="title"
				placeholder="What's next?"
				aria-label="Capture a new task"
				aria-describedby="capture-destination"
				aria-haspopup="menu"
			/>
			<span class="capture__chip" id="capture-destination"></span>
		</form>
		<div class="capture__picker-root"></div>
	`;
```

`aria-describedby` is how a screen-reader user learns the destination — without it the chip is decoration.

- [ ] **Step 2: Grab the new elements and expose `setDestination`**

Still in `src/views/capture.js`, below the existing `const input = ...` line add:

```js
	const chip = rootEl.querySelector(".capture__chip");
```

and in the returned object, above `destroy()`:

```js
		// Targeted text write ONLY. An innerHTML rewrite here would destroy the
		// input's cursor position on every model notify — the whole reason this
		// view mounts once and never re-renders.
		setDestination(next, label) {
			chip.textContent = label;
			input.disabled = next.kind === "none";
		},
```

> **Corrected during execution (2026-08-11).** This step originally also declared
> `let destination = { kind: "focus" }` and assigned it in `setDestination`. Nothing reads it
> until Task 4, so Biome's `noUnusedVariables` flagged it — correctly. The declaration now
> lives in Task 4, where the submit handler actually reads it. Task 3 needs only the chip text
> and the disabled toggle.

- [ ] **Step 3: Feed the destination from the controller**

In `src/controller.js`, add to the imports:

```js
import { captureChipLabel, captureDestination } from "./utils/capture.js";
```

Then inside `applyState`, after the state is built and before the main view renders, add:

```js
		const destination = captureDestination(currentRoute, state.sections);
		const sectionName =
			destination.kind === "direct"
				? state.sections.find((s) => s.id === destination.sectionId)?.name
				: undefined;
		capture?.setDestination(
			destination,
			captureChipLabel(destination, sectionName),
		);
```

- [ ] **Step 4: Style the chip**

In `main.css`, in the `/* --- Capture --- */` block, after `.capture__input:focus`, add:

```css
.capture__chip {
	flex: 0 0 auto;
	align-self: center;
	margin-inline-start: 0.5rem;
	padding: 0.15rem 0.55rem;
	border-radius: 99px;
	font-size: 0.78rem;
	color: var(--color-accent);
	border: 1px solid var(--color-accent);
	background: transparent;
	white-space: nowrap;
}
.capture__input:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}
```

The chip is a `<span>`, not a button — it is informational, per spec D4. Nothing to click means no 44px target requirement applies to it.

- [ ] **Step 5: Run the suite**

Run: `npm run test:run`
Expected: PASS, 208 tests / 15 files.

- [ ] **Step 6: Verify in the browser**

Run: `npm run dev`.
Expected:
- On Focus, the chip reads `Focus`.
- Navigate to an area with several sections — chip reads `Choose section…`.
- Navigate to an area with one section — chip reads that section's name.
- Type into the bar, then navigate between routes: **the typed text and cursor position survive**.

- [ ] **Step 7: Lint and commit**

```bash
npm run check
git add src/views/capture.js src/controller.js main.css
git commit -m "feat(capture): show the destination on the capture bar"
```

---

## Task 4: The section picker

**Files:**
- Create: `src/views/capture-picker.js`
- Modify: `src/views/capture.js`
- Modify: `src/controller.js`
- Modify: `main.css`

**Interfaces:**
- Consumes: `setDestination` and the stored `destination` from Task 3
- Produces:
  - `renderCapturePicker({ sections }) → string`
  - on the capture view: `closePicker() → void`
  - `onSubmit(title: string, sectionId: string)` — **the callback signature gains a second argument**

- [ ] **Step 1: Write the picker template**

Create `src/views/capture-picker.js`:

```js
// renderCapturePicker({ sections }) → string
//
// Pure template. The section chooser shown when capture is submitted inside
// an area with more than one section.
//
// This is NOT renderMovePicker. That one excludes a task's current section
// (there is no task yet), groups across every area (we want exactly one),
// and its Back row is wired to the task ⋯ menu. Same conventions —
// role="menu" / role="menuitem" / tabindex="-1" / escapeHtml on names AND
// ids — different template.
//
// Cancel is LAST so "focus the first menuitem" lands on a real target.

import { escapeHtml } from "../utils/dom.js";

export function renderCapturePicker({ sections }) {
	const items = sections
		.map(
			(s) =>
				`<button class="task-menu__item" type="button" role="menuitem" tabindex="-1"
					data-action="pick-capture-section"
					data-target-section-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`,
		)
		.join("");

	return `
		<div class="task-menu capture-picker" role="menu" aria-label="Choose a section">
			${items}
			<button class="task-menu__item task-menu__item--back" type="button" role="menuitem" tabindex="-1"
				data-action="cancel-capture-picker">← Cancel</button>
		</div>
	`;
}
```

- [ ] **Step 2: Wire the picker into the capture view**

In `src/views/capture.js`, add the import at the top:

```js
import { renderCapturePicker } from "./capture-picker.js";
```

Below `const chip = ...` add:

```js
	const pickerRoot = rootEl.querySelector(".capture__picker-root");
	let pickerOpen = false;
	let docClickHandler = null;
	// Declared HERE, not in Task 3: this is the first task that reads it.
	let destination = { kind: "focus" };
```

and add the assignment back into `setDestination` (Step 5 below shows the final form):

```js
		setDestination(next, label) {
			destination = next;
			chip.textContent = label;
			input.disabled = next.kind === "none";
		},
```

Then add these three helpers above the returned object:

```js
	function openPicker() {
		pickerRoot.innerHTML = renderCapturePicker({
			sections: destination.sections ?? [],
		});
		pickerOpen = true;
		input.setAttribute("aria-expanded", "true");
		pickerRoot.querySelector('[role="menuitem"]')?.focus();

		// Outside click closes and KEEPS the text. Registered async so the
		// submit that opened the picker doesn't immediately close it.
		docClickHandler = (event) => {
			if (rootEl.contains(event.target)) return;
			closePicker();
		};
		setTimeout(() => document.addEventListener("click", docClickHandler), 0);
	}

	// Closing NEVER clears the input. The typed title is the thing the user
	// was trying not to lose; discarding it is the failure this whole feature
	// exists to prevent. Spec §4.2.
	function closePicker() {
		if (!pickerOpen) return;
		pickerRoot.innerHTML = "";
		pickerOpen = false;
		input.setAttribute("aria-expanded", "false");
		if (docClickHandler) {
			document.removeEventListener("click", docClickHandler);
			docClickHandler = null;
		}
		input.focus();
	}

	function commit(sectionId) {
		const value = input.value.trim();
		if (!value) return;
		onSubmit(value, sectionId);
		input.value = "";
		closePicker();
		input.focus();
	}
```

- [ ] **Step 3: Route submit through the destination**

Replace the existing `handler` in `src/views/capture.js` with:

```js
	const handler = (event) => {
		event.preventDefault();
		if (!input.value.trim()) return;
		if (destination.kind === "none") return;
		if (destination.kind === "pick") {
			openPicker();
			return;
		}
		commit(
			destination.kind === "direct" ? destination.sectionId : focusSectionId,
		);
	};
	form.addEventListener("submit", handler);
```

The controller now passes `focusSectionId` into the view, so add it to the factory signature:

```js
export function createCaptureView(rootEl, { onSubmit, focusSectionId }) {
```

- [ ] **Step 4: Handle picker clicks and Escape precedence**

Add below the submit listener in `src/views/capture.js`:

```js
	const pickerClickHandler = (event) => {
		const actionEl = event.target.closest("[data-action]");
		if (!actionEl || !pickerRoot.contains(actionEl)) return;
		event.stopPropagation();
		if (actionEl.dataset.action === "cancel-capture-picker") {
			closePicker();
			return;
		}
		if (actionEl.dataset.action === "pick-capture-section") {
			commit(actionEl.dataset.targetSectionId);
		}
	};
	pickerRoot.addEventListener("click", pickerClickHandler);
```

Then replace the existing `keydownHandler` with one that has explicit precedence:

```js
	// Escape precedence: picker first, then clear. With the picker open,
	// Escape must close it and LEAVE the text — clearing would throw away
	// exactly what the user was protecting.
	const keydownHandler = (event) => {
		if (event.key !== "Escape") return;
		if (pickerOpen) {
			closePicker();
			return;
		}
		input.value = "";
	};
	rootEl.addEventListener("keydown", keydownHandler);
```

Note this moves the listener from `input` to `rootEl`, so Escape works while focus is inside the picker. Update `destroy()` to match.

- [ ] **Step 5: Update the returned object and `destroy`**

```js
	return {
		setDestination(next, label) {
			destination = next;
			chip.textContent = label;
			input.disabled = next.kind === "none";
		},
		closePicker,
		destroy() {
			closePicker();
			form.removeEventListener("submit", handler);
			rootEl.removeEventListener("keydown", keydownHandler);
			pickerRoot.removeEventListener("click", pickerClickHandler);
			rootEl.innerHTML = "";
		},
	};
```

- [ ] **Step 6: Close the picker on route change**

In `src/controller.js`, update the capture construction and the hash handler:

```js
		capture = createCaptureView(captureRoot, {
			// No `starred` — a star means "I chose this for today", and capture
			// setting it on everything made the signal worthless. Spec D2.
			onSubmit: (title, sectionId) => tasks.create({ sectionId, title }),
			focusSectionId: FOCUS_DEFAULT_SECTION_ID,
		});
```

and inside `onHashChange`, alongside the existing `closeDrawer()` call, add:

```js
		capture?.closePicker();
```

- [ ] **Step 7: Style the picker**

In `main.css`, after the `.capture__chip` rules, add:

```css
.capture__picker-root {
	position: relative;
}
.capture-picker {
	position: absolute;
	inset-inline: 0;
	bottom: 100%;
	margin-block-end: 0.5rem;
	max-height: 50vh;
	overflow-y: auto;
	z-index: 70;
}
.capture-picker .task-menu__item {
	min-height: 44px;
}
@media (min-width: 768px) {
	.capture-picker {
		bottom: auto;
		top: 100%;
		margin-block: 0.5rem 0;
	}
}
```

Mobile-first: the bar sits at the bottom on a phone so the menu opens **upward**; the `min-width: 768px` query flips it downward for desktop, where the bar is at the top. `z-index: 70` clears the capture bar's own `z-index: 60`.

- [ ] **Step 8: Run the suite**

Run: `npm run test:run`
Expected: PASS, 208 tests / 15 files.

- [ ] **Step 9: Verify in the browser — this is the task's real test**

Run: `npm run dev`. In an area with **several** sections:

| Action | Expected |
|---|---|
| Type a title, press Enter | Picker opens; **focus is on the first section**; text still in the input |
| Click a section | Task lands there; input clears; focus back on the input |
| Press Escape with the picker open | Picker closes; **text still there**; focus on the input |
| Click `← Cancel` | Same as Escape |
| Click outside the bar | Picker closes; **text still there** |
| Open the picker, then click a sidebar area | Picker closes; **text still there** |
| An area with one section | No picker; the task lands directly |
| An area with no sections | Input disabled, chip reads `Add a section first` |

- [ ] **Step 10: Lint and commit**

```bash
npm run check
git add src/views/capture-picker.js src/views/capture.js src/controller.js main.css
git commit -m "feat(capture): ask which section when capturing inside an area"
```

---

## Task 5: Inline add row per section

**Files:**
- Modify: `src/views/section.js`
- Modify: `src/views/area.js`
- Modify: `src/controller.js`
- Modify: `main.css`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: area-view callback `onAddTaskToSection({ sectionId, title }) → void`

The add row is a bare `<input>`, **not** a `<form>`. A native form submit fires a `SubmitEvent`, which carries no `isComposing`, so the IME guard cannot work — that is exactly why the existing rename inputs use `bindKeys` Enter instead. Same pattern here.

- [ ] **Step 1: Render the add row**

In `src/views/section.js`, change `renderBody`'s signature to accept the section, and append the row. Replace the whole `renderBody` function with:

```js
function renderBody(
	section,
	tasks,
	now,
	openTaskMenuId,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	movePickerHtml,
	hasMoveTargets,
	showFile,
) {
	const rows = tasks
		.map((t, i) =>
			renderTaskRowWithMenu(t, {
				now,
				isFirst: i === 0,
				isLast: i === tasks.length - 1,
				openTaskMenuId,
				renamingTaskId,
				pendingRenameTaskValue,
				taskMenuMode,
				movePickerHtml,
				hasMoveTargets,
				showFile,
			}),
		)
		.join("");
	// Bare input, never a <form>: SubmitEvent has no isComposing, so the IME
	// guard would be impossible. Enter is handled by the view's bindKeys.
	// The aria-label names the section — four identically-labelled "Add task"
	// fields are unusable with a screen reader.
	return `
		<div class="section__body">
			<ul class="section__tasks">${rows}</ul>
			<div class="section__add">
				<input
					type="text"
					class="section__add-input"
					data-action="commit-section-add"
					data-section-id="${escapeHtml(section.id)}"
					placeholder="Add task"
					aria-label="Add task to ${escapeHtml(section.name)}" />
			</div>
		</div>
	`;
}
```

Update its call site inside `renderSection`:

```js
	const body = renderBody(
		section,
		tasks,
		now,
		openTaskMenuId,
		renamingTaskId,
		pendingRenameTaskValue,
		taskMenuMode,
		movePickerHtml,
		hasMoveTargets,
		showFile,
	);
```

and add `showFile` to `renderSection`'s destructured options (it is used in Task 6; thread it now so the signature settles once):

```js
export function renderSection({
	section,
	tasks,
	isUndeletable,
	isFirst,
	isLast,
	openMenuId,
	renamingId,
	openTaskMenuId,
	pendingRenameValue,
	renamingTaskId,
	pendingRenameTaskValue,
	taskMenuMode,
	movePickerHtml,
	hasMoveTargets,
	showFile,
	now,
}) {
```

Also thread `showFile` through `renderTaskRowWithMenu` — add it to the destructured second parameter and pass it into the non-renaming `renderTaskRow` call:

```js
	const isOpen = openTaskMenuId === task.id;
	const row = renderTaskRow(task, { now, isOpen, showFile });
```

- [ ] **Step 2: Pass `showFile` from the area template**

In `src/views/area.js`, inside `template`, add to the `renderSection({...})` call:

```js
					showFile: s.id === "focus-default",
```

Place it directly after the existing `isUndeletable: s.id === "focus-default",` line. The literal is already used there, so this introduces no new coupling.

- [ ] **Step 3: Add the focus flag**

In `src/views/area.js`, beside the other pending flags near line 82, add:

```js
	// After adding a task inline, re-focus that section's add input so a run
	// of tasks can be typed without reaching for the mouse.
	let pendingFocusAddSectionId = null;
```

- [ ] **Step 4: Handle Enter in the add row**

In `src/views/area.js`, inside the `bindKeys(rootEl, {...})` map, extend the `Enter` handler. Find the existing `Enter` entry and add this branch **before** its rename branches:

```js
		Enter: (event, actionEl) => {
			if (event.isComposing) return;
			if (actionEl.dataset.action === "commit-section-add") {
				event.preventDefault();
				const title = actionEl.value.trim();
				const sectionId = actionEl.dataset.sectionId;
				if (!title || !sectionId) return;
				actionEl.value = "";
				pendingFocusAddSectionId = sectionId;
				callbacks.onAddTaskToSection({ sectionId, title });
				return;
			}
			// ...existing rename branches unchanged...
		},
```

- [ ] **Step 5: Consume the flag in `doRender`**

In `src/views/area.js`, inside `doRender`, alongside the other pending-flag consumers (near line 578), add:

```js
		if (pendingFocusAddSectionId) {
			const el = rootEl.querySelector(
				`[data-section-id="${CSS.escape(pendingFocusAddSectionId)}"] .section__add-input`,
			);
			pendingFocusAddSectionId = null;
			el?.focus();
		}
```

No drain is needed: `tasks.create` fires exactly one notify, so exactly one render follows and it consumes the flag. The drain exists for cascades that queue several notifies.

- [ ] **Step 6: Reset the flag in `destroy`**

In `src/views/area.js`, in `destroy()`, alongside the other flag resets near line 710:

```js
			pendingFocusAddSectionId = null;
```

- [ ] **Step 7: Wire the controller callback**

In `src/controller.js`, in the object returned by `areaCallbacks()` (or wherever `onAddSection` is defined), add:

```js
			onAddTaskToSection: ({ sectionId, title }) =>
				tasks.create({ sectionId, title }),
```

- [ ] **Step 8: Style the add row**

In `main.css`, in the M3 area-view block, add:

```css
.section__add {
	padding: 0.25rem 0 0;
}
.section__add-input {
	width: 100%;
	min-height: 44px;
	padding: 0.5rem 0.75rem;
	background: transparent;
	color: var(--color-text);
	border: 1px dashed var(--color-border);
	border-radius: 8px;
	font: inherit;
}
.section__add-input::placeholder {
	color: var(--color-text-muted);
}
.section__add-input:focus {
	outline: none;
	border-style: solid;
	border-color: var(--color-accent);
}
```

- [ ] **Step 9: Run the suite**

Run: `npm run test:run`
Expected: PASS, 208 tests / 15 files.

- [ ] **Step 10: Verify in the browser**

Run: `npm run dev`, open an area.
Expected:
- Every section has an `Add task` row at its end.
- Type → Enter → the task appears **and the add row keeps focus**, so a second task can be typed straight away. Do five in a row without touching the mouse.
- Collapse a section: **confirm the add input is not reachable by Tab** while collapsed. If it is, the collapse CSS is using something other than `display: none` and needs a `visibility`/`display` fix — the same class of bug as the closed drawer.
- Enter on an empty add row does nothing.

- [ ] **Step 11: Lint and commit**

```bash
npm run check
git add src/views/section.js src/views/area.js src/controller.js main.css
git commit -m "feat(area): add an inline add-task row to every section"
```

---

## Task 6: The File shortcut on Focus tasks

**Files:**
- Modify: `src/views/task.js`
- Modify: `src/views/area.js`
- Modify: `main.css`

**Interfaces:**
- Consumes: `showFile` threaded through `renderSection` → `renderTaskRowWithMenu` → `renderTaskRow` in Task 5
- Produces: nothing new. The button opens the **existing** move picker, so `pick-move-target`, its drain, and the move undo toast all apply unchanged.

- [ ] **Step 1: Render the button**

In `src/views/task.js`, add `showFile = false` to the options object:

```js
export function renderTaskRow(
	task,
	{
		now,
		isOpen = false,
		renaming = false,
		pendingRenameValue = null,
		showFile = false,
	} = { now: new Date() },
) {
```

Then above the `return` add:

```js
	// One-tap filing for notepad rows. Named per task, because a column of
	// buttons all called "File" is unusable by voice or screen reader.
	const fileBtn = showFile
		? `<button class="task__file" type="button" data-action="file-task"
				aria-haspopup="menu"
				aria-label="File ${escapeHtml(task.title)}">File</button>`
		: "";
```

and insert `${fileBtn}` into the returned template, between `${timeLabel}` and the `⋯` button:

```js
			${recurring}
			${timeLabel}
			${fileBtn}
			<button class="task__menu-btn" type="button" data-action="open-menu"
```

- [ ] **Step 2: Handle the action**

In `src/views/area.js`, inside the `bindActions(rootEl, {...})` map, add:

```js
		// File is a shortcut, not a new mechanism: it opens the task's own ⋯
		// menu already switched to picker mode, so pick-move-target, its drain
		// and the move undo toast all apply unchanged.
		//
		// stopPropagation is REQUIRED. The synchronous doRender below detaches
		// this button, after which the document click handler would see a
		// detached target and close the menu it just opened — the same trap
		// documented for move-task-to.
		"file-task": (event, actionEl) => {
			event.stopPropagation();
			const t = taskFromEvent(actionEl);
			if (!t) return;
			openMenuId = null;
			openTaskMenuId = t.id;
			taskMenuMode = "picker";
			doRender();
		},
```

- [ ] **Step 3: Style the button**

In `main.css`, near the other `.task__*` rules, add:

```css
.task__file {
	flex: 0 0 auto;
	min-height: 44px;
	min-width: 44px;
	padding: 0 0.6rem;
	background: transparent;
	color: var(--color-accent);
	border: 1px solid var(--color-accent);
	border-radius: 8px;
	font: inherit;
	font-size: 0.78rem;
	cursor: pointer;
}
```

- [ ] **Step 4: Run the suite**

Run: `npm run test:run`
Expected: PASS, 208 tests / 15 files.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`, open the Focus area.
Expected:
- Every task in Focus's `Tasks` section has a **File** button; tasks in other areas do **not**.
- One click opens the section picker directly — no ⋯ step.
- Picking a section moves the task, shows the **move undo toast**, and undo puts it back.
- After filing, focus lands on a real element — **not `<body>`**. Check with `document.activeElement` in the console.

- [ ] **Step 6: Lint and commit**

```bash
npm run check
git add src/views/task.js src/views/area.js main.css
git commit -m "feat(area): add a one-tap File button to Focus tasks"
```

---

## Task 7: Full-app verification and README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Run the full suite and linter**

```bash
npm run test:run && npm run check && npm run build
```
Expected: 208 tests / 15 files PASS, Biome clean, build clean.

- [ ] **Step 2: Regression-check the surfaces this plan touched**

Run: `npm run dev`. Confirm none of these broke:

- Task rename via ⋯, F2, and double-click — on both Today and an area.
- Section rename, move up/down, delete, and the undo toast.
- `Move to…` inside the task ⋯ menu still works (Task 6 shares its machinery).
- The recurrence dialog opens, saves, and returns focus.
- Mobile drawer opens and closes; capture bar still pinned at the bottom below 768px and at the top above it.
- Theme cycling through system / light / dark.

- [ ] **Step 3: Confirm the README delta from Task 1 is still accurate**

Re-read `README.md` §Features and §Roadmap against what now ships. Line 34 was updated in Task 1; check nothing else in Features claims behaviour this plan changed. The Roadmap's "editable due dates" stays — that is Plan 2, still unshipped.

- [ ] **Step 4: Commit any README correction**

```bash
npm run check
git add README.md
git commit -m "docs: sync the README with capture routing"
```

Skip this commit if step 3 found nothing to change.

---

## Self-Review

**Spec coverage.** D2 → Task 1. D4 → Task 3. D5 → Tasks 2 and 4. D6 → Task 5. D7 → Task 6. The §4.2 focus contract and text-preservation rules → Task 4 steps 2, 4 and 9. The §4.4 `aria-label` requirement → Task 5 step 1. The §5 File `aria-label` and undo → Task 6 steps 1 and 5. The §8.1 44px rule → Tasks 4, 5 and 6 CSS.

**Deliberately out of scope**, because they belong to Plans 2 and 3 and are marked as such in the spec: the Focus/Today merge, tabs, the greeting, the D2 desktop layout, `hasTime`, and the Schedule dialog. The **notepad's newest-first sort** (§12 assumption 1) also lands in Plan 3 — until the merge there is no notepad view to sort.

**Type consistency.** `Destination` is produced by `captureDestination` (Task 2), consumed by `setDestination` (Task 3), and read by the submit handler (Task 4) — same four `kind` values throughout. `showFile` is introduced in Task 5's signature change and first *used* in Task 6, which is why Task 5 threads it. `onSubmit` gains its second parameter in Task 4, and Task 4 step 6 updates the only caller.

**Known ordering constraint.** Task 4 changes `onSubmit`'s signature, so Task 1's controller edit is rewritten there. Running Task 4 before Task 1 would leave a stale one-argument call. Execute in order.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks.
2. **Inline Execution** — executed in this session with checkpoints.
