# Ignite

*a small flame, kept going.*

An ADHD-friendly, installable task app — open source, local-first, zero bloat.

**Status:** M1-M3 complete — 93 tests passing. Capture tasks, view Today, manage areas and sections inline. M4 (task reorder) in progress. PWA install + reminders engine still to come.

---

## Why

Built to replace a cluttered subscription task app with something minimal, free, and genuinely helpful for ADHD users. Every feature has to earn its place.

- Two levels of hierarchy: **Area → Section → Task**
- Local-first — your data stays on your device (IndexedDB)
- Installable as a PWA, with scheduled notifications for reminders
- Dark-mode-first, no account required, no paywall

---

## Tech

Vanilla HTML, CSS, and JavaScript — no frameworks. Strict MVC with a `subscribe/notify` pattern.

- **Build:** Vite
- **Persistence:** IndexedDB (hand-rolled wrapper)
- **PWA:** Service Worker + Notification Triggers API (Chromium)
- **Test:** Vitest + fake-indexeddb
- **Format / lint:** Biome

---

## Run locally

```bash
npm install
npm run dev        # start dev server
npm test           # run tests in watch mode
npm run test:run   # run tests once
npm run build      # production build
```

---

## Status

**M1 — Data layer (complete):** IndexedDB wrapper, models for Areas / Sections / Tasks / Settings, recurrence engine with daily / weekly / monthly / yearly rules. 44 unit tests.

**M2 — First views (complete):** Today view with capture bar, sidebar with area list, task rows with star + delete + undo, hash routing, sidebar collapse, 60-second clock tick. 67 tests.

**M3 — Area view + section CRUD (complete):** dedicated `#area/:id` page with sections, inline section rename, add / move / delete sections, cascade undo for deletes, full keyboard + screen-reader paths, `focus-default` seed section, auto-capitalization of first character on create/rename. 91 tests.

**M4 — Task reorder (in progress):** Move up / Move down in the task ⋯ menu, mirroring the section pattern. Model + controller layers shipped; view wiring in flight.

Future milestones cover drag-to-reorder, full task metadata editing, reminders engine, and PWA install flow. Design specs and implementation plans live in `docs/superpowers/`.

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.

Copyright 2026 Malin Fossum
