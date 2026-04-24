  # Ignite

  *a small flame, kept going.*

  An ADHD-friendly, installable task app — open source, local-first, zero bloat.

  **Status:** Work in progress. Data layer under active development — 8 of 14 M1 tasks
   committed; 19 tests passing. Not yet usable end-to-end.

  ---

  ## Why

  Built to replace a cluttered subscription task app with something minimal, free, and
   genuinely helpful for ADHD users. Every feature has to earn its place.

  - Two levels of hierarchy: **Area → Section → Task**
  - Local-first — your data stays on your device (IndexedDB)
  - Installable as a PWA, with scheduled notifications for reminders
  - Dark-mode-first, no account required, no paywall

  ---

  ## Tech

  Vanilla HTML, CSS, and JavaScript — no frameworks. Strict MVC with a
  `subscribe/notify` pattern.

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

  **Milestone 1 — Data layer (in progress):** IndexedDB wrapper, models for Areas /
  Sections / Tasks / Settings, recurrence engine.

  Future milestones cover the UI, the reminders engine, and the PWA install flow.
  Design spec and implementation plan live in `docs/superpowers/`.

  ---

  ## License

  MIT © Malin Fossum

  Notes on what I kept out:

  - No contributing guide, no issue templates, no CI badges — it's a solo project in
  M1; pretending otherwise looks inflated.
  - No roadmap table with dates — you don't have dates; promising them would be
  dishonest.
  - Status section is intentionally honest ("not yet usable end-to-end"). Senior devs
  respect this; juniors hide it.
