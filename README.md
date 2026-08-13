# Ignite

*a small flame, kept going.*

An ADHD-friendly task app — open source, local-first, zero bloat.

**Status:** v0.4.0 — 228 tests passing. **Live:** [malinfossum.github.io/ignite](https://malinfossum.github.io/ignite/)

![Ignite in dark mode — the Today view showing a Next card and a Starred group, with the area sidebar and theme control on the left](docs/desktop_preview.png)

---

## About the name

*Ignite* — to set something alight; to spark.
In Norwegian: **tenne** (to light, to spark). The tagline reads *"en liten flamme, holdt i live"* — a small flame, kept going.

The name is about starting — and staying with it. Consistency is how anything actually grows: in skills, in habits, in life. For an ADHD brain, the spark is easy — keeping the flame alive is the work. Start small, stay consistent, get where you want to go.

---

## Why

Built to replace a cluttered subscription task app with something minimal, free, and genuinely helpful for ADHD users. Every feature has to earn its place.

- Two levels of hierarchy: **Area → Section → Task**
- Local-first — your data stays on your device (IndexedDB)
- Dark-mode-first, no account required, no paywall

---

## Features

- **Quick capture** — type and go; the bar shows where the task will land, and asks which section when an area has more than one
- **Today view** — what's next, with relative time labels that tick live
- **Areas & sections** — organize with a two-level hierarchy; create, rename, reorder, and delete
- **Add in place** — every section has its own add row, so a run of tasks goes in without leaving the keyboard
- **Tasks** — complete, star, reorder, rename in place, and move between sections; tasks in Focus file into any section in one tap
- **Scheduling** — give any task a date, and a time of day if it needs one; a task with no time reads as due that day rather than at midnight, and sorts after the day's timed tasks
- **Recurring tasks** — repeat daily, weekly, monthly, or yearly (every N); completing one advances it to the next date, keeping its time of day, and records when you last did it
- **Undo everything** — deletes (including a whole area and its contents) are undoable from the toast
- **Keyboard & screen reader** — ARIA menu navigation and full keyboard paths throughout
- **Install & offline** — installable PWA; works fully offline once loaded, including airplane mode
- **Mobile** — responsive shell with an off-canvas navigation drawer and a pinned capture bar
- **Light and dark** — follows your system by default, or pick one; the control cycles back to system whenever you want it

---

## Tech

Vanilla HTML, CSS, and JavaScript — no frameworks. Strict MVC with a `subscribe/notify` pattern.

- **Build:** Vite
- **Persistence:** IndexedDB (hand-rolled wrapper)
- **Offline:** hand-rolled service worker + web app manifest
- **Test:** Vitest + fake-indexeddb (228 tests)
- **Format / lint:** Biome
- **Deploy:** GitHub Pages via GitHub Actions

---

## Run locally

```bash
npm install
npm run dev        # start the dev server
npm run test:run   # run the tests once (use `npm test` for watch mode)
npm run build      # production build
npm run check      # Biome lint + format check
```

---

## Install

Open the [live app](https://malinfossum.github.io/ignite/) and add it to your device:

- **Android (Chrome):** menu (⋮) → **Add to Home screen**
- **Desktop (Chrome / Edge):** the install icon in the address bar
- **iOS (Safari):** Share → **Add to Home Screen**

Once installed it runs offline, and your data stays on the device.

---

## Roadmap

Planned, not yet shipped:

- Reminders and scheduled notifications
- Drag-to-reorder and richer task metadata
- A custom install prompt

Design specs and implementation plans live in `docs/superpowers/`.

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.

Copyright 2026 Malin Fossum
