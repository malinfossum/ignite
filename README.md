# Ignite

*a small flame, kept going.*

An ADHD-friendly, installable task app — open source, local-first, zero bloat.

**Status:** M1-M5 complete + inline task rename — 127 tests passing. Next: M6 (move task between sections), then v0.1.0.

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

**M4 — Task reorder (complete):** Move up / Move down in the task ⋯ menu, mirroring the section pattern. Completed-task peer filter prevents invisible-swap bugs. 93 tests.

**M5 — Area CRUD (complete):** `+ New area` and area ⋯ menu (Rename / Move up / Move down / Delete), inline sidebar rename, cascade-delete with 8-second undo (area → sections → tasks). Focus area pinned and undeletable. 104 tests.

**Polish bundle (complete):** ARIA APG arrow-key navigation across all menus, batch task delete with 5-second aggregation window, toast pause-on-hover-or-focus with resume-from-remaining. 121 tests.

**Phase 2 — Inline task rename (complete):** Rename tasks in place from the today view and area view. Mirrors the section rename pattern with cross-type mutual exclusion and cascade-race handling. 127 tests.

Next: M6 (move task between sections), then v0.1.0. After that: drag-to-reorder, full task metadata editing, reminders engine, and PWA install flow. Design specs and implementation plans live in `docs/superpowers/`.

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.

Copyright 2026 Malin Fossum
