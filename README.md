# Ignite

*a small flame, kept going.*

An ADHD-friendly, installable task app — open source, local-first, zero bloat.

**Status:** M1 (data layer) complete — 44 tests passing. M2 (first views) up next. Not yet usable end-to-end.

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

**M2 — First views (next):** sidebar + main render, area/section/task display, basic interaction.

Future milestones cover the reminders engine and the PWA install flow. Design spec and implementation plan live in `docs/superpowers/`.

---

## License

MIT © Malin Fossum
