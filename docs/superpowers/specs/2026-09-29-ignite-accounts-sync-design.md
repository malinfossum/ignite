# Ignite: accounts, a database and sync

**Date:** 2026-09-29
**Status:** design agreed section by section (2026-09-29) · stress-tested 2026-09-29 (findings folded in, see §15 and the record line) · no plan yet
**Project:** 2 of 5 on the platform roadmap (reminders need it; the React rewrite and the Android app build on it)
**Supersedes:** nothing. Refines the 2026-09-24 roadmap decision "frontend on Cloudflare Pages" into "one Worker with static assets" (D2).

---

## 1. Goal

My tasks live in one account and follow me between desktop and phone. A change made offline on either device reaches the other one the next time both have been online. Project 3 (reminders) can then fire from a server, and Done tapped on the phone reaches a task I created on desktop.

Local mode, with no account, keeps working exactly like today.

**What I see in this project:** a sign-in dialog, a sync status line and a sign-out button. Nothing else in the UI changes.

### Non-goals

Reminders (project 3) · the React rewrite (project 4) · the Android app (project 5) · JSON export/import (project 1) · email sending of any kind · passkeys · live sync between two open devices · end-to-end encryption.

---

## 2. Hard requirements

These two override every other section. A task in the plan that breaks either one stops and asks.

**R1. It costs nothing.** Every service runs on its free tier: Workers Free, Hyperdrive Free, Neon Free. No custom domain is needed. Where a free-tier limit is at risk (§12), the fallback is a free technique, never a paid plan. Workers Paid ($5/month) is only an option if I say yes to it.

**R2. It never makes the app slower.**

- Every read and every write still goes to IndexedDB first. The UI never waits for the network, for Neon, or for a sync round.
- The first render comes from IndexedDB, exactly as today. The startup sync runs after it.
- The only new cost on a local write is one extra small record (the outbox entry) in the same IndexedDB transaction.
- **Bundle budget: sync and auth add at most 10 kB gzipped to the client JS** (today: 20.09 kB gzipped). So there is no Better Auth client library in the bundle. The client calls the auth endpoints with plain `fetch`. The budget is a CI gate that fails the build (§10).
- Server-only packages (Better Auth, Drizzle, `pg`, Zod) never reach the client bundle.

---

## 3. Architecture

```
one Cloudflare Worker  (one origin: ignite.<account>.workers.dev)
├── static assets: the built app (dist/)
├── /api/auth/*   → Better Auth (email + password)
└── /api/sync/*   → push, pull
        │
        └── Hyperdrive → Neon Postgres (Frankfurt)
```

- **`api/`**: the Worker, in TypeScript. It never imports anything from `src/`.
- **`src/sync/`**: the client side, in TypeScript: the syncing `db` wrapper, the outbox, the sync engine, the auth calls and the account dialog. It sits under today's vanilla views. Vite compiles `.ts` natively.
- **One `package.json`** at the repo root. `wrangler.jsonc` at the root points `main` at `api/src/index.ts` and `assets.directory` at `dist/`.

**The seam.** Every model (`areas`, `sections`, `tasks`, `settings`) writes only through `db.put` and `db.delete` from `src/model/db.js`. A syncing wrapper around that `db` catches every write, so the models do not change. The controller gets one addition: a `refresh()` that runs its existing `applyState`, so remote changes can re-render the app (§4.5).

**D2. One Worker, not Pages plus a Worker.** The app and `/api` share one origin, so the session cookie is first-party. With two origins it would be a third-party cookie, and Brave blocks those by default. The code stays separated (`api/` and `src/` share nothing), so a later split is: buy a domain, route `/api/*` to its own Worker.

---

## 4. Client data layer

### 4.1 `db.js` version 2

`CURRENT_VERSION` goes from 1 to 2. `runUpgrade` adds two stores:

- **`outbox`**, keyed by `key` (`"<store>:<id>"`): `{ key, store, id, op: "put" | "delete", rev, deletedAt? }`. It holds keys, not copies of rows.
- **`meta`**, keyed by `id`: one record `{ id: "sync", mode: "local" | "account", cursor, userEmail, lastSyncedAt }`.

`run()` today opens a transaction on one store. It learns to span a list of stores, so a row write and its outbox entry commit together or not at all.

**The upgrade can be blocked.** A second Ignite tab still running version 1 code holds the database open, and today's `openDB` rejects on `blocked`, so the app would fail to boot. Version 2 therefore:

- **waits instead of rejecting** on `blocked`, and shows "Close other Ignite tabs to finish updating" until the upgrade goes through,
- sets `onversionchange` to close its own connection, so version 3 onwards is never blocked by a version 2 tab.

### 4.2 The syncing wrapper

`createSyncingDb(db)` returns the same interface as `db` (`get`, `getAll`, `getByIndex`, `put`, `delete`, `close`, `raw`). Reads pass straight through.

- **`put(store, record)`** stamps `updatedAt` (client clock, always UTC through `new Date().toISOString()`) on the record. In account mode it writes the row **and** upserts the outbox entry `{ op: "put", rev: rev + 1 }` in one transaction.
- **`delete(store, id)`** deletes the row. In account mode it upserts the outbox entry `{ op: "delete", deletedAt: now, rev: rev + 1 }` in the same transaction.
- In local mode `updatedAt` is still stamped, and nothing is queued.

Ten edits to one task leave one outbox entry. The push sends the row as it is at push time.

**Deletes stay real deletes locally.** The server keeps the tombstone (§5.2). Soft deletes locally would put a filter into every model's `list`, and the seam would stop being one file.

### 4.3 What syncs from `settings`

`theme` and `sidebarCollapsed` stay on the device. `quietStart` and `quietEnd` sync, because the reminder server in project 3 needs them.

**Trap:** changing the theme is a `put` on the settings row. If that bumped `updatedAt` and queued the row, a theme change on device A would push A's stale quiet hours with a fresh timestamp and overwrite a newer quiet-hours change from device B. So for `settings`, the wrapper stamps `updatedAt` and queues the row **only when `quietStart` or `quietEnd` changed**. On pull, only those two fields are merged into the local row.

### 4.4 Booleans

The task model stores `completed`, `starred`, `critical` and `hasTime` as `0`/`1` (IndexedDB cannot index booleans). The push serializer converts them to real booleans, and the pull applier converts them back. The server only ever sees booleans.

### 4.5 Applying remote rows

The sync engine writes pulled rows **straight to the underlying stores**, not through the wrapper, so they never re-enter the outbox. A tombstone deletes the local row. When a round has applied anything, the engine calls `controller.refresh()` once, and posts `"data-changed"` on a `BroadcastChannel("ignite")` so other open tabs refresh too. (Other tabs can't catch up by themselves: the cursor lives in the shared `meta` store, so their own next round pulls nothing.)

Before applying anything, the engine re-reads `meta.mode`. If it is no longer `account` (a sign-out happened during the round), the round discards what it pulled.

---

## 5. Server

### 5.1 The Worker

`api/src/index.ts` matches on the path: `/api/auth/*` goes to Better Auth's handler, `/api/sync/push` and `/api/sync/pull` go to the sync handlers, and anything else falls through to the static assets. No router library.

`wrangler.jsonc` sets the `nodejs_compat` flag (Better Auth uses `AsyncLocalStorage`), the Hyperdrive binding and the assets directory. Secrets (`BETTER_AUTH_SECRET`) are set with `wrangler secret put`, never committed.

### 5.2 Database: Drizzle and Neon

**Drizzle** holds the schema in TypeScript, generates the SQL migrations (`drizzle-kit`) and runs typed queries through `pg` over Hyperdrive. Better Auth uses its Drizzle adapter.

**Tables:**

- Better Auth's own tables (`user`, `session`, `account`, `verification`), generated by its CLI.
- `areas`, `sections`, `tasks` and `settings`, with **real columns** that mirror the client records. `recurrence` and `scheduledTags` are `jsonb`.
- Every data table also has:
  - **primary key `(user_id, id)`**. `id` alone is not unique across accounts: every install seeds the fixed IDs `"focus"` and `"focus-default"` (`src/model/areas.js:4`).
  - `updated_at timestamptz` (the client's time, used to decide a conflict)
  - `server_seq bigint`, taken from **one Postgres sequence shared by all data tables and `tombstones`**, with an index on `(user_id, server_seq)`.
- **`tombstones`** `(user_id, store, id, deleted_at, server_seq)`, primary key `(user_id, store, id)`. A delete removes the row from its data table and writes a tombstone. **A tombstone holds no content**, so a deleted task's title does not live on in the database, and the data tables hold only live rows (project 3's reminder queries need no "not deleted" filter). A newer `put` for the same key deletes the tombstone and inserts the row again.
- **`user_id` references `user` with `ON DELETE CASCADE`** on every data table and on `tombstones`, so deleting a user deletes everything they own.
- **No foreign keys between the data tables.** A task can arrive before its section. This is a deliberate exception to "let the database enforce it".

**Two Neon branches:** `dev` for local `wrangler dev` and the handler tests, `main` for production.

**Hyperdrive query caching is turned off** on this Hyperdrive config (it is on by default for reads). With caching on, the same `pull?since=N` could return a cached, older answer, and a change just pushed from another device would not show up.

### 5.3 Validation

Every pushed row is parsed with a Zod schema per store before it reaches Drizzle. The API is the boundary, and the client is not trusted.

- `store` must be one of `areas`, `sections`, `tasks`, `settings`. It maps to a Drizzle table object, never to a table name in SQL text.
- Schemas are **strict**: an unknown key (for example a `user_id` smuggled into `record`) fails the row. `record.id` must equal the change's `id`.
- Length limits: names and titles at most 1,000 characters, notes at most 20,000. The client splits a push at 200 changes **or** 1 MB, whichever comes first, and the server answers `413` to anything larger than 1 MB.
- Every request carries `protocol: 1`. The server answers `426` to a protocol it no longer speaks. That covers a service worker still serving last week's client after a deploy.

### 5.4 Accounts

- Email and password. **Minimum password length 15** (NIST SP 800-63B's floor for a password used on its own). It also keeps a password safe if the hash has to get cheaper (§12).
- **Sign-up is limited to an allowlist.** `ALLOWED_EMAILS` (a Worker setting) is checked in a Better Auth `databaseHooks.user.create.before` hook. Any other email is refused with the same generic message as any other sign-up failure, so the allowlist can't be probed.
- **Sign-in errors are generic:** "Email or password is wrong", never which of the two.
- **"Stay signed in on this device" is a checkbox, unchecked by default**, with the trade-off stated beside it: "For 60 days. Sign out to end it." Checked: a 60-day session that renews while in use (Better Auth's `rememberMe`). Unchecked: the session ends when the browser closes.
- **No email in v1.** A password is reset, and an account deleted, with scripts I run against Neon (`api/scripts/reset-password.ts`, `api/scripts/delete-user.ts`). An email provider arrives when sign-up opens.

---

## 6. Sync protocol

A sync round is **push, then pull**, and runs under the Web Locks API (`navigator.locks.request("ignite-sync", …)`), so two open tabs never run a round at the same time.

### 6.1 Push: `POST /api/sync/push`

```json
{ "changes": [
  { "store": "tasks", "id": "…", "op": "put", "record": { … } },
  { "store": "tasks", "id": "…", "op": "delete", "deletedAt": "2026-…" }
] }
```

- Up to 200 changes per request. The client reads each outbox entry's current row at send time and remembers each entry's `rev`.
- The server applies the batch in **one transaction**, which starts with **`pg_advisory_xact_lock` on the user's ID**. Pushes for one user therefore run one after another, and `server_seq` values become visible in the order they were handed out. Without the lock, push A could take seq 10, push B seq 11, and B commit first. A pull between the two commits would move its cursor to 11, and that device would never see row 10. The lock is transaction-scoped because Hyperdrive pools connections per transaction.
- Upserts are batched per table (`INSERT … ON CONFLICT (user_id, id) DO UPDATE … WHERE excluded.updated_at > table.updated_at RETURNING id`), so a push costs a handful of queries, not 200.
- Per change, **last write wins**: the incoming row replaces the stored one only if its `updatedAt` is newer. A delete writes a tombstone and competes the same way, so an edit made after a delete on another device brings the task back.
- **Clock cap:** the server clamps an incoming `updatedAt` to at most its own time plus 5 seconds. Otherwise a device whose clock runs a year fast would win every conflict until then.
- Each accepted write gets `server_seq = nextval(...)`.

**Response:** `{ accepted: [keys], lost: [winning rows], invalid: [keys] }`.

- `accepted`: the client removes the outbox entry **only if its `rev` is unchanged since the push began**. An edit made while the push was in flight stays queued.
- `lost`: the client stores the winning row, **but only if that entry's `rev` is unchanged**. Without this, the losing device would never learn it lost, because the winner's `server_seq` did not change. If I edited the row again while the push was in flight, my newer edit stays and competes next round.
- `invalid`: the row failed validation. The response carries the server's current version of that key (a row, a tombstone, or nothing). The client drops the entry from the outbox, stores the server's version the same way as `lost`, logs the key (never the content) to the console and shows "1 change couldn't sync". One bad row never blocks the rest, and the device can't drift from the account forever. Its own pull already skipped the server's version while the entry was pending.
- A retried push (a reload mid-round, a lost response) is harmless: an equal `updatedAt` is not newer, so the change comes back as `lost` with an identical row.

### 6.2 Pull: `GET /api/sync/pull?since=<seq>`

Returns this user's rows from all four data tables and `tombstones` with `server_seq > since`, oldest first, at most 500, plus `{ cursor, more }`. The client:

1. stores each row, **skipping any row that still has an outbox entry**, since that change pushes next round and wins or loses on the server,
2. saves `cursor` to `meta`,
3. repeats while `more` is true.

A row I just pushed comes back in the next pull. It matches what is stored, so applying it changes nothing.

### 6.3 When a round runs

On app start (after the first render) · when the tab becomes visible · on the `online` event · 2 seconds after the last local write (debounced).

There is no live channel and no interval timer. I look at one device at a time, and switching to a device triggers a round. A Durable Object with a WebSocket can add live sync later if I ever miss it.

### 6.4 Known consequences, accepted

- **Conflicts are per row, not per field.** Collapsing a section on the phone while renaming it offline on desktop keeps only the later of the two changes. Single user, rare.
- **Order collisions.** Two devices creating a task offline in the same section can both assign `max(order) + 1`. After sync the two share an `order`, and their relative order is arbitrary. Not fixed here: it needs a model change, which breaks the one-seam rule. It is a follow-up if I ever see it.
- **Orphans.** Deleting an area on desktop while adding a task to one of its sections offline on the phone leaves that task on the server with a `sectionId` that no longer exists. Ignite shows nothing for it, which is the same thing that happens to the orphan `sections` row already in my dev database. Not fixed here: the fix (rehome orphans into Focus) is a product decision of its own.

---

## 7. Local mode, account mode and the switch between them

**Default is local mode.**

**The account control** is one button in the top bar, next to the theme control, sharing its 44 px height and bottom edge. It opens a dialog:

- **Signed out:** email, password, Sign in.
- **Signed in:** the email, a status line and Sign out. The status line reads one of: "Synced 2 min ago" · "Syncing…" · "Offline, 3 changes waiting" · "Sign in again to sync" · "1 change couldn't sync".

The dialog reuses the existing dialog pattern (`recurrence-dialog.js`: `role="dialog"`, `aria-modal`, a labelled heading) and the design-system tokens. The exact look is decided at plan time and verified in the browser. Fixed rules:

- **The button** is a `<button>` with an accessible name that carries its state: "Account", "Account, sync needs attention". When sync needs attention it also shows a visible marker that is **not colour alone** (an icon or shape).
- **Focus** moves into the dialog on open, Escape closes it, and focus returns to the account button on close, never to `<body>`.
- **The sign-in form** is a real `<form>` with a submit button, so password managers work. The inputs are labelled, `autocomplete="email"` and `autocomplete="current-password"`, and paste is allowed. An error is tied to its field with `aria-describedby`.
- **Announcements:** one `role="status"` element that exists in `index.html` from page load, outside every container that re-renders (the toast's region is created per toast, so it can't be reused). Only **failures and the end of a manual action** are announced ("Signed in", "Signed out", "Sign in again to sync", "1 change couldn't sync"). A background round that went fine is not news and stays silent.
- Every control is at least 44 × 44 px, and the dialog fits at 320 px wide and at 200 % text.

**First sign-in on a device:**

| This device | The account | What happens |
|---|---|---|
| anything | empty | Every local row is queued and uploaded. |
| only the seeded Focus area and section | has data | Download only. The seeded IDs match, so nothing is duplicated. |
| real data | has data | I'm asked once: "Add this device's tasks to your account" or "Replace them with your account". Initial focus is on "Add", the one that can't lose anything. "Replace" deletes this device's tasks, and its label says so. |

**The seeded rows never overwrite the account.** Every install creates `focus` and `focus-default` with a fresh `updatedAt`, so pushing them would beat the account's copies under last-write-wins. The initial upload therefore skips those two keys unless the account is empty.

**Signing in as a different email** than `meta.userEmail` (after an expired session) is treated as a sign-out followed by a first sign-in.

**Sign out** takes the same Web Lock as a sync round, so it waits for a running round instead of racing it. It first tries to push. If the outbox is not empty and the push fails, it asks: "3 changes haven't synced. Sign out anyway?" Then:

1. Better Auth's sign-out, whose response sends `Clear-Site-Data: "cookies"`,
2. **wipes** `areas`, `sections`, `tasks`, `outbox`, and the synced fields of `settings`, and resets `meta` (mode, cursor, email),
3. re-seeds Focus and returns to local mode.

After signing out, a device does not show the account's tasks. The service worker and its caches are left alone: they hold only the app's static files (`/api/` is never cached), and clearing them would break offline use for no privacy gain.

**Session expired:** the app keeps working. Writes keep queuing, the status reads "Sign in again to sync", and signing in again pushes the queue. No data is lost and nothing is blocked.

---

## 8. Errors

| Case | What happens |
|---|---|
| Offline, fetch fails, 5xx | The round ends. The outbox is kept. The next trigger retries. |
| Neon waking up (free compute sleeps after 5 minutes idle) | The first request after a pause can take about a second. It happens in the background, so there is no UI cost (R2). |
| 401 | Mode stays `account`. Status: "Sign in again to sync". |
| A row in `invalid` | Dropped from the outbox, logged, status line shows it. |
| IndexedDB quota or commit error | Surfaces exactly as today: `db.js` rejects on the transaction error. |
| 426 (old client after a deploy) | Status: "Ignite has updated. Reload to keep syncing." Writes keep queuing. |
| 413 | Shouldn't happen given the client's own split (§5.3). If it does, the client halves the batch and retries. A single change that is still too big is dropped like an `invalid` one, so the queue can't jam. |

A sync failure never throws into the controller and never shows a toast. It appears on the status line and the account button, and is announced once (§7).

**Sign-in copy:** "Email or password is wrong" · "Too many attempts. Try again in a minute." · "Can't reach Ignite's server. Check your connection." · "Password must be at least 15 characters." (sign-up).

---

## 9. Security

**Trust boundaries:** browser → Worker (session cookie, Origin check, Zod) · Worker → Neon (Hyperdrive over TLS, parameterised queries through Drizzle only, no raw SQL strings) · GitHub Actions → Cloudflare and Neon (scoped secrets, main only).

- **Cookies:** HttpOnly, Secure, **SameSite=Strict**. Ignite never needs its cookie on a request that starts on another site, so Strict costs nothing. It is set through Better Auth's `advanced.defaultCookieAttributes`, because Better Auth's default is Lax.
- **CSRF:** sync routes accept only `Content-Type: application/json` and an `Origin` equal to the app's own origin. Better Auth checks its own routes against `trustedOrigins`.
- **`user_id` comes from the session, never from the request body.** Every sync query filters on it, and an unauthenticated sync request gets `401` before any parsing.
- **Security headers**, through the static assets' `_headers` file and on API responses: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` denying what Ignite doesn't use. The CSP is `default-src 'self'`, with `connect-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'` and `form-action 'self'`. It allows the inline theme script at `index.html:12` by its **hash**, not with `'unsafe-inline'`. It ships as `Content-Security-Policy-Report-Only` in the first deploy, and becomes enforcing once a browser session shows no violations.
- **Rate limiting** on sign-in and sign-up uses Better Auth's limiter with **database storage**. In-memory storage resets whenever Cloudflare starts a new Worker instance.
- **Errors** return a generic JSON message and never a stack trace. **Logs** (Workers Logs, free) record the route, status and a count, never an email, a password, a request body or a task title.
- **Service worker:** `public/sw.js` serves every same-origin GET cache-first. **It must skip `/api/`**, or pull and the session check are cached once and go stale forever.
- Passwords are hashed by Better Auth (see §12 for the CPU question).

---

## 10. Testing

- **Vitest, pure logic:** the last-write-wins decision, the clock cap, outbox merging and `rev` handling (including "`lost` is ignored when `rev` moved"), the pull skip rule, the settings "synced fields only" rule, the seed-row skip on initial upload, the boolean conversion, and the batch split at 200 changes or 1 MB.
- **Zod fixtures that must fail:** an unknown key, a `user_id` inside `record`, a mismatched `id`, a store name outside the four, a 1,001-character title. Each is a test that goes red if the guard is removed.
- **Vitest with `fake-indexeddb`** (already a dependency): the syncing wrapper, including that a row and its outbox entry commit in one transaction, that local mode queues nothing, and that the version 2 upgrade waits (rather than fails) while a version 1 connection is open.
- **Worker handlers:** Cloudflare's Vitest pool (`@cloudflare/vitest-pool-workers`) against the Neon `dev` branch. **Local only**, so CI holds no database secrets. They include: a sync request without a session gets `401`; user A can never read or overwrite user B's row with the same `id`; a second push for the same user blocks while a first push's transaction is held open (the advisory lock); push then pull returns the row at once (Hyperdrive caching is off).
- **CI** adds `tsc --noEmit` to `npm run check`, and **a bundle-size gate** (`scripts/check-bundle.mjs`) that fails `npm run build` when the gzipped JS exceeds today's size plus 10 kB. That makes R2 a check that can go red, not a promise.
- **Two devices** are verified with two browser profiles against `wrangler dev`: edit on one, switch to the other, see it arrive; edit both offline, reconnect, check that the later edit wins; delete on one, edit on the other.
- **R2 is measured, not assumed:** the bundle size from Vite's report, and a local write's time before and after the wrapper.

---

## 11. Deploy and retiring GitHub Pages

- `vite.config.js` `base` goes from `"/ignite/"` to `"/"`.
- `deploy.yml` is replaced by a job that runs the tests, builds, migrates and deploys. It calls `npx wrangler deploy` from the lockfile rather than a third-party deploy action, so there is no extra action to pin or trust. It needs two repository secrets: `CLOUDFLARE_API_TOKEN` (scoped to editing this account's Workers only) and `NEON_DATABASE_URL` (the `main` branch's migration role).
- The workflow keeps top-level `permissions: contents: read`, runs only on push to `main` (never on `pull_request`), and so is unreachable from forks. The existing actions (`checkout`, `setup-node`) are pinned to full commit SHAs in the same change.
- Migrations run with `drizzle-kit migrate` against Neon `main`, as a step before `wrangler deploy`. Every migration is additive, so the old Worker still works against the new schema while the deploy rolls out.
- **GitHub Pages:** once the Worker is live, `malinfossum.github.io/ignite` is replaced by a small page that links to the new address and unregisters the old service worker. Only test data lives on the old origin, so no data bridge is needed.
- The README's live link and "Tech" section are updated in the same PR.

---

## 12. Open risk: the plan's first task

**Workers Free allows 10 ms of CPU per request.** Password hashing is built to be slow, and Better Auth hashes in pure JavaScript. Sign-in and sign-up may go over the limit. This is unmeasured.

**Task 1 of the plan measures it** on a deployed Worker, with CPU time read from the Worker's metrics:

- sign-up and sign-in,
- **a full push of 200 changes** (JSON parse + Zod + queries). Hashing isn't the only CPU cost. If the push goes over, the batch size in §5.3 drops until it fits.

If hashing goes over, the fallback (per R1) is a custom `password.hash` / `password.verify` in Better Auth that uses WebCrypto PBKDF2-SHA-256, which runs natively. The iteration count is the highest that fits inside 10 ms. That is below OWASP's recommended count for PBKDF2, which is why §5.4 requires 15 characters: a long password carries the strength a cheaper hash gives up. Workers Paid is only raised with me as a question.

The same measurement idea applies to push encryption in project 3. It is recorded on the roadmap, not here.

---

## 13. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Stack from 2026-09-24: Worker + Hyperdrive + Neon + Better Auth, all TypeScript | Roadmap, decided then |
| D2 | One Worker with static assets, not Pages + Worker | First-party cookie; code stays separable |
| D3 | The syncing wrapper around `db` is the only seam | Models, controller and views stay untouched |
| D4 | Outbox holds keys plus `rev`, written in the row's transaction | Coalesces edits; nothing is lost on a crash or during a push |
| D5 | Local hard deletes; server keeps content-free rows in a `tombstones` table | Keeps the seam in one file; a deleted title doesn't linger |
| D6 | Drizzle, real columns, PK `(user_id, id)`, no data FKs | Typed like EF Core; fixed seed IDs; rows arrive in any order |
| D7 | Last write wins per row, client clock capped at server time + 5 s | Single user; a wrong clock can't win forever |
| D8 | Sync on start, visible, online and 2 s after an edit; no live channel | One device in use at a time; zero idle cost |
| D9 | Allowlisted sign-up, no email in v1, 15-character minimum | Just me for now; opening up is a setting |
| D10 | Sign-out wipes local data (not the service worker) | A signed-out device shows no account data; offline still works |
| D11 | Free tiers only; the UI never waits for the network; +10 kB gz budget as a CI gate | My hard requirements |
| D12 | "Stay signed in" opt-in, unchecked; checked = 60 days rolling | My standing rule on remembered sessions |
| D13 | Pushes serialised per user with a transaction advisory lock | A pull can never skip a `server_seq` |
| D14 | Hyperdrive query caching off | A cached pull would hide fresh changes |

---

## 14. Privacy and legal

- **Where my data lives:** task content, area and section names, quiet hours, and my email and password hash are stored in Neon, **Frankfurt (EEA)**. Requests pass through Cloudflare, a US company that processes them transiently at its edge (EU–US Data Privacy Framework certified). IndexedDB on each signed-in device holds a copy.
- **Necessity:** every stored field is one the app already uses. The only new personal data is my email (the sign-in name) and the password hash.
- **Delete:** `api/scripts/delete-user.ts` deletes the user, and `ON DELETE CASCADE` removes every row and tombstone. Neon keeps point-in-time history for a short restore window on the free plan, so a deletion reaches backups when that window passes. The plan records the current window length from Neon's docs.
- **Export:** project 1's JSON export covers it.
- **Cookies:** the session cookie is strictly necessary, and the theme in `localStorage` is a preference I set myself, so no consent banner is needed (ekomloven § 3-15 exempts both).
- **Licences:** new dependencies must be MIT, Apache-2.0 or similarly permissive, compatible with Ignite's Apache-2.0. The plan checks each one's `license` field before installing.
- **Gate before anyone else joins:** as long as `ALLOWED_EMAILS` holds only me, I am processing my own data. **Before a second email is added**, Ignite needs a privacy notice, a way to delete an account from the app, and email for password reset. Adding a second email without those is out of bounds.

---

## 15. Considered and rejected

- **`Clear-Site-Data: "cache", "storage"` on sign-out.** It would unregister the service worker and drop the precache, breaking offline use, while the sensitive data (IndexedDB) is wiped by the client anyway. Only `"cookies"` is sent.
- **Rehoming orphaned tasks into Focus.** A real fix for §6.4's orphans, but a product decision, not sync plumbing. Named, not built.
- **Tie-breaking equal `order` values in the models.** Breaks the one-seam rule for a rare, harmless glitch. Named in §6.4.
- **Pinning `wrangler-action`.** Replaced by `npx wrangler` from the lockfile, which removes the third-party action instead of pinning it.
- **Purging tombstones after N days.** A device offline for longer than N days could bring deleted tasks back. Tombstones hold no content and are tiny, so they are kept.
- **A live region announcing every successful sync.** Background success is not news. Only failures and the end of a manual action are announced.
- **A per-field conflict merge.** More code for a single user's rare case. Last write wins per row stays (D7).
- **Cloudflare Data Localization (keeping processing inside the EU).** Enterprise only, so it conflicts with R1. Neon's EEA region is the durable part. Revisit if sign-up opens.

> Stress-tested 2026-09-29 (skill 2120355): 19 applied, 4 adapted, 0 decided by me.
