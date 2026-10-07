# Ignite accounts, database and sync: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** My tasks live in one account and follow me between desktop and phone, while local mode with no account keeps working exactly like today.

**Architecture:** One Cloudflare Worker serves the built app and `/api` on one origin. Better Auth handles email and password sign-in, and two sync routes (push, pull) store rows in Neon Postgres through Hyperdrive with Drizzle. On the client, a syncing wrapper around `src/model/db.js` is the only seam: every model write lands in IndexedDB first and leaves an outbox entry, and a sync engine pushes and pulls in the background after the first render.

**Tech Stack:** TypeScript 7 (type-check only; Vite and Vitest strip types), Vite 8, Vitest 4 with `fake-indexeddb`, Cloudflare Workers (wrangler 4, `@cloudflare/vitest-plugin`), Hyperdrive, Neon Postgres (Frankfurt), Better Auth 1.7.6, Drizzle ORM 0.45 + drizzle-kit 0.31, `pg` 8, Zod 4 (server only).

**Spec:** `docs/superpowers/specs/2026-09-29-ignite-accounts-sync-design.md`. Read it before any task. Section numbers below (§) point into it.

## Global Constraints

Every task's requirements include these. A task that would break R1 or R2 stops and asks me.

- **R1, it costs nothing.** Workers Free, Hyperdrive Free, Neon Free, a `*.workers.dev` address. No payment method is added anywhere. Workers Paid ($5/month) is only raised with me as a question.
- **R2, it never makes the app slower.** Every read and write goes to IndexedDB first. The first render comes from IndexedDB, and the startup sync runs after it. The only new cost on a local write is one outbox record in the same transaction.
- **Bundle budget:** sync and auth add at most **10 kB gzipped** to the client JS, enforced by `scripts/check-bundle.mjs` inside `npm run build`. No Better Auth client, no Zod and no other library in the client bundle. `BASELINE_BYTES` and `BUDGET_BYTES` change only with my yes (R2).
- **Server-only packages** (Better Auth, Drizzle, `pg`, Zod) never reach `src/`. `api/` never imports from `src/`. Both may import `shared/protocol.ts`, which holds types and constants only.
- **Names, paths and types** are fixed by the interface blocks in each task. Never rename one to fit a task.
- **Security:** session cookie HttpOnly, Secure, `SameSite=Strict`. `user_id` comes from the session only. Sync routes accept only `Content-Type: application/json` from the app's own `Origin`. No SQL text built from input. Logs never hold an email, a password, a request body or a task title.
- **Accounts:** sign-up only for emails in `ALLOWED_EMAILS`. Minimum password length **15**. Sign-in copy exactly: "Email or password is wrong" · "Too many attempts. Try again in a minute." · "Can't reach Ignite's server. Check your connection." · "Password must be at least 15 characters."
- **Licences:** every new dependency is MIT, Apache-2.0, ISC, BSD or CC0-1.0. A package only dev tooling reaches (`"dev": true` in `package-lock.json`) may also be LGPL-3.0-or-later: Wrangler's local simulator pulls in `sharp`'s libvips binaries, which never ship, so LGPL asks nothing of Ignite (decided 2026-10-07, when Task 1's check stopped on them). Check with `npm view <package> license` before installing. `npm view` only sees the packages I name, so after every install that changes `package-lock.json`, `node scripts/check-licences.mjs` (Task 2) checks every package new since `main`, including the ones they pull in. Expected: `0 disallowed`. Task 1's probe lives in its own folder before that script exists, so it runs the same rule as a one-liner against its own lockfile, with every package counted as new.
- **Database tests stay local.** The Workers handler tests run against the Neon `dev` branch on my machine only. CI holds no database secret.
- **Views and the controller get no unit tests** (project rule). They are verified in the browser, with numbers read off the page.
- **UI rules:** controls on one row share one height (44 px) and one bottom edge. Every control is at least 44 × 44 px. Mobile-first CSS with `min-width` queries only. Design-system tokens only; `design-system/` is read-only.
- **Commits:** Conventional Commits on the `docs/accounts-sync-spec` branch's successor feature branch. No `Co-Authored-By` line and no AI attribution, ever.
- **Writing:** no em dashes in code, comments, commits or docs. Short, direct sentences.

## Review Focus

Inputs and conditions the spec implies but that no happy-path test would catch. Each line names the task that carries its test.

1. **Email case.** I sign up as `malin@…` and later type `Malin@…` on my phone. The allowlist, sign-in and the "different email" check all treat those as the same account. Tests in Task 8 (allowlist) and Task 14 (different-email check).
2. **Text length counted as characters, not UTF-16 units.** A 20,000-character note written in emoji is 40,000 UTF-16 units. It must sync, because nothing in the app stopped me typing it. Test in Task 7.
3. **Session expired, then I sign in again as the same email.** The queued offline edits are pushed. Nothing is wiped and the "Add or Replace" question is not asked. Test in Task 14.
4. **Sign-out in one tab while a second tab is open.** The second tab stops showing the account's tasks without a manual reload. Test in Task 14 (the notifier fires) and a browser check in Task 15.
5. **Deploy while a tab is open.** The old client gets `426`, the status line says to reload, and one reload is enough to resume syncing with no edit lost. Check in Task 19.

## Plan-time decisions (flagged for me)

- **The account button sits in the sidebar footer beside the theme control**, not in the top bar as spec §7 says. The theme control lives in the sidebar footer, and the top bar is hidden at 768 px and wider.
- **`invalid` with server version "none" keeps the local row** and drops the outbox entry (approved 2026-09-30). The spec said to store the server's version, which would delete a task I just typed.
- **TypeScript 7**, and `baseUrl` is dropped from the config because TypeScript 7 removed it and nothing in `src/` uses it (approved 2026-09-30).
- **"Stay signed in" unchecked** gives a browser-session cookie and a 1-day server session that does not renew. A browser left open for more than 24 hours asks me to sign in again. The queue is kept, so nothing is lost.
- **Offline sign-out still wipes this device.** The cookie can't be cleared without a server response, so it lives until it expires. The device shows no account data either way.
- **Last-write-wins is decided in JavaScript under the advisory lock** (read current rows and tombstones for the batch, run a pure `decide()`, write in batches), not in a SQL `WHERE`. Same query count, and it can be unit-tested. Duplicate keys inside one push are marked `invalid`, because `ON CONFLICT` would fail the whole batch on them and jam the queue.

Deviations decided inside a task, listed here so none is missed (details in the task):

- **`ALLOWED_EMAILS` is a Worker secret, not a `vars` entry** (Task 0), so my email never sits in the public `wrangler.jsonc`.
- **The push-of-200 CPU measurement moves from Task 1 to Task 11.** It needs the real Worker and Neon; Task 1 only decides the password hash.
- **The allowlist is slightly probeable** (Task 8). A refused sign-up is `400`, an existing email is Better Auth's `422`, so "allowed and already signed up" can be told apart. The client shows one message for both. Better Auth also stores IP and user agent in sessions and IP in rate-limit rows (Task 8), which the §14 privacy notice must name.
- **Pull accepts a request with no `Origin` header** (Task 8). Push still requires JSON and a same-origin `Origin`. Origin and content type are checked before the session, so a cross-site request gets `403`, not `401`.
- **A different-account sign-in is refused while the old account has unsynced changes** (Task 14), with new copy beyond §8's four messages: "Couldn't create that account.", "Sign-in cancelled. Nothing on this device changed." and the unsynced-changes line.
- **"Add this device's tasks" also skips `settings:app`** (Task 14), besides the Focus area and section, so the account's settings win.

---

## File structure

```
shared/protocol.ts            wire types and constants (both sides)
api/src/index.ts              Worker entry: routing, security headers
api/src/env.ts                Env type
api/src/http.ts               json(), SECURITY_HEADERS, sameOrigin(), errorResponse()
api/src/db.ts                 pg Client per request + Drizzle
api/src/auth.ts               Better Auth config
api/src/auth.cli.ts           instance for the Better Auth CLI only
api/src/password.ts           PBKDF2 hash (only if Task 1 picks it)
api/src/schema.ts             Drizzle tables + shared sequence
api/src/auth-schema.ts        generated auth tables
api/src/validate.ts           Zod parsing of push bodies
api/src/records.ts            Postgres row ↔ wire record
api/src/decide.ts             last-write-wins + clock cap
api/src/push.ts, pull.ts      sync handlers
api/scripts/*.ts              reset-password, delete-user, measure-push (lib.ts shared)
api/drizzle/                  migrations
api/drizzle.config.ts         drizzle-kit config, reads DATABASE_URL
api/tsconfig.json             Worker type-check, part of npm run check
api/test/*.test.ts            pure server tests, plain Node Vitest
api/test/workers/             handler tests, local only (helpers.ts)
vitest.workers.config.ts      config for npm run test:workers
worker-configuration.d.ts     generated by wrangler types (Task 8)
src/model/db.js               IndexedDB v2 (Task 3)
src/sync/types.ts             Db, TxHandle, OutboxEntry, SyncMeta
src/sync/records.ts           stored row ↔ wire record
src/sync/rules.ts             settings rule, seed rule, batch split
src/sync/status.ts            status line text
src/sync/syncing-db.ts        the seam
src/sync/api.ts               fetch calls
src/sync/apply.ts             applyServerVersion: write a server version locally; true if the store changed
src/sync/engine.ts            push/pull rounds, SYNC_LOCK
src/sync/reseed.ts            createReseed(db): seed rows after a wipe
src/sync/account.ts           sign-in, first sign-in, sign-out
src/sync/announce.ts          the role="status" announcer
src/sync/account-dialog.ts    the dialog
src/sync/account-ui.ts        pure dialog and button state, validateSignIn
src/controller.js             createController({ models, els, account? }); start, stop, refresh, setAccountStatus
src/views/sidebar.js          account button, setAccountStatus({ label, attention })
tests/sync/*.test.ts          client sync tests; helpers.ts holds the shared fakes (Task 13)
tests/shared/, tests/scripts/ protocol and bundle-gate tests (Task 2)
tests/unit/db-v2.test.js      IndexedDB v2 (Task 3); headers.test.js (Task 17)
scripts/check-bundle.mjs      the R2 gate (command)
scripts/bundle-size.mjs       gzipTotal, overBudget, BASELINE_BYTES
scripts/check-licences.mjs    licences of packages new since main (Task 2)
scripts/headers.mjs           _headers at build: CSP (Report-Only), Permissions-Policy
tsconfig.json                 replaces jsconfig.json; allowJs, checkJs off
.github/workflows/retire-pages.yml   one-off: unregister the old service worker
.github/retire-pages/         the page it publishes: index.html, sw.js, build.mjs
wrangler.jsonc                Worker config

Local only, never committed:
.env, .dev.vars               secrets for drizzle-kit, wrangler dev and the admin scripts (Task 0)
.superpowers/cpu-probe/       throwaway hash probe (Task 1, deleted in its Step 10)
.superpowers/e2e/             test credentials (Task 15)
.superpowers/r2-measurements.md   R2 write times (Task 15)
.superpowers/release/v0.10.0.md   release notes draft (Task 19)
```

---

### Task 0: Accounts, database and secrets (only Malin can do this)

Everything outside the repo that the later tasks need: a Cloudflare account, a Neon project with two branches, a Hyperdrive config, the Worker's secrets, the local secret files and the two GitHub secrets. Spec R1, §5.1, §5.2, §9, §11, §14.

**R1 check before starting.** Nothing in this task costs money. Workers Free, Hyperdrive (included in Workers Free), Workers Logs (included) and Neon Free need no card. **Do not add a payment method anywhere.** If a screen asks for a card, stop and tell Claude: that screen is the wrong path, and Workers Paid is only ever a question for me (R1).

**Never paste a password, connection string or token into the chat.** Every command below reads them masked or from a prompt, so they don't land in shell history either.

**Files:**
- Modify: `.gitignore` (Step 1, Claude)
- Modify: `docs/superpowers/specs/2026-09-29-ignite-accounts-sync-design.md` (§14 only, Step 12, Claude)
- Create, never committed: `.env`, `.dev.vars` (Steps 8 and 9, Malin)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Cloudflare: a `<subdomain>.workers.dev` subdomain; a Worker named `ignite` holding the secrets `ALLOWED_EMAILS` and `BETTER_AUTH_SECRET`; a Hyperdrive config `ignite-db` pointing at Neon `main`, caching disabled.
  - Neon: project `ignite` in AWS Europe Central 1 (Frankfurt); branches `main` (default) and `dev` (child of `main`); role `ignite` owning database `ignite` on both, with a different password on each branch.
  - Local, gitignored: `.env` with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` and `DATABASE_URL` (both the `dev` branch); `.dev.vars` with `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOWED_EMAILS`.
  - A GitHub environment `production`, deployable from `main` only, holding the secrets `CLOUDFLARE_API_TOKEN` and `NEON_DATABASE_URL` (the `main` branch). No repository-level secrets.
  - Two non-secret values handed to Claude in chat for Task 8's `wrangler.jsonc`: the Hyperdrive `id` and the workers.dev subdomain.

**Decisions in this task (flag to Malin):**
- **`ALLOWED_EMAILS` is a secret, not a `vars` entry.** The spec calls it a Worker setting. As a `vars` entry it would sit in the public repo's `wrangler.jsonc`, with my sign-in email in it. A secret reads the same way in the Worker (`env.ALLOWED_EMAILS`, a string), so `api/src/env.ts` does not change. Task 8 must not add it to `vars`.
- **One Neon role, `ignite`, runs migrations and serves Hyperdrive.** It owns its own database `ignite`, so it can create tables without extra grants, and Neon's default `neondb_owner` stays unused. A separate read-write-only role for the Worker is a later hardening step, not v1.
- **`.env` holds the values Wrangler and drizzle-kit read; `.dev.vars` holds the Worker's own local secrets.** Wrangler loads `.env` as its own environment, which is where `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` has to be, and it stops passing `.env` values to the Worker once `.dev.vars` exists (checked in Cloudflare's docs on 2026-09-30). Vite also reads `.env`, but it only exposes names that start with `VITE_`, so neither value can reach the client bundle.
- **`DATABASE_URL`** is a new name: the `dev` branch's connection string for drizzle-kit and the admin scripts on my machine. CI passes the `main` branch's string under the same name from the `NEON_DATABASE_URL` secret.

- [ ] **Step 1: Ignore the local secret files and Wrangler's state (Claude)**

Add these two lines to `.gitignore`, directly under `.env.*.local`:

```gitignore
.dev.vars*
.wrangler/
```

`.env` is already ignored (`.gitignore` line 15).

Run: `git check-ignore -v .env .dev.vars .wrangler/state`
Expected: three lines, one per path, each naming a `.gitignore` line (`.env`, `.dev.vars*`, `.wrangler/`).

```bash
git add .gitignore
git commit -m "chore: ignore local Worker secrets and Wrangler state"
```

- [ ] **Step 2: Create the Cloudflare account and the workers.dev subdomain (Malin)**

1. Sign up at `https://dash.cloudflare.com/sign-up`. Skip every plan or upgrade offer.
2. Open **Workers & Pages**. The first visit asks for a workers.dev subdomain. Pick one. It becomes part of Ignite's public address (`ignite.<subdomain>.workers.dev`), so choose something I'm happy to share.

Check: **Workers & Pages → Overview** shows `<subdomain>.workers.dev` in the side panel, and **Manage account → Billing → Payment info** lists no payment method.

- [ ] **Step 3: Log Wrangler in (Malin)**

In PowerShell, from the repo folder:

```powershell
npx wrangler@4.144.0 telemetry disable
[Environment]::SetEnvironmentVariable("WRANGLER_SEND_METRICS", "false", "User")
npx wrangler@4.144.0 login
npx wrangler@4.144.0 whoami
```

Wrangler sends usage metrics unless told not to, so telemetry goes off before the first login. `telemetry disable` saves the choice in Wrangler's user config, and `WRANGLER_SEND_METRICS=false` covers any Wrangler run that does not read it (CI sets the same variable in Task 18). Open a new terminal afterwards so the variable is set. `login` opens the browser and asks to allow Wrangler. Allow it. `npx` keeps Wrangler in npm's cache, not in the project (it becomes a project dependency in a later task).

Check: `npx wrangler@4.144.0 telemetry status` says metrics are disabled. `whoami` prints "You are logged in with an OAuth Token" and a table with my account name and account ID.

Better Auth's telemetry is off unless enabled (its docs, checked 2026-10-07), and Task 8 also sets `telemetry: { enabled: false }`. drizzle-kit and `pg` send nothing.

- [ ] **Step 4: Create the Neon project in Frankfurt (Malin)**

1. Sign up at `https://console.neon.tech`. The Free plan needs no card.
2. **New project:** name `ignite`, the newest Postgres version offered, cloud provider AWS, region **AWS Europe Central 1 (Frankfurt)**. Leave Neon Auth off.
3. Neon's console names the first branch `production`. Rename it: **Branches → production → ⋯ → Rename** to `main`. The spec, the deploy job and the GitHub secret all say `main`.

Check: the project dashboard shows region Frankfurt (`aws-eu-central-1`), and **Branches** lists one branch, `main`, marked default.

- [ ] **Step 5: Create the role and the database on `main` (Malin)**

1. **Branches → main → Roles & Databases → Add role:** name `ignite`. Neon shows the password once. Save it in my password manager as "Neon ignite main".
2. **Add database:** name `ignite`, owner `ignite`. Owning its database lets the role create tables in its `public` schema, which drizzle-kit needs.

Check: **Roles & Databases** on `main` lists role `ignite` and database `ignite` with owner `ignite`.

- [ ] **Step 6: Create the `dev` branch and give it its own password (Malin)**

1. **Branches → New branch:** name `dev`, parent `main`, from current data. It copies the `ignite` role and database.
2. The copied role has the **same password** as on `main`, so the dev string on my laptop would also open production. Break that: **Branches → dev → Roles & Databases → ignite → ⋯ → Reset password.** Save the new one as "Neon ignite dev".

Check: **Branches** lists `main` (default) and `dev` (parent `main`), and Neon confirmed the password reset on `dev`.

- [ ] **Step 7: Create the Hyperdrive config, caching off (Malin)**

Hyperdrive must use the **direct** connection, not Neon's pooled one: Hyperdrive pools connections itself (Cloudflare's Neon guide says to untick pooling).

1. In Neon: **Dashboard → Connect**, branch `main`, database `ignite`, role `ignite`, **Connection pooling off**. Copy the connection string (it starts `postgresql://ignite:`).
2. In PowerShell:

```powershell
$env:NEON_MAIN_URL = Read-Host -MaskInput "Neon main connection string"
npx wrangler@4.144.0 hyperdrive create ignite-db --connection-string="$env:NEON_MAIN_URL" --caching-disabled
Remove-Item Env:NEON_MAIN_URL
```

`hyperdrive create` connects to the database before it saves the config, so success also proves the `main` string and password work. If it rejects the string, run the three lines again with `&channel_binding=require` removed from the end of the string.

3. Copy the `id` from the output and give it to Claude in chat. It is not a secret: it goes into `wrangler.jsonc` in Task 8.

Run: `npx wrangler@4.144.0 hyperdrive get <id>`
Expected: JSON with `"name": "ignite-db"`, `"database": "ignite"`, and `"caching": { "disabled": true }` (spec D14).

- [ ] **Step 8: Write `.env` for local development (Malin)**

In Neon, copy the `dev` branch's direct string the same way (branch `dev`, database `ignite`, role `ignite`, pooling off). Then, in PowerShell from the repo folder:

```powershell
$dev = Read-Host -MaskInput "Neon dev connection string"
Set-Content -Path .env -Value @("CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='$dev'", "DATABASE_URL='$dev'")
Remove-Variable dev
```

`wrangler dev` and the local handler tests then reach Neon `dev` directly, and never `main`.

Run: `git status --short`
Expected: `.env` does not appear.

- [ ] **Step 9: Write `.dev.vars` for the local Worker (Malin)**

A local secret of its own, never the production one:

```powershell
$secret = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
$email = Read-Host "Sign-in email"
Set-Content -Path .dev.vars -Value @("BETTER_AUTH_SECRET='$secret'", "BETTER_AUTH_URL='http://localhost:8787'", "ALLOWED_EMAILS='$email'")
Remove-Variable secret, email
```

The prompt asks for my sign-in email. The file is never opened in an editor, because it holds `BETTER_AUTH_SECRET` and an open editor tab can be read by tooling. `8787` is `wrangler dev`'s default port.

Run: `git status --short`
Expected: `.dev.vars` does not appear.

- [ ] **Step 10: Set the production Worker's secrets (Malin)**

`ALLOWED_EMAILS` first, typed at the prompt. The Worker `ignite` does not exist yet, so Wrangler asks whether to create it: answer yes. It creates a placeholder Worker that the first real deploy replaces, and the secrets stay.

```powershell
npx wrangler@4.144.0 secret put ALLOWED_EMAILS --name ignite
```

Then the auth secret, generated and piped straight in, so it never shows on screen or on the clipboard:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))" | npx wrangler@4.144.0 secret put BETTER_AUTH_SECRET --name ignite
```

Run: `npx wrangler@4.144.0 secret list --name ignite`
Expected: a list with `ALLOWED_EMAILS` and `BETTER_AUTH_SECRET`, both of type `secret_text`. Values are never shown.

- [ ] **Step 11: Create the deploy token and the two GitHub secrets (Malin)**

1. Cloudflare: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template.
   - Account Resources: Include, my account only.
   - Zone Resources: Include, all zones from my account (I have none, so this grants nothing).
   - Delete the **Workers KV Storage** and **Workers R2 Storage** rows. Ignite uses neither.
   - **Continue to summary → Create Token.** Cloudflare shows it once.
2. Check the token works before storing it:

```powershell
$env:CLOUDFLARE_API_TOKEN = Read-Host -MaskInput "Cloudflare API token"
npx wrangler@4.144.0 whoami
Remove-Item Env:CLOUDFLARE_API_TOKEN
```

Expected: "You are logged in with an User API Token" and my account in the table.

3. Create a GitHub environment `production` that only `main` can deploy to. A repository secret is readable by any workflow run on any branch, so a pushed branch with an edited workflow could print it. An environment secret only reaches a job that declares `environment: production`, and the branch policy only lets `main` run such a job. This is what makes spec §9's "main-only" true. Either click **Settings → Environments → New environment → `production` → Deployment branches and tags → Selected branches and tags → Add rule `main`**, or from the repo folder:

```powershell
'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' | gh api -X PUT repos/malinfossum/ignite/environments/production --input -
gh api -X POST repos/malinfossum/ignite/environments/production/deployment-branch-policies -f name=main
```

Run: `gh api repos/malinfossum/ignite/environments/production`
Expected: JSON with `"deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }`.

Run: `gh api repos/malinfossum/ignite/environments/production/deployment-branch-policies`
Expected: `"total_count": 1` and one policy with `"name": "main"`.

4. From the repo folder, store both secrets in that environment. Each command prompts "Paste your secret" with hidden input:

```powershell
gh secret set CLOUDFLARE_API_TOKEN --env production
gh secret set NEON_DATABASE_URL --env production
```

`NEON_DATABASE_URL` is the `main` branch's direct string from Step 7 (spec §11).

Run: `gh secret list --env production`
Expected: `CLOUDFLARE_API_TOKEN` and `NEON_DATABASE_URL`, both updated today.

Run: `gh secret list`
Expected: neither name. Repository-level secrets would be readable from every branch.

- [ ] **Step 12: Record Neon's restore window in the spec (Malin reads it, Claude writes it)**

Malin: open **Neon → project `ignite` → Settings → Instant restore** and read the restore window. On the Free plan it is **6 hours** (Neon's default and maximum on Free since 2025-10-17, verified in Neon's docs on 2026-09-30). Tell Claude the number shown.

Claude: run `date +"%Y-%m-%d"`, then in the spec's §14, replace the sentence

```markdown
Neon keeps point-in-time history for a short restore window on the free plan, so a deletion reaches backups when that window passes. The plan records the current window length from Neon's docs.
```

with this, where `<date>` is `date`'s output (and `6 hours`, twice, becomes whatever Malin read if it differs):

```markdown
Neon keeps point-in-time history for a restore window of **6 hours** on the Free plan (the project's Instant restore setting, checked <date>), so a deletion has left every backup 6 hours after it runs.
```

```bash
git add docs/superpowers/specs/2026-09-29-ignite-accounts-sync-design.md
git commit -m "docs(spec): record Neon's restore window"
```

- [ ] **Step 13: Final check (Malin and Claude together)**

| Check | Command or place | Expected |
|---|---|---|
| Wrangler logged in | `npx wrangler@4.144.0 whoami` | my account |
| Hyperdrive | `npx wrangler@4.144.0 hyperdrive list` | `ignite-db` |
| Worker secrets | `npx wrangler@4.144.0 secret list --name ignite` | `ALLOWED_EMAILS`, `BETTER_AUTH_SECRET` |
| GitHub environment | `gh api repos/malinfossum/ignite/environments/production/deployment-branch-policies` | one policy, `main` |
| GitHub secrets | `gh secret list --env production` | `CLOUDFLARE_API_TOKEN`, `NEON_DATABASE_URL` |
| No repository secrets | `gh secret list` | neither name |
| Local files ignored | `git check-ignore -v .env .dev.vars` | two lines |
| Neon | Branches page | `main` (default) and `dev`, Frankfurt |
| R1 | Cloudflare Billing, Neon Billing | no payment method, Free plan |
| Hand-off | chat | Claude has the Hyperdrive `id` and the workers.dev subdomain |

---

### Task 1: The CPU probe

Measure what password hashing costs on Workers Free before anything is built on top of it, and pick the hash. Spec §12, §5.4, R1.

A throwaway Worker in `.superpowers/cpu-probe/` (gitignored, never committed). It needs no Neon. The only thing that leaves this task is a dated result table and a decision, written into the spec's §12.

**Files:**
- Create, never committed: `.superpowers/cpu-probe/package.json`, `.superpowers/cpu-probe/wrangler.jsonc`, `.superpowers/cpu-probe/src/index.js`, `.superpowers/cpu-probe/run.mjs`
- Modify: `docs/superpowers/specs/2026-09-29-ignite-accounts-sync-design.md` (§12 only)

**Interfaces:**
- Consumes: Task 0's Wrangler login (Step 3) and workers.dev subdomain (Step 2).
- Produces: in spec §12, the measured table and exactly one of these decisions, which Task 8 reads:
  - **"Better Auth's default hash"**: no `api/src/password.ts`.
  - **"PBKDF2-SHA-256 via WebCrypto at N iterations"** or **"PBKDF2-SHA-256 via node:crypto at N iterations"**: Task 8 writes `api/src/password.ts` with that implementation and `N`.
  - **"Nothing fits"**: the plan stops and asks Malin (Step 8, rule 3).

**What I verified for this task (2026-09-30):**
- `better-auth/crypto` exports `hashPassword(password: string): Promise<string>` and `verifyPassword({ hash, password }): Promise<boolean>` (read from `better-auth@1.7.6`'s published type file). On workerd they resolve to `@better-auth/utils/password`'s `workerd` build: `node:crypto` scrypt with N=16384, r=16, p=1, a 64-byte key, stored as `salt:key` in hex. So the probe measures exactly what Better Auth would run.
- **Production Workers refuse WebCrypto PBKDF2 above 100 000 iterations** ("Pbkdf2 failed: iteration counts above 100000 are not supported"), and local `wrangler dev` does not enforce it, so only the deployed probe tells the truth. OWASP's recommendation for PBKDF2-SHA-256 is 600 000. That is why the probe also measures the same PBKDF2-SHA-256 through `node:crypto`, whose limit is unknown: the probe finds out. Both produce the same bytes for the same inputs (checked locally in Node), so the choice of implementation never changes the stored hash.
- Timing inside a Worker does not work: `performance.now()` only advances on I/O, so it reads close to 0 across pure CPU work. CPU time comes from Workers Logs (`$workers.cpuTimeMs`), grouped by `$workers.event.request.path`.
- Licences, for the record (this is throwaway, but the same packages ship in Task 8): `better-auth@1.7.6` MIT, `wrangler@4.144.0` "MIT OR Apache-2.0".

**The push of 200 changes (spec §12's second measurement) is not here.** It needs the real push handler and Neon, so Task 11 measures it on the deployed Worker.

- [ ] **Step 1: Confirm the probe folder is ignored**

Run: `git check-ignore -v .superpowers/cpu-probe/src/index.js`
Expected: one line whose rule is `.superpowers/` (for example `.gitignore:23:.superpowers/	.superpowers/cpu-probe/src/index.js`).

- [ ] **Step 2: Write the probe's package and Wrangler config**

`.superpowers/cpu-probe/package.json`:

```json
{
	"name": "ignite-cpu-probe",
	"private": true,
	"type": "module",
	"dependencies": {
		"better-auth": "1.7.6"
	},
	"devDependencies": {
		"wrangler": "4.144.0"
	}
}
```

`.superpowers/cpu-probe/wrangler.jsonc`:

```jsonc
{
	"name": "ignite-cpu-probe",
	"main": "src/index.js",
	"compatibility_date": "2026-09-01",
	// Better Auth's hash uses node:crypto, the same flag Ignite's Worker sets.
	"compatibility_flags": ["nodejs_compat"],
	"workers_dev": true,
	// Workers Logs (free) records $workers.cpuTimeMs for every request.
	"observability": {
		"enabled": true,
		"logs": { "invocation_logs": true, "head_sampling_rate": 1 }
	}
}
```

Run: `npm install` in `.superpowers/cpu-probe/`
Expected: installs without errors; `node_modules/better-auth/package.json` reads version `1.7.6`.

Then check the licence of every package npm pulled in, not just the two I named (`npm view` only sees those). The probe's lockfile is compared with an empty one, so every package in it counts as new. Task 2's `scripts/check-licences.mjs` does not exist yet, so this is the same rule as a one-liner. In `.superpowers/cpu-probe/`:

```bash
node -e "const ok=new Set(['MIT','Apache-2.0','ISC','BSD-2-Clause','BSD-3-Clause','0BSD','CC0-1.0']);const dev=new Set([...ok,'LGPL-3.0-or-later']);const p=require('./package-lock.json').packages;const bad=Object.entries(p).filter(([k,v])=>k.includes('node_modules/')&&v.link===undefined).filter(([,v])=>{const list=v.dev===true?dev:ok;const ids=String(v.license??'').split(/\s+OR\s+|\s+AND\s+|[()]/).map((s)=>s.trim()).filter(Boolean);return ids.length===0||ids.some((id)=>list.has(id)===false)});for(const [k,v] of bad)console.log(k.slice(k.lastIndexOf('node_modules/')+13),v.version,v.license??'(none)');console.log(bad.length+' disallowed')"
```

Expected: one line, `0 disallowed`. Any package listed above that line stops the task: tell Malin the name and licence, and do not widen the list.

- [ ] **Step 3: Write the Worker**

`.superpowers/cpu-probe/src/index.js`:

```js
// Throwaway CPU probe for spec §12. Never committed.
// Each request does exactly one password operation, so that invocation's
// $workers.cpuTimeMs in Workers Logs is the cost of the operation. Timing
// inside the Worker would not work: performance.now() only advances on I/O in
// Workers, so it reads close to 0 across pure CPU work.
import { pbkdf2 } from "node:crypto";
import { promisify } from "node:util";
import { hashPassword, verifyPassword } from "better-auth/crypto";

const pbkdf2Node = promisify(pbkdf2);
const encoder = new TextEncoder();
const KEY_BYTES = 32;

const toHex = (bytes) =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) =>
	Uint8Array.from(hex.match(/../g), (h) => Number.parseInt(h, 16));

// WebCrypto PBKDF2, the fallback the spec names.
async function deriveWeb(password, salt, iterations) {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password.normalize("NFKC")),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
		key,
		KEY_BYTES * 8,
	);
	return new Uint8Array(bits);
}

// The same PBKDF2-SHA-256 through node:crypto (nodejs_compat). Measured because
// production WebCrypto refuses more than 100 000 iterations.
async function deriveNode(password, salt, iterations) {
	const key = await pbkdf2Node(
		password.normalize("NFKC"),
		salt,
		iterations,
		KEY_BYTES,
		"sha256",
	);
	return new Uint8Array(key);
}

const DERIVE = { "pbkdf2-web": deriveWeb, "pbkdf2-node": deriveNode };

// Paths: /noop · /scrypt/hash · /scrypt/verify
//        /pbkdf2-web/hash/<iterations> · /pbkdf2-web/verify/<iterations>
//        /pbkdf2-node/hash/<iterations> · /pbkdf2-node/verify/<iterations>
async function handle(path, body) {
	const [, algo, action, iterText] = path.split("/");
	if (algo === "noop") return { ok: true };
	if (algo === "scrypt" && action === "hash") {
		return { hash: await hashPassword(body.password) };
	}
	if (algo === "scrypt" && action === "verify") {
		return { ok: await verifyPassword(body) };
	}
	const derive = DERIVE[algo];
	const iterations = Number(iterText);
	if (!derive || !Number.isInteger(iterations) || iterations < 1) return null;
	if (action === "hash") {
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const key = await derive(body.password, salt, iterations);
		return { hash: `${toHex(salt)}:${toHex(key)}` };
	}
	if (action === "verify") {
		const [saltHex, keyHex] = body.hash.split(":");
		const key = await derive(body.password, fromHex(saltHex), iterations);
		return { ok: toHex(key) === keyHex };
	}
	return null;
}

export default {
	async fetch(request) {
		try {
			const body = await request.json();
			const result = await handle(new URL(request.url).pathname, body);
			if (!result) {
				return Response.json({ error: "no such route" }, { status: 404 });
			}
			return Response.json(result);
		} catch (err) {
			// Shows the runtime's own message, e.g. the 100 000-iteration cap.
			return Response.json({ error: String(err) }, { status: 500 });
		}
	},
};
```

- [ ] **Step 4: Write the driver**

`.superpowers/cpu-probe/run.mjs`:

```js
// Drives the probe: ROUNDS sign-ups (hash) and sign-ins (verify) per variant.
// Usage: node run.mjs <base-url>
// It prints only whether each call worked. The CPU numbers come from Workers
// Logs, because the Worker cannot time itself.
const base = process.argv[2];
if (!base) {
	console.error("Usage: node run.mjs <base-url>");
	process.exit(1);
}

const PASSWORD = "correct horse battery staple"; // 28 characters, over the 15 minimum
const ROUNDS = 10;
const ITERATIONS = [25_000, 50_000, 100_000, 200_000, 300_000, 600_000];

async function post(path, body) {
	const res = await fetch(new URL(path, base), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	try {
		return { status: res.status, json: JSON.parse(text) };
	} catch {
		// Cloudflare's own error pages (1102 = CPU limit exceeded) are HTML.
		return { status: res.status, json: { error: text.slice(0, 120) } };
	}
}

async function variant(prefix, suffix = "") {
	let ok = 0;
	const errors = new Set();
	for (let i = 0; i < ROUNDS; i++) {
		const signUp = await post(`${prefix}/hash${suffix}`, {
			password: PASSWORD,
		});
		if (signUp.status !== 200) {
			errors.add(`hash ${signUp.status}: ${signUp.json.error}`);
			continue;
		}
		const signIn = await post(`${prefix}/verify${suffix}`, {
			hash: signUp.json.hash,
			password: PASSWORD,
		});
		if (signIn.status !== 200 || signIn.json.ok !== true) {
			errors.add(
				`verify ${signIn.status}: ${signIn.json.error ?? "wrong result"}`,
			);
			continue;
		}
		ok++;
	}
	const detail = errors.size ? ` | ${[...errors].join(" | ")}` : "";
	console.log(`${prefix}${suffix}: ${ok}/${ROUNDS} ok${detail}`);
}

// Same body as the real calls, so /noop is the floor: JSON parse + response.
for (let i = 0; i < ROUNDS; i++) await post("/noop", { password: PASSWORD });
console.log(`/noop: ${ROUNDS} sent`);

await variant("/scrypt");
for (const n of ITERATIONS) {
	await variant("/pbkdf2-web", `/${n}`);
	await variant("/pbkdf2-node", `/${n}`);
}
```

- [ ] **Step 5: Run it locally to prove the routes work**

In `.superpowers/cpu-probe/`, terminal 1: `npx wrangler dev`
Terminal 2, same folder: `node run.mjs http://localhost:8787`
Expected: `/noop: 10 sent`, then 13 lines that each read `10/10 ok`. Local numbers mean nothing for CPU (my laptop, no limit). The PBKDF2 lines above 100 000 pass here because local workerd does not enforce the cap. Stop `wrangler dev` with Ctrl+C.

- [ ] **Step 6: Deploy and drive it**

In `.superpowers/cpu-probe/`: `npx wrangler deploy`
Expected: "Deployed ignite-cpu-probe" and the URL `https://ignite-cpu-probe.<subdomain>.workers.dev`.

Run: `node run.mjs https://ignite-cpu-probe.<subdomain>.workers.dev`
Expected:
- `/pbkdf2-web/200000`, `/300000` and `/600000` read `0/10 ok | hash 500: ... iteration counts above 100000 are not supported ...`. That is the production cap, and it confirms these requests ran on Cloudflare, not locally.
- Any variant over the CPU limit shows `503` with Cloudflare's 1102 page for some or all rounds. Workers Free tolerates short bursts over 10 ms, so a variant can read `10/10 ok` and still be over. The logs decide, not this output.
- Under 300 requests in total, far below the Free plan's 100 000 a day.

- [ ] **Step 7: Read the CPU time from Workers Logs**

Wait two minutes for the logs to arrive. Then, in the Cloudflare dashboard: **Workers & Pages → ignite-cpu-probe → Observability → Query builder** (or the account-wide **Observability** page with a filter `$workers.scriptName = ignite-cpu-probe`).

- Visualizations: **Count**, **Median** of `$workers.cpuTimeMs`, **Max** of `$workers.cpuTimeMs`
- Group by: `$workers.event.request.path`
- Time range: the last hour

Expected: one row per path. Count is 10 for every path that ran all rounds (fewer where a hash failed, since its verify was skipped). Rows with `$workers.outcome` `exceededCpu` are over the limit whatever their number says; add `$workers.outcome` to the group-by to see them.

- [ ] **Step 8: Decide**

Take the **max**, not the median: a sign-in that fails one time in ten is broken. Apply the rules in order and stop at the first that holds:

1. `/scrypt/hash` and `/scrypt/verify` both have a max **under 8 ms**, with no `exceededCpu` → **Better Auth's default hash.** The 2 ms left over is for the rest of a sign-in request (JSON, the session row, signing the cookie), the same headroom rule 2 keeps.
2. Otherwise, among the PBKDF2 rows that returned `10/10 ok` in Step 6, take the **highest iteration count whose hash and verify maxes are both under 8 ms**. The 2 ms left over is for the rest of a sign-in request (JSON, the session row, signing the cookie). If WebCrypto and `node:crypto` reach the same count, pick WebCrypto: it is what the spec names. If `node:crypto` fits a higher count (because WebCrypto stops at 100 000), pick `node:crypto` and flag it to Malin as a small change from the spec's wording. → **"PBKDF2-SHA-256 via <WebCrypto | node:crypto> at N iterations".**
3. Even 25 000 iterations is over 8 ms → **nothing fits. Stop and ask Malin.** Options to put to me: a count below 25 000 (weak, even with a 15-character password), or Workers Paid ($5/month), which R1 allows only if she says yes. Stopping here still runs Step 9 (record the table and this decision) and then Step 10 (delete the probe) before asking.

**Step 10 runs in every outcome, straight after Step 9**, including rule 3. The probe has no sign-in and answers anyone who finds its address, so it must never stay deployed while a question waits for Malin.

- [ ] **Step 9: Record the result in the spec**

Run `date +"%Y-%m-%d"`. In §12, directly after the paragraph that ends "Workers Paid is only raised with me as a question.", add the block below. Fill every `<median> / <max>` cell from Step 7, in ms with one decimal. Write `refused` in a cell where the runtime refused the count (Step 6's 500 with the 100 000 message), and `over (1102)` where the outcome was `exceededCpu`. `<date>` is the output of `date`, `<noop>` is the `/noop` row's median / max.

```markdown
**Measured <date>** (plan Task 1: a throwaway Worker on Workers Free, `better-auth@1.7.6`, CPU from `$workers.cpuTimeMs` in Workers Logs, 10 runs each, median / max in ms; the floor, `/noop`, was <noop>):

| Hash | Sign-up (hash) | Sign-in (verify) |
|---|---|---|
| Better Auth default: scrypt N=16384, r=16, p=1 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, WebCrypto, 25 000 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, WebCrypto, 50 000 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, WebCrypto, 100 000 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, WebCrypto, 200 000 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, WebCrypto, 300 000 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, WebCrypto, 600 000 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, node:crypto, 25 000 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, node:crypto, 50 000 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, node:crypto, 100 000 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, node:crypto, 200 000 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, node:crypto, 300 000 | <median> / <max> | <median> / <max> |
| PBKDF2-SHA-256, node:crypto, 600 000 | <median> / <max> | <median> / <max> |

<decision>
```

`<decision>` is exactly one of these three, completed from Step 8:

- `**Decision: Better Auth's default hash.** Its hash and verify both stay under 8 ms of CPU, which leaves 2 ms for the rest of the request. The push of 200 changes is measured in Task 11.`
- `**Decision: PBKDF2-SHA-256 via <WebCrypto | node:crypto> at <N> iterations.** Better Auth's scrypt is over 8 ms; <N> is the highest count measured whose sign-up and sign-in both stay under 8 ms. §5.4's 15-character minimum carries the strength this count gives up against OWASP's 600 000. The push of 200 changes is measured in Task 11.`
- `**Decision: nothing fits on Workers Free.** Even 25 000 iterations is over 8 ms. Raised with me as a question (R1).`

These cells are measurements, so they can only be filled after Step 7. Never fill one with an estimate: a missing number stays a question for Malin.

```bash
git add docs/superpowers/specs/2026-09-29-ignite-accounts-sync-design.md
git commit -m "docs(spec): record the password-hash CPU measurement and the chosen hash"
```

- [ ] **Step 10: Remove the probe**

This runs in every outcome of Step 8, rule 3 included, straight after Step 9. The probe is unauthenticated and must never stay deployed.

In `.superpowers/cpu-probe/`: `npx wrangler delete`, and confirm the name when asked.
Expected: "Successfully deleted ignite-cpu-probe". **Workers & Pages** no longer lists it (the placeholder `ignite` from Task 0 stays).

Then delete the folder: `Remove-Item -Recurse -Force .superpowers/cpu-probe`. The numbers live in the spec now.

---

### Task 2: TypeScript toolchain, the shared protocol and the bundle gate

Type-checking for the new `.ts` code, the one module both sides of sync import, and the CI gate that turns R2's bundle budget into a check that can go red. Spec R2, §3, §10, §14 (licences).

**Files:**
- Rename and rewrite: `jsconfig.json` → `tsconfig.json`
- Modify: `package.json` (devDependencies; scripts `check` and `build`), `package-lock.json` (by npm), `vitest.config.js`
- Create: `shared/protocol.ts`, `scripts/bundle-size.mjs`, `scripts/check-bundle.mjs`, `scripts/check-licences.mjs`
- Test: `tests/shared/protocol.test.ts`, `tests/scripts/check-bundle.test.js`
- Not modified: `.github/workflows/ci.yml` and `deploy.yml`. CI already runs `npm run check` and `npm run build`, so it picks up `tsc` and the gate through the scripts. `deploy.yml` runs `npm run build` too, so the gate also guards deploys.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `shared/protocol.ts`: exactly the CONTRACT block (`PROTOCOL_VERSION`, `STORES`, `Store`, `SYNCED_STORES`, `EPOCH`, `MAX_CHANGES`, `MAX_BODY_BYTES`, `PULL_LIMIT`, `CLOCK_SKEW_MS`, `keyOf(store: Store, id: string): string`, `Row`, `PutChange`, `DeleteChange`, `Change`, `PushRequest`, `ServerVersion`, `PushResponse`, `PulledChange`, `PullResponse`).
  - `scripts/bundle-size.mjs`: `BASELINE_BYTES: number`, `BUDGET_BYTES = 10_240`, `gzipTotal(dir: string): number` (gzip level 9, `.js` files directly in `dir`), `overBudget(bytes: number, baseline = BASELINE_BYTES, budget = BUDGET_BYTES): boolean` (true iff `bytes > baseline + budget`).
  - `scripts/check-bundle.mjs [dir]`: exits 1 when the gzipped JS in `dir` (default `dist/assets`) is over the limit or when there is no JS at all; otherwise prints `Bundle gate: <total> of <limit> bytes of gzipped JS (<left> left).`
  - `npm run check` = Biome + `tsc --noEmit`. `npm run build` = `vite build` + the gate.
  - Vitest runs `tests/**/*.test.{js,ts}` and `api/test/**/*.test.ts`, and never `api/test/workers/**`.

**Decisions in this task (flag to Malin):**
- **`tsconfig.json` replaces `jsconfig.json`.** `tsc` only finds `tsconfig.json` on its own. A `jsconfig.json` is the same format with `allowJs` implied, and exists for projects with no TypeScript. With `.ts` files in the repo, one `tsconfig.json` serves VS Code and CI alike. `baseUrl` is dropped: TypeScript 7 removed it, and nothing uses it (no `paths`, no bare-path imports in `src/`).
- **`checkJs` stays off.** The existing JavaScript is not type-checked; only `.ts` files are. Turning it on is a project of its own.
- **`api/` is not in this `tsconfig.json`.** The Worker's `Request`, `Response` and `env` types come from `wrangler types` and clash with the browser's DOM types. The task that creates `api/src/` adds `api/tsconfig.json` and appends `&& tsc --noEmit -p api` to `check`.
- **`@types/node@^22` is added with TypeScript.** TypeScript 7 loads no `@types` packages by default (`types: []`), but Vitest's and Vite's own type files reference Node's, so `tsc` over the tests fails without it. Version 22 matches CI's Node. The later Worker task needs it anyway.
- **The gate is split into `bundle-size.mjs` (pure) and `check-bundle.mjs` (the command).** A single file would need an "am I the main module?" test to be importable by the tests. That test compares paths, and a path mismatch (a junction, a drive-letter case) would make the gate skip itself silently. Two files cannot fail that way.
- **Budget = 10 240 bytes**, gzip level 9, JS in `dist/assets` only (not `sw.js`, CSS, fonts or source maps). Level 9 is a fixed definition, so the number is stable. It reads a few bytes off Vite's printed gzip size, which is why the baseline is measured with the gate's own function.

**What I verified for this task (2026-09-30):** `typescript@7.0.2` is Apache-2.0, has no install script, needs Node >= 16.20, and ships its compiler through per-platform packages (`@typescript/typescript-win32-x64` and `-linux-x64` are Apache-2.0 too), so `npm ci` on CI's Linux runner gets the right one. `@types/node@22.20.4` is MIT with no install script. TypeScript 6.0 folded `DOM.Iterable` into `DOM` (the old name is now an empty file), so `lib` is `["ESNext", "DOM"]`. The code in Steps 3, 6, 7, 9, 13 and 15 was run through the repo's Biome config unchanged, and the tests in Steps 7 and 13 were run against it with the repo's Vitest 4.1.11: 13 tests pass (the baseline pin added to Step 13 afterwards makes it 14), and the gate printed `Bundle gate: 19958 of 30198 bytes` against the 2026-09-24 build.

- [ ] **Step 1: Check the licences of the new dependencies (spec §14)**

Run:

```bash
npm view typescript@7.0.2 license
npm view @typescript/typescript-win32-x64@7.0.2 license
npm view @typescript/typescript-linux-x64@7.0.2 license
npm view @types/node@22.20.4 license
```

Expected: `Apache-2.0`, `Apache-2.0`, `Apache-2.0`, `MIT`. All four are compatible with Ignite's Apache-2.0. If any prints something else, stop and ask.

- [ ] **Step 2: Install them**

```bash
npm install --save-dev --save-exact typescript@7.0.2
npm install --save-dev @types/node@^22.20.4
```

TypeScript is pinned exactly: its minor releases add new errors, and a CI run must not go red on a Tuesday because of one.

Run: `npx tsc --version`
Expected: `Version 7.0.2`. `package.json` devDependencies now include `"typescript": "7.0.2"` and `"@types/node": "^22.20.4"`.

`npm view` in Step 1 only saw the four packages I named, not what they pull in. Create `scripts/check-licences.mjs`, which reads every package lockfile v3 records (each entry carries its own `license` field) and lists the ones that are new since `main` and outside the allowlist:

```js
// Prints every package that is new in package-lock.json since main and whose
// licence is outside my allowlist. `npm view` only sees the packages I name,
// and this sees everything they pull in. Exits 1 when it lists any.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOWED = new Set([
	"MIT",
	"Apache-2.0",
	"ISC",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"0BSD",
	"CC0-1.0",
]);

// Only dev tooling reaches these, so they never ship. Wrangler's local
// simulator pulls in sharp's libvips binaries (decided 2026-10-07).
const ALLOWED_DEV = new Set([...ALLOWED, "LGPL-3.0-or-later"]);

/** True when every SPDX id in the expression is on the allowlist. */
function allowed(entry) {
	const list = entry.dev === true ? ALLOWED_DEV : ALLOWED;
	const ids = String(entry.license ?? "")
		.split(/\s+OR\s+|\s+AND\s+|[()]/)
		.map((id) => id.trim())
		.filter(Boolean);
	return ids.length > 0 && ids.every((id) => list.has(id));
}

const base = JSON.parse(
	execFileSync("git", ["show", "main:package-lock.json"], { encoding: "utf8" }),
).packages;
const current = JSON.parse(readFileSync("package-lock.json", "utf8")).packages;

// A package counts as new when main has no entry at that path, or a different
// version. Workspace links carry no licence of their own and are skipped.
const bad = Object.entries(current).filter(
	([path, entry]) =>
		path.includes("node_modules/") &&
		entry.link === undefined &&
		base[path]?.version !== entry.version &&
		!allowed(entry),
);

for (const [path, entry] of bad) {
	const name = path.slice(path.lastIndexOf("node_modules/") + 13);
	console.log(`${name} ${entry.version} ${entry.license ?? "(none)"}`);
}
console.log(`${bad.length} disallowed`);
process.exitCode = bad.length > 0 ? 1 : 0;
```

A package with no `license` field counts as disallowed. So does any SPDX id outside the list, including a `WITH` exception, because the whole term then fails to match.

Run: `node scripts/check-licences.mjs`
Expected: one line, `0 disallowed`, exit code 0. Any package listed above that line stops the task: tell Malin its name and licence, and do not widen the list. (Checked 2026-10-07 against the unchanged lockfile: `0 disallowed`. The same rule over main's whole lockfile lists 26 existing packages, `lightningcss`'s MPL-2.0 binaries among them, which is why only new packages are checked.)

- [ ] **Step 3: Replace `jsconfig.json` with `tsconfig.json`**

Run: `git mv jsconfig.json tsconfig.json`

Then replace its whole content:

```json
{
	"compilerOptions": {
		"target": "ESNext",
		"module": "ESNext",
		"moduleResolution": "Bundler",
		"lib": ["ESNext", "DOM"],
		"allowJs": true,
		"checkJs": false,
		"strict": true,
		"isolatedModules": true,
		"skipLibCheck": true,
		"noEmit": true
	},
	"include": [
		"src/**/*",
		"shared/**/*",
		"tests/**/*",
		"scripts/**/*",
		"design-system/**/*",
		"*.js",
		"*.mjs"
	],
	"exclude": ["node_modules", "dist"]
}
```

Why each new option: `strict` is TypeScript 7's default, written out so nobody has to know that. `isolatedModules` makes `tsc` flag code that Vite's per-file type stripping can't compile. `skipLibCheck` skips checking `node_modules` type files, which are not mine to fix. `noEmit` means a bare `tsc` can never write `.js` files next to the sources.

Run: `npx tsc --noEmit`
Expected: no output, exit code 0. (No `.ts` files exist yet, and JavaScript is not checked.)

- [ ] **Step 4: Add `tsc` to `npm run check`**

In `package.json`, change the `check` script:

```json
		"check": "biome check . && tsc --noEmit",
```

Run: `npm run check`
Expected: Biome reports no errors, then `tsc` prints nothing. Exit code 0.

- [ ] **Step 5: Commit the toolchain**

```bash
git add package.json package-lock.json tsconfig.json scripts/check-licences.mjs
git commit -m "build: type-check with TypeScript 7, tsconfig replaces jsconfig"
```

`git mv` in Step 3 already staged the rename. `git status` before the commit shows `renamed: jsconfig.json -> tsconfig.json` (or a delete plus a new file if the content changed too much for git to pair them; both are fine).

- [ ] **Step 6: Let Vitest find `.ts` tests**

Replace `vitest.config.js`:

```js
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["./tests/setup.js"],
		// Client tests and the Worker's pure logic. The Worker handler tests in
		// api/test/workers/ need Cloudflare's runtime and a Neon branch, so they
		// run through vitest.workers.config.ts, locally only, never here.
		include: ["tests/**/*.test.{js,ts}", "api/test/**/*.test.ts"],
		exclude: [...configDefaults.exclude, "api/test/workers/**"],
	},
});
```

Run: `npm run test:run`
Expected: PASS, with the same test count as before this change. No `.ts` tests exist yet. Note the count for Step 18.

- [ ] **Step 7: Write the failing protocol test**

`tests/shared/protocol.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from "vitest";
import {
	CLOCK_SKEW_MS,
	EPOCH,
	keyOf,
	MAX_BODY_BYTES,
	MAX_CHANGES,
	PROTOCOL_VERSION,
	PULL_LIMIT,
	type PushRequest,
	STORES,
	type Store,
	SYNCED_STORES,
} from "../../shared/protocol";

describe("shared protocol", () => {
	it("names the four synced stores", () => {
		expect(STORES).toEqual(["areas", "sections", "tasks", "settings"]);
		expect(SYNCED_STORES).toBe(STORES);
		// Checked by tsc --noEmit (npm run check), not at runtime.
		expectTypeOf<Store>().toEqualTypeOf<
			"areas" | "sections" | "tasks" | "settings"
		>();
	});

	it("builds a key as store:id", () => {
		expect(keyOf("tasks", "t1")).toBe("tasks:t1");
		expect(keyOf("settings", "app")).toBe("settings:app");
	});

	it("keeps everything after the first colon as the id", () => {
		// Anything that splits a key must split at the first colon only.
		expect(keyOf("tasks", "a:b")).toBe("tasks:a:b");
	});

	it("puts EPOCH at the Unix epoch, so any real edit is newer", () => {
		expect(new Date(EPOCH).getTime()).toBe(0);
		expect(new Date(EPOCH).toISOString()).toBe(EPOCH);
	});

	it("matches the limits in the spec", () => {
		expect(PROTOCOL_VERSION).toBe(1); // §5.3
		expect(MAX_CHANGES).toBe(200); // §5.3, §6.1
		expect(MAX_BODY_BYTES).toBe(1_000_000); // §5.3
		expect(PULL_LIMIT).toBe(500); // §6.2
		expect(CLOCK_SKEW_MS).toBe(5_000); // §6.1
		expectTypeOf<PushRequest["protocol"]>().toEqualTypeOf<1>();
	});
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest run tests/shared`
Expected: FAIL. The import of `../../shared/protocol` cannot be resolved.

- [ ] **Step 9: Write `shared/protocol.ts`**

The CONTRACT block, as Biome formats it:

```ts
// The sync protocol, shared by the client (src/sync/) and the Worker (api/).
// Types and constants only. Nothing here imports anything, so this file can
// never pull server code into the client bundle or client code into the Worker.

export const PROTOCOL_VERSION = 1;
export const STORES = ["areas", "sections", "tasks", "settings"] as const;
export type Store = (typeof STORES)[number];
export const SYNCED_STORES = STORES;
export const EPOCH = "1970-01-01T00:00:00.000Z";
export const MAX_CHANGES = 200;
export const MAX_BODY_BYTES = 1_000_000;
export const PULL_LIMIT = 500;
export const CLOCK_SKEW_MS = 5_000;
export const keyOf = (store: Store, id: string): string => `${store}:${id}`;

export type Row = Record<string, unknown>;
export type PutChange = { store: Store; id: string; op: "put"; record: Row };
export type DeleteChange = {
	store: Store;
	id: string;
	op: "delete";
	deletedAt: string;
};
export type Change = PutChange | DeleteChange;
export type PushRequest = {
	protocol: typeof PROTOCOL_VERSION;
	changes: Change[];
};

// What the server holds for one key.
export type ServerVersion =
	| { store: Store; id: string; kind: "row"; record: Row }
	| { store: Store; id: string; kind: "tombstone"; deletedAt: string }
	| { store: Store; id: string; kind: "none" };

// accepted: keys (keyOf). lost: the winner (row or tombstone). invalid: the key
// plus the server's current version (row, tombstone or none). An invalid change
// whose store/id cannot even be read is dropped by the server silently; it has
// no key to report.
export type PushResponse = {
	accepted: string[];
	lost: ServerVersion[];
	invalid: ServerVersion[];
};

export type PulledChange =
	| { store: Store; id: string; seq: number; kind: "row"; record: Row }
	| {
			store: Store;
			id: string;
			seq: number;
			kind: "tombstone";
			deletedAt: string;
	  };
export type PullResponse = {
	changes: PulledChange[];
	cursor: number;
	more: boolean;
};
```

- [ ] **Step 10: Run the tests and the checks**

Run: `npx vitest run tests/shared && npm run check`
Expected: PASS (5 tests), then Biome and `tsc --noEmit` clean. `tsc` is what enforces the two `expectTypeOf` lines, because they do nothing at runtime: delete `| "settings"` from the union in the test and `npm run check` goes red while Vitest stays green. Put it back.

- [ ] **Step 11: Commit the protocol**

```bash
git add vitest.config.js shared/protocol.ts tests/shared/protocol.test.ts
git commit -m "feat(shared): sync protocol types and constants for client and Worker"
```

- [ ] **Step 12: Measure the baseline**

The baseline is the client JS before any sync code. Nothing in Tasks 0 to 2 touches the client, so this branch builds exactly what `main` builds. Prove it first:

Run: `git diff --stat main -- src index.html main.css public design-system vite.config.js`
Expected: no output.

Run: `git rev-parse --short main`
Expected: a commit SHA (`86d2f83` on 2026-09-30). Note it for the comment in Step 15.

Then build and measure with the same rule the gate will use (gzip level 9, `.js` files in `dist/assets`):

```bash
npx vite build
node --input-type=module -e "import { readdirSync, readFileSync } from 'node:fs'; import { gzipSync } from 'node:zlib'; let t = 0; for (const f of readdirSync('dist/assets')) if (f.endsWith('.js')) t += gzipSync(readFileSync('dist/assets/' + f), { level: 9 }).length; console.log(t);"
```

Expected: one integer, around 20 000 (the 2026-09-24 build measured 19 958; Vite prints the same bundle as about 20 kB gzip). Note it for Step 15.

- [ ] **Step 13: Write the failing gate tests**

`tests/scripts/check-bundle.test.js`:

```js
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
	BASELINE_BYTES,
	BUDGET_BYTES,
	gzipTotal,
	overBudget,
} from "../../scripts/bundle-size.mjs";

const CLI = fileURLToPath(
	new URL("../../scripts/check-bundle.mjs", import.meta.url),
);

let dirs = [];
function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "ignite-bundle-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	dirs = [];
});

const gz = (text) => gzipSync(text, { level: 9 }).length;

describe("gzipTotal", () => {
	it("sums the gzipped size of every .js file", () => {
		const dir = tempDir();
		const a = "export const a = 1;\n".repeat(50);
		const b = "console.log('b');\n";
		writeFileSync(join(dir, "index-abc.js"), a);
		writeFileSync(join(dir, "chunk-def.js"), b);
		expect(gzipTotal(dir)).toBe(gz(a) + gz(b));
	});

	it("ignores source maps, CSS and fonts", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "index-abc.js"), "export {};\n");
		writeFileSync(join(dir, "index-abc.js.map"), "{}".repeat(1000));
		writeFileSync(join(dir, "index-abc.css"), "a{}".repeat(1000));
		writeFileSync(join(dir, "font.woff2"), randomBytes(1000));
		expect(gzipTotal(dir)).toBe(gz("export {};\n"));
	});
});

describe("overBudget", () => {
	it("allows growth up to exactly the budget", () => {
		expect(overBudget(20_000 + 10_240, 20_000, 10_240)).toBe(false);
	});

	it("fails one byte past it", () => {
		expect(overBudget(20_000 + 10_241, 20_000, 10_240)).toBe(true);
	});

	it("defaults to the measured baseline and a 10 240-byte budget", () => {
		expect(BUDGET_BYTES).toBe(10_240);
		expect(overBudget(BASELINE_BYTES + BUDGET_BYTES)).toBe(false);
		expect(overBudget(BASELINE_BYTES + BUDGET_BYTES + 1)).toBe(true);
	});

	it("pins the baseline measured before any sync code", () => {
		// Step 12's number. Raising it would quietly grow the budget, so it
		// changes only with my yes (R2), and this test makes that a visible edit.
		expect(BASELINE_BYTES).toBe(19_958);
	});
});

describe("check-bundle command", () => {
	const run = (dir) =>
		spawnSync(process.execPath, [CLI, dir], { encoding: "utf8" });

	it("passes a bundle inside the budget", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "index.js"), "export const a = 1;\n");
		const result = run(dir);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Bundle gate:");
	});

	it("exits 1 when the bundle is over the limit", () => {
		const dir = tempDir();
		// Random bytes don't compress, so the gzipped size stays over the limit.
		writeFileSync(
			join(dir, "index.js"),
			randomBytes(BASELINE_BYTES + BUDGET_BYTES + 5_000),
		);
		const result = run(dir);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("over the limit");
	});

	it("exits 1 when there is no JS, so a missing build can't pass", () => {
		const result = run(tempDir());
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("no JS files");
	});
});
```

The last two tests run the real command in a child process. They are the proof that the gate can go red, and that it never passes by measuring nothing.

In "pins the baseline measured before any sync code", replace `19_958` with the integer Step 12 printed, written with an underscore before the last three digits as in `bundle-size.mjs`. The two numbers must be the same one, so a later edit to `BASELINE_BYTES` alone turns this test red.

- [ ] **Step 14: Run them to verify they fail**

Run: `npx vitest run tests/scripts`
Expected: FAIL. The import of `../../scripts/bundle-size.mjs` cannot be resolved.

- [ ] **Step 15: Write the gate**

`scripts/bundle-size.mjs`. Three values in it come from Step 12 and must be replaced: `19_958` becomes Step 12's number, `86d2f83` becomes Step 12's SHA, and `2026-09-30` becomes today's date (`date +"%Y-%m-%d"`). The values shown are real but stale: 19 958 was measured on 2026-09-30 from a build made on 2026-09-24, before PRs #27 and #28.

```js
// scripts/bundle-size.mjs: the pure half of the bundle gate (spec R2, §10).
// scripts/check-bundle.mjs is the command that runs it. The two are split so
// the tests can import these functions without running the gate.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// Gzipped JS in dist/assets before any sync or auth code existed: gzipTotal()
// over a `vite build` of main at 86d2f83 (PR #28), measured 2026-09-30.
// To re-measure: `npx vite build`, then `node scripts/check-bundle.mjs` and
// read the first number it prints.
export const BASELINE_BYTES = 19_958;

// Spec R2: sync and auth may add at most 10 kB gzipped to the client JS.
export const BUDGET_BYTES = 10_240;

// Gzip level 9 on every .js file directly in dir. Source maps, CSS and fonts
// are not client JS, so they don't count.
export function gzipTotal(dir) {
	let total = 0;
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".js")) continue;
		total += gzipSync(readFileSync(join(dir, name)), { level: 9 }).length;
	}
	return total;
}

// Exactly baseline + budget still passes. One byte more fails.
export function overBudget(
	bytes,
	baseline = BASELINE_BYTES,
	budget = BUDGET_BYTES,
) {
	return bytes > baseline + budget;
}
```

`scripts/check-bundle.mjs`:

```js
// scripts/check-bundle.mjs: the bundle-size gate (spec R2, §10).
// `npm run build` runs it after `vite build`, so a client bundle that grew past
// the budget fails the build locally and in CI.
// Usage: node scripts/check-bundle.mjs [dir]   (dir defaults to dist/assets)
import {
	BASELINE_BYTES,
	BUDGET_BYTES,
	gzipTotal,
	overBudget,
} from "./bundle-size.mjs";

const dir = process.argv[2] ?? "dist/assets";
const total = gzipTotal(dir);
const limit = BASELINE_BYTES + BUDGET_BYTES;

if (total === 0) {
	// A missing build must never pass the gate by measuring nothing.
	console.error(`Bundle gate: no JS files in ${dir}. Run vite build first.`);
	process.exitCode = 1;
} else if (overBudget(total)) {
	console.error(
		`Bundle gate: ${total} bytes of gzipped JS is over the limit of ${limit} (baseline ${BASELINE_BYTES} + budget ${BUDGET_BYTES}). See spec R2.`,
	);
	process.exitCode = 1;
} else {
	console.log(
		`Bundle gate: ${total} of ${limit} bytes of gzipped JS (${limit - total} left).`,
	);
}
```

- [ ] **Step 16: Run the tests**

Run: `npx vitest run tests/scripts tests/shared`
Expected: PASS, 14 tests (9 for the gate, 5 for the protocol).

- [ ] **Step 17: Put the gate into `npm run build`**

In `package.json`, change the `build` script:

```json
		"build": "vite build && node scripts/check-bundle.mjs",
```

Run: `npm run build`
Expected: Vite's usual output, then as the last line `Bundle gate: B of L bytes of gzipped JS (10240 left).`, where **B is exactly Step 12's number** and L is B + 10 240. If B differs from Step 12, the one-liner and `gzipTotal` disagree: stop and find out why before going on.

- [ ] **Step 18: Run everything CI runs**

Run: `npm run check && npm run test:run && npm run build`
Expected: Biome and `tsc` clean; all tests pass (Step 6's count plus 14); the gate line from Step 17.

- [ ] **Step 19: Commit the gate**

```bash
git add scripts/bundle-size.mjs scripts/check-bundle.mjs tests/scripts/check-bundle.test.js package.json
git commit -m "build: fail the build when gzipped client JS grows past the 10 kB budget"
```


---

### Task 3: IndexedDB version 2

The outbox and meta stores, a transaction that spans several stores, and an upgrade that waits for other tabs instead of failing the boot. Spec §4.1.

**Files:**
- Modify: `src/model/db.js` (whole file)
- Modify: `tests/unit/db.test.js` (the "schema v1" describe block)
- Create: `tests/unit/db-v2.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `openDB(name?: string, options?: { onBlocked?: () => void; onVersionChange?: () => void }) → Promise<DBWrapper>`. `onVersionChange` runs after the connection closed itself for a newer version. From then on every write rejects with `InvalidStateError`, so the caller must tell the user to reload (Task 15).
  - `DBWrapper.transact(storeNames: string | string[], mode: "readonly" | "readwrite", fn: (t: TxHandle) => Promise<T> | T) → Promise<T>`. Resolves on commit with `fn`'s return value. `TxHandle` = `{ get(store, key), getAll(store), getByIndex(store, index, value), put(store, value), delete(store, key), clear(store) }`, each returning a promise of the request result. **Inside `fn`, only await `t.*` calls.** Awaiting anything else (a `fetch`, a timer) lets the transaction auto-commit, and the next `t.*` call throws `TransactionInactiveError`.
  - New stores: `outbox` (keyPath `key`), `meta` (keyPath `id`).
  - `export const DB_VERSION = 2`.

- [ ] **Step 1: Update the v1 schema test and write the failing v2 tests**

In `tests/unit/db.test.js`, change the describe title and the store assertion:

```js
describe("openDB: schema", () => {
	it("creates the six object stores", async () => {
		const db = await fresh();
		const names = Array.from(db.raw.objectStoreNames).sort();
		expect(names).toEqual([
			"areas",
			"meta",
			"outbox",
			"sections",
			"settings",
			"tasks",
		]);
	});
```

Create `tests/unit/db-v2.test.js`:

```js
import { afterEach, describe, expect, it } from "vitest";
import { DB_VERSION, openDB } from "../../src/model/db.js";

let openHandles = [];
const uniqueName = () => `ignite-test-${crypto.randomUUID()}`;

afterEach(() => {
	for (const db of openHandles) db.close();
	openHandles = [];
});

// Opens a raw version-1 database the way v0.9.0 did, with no onversionchange
// handler, so it blocks an upgrade exactly like an old tab would.
function openV1Raw(name) {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			db.createObjectStore("areas", { keyPath: "id" });
			db.createObjectStore("sections", { keyPath: "id" });
			const tasks = db.createObjectStore("tasks", { keyPath: "id" });
			tasks.createIndex("sectionId", "sectionId");
			tasks.createIndex("dueAt", "dueAt");
			tasks.createIndex("completed", "completed");
			tasks.createIndex("starred", "starred");
			db.createObjectStore("settings", { keyPath: "id" });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

describe("openDB: version 2 upgrade", () => {
	it("is version 2", () => {
		expect(DB_VERSION).toBe(2);
	});

	it("keeps version 1 rows through the upgrade", async () => {
		const name = uniqueName();
		const v1 = await openV1Raw(name);
		await new Promise((resolve, reject) => {
			const tx = v1.transaction("tasks", "readwrite");
			tx.objectStore("tasks").put({ id: "t1", title: "Keep me" });
			tx.oncomplete = resolve;
			tx.onerror = () => reject(tx.error);
		});
		v1.close();

		const db = await openDB(name);
		openHandles.push(db);
		expect((await db.get("tasks", "t1")).title).toBe("Keep me");
		expect(Array.from(db.raw.objectStoreNames)).toContain("outbox");
	});

	it("waits (does not reject) while a version 1 tab holds the database open", async () => {
		const name = uniqueName();
		const v1 = await openV1Raw(name);
		let blockedCalls = 0;
		const opening = openDB(name, { onBlocked: () => blockedCalls++ });

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(blockedCalls).toBe(1);

		v1.close(); // the old tab goes away
		const db = await opening;
		openHandles.push(db);
		expect(Array.from(db.raw.objectStoreNames)).toContain("meta");
	});

	it("closes itself when a newer version asks, so it never blocks one", async () => {
		const name = uniqueName();
		const db = await openDB(name);
		openHandles.push(db);
		const v3 = await new Promise((resolve, reject) => {
			const req = indexedDB.open(name, 3);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
			req.onblocked = () => reject(new Error("blocked by the v2 connection"));
		});
		v3.close();
	});

	it("tells the app after it closed for a newer version", async () => {
		const name = uniqueName();
		let versionChanges = 0;
		const db = await openDB(name, {
			onVersionChange: () => versionChanges++,
		});
		openHandles.push(db);
		const v3 = await new Promise((resolve, reject) => {
			const req = indexedDB.open(name, 3);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		v3.close();
		// Without the callback a typed task would vanish: the closed connection
		// rejects every later write, and nothing on screen says so.
		expect(versionChanges).toBe(1);
		await expect(db.put("tasks", { id: "t1" })).rejects.toThrow();
	});
});

describe("transact", () => {
	it("commits writes to several stores together", async () => {
		const db = await openDB(uniqueName());
		openHandles.push(db);
		await db.transact(["tasks", "outbox"], "readwrite", async (t) => {
			await t.put("tasks", { id: "t1", title: "A" });
			await t.put("outbox", {
				key: "tasks:t1",
				store: "tasks",
				id: "t1",
				op: "put",
				rev: 1,
			});
		});
		expect(await db.get("tasks", "t1")).toBeDefined();
		expect(await db.get("outbox", "tasks:t1")).toBeDefined();
	});

	it("rolls back every store when fn throws", async () => {
		const db = await openDB(uniqueName());
		openHandles.push(db);
		await expect(
			db.transact(["tasks", "outbox"], "readwrite", async (t) => {
				await t.put("tasks", { id: "t1", title: "A" });
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await db.get("tasks", "t1")).toBeUndefined();
	});

	it("resolves with fn's return value after commit", async () => {
		const db = await openDB(uniqueName());
		openHandles.push(db);
		const value = await db.transact("meta", "readwrite", async (t) => {
			await t.put("meta", { id: "sync", mode: "local" });
			return (await t.get("meta", "sync")).mode;
		});
		expect(value).toBe("local");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/db.test.js tests/unit/db-v2.test.js`
Expected: FAIL. `DB_VERSION` is not exported, the store list has four entries, and `db.transact` is not a function.

- [ ] **Step 3: Rewrite `src/model/db.js`**

```js
// Thin promise wrapper over IndexedDB. Exposes:
//   openDB(name?, { onBlocked?, onVersionChange? }) → Promise<DBWrapper>
//   wrapper.get(store, id)
//   wrapper.getAll(store)
//   wrapper.getByIndex(store, indexName, value)
//   wrapper.put(store, record)
//   wrapper.delete(store, id)
//   wrapper.transact(storeNames, mode, fn)   // one transaction across stores
//   wrapper.close()
//   wrapper.raw       // underlying IDBDatabase, for tests/diagnostics only

const DEFAULT_NAME = "ignite";
export const DB_VERSION = 2;

export function openDB(
	name = DEFAULT_NAME,
	{ onBlocked, onVersionChange } = {},
) {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, DB_VERSION);
		req.onupgradeneeded = (event) => {
			runUpgrade(req.result, event.oldVersion);
		};
		req.onsuccess = () => {
			const db = req.result;
			// A newer version (another tab after a deploy) is waiting on this
			// connection. Closing it lets that upgrade run instead of blocking it.
			// Every later write on this tab then rejects with InvalidStateError, so
			// onVersionChange lets the UI say "reload" instead of losing a task.
			db.onversionchange = () => {
				db.close();
				onVersionChange?.();
			};
			resolve(wrap(db));
		};
		req.onerror = () => reject(req.error);
		// Another tab still runs older code and holds the database open. Rejecting
		// here would fail the boot. Waiting lets the open finish the moment that
		// tab closes; onBlocked lets the UI ask the user to close it.
		req.onblocked = () => onBlocked?.();
	});
}

function runUpgrade(db, oldVersion) {
	if (oldVersion < 1) {
		db.createObjectStore("areas", { keyPath: "id" });
		db.createObjectStore("sections", { keyPath: "id" });
		const tasks = db.createObjectStore("tasks", { keyPath: "id" });
		tasks.createIndex("sectionId", "sectionId");
		tasks.createIndex("dueAt", "dueAt");
		tasks.createIndex("completed", "completed");
		tasks.createIndex("starred", "starred");
		db.createObjectStore("settings", { keyPath: "id" });
	}
	if (oldVersion < 2) {
		// Sync bookkeeping. The outbox holds keys ("tasks:<id>") plus a rev, never
		// copies of rows; meta holds the single { id: "sync" } record.
		db.createObjectStore("outbox", { keyPath: "key" });
		db.createObjectStore("meta", { keyPath: "id" });
	}
}

// Runs fn inside ONE transaction over storeNames and resolves on COMMIT with
// fn's return value. Resolving on commit, not on request success, is what makes
// a write durable: tx.onerror/onabort surface commit-time failures (quota) that
// would otherwise be swallowed.
//
// fn must only await t.* calls. Awaiting anything else lets the transaction
// auto-commit, and the next t.* call throws TransactionInactiveError.
function transact(db, storeNames, mode, fn) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(storeNames, mode);
		const request = (req) =>
			new Promise((res, rej) => {
				req.onsuccess = () => res(req.result);
				req.onerror = () => rej(req.error);
			});
		const t = {
			get: (store, key) => request(tx.objectStore(store).get(key)),
			getAll: (store) => request(tx.objectStore(store).getAll()),
			getByIndex: (store, indexName, value) =>
				request(tx.objectStore(store).index(indexName).getAll(value)),
			put: (store, value) => request(tx.objectStore(store).put(value)),
			delete: (store, key) => request(tx.objectStore(store).delete(key)),
			clear: (store) => request(tx.objectStore(store).clear()),
		};
		let result;
		let failed = false;
		// The microtask runs before control returns to the event loop, so the
		// transaction is still active for fn's first request.
		Promise.resolve()
			.then(() => fn(t))
			.then(
				(value) => {
					result = value;
				},
				(err) => {
					failed = true;
					try {
						tx.abort();
					} catch {
						// already finished; the rejection below still reports err
					}
					reject(err);
				},
			);
		tx.oncomplete = () => resolve(result);
		tx.onerror = () => {
			if (!failed) reject(tx.error);
		};
		tx.onabort = () => {
			if (!failed)
				reject(
					tx.error ??
						new Error(
							`Transaction aborted on "${[storeNames].flat().join(", ")}"`,
						),
				);
		};
	});
}

function wrap(db) {
	return {
		raw: db,
		close: () => db.close(),
		transact: (storeNames, mode, fn) => transact(db, storeNames, mode, fn),
		get: (store, id) =>
			transact(db, store, "readonly", (t) => t.get(store, id)),
		getAll: (store) => transact(db, store, "readonly", (t) => t.getAll(store)),
		getByIndex: (store, indexName, value) =>
			transact(db, store, "readonly", (t) =>
				t.getByIndex(store, indexName, value),
			),
		put: (store, record) =>
			transact(db, store, "readwrite", (t) => t.put(store, record)),
		delete: (store, id) =>
			transact(db, store, "readwrite", (t) => t.delete(store, id)),
	};
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npm run test:run`
Expected: PASS, every existing model test included. The models only use `get/getAll/getByIndex/put/delete`, and their behaviour is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/model/db.js tests/unit/db.test.js tests/unit/db-v2.test.js
git commit -m "feat(db): version 2 with outbox and meta stores, multi-store transactions"
```

---

### Task 4: Wire records and the pure sync rules

Everything about sync that needs no database and no network: turning a stored row into what the server accepts and back, the settings rule, the seed rule, batch splitting, and the status line text. Spec §4.3, §4.4, §5.3, §6.1, §7, §10 (first bullet).

**Files:**
- Create: `src/sync/records.ts`, `src/sync/rules.ts`, `src/sync/status.ts`
- Test: `tests/sync/records.test.ts`, `tests/sync/rules.test.ts`, `tests/sync/status.test.ts`

**Interfaces:**
- Consumes (Task 2, `shared/protocol.ts`): `Store`, `Change`, `MAX_CHANGES`, `MAX_BODY_BYTES`, `EPOCH`.
- Produces:
  - `toWire(store: Store, row: Row): Row` and `fromWire(store: Store, record: Row): Row` (records.ts), where `Row = Record<string, unknown>`
  - `mergeSettings(local: Row | undefined, remote: Row): Row` (records.ts)
  - `quietChanged(prev: Row | undefined, next: Row): boolean` (rules.ts)
  - `isSeedOnly(local: { areas: { id: string }[]; sections: { id: string }[]; tasks: unknown[] }): boolean` (rules.ts)
  - `splitBatches(changes: Change[], maxChanges?: number, maxBytes?: number): Change[][]` (rules.ts)
  - `type SyncStatus`, `statusText(status: SyncStatus, now: Date): string`, `needsAttention(status: SyncStatus): boolean` (status.ts)

**Why the serializer picks fields instead of sending the row:** the server's schemas are strict (§5.3) and reject unknown keys. Rows written by older versions of Ignite can carry fields that no longer exist, or lack ones added since (`hasTime`, `leadTime` and `scheduledTags` arrived after M1). Forwarding the raw row would turn every old task into an `invalid` change. `toWire` builds the record from a fixed field list and fills the defaults the task model itself uses in `create()`.

- [ ] **Step 1: Write the failing tests**

`tests/sync/records.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EPOCH } from "../../shared/protocol";
import { fromWire, mergeSettings, toWire } from "../../src/sync/records";

const storedTask = {
	id: "t1",
	sectionId: "s1",
	title: "A",
	notes: "n",
	completed: 0,
	starred: 1,
	critical: 0,
	dueAt: "2026-10-01T08:00:00.000Z",
	hasTime: 1,
	recurrence: { type: "daily", interval: 1 },
	lastCompletedAt: null,
	completedCount: 2,
	leadTime: 15,
	scheduledTags: ["x"],
	createdAt: "2026-01-01T00:00:00.000Z",
	order: 4,
	updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("toWire", () => {
	it("turns the task model's 0/1 flags into booleans", () => {
		const wire = toWire("tasks", storedTask);
		expect(wire.completed).toBe(false);
		expect(wire.starred).toBe(true);
		expect(wire.hasTime).toBe(true);
	});

	it("drops fields the server does not know", () => {
		const wire = toWire("areas", {
			id: "a1",
			name: "Home",
			icon: "",
			critical: false,
			order: 0,
			updatedAt: "2026-01-02T00:00:00.000Z",
			legacyField: "x",
		});
		expect(wire).not.toHaveProperty("legacyField");
	});

	it("fills defaults for a task written before hasTime, leadTime and scheduledTags existed", () => {
		const wire = toWire("tasks", {
			id: "t1",
			sectionId: "s1",
			title: "Old",
			completed: 0,
			starred: 0,
			critical: 0,
			dueAt: null,
			order: 3,
			createdAt: "2026-04-20T10:00:00.000Z",
		});
		expect(wire).toMatchObject({
			notes: "",
			hasTime: false,
			recurrence: null,
			lastCompletedAt: null,
			completedCount: 0,
			leadTime: 0,
			scheduledTags: [],
			updatedAt: EPOCH,
		});
	});

	it("sends only the synced settings fields", () => {
		const wire = toWire("settings", {
			id: "app",
			quietStart: 22,
			quietEnd: 6,
			theme: "dark",
			sidebarCollapsed: true,
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
		expect(wire).toEqual({
			id: "app",
			quietStart: 22,
			quietEnd: 6,
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
	});
});

describe("fromWire", () => {
	it("turns task booleans back into 0/1 for IndexedDB", () => {
		const row = fromWire("tasks", {
			id: "t1",
			completed: true,
			starred: false,
			critical: false,
			hasTime: true,
		});
		expect(row).toMatchObject({ completed: 1, starred: 0, critical: 0, hasTime: 1 });
	});

	it("round-trips a stored task unchanged", () => {
		expect(fromWire("tasks", toWire("tasks", storedTask))).toEqual(storedTask);
	});
});

describe("mergeSettings", () => {
	it("takes only the quiet hours and updatedAt from the account", () => {
		const local = {
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "light",
			sidebarCollapsed: true,
			updatedAt: EPOCH,
		};
		const merged = mergeSettings(local, {
			id: "app",
			quietStart: 21,
			quietEnd: 8,
			updatedAt: "2026-02-01T00:00:00.000Z",
		});
		expect(merged).toEqual({
			id: "app",
			quietStart: 21,
			quietEnd: 8,
			theme: "light",
			sidebarCollapsed: true,
			updatedAt: "2026-02-01T00:00:00.000Z",
		});
	});
});
```

`tests/sync/rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Change } from "../../shared/protocol";
import { isSeedOnly, quietChanged, splitBatches } from "../../src/sync/rules";

describe("quietChanged", () => {
	it("is false when only the theme changed", () => {
		expect(
			quietChanged(
				{ quietStart: 23, quietEnd: 7, theme: "dark" },
				{ quietStart: 23, quietEnd: 7, theme: "light" },
			),
		).toBe(false);
	});
	it("is true when a quiet hour changed", () => {
		expect(
			quietChanged({ quietStart: 23, quietEnd: 7 }, { quietStart: 22, quietEnd: 7 }),
		).toBe(true);
	});
	it("is false for the first write of the row (the seed)", () => {
		expect(quietChanged(undefined, { quietStart: 23, quietEnd: 7 })).toBe(false);
	});
});

describe("isSeedOnly", () => {
	it("is true for a fresh install", () => {
		expect(
			isSeedOnly({
				areas: [{ id: "focus" }],
				sections: [{ id: "focus-default" }],
				tasks: [],
			}),
		).toBe(true);
	});
	it("is false once there is one task, even in the seeded section", () => {
		expect(
			isSeedOnly({
				areas: [{ id: "focus" }],
				sections: [{ id: "focus-default" }],
				tasks: [{}],
			}),
		).toBe(false);
	});
	it("is false with a user-made area and no tasks", () => {
		expect(
			isSeedOnly({
				areas: [{ id: "focus" }, { id: "a1" }],
				sections: [{ id: "focus-default" }],
				tasks: [],
			}),
		).toBe(false);
	});
});

const put = (id: string, title = "x"): Change => ({
	store: "tasks",
	id,
	op: "put",
	record: { id, title },
});

describe("splitBatches", () => {
	it("splits at the change count", () => {
		const changes = Array.from({ length: 450 }, (_, i) => put(`t${i}`));
		expect(splitBatches(changes, 200, 1_000_000).map((b) => b.length)).toEqual([
			200, 200, 50,
		]);
	});
	it("counts bytes as UTF-8, not string length", () => {
		const big = "é".repeat(300_000); // 600 kB as UTF-8
		const changes = [put("a", big), put("b", big), put("c")];
		expect(splitBatches(changes, 200, 1_000_000).map((b) => b.length)).toEqual([
			1, 2,
		]);
	});
	it("puts one oversized change in a batch of its own", () => {
		const changes = [put("a"), put("huge", "x".repeat(2_000_000)), put("b")];
		expect(
			splitBatches(changes, 200, 1_000_000).map((b) => b.map((c) => c.id)),
		).toEqual([["a"], ["huge"], ["b"]]);
	});
	it("returns no batches for no changes", () => {
		expect(splitBatches([], 200, 1_000_000)).toEqual([]);
	});
});
```

`tests/sync/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { needsAttention, statusText } from "../../src/sync/status";

const now = new Date("2026-10-01T12:00:00.000Z");

describe("statusText", () => {
	it("says how long ago the last sync was", () => {
		expect(statusText({ kind: "synced", at: "2026-10-01T11:58:00.000Z" }, now)).toBe(
			"Synced 2 min ago",
		);
		expect(statusText({ kind: "synced", at: "2026-10-01T11:59:40.000Z" }, now)).toBe(
			"Synced just now",
		);
	});
	it("counts waiting changes when offline", () => {
		expect(statusText({ kind: "offline", pending: 3 }, now)).toBe(
			"Offline, 3 changes waiting",
		);
		expect(statusText({ kind: "offline", pending: 1 }, now)).toBe(
			"Offline, 1 change waiting",
		);
	});
	it("has the fixed copy for the other states", () => {
		expect(statusText({ kind: "syncing" }, now)).toBe("Syncing…");
		expect(statusText({ kind: "needs-sign-in" }, now)).toBe("Sign in again to sync");
		expect(statusText({ kind: "needs-reload" }, now)).toBe(
			"Ignite has updated. Reload to keep syncing.",
		);
		expect(statusText({ kind: "invalid", count: 1 }, now)).toBe(
			"1 change couldn't sync",
		);
		expect(statusText({ kind: "invalid", count: 2 }, now)).toBe(
			"2 changes couldn't sync",
		);
	});
});

describe("needsAttention", () => {
	it("flags only the states the user must act on", () => {
		expect(needsAttention({ kind: "needs-sign-in" })).toBe(true);
		expect(needsAttention({ kind: "needs-reload" })).toBe(true);
		expect(needsAttention({ kind: "invalid", count: 1 })).toBe(true);
		expect(needsAttention({ kind: "offline", pending: 2 })).toBe(false);
		expect(needsAttention({ kind: "local" })).toBe(false);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/sync`
Expected: FAIL, "Cannot find module '../../src/sync/records'" (and the same for rules and status).

- [ ] **Step 3: Implement `src/sync/records.ts`**

```ts
// Stored row ↔ wire record. The server's schemas are strict, so the wire record
// is BUILT from a field list with defaults, never forwarded as the stored row.

import { EPOCH, type Store } from "../../shared/protocol";

type Row = Record<string, unknown>;

const TASK_FLAGS = ["completed", "starred", "critical", "hasTime"] as const;

// Field → default when the stored row lacks it (rows from older versions).
// The defaults match createTaskModel().create() and createAreaModel().create().
const FIELDS: Record<Store, Row> = {
	areas: { id: undefined, name: "", icon: "", critical: false, order: 0, updatedAt: EPOCH },
	sections: {
		id: undefined,
		areaId: undefined,
		name: "",
		collapsed: false,
		order: 0,
		updatedAt: EPOCH,
	},
	tasks: {
		id: undefined,
		sectionId: undefined,
		title: "",
		notes: "",
		completed: false,
		starred: false,
		critical: false,
		dueAt: null,
		hasTime: false,
		recurrence: null,
		lastCompletedAt: null,
		completedCount: 0,
		leadTime: 0,
		scheduledTags: [],
		createdAt: undefined,
		order: 0,
		updatedAt: EPOCH,
	},
	settings: { id: undefined, quietStart: 23, quietEnd: 7, updatedAt: EPOCH },
};

export function toWire(store: Store, row: Row): Row {
	const out: Row = {};
	for (const [field, fallback] of Object.entries(FIELDS[store])) {
		out[field] = row[field] ?? fallback;
	}
	if (store === "tasks") {
		for (const flag of TASK_FLAGS) out[flag] = row[flag] === 1 || row[flag] === true;
		// A task from before createdAt existed borrows its edit time.
		out.createdAt ??= out.updatedAt;
	}
	return out;
}

export function fromWire(store: Store, record: Row): Row {
	const out: Row = { ...record };
	if (store === "tasks") {
		for (const flag of TASK_FLAGS) {
			if (flag in out) out[flag] = out[flag] ? 1 : 0;
		}
	}
	return out;
}

// Settings sync only the quiet hours. The theme and the sidebar state belong to
// this device and survive every pull.
export function mergeSettings(local: Row | undefined, remote: Row): Row {
	return {
		...(local ?? { id: remote.id }),
		quietStart: remote.quietStart,
		quietEnd: remote.quietEnd,
		updatedAt: remote.updatedAt,
	};
}
```

- [ ] **Step 4: Implement `src/sync/rules.ts`**

```ts
import { type Change, MAX_BODY_BYTES, MAX_CHANGES } from "../../shared/protocol";

type Row = Record<string, unknown>;

// A settings write queues only when a synced field moved. Without this, a theme
// change would push this device's stale quiet hours with a fresh timestamp.
// The first write of the row (the seed) is not a change.
export function quietChanged(prev: Row | undefined, next: Row): boolean {
	if (!prev) return false;
	return prev.quietStart !== next.quietStart || prev.quietEnd !== next.quietEnd;
}

export function isSeedOnly(local: {
	areas: { id: string }[];
	sections: { id: string }[];
	tasks: unknown[];
}): boolean {
	return (
		local.tasks.length === 0 &&
		local.areas.every((a) => a.id === "focus") &&
		local.sections.every((s) => s.id === "focus-default")
	);
}

const encoder = new TextEncoder();
const sizeOf = (change: Change) => encoder.encode(JSON.stringify(change)).length;

// Splits at maxChanges or maxBytes, whichever comes first. A single change over
// maxBytes gets a batch of its own: the server answers 413 and the engine drops
// it like an invalid change, so it can never jam the queue (spec §8).
export function splitBatches(
	changes: Change[],
	maxChanges = MAX_CHANGES,
	maxBytes = MAX_BODY_BYTES,
): Change[][] {
	const batches: Change[][] = [];
	let current: Change[] = [];
	let bytes = 0;
	for (const change of changes) {
		const size = sizeOf(change);
		if (current.length && (current.length >= maxChanges || bytes + size > maxBytes)) {
			batches.push(current);
			current = [];
			bytes = 0;
		}
		current.push(change);
		bytes += size;
	}
	if (current.length) batches.push(current);
	return batches;
}
```

The byte limit counts the changes, not the `{"protocol":1,"changes":[…]}` envelope around them. The engine (Task 13) passes `MAX_BODY_BYTES - 1024` to keep a margin for it.

- [ ] **Step 5: Implement `src/sync/status.ts`**

```ts
export type SyncStatus =
	| { kind: "local" }
	| { kind: "syncing" }
	| { kind: "synced"; at: string }
	| { kind: "offline"; pending: number }
	| { kind: "needs-sign-in" }
	| { kind: "needs-reload" }
	| { kind: "invalid"; count: number };

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

export function statusText(status: SyncStatus, now: Date): string {
	switch (status.kind) {
		case "local":
			return "Not signed in";
		case "syncing":
			return "Syncing…";
		case "synced": {
			const minutes = Math.floor((now.getTime() - Date.parse(status.at)) / 60_000);
			return minutes < 1 ? "Synced just now" : `Synced ${minutes} min ago`;
		}
		case "offline":
			return `Offline, ${plural(status.pending, "change", "changes")} waiting`;
		case "needs-sign-in":
			return "Sign in again to sync";
		case "needs-reload":
			return "Ignite has updated. Reload to keep syncing.";
		case "invalid":
			return `${plural(status.count, "change", "changes")} couldn't sync`;
	}
}

export function needsAttention(status: SyncStatus): boolean {
	return (
		status.kind === "needs-sign-in" ||
		status.kind === "needs-reload" ||
		status.kind === "invalid"
	);
}
```

- [ ] **Step 6: Run the tests, then the checks**

The blocks above were not run through Biome's formatter, and a few lines are over its 80-column width. Format first, then check.

Run: `npx biome format --write src/sync tests/sync && npx vitest run tests/sync && npm run check`
Expected: PASS, with Biome and `tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add src/sync/records.ts src/sync/rules.ts src/sync/status.ts tests/sync
git commit -m "feat(sync): wire records, sync rules and status text"
```

---

### Task 5: The syncing wrapper

The one seam (D3). Every model write goes through it, gets an `updatedAt`, and in account mode leaves an outbox entry in the same transaction. Spec §4.2, §4.3.

**Files:**
- Create: `src/sync/types.ts`, `src/sync/syncing-db.ts`
- Test: `tests/sync/syncing-db.test.ts`

**Interfaces:**
- Consumes: `openDB` and `DBWrapper.transact` (Task 3), `quietChanged` (Task 4), `EPOCH`, `keyOf`, `SYNCED_STORES` (Task 2).
- Produces:
  - `src/sync/types.ts`: `interface Db` (the typed `DBWrapper`), `interface TxHandle`, `type OutboxEntry = { key: string; store: Store; id: string; op: "put" | "delete"; rev: number; deletedAt?: string }`, `type SyncMeta = { id: "sync"; mode: "local" | "account"; cursor: number; userEmail: string | null; lastSyncedAt: string | null }`, `const LOCAL_META: SyncMeta`.
  - `createSyncingDb(db: Db, options?: { now?: () => Date; onQueued?: () => void }): Db`. Same interface as `db`. `onQueued` fires after a write that queued an outbox entry has committed. The engine's 2-second debounce hangs off it.

- [ ] **Step 1: Write `src/sync/types.ts`** (types only, nothing to test yet)

```ts
import type { Store } from "../../shared/protocol";

export type Row = Record<string, unknown>;

export interface TxHandle {
	get(store: string, key: string): Promise<Row | undefined>;
	getAll(store: string): Promise<Row[]>;
	getByIndex(store: string, index: string, value: unknown): Promise<Row[]>;
	put(store: string, value: Row): Promise<unknown>;
	delete(store: string, key: string): Promise<unknown>;
	clear(store: string): Promise<unknown>;
}

export interface Db {
	raw: IDBDatabase;
	close(): void;
	transact<T>(
		stores: string | string[],
		mode: IDBTransactionMode,
		fn: (t: TxHandle) => Promise<T> | T,
	): Promise<T>;
	get(store: string, id: string): Promise<Row | undefined>;
	getAll(store: string): Promise<Row[]>;
	getByIndex(store: string, index: string, value: unknown): Promise<Row[]>;
	put(store: string, record: Row): Promise<unknown>;
	delete(store: string, id: string): Promise<unknown>;
}

export type OutboxEntry = {
	key: string;
	store: Store;
	id: string;
	op: "put" | "delete";
	rev: number;
	deletedAt?: string;
};

export type SyncMeta = {
	id: "sync";
	mode: "local" | "account";
	cursor: number;
	userEmail: string | null;
	lastSyncedAt: string | null;
};

export const LOCAL_META: SyncMeta = {
	id: "sync",
	mode: "local",
	cursor: 0,
	userEmail: null,
	lastSyncedAt: null,
};
```

`src/model/db.js` is untyped JavaScript. Where a `.ts` file needs a typed handle, cast once at the boundary: `const db = (await openDB()) as Db`.

- [ ] **Step 2: Write the failing tests**

`tests/sync/syncing-db.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { EPOCH } from "../../shared/protocol";
import { openDB } from "../../src/model/db.js";
import { createSyncingDb } from "../../src/sync/syncing-db";
import type { Db, TxHandle } from "../../src/sync/types";

let handles: Db[] = [];
afterEach(() => {
	for (const h of handles) h.close();
	handles = [];
});

const T0 = new Date("2026-10-01T10:00:00.000Z");

async function setup(mode: "local" | "account") {
	const raw = (await openDB(`ignite-test-${crypto.randomUUID()}`)) as Db;
	handles.push(raw);
	await raw.put("meta", {
		id: "sync",
		mode,
		cursor: 0,
		userEmail: null,
		lastSyncedAt: null,
	});
	let queued = 0;
	const db = createSyncingDb(raw, { now: () => T0, onQueued: () => queued++ });
	return { raw, db, queued: () => queued };
}

describe("createSyncingDb: account mode", () => {
	it("stamps updatedAt and queues a put in the same write", async () => {
		const { raw, db, queued } = await setup("account");
		await db.put("tasks", { id: "t1", title: "A" });
		expect((await raw.get("tasks", "t1"))?.updatedAt).toBe(T0.toISOString());
		expect(await raw.get("outbox", "tasks:t1")).toEqual({
			key: "tasks:t1",
			store: "tasks",
			id: "t1",
			op: "put",
			rev: 1,
		});
		expect(queued()).toBe(1);
	});

	it("coalesces ten edits into one entry whose rev counts them", async () => {
		const { raw, db } = await setup("account");
		for (let i = 0; i < 10; i++) await db.put("tasks", { id: "t1", title: `v${i}` });
		const entries = await raw.getAll("outbox");
		expect(entries).toHaveLength(1);
		expect(entries[0].rev).toBe(10);
	});

	it("turns a queued put into a delete, keeping the rev moving", async () => {
		const { raw, db } = await setup("account");
		await db.put("tasks", { id: "t1", title: "A" });
		await db.delete("tasks", "t1");
		expect(await raw.get("tasks", "t1")).toBeUndefined();
		expect(await raw.get("outbox", "tasks:t1")).toEqual({
			key: "tasks:t1",
			store: "tasks",
			id: "t1",
			op: "delete",
			rev: 2,
			deletedAt: T0.toISOString(),
		});
	});

	it("writes nothing when the row's put fails: no entry without its row", async () => {
		const { raw, db } = await setup("account");
		// No keyPath value, so the row's put throws inside the transaction.
		await expect(db.put("tasks", { title: "no id" })).rejects.toBeDefined();
		expect(await raw.getAll("outbox")).toEqual([]);
	});

	it("writes nothing when the outbox put fails: no row without its entry", async () => {
		const { raw, db } = await setup("account");
		const storeLists: string[][] = [];
		const transact = raw.transact;
		// Same transaction, but the second write (the outbox entry) throws.
		raw.transact = <T>(
			stores: string | string[],
			mode: IDBTransactionMode,
			fn: (t: TxHandle) => Promise<T> | T,
		): Promise<T> => {
			storeLists.push([stores].flat());
			return transact(stores, mode, (t) =>
				fn({
					...t,
					put: (store, value) => {
						if (store === "outbox") throw new Error("outbox full");
						return t.put(store, value);
					},
				}),
			);
		};
		try {
			await expect(db.put("tasks", { id: "t1", title: "A" })).rejects.toThrow(
				"outbox full",
			);
		} finally {
			raw.transact = transact;
		}
		expect(await raw.get("tasks", "t1")).toBeUndefined();
		expect(storeLists[0]).toEqual(expect.arrayContaining(["tasks", "outbox"]));
	});

	it("does not queue a settings write that only changed the theme", async () => {
		const { raw, db } = await setup("account");
		await raw.put("settings", {
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "dark",
			updatedAt: "2026-09-01T00:00:00.000Z",
		});
		await db.put("settings", { id: "app", quietStart: 23, quietEnd: 7, theme: "light" });
		expect(await raw.getAll("outbox")).toEqual([]);
		const row = await raw.get("settings", "app");
		expect(row?.theme).toBe("light");
		// Unchanged, so it can't beat a newer quiet-hours edit from another device.
		expect(row?.updatedAt).toBe("2026-09-01T00:00:00.000Z");
	});

	it("queues a settings write that changed quiet hours, with a fresh updatedAt", async () => {
		const { raw, db } = await setup("account");
		await raw.put("settings", {
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "dark",
			updatedAt: "2026-09-01T00:00:00.000Z",
		});
		await db.put("settings", { id: "app", quietStart: 22, quietEnd: 7, theme: "dark" });
		expect((await raw.get("settings", "app"))?.updatedAt).toBe(T0.toISOString());
		expect(await raw.get("outbox", "settings:app")).toBeDefined();
	});

	it("stamps the first settings row (the seed) with EPOCH so it never wins", async () => {
		const { raw, db } = await setup("account");
		await db.put("settings", { id: "app", quietStart: 23, quietEnd: 7 });
		expect((await raw.get("settings", "app"))?.updatedAt).toBe(EPOCH);
		expect(await raw.getAll("outbox")).toEqual([]);
	});
});

describe("createSyncingDb: local mode", () => {
	it("stamps updatedAt and queues nothing", async () => {
		const { raw, db, queued } = await setup("local");
		await db.put("tasks", { id: "t1", title: "A" });
		await db.delete("areas", "a1");
		expect((await raw.get("tasks", "t1"))?.updatedAt).toBe(T0.toISOString());
		expect(await raw.getAll("outbox")).toEqual([]);
		expect(queued()).toBe(0);
	});

	it("treats a missing meta record as local mode", async () => {
		const raw = (await openDB(`ignite-test-${crypto.randomUUID()}`)) as Db;
		handles.push(raw);
		const db = createSyncingDb(raw);
		await db.put("tasks", { id: "t1", title: "A" });
		expect(await raw.getAll("outbox")).toEqual([]);
	});

	it("passes reads straight through", async () => {
		const { raw, db } = await setup("local");
		await raw.put("tasks", { id: "t1", title: "A", sectionId: "s1" });
		expect((await db.get("tasks", "t1"))?.title).toBe("A");
		expect(await db.getByIndex("tasks", "sectionId", "s1")).toHaveLength(1);
	});
});
```

The "row's put fails" test cannot go red on its own: the row put runs before `queue()`, so nothing reaches the outbox whether or not the two writes share a transaction. "the outbox put fails" is the test that holds the seam. Its row put succeeds and the outbox put after it throws, so the row survives only if the two writes are separate. Rewriting `put` as two separate `db.put` calls (row, then outbox entry) turns it red: the row commits on its own, the outbox write no longer goes through `transact`, and no store list holds both `tasks` and `outbox`.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/sync/syncing-db.test.ts`
Expected: FAIL, "Cannot find module '../../src/sync/syncing-db'".

- [ ] **Step 4: Implement `src/sync/syncing-db.ts`**

```ts
// The one seam (spec D3). Models write through this and never know sync exists.
// Reads pass straight through. Writes stamp updatedAt and, in account mode, leave
// an outbox entry in the SAME transaction, so a row never lands without its entry.

import { EPOCH, keyOf, SYNCED_STORES, type Store } from "../../shared/protocol";
import { quietChanged } from "./rules";
import type { Db, OutboxEntry, Row, SyncMeta, TxHandle } from "./types";

const isSynced = (store: string): store is Store =>
	(SYNCED_STORES as readonly string[]).includes(store);

async function queue(
	t: TxHandle,
	store: Store,
	id: string,
	op: "put" | "delete",
	now: string,
) {
	const key = keyOf(store, id);
	const prev = (await t.get("outbox", key)) as OutboxEntry | undefined;
	const entry: OutboxEntry = { key, store, id, op, rev: (prev?.rev ?? 0) + 1 };
	if (op === "delete") entry.deletedAt = now;
	await t.put("outbox", entry);
}

export function createSyncingDb(
	db: Db,
	{
		now = () => new Date(),
		onQueued = () => {},
	}: { now?: () => Date; onQueued?: () => void } = {},
): Db {
	return {
		...db,

		async put(store, record) {
			if (!isSynced(store)) return db.put(store, record);
			const stamp = now().toISOString();
			const didQueue = await db.transact(
				[store, "outbox", "meta"],
				"readwrite",
				async (t) => {
					const meta = (await t.get("meta", "sync")) as SyncMeta | undefined;
					const account = meta?.mode === "account";
					let row: Row;
					let shouldQueue = account;
					if (store === "settings") {
						const prev = await t.get("settings", record.id as string);
						const changed = quietChanged(prev, record);
						row = {
							...record,
							updatedAt: changed ? stamp : (prev?.updatedAt ?? EPOCH),
						};
						shouldQueue = account && changed;
					} else {
						row = { ...record, updatedAt: stamp };
					}
					await t.put(store, row);
					if (shouldQueue) await queue(t, store, record.id as string, "put", stamp);
					return shouldQueue;
				},
			);
			if (didQueue) onQueued();
			return record.id;
		},

		async delete(store, id) {
			if (!isSynced(store)) return db.delete(store, id);
			const stamp = now().toISOString();
			const didQueue = await db.transact(
				[store, "outbox", "meta"],
				"readwrite",
				async (t) => {
					const meta = (await t.get("meta", "sync")) as SyncMeta | undefined;
					await t.delete(store, id);
					if (meta?.mode !== "account") return false;
					await queue(t, store, id, "delete", stamp);
					return true;
				},
			);
			if (didQueue) onQueued();
		},
	};
}
```

Reading `meta` inside each write, rather than caching the mode in memory, costs one small read. In exchange, a sign-in or sign-out in another tab takes effect on this tab's very next write.

- [ ] **Step 5: Run the tests and the full suite**

As in Task 4 Step 6, let Biome wrap the long lines first.

Run: `npx biome format --write src/sync tests/sync && npx vitest run tests/sync && npm run test:run && npm run check`
Expected: PASS, with Biome and `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/sync/syncing-db.ts src/sync/types.ts tests/sync/syncing-db.test.ts
git commit -m "feat(sync): syncing db wrapper that queues writes in the same transaction"
```

---

### Task 6: Server schema and the first migration

The Postgres tables that mirror the client's records, Better Auth's own tables, one shared `server_seq` sequence, and the first migration applied to Neon `dev`. Spec §5.2, §9 (no raw SQL), §14 (licences).

**Files:**
- Create: `api/src/auth.cli.ts`, `api/src/auth-schema.ts` (generated), `api/src/schema.ts`, `api/src/records.ts`, `api/drizzle.config.ts`, `api/drizzle/0000_init.sql` (generated), `api/drizzle/meta/*` (generated), `api/tsconfig.json`
- Modify: `package.json` (dependencies, scripts `check`, `db:generate`, `db:migrate`), `package-lock.json` (by npm), `biome.json` (ignore generated files)
- Test: `api/test/schema.test.ts`, `api/test/records.test.ts`

**Interfaces:**
- Consumes: `Store`, `Row` (Task 2, `shared/protocol.ts`). `DATABASE_URL` in `.env` (Task 0, Step 8: the Neon `dev` branch).
- Produces:
  - `api/src/schema.ts`: tables `areas`, `sections`, `tasks`, `settings`, `tombstones`; sequence `serverSeq` (SQL name `server_seq_seq`); `NEXT_SERVER_SEQ: SQL` (the `nextval` expression, used as every `server_seq` default and by Task 9's upserts); `type Recurrence`; re-exports every table from `auth-schema.ts` (`user`, `session`, `account`, `verification`, `rateLimit`).
  - `api/src/records.ts`: `type DataTable = typeof tasks`, `type DataInsert = typeof tasks.$inferInsert`, `tableFor(store: Store): DataTable`, `rowToRecord(row: Record<string, unknown>): Row`, `recordToRow(userId: string, record: Row): DataInsert`.
  - `api/src/auth.cli.ts`: `export const auth` (for the Better Auth CLI only; never imported by the Worker).
  - `api/tsconfig.json`; `npm run check` also runs `tsc --noEmit -p api`.
  - npm scripts `db:generate` and `db:migrate`.

**Why the column names are the wire names.** The TypeScript keys of each table (`sectionId`, `hasTime`, `updatedAt`) are exactly the field names `toWire` produces (Task 4). So a row read with Drizzle becomes a wire record by dropping `userId` and `serverSeq` and turning each `Date` into an ISO string. Nothing maps field by field, so nothing can drift. Task 7's contract test proves the two lists match.

**Why `records.ts` types every data table as `tasks`.** Push and pull loop over the four stores. Drizzle's types can't narrow a union of four different tables, so a loop over them doesn't type-check. `tableFor()` hands back the real table object at runtime and tells TypeScript it is the tasks table. That is safe because the dynamic code only names the four columns every data table shares: `userId`, `id`, `updatedAt` and `serverSeq`.

**Why `api/tsconfig.json` has no Worker types yet.** `npx wrangler types` reads `wrangler.jsonc`, and its output imports the Worker's entry file, `api/src/index.ts`. Both arrive in Task 8, which adds the generated file to this config. Until then everything under `api/` is plain TypeScript with Node's types, which is all the schema, the scripts and the pure tests need.

**Why relative imports inside `api/` end in `.ts`.** The admin scripts (Task 8) run straight under Node 26, which strips types but never guesses a file extension. With `.ts` on every relative import, any file in `api/` can be imported from a script. Wrangler's bundler, Vite and drizzle-kit all accept the extension. `allowImportingTsExtensions` lets `tsc` accept it too.

**What I verified for this task (2026-09-30):** licences with `npm view`: `drizzle-orm@0.45.3` Apache-2.0, `drizzle-kit@0.31.11` MIT, `pg@8.23.0` MIT, `better-auth@1.7.6` MIT, `zod@4.6.5` MIT, `wrangler@4.144.0` "MIT OR Apache-2.0", `@cloudflare/vitest-plugin@1.3.3` MIT (peers: vitest ^4.1), `@types/pg` MIT. `pg@8.23.0` ships an ESM entry (`"import": "./esm/index.mjs"`), so `import { Client } from "pg"` works under Node as well as in the Worker. From drizzle-orm 0.45.2's source: `drizzle.mock()` exists for node-postgres and returns a typed database with no connection; `onConflictDoUpdate` takes `{ target, set, setWhere?, targetWhere? }`. The Better Auth CLI's `generate` takes `--config`, `--output` and `--yes`, and reads the adapter from the config file's exported `auth`.

- [ ] **Step 1: Check every new package's licence**

Run:

```bash
npm view drizzle-orm@0.45.3 license
npm view drizzle-kit@0.31.11 license
npm view pg@8.23.0 license
npm view better-auth@1.7.6 license
npm view zod@4.6.5 license
npm view wrangler@4.144.0 license
npm view @cloudflare/vitest-plugin@1.3.3 license
npm view @types/pg@8 license
```

Expected, in order: `Apache-2.0`, `MIT`, `MIT`, `MIT`, `MIT`, `MIT OR Apache-2.0`, `MIT`, then `MIT` (once per matching version). All are compatible with Ignite's Apache-2.0. If any line differs, stop and ask Malin.

- [ ] **Step 2: Install the server packages**

Runtime packages the Worker bundles go in `dependencies`. Tools go in `devDependencies`. Vite only bundles what `src/` imports, so none of these can reach the client bundle, and Task 2's bundle gate would catch it if one did. `@types/node` is already installed (Task 2).

```bash
npm install drizzle-orm@0.45.3 pg@8.23.0 zod@4.6.5
npm install --save-exact better-auth@1.7.6
npm install --save-dev drizzle-kit@0.31.11 @types/pg@8 wrangler@4.144.0 @cloudflare/vitest-plugin@1.3.3
```

`better-auth` is exact because its CLI (`npx auth@1.7.6`) must generate the schema for the same version the Worker runs.

Expected: three "added N packages" lines and no `ERESOLVE` error. If npm reports that it skipped install scripts for `workerd` or `esbuild` (Wrangler's runtime and bundler; each script only checks its platform binary), add them to the existing `allowScripts` object in `package.json` with the exact versions npm printed, next to `sharp`, for example `"workerd@1.20260926.1": true`, then run `npm install` once more.

Run: `npx wrangler --version`
Expected: `4.144.0` (the first line may show the "⛅️ wrangler" banner).

Run: `node scripts/check-licences.mjs`
Expected: `0 disallowed`. This covers everything the eight packages pulled in (Global Constraints, Licences). A listed package stops the task and goes to Malin.

- [ ] **Step 3: Add `api/tsconfig.json` and type-check it in `npm run check`**

Create `api/tsconfig.json`:

```json
{
	"compilerOptions": {
		"target": "ES2023",
		"module": "ESNext",
		"moduleResolution": "Bundler",
		"lib": ["ES2023"],
		"types": ["node"],
		"strict": true,
		"isolatedModules": true,
		"verbatimModuleSyntax": true,
		"allowImportingTsExtensions": true,
		"skipLibCheck": true,
		"noEmit": true
	},
	"include": [
		"src/**/*.ts",
		"scripts/**/*.ts",
		"test/**/*.ts",
		"drizzle.config.ts",
		"../shared/**/*.ts",
		"../vitest.workers.config.ts"
	]
}
```

`lib` has no `DOM`: the Worker is not a browser, and Task 8 adds the Workers runtime's own `Request`, `Response` and `fetch` types. `verbatimModuleSyntax` makes `tsc` insist on `import type` for types, which Node's type stripping needs (a type imported as a value is a missing export at runtime). The include entry for `vitest.workers.config.ts` matches nothing until Task 8 creates the file.

In `package.json`, change the `check` script (Task 2 wrote `"biome check . && tsc --noEmit"`) to:

```json
		"check": "biome check . && tsc --noEmit && tsc --noEmit -p api",
```

Run: `npx tsc --noEmit -p api`
Expected: no output, exit code 0. Only `shared/protocol.ts` (Task 2) matches so far; Step 7 adds the first files under `api/`.

- [ ] **Step 4: Write the failing tests**

`api/test/schema.test.ts`:

```ts
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
	areas,
	sections,
	serverSeq,
	settings,
	tasks,
	tombstones,
} from "../src/schema.ts";

const TABLES: Record<string, PgTable> = {
	areas,
	sections,
	tasks,
	settings,
	tombstones,
};

const columnNames = (columns: unknown[]) =>
	columns.map((c) =>
		typeof c === "object" && c !== null && "name" in c ? String(c.name) : "",
	);

describe("data tables", () => {
	for (const [name, table] of Object.entries(TABLES)) {
		const config = getTableConfig(table);

		it(`${name} is keyed by the owner first, because ids repeat across accounts`, () => {
			expect(config.primaryKeys).toHaveLength(1);
			expect(columnNames(config.primaryKeys[0].columns)).toEqual(
				name === "tombstones" ? ["user_id", "store", "id"] : ["user_id", "id"],
			);
		});

		it(`${name} is deleted with its user (ON DELETE CASCADE)`, () => {
			expect(config.foreignKeys).toHaveLength(1);
			const fk = config.foreignKeys[0];
			const ref = fk.reference();
			expect(fk.onDelete).toBe("cascade");
			expect(columnNames(ref.columns)).toEqual(["user_id"]);
			expect(getTableConfig(ref.foreignTable).name).toBe("user");
			expect(columnNames(ref.foreignColumns)).toEqual(["id"]);
		});

		it(`${name} has an index on (user_id, server_seq) for pull`, () => {
			const indexed = config.indexes.map((i) =>
				columnNames(i.config.columns).join(","),
			);
			expect(indexed).toContain("user_id,server_seq");
		});

		it(`${name} takes server_seq from the shared sequence`, () => {
			const column = config.columns.find((c) => c.name === "server_seq");
			expect(column?.notNull).toBe(true);
			expect(column?.hasDefault).toBe(true);
		});
	}

	it("has one shared sequence named server_seq_seq", () => {
		expect(serverSeq.seqName).toBe("server_seq_seq");
	});
});
```

`api/test/records.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { recordToRow, rowToRecord, tableFor } from "../src/records.ts";
import { areas, sections, settings, tasks } from "../src/schema.ts";

describe("tableFor", () => {
	it("hands back the real table object for each store", () => {
		expect(tableFor("areas")).toBe(areas as unknown);
		expect(tableFor("sections")).toBe(sections as unknown);
		expect(tableFor("tasks")).toBe(tasks);
		expect(tableFor("settings")).toBe(settings as unknown);
	});
});

describe("rowToRecord", () => {
	it("drops the owner and the sequence, and writes dates as ISO strings", () => {
		const record = rowToRecord({
			userId: "u1",
			id: "t1",
			title: "A",
			dueAt: null,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: new Date("2026-01-02T03:04:05.678Z"),
			serverSeq: 42,
		});
		expect(record).toEqual({
			id: "t1",
			title: "A",
			dueAt: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T03:04:05.678Z",
		});
	});
});

describe("recordToRow", () => {
	it("adds the owner from the session and turns ISO strings into dates", () => {
		const row = recordToRow("u1", {
			id: "t1",
			dueAt: "2026-10-01T08:00:00.000Z",
			lastCompletedAt: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
		expect(row.userId).toBe("u1");
		expect(row.dueAt).toEqual(new Date("2026-10-01T08:00:00.000Z"));
		expect(row.lastCompletedAt).toBeNull();
		expect(row.updatedAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
	});

	it("round-trips through rowToRecord unchanged", () => {
		const record = {
			id: "a1",
			name: "Home",
			icon: "🔥",
			critical: false,
			order: 2,
			updatedAt: "2026-01-02T00:00:00.000Z",
		};
		expect(rowToRecord({ ...recordToRow("u1", record), serverSeq: 7 })).toEqual(
			record,
		);
	});
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run api/test/schema.test.ts api/test/records.test.ts`
Expected: FAIL, "Failed to load url ../src/schema.ts" (and the same for `records.ts`).

- [ ] **Step 6: Generate Better Auth's tables**

Create `api/src/auth.cli.ts`:

```ts
// Only for `npx auth@1.7.6 generate`. The Better Auth CLI loads this file to
// learn which tables Better Auth needs. The Worker never imports it: its real
// instance is createAuth() in auth.ts, which needs a request's env and database.
//
// Keep the options that shape the schema in step with auth.ts: email and
// password sign-in, and rate limiting stored in the database (which adds the
// rateLimit table). Nothing else in auth.ts changes a table.

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";

export const auth = betterAuth({
	// drizzle.mock() is a typed database with no connection. Generating the
	// schema reads the config only, so it never needs one.
	database: drizzleAdapter(drizzle.mock(), { provider: "pg" }),
	emailAndPassword: { enabled: true },
	rateLimit: { enabled: true, storage: "database" },
});
```

Run: `npx auth@1.7.6 generate --config api/src/auth.cli.ts --output api/src/auth-schema.ts --yes`
Expected: a line saying the schema was generated to `api/src/auth-schema.ts`. A warning about a missing secret or base URL is fine here: the CLI instance never serves a request.

Open `api/src/auth-schema.ts` and check that it exports `user`, `session`, `account`, `verification` and `rateLimit`, that `user.id` is a `text` primary key, and that `session.userId` and `account.userId` reference `user.id` with `onDelete: "cascade"`. If `rateLimit` is missing, the CLI did not see the `rateLimit` option: check the file path in `--config` and run the command again.

Add the generated files to Biome's ignore list, because regenerating them would undo any formatting. In `biome.json`, extend `files.includes`:

```json
		"includes": [
			"**",
			"!dist",
			"!node_modules",
			"!**/*.min.js",
			"!design-system",
			"!api/src/auth-schema.ts",
			"!api/drizzle"
		]
```

- [ ] **Step 7: Write `api/src/schema.ts` and `api/src/records.ts`**

`api/src/schema.ts`:

```ts
// Server tables (spec §5.2). Real columns that mirror the client's records, and
// the TypeScript keys are the wire field names (see records.ts).
//
// Every data table is keyed by (user_id, id): every install seeds the same
// "focus" and "focus-default" ids, so an id alone is not unique across accounts.
// There are no foreign keys between data tables, on purpose: a task can arrive
// before its section.

import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgSequence,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import type { Store } from "../../shared/protocol.ts";
import { user } from "./auth-schema.ts";

export * from "./auth-schema.ts";

// One sequence for every data table and for tombstones, so a single cursor
// orders all of a user's changes.
export const serverSeq = pgSequence("server_seq_seq");
export const NEXT_SERVER_SEQ = sql`nextval('server_seq_seq')`;

export type Recurrence =
	| { type: "daily"; interval?: number }
	| { type: "weekly"; interval?: number; weekdays: number[] }
	| { type: "monthly"; interval?: number; day: number }
	| { type: "yearly"; interval?: number; month: number; day: number };

// Deleting a user deletes every row and tombstone they own (spec §5.2, §14).
const owner = () =>
	text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" });
const seq = () =>
	bigint("server_seq", { mode: "number" }).notNull().default(NEXT_SERVER_SEQ);
const instant = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });

export const areas = pgTable(
	"areas",
	{
		userId: owner(),
		id: text("id").notNull(),
		name: text("name").notNull(),
		icon: text("icon").notNull(),
		critical: boolean("critical").notNull(),
		order: integer("order").notNull(),
		updatedAt: instant("updated_at").notNull(),
		serverSeq: seq(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.id] }),
		index("areas_user_seq_idx").on(t.userId, t.serverSeq),
	],
);

export const sections = pgTable(
	"sections",
	{
		userId: owner(),
		id: text("id").notNull(),
		areaId: text("area_id").notNull(),
		name: text("name").notNull(),
		collapsed: boolean("collapsed").notNull(),
		order: integer("order").notNull(),
		updatedAt: instant("updated_at").notNull(),
		serverSeq: seq(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.id] }),
		index("sections_user_seq_idx").on(t.userId, t.serverSeq),
	],
);

export const tasks = pgTable(
	"tasks",
	{
		userId: owner(),
		id: text("id").notNull(),
		sectionId: text("section_id").notNull(),
		title: text("title").notNull(),
		notes: text("notes").notNull(),
		completed: boolean("completed").notNull(),
		starred: boolean("starred").notNull(),
		critical: boolean("critical").notNull(),
		dueAt: instant("due_at"),
		hasTime: boolean("has_time").notNull(),
		recurrence: jsonb("recurrence").$type<Recurrence>(),
		lastCompletedAt: instant("last_completed_at"),
		completedCount: integer("completed_count").notNull(),
		leadTime: integer("lead_time").notNull(),
		scheduledTags: jsonb("scheduled_tags").$type<string[]>().notNull(),
		createdAt: instant("created_at").notNull(),
		order: integer("order").notNull(),
		updatedAt: instant("updated_at").notNull(),
		serverSeq: seq(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.id] }),
		index("tasks_user_seq_idx").on(t.userId, t.serverSeq),
	],
);

// Only the synced settings fields (spec §4.3). The theme and the sidebar state
// never leave the device.
export const settings = pgTable(
	"settings",
	{
		userId: owner(),
		id: text("id").notNull(),
		quietStart: integer("quiet_start").notNull(),
		quietEnd: integer("quiet_end").notNull(),
		updatedAt: instant("updated_at").notNull(),
		serverSeq: seq(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.id] }),
		index("settings_user_seq_idx").on(t.userId, t.serverSeq),
	],
);

// A deleted row leaves a tombstone with no content (spec §5.2, D5), so a
// deleted title does not live on here.
export const tombstones = pgTable(
	"tombstones",
	{
		userId: owner(),
		store: text("store").$type<Store>().notNull(),
		id: text("id").notNull(),
		deletedAt: instant("deleted_at").notNull(),
		serverSeq: seq(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.store, t.id] }),
		index("tombstones_user_seq_idx").on(t.userId, t.serverSeq),
	],
);
```

`api/src/records.ts`:

```ts
// Server row ↔ wire record. The table keys are the wire field names, so this
// only drops the two server columns and converts dates.

import type { Row, Store } from "../../shared/protocol.ts";
import { areas, sections, settings, tasks } from "./schema.ts";

// Drizzle's types can't narrow a union of four tables, so code that loops over
// stores sees every data table as the tasks table. At runtime Drizzle always
// uses the real table object. Such code may only name the columns all four
// share: userId, id, updatedAt and serverSeq.
export type DataTable = typeof tasks;
export type DataInsert = typeof tasks.$inferInsert;

const TABLES = { areas, sections, tasks, settings };

export function tableFor(store: Store): DataTable {
	return TABLES[store] as unknown as DataTable;
}

const DATE_FIELDS = ["dueAt", "lastCompletedAt", "createdAt", "updatedAt"];

export function rowToRecord(row: Record<string, unknown>): Row {
	const out: Row = {};
	for (const [key, value] of Object.entries(row)) {
		if (key === "userId" || key === "serverSeq") continue;
		out[key] = value instanceof Date ? value.toISOString() : value;
	}
	return out;
}

// The record has passed validate.ts. userId always comes from the session.
export function recordToRow(userId: string, record: Row): DataInsert {
	const out: Record<string, unknown> = { ...record, userId };
	for (const field of DATE_FIELDS) {
		const value = out[field];
		if (typeof value === "string") out[field] = new Date(value);
	}
	return out as DataInsert;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run api/test/schema.test.ts api/test/records.test.ts`
Expected: PASS, 25 tests (four per table for five tables, one for the sequence, and four in `records.test.ts`).

- [ ] **Step 9: Configure drizzle-kit and generate the migration**

Create `api/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

// DATABASE_URL is the Neon dev branch in .env on my machine. CI sets it from
// the NEON_DATABASE_URL secret (the main branch) and has no .env.
try {
	process.loadEnvFile();
} catch {
	// No .env: DATABASE_URL must come from the environment.
}

export default defineConfig({
	dialect: "postgresql",
	schema: "./api/src/schema.ts",
	out: "./api/drizzle",
	dbCredentials: { url: process.env.DATABASE_URL ?? "" },
	strict: true,
	verbose: true,
});
```

`process.loadEnvFile()` never overwrites a variable that is already set, so `DATABASE_URL=… npm run db:migrate` targets whatever the shell says, even with a `.env` present.

Add two scripts to `package.json`:

```json
		"db:generate": "drizzle-kit generate --config api/drizzle.config.ts",
		"db:migrate": "drizzle-kit migrate --config api/drizzle.config.ts",
```

Run: `npm run db:generate -- --name init`
Expected: "Your SQL migration file ➜ api/drizzle/0000_init.sql 🚀", listing 10 tables (`account`, `areas`, `rate_limit` or `rateLimit`, `sections`, `session`, `settings`, `tasks`, `tombstones`, `user`, `verification`).

- [ ] **Step 10: Read the generated SQL before it touches a database**

Run: `grep -nE "CREATE SEQUENCE|CREATE TABLE|PRIMARY KEY|ON DELETE|CREATE INDEX" api/drizzle/0000_init.sql`

Check each of these by eye:

1. **`CREATE SEQUENCE "public"."server_seq_seq"` is the first matching line**, above every `CREATE TABLE`. The tables' `DEFAULT nextval('server_seq_seq')` fails if the sequence does not exist yet. If drizzle-kit put it lower, move that statement (with the `--> statement-breakpoint` marker after it) to the top of the file by hand.
2. `areas`, `sections`, `tasks` and `settings` each have `CONSTRAINT "<table>_user_id_id_pk" PRIMARY KEY("user_id","id")`, and `tombstones` has `PRIMARY KEY("user_id","store","id")`.
3. Every `server_seq` column reads `bigint DEFAULT nextval('server_seq_seq') NOT NULL`.
4. Seven `FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade` lines: the five data tables, plus Better Auth's `session` and `account`.
5. Five `CREATE INDEX "<table>_user_seq_idx" … USING btree ("user_id","server_seq")` lines.
6. No foreign key between `tasks`, `sections` and `areas` (spec §5.2).

- [ ] **Step 11: Migrate Neon `dev` and look at the result**

Run: `npm run db:migrate`
Expected: "[✓] migrations applied successfully!". It reads `DATABASE_URL` from `.env`, which is the `dev` branch (Task 0, Step 8).

Run:

```bash
node --env-file=.env --input-type=module -e 'import pg from "pg"; const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); const t = await c.query("select table_name from information_schema.tables where table_schema = $1 order by 1", ["public"]); const s = await c.query("select sequence_name from information_schema.sequences where sequence_schema = $1", ["public"]); console.log(t.rows.map((r) => r.table_name).join(", ")); console.log(s.rows.map((r) => r.sequence_name).join(", ")); await c.end();'
```

Expected: the first line lists the ten tables from Step 9, and the second line reads `server_seq_seq`.

- [ ] **Step 12: Run the checks**

Run: `npx biome check --write api biome.json && npm run check && npm run test:run`
Expected: Biome fixes import order and formatting only, then reports no errors. Both `tsc` runs print nothing. Every test passes.

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json biome.json api/tsconfig.json api/drizzle.config.ts api/drizzle api/src/auth.cli.ts api/src/auth-schema.ts api/src/schema.ts api/src/records.ts api/test/schema.test.ts api/test/records.test.ts
git commit -m "feat(api): server schema, shared server_seq sequence and first migration"
```

---

### Task 7: Push validation and the last-write-wins rule

The Zod boundary every pushed change passes before it reaches Drizzle, and the pure conflict rule with the clock cap. No database, no network: plain Node Vitest. Spec §5.3, §6.1 (last write wins, clock cap), §10 (the must-fail fixtures).

**Files:**
- Create: `api/src/validate.ts`, `api/src/decide.ts`
- Test: `api/test/validate.test.ts`, `api/test/decide.test.ts`, `api/test/wire-contract.test.ts`

**Interfaces:**
- Consumes: `Change`, `Store`, `STORES`, `PROTOCOL_VERSION`, `MAX_CHANGES`, `CLOCK_SKEW_MS`, `EPOCH` (Task 2). `tableFor` (Task 6). `toWire` (Task 4, test only).
- Produces:
  - `api/src/validate.ts`: `parsePushRequest(body: unknown): { ok: true; changes: unknown[] } | { ok: false; status: 400 | 413 | 426 }`; `parseChange(raw: unknown): ParsedChange`; `type ParsedChange = { ok: true; change: Change } | { ok: false; store: Store | null; id: string | null }`; `NAME_MAX = 1_000`; `NOTES_MAX = 20_000`; `withinLength(value: string, max: number): boolean`; `isIsoDate(value: string): boolean`.
  - `api/src/decide.ts`: `clampUpdatedAt(iso: string, serverNow: Date): string`; `decide(incomingAt: string, currentAt: string | null): "apply" | "lose"`.

**Every schema is at least as strict as the column behind it.** A value Postgres would refuse (a day that doesn't exist, an integer over 2³¹, a string where a boolean goes) must fail here as `invalid`. If it reached Postgres instead, it would fail the whole push transaction, the client would retry the same batch every round, and the queue would jam for good.

**Dates are exactly what `toISOString()` produces**, with milliseconds and a `Z`. Every date the client writes comes from `toISOString()` (checked in `src/`: `tasks.js`, `recurrence-dialog.js`, the syncing wrapper). Round-tripping the value through `Date` rejects `2026-02-31`, which JavaScript would silently roll into March. It also means a date comes back from Postgres byte for byte as it went in, so a retried push gets back an identical row (spec §6.1).

**Length limits count characters, not UTF-16 units.** Zod's `.max()` counts `String.length`, where one emoji is two units. A note of 20,000 emoji is 40,000 units and must still sync, because nothing in the app stopped me typing it. `withinLength` counts code points, and only for strings between `max` and `2 × max` units, so an ordinary title costs one comparison.

**`id` fields are capped at 100 characters and `icon` at 32.** The spec names no limit for either. Ids are UUIDs (36) or the seed ids, and an icon is one emoji from the picker. Without any cap, a single change could carry a megabyte in its id.

**The wire contract test is the one place a test under `api/` imports from `src/`.** It proves that what `toWire` builds is exactly what `parseChange` accepts and exactly what the tables hold. Without it, a field added on one side only would turn every row into `invalid` in production and nowhere else. The Worker's own code still never imports `src/`.

- [ ] **Step 1: Write the failing tests**

`api/test/decide.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampUpdatedAt, decide } from "../src/decide.ts";

const NOW = new Date("2026-10-01T12:00:00.000Z");

describe("clampUpdatedAt", () => {
	it("caps a time from a fast clock at server time plus 5 seconds", () => {
		expect(clampUpdatedAt("2027-10-01T12:00:00.000Z", NOW)).toBe(
			"2026-10-01T12:00:05.000Z",
		);
	});
	it("keeps a time inside the 5 seconds as it is", () => {
		expect(clampUpdatedAt("2026-10-01T12:00:04.999Z", NOW)).toBe(
			"2026-10-01T12:00:04.999Z",
		);
	});
	it("keeps a time in the past as it is", () => {
		expect(clampUpdatedAt("2026-01-01T00:00:00.000Z", NOW)).toBe(
			"2026-01-01T00:00:00.000Z",
		);
	});
});

describe("decide", () => {
	it("applies when the server holds nothing for the key", () => {
		expect(decide("2026-01-01T00:00:00.000Z", null)).toBe("apply");
	});
	it("applies a strictly newer change", () => {
		expect(decide("2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(
			"apply",
		);
	});
	it("loses on an equal time, so a retried push comes back as lost", () => {
		expect(decide("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(
			"lose",
		);
	});
	it("loses to a newer time on the server", () => {
		expect(decide("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z")).toBe(
			"lose",
		);
	});
});
```

`api/test/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_CHANGES, PROTOCOL_VERSION } from "../../shared/protocol.ts";
import {
	isIsoDate,
	parseChange,
	parsePushRequest,
	withinLength,
} from "../src/validate.ts";

const AT = "2026-10-01T08:00:00.000Z";

const task = (over: Record<string, unknown> = {}) => ({
	id: "t1",
	sectionId: "s1",
	title: "Ring the dentist",
	notes: "",
	completed: false,
	starred: false,
	critical: false,
	dueAt: null,
	hasTime: false,
	recurrence: null,
	lastCompletedAt: null,
	completedCount: 0,
	leadTime: 0,
	scheduledTags: [],
	createdAt: AT,
	order: 0,
	updatedAt: AT,
	...over,
});

const putTask = (record: Record<string, unknown>, id = "t1") => ({
	store: "tasks",
	id,
	op: "put",
	record,
});

const rejected = (store: string | null, id: string | null) => ({
	ok: false,
	store,
	id,
});

describe("parseChange accepts", () => {
	it("a full task", () => {
		expect(parseChange(putTask(task()))).toEqual({
			ok: true,
			change: putTask(task()),
		});
	});

	it("a task with a due date, a weekly rule and a completion", () => {
		const record = task({
			dueAt: AT,
			hasTime: true,
			recurrence: { type: "weekly", interval: 1, weekdays: [1, 3] },
			lastCompletedAt: AT,
			completedCount: 3,
		});
		expect(parseChange(putTask(record)).ok).toBe(true);
	});

	it("an area, a section and the settings row", () => {
		const area = {
			id: "focus",
			name: "Focus",
			icon: "🔥",
			critical: false,
			order: 0,
			updatedAt: AT,
		};
		const section = {
			id: "focus-default",
			areaId: "focus",
			name: "Tasks",
			collapsed: false,
			order: 0,
			updatedAt: AT,
		};
		const settings = { id: "app", quietStart: 23, quietEnd: 7, updatedAt: AT };
		expect(
			parseChange({ store: "areas", id: "focus", op: "put", record: area }).ok,
		).toBe(true);
		expect(
			parseChange({
				store: "sections",
				id: "focus-default",
				op: "put",
				record: section,
			}).ok,
		).toBe(true);
		expect(
			parseChange({ store: "settings", id: "app", op: "put", record: settings })
				.ok,
		).toBe(true);
	});

	it("a delete", () => {
		const change = { store: "tasks", id: "t1", op: "delete", deletedAt: AT };
		expect(parseChange(change)).toEqual({ ok: true, change });
	});
});

describe("parseChange must fail (spec §10)", () => {
	it("an unknown key in the record", () => {
		expect(parseChange(putTask(task({ colour: "red" })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a user_id smuggled into the record", () => {
		expect(parseChange(putTask(task({ user_id: "someone-else" })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a userId smuggled into the record", () => {
		expect(parseChange(putTask(task({ userId: "someone-else" })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a record id that differs from the change id", () => {
		expect(parseChange(putTask(task({ id: "t2" }), "t1"))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a store outside the four", () => {
		expect(
			parseChange({ store: "user", id: "t1", op: "put", record: task() }),
		).toEqual(rejected(null, "t1"));
	});

	it("a 1,001-character title", () => {
		expect(parseChange(putTask(task({ title: "x".repeat(1_001) })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("an unknown key on the change itself", () => {
		expect(parseChange({ ...putTask(task()), userId: "someone-else" })).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a put with no record", () => {
		expect(parseChange({ store: "tasks", id: "t1", op: "put" })).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("an op that is neither put nor delete", () => {
		expect(parseChange({ ...putTask(task()), op: "patch" })).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a device-only settings field", () => {
		const record = {
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "dark",
			updatedAt: AT,
		};
		expect(
			parseChange({ store: "settings", id: "app", op: "put", record }),
		).toEqual(rejected("settings", "app"));
	});

	it("a number where a boolean goes (the 0/1 the task model stores)", () => {
		expect(parseChange(putTask(task({ completed: 1 })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("an order Postgres can't store in an integer column", () => {
		expect(parseChange(putTask(task({ order: 2 ** 31 })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a change that isn't an object at all", () => {
		expect(parseChange("tasks:t1")).toEqual(rejected(null, null));
	});

	it("a NUL in a title (Postgres text refuses it)", () => {
		expect(parseChange(putTask(task({ title: "Ring\u0000" })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a NUL in the id, reported with no id so push never queries it", () => {
		expect(parseChange(putTask(task({ id: "t\u0000" }), "t\u0000"))).toEqual(
			rejected("tasks", null),
		);
	});

	it("a lone high surrogate in notes (jsonb refuses it)", () => {
		expect(parseChange(putTask(task({ notes: "x\uD83D" })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("a lone low surrogate in a scheduled tag", () => {
		expect(parseChange(putTask(task({ scheduledTags: ["\uDE00x"] })))).toEqual(
			rejected("tasks", "t1"),
		);
	});
});

describe("length limits count characters, not UTF-16 units", () => {
	const emoji = "😀"; // one character, two UTF-16 units

	it("accepts a 1,000-character title", () => {
		expect(parseChange(putTask(task({ title: "x".repeat(1_000) }))).ok).toBe(
			true,
		);
	});

	it("accepts a title of 1,000 emoji (2,000 UTF-16 units)", () => {
		expect(parseChange(putTask(task({ title: emoji.repeat(1_000) }))).ok).toBe(
			true,
		);
	});

	it("accepts a note of 20,000 emoji (40,000 UTF-16 units)", () => {
		expect(parseChange(putTask(task({ notes: emoji.repeat(20_000) }))).ok).toBe(
			true,
		);
	});

	it("rejects a note of 20,001 emoji", () => {
		expect(parseChange(putTask(task({ notes: emoji.repeat(20_001) })))).toEqual(
			rejected("tasks", "t1"),
		);
	});

	it("counts correctly at the edges", () => {
		expect(withinLength("abc", 3)).toBe(true);
		expect(withinLength("abcd", 3)).toBe(false);
		expect(withinLength(emoji.repeat(3), 3)).toBe(true);
		expect(withinLength(emoji.repeat(4), 3)).toBe(false);
	});
});

describe("dates", () => {
	it("accepts exactly the shape toISOString() produces", () => {
		expect(isIsoDate(new Date().toISOString())).toBe(true);
		expect(isIsoDate(AT)).toBe(true);
	});

	it("rejects dates that don't exist, other shapes and offsets", () => {
		expect(isIsoDate("2026-02-31T00:00:00.000Z")).toBe(false);
		expect(isIsoDate("2026-10-01T08:00:00Z")).toBe(false);
		expect(isIsoDate("2026-10-01T10:00:00.000+02:00")).toBe(false);
		expect(isIsoDate("2026-10-01")).toBe(false);
		expect(isIsoDate("yesterday")).toBe(false);
	});

	it("fails a change whose date is not valid", () => {
		expect(
			parseChange(putTask(task({ dueAt: "2026-02-31T00:00:00.000Z" }))),
		).toEqual(rejected("tasks", "t1"));
		expect(
			parseChange({ store: "tasks", id: "t1", op: "delete", deletedAt: "now" }),
		).toEqual(rejected("tasks", "t1"));
	});
});

describe("parsePushRequest", () => {
	it("hands back the raw changes of a well-formed request", () => {
		expect(
			parsePushRequest({ protocol: PROTOCOL_VERSION, changes: [1, 2] }),
		).toEqual({ ok: true, changes: [1, 2] });
	});

	it("answers 426 to a protocol it doesn't speak, before anything else", () => {
		expect(parsePushRequest({ protocol: 2, changes: [] })).toEqual({
			ok: false,
			status: 426,
		});
		expect(parsePushRequest({ changes: [] })).toEqual({
			ok: false,
			status: 426,
		});
	});

	it("answers 400 to a body that isn't a request", () => {
		expect(parsePushRequest(null)).toEqual({ ok: false, status: 400 });
		expect(parsePushRequest([])).toEqual({ ok: false, status: 400 });
		expect(parsePushRequest({ protocol: PROTOCOL_VERSION })).toEqual({
			ok: false,
			status: 400,
		});
	});

	it("answers 413 to more than MAX_CHANGES changes", () => {
		const changes = Array.from({ length: MAX_CHANGES + 1 }, () => ({}));
		expect(parsePushRequest({ protocol: PROTOCOL_VERSION, changes })).toEqual({
			ok: false,
			status: 413,
		});
	});
});
```

`api/test/wire-contract.test.ts`:

```ts
// The one place a test under api/ imports from src/: it proves the client's
// wire records and the server's schemas describe the same thing.

import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { EPOCH, STORES, type Store } from "../../shared/protocol.ts";
import { toWire } from "../../src/sync/records.ts";
import { tableFor } from "../src/records.ts";
import { parseChange } from "../src/validate.ts";

// Rows as IndexedDB holds them today, including an old task written before
// hasTime, leadTime and scheduledTags existed, and the seeded rows.
const STORED: Record<Store, Record<string, unknown>[]> = {
	areas: [
		{ id: "focus", name: "Focus", icon: "🔥", critical: false, order: 0 },
		{
			id: "a1",
			name: "Home",
			icon: "",
			critical: true,
			order: 1,
			updatedAt: "2026-09-01T10:00:00.000Z",
		},
	],
	sections: [
		{
			id: "focus-default",
			areaId: "focus",
			name: "Tasks",
			collapsed: false,
			order: 0,
		},
	],
	tasks: [
		{
			id: "t-old",
			sectionId: "s1",
			title: "Old",
			completed: 0,
			starred: 0,
			critical: 0,
			dueAt: null,
			order: 3,
			createdAt: "2026-04-20T10:00:00.000Z",
		},
		{
			id: "t-new",
			sectionId: "focus-default",
			title: "New",
			notes: "n",
			completed: 1,
			starred: 1,
			critical: 0,
			dueAt: "2026-10-01T08:00:00.000Z",
			hasTime: 1,
			recurrence: { type: "monthly", interval: 1, day: 31 },
			lastCompletedAt: "2026-09-01T08:00:00.000Z",
			completedCount: 2,
			leadTime: 15,
			scheduledTags: ["x"],
			createdAt: "2026-01-01T00:00:00.000Z",
			order: 4,
			updatedAt: "2026-09-02T00:00:00.000Z",
		},
	],
	settings: [
		{
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "system",
			sidebarCollapsed: false,
			updatedAt: EPOCH,
		},
	],
};

describe("toWire output is exactly what the server accepts", () => {
	for (const store of STORES) {
		for (const row of STORED[store]) {
			it(`${store} ${row.id}`, () => {
				const record = toWire(store, row);
				const parsed = parseChange({ store, id: row.id, op: "put", record });
				expect(parsed).toEqual({
					ok: true,
					change: { store, id: row.id, op: "put", record },
				});
			});
		}
	}
});

describe("toWire's fields are exactly the table's columns", () => {
	for (const store of STORES) {
		it(store, () => {
			const columns = Object.keys(getTableColumns(tableFor(store)))
				.filter((key) => key !== "userId" && key !== "serverSeq")
				.sort();
			const fields = Object.keys(toWire(store, { id: "x" })).sort();
			expect(fields).toEqual(columns);
		});
	}
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run api/test/decide.test.ts api/test/validate.test.ts api/test/wire-contract.test.ts`
Expected: FAIL, "Failed to load url ../src/decide.ts" (and the same for `validate.ts`).

- [ ] **Step 3: Implement `api/src/decide.ts`**

```ts
// Last write wins, per row (spec §6.1, D7). Pure: push.ts calls it under the
// advisory lock with what the database holds for each key.

import { CLOCK_SKEW_MS } from "../../shared/protocol.ts";

// A device whose clock runs a year fast would win every conflict for a year.
// Capping at server time plus a few seconds stops that. iso has passed
// validate.ts, so it is a real toISOString() value.
export function clampUpdatedAt(iso: string, serverNow: Date): string {
	const cap = serverNow.getTime() + CLOCK_SKEW_MS;
	return Date.parse(iso) > cap ? new Date(cap).toISOString() : iso;
}

// currentAt is the stored row's updatedAt or the tombstone's deletedAt, or null
// when the server holds nothing for the key. Equal is not newer, so a retried
// push loses and gets back an identical row (spec §6.1).
export function decide(
	incomingAt: string,
	currentAt: string | null,
): "apply" | "lose" {
	if (currentAt === null) return "apply";
	return Date.parse(incomingAt) > Date.parse(currentAt) ? "apply" : "lose";
}
```

- [ ] **Step 4: Implement `api/src/validate.ts`**

```ts
// The push boundary (spec §5.3). The client is not trusted: every change is
// parsed here before it reaches Drizzle. Records are strict (an unknown key
// fails the change), sized, and typed at least as strictly as their columns,
// so a bad row fails here as `invalid` instead of failing the whole push
// transaction in Postgres.

import { z } from "zod";
import {
	type Change,
	MAX_CHANGES,
	PROTOCOL_VERSION,
	STORES,
	type Store,
} from "../../shared/protocol.ts";

export const NAME_MAX = 1_000;
export const NOTES_MAX = 20_000;
const ICON_MAX = 32;
const ID_MAX = 100;
const TAGS_MAX = 100;

// Counts code points, not UTF-16 units: an emoji is one character to a person
// but two units to String.length, which is what Zod's .max() counts. A string
// never has more code points than units, and a code point is at most two units,
// so only strings between max and 2 × max units need counting.
export function withinLength(value: string, max: number): boolean {
	if (value.length <= max) return true;
	if (value.length > max * 2) return false;
	return [...value].length <= max;
}

// Postgres text refuses a NUL byte, and jsonb refuses a lone surrogate. Either
// would fail the whole push transaction with a 500 and jam the queue, so they
// fail here as one invalid change. A regex, because the api lib is ES2023 and
// String.prototype.isWellFormed() is ES2024.
const BAD_TEXT =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: the NUL is what this rejects.
	/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const text = (max: number) =>
	z
		.string()
		.refine((value) => !BAD_TEXT.test(value), "Not storable text")
		.refine((value) => withinLength(value, max), `At most ${max} characters`);

// Exactly what Date.prototype.toISOString() produces. The round trip rejects
// days that don't exist (JavaScript rolls 2026-02-31 into March, Postgres
// refuses it), and it means a date comes back from Postgres byte for byte.
const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isIsoDate(value: string): boolean {
	if (!ISO_SHAPE.test(value)) return false;
	const time = Date.parse(value);
	return Number.isFinite(time) && new Date(time).toISOString() === value;
}

const isoDate = z.string().refine(isIsoDate, "Not an ISO date");
const id = z
	.string()
	.min(1)
	.max(ID_MAX)
	.refine((value) => !BAD_TEXT.test(value), "Not storable text");
const count = z.int32().min(0);
const interval = z.number().optional();

const recurrence = z
	.discriminatedUnion("type", [
		z.strictObject({ type: z.literal("daily"), interval }),
		z.strictObject({
			type: z.literal("weekly"),
			interval,
			weekdays: z.array(z.int().min(0).max(6)).max(7),
		}),
		z.strictObject({
			type: z.literal("monthly"),
			interval,
			day: z.int().min(1).max(31),
		}),
		z.strictObject({
			type: z.literal("yearly"),
			interval,
			month: z.int().min(1).max(12),
			day: z.int().min(1).max(31),
		}),
	])
	.nullable();

// One schema per store, field for field what toWire() builds (Task 4).
const RECORDS = {
	areas: z.strictObject({
		id,
		name: text(NAME_MAX),
		icon: text(ICON_MAX),
		critical: z.boolean(),
		order: z.int32(),
		updatedAt: isoDate,
	}),
	sections: z.strictObject({
		id,
		areaId: id,
		name: text(NAME_MAX),
		collapsed: z.boolean(),
		order: z.int32(),
		updatedAt: isoDate,
	}),
	tasks: z.strictObject({
		id,
		sectionId: id,
		title: text(NAME_MAX),
		notes: text(NOTES_MAX),
		completed: z.boolean(),
		starred: z.boolean(),
		critical: z.boolean(),
		dueAt: isoDate.nullable(),
		hasTime: z.boolean(),
		recurrence,
		lastCompletedAt: isoDate.nullable(),
		completedCount: count,
		leadTime: count,
		scheduledTags: z.array(text(NAME_MAX)).max(TAGS_MAX),
		createdAt: isoDate,
		order: z.int32(),
		updatedAt: isoDate,
	}),
	// Only the synced fields (spec §4.3). A theme here fails the change.
	settings: z.strictObject({
		id: z.literal("app"),
		quietStart: z.int().min(0).max(23),
		quietEnd: z.int().min(0).max(23),
		updatedAt: isoDate,
	}),
} satisfies Record<Store, z.ZodType>;

const store = z.enum(STORES);

const envelope = z.discriminatedUnion("op", [
	z.strictObject({ store, id, op: z.literal("put"), record: z.unknown() }),
	z.strictObject({ store, id, op: z.literal("delete"), deletedAt: isoDate }),
]);

export type ParsedChange =
	| { ok: true; change: Change }
	| { ok: false; store: Store | null; id: string | null };

// The body is already JSON-parsed and under MAX_BODY_BYTES (index.ts checks
// the bytes). The protocol is checked first, so a client from another
// protocol gets 426 whatever shape its body has.
export function parsePushRequest(
	body: unknown,
): { ok: true; changes: unknown[] } | { ok: false; status: 400 | 413 | 426 } {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return { ok: false, status: 400 };
	}
	const request = body as Record<string, unknown>;
	if (request.protocol !== PROTOCOL_VERSION) return { ok: false, status: 426 };
	if (!Array.isArray(request.changes)) return { ok: false, status: 400 };
	if (request.changes.length > MAX_CHANGES) return { ok: false, status: 413 };
	return { ok: true, changes: request.changes };
}

// A failure reports whatever store and id could be read, so push can answer
// with the server's version of that key. A change with neither has no key to
// report and is dropped silently (shared/protocol.ts, PushResponse).
export function parseChange(raw: unknown): ParsedChange {
	const fields =
		typeof raw === "object" && raw !== null
			? (raw as Record<string, unknown>)
			: {};
	const readStore = store.safeParse(fields.store);
	const readId = id.safeParse(fields.id);
	const failed: ParsedChange = {
		ok: false,
		store: readStore.success ? readStore.data : null,
		id: readId.success ? readId.data : null,
	};

	const parsed = envelope.safeParse(raw);
	if (!parsed.success) return failed;
	const change = parsed.data;
	if (change.op === "delete") return { ok: true, change };

	const record = RECORDS[change.store].safeParse(change.record);
	if (!record.success || record.data.id !== change.id) return failed;
	return {
		ok: true,
		change: {
			store: change.store,
			id: change.id,
			op: "put",
			record: record.data,
		},
	};
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run api/test/decide.test.ts api/test/validate.test.ts api/test/wire-contract.test.ts`
Expected: PASS. `decide.test.ts` 7 tests, `validate.test.ts` 33 tests, `wire-contract.test.ts` 10 tests (six stored rows, four stores).

Then prove the must-fail fixtures guard something. In `validate.ts`, temporarily change `tasks: z.strictObject({` to `tasks: z.object({` and run `npx vitest run api/test/validate.test.ts`.
Expected: FAIL on "an unknown key in the record", "a user_id smuggled into the record" and "a userId smuggled into the record". Undo the change and run it again: PASS.

- [ ] **Step 6: Run the checks**

Run: `npx biome check --write api && npm run check && npm run test:run`
Expected: no errors from Biome or either `tsc` run. Every test passes.

- [ ] **Step 7: Commit**

```bash
git add api/src/validate.ts api/src/decide.ts api/test/validate.test.ts api/test/decide.test.ts api/test/wire-contract.test.ts
git commit -m "feat(api): strict push validation and the last-write-wins rule"
```

---

### Task 8: The Worker, accounts and the admin scripts

The Worker entry that routes `/api/auth/*` to Better Auth, guards the sync routes and serves the app for everything else. Security headers on every Worker response, the allowlist, the cookie rules, `Clear-Site-Data` on sign-out, and the two scripts I run against Neon. Spec §3, §5.1, §5.4, §9, §10 (handler tests), §12 (the hash), §14 (delete).

**Files:**
- Create: `api/src/env.ts`, `api/src/http.ts`, `api/src/db.ts`, `api/src/auth.ts`, `api/src/index.ts`, `api/src/push.ts` (a 501 stub; Task 9 replaces it), `api/src/pull.ts` (a 501 stub; Task 10 replaces it), `wrangler.jsonc`, `worker-configuration.d.ts` (generated), `vitest.workers.config.ts`, `api/scripts/lib.ts`, `api/scripts/reset-password.ts`, `api/scripts/delete-user.ts`
- Create only if Task 1 chose PBKDF2: `api/src/password.ts`, `api/test/password.test.ts`
- Modify: `api/tsconfig.json` (Worker types), `package.json` (script `test:workers`), `biome.json` (ignore the generated types)
- Test: `api/test/http.test.ts`, `api/test/allowlist.test.ts`, `api/test/workers/helpers.ts`, `api/test/workers/auth.test.ts`, `api/test/workers/routes.test.ts`

**Interfaces:**
- Consumes: Task 0's Hyperdrive `id` and workers.dev subdomain (handed over in chat), `.dev.vars`, `.env`, and the Worker secrets `ALLOWED_EMAILS` and `BETTER_AUTH_SECRET`. Task 1's decision in spec §12. `schema.ts` (Task 6). `MAX_BODY_BYTES` (Task 2).
- Produces (CONTRACT names, exact):
  - `api/src/env.ts`: `export interface Env { HYPERDRIVE: Hyperdrive; ASSETS: Fetcher; BETTER_AUTH_SECRET: string; BETTER_AUTH_URL: string; ALLOWED_EMAILS: string }`
  - `api/src/db.ts`: `connect(env: Env): Promise<{ db: Database; close: () => Promise<void> }>`, `type Database = NodePgDatabase<typeof schema>`
  - `api/src/http.ts`: `SECURITY_HEADERS: Record<string, string>`, `json(status: number, body: unknown): Response`, `withSecurityHeaders(res: Response): Response`, `sameOrigin(request: Request): boolean`
  - `api/src/auth.ts`: `createAuth(env: Env, db: Database, ctx: ExecutionContext)` returning the `betterAuth(...)` instance
  - `api/src/push.ts`: `handlePush(db: Database, userId: string, body: unknown, now?: Date): Promise<{ status: number; json: unknown }>` (stub until Task 9)
  - `api/src/pull.ts`: `handlePull(db: Database, userId: string, url: URL): Promise<{ status: number; json: unknown }>` (stub until Task 10)
- Produces (added beyond CONTRACT):
  - `api/src/http.ts`: `ERROR_TEXT` (status → generic message for 400, 401, 403, 404, 405, 413, 426, 500), `errorResponse(status: keyof typeof ERROR_TEXT): Response`, `isJson(request: Request): boolean`, `readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }>`, `safeBackground(promise: Promise<unknown>): Promise<unknown>` (what `waitUntil` receives: a rejection is logged by error name only)
  - `api/src/auth.ts`: `parseAllowlist(value: string): Set<string>`, `SIGN_UP_REFUSED = "Sign-up failed"`
  - `api/scripts/lib.ts`: `openDatabase(): Promise<{ db: NodePgDatabase; target: string; close: () => Promise<void> }>`, `readLine(prompt: string): Promise<string>`, `readHidden(prompt: string): Promise<string>`
  - `api/test/workers/helpers.ts`: `ORIGIN`, `PASSWORD`, `testEnv`, `call(path, options?)`, `cookieHeader(res)`, `signUp(email)`, `deleteUsers(emails)`, `withDb(fn)`
  - npm script `test:workers`
  - PBKDF2 only: `api/src/password.ts`: `PBKDF2_ITERATIONS`, `hashPassword(password: string): Promise<string>`, `verifyPassword(data: { hash: string; password: string }): Promise<boolean>`

**Decisions in this task:**
- **The sync routes check Origin and Content-Type before the session.** Both checks are free, and the session check costs a database round trip. A request without a session still gets `401` before its body is read.
- **Pull checks Origin only when one is sent.** Browsers leave `Origin` off a same-origin `GET`, and the client's pull is a plain `GET` (Task 12). A foreign `Origin` still gets `403`, and `SameSite=Strict` keeps the cookie off any cross-site request anyway.
- **API responses carry their own CSP, `default-src 'none'`**, stricter than the app's (spec §9). A JSON response never needs to load or run anything. They also carry `Cache-Control: no-store`, so no cache between the Worker and the app can hold a pull or a session.
- **Better Auth's own logger is replaced** by one that writes only the level and the fixed message. Better Auth passes extra arguments to its logger, and the spec forbids an email or a body in the logs (§9).
- **The database connection closes after Better Auth's background tasks.** `advanced.backgroundTasks` hands work to `ctx.waitUntil`, which runs after the response. The Worker tracks those promises and closes the `pg` client only when they have settled, or they would write to a closed connection.
- **A refused sign-up is a `400` with the message "Sign-up failed".** Better Auth answers an existing email with `422`, so a probe can still tell "on the allowlist and already signed up" from "not allowed". With one allowlisted email that reveals only that my account exists. Flagged for Malin, not fixed: hiding it means replacing Better Auth's sign-up errors.
- **Better Auth's session rows store the sign-in IP and user agent, and its rate-limit rows store IPs.** Both are personal data under GDPR. Deleting the user removes its sessions. Rate-limit rows are keyed by IP and path only and are not linked to a user. Recorded here for the privacy notice that spec §14 requires before a second email is added.
- **`ALLOWED_EMAILS` is a Worker secret** (Task 0), never a `vars` entry, so my email never lands in the public repo.

**What I verified for this task (2026-09-30):** from `better-auth@1.7.6`'s source: sign-up lowercases the email (`email.toLowerCase()`) before it looks the user up and before `databaseHooks.user.create.before` runs, and sign-in looks the user up by `email.toLowerCase()`. Neither trims, so the allowlist trims and lowercases both sides itself. Sign-in answers a wrong email and a wrong password alike: `401` with `INVALID_EMAIL_OR_PASSWORD`. `auth.api.getSession({ headers, returnHeaders: true })` returns `{ headers, response }`, so a session refreshed during a sync request can pass its `Set-Cookie` on. `advanced` accepts `useSecureCookies`, `defaultCookieAttributes`, `ipAddress.ipAddressHeaders` and `backgroundTasks.handler`. `logger.log(level, message, ...args)` replaces the default logger, and `telemetry.enabled` defaults to false. `better-auth/crypto` exports `hashPassword` and `verifyPassword`. From the `workers-sdk` repository: `cloudflareTest({ wrangler: { configPath }, miniflare: { hyperdrives, bindings } })` is the plugin's config shape, and the Hyperdrive example passes a connection string through `miniflare.hyperdrives`. Wrangler 4.144.0 bundles workerd `1.20260926.1`, so the compatibility date is `2026-09-26`: a later date is refused locally.

- [ ] **Step 1: Write `wrangler.jsonc`, generate the Worker types and wire them in**

Create `wrangler.jsonc` at the repo root. Use the Hyperdrive `id` and the workers.dev subdomain from Task 0 (I handed both over in chat; neither is a secret): replace `HYPERDRIVE_ID_FROM_TASK_0` and `SUBDOMAIN_FROM_TASK_0` with them.

```jsonc
{
	"$schema": "node_modules/wrangler/config-schema.json",
	"name": "ignite",
	"main": "api/src/index.ts",
	// The newest date wrangler 4.144.0's bundled workerd supports.
	"compatibility_date": "2026-09-26",
	// Better Auth uses AsyncLocalStorage, and pg needs node:net and node:tls.
	"compatibility_flags": ["nodejs_compat"],
	"assets": {
		"directory": "dist",
		"binding": "ASSETS",
		// Only /api/* reaches the Worker. Everything else is served straight from dist/.
		"run_worker_first": ["/api/*"],
		"not_found_handling": "single-page-application"
	},
	"hyperdrive": [
		{
			"binding": "HYPERDRIVE",
			"id": "HYPERDRIVE_ID_FROM_TASK_0"
		}
	],
	// Workers Logs: route, status and counts, and CPU time per request (spec §9, §12).
	"observability": { "enabled": true },
	// ALLOWED_EMAILS and BETTER_AUTH_SECRET are secrets (wrangler secret put),
	// never vars: this file is public. .dev.vars overrides BETTER_AUTH_URL locally.
	"vars": {
		"BETTER_AUTH_URL": "https://ignite.SUBDOMAIN_FROM_TASK_0.workers.dev"
	}
}
```

Run: `npx wrangler types`
Expected: "Generating project types…" and a new `worker-configuration.d.ts` at the root. It reads `.dev.vars` for the secret names (never the values), so the generated `Env` lists `ALLOWED_EMAILS`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `HYPERDRIVE` and `ASSETS`.

In `api/tsconfig.json`, add the generated file as the first `include` entry:

```json
	"include": [
		"../worker-configuration.d.ts",
		"src/**/*.ts",
		"scripts/**/*.ts",
		"test/**/*.ts",
		"drizzle.config.ts",
		"../shared/**/*.ts",
		"../vitest.workers.config.ts"
	]
```

In `biome.json`, add `"!worker-configuration.d.ts"` to the end of `files.includes` (it is regenerated, never hand-edited).

Add the script to `package.json`. It builds first because the Worker's static-assets binding needs `dist/`:

```json
		"test:workers": "vite build && vitest run --config vitest.workers.config.ts",
```

`test:workers` is never run in CI: it needs the Neon `dev` string in my `.env` (spec §10).

- [ ] **Step 2: Write the failing pure tests**

`api/test/http.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES } from "../../shared/protocol.ts";
import {
	errorResponse,
	isJson,
	json,
	readJsonBody,
	SECURITY_HEADERS,
	safeBackground,
	sameOrigin,
	withSecurityHeaders,
} from "../src/http.ts";

const request = (headers: Record<string, string>, body?: string) =>
	new Request("https://ignite.test/api/sync/push", {
		method: body === undefined ? "GET" : "POST",
		headers,
		body,
	});

describe("sameOrigin", () => {
	it("is true only for the Worker's own origin", () => {
		expect(sameOrigin(request({ Origin: "https://ignite.test" }))).toBe(true);
		expect(sameOrigin(request({ Origin: "https://evil.test" }))).toBe(false);
		expect(sameOrigin(request({ Origin: "http://ignite.test" }))).toBe(false);
		expect(sameOrigin(request({}))).toBe(false);
	});
});

describe("isJson", () => {
	it("accepts application/json with or without a charset", () => {
		expect(isJson(request({ "Content-Type": "application/json" }, "{}"))).toBe(
			true,
		);
		expect(
			isJson(
				request({ "Content-Type": "Application/JSON; charset=utf-8" }, "{}"),
			),
		).toBe(true);
	});
	it("refuses what a cross-site form can send", () => {
		expect(isJson(request({ "Content-Type": "text/plain" }, "{}"))).toBe(false);
		expect(
			isJson(
				request({ "Content-Type": "application/x-www-form-urlencoded" }, "a=1"),
			),
		).toBe(false);
		expect(isJson(request({}))).toBe(false);
	});
});

describe("readJsonBody", () => {
	it("parses a JSON body", async () => {
		expect(await readJsonBody(request({}, '{"a":1}'))).toEqual({
			ok: true,
			body: { a: 1 },
		});
	});
	it("answers 400 to a body that isn't JSON", async () => {
		expect(await readJsonBody(request({}, "not json"))).toEqual({
			ok: false,
			status: 400,
		});
	});
	it("answers 413 past MAX_BODY_BYTES, counted in bytes", async () => {
		// 500,001 characters, but 1,000,002 bytes as UTF-8.
		const body = JSON.stringify("é".repeat(500_000));
		expect(new TextEncoder().encode(body).length).toBeGreaterThan(
			MAX_BODY_BYTES,
		);
		expect(await readJsonBody(request({}, body))).toEqual({
			ok: false,
			status: 413,
		});
	});
	it("answers 413 from a declared Content-Length without reading", async () => {
		const res = await readJsonBody(
			request({ "Content-Length": String(MAX_BODY_BYTES + 1) }, "{}"),
		);
		expect(res).toEqual({ ok: false, status: 413 });
	});
});

describe("responses", () => {
	it("json() sets the status and a JSON content type", async () => {
		const res = json(201, { a: 1 });
		expect(res.status).toBe(201);
		expect(res.headers.get("Content-Type")).toBe(
			"application/json; charset=utf-8",
		);
		expect(await res.json()).toEqual({ a: 1 });
	});

	it("errorResponse() carries only a generic message", async () => {
		const res = errorResponse(401);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "Sign in to sync" });
	});

	it("withSecurityHeaders() adds every header and keeps status and cookies", () => {
		const res = new Response("x", {
			status: 201,
			headers: [
				["Set-Cookie", "a=1"],
				["Set-Cookie", "b=2"],
			],
		});
		const out = withSecurityHeaders(res);
		expect(out.status).toBe(201);
		expect(out.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			expect(out.headers.get(name)).toBe(value);
		}
	});
});

describe("safeBackground", () => {
	it("logs a failed background write by its error name only", async () => {
		const lines: unknown[][] = [];
		const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
			lines.push(args);
		});
		try {
			// Shaped like a failed insert that quotes its parameters.
			const failure = new TypeError(
				"insert into session values ('owner@ignite.test', 'token-abc')",
			);
			await safeBackground(Promise.reject(failure));
		} finally {
			spy.mockRestore();
		}
		expect(lines).toEqual([['{"source":"background","error":"TypeError"}']]);
		expect(JSON.stringify(lines)).not.toContain("owner@ignite.test");
	});
});
```

`api/test/allowlist.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAllowlist } from "../src/auth.ts";

describe("parseAllowlist", () => {
	it("trims and lowercases every entry, and drops empty ones", () => {
		expect(parseAllowlist(" Owner@Ignite.TEST ,second@ignite.test,, ")).toEqual(
			new Set(["owner@ignite.test", "second@ignite.test"]),
		);
	});
	it("is empty for an empty setting, so nobody can sign up by mistake", () => {
		expect(parseAllowlist("")).toEqual(new Set());
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run api/test/http.test.ts api/test/allowlist.test.ts`
Expected: FAIL, "Failed to load url ../src/http.ts" (and the same for `auth.ts`).

- [ ] **Step 4: Implement `api/src/env.ts`, `api/src/http.ts` and `api/src/db.ts`**

`api/src/env.ts`:

```ts
// The Worker's bindings. ALLOWED_EMAILS and BETTER_AUTH_SECRET are secrets;
// ALLOWED_EMAILS is comma-separated and compared trimmed and lowercased.
export interface Env {
	HYPERDRIVE: Hyperdrive;
	ASSETS: Fetcher;
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	ALLOWED_EMAILS: string;
}
```

`api/src/http.ts`:

```ts
// Responses and request checks shared by every API route (spec §9).

import { MAX_BODY_BYTES } from "../../shared/protocol.ts";

// On every Worker response. The static app gets its own set from _headers
// (Task 17); _headers never applies to a response the Worker makes. A JSON
// response never loads or runs anything, so its CSP allows nothing.
export const SECURITY_HEADERS: Record<string, string> = {
	"Content-Security-Policy":
		"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
	"Strict-Transport-Security": "max-age=31536000",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "same-origin",
	"Permissions-Policy":
		"camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	"Cache-Control": "no-store",
};

// Generic on purpose: an error body never says more than this.
export const ERROR_TEXT = {
	400: "Bad request",
	401: "Sign in to sync",
	403: "Forbidden",
	404: "Not found",
	405: "Method not allowed",
	413: "Too large",
	426: "Ignite has updated. Reload to keep syncing.",
	500: "Something went wrong",
} as const;

export function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

export function errorResponse(status: keyof typeof ERROR_TEXT): Response {
	return json(status, { error: ERROR_TEXT[status] });
}

export function withSecurityHeaders(res: Response): Response {
	// A copy, because a Response from fetch() or Better Auth may have
	// immutable headers. Copying keeps every Set-Cookie.
	const out = new Response(res.body, res);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		out.headers.set(name, value);
	}
	return out;
}

export function sameOrigin(request: Request): boolean {
	const origin = request.headers.get("Origin");
	return origin !== null && origin === new URL(request.url).origin;
}

// A cross-site form can only send text/plain, urlencoded or multipart bodies,
// so requiring JSON closes that door (spec §9).
export function isJson(request: Request): boolean {
	const type = request.headers.get("Content-Type") ?? "";
	return type.split(";")[0].trim().toLowerCase() === "application/json";
}

// Reads at most MAX_BODY_BYTES, counted in bytes, then parses. A declared
// Content-Length over the limit is refused without reading anything.
export async function readJsonBody(
	request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }> {
	if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) {
		return { ok: false, status: 413 };
	}
	if (!request.body) return { ok: false, status: 400 };
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BODY_BYTES) {
			await reader.cancel();
			return { ok: false, status: 413 };
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
	} catch {
		return { ok: false, status: 400 };
	}
}

// What index.ts hands to waitUntil instead of the raw promise. The runtime logs
// a rejected waitUntil promise in full, and a failed Better Auth background
// write can quote its query parameters: a session token, an IP, a user agent.
// Only the error's name is logged here (spec §9).
export function safeBackground(promise: Promise<unknown>): Promise<unknown> {
	return promise.catch((error: unknown) =>
		console.error(
			JSON.stringify({
				source: "background",
				error: error instanceof Error ? error.name : "unknown",
			}),
		),
	);
}
```

`api/src/db.ts`:

```ts
// One pg Client per request, through Hyperdrive (Cloudflare's recommended
// pattern). Hyperdrive pools the real connections to Neon per transaction,
// which is why push takes a transaction-scoped advisory lock (spec §6.1).

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import type { Env } from "./env.ts";
import * as schema from "./schema.ts";

export type Database = NodePgDatabase<typeof schema>;

export async function connect(
	env: Env,
): Promise<{ db: Database; close: () => Promise<void> }> {
	const client = new Client({
		connectionString: env.HYPERDRIVE.connectionString,
	});
	await client.connect();
	return { db: drizzle({ client, schema }), close: () => client.end() };
}
```

- [ ] **Step 5: Implement `api/src/auth.ts`**

```ts
// Better Auth: email and password only (spec §5.4, §9).

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import type { Database } from "./db.ts";
import type { Env } from "./env.ts";
import * as schema from "./schema.ts";

const SIXTY_DAYS = 60 * 60 * 24 * 60;
const ONE_DAY = 60 * 60 * 24;

// The same message for every refused sign-up, so the allowlist can't be read
// off the answer (spec §5.4).
export const SIGN_UP_REFUSED = "Sign-up failed";

// Better Auth lowercases the email before the hook sees it but never trims.
// Trimming and lowercasing both sides here makes the setting forgiving too.
export function parseAllowlist(value: string): Set<string> {
	return new Set(
		value
			.split(",")
			.map((email) => email.trim().toLowerCase())
			.filter((email) => email.length > 0),
	);
}

export function createAuth(env: Env, db: Database, ctx: ExecutionContext) {
	const allowed = parseAllowlist(env.ALLOWED_EMAILS);
	return betterAuth({
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [env.BETTER_AUTH_URL],
		database: drizzleAdapter(db, { provider: "pg", schema }),
		// 15 characters: NIST SP 800-63B's floor for a password used on its own.
		emailAndPassword: { enabled: true, minPasswordLength: 15 },
		// "Stay signed in": 60 days, renewed once a day while in use (D12).
		// Unchecked (rememberMe false): a browser-session cookie and a one-day
		// server session.
		session: { expiresIn: SIXTY_DAYS, updateAge: ONE_DAY },
		// Stored in Postgres: in-memory counters reset whenever Cloudflare starts
		// a new Worker instance. Better Auth's own sign-in rule is 3 per 10
		// seconds, and the locked copy says "Try again in a minute", so both
		// routes get a one-minute window that makes the copy true.
		rateLimit: {
			enabled: true,
			storage: "database",
			customRules: {
				"/sign-in/email": { window: 60, max: 5 },
				"/sign-up/email": { window: 60, max: 5 },
			},
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user) => {
						if (!allowed.has(user.email.trim().toLowerCase())) {
							throw new APIError("BAD_REQUEST", { message: SIGN_UP_REFUSED });
						}
					},
				},
			},
		},
		advanced: {
			useSecureCookies: true,
			// Better Auth's default is Lax. Ignite never needs its cookie on a
			// request that starts on another site.
			defaultCookieAttributes: {
				sameSite: "strict",
				httpOnly: true,
				secure: true,
			},
			ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
			backgroundTasks: { handler: (promise) => ctx.waitUntil(promise) },
		},
		// Only the level and Better Auth's fixed message. Its extra arguments can
		// carry an email, and logs never hold one (spec §9).
		logger: {
			level: "warn",
			log: (level, message) => {
				console.log(JSON.stringify({ source: "auth", level, message }));
			},
		},
		telemetry: { enabled: false },
	});
}
```

- [ ] **Step 6: Run the pure tests to verify they pass**

Run: `npx vitest run api/test/http.test.ts api/test/allowlist.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 7 (only if Task 1 chose PBKDF2): the PBKDF2 password hash**

Read spec §12's "Decision" line from Task 1. If it says **"Better Auth's default hash"**, skip this step: `api/src/password.ts` does not exist, and the reset script uses `better-auth/crypto`. If it says **"PBKDF2-SHA-256 via WebCrypto at N iterations"** or **"… via node:crypto at N iterations"**, do this step. If it says "nothing fits", the plan has already stopped at Task 1.

Write the failing test `api/test/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	hashPassword,
	PBKDF2_ITERATIONS,
	verifyPassword,
} from "../src/password.ts";

const PASSWORD = "correct horse battery staple";

describe("PBKDF2 password hash", () => {
	it("stores a self-describing string with the iteration count", async () => {
		const hash = await hashPassword(PASSWORD);
		expect(hash).toMatch(/^pbkdf2\$\d+\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
		expect(hash.split("$")[1]).toBe(String(PBKDF2_ITERATIONS));
	});

	it("verifies the right password and refuses a wrong one", async () => {
		const hash = await hashPassword(PASSWORD);
		expect(await verifyPassword({ hash, password: PASSWORD })).toBe(true);
		expect(await verifyPassword({ hash, password: `${PASSWORD}!` })).toBe(
			false,
		);
	});

	it("salts every hash, so one password never hashes the same twice", async () => {
		expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
	});

	it("reads the iteration count from the stored string", async () => {
		const [scheme, count, salt, key] = (await hashPassword(PASSWORD)).split(
			"$",
		);
		const tampered = [scheme, String(Number(count) - 1), salt, key].join("$");
		expect(await verifyPassword({ hash: tampered, password: PASSWORD })).toBe(
			false,
		);
	});

	it("treats a password the same after Unicode normalisation (NFKC)", async () => {
		const hash = await hashPassword("ﬁfteen characters");
		expect(await verifyPassword({ hash, password: "fifteen characters" })).toBe(
			true,
		);
	});

	it("refuses anything that isn't its own format", async () => {
		for (const hash of [
			"",
			"a1b2:c3d4",
			"pbkdf2$abc$AAAA$AAAA",
			"pbkdf2$0$AAAA$AAAA",
			"pbkdf2$1000$not base64!$AAAA",
		]) {
			expect(await verifyPassword({ hash, password: PASSWORD })).toBe(false);
		}
	});
});
```

Run: `npx vitest run api/test/password.test.ts`
Expected: FAIL, "Failed to load url ../src/password.ts".

Create `api/src/password.ts`. Set `PBKDF2_ITERATIONS` to the `N` from spec §12's decision line (the `100_000` below is only the WebCrypto ceiling):

```ts
// PBKDF2-SHA-256, chosen in Task 1 because Better Auth's scrypt costs more than
// Workers Free's 10 ms of CPU (spec §12). Better Auth calls these through
// emailAndPassword.password, and api/scripts/reset-password.ts calls the same
// hashPassword, so a reset password always verifies.
//
// Stored as pbkdf2$<iterations>$<saltB64>$<hashB64>. The count travels with the
// hash, so raising PBKDF2_ITERATIONS later never breaks an older password.

// The highest count Task 1 measured inside the CPU limit (spec §12).
// Production workerd refuses WebCrypto PBKDF2 above 100,000.
export const PBKDF2_ITERATIONS = 100_000;

const SALT_BYTES = 16;
const HASH_BYTES = 32;
// Guards against a corrupted stored string asking for an absurd amount of work.
const MAX_STORED_ITERATIONS = 10_000_000;
const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function derive(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password.normalize("NFKC")),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
		key,
		HASH_BYTES * 8,
	);
	return new Uint8Array(bits);
}

// Looks at every byte, so the time taken never says where two hashes differ.
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derive(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword({
	hash,
	password,
}: {
	hash: string;
	password: string;
}): Promise<boolean> {
	const parts = hash.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
	const iterations = Number(parts[1]);
	if (
		!Number.isInteger(iterations) ||
		iterations < 1 ||
		iterations > MAX_STORED_ITERATIONS
	) {
		return false;
	}
	let salt: Uint8Array;
	let expected: Uint8Array;
	try {
		salt = fromBase64(parts[2]);
		expected = fromBase64(parts[3]);
	} catch {
		return false;
	}
	if (salt.length === 0 || expected.length !== HASH_BYTES) return false;
	return equalBytes(await derive(password, salt, iterations), expected);
}
```

**If the decision says "via node:crypto"**, replace the `derive` function (and delete the now-unused `encoder` constant) with this version. It produces the same bytes for the same inputs (checked in Task 1), and `node:crypto` is available through `nodejs_compat`:

```ts
import { pbkdf2 } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);

async function derive(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const key = await pbkdf2Async(
		password.normalize("NFKC"),
		salt,
		iterations,
		HASH_BYTES,
		"sha256",
	);
	return new Uint8Array(key);
}
```

(The two `import` lines go at the top of the file.)

Wire it into Better Auth. In `api/src/auth.ts`, add `import { hashPassword, verifyPassword } from "./password.ts";` and change the `emailAndPassword` line to:

```ts
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 15,
			password: { hash: hashPassword, verify: verifyPassword },
		},
```

Run: `npx vitest run api/test/password.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 8: Write the Workers test helpers and the failing handler tests**

Create `vitest.workers.config.ts` at the repo root:

```ts
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Handler tests run inside workerd against the Neon dev branch. Local only:
// CI holds no database secret and never runs this file (spec §10).
try {
	process.loadEnvFile();
} catch {
	// No .env: DATABASE_URL must come from the environment.
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error("Set DATABASE_URL in .env to the Neon dev branch first.");
}

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				hyperdrives: { HYPERDRIVE: databaseUrl },
				bindings: {
					BETTER_AUTH_URL: "https://ignite.test",
					BETTER_AUTH_SECRET: "handler-tests-only-0123456789abcdef0123456789",
					// Spaces and capitals on purpose: the allowlist trims and lowercases.
					ALLOWED_EMAILS:
						" Owner@ignite.test, cookie@ignite.test,push-a@ignite.test, push-b@ignite.test,pull-a@ignite.test,pull-b@ignite.test,pull-c@ignite.test ",
				},
			},
		}),
	],
	test: {
		include: ["api/test/workers/**/*.test.ts"],
		testTimeout: 30_000,
		hookTimeout: 30_000,
	},
});
```

The test emails use `.test`, a domain reserved for testing, so none of them can belong to a real person.

`api/test/workers/helpers.ts`:

```ts
import { env, exports } from "cloudflare:workers";
import { inArray } from "drizzle-orm";
import { connect, type Database } from "../../src/db.ts";
import type { Env } from "../../src/env.ts";
import { user } from "../../src/schema.ts";

export const ORIGIN = "https://ignite.test";
export const PASSWORD = "correct horse battery staple";
export const testEnv = env as unknown as Env;

// A fresh client IP per request, so Better Auth's rate limiter (5 sign-ins per
// 60 seconds per IP, auth.ts) never trips across tests.
function randomIp(): string {
	const [a, b, c] = crypto.getRandomValues(new Uint8Array(3));
	return `10.${a}.${b}.${c}`;
}

export type CallOptions = {
	method?: string;
	body?: unknown;
	raw?: string;
	cookie?: string;
	origin?: string | null;
	contentType?: string | null;
};

// A request to the Worker, shaped like the app's own: same Origin and JSON.
export function call(
	path: string,
	options: CallOptions = {},
): Promise<Response> {
	const body =
		options.raw ??
		(options.body === undefined ? undefined : JSON.stringify(options.body));
	const headers = new Headers({ "cf-connecting-ip": randomIp() });
	if (options.origin !== null) headers.set("Origin", options.origin ?? ORIGIN);
	if (body !== undefined && options.contentType !== null) {
		headers.set("Content-Type", options.contentType ?? "application/json");
	}
	if (options.cookie) headers.set("Cookie", options.cookie);
	return exports.default.fetch(
		new Request(`${ORIGIN}${path}`, {
			method: options.method ?? (body === undefined ? "GET" : "POST"),
			headers,
			body,
		}),
	);
}

// Every cookie the response set, as a Cookie request header.
export function cookieHeader(res: Response): string {
	return res.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
}

export async function signUp(
	email: string,
): Promise<{ userId: string; cookie: string }> {
	const res = await call("/api/auth/sign-up/email", {
		body: { name: email, email, password: PASSWORD, rememberMe: false },
	});
	if (res.status !== 200) throw new Error(`Sign-up answered ${res.status}`);
	const body = (await res.json()) as { user: { id: string } };
	return { userId: body.user.id, cookie: cookieHeader(res) };
}

export async function withDb<T>(fn: (db: Database) => Promise<T>): Promise<T> {
	const { db, close } = await connect(testEnv);
	try {
		return await fn(db);
	} finally {
		await close();
	}
}

// ON DELETE CASCADE takes each user's sessions, rows and tombstones with it.
export function deleteUsers(emails: string[]): Promise<void> {
	return withDb(async (db) => {
		await db.delete(user).where(
			inArray(
				user.email,
				emails.map((email) => email.toLowerCase()),
			),
		);
	});
}
```

`api/test/workers/auth.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../../src/http.ts";
import { user } from "../../src/schema.ts";
import {
	call,
	cookieHeader,
	deleteUsers,
	PASSWORD,
	withDb,
} from "./helpers.ts";

const OWNER = "owner@ignite.test";
const COOKIE = "cookie@ignite.test";
const STRANGER = "stranger@ignite.test";
const EMAILS = [OWNER, COOKIE, STRANGER];

beforeAll(() => deleteUsers(EMAILS));
afterAll(() => deleteUsers(EMAILS));

const signUpBody = (email: string) => ({
	name: email,
	email,
	password: PASSWORD,
	rememberMe: false,
});

describe("sign-up allowlist", () => {
	it("refuses an email that isn't on the list, with the generic message", async () => {
		const res = await call("/api/auth/sign-up/email", {
			body: signUpBody(STRANGER),
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as { message?: string }).message).toBe(
			"Sign-up failed",
		);
		const rows = await withDb((db) =>
			db.select().from(user).where(eq(user.email, STRANGER)),
		);
		expect(rows).toEqual([]);
	});

	it("matches the list whatever the case, and sign-in does too", async () => {
		// The list holds " Owner@ignite.test".
		const up = await call("/api/auth/sign-up/email", {
			body: signUpBody("Owner@Ignite.TEST"),
		});
		expect(up.status).toBe(200);
		const signIn = await call("/api/auth/sign-in/email", {
			body: {
				email: "OWNER@ignite.test",
				password: PASSWORD,
				rememberMe: false,
			},
		});
		expect(signIn.status).toBe(200);
	});

	it("answers a wrong password with 401", async () => {
		const res = await call("/api/auth/sign-in/email", {
			body: { email: OWNER, password: `${PASSWORD}!`, rememberMe: false },
		});
		expect(res.status).toBe(401);
	});

	// Task 12's client maps these two answers to its own copy, so they are
	// pinned here against the real Better Auth.
	it("answers an email that already has an account with 422", async () => {
		// OWNER signed up two tests above.
		const res = await call("/api/auth/sign-up/email", {
			body: signUpBody(OWNER),
		});
		expect(res.status).toBe(422);
		expect(((await res.json()) as { code?: string }).code).toBe(
			"USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
		);
	});

	it("answers a 14-character password with 400 PASSWORD_TOO_SHORT", async () => {
		// COOKIE is on the list and has no account yet. Nothing is created.
		const res = await call("/api/auth/sign-up/email", {
			body: { ...signUpBody(COOKIE), password: "x".repeat(14) },
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as { code?: string }).code).toBe(
			"PASSWORD_TOO_SHORT",
		);
	});
});

describe("the session cookie", () => {
	it("is HttpOnly, Secure and SameSite=Strict", async () => {
		const res = await call("/api/auth/sign-up/email", {
			body: signUpBody(COOKIE),
		});
		expect(res.status).toBe(200);
		const session = res.headers
			.getSetCookie()
			.find((cookie) => cookie.includes("session_token="));
		expect(session).toBeDefined();
		expect(session).toMatch(/;\s*HttpOnly/i);
		expect(session).toMatch(/;\s*Secure/i);
		expect(session).toMatch(/;\s*SameSite=Strict/i);
	});

	it("is cleared on sign-out with Clear-Site-Data, and the session ends", async () => {
		const signIn = await call("/api/auth/sign-in/email", {
			body: { email: COOKIE, password: PASSWORD, rememberMe: false },
		});
		const cookie = cookieHeader(signIn);
		const out = await call("/api/auth/sign-out", { body: {}, cookie });
		expect(out.status).toBe(200);
		expect(out.headers.get("Clear-Site-Data")).toBe('"cookies"');

		const session = await call("/api/auth/get-session", { cookie });
		expect(await session.json()).toBeNull();
	});
});

describe("Better Auth responses", () => {
	it("carry the security headers", async () => {
		const res = await call("/api/auth/get-session");
		expect(res.status).toBe(200);
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			expect(res.headers.get(name)).toBe(value);
		}
	});
});
```

`api/test/workers/routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "../../../shared/protocol.ts";
import { SECURITY_HEADERS } from "../../src/http.ts";
import { call } from "./helpers.ts";

const PUSH = "/api/sync/push";
const PULL = `/api/sync/pull?since=0&protocol=${PROTOCOL_VERSION}`;
const body = { protocol: PROTOCOL_VERSION, changes: [] };

describe("sync routes without a session", () => {
	it("answer a push with 401 before reading the body", async () => {
		const res = await call(PUSH, { raw: "this is not JSON" });
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "Sign in to sync" });
	});

	it("answer a pull with 401", async () => {
		expect((await call(PULL)).status).toBe(401);
	});

	it("carry the security headers", async () => {
		const res = await call(PULL);
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			expect(res.headers.get(name)).toBe(value);
		}
	});
});

describe("cross-site requests", () => {
	it("refuse a push from another origin", async () => {
		expect(
			(await call(PUSH, { body, origin: "https://evil.test" })).status,
		).toBe(403);
	});

	it("refuse a push with no Origin", async () => {
		expect((await call(PUSH, { body, origin: null })).status).toBe(403);
	});

	it("refuse a push sent the way a form can (text/plain)", async () => {
		expect((await call(PUSH, { body, contentType: "text/plain" })).status).toBe(
			403,
		);
	});

	it("refuse a pull from another origin", async () => {
		expect((await call(PULL, { origin: "https://evil.test" })).status).toBe(
			403,
		);
	});

	it("let a pull with no Origin through, as a browser sends a same-origin GET", async () => {
		expect((await call(PULL, { origin: null })).status).toBe(401);
	});
});

describe("everything else", () => {
	it("answers an unknown API path with a JSON 404", async () => {
		const res = await call("/api/nothing-here");
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Not found" });
	});

	it("answers the wrong method with 405", async () => {
		expect((await call(PUSH, { method: "GET" })).status).toBe(405);
	});

	it("serves the app for a path outside /api/", async () => {
		const res = await call("/", { origin: null });
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/html");
	});
});
```

Run: `npm run test:workers`
Expected: FAIL. The build succeeds, then Vitest reports it can't resolve `api/src/index.ts` (the `main` in `wrangler.jsonc`).

- [ ] **Step 9: Implement the Worker entry and the handler stubs**

`api/src/push.ts` (Task 9 replaces the whole file):

```ts
// Replaced in Task 9. Until then a signed-in push gets a plain 501.
import type { Database } from "./db.ts";

export async function handlePush(
	_db: Database,
	_userId: string,
	_body: unknown,
	_now?: Date,
): Promise<{ status: number; json: unknown }> {
	return { status: 501, json: { error: "Not built yet" } };
}
```

`api/src/pull.ts` (Task 10 replaces the whole file):

```ts
// Replaced in Task 10. Until then a signed-in pull gets a plain 501.
import type { Database } from "./db.ts";

export async function handlePull(
	_db: Database,
	_userId: string,
	_url: URL,
): Promise<{ status: number; json: unknown }> {
	return { status: 501, json: { error: "Not built yet" } };
}
```

`api/src/index.ts`:

```ts
// The one Worker (spec §3, §5.1). /api/auth/* goes to Better Auth, the two sync
// routes to their handlers, and every other path to the static app. Three
// prefixes need no router library.

import { createAuth } from "./auth.ts";
import { connect } from "./db.ts";
import type { Env } from "./env.ts";
import {
	errorResponse,
	isJson,
	json,
	readJsonBody,
	safeBackground,
	sameOrigin,
	withSecurityHeaders,
} from "./http.ts";
import { handlePull } from "./pull.ts";
import { handlePush } from "./push.ts";

const PUSH = "/api/sync/push";
const PULL = "/api/sync/pull";
const SIGN_OUT = "/api/auth/sign-out";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		// run_worker_first sends only /api/* here in production. The fallback
		// keeps any other path working if that setting ever changes.
		if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

		let res: Response;
		try {
			res = await routeApi(request, url, env, ctx);
		} catch (error) {
			// The error's name only: a message or a stack can carry row content.
			console.error(
				JSON.stringify({
					route: url.pathname,
					status: 500,
					error: error instanceof Error ? error.name : "unknown",
				}),
			);
			res = errorResponse(500);
		}
		console.log(JSON.stringify({ route: url.pathname, status: res.status }));
		return withSecurityHeaders(res);
	},
} satisfies ExportedHandler<Env>;

async function routeApi(
	request: Request,
	url: URL,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const path = url.pathname;
	const isAuth = path.startsWith("/api/auth/");
	if (!isAuth && path !== PUSH && path !== PULL) return errorResponse(404);

	if (path === PUSH) {
		if (request.method !== "POST") return errorResponse(405);
		// CSRF (spec §9): a cross-site form can't send JSON, and a cross-site
		// fetch carries its own Origin.
		if (!sameOrigin(request) || !isJson(request)) return errorResponse(403);
	}
	if (path === PULL) {
		if (request.method !== "GET") return errorResponse(405);
		// Browsers omit Origin on a same-origin GET, so only a foreign one is refused.
		if (request.headers.has("Origin") && !sameOrigin(request)) {
			return errorResponse(403);
		}
	}

	const { db, close } = await connect(env);
	const pending: Promise<unknown>[] = [];
	try {
		const auth = createAuth(env, db, trackWaitUntil(ctx, pending));

		if (isAuth) {
			const res = await auth.handler(request);
			if (path !== SIGN_OUT || !res.ok) return res;
			// Better Auth has no Clear-Site-Data of its own (spec §7, §15).
			const out = new Response(res.body, res);
			out.headers.set("Clear-Site-Data", '"cookies"');
			return out;
		}

		// user_id comes from the session, never from the body (spec §9), and a
		// request without one is refused before its body is read.
		const found = await auth.api.getSession({
			headers: request.headers,
			returnHeaders: true,
		});
		if (!found.response) return errorResponse(401);
		const userId = found.response.user.id;

		let result: { status: number; json: unknown };
		if (path === PUSH) {
			const body = await readJsonBody(request);
			if (!body.ok) return errorResponse(body.status);
			result = await handlePush(db, userId, body.body);
		} else {
			result = await handlePull(db, userId, url);
		}
		const res = json(result.status, result.json);
		// A session renewed during this request sends its new cookie here.
		for (const cookie of found.headers.getSetCookie()) {
			res.headers.append("Set-Cookie", cookie);
		}
		return res;
	} finally {
		// Better Auth's background tasks run after the response through
		// waitUntil and still need the connection, so it closes after them.
		ctx.waitUntil(
			drain(pending)
				.then(close)
				.catch(() => {
					// The response is already sent. A failed close only costs a pooled connection.
				}),
		);
	}
}

// The real context, except that waitUntil also records each promise.
function trackWaitUntil(
	ctx: ExecutionContext,
	pending: Promise<unknown>[],
): ExecutionContext {
	return new Proxy(ctx, {
		get(target, property) {
			if (property === "waitUntil") {
				return (promise: Promise<unknown>) => {
					// Never the raw promise: the runtime would log its rejection in
					// full, and a Better Auth write can carry a session token.
					const safe = safeBackground(promise);
					pending.push(safe);
					target.waitUntil(safe);
				};
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

// A background task may start another one, so drain until none are left.
async function drain(pending: Promise<unknown>[]): Promise<void> {
	while (pending.length > 0) await Promise.allSettled(pending.splice(0));
}
```

Run: `npm run test:workers`
Expected: PASS, 19 tests (8 in `auth.test.ts`, 11 in `routes.test.ts`). If the first run fails to connect with an SSL or `ECONNRESET` error, check that `DATABASE_URL` in `.env` (Task 0, Step 8) contains `sslmode=require`. Neon's free compute sleeps after 5 minutes, so the first test in a run may take a second or two longer.

- [ ] **Step 10: Write the admin scripts**

These run with Node on my machine against whichever Neon branch `DATABASE_URL` names: `.env`'s `dev` string by default, or `main` when I set it in the shell. They import only `auth-schema.ts` and (if it exists) `password.ts`, both free of relative imports, so Node can run them without a build step. Run them in PowerShell or Windows Terminal: Git Bash's terminal doesn't give Node the raw keyboard input that `readHidden` needs.

`api/scripts/lib.ts`:

```ts
// Shared by the admin scripts. Never bundled into the Worker.

import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";

export async function openDatabase(): Promise<{
	db: NodePgDatabase;
	target: string;
	close: () => Promise<void>;
}> {
	try {
		process.loadEnvFile();
	} catch {
		// No .env: DATABASE_URL must come from the shell.
	}
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("Set DATABASE_URL to the Neon branch to change.");
	const client = new Client({ connectionString: url });
	await client.connect();
	// The host names the Neon branch endpoint, so I can see dev from main.
	// The password in the URL is never printed.
	return {
		db: drizzle({ client }),
		target: new URL(url).host,
		close: () => client.end(),
	};
}

export async function readLine(prompt: string): Promise<string> {
	const rl = createInterface({ input: stdin, output: stdout });
	try {
		return await rl.question(prompt);
	} finally {
		rl.close();
	}
}

// Reads a line without echoing it, so a password never shows on screen or
// lands in shell history. Paste works; Backspace removes one character.
export function readHidden(prompt: string): Promise<string> {
	if (!stdin.isTTY) {
		return Promise.reject(
			new Error("Run this in PowerShell or Windows Terminal."),
		);
	}
	stdout.write(prompt);
	stdin.setRawMode(true);
	stdin.resume();
	stdin.setEncoding("utf8");
	let value = "";
	return new Promise((resolve, reject) => {
		const finish = () => {
			stdin.off("data", onData);
			stdin.setRawMode(false);
			stdin.pause();
			stdout.write("\n");
		};
		const onData = (chunk: string) => {
			for (const char of chunk) {
				if (char === "\r" || char === "\n") {
					finish();
					resolve(value);
					return;
				}
				if (char === "\u0003") {
					finish();
					reject(new Error("Cancelled."));
					return;
				}
				if (char === "\u007f" || char === "\b") {
					value = [...value].slice(0, -1).join("");
				} else {
					value += char;
				}
			}
		};
		stdin.on("data", onData);
	});
}
```

`api/scripts/reset-password.ts`:

```ts
// Sets a new password for one account and signs it out everywhere (spec §5.4).
// Usage: node api/scripts/reset-password.ts <email>
// Targets DATABASE_URL (.env's dev branch unless the shell sets main).

import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { account, session, user } from "../src/auth-schema.ts";
import { openDatabase, readHidden } from "./lib.ts";

const MIN_LENGTH = 15;

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
	console.error("Usage: node api/scripts/reset-password.ts <email>");
	process.exit(1);
}

const { db, target, close } = await openDatabase();
try {
	console.log(`Database: ${target}`);
	const [found] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email));
	if (!found) throw new Error("No account with that email.");

	const password = await readHidden(
		`New password (at least ${MIN_LENGTH} characters): `,
	);
	if (password.length < MIN_LENGTH) {
		throw new Error(`Password must be at least ${MIN_LENGTH} characters.`);
	}
	if ((await readHidden("Type it again: ")) !== password) {
		throw new Error("The two passwords differ. Nothing changed.");
	}

	// The same function the Worker's sign-in verifies with.
	const hash = await hashPassword(password);
	const updated = await db
		.update(account)
		.set({ password: hash, updatedAt: new Date() })
		.where(
			and(eq(account.userId, found.id), eq(account.providerId, "credential")),
		)
		.returning({ id: account.id });
	if (updated.length === 0)
		throw new Error("That account has no password sign-in.");

	await db.delete(session).where(eq(session.userId, found.id));
	console.log(
		"Password changed. Every session for this account is signed out.",
	);
} finally {
	await close();
}
```

**If Task 1 chose PBKDF2** (Step 7 ran), change the first import to `import { hashPassword } from "../src/password.ts";`. The Worker then verifies with `password.ts`, and a reset hashed with Better Auth's scrypt would never verify.

`api/scripts/delete-user.ts`:

```ts
// Deletes one account and everything it owns (spec §5.4, §14). ON DELETE
// CASCADE removes its sessions, its rows and its tombstones in the same statement.
// Usage: node api/scripts/delete-user.ts <email>
// Targets DATABASE_URL (.env's dev branch unless the shell sets main).

import { eq } from "drizzle-orm";
import { user } from "../src/auth-schema.ts";
import { openDatabase, readLine } from "./lib.ts";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
	console.error("Usage: node api/scripts/delete-user.ts <email>");
	process.exit(1);
}

const { db, target, close } = await openDatabase();
try {
	console.log(`Database: ${target}`);
	const typed = await readLine(
		"Type the email again to delete the account and all its data: ",
	);
	if (typed.trim().toLowerCase() !== email) {
		throw new Error("The emails differ. Nothing was deleted.");
	}
	const deleted = await db
		.delete(user)
		.where(eq(user.email, email))
		.returning({ id: user.id });
	if (deleted.length === 0) {
		console.log("No account with that email. Nothing was deleted.");
	} else {
		console.log(
			"Deleted the account, its sessions, its data and its tombstones.",
		);
		// Neon Free keeps a 6-hour restore window (checked 2026-09-30).
		console.log("Neon's restore history still holds it for up to 6 hours.");
	}
} finally {
	await close();
}
```

- [ ] **Step 11: Try the Worker and the scripts by hand against `dev`**

Terminal 1: `npm run build && npx wrangler dev`
Expected: "Ready on http://localhost:8787". Wrangler says it found `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`. The app at `/` still expects the `/ignite/` base until Task 15, so only the API is checked here.

Terminal 2 (Git Bash):

```bash
curl -si "http://localhost:8787/api/sync/pull?since=0&protocol=1" | head -n 12
```

Expected: `HTTP/1.1 401 Unauthorized`, the six `SECURITY_HEADERS`, and the body `{"error":"Sign in to sync"}`.

Then run the scripts against a throwaway account. `EMAIL` is my allowlisted email from `.dev.vars`. The two passwords are throwaway values used only here (they stay in shell history, which is why they must not be real ones):

```bash
EMAIL="the email in .dev.vars"
post() { curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:8787/api/auth/$1" -H "Origin: http://localhost:8787" -H "Content-Type: application/json" -d "$2"; }
post sign-up/email "{\"name\":\"$EMAIL\",\"email\":\"$EMAIL\",\"password\":\"first throwaway password\",\"rememberMe\":false}"
```

Expected: `200`.

In PowerShell: `node api/scripts/reset-password.ts <the same email>`, and type `second throwaway password` twice.
Expected: `Database: ep-….neon.tech` (the `dev` host), then "Password changed. Every session for this account is signed out."

Back in Git Bash:

```bash
post sign-in/email "{\"email\":\"$EMAIL\",\"password\":\"first throwaway password\",\"rememberMe\":false}"
post sign-in/email "{\"email\":\"$EMAIL\",\"password\":\"second throwaway password\",\"rememberMe\":false}"
```

Expected: `401`, then `200`.

In PowerShell: `node api/scripts/delete-user.ts <the same email>`, and type the email again.
Expected: "Deleted the account, its sessions, its data and its tombstones." Then the second `post sign-in/email` line again in Git Bash answers `401`.

Stop `wrangler dev` with Ctrl+C.

- [ ] **Step 12: Run every check**

Run: `npx biome check --write api vitest.workers.config.ts wrangler.jsonc && npm run check && npm run test:run && npm run test:workers`
Expected: no errors from Biome or either `tsc` run; every plain test passes; the Workers suite passes.

- [ ] **Step 13: Commit**

```bash
git add wrangler.jsonc worker-configuration.d.ts vitest.workers.config.ts package.json biome.json api/tsconfig.json api/src/env.ts api/src/http.ts api/src/db.ts api/src/auth.ts api/src/index.ts api/src/push.ts api/src/pull.ts api/scripts api/test/http.test.ts api/test/allowlist.test.ts api/test/workers
git commit -m "feat(api): Worker entry, Better Auth with an allowlist, admin scripts"
```

If Step 7 ran, add `api/src/password.ts api/test/password.test.ts` to the `git add` line.

---

### Task 9: The push handler

Apply a batch of changes in one transaction, serialised per user, with last write wins per row, tombstones for deletes and a fresh `server_seq` for every accepted write. Spec §6.1, D5, D7, D13.

**Files:**
- Modify: `api/src/push.ts` (replace the Task 8 stub, whole file)
- Test: `api/test/push-plan.test.ts`, `api/test/workers/push.test.ts`

**Interfaces:**
- Consumes: `parsePushRequest`, `parseChange`, `ParsedChange` (Task 7); `clampUpdatedAt`, `decide` (Task 7); `tableFor`, `rowToRecord`, `recordToRow`, `DataTable`, `DataInsert` (Task 6); `tombstones`, `NEXT_SERVER_SEQ` (Task 6); `ERROR_TEXT` (Task 8); `keyOf`, `STORES`, `Row`, `Store`, `PushResponse`, `ServerVersion` (Task 2).
- Produces:
  - `handlePush(db: Database, userId: string, body: unknown, now?: Date): Promise<{ status: number; json: unknown }>` (CONTRACT). `json` is a `PushResponse` on `200`, or `{ error }` on `400`, `413`, `426`.
  - Added beyond CONTRACT: `planPush(parsed: ParsedChange[], rows: Map<string, Row>, tombs: Map<string, string>, now: Date): PushPlan` and `type PushPlan = { upserts: { store: Store; record: Row }[]; deletes: { store: Store; id: string; deletedAt: string }[]; clearTombstones: { store: Store; id: string }[]; response: PushResponse }`. `rows` maps `keyOf(store, id)` to the stored wire record; `tombs` maps it to `deletedAt`.

**How one push runs.** Inside one transaction:

1. `pg_advisory_xact_lock(hashtext(user_id))`. A second push for the same user waits here until the first commits, so `server_seq` values become visible in the order they were handed out (D13). The lock ends with the transaction, which is what Hyperdrive's per-transaction pooling needs.
2. Read what the server holds for every key in the batch: one query per store present, plus one for tombstones.
3. `planPush()` decides every change in plain JavaScript. It is pure and has its own tests.
4. Write the plan: one upsert per store, one delete per store, one tombstone delete and one tombstone upsert. At most ten write queries, whatever the batch size.

**No `setWhere` on the upserts.** Drizzle 0.45 supports `onConflictDoUpdate({ target, set, setWhere })`, and spec §6.1 sketches `WHERE excluded.updated_at > table.updated_at`. Under the advisory lock, the rows `planPush` decided on are exactly the rows being written, so the decision is already made. A SQL `WHERE` could only disagree if the lock were broken, and then it would quietly skip a row the response calls `accepted`. Without it, what the response says is what happened.

**Duplicate keys in one batch are `invalid`.** The client's outbox holds one entry per key, so a real client never sends a duplicate. But `ON CONFLICT` refuses to touch one row twice in one statement, so a duplicate would fail the whole batch, and the retry would fail the same way forever. Every copy of the key is refused, and the key is reported once, with the server's version.

- [ ] **Step 1: Write the failing plan tests**

`api/test/push-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Row } from "../../shared/protocol.ts";
import { planPush } from "../src/push.ts";
import type { ParsedChange } from "../src/validate.ts";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const at = (hour: number) => new Date(Date.UTC(2026, 8, 1, hour)).toISOString();

const record = (id: string, updatedAt: string, title = "A"): Row => ({
	id,
	title,
	updatedAt,
});
const put = (id: string, updatedAt: string, title?: string): ParsedChange => ({
	ok: true,
	change: {
		store: "tasks",
		id,
		op: "put",
		record: record(id, updatedAt, title),
	},
});
const del = (id: string, deletedAt: string): ParsedChange => ({
	ok: true,
	change: { store: "tasks", id, op: "delete", deletedAt },
});
const bad = (store: "tasks" | null, id: string | null): ParsedChange => ({
	ok: false,
	store,
	id,
});

const noRows = new Map<string, Row>();
const noTombs = new Map<string, string>();

describe("planPush: puts", () => {
	it("accepts a key the server has never seen", () => {
		const plan = planPush([put("t1", at(1))], noRows, noTombs, NOW);
		expect(plan.upserts).toEqual([
			{ store: "tasks", record: record("t1", at(1)) },
		]);
		expect(plan.response).toEqual({
			accepted: ["tasks:t1"],
			lost: [],
			invalid: [],
		});
	});

	it("accepts a newer edit", () => {
		const rows = new Map([["tasks:t1", record("t1", at(1), "old")]]);
		const plan = planPush([put("t1", at(2), "new")], rows, noTombs, NOW);
		expect(plan.upserts).toHaveLength(1);
		expect(plan.response.accepted).toEqual(["tasks:t1"]);
	});

	it("loses to a newer row and hands the winner back", () => {
		const winner = record("t1", at(2), "theirs");
		const rows = new Map([["tasks:t1", winner]]);
		const plan = planPush([put("t1", at(1), "mine")], rows, noTombs, NOW);
		expect(plan.upserts).toEqual([]);
		expect(plan.response.lost).toEqual([
			{ store: "tasks", id: "t1", kind: "row", record: winner },
		]);
	});

	it("loses a retried push (equal time) with an identical row", () => {
		const stored = record("t1", at(1));
		const rows = new Map([["tasks:t1", stored]]);
		const plan = planPush([put("t1", at(1))], rows, noTombs, NOW);
		expect(plan.response.lost).toEqual([
			{ store: "tasks", id: "t1", kind: "row", record: stored },
		]);
	});

	it("brings a deleted task back when the edit is newer than the delete", () => {
		const tombs = new Map([["tasks:t1", at(1)]]);
		const plan = planPush([put("t1", at(2))], noRows, tombs, NOW);
		expect(plan.upserts).toHaveLength(1);
		expect(plan.clearTombstones).toEqual([{ store: "tasks", id: "t1" }]);
		expect(plan.response.accepted).toEqual(["tasks:t1"]);
	});

	it("loses to a newer delete and hands the tombstone back", () => {
		const tombs = new Map([["tasks:t1", at(2)]]);
		const plan = planPush([put("t1", at(1))], noRows, tombs, NOW);
		expect(plan.upserts).toEqual([]);
		expect(plan.response.lost).toEqual([
			{ store: "tasks", id: "t1", kind: "tombstone", deletedAt: at(2) },
		]);
	});

	it("clamps a time from a fast clock before deciding and before storing", () => {
		const plan = planPush(
			[put("t1", "2099-01-01T00:00:00.000Z")],
			noRows,
			noTombs,
			NOW,
		);
		expect(plan.upserts[0].record.updatedAt).toBe("2026-10-01T12:00:05.000Z");
	});
});

describe("planPush: deletes", () => {
	it("deletes a row with a newer delete and writes a tombstone", () => {
		const rows = new Map([["tasks:t1", record("t1", at(1))]]);
		const plan = planPush([del("t1", at(2))], rows, noTombs, NOW);
		expect(plan.deletes).toEqual([
			{ store: "tasks", id: "t1", deletedAt: at(2) },
		]);
		expect(plan.response.accepted).toEqual(["tasks:t1"]);
	});

	it("loses a delete older than the stored edit", () => {
		const winner = record("t1", at(2));
		const rows = new Map([["tasks:t1", winner]]);
		const plan = planPush([del("t1", at(1))], rows, noTombs, NOW);
		expect(plan.deletes).toEqual([]);
		expect(plan.response.lost).toEqual([
			{ store: "tasks", id: "t1", kind: "row", record: winner },
		]);
	});

	it("writes a tombstone for a key the server has never seen", () => {
		const plan = planPush([del("t1", at(1))], noRows, noTombs, NOW);
		expect(plan.deletes).toEqual([
			{ store: "tasks", id: "t1", deletedAt: at(1) },
		]);
	});
});

describe("planPush: invalid changes", () => {
	it("reports the server's row for an invalid change", () => {
		const stored = record("t1", at(1));
		const rows = new Map([["tasks:t1", stored]]);
		const plan = planPush([bad("tasks", "t1")], rows, noTombs, NOW);
		expect(plan.response.invalid).toEqual([
			{ store: "tasks", id: "t1", kind: "row", record: stored },
		]);
	});

	it("reports none when the server holds nothing for the key", () => {
		const plan = planPush([bad("tasks", "t1")], noRows, noTombs, NOW);
		expect(plan.response.invalid).toEqual([
			{ store: "tasks", id: "t1", kind: "none" },
		]);
	});

	it("drops a change with no readable key", () => {
		const plan = planPush(
			[bad(null, "t1"), bad("tasks", null)],
			noRows,
			noTombs,
			NOW,
		);
		expect(plan.response).toEqual({ accepted: [], lost: [], invalid: [] });
	});

	it("refuses every copy of a key sent twice, and reports it once", () => {
		const plan = planPush(
			[put("t1", at(1)), put("t2", at(1)), del("t1", at(2))],
			noRows,
			noTombs,
			NOW,
		);
		expect(plan.upserts.map((u) => u.record.id)).toEqual(["t2"]);
		expect(plan.deletes).toEqual([]);
		expect(plan.response.accepted).toEqual(["tasks:t2"]);
		expect(plan.response.invalid).toEqual([
			{ store: "tasks", id: "t1", kind: "none" },
		]);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run api/test/push-plan.test.ts`
Expected: FAIL, "planPush is not a function" (the Task 8 stub exports only `handlePush`).

- [ ] **Step 3: Replace `api/src/push.ts`**

```ts
// POST /api/sync/push (spec §6.1). One transaction per push, serialised per
// user by a transaction-scoped advisory lock, so server_seq values become
// visible in the order they were handed out and a pull can never skip one (D13).

import {
	and,
	eq,
	getTableColumns,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import {
	keyOf,
	type PushResponse,
	type Row,
	type ServerVersion,
	STORES,
	type Store,
} from "../../shared/protocol.ts";
import type { Database } from "./db.ts";
import { clampUpdatedAt, decide } from "./decide.ts";
import { ERROR_TEXT } from "./http.ts";
import {
	type DataInsert,
	type DataTable,
	recordToRow,
	rowToRecord,
	tableFor,
} from "./records.ts";
import { NEXT_SERVER_SEQ, tombstones } from "./schema.ts";
import {
	type ParsedChange,
	parseChange,
	parsePushRequest,
} from "./validate.ts";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type PushPlan = {
	upserts: { store: Store; record: Row }[];
	deletes: { store: Store; id: string; deletedAt: string }[];
	clearTombstones: { store: Store; id: string }[];
	response: PushResponse;
};

function keyParts(parsed: ParsedChange): { store: Store; id: string } | null {
	if (parsed.ok) return { store: parsed.change.store, id: parsed.change.id };
	return parsed.store && parsed.id
		? { store: parsed.store, id: parsed.id }
		: null;
}

function serverVersion(
	store: Store,
	id: string,
	rows: Map<string, Row>,
	tombs: Map<string, string>,
): ServerVersion {
	const key = keyOf(store, id);
	const record = rows.get(key);
	if (record) return { store, id, kind: "row", record };
	const deletedAt = tombs.get(key);
	if (deletedAt) return { store, id, kind: "tombstone", deletedAt };
	return { store, id, kind: "none" };
}

// Pure: decides every change against what the server holds. A key has a row or
// a tombstone, never both, so "current" is whichever exists.
export function planPush(
	parsed: ParsedChange[],
	rows: Map<string, Row>,
	tombs: Map<string, string>,
	now: Date,
): PushPlan {
	const plan: PushPlan = {
		upserts: [],
		deletes: [],
		clearTombstones: [],
		response: { accepted: [], lost: [], invalid: [] },
	};

	const seen = new Map<string, number>();
	for (const p of parsed) {
		const parts = keyParts(p);
		if (parts) {
			const key = keyOf(parts.store, parts.id);
			seen.set(key, (seen.get(key) ?? 0) + 1);
		}
	}

	const reported = new Set<string>();
	for (const p of parsed) {
		const parts = keyParts(p);
		if (!parts) continue; // nothing to report it under
		const key = keyOf(parts.store, parts.id);
		const current = serverVersion(parts.store, parts.id, rows, tombs);

		if (!p.ok || (seen.get(key) ?? 0) > 1) {
			if (!reported.has(key)) {
				reported.add(key);
				plan.response.invalid.push(current);
			}
			continue;
		}

		const currentAt =
			current.kind === "row"
				? String(current.record.updatedAt)
				: current.kind === "tombstone"
					? current.deletedAt
					: null;
		const change = p.change;

		if (change.op === "put") {
			const record = {
				...change.record,
				updatedAt: clampUpdatedAt(String(change.record.updatedAt), now),
			};
			if (decide(record.updatedAt, currentAt) === "lose") {
				plan.response.lost.push(current);
				continue;
			}
			plan.upserts.push({ store: change.store, record });
			if (current.kind === "tombstone") {
				plan.clearTombstones.push({ store: change.store, id: change.id });
			}
		} else {
			const deletedAt = clampUpdatedAt(change.deletedAt, now);
			if (decide(deletedAt, currentAt) === "lose") {
				plan.response.lost.push(current);
				continue;
			}
			plan.deletes.push({ store: change.store, id: change.id, deletedAt });
		}
		plan.response.accepted.push(key);
	}
	return plan;
}

function idsByStore(
	items: { store: Store; id: string }[],
): Map<Store, string[]> {
	const out = new Map<Store, string[]>();
	for (const { store, id } of items) {
		const list = out.get(store) ?? [];
		list.push(id);
		out.set(store, list);
	}
	return out;
}

async function readCurrent(
	tx: Tx,
	userId: string,
	keys: { store: Store; id: string }[],
): Promise<{ rows: Map<string, Row>; tombs: Map<string, string> }> {
	const rows = new Map<string, Row>();
	for (const [store, ids] of idsByStore(keys)) {
		const table = tableFor(store);
		const found = await tx
			.select()
			.from(table)
			.where(and(eq(table.userId, userId), inArray(table.id, ids)));
		for (const row of found) rows.set(keyOf(store, row.id), rowToRecord(row));
	}

	const tombs = new Map<string, string>();
	const allIds = [...new Set(keys.map((k) => k.id))];
	if (allIds.length > 0) {
		const found = await tx
			.select()
			.from(tombstones)
			.where(
				and(eq(tombstones.userId, userId), inArray(tombstones.id, allIds)),
			);
		for (const t of found)
			tombs.set(keyOf(t.store, t.id), t.deletedAt.toISOString());
	}
	return { rows, tombs };
}

// ON CONFLICT … DO UPDATE SET col = excluded.col for every column but the key,
// and a fresh server_seq, so an accepted edit always moves the cursor.
function excludedSet(table: DataTable): Record<string, SQL> {
	const set: Record<string, SQL> = {};
	for (const [key, column] of Object.entries(getTableColumns(table))) {
		if (key === "userId" || key === "id") continue;
		set[key] =
			key === "serverSeq"
				? NEXT_SERVER_SEQ
				: sql`excluded.${sql.identifier(column.name)}`;
	}
	return set;
}

async function writePlan(
	tx: Tx,
	userId: string,
	plan: PushPlan,
): Promise<void> {
	for (const store of STORES) {
		const table = tableFor(store);
		const values: DataInsert[] = plan.upserts
			.filter((u) => u.store === store)
			.map((u) => recordToRow(userId, u.record));
		if (values.length > 0) {
			await tx
				.insert(table)
				.values(values)
				.onConflictDoUpdate({
					target: [table.userId, table.id],
					set: excludedSet(table),
				});
		}
		const deleted = plan.deletes
			.filter((d) => d.store === store)
			.map((d) => d.id);
		if (deleted.length > 0) {
			await tx
				.delete(table)
				.where(and(eq(table.userId, userId), inArray(table.id, deleted)));
		}
	}

	// A put that beat a tombstone brings the row back: the tombstone goes.
	if (plan.clearTombstones.length > 0) {
		const byStore = [...idsByStore(plan.clearTombstones)].map(([store, ids]) =>
			and(eq(tombstones.store, store), inArray(tombstones.id, ids)),
		);
		await tx
			.delete(tombstones)
			.where(and(eq(tombstones.userId, userId), or(...byStore)));
	}

	// A delete leaves a content-free tombstone that competes like a row (D5).
	if (plan.deletes.length > 0) {
		await tx
			.insert(tombstones)
			.values(
				plan.deletes.map((d) => ({
					userId,
					store: d.store,
					id: d.id,
					deletedAt: new Date(d.deletedAt),
				})),
			)
			.onConflictDoUpdate({
				target: [tombstones.userId, tombstones.store, tombstones.id],
				set: {
					deletedAt: sql`excluded.deleted_at`,
					serverSeq: NEXT_SERVER_SEQ,
				},
			});
	}
}

export async function handlePush(
	db: Database,
	userId: string,
	body: unknown,
	now: Date = new Date(),
): Promise<{ status: number; json: unknown }> {
	const request = parsePushRequest(body);
	if (!request.ok) {
		return {
			status: request.status,
			json: { error: ERROR_TEXT[request.status] },
		};
	}
	const parsed = request.changes.map(parseChange);
	const keys = parsed.map(keyParts).filter((k) => k !== null);

	const response = await db.transaction(async (tx) => {
		// First statement, always: one push per user at a time (D13).
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
		const { rows, tombs } = await readCurrent(tx, userId, keys);
		const plan = planPush(parsed, rows, tombs, now);
		await writePlan(tx, userId, plan);
		return plan.response;
	});

	// Counts only: never a key, a title or an email (spec §9).
	console.log(
		JSON.stringify({
			route: "push",
			changes: parsed.length,
			accepted: response.accepted.length,
			lost: response.lost.length,
			invalid: response.invalid.length,
		}),
	);
	return { status: 200, json: response };
}
```

- [ ] **Step 4: Run the plan tests to verify they pass**

Run: `npx vitest run api/test/push-plan.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Write the Workers push tests**

`api/test/workers/push.test.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type Change,
	MAX_BODY_BYTES,
	MAX_CHANGES,
	PROTOCOL_VERSION,
	type PushResponse,
	type Row,
} from "../../../shared/protocol.ts";
import { connect } from "../../src/db.ts";
import { handlePush } from "../../src/push.ts";
import { tasks, tombstones } from "../../src/schema.ts";
import { call, deleteUsers, signUp, testEnv, withDb } from "./helpers.ts";

const A = "push-a@ignite.test";
const B = "push-b@ignite.test";
let a: { userId: string; cookie: string };
let b: { userId: string; cookie: string };

beforeAll(async () => {
	await deleteUsers([A, B]);
	a = await signUp(A);
	b = await signUp(B);
});
afterAll(() => deleteUsers([A, B]));

const at = (minute: number) =>
	new Date(Date.UTC(2026, 0, 1, 8, minute)).toISOString();

const taskRecord = (id: string, title: string, updatedAt: string): Row => ({
	id,
	sectionId: "focus-default",
	title,
	notes: "",
	completed: false,
	starred: false,
	critical: false,
	dueAt: null,
	hasTime: false,
	recurrence: { type: "weekly", interval: 1, weekdays: [1, 3] },
	lastCompletedAt: null,
	completedCount: 0,
	leadTime: 0,
	scheduledTags: [],
	createdAt: at(0),
	order: 0,
	updatedAt,
});
const put = (record: Row): Change => ({
	store: "tasks",
	id: String(record.id),
	op: "put",
	record,
});
const del = (id: string, deletedAt: string): Change => ({
	store: "tasks",
	id,
	op: "delete",
	deletedAt,
});

async function push(userId: string, changes: Change[]): Promise<PushResponse> {
	return withDb(async (db) => {
		const res = await handlePush(db, userId, {
			protocol: PROTOCOL_VERSION,
			changes,
		});
		expect(res.status).toBe(200);
		return res.json as PushResponse;
	});
}

describe("push against Neon dev", () => {
	it("never lets user A overwrite user B's row with the same id", async () => {
		const id = `shared-${crypto.randomUUID()}`;
		await push(b.userId, [put(taskRecord(id, "B's task", at(1)))]);
		const res = await push(a.userId, [put(taskRecord(id, "A's task", at(2)))]);
		expect(res.accepted).toEqual([`tasks:${id}`]);

		const rows = await withDb((db) =>
			db
				.select({ userId: tasks.userId, title: tasks.title })
				.from(tasks)
				.where(eq(tasks.id, id)),
		);
		const titles = new Map(rows.map((r) => [r.userId, r.title]));
		expect(titles.get(b.userId)).toBe("B's task");
		expect(titles.get(a.userId)).toBe("A's task");
	});

	it("answers a retried push with lost and an identical row", async () => {
		const record = taskRecord(crypto.randomUUID(), "Once", at(3));
		expect((await push(a.userId, [put(record)])).accepted).toHaveLength(1);
		const retry = await push(a.userId, [put(record)]);
		expect(retry.accepted).toEqual([]);
		expect(retry.lost).toEqual([
			{ store: "tasks", id: record.id, kind: "row", record },
		]);
	});

	it("brings a task back when an edit is newer than its delete", async () => {
		const id = crypto.randomUUID();
		await push(a.userId, [put(taskRecord(id, "First", at(1)))]);
		expect((await push(a.userId, [del(id, at(2))])).accepted).toEqual([
			`tasks:${id}`,
		]);
		const back = await push(a.userId, [put(taskRecord(id, "Back", at(3)))]);
		expect(back.accepted).toEqual([`tasks:${id}`]);

		await withDb(async (db) => {
			const rows = await db
				.select({ title: tasks.title })
				.from(tasks)
				.where(and(eq(tasks.userId, a.userId), eq(tasks.id, id)));
			const tombs = await db
				.select()
				.from(tombstones)
				.where(and(eq(tombstones.userId, a.userId), eq(tombstones.id, id)));
			expect(rows).toEqual([{ title: "Back" }]);
			expect(tombs).toEqual([]);
		});
	});

	it("clamps a fast clock to server time plus 5 seconds", async () => {
		const id = crypto.randomUUID();
		const before = Date.now();
		await push(a.userId, [
			put(taskRecord(id, "Fast clock", "2099-01-01T00:00:00.000Z")),
		]);
		const [row] = await withDb((db) =>
			db
				.select({ updatedAt: tasks.updatedAt })
				.from(tasks)
				.where(and(eq(tasks.userId, a.userId), eq(tasks.id, id))),
		);
		expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
		expect(row.updatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
	});

	it("reports an invalid change with the server's version and applies the rest", async () => {
		const good = taskRecord(crypto.randomUUID(), "Good", at(1));
		const res = await push(a.userId, [
			put(good),
			put({ ...taskRecord("bad-one", "Bad", at(1)), user_id: b.userId }),
		]);
		expect(res.accepted).toEqual([`tasks:${good.id}`]);
		expect(res.invalid).toEqual([
			{ store: "tasks", id: "bad-one", kind: "none" },
		]);
	});

	it("makes a second push wait while a first push's transaction holds the lock", async () => {
		const first = await connect(testEnv);
		const second = await connect(testEnv);
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let locked = () => {};
		const lockTaken = new Promise<void>((resolve) => {
			locked = resolve;
		});
		try {
			// Stands in for a push that is still inside its transaction.
			const holder = first.db.transaction(async (tx) => {
				await tx.execute(
					sql`select pg_advisory_xact_lock(hashtext(${a.userId}))`,
				);
				locked();
				await gate;
			});
			await lockTaken;

			let done = false;
			const pushing = handlePush(second.db, a.userId, {
				protocol: PROTOCOL_VERSION,
				changes: [put(taskRecord(crypto.randomUUID(), "Waits", at(1)))],
			}).then((res) => {
				done = true;
				return res;
			});

			await new Promise((resolve) => setTimeout(resolve, 750));
			expect(done).toBe(false);

			release();
			await holder;
			expect((await pushing).status).toBe(200);
			expect(done).toBe(true);
		} finally {
			release();
			await first.close();
			await second.close();
		}
	});
});

describe("push over HTTP", () => {
	const PUSH = "/api/sync/push";

	it("answers 426 to another protocol", async () => {
		const res = await call(PUSH, {
			body: { protocol: 2, changes: [] },
			cookie: a.cookie,
		});
		expect(res.status).toBe(426);
	});

	it("answers 413 to more than MAX_CHANGES changes", async () => {
		const changes = Array.from({ length: MAX_CHANGES + 1 }, () => ({}));
		const res = await call(PUSH, {
			body: { protocol: PROTOCOL_VERSION, changes },
			cookie: a.cookie,
		});
		expect(res.status).toBe(413);
	});

	it("answers 413 to a body over MAX_BODY_BYTES", async () => {
		const res = await call(PUSH, {
			raw: JSON.stringify({ padding: "x".repeat(MAX_BODY_BYTES) }),
			cookie: a.cookie,
		});
		expect(res.status).toBe(413);
	});

	it("answers 400 to a body that isn't JSON", async () => {
		const res = await call(PUSH, { raw: "{not json", cookie: a.cookie });
		expect(res.status).toBe(400);
	});

	it("applies a real push end to end", async () => {
		const record = taskRecord(crypto.randomUUID(), "Over HTTP", at(4));
		const res = await call(PUSH, {
			body: { protocol: PROTOCOL_VERSION, changes: [put(record)] },
			cookie: a.cookie,
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as PushResponse).accepted).toEqual([
			`tasks:${record.id}`,
		]);
	});

	it("answers 200 to a NUL in a title, with only that change invalid", async () => {
		// Postgres text refuses a NUL. Without validate.ts's check this push
		// would fail as a whole with a 500, and the queue would jam on it.
		const good = taskRecord(crypto.randomUUID(), "Good", at(5));
		const bad = taskRecord(crypto.randomUUID(), "Ring\u0000", at(5));
		const res = await call(PUSH, {
			body: { protocol: PROTOCOL_VERSION, changes: [put(good), put(bad)] },
			cookie: a.cookie,
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as PushResponse;
		expect(json.accepted).toEqual([`tasks:${good.id}`]);
		expect(json.invalid).toEqual([
			{ store: "tasks", id: bad.id, kind: "none" },
		]);
	});
});
```

- [ ] **Step 6: Run the Workers suite**

Run: `npm run test:workers`
Expected: PASS, 31 tests (19 from Task 8, 12 here). The lock test takes about a second: it waits 750 ms to prove the second push is still blocked.

To prove the lock test guards something, comment out the `pg_advisory_xact_lock` line in `handlePush` and run `npm run test:workers` again.
Expected: FAIL on "makes a second push wait while a first push's transaction holds the lock" (`done` is already `true`). Restore the line and run it again: PASS.

- [ ] **Step 7: Run every check**

Run: `npx biome check --write api && npm run check && npm run test:run`
Expected: no errors; every plain test passes.

- [ ] **Step 8: Commit**

```bash
git add api/src/push.ts api/test/push-plan.test.ts api/test/workers/push.test.ts
git commit -m "feat(api): push handler with per-user advisory lock and last write wins"
```

---

### Task 10: The pull handler

Return this user's changes after a cursor from all four tables and the tombstones, oldest first, in pages. Spec §6.2, D14.

**Files:**
- Modify: `api/src/pull.ts` (replace the Task 8 stub, whole file)
- Test: `api/test/pull-page.test.ts`, `api/test/workers/pull.test.ts`

**Interfaces:**
- Consumes: `tableFor`, `rowToRecord` (Task 6); `tombstones` (Task 6); `ERROR_TEXT` (Task 8); `PROTOCOL_VERSION`, `PULL_LIMIT`, `STORES`, `PulledChange`, `PullResponse` (Task 2).
- Produces:
  - `handlePull(db: Database, userId: string, url: URL): Promise<{ status: number; json: unknown }>` (CONTRACT). `json` is a `PullResponse` on `200`, or `{ error }` on `400` or `426`.
  - Added beyond CONTRACT: `readSince(db: Database, userId: string, since: number, limit?: number, hooks?: ReadHooks): Promise<PullResponse>` (`limit` defaults to `PULL_LIMIT`; the tests page with a small one; `ReadHooks = { afterRows?: () => Promise<void> }` is a test hook that runs between the data-table reads and the tombstone read) and `pageOf(changes: PulledChange[], limit: number, since: number): PullResponse` (pure).

**Five queries in one snapshot, merged in JavaScript.** The four data tables and `tombstones` have different columns, so one SQL `UNION` would need every column cast to a common shape. Instead each table is read with `server_seq > since ORDER BY server_seq LIMIT limit + 1`, and the results are merged and cut to `limit`. That is exact: the `limit` smallest sequence numbers overall are always among each table's own `limit` smallest. The five reads run in one `REPEATABLE READ, READ ONLY` transaction, so they see one snapshot. Without it, a push could commit between two reads, and the cursor could jump past a row the first read missed.

**Records come back exactly as `toWire` built them.** `rowToRecord` drops `userId` and `serverSeq` and writes dates with `toISOString()`, and Task 7's contract test pins the field list. A row I just pushed therefore comes back equal to what I sent (spec §6.2).

- [ ] **Step 1: Write the failing pure tests**

`api/test/pull-page.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PulledChange } from "../../shared/protocol.ts";
import type { Database } from "../src/db.ts";
import { handlePull, pageOf } from "../src/pull.ts";

const row = (seq: number): PulledChange => ({
	store: "tasks",
	id: `t${seq}`,
	seq,
	kind: "row",
	record: { id: `t${seq}` },
});
const tomb = (seq: number): PulledChange => ({
	store: "areas",
	id: `a${seq}`,
	seq,
	kind: "tombstone",
	deletedAt: "2026-01-01T00:00:00.000Z",
});

describe("pageOf", () => {
	it("merges the tables oldest first and cuts at the limit", () => {
		const page = pageOf([row(5), tomb(2), row(9), tomb(7)], 3, 0);
		expect(page.changes.map((c) => c.seq)).toEqual([2, 5, 7]);
		expect(page.cursor).toBe(7);
		expect(page.more).toBe(true);
	});

	it("says there is no more when everything fits", () => {
		const page = pageOf([row(4), row(3)], 3, 0);
		expect(page.changes.map((c) => c.seq)).toEqual([3, 4]);
		expect(page.more).toBe(false);
	});

	it("keeps the cursor where it was when nothing is new", () => {
		expect(pageOf([], 500, 42)).toEqual({
			changes: [],
			cursor: 42,
			more: false,
		});
	});
});

describe("handlePull parameters", () => {
	// Refused before the database is touched, so no database is needed.
	const db = {} as Database;
	const url = (query: string) =>
		new URL(`https://ignite.test/api/sync/pull?${query}`);

	it("answers 426 to another protocol, or none", async () => {
		expect((await handlePull(db, "u1", url("since=0&protocol=2"))).status).toBe(
			426,
		);
		expect((await handlePull(db, "u1", url("since=0"))).status).toBe(426);
	});

	it("answers 400 to a since that isn't a whole number", async () => {
		for (const since of ["", "-1", "1.5", "abc", "1e3", "9".repeat(16)]) {
			const res = await handlePull(db, "u1", url(`since=${since}&protocol=1`));
			expect(res.status).toBe(400);
		}
		expect((await handlePull(db, "u1", url("protocol=1"))).status).toBe(400);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run api/test/pull-page.test.ts`
Expected: FAIL, "pageOf is not a function" (the Task 8 stub exports only `handlePull`).

- [ ] **Step 3: Replace `api/src/pull.ts`**

```ts
// GET /api/sync/pull?since=<seq>&protocol=1 (spec §6.2). This user's rows and
// tombstones with server_seq > since, oldest first, in pages of PULL_LIMIT.

import { and, asc, eq, gt } from "drizzle-orm";
import {
	PROTOCOL_VERSION,
	PULL_LIMIT,
	type PulledChange,
	type PullResponse,
	STORES,
} from "../../shared/protocol.ts";
import type { Database } from "./db.ts";
import { ERROR_TEXT } from "./http.ts";
import { rowToRecord, tableFor } from "./records.ts";
import { tombstones } from "./schema.ts";

// Pure: merges what the five reads returned and cuts one page.
export function pageOf(
	changes: PulledChange[],
	limit: number,
	since: number,
): PullResponse {
	const sorted = [...changes].sort((x, y) => x.seq - y.seq);
	const page = sorted.slice(0, limit);
	return {
		changes: page,
		cursor: page.length > 0 ? page[page.length - 1].seq : since,
		more: sorted.length > limit,
	};
}

// Test hooks only. afterRows runs between the data-table reads and the
// tombstone read, so a test can commit a push in that gap.
export type ReadHooks = { afterRows?: () => Promise<void> };

export async function readSince(
	db: Database,
	userId: string,
	since: number,
	limit: number = PULL_LIMIT,
	hooks: ReadHooks = {},
): Promise<PullResponse> {
	const found = await db.transaction(
		async (tx) => {
			const out: PulledChange[] = [];
			for (const store of STORES) {
				const table = tableFor(store);
				const rows = await tx
					.select()
					.from(table)
					.where(and(eq(table.userId, userId), gt(table.serverSeq, since)))
					.orderBy(asc(table.serverSeq))
					.limit(limit + 1);
				for (const row of rows) {
					out.push({
						store,
						id: row.id,
						seq: row.serverSeq,
						kind: "row",
						record: rowToRecord(row),
					});
				}
			}
			await hooks.afterRows?.();
			const tombs = await tx
				.select()
				.from(tombstones)
				.where(
					and(eq(tombstones.userId, userId), gt(tombstones.serverSeq, since)),
				)
				.orderBy(asc(tombstones.serverSeq))
				.limit(limit + 1);
			for (const t of tombs) {
				out.push({
					store: t.store,
					id: t.id,
					seq: t.serverSeq,
					kind: "tombstone",
					deletedAt: t.deletedAt.toISOString(),
				});
			}
			return out;
		},
		// One snapshot for all five reads, so a push committing in between can't
		// move the cursor past a row an earlier read missed.
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
	return pageOf(found, limit, since);
}

export async function handlePull(
	db: Database,
	userId: string,
	url: URL,
): Promise<{ status: number; json: unknown }> {
	if (url.searchParams.get("protocol") !== String(PROTOCOL_VERSION)) {
		return { status: 426, json: { error: ERROR_TEXT[426] } };
	}
	const since = url.searchParams.get("since");
	// A whole number of at most 15 digits stays inside Number's exact range.
	if (since === null || !/^\d{1,15}$/.test(since)) {
		return { status: 400, json: { error: ERROR_TEXT[400] } };
	}
	const page = await readSince(db, userId, Number(since));
	// Counts only (spec §9).
	console.log(
		JSON.stringify({
			route: "pull",
			changes: page.changes.length,
			more: page.more,
		}),
	);
	return { status: 200, json: page };
}
```

- [ ] **Step 4: Run the pure tests to verify they pass**

Run: `npx vitest run api/test/pull-page.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the Workers pull tests**

`api/test/workers/pull.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type Change,
	PROTOCOL_VERSION,
	type PullResponse,
	type PushResponse,
	type Row,
} from "../../../shared/protocol.ts";
import { readSince } from "../../src/pull.ts";
import { handlePush } from "../../src/push.ts";
import { tasks, tombstones } from "../../src/schema.ts";
import { call, deleteUsers, signUp, withDb } from "./helpers.ts";

const A = "pull-a@ignite.test";
const B = "pull-b@ignite.test";
const C = "pull-c@ignite.test";
let a: { userId: string; cookie: string };
let b: { userId: string; cookie: string };
let c: { userId: string; cookie: string };

beforeAll(async () => {
	await deleteUsers([A, B, C]);
	a = await signUp(A);
	b = await signUp(B);
	c = await signUp(C);
});
afterAll(() => deleteUsers([A, B, C]));

const AT = "2026-01-01T08:00:00.000Z";

const taskRecord = (id: string, title: string): Row => ({
	id,
	sectionId: "focus-default",
	title,
	notes: "Pulled back exactly as sent",
	completed: true,
	starred: false,
	critical: true,
	dueAt: "2026-10-01T08:00:00.000Z",
	hasTime: true,
	recurrence: { type: "yearly", interval: 1, month: 10, day: 1 },
	lastCompletedAt: AT,
	completedCount: 1,
	leadTime: 15,
	scheduledTags: ["x"],
	createdAt: AT,
	order: 1,
	updatedAt: AT,
});
const put = (record: Row): Change => ({
	store: "tasks",
	id: String(record.id),
	op: "put",
	record,
});

async function push(userId: string, changes: Change[]): Promise<PushResponse> {
	return withDb(async (db) => {
		const res = await handlePush(db, userId, {
			protocol: PROTOCOL_VERSION,
			changes,
		});
		return res.json as PushResponse;
	});
}

describe("pull", () => {
	it("returns a row the moment it was pushed, exactly as sent", async () => {
		const record = taskRecord(crypto.randomUUID(), "Fresh");
		const pushed = await call("/api/sync/push", {
			body: { protocol: PROTOCOL_VERSION, changes: [put(record)] },
			cookie: a.cookie,
		});
		expect(pushed.status).toBe(200);

		const res = await call(
			`/api/sync/pull?since=0&protocol=${PROTOCOL_VERSION}`,
			{
				cookie: a.cookie,
				origin: null,
			},
		);
		expect(res.status).toBe(200);
		const page = (await res.json()) as PullResponse;
		const found = page.changes.find((ch) => ch.id === record.id);
		expect(found).toMatchObject({ store: "tasks", kind: "row", record });
		expect(page.cursor).toBeGreaterThanOrEqual(
			found?.seq ?? Number.POSITIVE_INFINITY,
		);
	});

	it("never shows one user's rows to another", async () => {
		const id = crypto.randomUUID();
		await push(a.userId, [put(taskRecord(id, "A's only"))]);
		const page = await withDb((db) => readSince(db, b.userId, 0));
		expect(page.changes.some((ch) => ch.id === id)).toBe(false);
	});

	it("pages with more, oldest first, and includes tombstones", async () => {
		const ids = [1, 2, 3, 4].map(() => crypto.randomUUID());
		await push(
			c.userId,
			ids.map((id, i) => put(taskRecord(id, `Task ${i}`))),
		);
		await push(c.userId, [
			{
				store: "tasks",
				id: ids[0],
				op: "delete",
				deletedAt: "2026-01-02T00:00:00.000Z",
			},
		]);

		// Visible now: three rows and one tombstone (the deleted row is gone).
		const seen: { id: string; kind: string; seq: number }[] = [];
		let since = 0;
		let pages = 0;
		for (;;) {
			const page = await withDb((db) => readSince(db, c.userId, since, 3));
			pages++;
			for (const ch of page.changes)
				seen.push({ id: ch.id, kind: ch.kind, seq: ch.seq });
			expect(page.cursor).toBeGreaterThanOrEqual(since);
			since = page.cursor;
			if (!page.more) break;
		}

		expect(pages).toBe(2);
		expect(seen.map((s) => s.seq)).toEqual(
			[...seen.map((s) => s.seq)].sort((x, y) => x - y),
		);
		expect(
			seen
				.filter((s) => s.kind === "row")
				.map((s) => s.id)
				.sort(),
		).toEqual(ids.slice(1).sort());
		expect(seen.filter((s) => s.kind === "tombstone").map((s) => s.id)).toEqual(
			[ids[0]],
		);
	});

	it("reads one snapshot, so a push between two reads is never skipped", async () => {
		const kept = crypto.randomUUID();
		const deleted = crypto.randomUUID();
		await push(b.userId, [put(taskRecord(deleted, "Deleted mid-pull"))]);

		const page = await withDb((db) =>
			readSince(db, b.userId, 0, undefined, {
				// Commits on a second connection after the data tables were read and
				// before the tombstones are: a new task, then a delete.
				afterRows: async () => {
					await push(b.userId, [put(taskRecord(kept, "Pushed mid-pull"))]);
					await push(b.userId, [
						{
							store: "tasks",
							id: deleted,
							op: "delete",
							deletedAt: "2026-01-02T00:00:00.000Z",
						},
					]);
				},
			}),
		);

		// Every change at or below the cursor must be in the page, or the next
		// pull starts after it and the device never sees it.
		const seqs = await withDb(async (db) => {
			const rows = await db
				.select({ seq: tasks.serverSeq })
				.from(tasks)
				.where(eq(tasks.userId, b.userId));
			const tombs = await db
				.select({ seq: tombstones.serverSeq })
				.from(tombstones)
				.where(eq(tombstones.userId, b.userId));
			return [...rows, ...tombs].map((r) => r.seq);
		});
		const returned = new Set(page.changes.map((ch) => ch.seq));
		expect(
			seqs.filter((seq) => seq <= page.cursor && !returned.has(seq)),
		).toEqual([]);
	});

	it("answers 400 to a bad cursor and 426 to another protocol", async () => {
		expect(
			(await call("/api/sync/pull?since=abc&protocol=1", { cookie: a.cookie }))
				.status,
		).toBe(400);
		expect(
			(await call("/api/sync/pull?since=0&protocol=2", { cookie: a.cookie }))
				.status,
		).toBe(426);
	});
});
```

- [ ] **Step 6: Run the Workers suite**

Run: `npm run test:workers`
Expected: PASS, 36 tests (31 before, 5 here).

To prove the snapshot test guards something, delete `isolationLevel: "repeatable read", ` from the `db.transaction` options in `readSince` (keep `accessMode: "read only"`) and run `npm run test:workers` again.
Expected: FAIL on "reads one snapshot, so a push between two reads is never skipped". Under Postgres's default READ COMMITTED, the tombstone read sees the delete, so the cursor jumps to its sequence number while the task pushed just before it was never read. Restore the option and run it again: PASS.

The local Hyperdrive has no query cache, so "returns a row the moment it was pushed" passes here whatever the deployed setting is. Task 11 checks that caching is off on the real Hyperdrive config (D14).

- [ ] **Step 7: Run every check**

Run: `npx biome check --write api && npm run check && npm run test:run`
Expected: no errors; every plain test passes.

- [ ] **Step 8: Commit**

```bash
git add api/src/pull.ts api/test/pull-page.test.ts api/test/workers/pull.test.ts
git commit -m "feat(api): pull handler with one-snapshot paging across tables"
```

---

### Task 11: First deploy and the CPU measurement

Put the Worker on `*.workers.dev` against Neon `main` by hand, then measure what sign-up, sign-in and a push of 200 changes cost in CPU on Workers Free. Lower the batch size if the push goes over. Spec §11 (migrate before deploy), §12, R1, D14.

**Files:**
- Create: `api/scripts/measure-push.ts`
- Modify: `docs/superpowers/specs/2026-09-29-ignite-accounts-sync-design.md` (§12, one dated block); `shared/protocol.ts` and `tests/shared/protocol.test.ts` (only if a limit has to drop)

**Interfaces:**
- Consumes: the Worker and handlers (Tasks 8 to 10), `wrangler.jsonc`, the Worker secrets and the Hyperdrive config from Task 0, `readLine` and `readHidden` (Task 8), `MAX_CHANGES`, `MAX_BODY_BYTES`, `PROTOCOL_VERSION`, `Change` (Task 2), `delete-user.ts` (Task 8).
- Produces: a deployed Worker at `https://ignite.<subdomain>.workers.dev`; the measured block in spec §12; possibly a lower `MAX_CHANGES`, `MAX_BODY_BYTES` or `PULL_LIMIT`. Added beyond CONTRACT: `makeChanges(count: number, notesLength: number, now: Date): Change[]` in `api/scripts/measure-push.ts`.

**This deploy is manual and one-off.** Task 18 replaces it with the pipeline. The app shell served here is still built with `base: "/ignite/"` until Task 15, so the page at `/` is not usable yet. Only the API is measured.

**Two payloads, because two limits are at stake.** A "typical" batch (short titles, 200-character notes) measures the per-change cost, which `MAX_CHANGES` controls. A "full" batch (notes padded until the body is just under `MAX_BODY_BYTES`) measures the per-byte cost, which only `MAX_BODY_BYTES` controls. Lowering `MAX_CHANGES` would not make a 1 MB body cheaper to parse.

**The measurement runs on my own account, which is deleted afterwards.** `ALLOWED_EMAILS` holds only my email, and adding a second one is out of bounds until spec §14's gate is met. The measurement leaves 1,200 invisible tasks in a section that doesn't exist, so the account is deleted with `delete-user.ts` at the end. I sign up for real in Task 19. Use a throwaway password here.

- [ ] **Step 1: Confirm Hyperdrive caching is off**

Run: `npx wrangler hyperdrive get <the id in wrangler.jsonc>`
Expected: the JSON shows `"caching": { "disabled": true }` (Task 0 created it with `--caching-disabled`). If it shows caching enabled, run `npx wrangler hyperdrive update <id> --caching-disabled` and check again. With caching on, a pull could return an older cached answer (D14).

- [ ] **Step 2: Migrate Neon `main`**

Take the `main` branch's connection string for the `ignite` role from the Neon console (**Branches → main → Connect**; the same string as the `NEON_DATABASE_URL` GitHub secret). In PowerShell, so it never lands in a file:

```powershell
$env:DATABASE_URL = Read-Host -MaskInput "Neon main connection string"
npm run db:migrate
Remove-Item Env:DATABASE_URL
```

Expected: "[✓] migrations applied successfully!". `process.loadEnvFile()` in `api/drizzle.config.ts` never overwrites a variable that is already set, so `.env`'s `dev` string is ignored for this run. Migrate always goes before deploy (spec §11): the new Worker must never meet an old schema.

- [ ] **Step 3: Check the secrets and deploy**

Run: `npx wrangler secret list`
Expected: `ALLOWED_EMAILS` and `BETTER_AUTH_SECRET` (Task 0, Step 10). If one is missing, set it now with `npx wrangler secret put <NAME>`.

Run: `npm run build && npx wrangler deploy`
Expected: "Uploaded ignite", then "Deployed ignite triggers", listing `https://ignite.<subdomain>.workers.dev`. The bindings list shows `env.HYPERDRIVE`, `env.ASSETS` and `env.BETTER_AUTH_URL`. The Worker bundle size must be under Workers Free's 3 MB compressed limit; Wrangler prints "Total Upload: … / gzip: …" and fails the deploy if it isn't.

- [ ] **Step 4: Smoke-test the live API**

Run (Git Bash): `curl -si "https://ignite.<subdomain>.workers.dev/api/sync/pull?since=0&protocol=1" | head -n 12`
Expected: `HTTP/2 401`, the six `SECURITY_HEADERS` (`content-security-policy: default-src 'none'; …`, `strict-transport-security`, `x-content-type-options: nosniff`, `referrer-policy: same-origin`, `permissions-policy`, `cache-control: no-store`) and `{"error":"Sign in to sync"}`.

- [ ] **Step 5: Write the measurement script**

`api/scripts/measure-push.ts`:

```ts
// Measures the deployed Worker for spec §12: sign-up, sign-in, a push of
// MAX_CHANGES tasks (typical, full-size, and a retry of the full one) and a
// full pull page. CPU time comes from Workers Logs; this script only sends the
// requests and prints status and wall time.
// Usage: node api/scripts/measure-push.ts https://ignite.<subdomain>.workers.dev [--sign-up]

import {
	type Change,
	MAX_BODY_BYTES,
	MAX_CHANGES,
	PROTOCOL_VERSION,
	type PullResponse,
	type PushResponse,
} from "../../shared/protocol.ts";
import { readHidden, readLine } from "./lib.ts";

const RUNS = 3;

// count new tasks in a section that doesn't exist, so they never show in the app.
export function makeChanges(
	count: number,
	notesLength: number,
	now: Date,
): Change[] {
	const at = now.toISOString();
	return Array.from({ length: count }, (_, i) => {
		const id = crypto.randomUUID();
		const change: Change = {
			store: "tasks",
			id,
			op: "put",
			record: {
				id,
				sectionId: "cpu-measurement",
				title: `Measured task ${i + 1}`,
				notes: "n".repeat(notesLength),
				completed: false,
				starred: i % 5 === 0,
				critical: false,
				dueAt: i % 3 === 0 ? at : null,
				hasTime: false,
				recurrence:
					i % 4 === 0
						? { type: "weekly", interval: 1, weekdays: [1, 3] }
						: null,
				lastCompletedAt: null,
				completedCount: 0,
				leadTime: 0,
				scheduledTags: [],
				createdAt: at,
				order: i,
				updatedAt: at,
			},
		};
		return change;
	});
}

// Notes long enough to bring the whole body within 2 kB of MAX_BODY_BYTES.
function fullNotesLength(now: Date): number {
	const empty = JSON.stringify({
		protocol: PROTOCOL_VERSION,
		changes: makeChanges(MAX_CHANGES, 0, now),
	}).length;
	return Math.floor((MAX_BODY_BYTES - 2_048 - empty) / MAX_CHANGES);
}

const base = process.argv[2]?.replace(/\/$/, "");
if (!base?.startsWith("https://")) {
	console.error(
		"Usage: node api/scripts/measure-push.ts https://ignite.<subdomain>.workers.dev [--sign-up]",
	);
	process.exit(1);
}
const signUpFirst = process.argv.includes("--sign-up");

async function post(path: string, body: unknown, cookie = "") {
	const started = performance.now();
	const res = await fetch(`${base}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: base as string,
			...(cookie ? { Cookie: cookie } : {}),
		},
		body: JSON.stringify(body),
	});
	return { res, ms: Math.round(performance.now() - started) };
}

// A same-origin GET carries no Origin header, so none is sent here either.
async function get(path: string, cookie: string) {
	const started = performance.now();
	const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
	return { res, ms: Math.round(performance.now() - started) };
}

function report(label: string, status: number, ms: number, extra = "") {
	console.log(
		`${label.padEnd(18)} ${status}  ${String(ms).padStart(5)} ms wall  ${extra}`,
	);
}

const email = (await readLine("Email: ")).trim();
const password = await readHidden("Password (a throwaway, 15+ characters): ");
console.log(
	`Started ${new Date().toISOString()}. Look for requests after this time.`,
);

if (signUpFirst) {
	const { res, ms } = await post("/api/auth/sign-up/email", {
		name: email,
		email,
		password,
		rememberMe: false,
	});
	report("sign-up", res.status, ms);
}

let cookie = "";
for (let run = 1; run <= RUNS; run++) {
	// auth.ts allows 5 sign-ins per IP, reset only after a minute with no
	// attempt. The three runs fit; a second run of this script needs that
	// minute of quiet first.
	await new Promise((resolve) => setTimeout(resolve, 4_000));
	const { res, ms } = await post("/api/auth/sign-in/email", {
		email,
		password,
		rememberMe: false,
	});
	report(`sign-in ${run}`, res.status, ms);
	cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}
if (!cookie)
	throw new Error("No session cookie. Check the email and password.");

const payloads = [
	{ label: "push typical", notes: 200 },
	{ label: "push full", notes: fullNotesLength(new Date()) },
];
let lastBody: unknown = null;
for (const { label, notes } of payloads) {
	for (let run = 1; run <= RUNS; run++) {
		const body = {
			protocol: PROTOCOL_VERSION,
			changes: makeChanges(MAX_CHANGES, notes, new Date()),
		};
		lastBody = body;
		const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
		const { res, ms } = await post("/api/sync/push", body, cookie);
		const json = res.ok ? ((await res.json()) as PushResponse) : null;
		report(
			`${label} ${run}`,
			res.status,
			ms,
			`${bytes} bytes, ${json?.accepted.length ?? 0} accepted, ${json?.lost.length ?? 0} lost`,
		);
	}
}

// The last full body once more, as a client resends after a lost answer.
// Every change loses on equal time, so all of them come back with the server's
// full row: the heaviest answer a push can give.
const retry = await post("/api/sync/push", lastBody, cookie);
const retried = retry.res.ok
	? ((await retry.res.json()) as PushResponse)
	: null;
report(
	"push full retry",
	retry.res.status,
	retry.ms,
	`${retried?.accepted.length ?? 0} accepted, ${retried?.lost.length ?? 0} lost`,
);

// 1,200 measured tasks are more than one page, so each pull is a full one.
for (let run = 1; run <= RUNS; run++) {
	const { res, ms } = await get(
		`/api/sync/pull?since=0&protocol=${PROTOCOL_VERSION}`,
		cookie,
	);
	const page = res.ok ? ((await res.json()) as PullResponse) : null;
	report(
		`pull ${run}`,
		res.status,
		ms,
		`${page?.changes.length ?? 0} changes, more: ${page?.more ?? "?"}`,
	);
}

const { res } = await post("/api/auth/sign-out", {}, cookie);
report("sign-out", res.status, 0);
```

Run: `npx biome check --write api/scripts/measure-push.ts && npx tsc --noEmit -p api`
Expected: no errors.

- [ ] **Step 6: Run the measurement**

In PowerShell: `node api/scripts/measure-push.ts https://ignite.<subdomain>.workers.dev --sign-up`. Type my allowlisted email and a throwaway password.

Expected: a `Started …` line, then `sign-up 200`, three `sign-in … 200`, three `push typical … 200` lines with `200 accepted, 0 lost` and about 110,000 bytes, three `push full … 200` lines with `200 accepted, 0 lost` and just under 1,000,000 bytes, one `push full retry 200` line with `0 accepted, 200 lost`, three `pull … 200` lines with `500 changes, more: true` (one full `PULL_LIMIT` page), and `sign-out 200`. A `1102` or `503` on any line means that request went over the CPU limit: write it down as "over", it is a result.

- [ ] **Step 7: Read the CPU times in Workers Logs**

Cloudflare dashboard → **Workers & Pages → ignite → Observability → Query builder**, the same view Task 1 used (Step 7). Set the time range to cover the `Started` time. Filter on `$workers.event.request.path` for each of `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, `/api/sync/push` and `/api/sync/pull`, and read `$workers.cpuTimeMs` for each request. For push, tell the payloads apart by order (the first three are typical, the next three full, the seventh is the full retry) or by the request's content length. Note the **max** of each group: a request that fails one time in three is broken.

Then open one real log entry for a sign-in and one for a push (click the request in the list to see the whole event, including every `console.log` line). Spec §9: neither may hold an email, a password, a request body or a task title. Expected: the push entry's lines are `{"route":"/api/sync/push","status":200}` and the counts-only push line; the sign-in entry holds the route and status and, at most, Better Auth's fixed `{"source":"auth",…}` messages. Search each entry's text for `@`, for `Measured task` and for `nnnn`: none may match. If one does, stop and ask Malin before Task 12: that log line has to change, and the entries already written stay in Workers Logs until they expire.

- [ ] **Step 8: Decide the limits**

Apply every rule. Each lowered value is a halving, and each needs a new deploy (`npm run build && npx wrangler deploy`) and a new run of Steps 6 and 7 before it counts. Wait a minute before re-running Step 6, so the sign-in limit (5 per 60 seconds) has reset.

1. **`sign-up` or `sign-in` max over 10 ms** → **stop and ask Malin.** This rule holds on its own, whatever the push rows show. Task 1's decision was wrong for the real Worker, and no push limit can fix a sign-in.
2. **`push typical` max over 10 ms** → halve `MAX_CHANGES` in `shared/protocol.ts` (200 → 100 → 50) until it fits.
3. **`push full` or `push full retry` max over 10 ms** → halve `MAX_BODY_BYTES` (1,000,000 → 500,000 → 250,000) until it fits.
4. **`pull` max over 10 ms** → halve `PULL_LIMIT` in `shared/protocol.ts` (500 → 250 → 125) until it fits, and change its pin in `tests/shared/protocol.test.ts` (`expect(PULL_LIMIT).toBe(500)`) to the same number.

If `MAX_CHANGES` drops to 50 and still doesn't fit, stop and ask Malin (R1: Workers Paid is only a question). After a change, `npm run test:run` must still pass: the client's batch-split tests pass their limits explicitly (Task 4), and `validate.test.ts` reads `MAX_CHANGES` from the constant.

- [ ] **Step 9: Record the result in the spec**

Run `date +"%Y-%m-%d"`. In spec §12, directly after Task 1's decision line, add this block. Fill every value from Step 7 (max in ms, one decimal; "over (1102)" where a request exceeded the limit). Never fill a cell with an estimate: a missing number stays a question for Malin.

```markdown
**Measured <date>** (plan Task 11: the deployed Worker on Workers Free against Neon `main`, CPU from `$workers.cpuTimeMs`, max of 3 runs): sign-up <ms> · sign-in <ms> · push of <MAX_CHANGES> typical changes (~110 kB) <ms> · push of <MAX_CHANGES> changes near <MAX_BODY_BYTES> bytes <ms> · the same full push retried, all <MAX_CHANGES> lost (1 run) <ms> · pull of one full page of <PULL_LIMIT> changes <ms>. **Limits: `MAX_CHANGES` = <value>, `MAX_BODY_BYTES` = <value>, `PULL_LIMIT` = <value>** (<"unchanged" or "lowered from … because …">). Workers Logs checked for one sign-in and one push: no email, password, body or task title.
```

- [ ] **Step 10: Delete the measurement account from `main`**

In PowerShell:

```powershell
$env:DATABASE_URL = Read-Host -MaskInput "Neon main connection string"
node api/scripts/delete-user.ts <my email>
Remove-Item Env:DATABASE_URL
```

Expected: `Database:` shows the `main` host (not the `dev` one from `.env`), then "Deleted the account, its sessions, its data and its tombstones." The 1,200 measured tasks and their session go with it (spec §14).

- [ ] **Step 11: Run the checks and commit**

Run: `npm run check && npm run test:run`
Expected: no errors; every test passes.

```bash
git add api/scripts/measure-push.ts docs/superpowers/specs/2026-09-29-ignite-accounts-sync-design.md
git commit -m "docs(spec): record the deployed Worker's CPU cost for sign-in and push"
```

If Step 8 lowered a limit, add `shared/protocol.ts` (and `tests/shared/protocol.test.ts` if `PULL_LIMIT` moved) to the `git add` line and use the message `fix(sync): lower the push limit to fit Workers Free CPU` instead.


---

### Task 12: The client API

The client's only network code: push, pull and the four auth calls over plain `fetch`, each resolving to a result that never throws. Spec §2 (R2), §5.3, §5.4, §6.1, §6.2, §8.

**Files:**
- Create: `src/sync/api.ts`
- Test: `tests/sync/api.test.ts`

**Interfaces:**
- Consumes (Task 2, `shared/protocol.ts`): `Change`, `PushRequest`, `PushResponse`, `PullResponse`, `PROTOCOL_VERSION`.
- Produces (exactly as CONTRACT):
  - `type ApiFailure = "offline" | "unauthorized" | "outdated" | "too-large" | "rate-limited" | "bad-credentials" | "exists" | "too-short" | "server"`
  - `type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure }`
  - `interface Api { push(changes: Change[]): Promise<ApiResult<PushResponse>>; pull(since: number): Promise<ApiResult<PullResponse>>; getSession(): Promise<ApiResult<{ email: string } | null>>; signIn(email: string, password: string, rememberMe: boolean): Promise<ApiResult<{ email: string }>>; signUp(email: string, password: string, rememberMe: boolean): Promise<ApiResult<{ email: string }>>; signOut(): Promise<ApiResult<null>> }`
  - `createApi(fetchImpl?: typeof fetch): Api`

**Two choices beyond the contract, both internal:** every request carries `AbortSignal.timeout(30_000)`, because a request that never answers would hold the "ignite-sync" lock and sign-out waits on that lock. Every request also sets `cache: "no-store"`, so the browser's HTTP cache can never hand back an old pull (the same failure spec §5.2 rules out for Hyperdrive).

- [ ] **Step 1: Write the failing tests**

`tests/sync/api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Change } from "../../shared/protocol";
import { createApi } from "../../src/sync/api";

type Call = { url: string; init: RequestInit };

// A fetch that answers every request with one status and JSON body, and
// records what it was asked.
function fakeFetch(status: number, body?: unknown) {
	const calls: Call[] = [];
	const impl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		calls.push({ url: String(input), init });
		return new Response(body === undefined ? null : JSON.stringify(body), {
			status,
		});
	};
	return { api: createApi(impl as typeof fetch), calls };
}

const change: Change = {
	store: "tasks",
	id: "t1",
	op: "put",
	record: { id: "t1", title: "A" },
};

describe("push", () => {
	it("posts protocol 1 and the changes as JSON, with the same-origin cookie", async () => {
		const response = { accepted: ["tasks:t1"], lost: [], invalid: [] };
		const { api, calls } = fakeFetch(200, response);
		expect(await api.push([change])).toEqual({ ok: true, data: response });
		expect(calls[0].url).toBe("/api/sync/push");
		expect(calls[0].init.method).toBe("POST");
		expect(calls[0].init.credentials).toBe("same-origin");
		expect(calls[0].init.cache).toBe("no-store");
		expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json" });
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			protocol: 1,
			changes: [change],
		});
	});

	it.each([
		[401, "unauthorized"],
		[413, "too-large"],
		[426, "outdated"],
		[429, "rate-limited"],
		[400, "server"],
		[403, "server"],
		[500, "server"],
		[503, "server"],
	] as const)("maps %i to %s", async (status, error) => {
		const { api } = fakeFetch(status, { error: "x" });
		expect(await api.push([change])).toEqual({ ok: false, error });
	});
});

describe("pull", () => {
	it("gets since and protocol=1 from the query string", async () => {
		const response = { changes: [], cursor: 42, more: false };
		const { api, calls } = fakeFetch(200, response);
		expect(await api.pull(42)).toEqual({ ok: true, data: response });
		expect(calls[0].url).toBe("/api/sync/pull?since=42&protocol=1");
		expect(calls[0].init.method).toBeUndefined();
		expect(calls[0].init.credentials).toBe("same-origin");
		expect(calls[0].init.headers).toBeUndefined();
	});

	it("maps 426 to outdated", async () => {
		const { api } = fakeFetch(426);
		expect(await api.pull(0)).toEqual({ ok: false, error: "outdated" });
	});
});

describe("network failures", () => {
	it("maps a fetch that throws a TypeError to offline", async () => {
		const api = createApi((async () => {
			throw new TypeError("Failed to fetch");
		}) as typeof fetch);
		expect(await api.push([change])).toEqual({ ok: false, error: "offline" });
		expect(await api.signIn("me@example.com", "pw", false)).toEqual({
			ok: false,
			error: "offline",
		});
	});

	it("gives every request a timeout, and maps the timeout to offline", async () => {
		let signal: AbortSignal | null | undefined;
		const api = createApi((async (_input: RequestInfo | URL, init?: RequestInit) => {
			signal = init?.signal;
			throw new DOMException("The operation timed out.", "TimeoutError");
		}) as typeof fetch);
		expect(await api.pull(0)).toEqual({ ok: false, error: "offline" });
		expect(signal).toBeInstanceOf(AbortSignal);
	});

	it("treats a 200 that is not JSON as a server failure", async () => {
		const api = createApi((async () =>
			new Response("<!doctype html>", { status: 200 })) as typeof fetch);
		expect(await api.pull(0)).toEqual({ ok: false, error: "server" });
	});
});

describe("sign-in", () => {
	it("posts email, password and rememberMe, and returns the account's email", async () => {
		const { api, calls } = fakeFetch(200, {
			user: { email: "me@example.com" },
		});
		expect(await api.signIn("me@example.com", "pw", true)).toEqual({
			ok: true,
			data: { email: "me@example.com" },
		});
		expect(calls[0].url).toBe("/api/auth/sign-in/email");
		expect(calls[0].init.credentials).toBe("same-origin");
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			email: "me@example.com",
			password: "pw",
			rememberMe: true,
		});
	});

	it("maps 401 to bad-credentials, never unauthorized", async () => {
		const { api } = fakeFetch(401, { code: "INVALID_EMAIL_OR_PASSWORD" });
		expect(await api.signIn("me@example.com", "pw", false)).toEqual({
			ok: false,
			error: "bad-credentials",
		});
	});

	it("maps 429 to rate-limited", async () => {
		const { api } = fakeFetch(429);
		expect(await api.signIn("me@example.com", "pw", false)).toEqual({
			ok: false,
			error: "rate-limited",
		});
	});
});

describe("sign-up", () => {
	it("sends the email as the name Better Auth requires", async () => {
		const { api, calls } = fakeFetch(200, { user: { email: "me@example.com" } });
		await api.signUp("me@example.com", "a long enough password", false);
		expect(calls[0].url).toBe("/api/auth/sign-up/email");
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			name: "me@example.com",
			email: "me@example.com",
			password: "a long enough password",
			rememberMe: false,
		});
	});

	it("maps 422 to exists", async () => {
		const { api } = fakeFetch(422, { code: "USER_ALREADY_EXISTS" });
		expect(await api.signUp("me@example.com", "pw", false)).toEqual({
			ok: false,
			error: "exists",
		});
	});

	it("maps 400 PASSWORD_TOO_SHORT to too-short", async () => {
		const { api } = fakeFetch(400, { code: "PASSWORD_TOO_SHORT" });
		expect(await api.signUp("me@example.com", "pw", false)).toEqual({
			ok: false,
			error: "too-short",
		});
	});

	it("maps any other 400 (the allowlist refusal) to server", async () => {
		const { api } = fakeFetch(400, { code: "BAD_REQUEST" });
		expect(await api.signUp("me@example.com", "pw", false)).toEqual({
			ok: false,
			error: "server",
		});
	});
});

describe("session and sign-out", () => {
	it("reads no session as null", async () => {
		const { api, calls } = fakeFetch(200, null);
		expect(await api.getSession()).toEqual({ ok: true, data: null });
		expect(calls[0].url).toBe("/api/auth/get-session");
	});

	it("reads a session as its email", async () => {
		const { api } = fakeFetch(200, {
			session: { id: "s" },
			user: { email: "me@example.com" },
		});
		expect(await api.getSession()).toEqual({
			ok: true,
			data: { email: "me@example.com" },
		});
	});

	it("posts sign-out", async () => {
		const { api, calls } = fakeFetch(200, { success: true });
		expect(await api.signOut()).toEqual({ ok: true, data: null });
		expect(calls[0].url).toBe("/api/auth/sign-out");
		expect(calls[0].init.method).toBe("POST");
		expect(calls[0].init.credentials).toBe("same-origin");
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/sync/api.test.ts`
Expected: FAIL. The suite cannot import `../../src/sync/api`.

- [ ] **Step 3: Implement `src/sync/api.ts`**

```ts
// The client's only network code: plain fetch, no auth library (spec R2).
// Every method resolves to a result and never throws, so a failed request
// can't throw into the controller (spec §8).

import {
	type Change,
	PROTOCOL_VERSION,
	type PullResponse,
	type PushRequest,
	type PushResponse,
} from "../../shared/protocol";

export type ApiFailure =
	| "offline"
	| "unauthorized"
	| "outdated"
	| "too-large"
	| "rate-limited"
	| "bad-credentials"
	| "exists"
	| "too-short"
	| "server";

export type ApiResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: ApiFailure };

export interface Api {
	push(changes: Change[]): Promise<ApiResult<PushResponse>>;
	pull(since: number): Promise<ApiResult<PullResponse>>;
	getSession(): Promise<ApiResult<{ email: string } | null>>;
	signIn(
		email: string,
		password: string,
		rememberMe: boolean,
	): Promise<ApiResult<{ email: string }>>;
	signUp(
		email: string,
		password: string,
		rememberMe: boolean,
	): Promise<ApiResult<{ email: string }>>;
	signOut(): Promise<ApiResult<null>>;
}

// A request that never answers would hold the "ignite-sync" lock, and
// sign-out waits on that lock. Browsers give up on a dead connection only
// after minutes.
const TIMEOUT_MS = 30_000;

type Route = "sync" | "sign-in" | "sign-up" | "auth";

async function readJson(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return undefined;
	}
}

async function failure(res: Response, route: Route): Promise<ApiFailure> {
	const { status } = res;
	// On sign-in a 401 means the password or email was wrong, not that a
	// session expired.
	if (status === 401) {
		return route === "sign-in" ? "bad-credentials" : "unauthorized";
	}
	if (status === 413) return "too-large";
	if (status === 426) return "outdated";
	if (status === 429) return "rate-limited";
	if (status === 422 && route === "sign-up") return "exists";
	if (status === 400) {
		const body = (await readJson(res)) as { code?: unknown } | null | undefined;
		if (body?.code === "PASSWORD_TOO_SHORT") return "too-short";
	}
	return "server";
}

function emailOf(data: unknown): string | null {
	const email = (data as { user?: { email?: unknown } } | null)?.user?.email;
	return typeof email === "string" ? email : null;
}

const post = (body: unknown): RequestInit => ({
	method: "POST",
	body: JSON.stringify(body),
});

export function createApi(
	fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Api {
	async function request<T>(
		route: Route,
		path: string,
		init: RequestInit = {},
	): Promise<ApiResult<T>> {
		let res: Response;
		try {
			res = await fetchImpl(path, {
				...init,
				credentials: "same-origin",
				cache: "no-store",
				headers:
					init.body === undefined
						? undefined
						: { "Content-Type": "application/json" },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch {
			// A TypeError (no network, DNS) or the timeout's TimeoutError.
			return { ok: false, error: "offline" };
		}
		if (!res.ok) return { ok: false, error: await failure(res, route) };
		const data = await readJson(res);
		// A 200 that isn't JSON (a captive portal, the app shell) isn't an answer.
		if (data === undefined) return { ok: false, error: "server" };
		return { ok: true, data: data as T };
	}

	async function withEmail(
		route: "sign-in" | "sign-up",
		path: string,
		body: object,
	): Promise<ApiResult<{ email: string }>> {
		const res = await request<unknown>(route, path, post(body));
		if (!res.ok) return res;
		const email = emailOf(res.data);
		return email ? { ok: true, data: { email } } : { ok: false, error: "server" };
	}

	return {
		push(changes) {
			const body: PushRequest = { protocol: PROTOCOL_VERSION, changes };
			return request<PushResponse>("sync", "/api/sync/push", post(body));
		},

		pull(since) {
			return request<PullResponse>(
				"sync",
				`/api/sync/pull?since=${since}&protocol=${PROTOCOL_VERSION}`,
			);
		},

		async getSession() {
			const res = await request<unknown>("auth", "/api/auth/get-session");
			if (!res.ok) return res;
			if (res.data === null) return { ok: true, data: null };
			const email = emailOf(res.data);
			return email ? { ok: true, data: { email } } : { ok: false, error: "server" };
		},

		signIn(email, password, rememberMe) {
			return withEmail("sign-in", "/api/auth/sign-in/email", {
				email,
				password,
				rememberMe,
			});
		},

		// Better Auth requires a name. The email is the only name Ignite has.
		signUp(email, password, rememberMe) {
			return withEmail("sign-up", "/api/auth/sign-up/email", {
				name: email,
				email,
				password,
				rememberMe,
			});
		},

		async signOut() {
			const res = await request<unknown>("auth", "/api/auth/sign-out", post({}));
			return res.ok ? { ok: true, data: null } : res;
		},
	};
}
```

The relative paths resolve against the page's origin. Task 15 moves `base` to `"/"`, so `/api/...` is always the same Worker that served the app (D2).

- [ ] **Step 4: Run the tests, then the checks**

Run: `npx vitest run tests/sync/api.test.ts && npx biome check --write src/sync tests/sync && npm run check`
Expected: PASS. Biome may rewrap long lines on the `--write` pass; `npm run check` (Biome and `tsc --noEmit`) then reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/sync/api.ts tests/sync/api.test.ts
git commit -m "feat(sync): client api over plain fetch"
```

---

### Task 13: The sync engine

A round is push, then pull, under the "ignite-sync" Web Lock. Pulled and losing rows are written straight to the stores, a round never throws, and every outcome ends as a status. Spec §4.5, §6, §8.

**Files:**
- Create: `src/sync/apply.ts`, `src/sync/engine.ts`
- Create: `tests/sync/helpers.ts` (shared fakes; Task 14 uses them too)
- Test: `tests/sync/apply.test.ts`, `tests/sync/engine.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `Change`, `PushResponse`, `PulledChange`, `ServerVersion`, `EPOCH`, `keyOf`, `MAX_CHANGES`, `MAX_BODY_BYTES`, `SYNCED_STORES`.
  - Task 3: the runtime behind `Db.transact` (only `t.*` awaited inside a transaction).
  - Task 4: `toWire`, `fromWire`, `mergeSettings`, `splitBatches`, `SyncStatus`.
  - Task 5: `Db`, `TxHandle`, `Row`, `OutboxEntry`, `SyncMeta`, `LOCAL_META`, `createSyncingDb` (tests only).
  - Task 12: `Api`, `ApiFailure`, `ApiResult`.
- Produces:
  - `applyServerVersion(t: TxHandle, v: ServerVersion | PulledChange): Promise<boolean>` (apply.ts). **Returns `boolean`, not the contract's `void`:** `true` when the local store changed. A caller that ignores the value still type-checks.
  - `export const SYNC_LOCK = "ignite-sync"` (engine.ts). Task 14 takes the same lock by this name.
  - `interface SyncEngine` and `createSyncEngine(deps)` exactly as CONTRACT.
  - Test helpers in `tests/sync/helpers.ts`: `T0: Date`, `freshDb(meta?: Partial<SyncMeta>): Promise<Db>`, `closeAll(): void`, `fakeLocks(): LockManager`, `acceptAll(changes: Change[]): ApiResult<PushResponse>`, `type FakeApi = Api & { pushed: Change[][]; pulled: number[]; signedOut: number }`, `fakeApi(overrides?: Partial<Api>): FakeApi`, `wireTask(id: string, title: string, updatedAt?: string): Row`, `pulled(store: Store, record: Row, seq?: number): PulledChange`, `queueTask(db: Db, id: string, title: string): Promise<unknown>`.

**Decisions made in this task (state them to Malin):**

1. **A queued `put` whose row is gone is dropped, not sent.** The wrapper rewrites the entry to `op: "delete"` in the same transaction as the row's delete, so a `put` entry without a row only comes from a bug. Sending it as a delete would destroy the account's copy on the strength of that bug. Keeping it would jam the key forever, because pull skips every key that has an outbox entry. So the engine deletes the entry in the transaction that found it missing.
2. **`invalid` also respects the rev guard.** If I edited the row while the push was in flight, the entry stays and nothing is applied: the newer edit may be valid (a shortened title), and it gets its own try next round. The key is still logged and counted.
3. **A single change still `413` keeps the local row.** There is no server version to store. The entry is dropped (rev guard applies), the key is logged, and it counts toward the `invalid` status.
4. **A pulled row identical to the stored one is not a change.** Every row I push comes back on my next pull (spec §6.2). Counting it would call `onApplied`, and so re-render the app, after every edit. The comparison ignores key order because Postgres `jsonb` reorders object keys. This relies on the server returning `updatedAt` in `toISOString()` form. If it doesn't, the only cost is one extra refresh.
5. **The `invalid` status lasts one round.** The next clean round shows "Synced". Task 16 announces it once, so the message is heard, but it is not sticky.
6. **A pull page that doesn't move the cursor ends the loop,** even with `more: true`. A server bug must not become a hot loop against the free tier's request quota (R1).

Task 15 wires `schedule()` to the wrapper: `createSyncingDb(db, { onQueued: () => engine?.schedule() })`. The engine is built after the first render, so it binds late.

- [ ] **Step 1: Write the shared test helpers**

`tests/sync/helpers.ts` (not a test file: Vitest only collects `*.test.ts`):

```ts
import {
	type Change,
	keyOf,
	type PulledChange,
	type PushResponse,
	type Store,
} from "../../shared/protocol";
import { openDB } from "../../src/model/db.js";
import type { Api, ApiResult } from "../../src/sync/api";
import { toWire } from "../../src/sync/records";
import { createSyncingDb } from "../../src/sync/syncing-db";
import { type Db, LOCAL_META, type Row, type SyncMeta } from "../../src/sync/types";

export const T0 = new Date("2026-10-01T10:00:00.000Z");

const handles: Db[] = [];

export async function freshDb(meta?: Partial<SyncMeta>): Promise<Db> {
	const db = (await openDB(`ignite-test-${crypto.randomUUID()}`)) as Db;
	handles.push(db);
	if (meta) await db.put("meta", { ...LOCAL_META, ...meta });
	return db;
}

export function closeAll(): void {
	for (const db of handles.splice(0)) db.close();
}

// Runs callbacks one at a time, the way navigator.locks does for one name.
// Node 22 (CI) has no navigator.locks, so every test passes this in.
export function fakeLocks(): LockManager {
	let tail: Promise<unknown> = Promise.resolve();
	const request = (_name: string, callback: () => unknown) => {
		const run = tail.then(() => callback());
		tail = run.catch(() => {});
		return run;
	};
	return { request } as unknown as LockManager;
}

export const acceptAll = (changes: Change[]): ApiResult<PushResponse> => ({
	ok: true,
	data: {
		accepted: changes.map((c) => keyOf(c.store, c.id)),
		lost: [],
		invalid: [],
	},
});

export type FakeApi = Api & {
	pushed: Change[][];
	pulled: number[];
	signedOut: number;
};

// Accepts every push and has nothing to pull unless a test overrides it.
// Records every push batch, every pull cursor and every sign-out.
export function fakeApi(overrides: Partial<Api> = {}): FakeApi {
	const api: FakeApi = {
		pushed: [],
		pulled: [],
		signedOut: 0,
		async push(changes) {
			api.pushed.push(changes);
			return overrides.push ? overrides.push(changes) : acceptAll(changes);
		},
		async pull(since) {
			api.pulled.push(since);
			return overrides.pull
				? overrides.pull(since)
				: { ok: true, data: { changes: [], cursor: since, more: false } };
		},
		getSession: overrides.getSession ?? (async () => ({ ok: true, data: null })),
		signIn: overrides.signIn ?? (async (email) => ({ ok: true, data: { email } })),
		signUp: overrides.signUp ?? (async (email) => ({ ok: true, data: { email } })),
		async signOut() {
			api.signedOut++;
			return overrides.signOut ? overrides.signOut() : { ok: true, data: null };
		},
	};
	return api;
}

export const wireTask = (
	id: string,
	title: string,
	updatedAt = "2026-09-01T00:00:00.000Z",
): Row =>
	toWire("tasks", {
		id,
		sectionId: "focus-default",
		title,
		createdAt: updatedAt,
		updatedAt,
	});

export const pulled = (store: Store, record: Row, seq = 1): PulledChange => ({
	store,
	id: record.id as string,
	seq,
	kind: "row",
	record,
});

// Writes a task through the real syncing wrapper. In account mode it lands
// with its outbox entry exactly as a model write would; in local mode it is
// stored and nothing is queued.
export function queueTask(db: Db, id: string, title: string) {
	return createSyncingDb(db, { now: () => T0 }).put("tasks", {
		id,
		sectionId: "focus-default",
		title,
		completed: 0,
		starred: 0,
		critical: 0,
		createdAt: T0.toISOString(),
	});
}
```

- [ ] **Step 2: Write the failing tests**

`tests/sync/apply.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { EPOCH, SYNCED_STORES } from "../../shared/protocol";
import { applyServerVersion } from "../../src/sync/apply";
import { fromWire } from "../../src/sync/records";
import type { Db } from "../../src/sync/types";
import { closeAll, freshDb, pulled, wireTask } from "./helpers";

afterEach(closeAll);

const apply = (db: Db, v: Parameters<typeof applyServerVersion>[1]) =>
	db.transact([...SYNCED_STORES], "readwrite", (t) => applyServerVersion(t, v));

describe("applyServerVersion", () => {
	it("stores a pulled task with its flags as 0/1", async () => {
		const db = await freshDb();
		const change = pulled("tasks", { ...wireTask("t1", "A"), starred: true });
		expect(await apply(db, change)).toBe(true);
		expect(await db.get("tasks", "t1")).toMatchObject({
			title: "A",
			starred: 1,
			completed: 0,
		});
	});

	it("reports no change when the row already matches, whatever jsonb did to key order", async () => {
		const db = await freshDb();
		await db.put(
			"tasks",
			fromWire("tasks", {
				...wireTask("t1", "A"),
				recurrence: { type: "daily", interval: 1 },
			}),
		);
		const echoed = pulled("tasks", {
			...wireTask("t1", "A"),
			recurrence: { interval: 1, type: "daily" },
		});
		expect(await apply(db, echoed)).toBe(false);
	});

	it("takes only the quiet hours from a pulled settings row", async () => {
		const db = await freshDb();
		await db.put("settings", {
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "light",
			sidebarCollapsed: true,
			updatedAt: EPOCH,
		});
		await apply(
			db,
			pulled("settings", {
				id: "app",
				quietStart: 21,
				quietEnd: 6,
				updatedAt: "2026-09-01T00:00:00.000Z",
			}),
		);
		expect(await db.get("settings", "app")).toEqual({
			id: "app",
			quietStart: 21,
			quietEnd: 6,
			theme: "light",
			sidebarCollapsed: true,
			updatedAt: "2026-09-01T00:00:00.000Z",
		});
	});

	it("deletes the local row for a tombstone", async () => {
		const db = await freshDb();
		await db.put("tasks", fromWire("tasks", wireTask("t1", "A")));
		const tombstone = {
			store: "tasks",
			id: "t1",
			seq: 2,
			kind: "tombstone",
			deletedAt: "2026-10-01T11:00:00.000Z",
		} as const;
		expect(await apply(db, tombstone)).toBe(true);
		expect(await db.get("tasks", "t1")).toBeUndefined();
		expect(await apply(db, tombstone)).toBe(false);
	});

	it("never deletes the settings row, which holds this device's theme", async () => {
		const db = await freshDb();
		await db.put("settings", { id: "app", theme: "dark" });
		expect(await apply(db, { store: "settings", id: "app", kind: "none" })).toBe(false);
		expect(await db.get("settings", "app")).toBeDefined();
	});
});
```

`tests/sync/engine.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PushResponse } from "../../shared/protocol";
import type { ApiResult } from "../../src/sync/api";
import { createSyncEngine } from "../../src/sync/engine";
import { fromWire } from "../../src/sync/records";
import type { SyncStatus } from "../../src/sync/status";
import { createSyncingDb } from "../../src/sync/syncing-db";
import { type Db, LOCAL_META } from "../../src/sync/types";
import {
	acceptAll,
	closeAll,
	type FakeApi,
	fakeApi,
	fakeLocks,
	freshDb,
	pulled,
	queueTask,
	T0,
	wireTask,
} from "./helpers";

afterEach(() => {
	closeAll();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function setup(
	makeApi: (raw: Db) => FakeApi = () => fakeApi(),
	debounceMs = 2000,
) {
	const db = await freshDb({ mode: "account", userEmail: "me@example.com" });
	const api = makeApi(db);
	const statuses: SyncStatus[] = [];
	let applied = 0;
	const engine = createSyncEngine({
		db,
		api,
		locks: fakeLocks(),
		now: () => T0,
		debounceMs,
		onApplied: () => {
			applied++;
		},
		onStatus: (s) => {
			statuses.push(s);
		},
	});
	return { db, api, engine, statuses, applied: () => applied };
}

const pushResult = (res: Partial<PushResponse>): ApiResult<PushResponse> => ({
	ok: true,
	data: { accepted: [], lost: [], invalid: [], ...res },
});

// An edit made through the real seam while a push is in flight: rev 1 → 2.
async function editDuringPush(raw: Db) {
	const row = await raw.get("tasks", "t1");
	await createSyncingDb(raw).put("tasks", { ...row, title: "Newer" });
}

describe("push", () => {
	it("sends the row as it is now and drops the entry the server accepted", async () => {
		const { db, api, engine, statuses } = await setup();
		await queueTask(db, "t1", "A");
		await engine.runRound();
		expect(api.pushed).toHaveLength(1);
		expect(api.pushed[0][0]).toMatchObject({
			store: "tasks",
			id: "t1",
			op: "put",
			record: { title: "A", completed: false, updatedAt: T0.toISOString() },
		});
		expect(await db.getAll("outbox")).toEqual([]);
		expect(statuses).toEqual([
			{ kind: "syncing" },
			{ kind: "synced", at: T0.toISOString() },
		]);
	});

	it("sends a delete with its deletedAt", async () => {
		const { db, api, engine } = await setup();
		await queueTask(db, "t1", "A");
		await createSyncingDb(db, { now: () => T0 }).delete("tasks", "t1");
		await engine.runRound();
		expect(api.pushed[0]).toEqual([
			{ store: "tasks", id: "t1", op: "delete", deletedAt: T0.toISOString() },
		]);
	});

	it("keeps an accepted entry whose rev moved during the push", async () => {
		const { db, engine } = await setup((raw) =>
			fakeApi({
				push: async (changes) => {
					await editDuringPush(raw);
					return acceptAll(changes);
				},
			}),
		);
		await queueTask(db, "t1", "A");
		await engine.runRound();
		expect((await db.get("outbox", "tasks:t1"))?.rev).toBe(2);
	});

	it("ignores lost when the rev moved, so my newer edit competes next round", async () => {
		const { db, engine, applied } = await setup((raw) =>
			fakeApi({
				push: async () => {
					await editDuringPush(raw);
					return pushResult({
						lost: [
							{ store: "tasks", id: "t1", kind: "row", record: wireTask("t1", "Theirs") },
						],
					});
				},
			}),
		);
		await queueTask(db, "t1", "A");
		await engine.runRound();
		expect((await db.get("tasks", "t1"))?.title).toBe("Newer");
		expect((await db.get("outbox", "tasks:t1"))?.rev).toBe(2);
		expect(applied()).toBe(0);
	});

	it("stores the winning row when my change lost", async () => {
		const { db, engine, applied } = await setup(() =>
			fakeApi({
				push: async () =>
					pushResult({
						lost: [
							{
								store: "tasks",
								id: "t1",
								kind: "row",
								record: { ...wireTask("t1", "Theirs"), completed: true },
							},
						],
					}),
			}),
		);
		await queueTask(db, "t1", "Mine");
		await engine.runRound();
		expect(await db.get("tasks", "t1")).toMatchObject({ title: "Theirs", completed: 1 });
		expect(await db.getAll("outbox")).toEqual([]);
		expect(applied()).toBe(1);
	});

	it("deletes the local row when a tombstone won", async () => {
		const { db, engine } = await setup(() =>
			fakeApi({
				push: async () =>
					pushResult({
						lost: [
							{
								store: "tasks",
								id: "t1",
								kind: "tombstone",
								deletedAt: "2026-10-01T11:00:00.000Z",
							},
						],
					}),
			}),
		);
		await queueTask(db, "t1", "Mine");
		await engine.runRound();
		expect(await db.get("tasks", "t1")).toBeUndefined();
		expect(await db.getAll("outbox")).toEqual([]);
	});

	it("drops an invalid change, stores the server's copy and logs only the key", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { db, engine, statuses } = await setup(() =>
			fakeApi({
				push: async () =>
					pushResult({
						invalid: [
							{
								store: "tasks",
								id: "t1",
								kind: "row",
								record: wireTask("t1", "Server copy"),
							},
						],
					}),
			}),
		);
		await queueTask(db, "t1", "Mine");
		await engine.runRound();
		expect((await db.get("tasks", "t1"))?.title).toBe("Server copy");
		expect(await db.getAll("outbox")).toEqual([]);
		expect(warn).toHaveBeenCalledWith("Ignite sync: tasks:t1 couldn't sync");
		expect(statuses.at(-1)).toEqual({ kind: "invalid", count: 1 });
	});

	it("keeps the local row when an invalid change never reached the account", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { db, engine, statuses } = await setup(() =>
			fakeApi({
				push: async () =>
					pushResult({ invalid: [{ store: "tasks", id: "t1", kind: "none" }] }),
			}),
		);
		await queueTask(db, "t1", "Mine");
		await engine.runRound();
		expect((await db.get("tasks", "t1"))?.title).toBe("Mine");
		expect(await db.getAll("outbox")).toEqual([]);
		expect(statuses.at(-1)).toEqual({ kind: "invalid", count: 1 });
	});

	it("drops a queued put whose row is gone instead of sending it", async () => {
		const { db, api, engine } = await setup();
		await db.put("outbox", {
			key: "tasks:ghost",
			store: "tasks",
			id: "ghost",
			op: "put",
			rev: 1,
		});
		await engine.runRound();
		expect(api.pushed).toEqual([]);
		expect(await db.getAll("outbox")).toEqual([]);
	});

	it("halves a batch the server found too large and retries", async () => {
		const { db, api, engine } = await setup(() =>
			fakeApi({
				push: async (changes) =>
					changes.length > 1 ? { ok: false, error: "too-large" } : acceptAll(changes),
			}),
		);
		for (const id of ["t1", "t2", "t3"]) await queueTask(db, id, id);
		await engine.runRound();
		expect(api.pushed.map((batch) => batch.length)).toEqual([3, 2, 1, 1, 1]);
		expect(await db.getAll("outbox")).toEqual([]);
	});

	it("drops a single change that is still too large and keeps the local row", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { db, engine, statuses } = await setup(() =>
			fakeApi({ push: async () => ({ ok: false, error: "too-large" }) }),
		);
		await queueTask(db, "t1", "Huge");
		await engine.runRound();
		expect((await db.get("tasks", "t1"))?.title).toBe("Huge");
		expect(await db.getAll("outbox")).toEqual([]);
		expect(warn).toHaveBeenCalledWith("Ignite sync: tasks:t1 is too large to sync");
		expect(statuses.at(-1)).toEqual({ kind: "invalid", count: 1 });
	});

	it.each([
		["unauthorized", { kind: "needs-sign-in" }],
		["outdated", { kind: "needs-reload" }],
		["offline", { kind: "offline", pending: 1 }],
		["server", { kind: "offline", pending: 1 }],
	] as const)("a push that fails with %s stops the round and keeps the outbox", async (error, status) => {
		const { db, api, engine, statuses } = await setup(() =>
			fakeApi({ push: async () => ({ ok: false, error }) }),
		);
		await queueTask(db, "t1", "A");
		await engine.runRound();
		expect(statuses.at(-1)).toEqual(status);
		expect(api.pulled).toEqual([]);
		expect(await db.getAll("outbox")).toHaveLength(1);
	});
});

describe("pull", () => {
	it("stores pulled rows, saves the cursor and pages while more is true", async () => {
		const { db, api, engine, applied } = await setup(() =>
			fakeApi({
				pull: async (since) => ({
					ok: true,
					data:
						since === 0
							? {
									changes: [pulled("tasks", { ...wireTask("r1", "One"), starred: true }, 5)],
									cursor: 5,
									more: true,
								}
							: { changes: [pulled("tasks", wireTask("r2", "Two"), 9)], cursor: 9, more: false },
				}),
			}),
		);
		await engine.runRound();
		expect(api.pulled).toEqual([0, 5]);
		expect(await db.get("tasks", "r1")).toMatchObject({ title: "One", starred: 1 });
		expect((await db.get("tasks", "r2"))?.title).toBe("Two");
		expect(await db.get("meta", "sync")).toMatchObject({
			cursor: 9,
			lastSyncedAt: T0.toISOString(),
		});
		expect(applied()).toBe(1);
	});

	it("skips a key that is still waiting in the outbox", async () => {
		const { db, engine } = await setup(() =>
			fakeApi({
				// The server says nothing about t1, so its entry stays queued.
				push: async () => pushResult({}),
				pull: async () => ({
					ok: true,
					data: {
						changes: [
							pulled("tasks", wireTask("t1", "Theirs")),
							pulled("tasks", wireTask("t2", "Other")),
						],
						cursor: 3,
						more: false,
					},
				}),
			}),
		);
		await queueTask(db, "t1", "Mine");
		await engine.runRound();
		expect((await db.get("tasks", "t1"))?.title).toBe("Mine");
		expect((await db.get("tasks", "t2"))?.title).toBe("Other");
	});

	it("discards the page when I signed out while it was in flight", async () => {
		const { db, engine, applied, statuses } = await setup((raw) =>
			fakeApi({
				pull: async () => {
					await raw.put("meta", { ...LOCAL_META });
					return {
						ok: true,
						data: { changes: [pulled("tasks", wireTask("r1", "Remote"))], cursor: 7, more: false },
					};
				},
			}),
		);
		await engine.runRound();
		expect(await db.get("tasks", "r1")).toBeUndefined();
		expect(await db.get("meta", "sync")).toEqual(LOCAL_META);
		expect(applied()).toBe(0);
		expect(statuses.at(-1)).toEqual({ kind: "local" });
	});

	it("does not report a change when the pulled row matches what is stored", async () => {
		const record = wireTask("r1", "Same");
		const { db, engine, applied } = await setup(() =>
			fakeApi({
				pull: async (since) => ({
					ok: true,
					data: { changes: [pulled("tasks", record)], cursor: since + 1, more: false },
				}),
			}),
		);
		await db.put("tasks", fromWire("tasks", record));
		await engine.runRound();
		expect(applied()).toBe(0);
	});

	it("asks me to sign in again when the pull gets a 401", async () => {
		const { engine, statuses } = await setup(() =>
			fakeApi({ pull: async () => ({ ok: false, error: "unauthorized" }) }),
		);
		await engine.runRound();
		expect(statuses.at(-1)).toEqual({ kind: "needs-sign-in" });
		expect(engine.status()).toEqual({ kind: "needs-sign-in" });
	});
});

describe("rounds", () => {
	it("does nothing in local mode", async () => {
		const { db, api, engine, statuses } = await setup();
		await db.put("meta", { ...LOCAL_META });
		await engine.runRound();
		expect(api.pulled).toEqual([]);
		expect(statuses).toEqual([{ kind: "local" }]);
	});

	it("runs two concurrent rounds one after the other", async () => {
		let active = 0;
		let most = 0;
		const { api, engine } = await setup(() =>
			fakeApi({
				pull: async (since) => {
					active++;
					most = Math.max(most, active);
					await new Promise((resolve) => setTimeout(resolve, 10));
					active--;
					return { ok: true, data: { changes: [], cursor: since, more: false } };
				},
			}),
		);
		await Promise.all([engine.runRound(), engine.runRound()]);
		expect(api.pulled).toHaveLength(2);
		expect(most).toBe(1);
	});

	it("schedule runs one round after the last of several calls", async () => {
		const { api, engine } = await setup(undefined, 20);
		engine.schedule();
		engine.schedule();
		engine.schedule();
		expect(api.pulled).toHaveLength(0);
		await vi.waitFor(() => expect(api.pulled).toHaveLength(1));
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(api.pulled).toHaveLength(1);
	});

	it("start runs a round, then one per online event and per return to the tab, until stop", async () => {
		const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
		vi.stubGlobal("document", doc);
		vi.stubGlobal("window", new EventTarget());
		const { api, engine } = await setup();

		engine.start();
		await vi.waitFor(() => expect(api.pulled).toHaveLength(1));
		window.dispatchEvent(new Event("online"));
		await vi.waitFor(() => expect(api.pulled).toHaveLength(2));
		document.dispatchEvent(new Event("visibilitychange"));
		await vi.waitFor(() => expect(api.pulled).toHaveLength(3));

		doc.visibilityState = "hidden";
		document.dispatchEvent(new Event("visibilitychange"));
		engine.stop();
		window.dispatchEvent(new Event("online"));
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(api.pulled).toHaveLength(3);
	});
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/sync/apply.test.ts tests/sync/engine.test.ts`
Expected: FAIL. Both suites cannot import `../../src/sync/apply` and `../../src/sync/engine`.

- [ ] **Step 4: Implement `src/sync/apply.ts`**

```ts
// Writes what the server holds for one key straight into the local stores,
// never through the syncing wrapper, so it can't re-enter the outbox
// (spec §4.5).

import type { PulledChange, ServerVersion } from "../../shared/protocol";
import { fromWire, mergeSettings } from "./records";
import type { Row, TxHandle } from "./types";

// Deep equality that ignores key order. Postgres jsonb stores object keys in
// its own order, so a recurrence rule can come back with its keys shuffled.
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length &&
		keys.every((k) => same((a as Row)[k], (b as Row)[k]))
	);
}

// Resolves true when the local store changed. A row I pushed comes back on my
// next pull unchanged. Counting that as a change would re-render the app after
// every edit.
export async function applyServerVersion(
	t: TxHandle,
	v: ServerVersion | PulledChange,
): Promise<boolean> {
	const local = await t.get(v.store, v.id);
	if (v.kind === "row") {
		const next =
			v.store === "settings"
				? mergeSettings(local, v.record)
				: fromWire(v.store, v.record);
		if (local && same(local, next)) return false;
		await t.put(v.store, next);
		return true;
	}
	// The settings row also holds this device's theme and sidebar state, and
	// Ignite never deletes it. A tombstone or "none" for it changes nothing.
	if (v.store === "settings" || !local) return false;
	await t.delete(v.store, v.id);
	return true;
}
```

- [ ] **Step 5: Implement `src/sync/engine.ts`**

```ts
// The sync engine (spec §6). A round is push, then pull, under the
// "ignite-sync" Web Lock, so two tabs never run one at the same time. It
// writes to the UNDERLYING db, never the syncing wrapper, so an applied row
// can't re-enter the outbox. A round never throws: every outcome becomes a
// status (spec §8).

import {
	type Change,
	EPOCH,
	keyOf,
	MAX_BODY_BYTES,
	MAX_CHANGES,
	type PushResponse,
	SYNCED_STORES,
} from "../../shared/protocol";
import type { Api, ApiFailure } from "./api";
import { applyServerVersion } from "./apply";
import { toWire } from "./records";
import { splitBatches } from "./rules";
import type { SyncStatus } from "./status";
import {
	type Db,
	LOCAL_META,
	type OutboxEntry,
	type SyncMeta,
	type TxHandle,
} from "./types";

export const SYNC_LOCK = "ignite-sync";

const ROUND_STORES = [...SYNCED_STORES, "outbox", "meta"];

export interface SyncEngine {
	runRound(): Promise<void>;
	runRoundLocked(): Promise<void>;
	schedule(): void;
	start(): void;
	stop(): void;
	status(): SyncStatus;
}

type Round = { applied: boolean; invalid: number };
type Revs = Map<string, number>;

export function createSyncEngine({
	db,
	api,
	onApplied,
	onStatus,
	locks = navigator.locks,
	now = () => new Date(),
	debounceMs = 2000,
}: {
	db: Db;
	api: Api;
	onApplied: () => void;
	onStatus: (s: SyncStatus) => void;
	locks?: LockManager;
	now?: () => Date;
	debounceMs?: number;
}): SyncEngine {
	let current: SyncStatus = { kind: "local" };
	let timer: ReturnType<typeof setTimeout> | undefined;

	const setStatus = (s: SyncStatus) => {
		current = s;
		onStatus(s);
	};
	const readMeta = async () =>
		((await db.get("meta", "sync")) as SyncMeta | undefined) ?? LOCAL_META;
	const pendingCount = async () => (await db.getAll("outbox")).length;

	async function failed(error: ApiFailure): Promise<SyncStatus> {
		if (error === "unauthorized") return { kind: "needs-sign-in" };
		if (error === "outdated") return { kind: "needs-reload" };
		// Offline, a 5xx, anything else: the outbox is kept and the next
		// trigger retries.
		return { kind: "offline", pending: await pendingCount() };
	}

	// True when the entry still has the rev the push read. A moved rev means I
	// edited the row while the push was in flight: the response describes an
	// older version and must not touch the entry or the row (spec §6.1).
	async function unchanged(t: TxHandle, key: string, revs: Revs) {
		const rev = revs.get(key);
		const entry = (await t.get("outbox", key)) as OutboxEntry | undefined;
		return rev !== undefined && entry?.rev === rev;
	}

	async function isAccount(t: TxHandle) {
		const meta = (await t.get("meta", "sync")) as SyncMeta | undefined;
		return meta?.mode === "account";
	}

	// Reads every entry's row as it is NOW (spec §6.1) and remembers each rev.
	// A put whose row is gone is dropped here: sending it as a delete would
	// destroy the account's copy, and keeping it would block that key's pull
	// forever.
	function collect() {
		return db.transact([...SYNCED_STORES, "outbox"], "readwrite", async (t) => {
			const changes: Change[] = [];
			const revs: Revs = new Map();
			for (const entry of (await t.getAll("outbox")) as OutboxEntry[]) {
				if (entry.op === "delete") {
					changes.push({
						store: entry.store,
						id: entry.id,
						op: "delete",
						deletedAt: entry.deletedAt ?? EPOCH,
					});
				} else {
					const row = await t.get(entry.store, entry.id);
					if (!row) {
						await t.delete("outbox", entry.key);
						continue;
					}
					changes.push({
						store: entry.store,
						id: entry.id,
						op: "put",
						record: toWire(entry.store, row),
					});
				}
				revs.set(entry.key, entry.rev);
			}
			return { changes, revs };
		});
	}

	async function settle(res: PushResponse, revs: Revs, round: Round) {
		await db.transact(ROUND_STORES, "readwrite", async (t) => {
			if (!(await isAccount(t))) return;
			for (const key of res.accepted) {
				if (await unchanged(t, key, revs)) await t.delete("outbox", key);
			}
			for (const v of res.lost) {
				const key = keyOf(v.store, v.id);
				if (!(await unchanged(t, key, revs))) continue;
				if (await applyServerVersion(t, v)) round.applied = true;
				await t.delete("outbox", key);
			}
			for (const v of res.invalid) {
				const key = keyOf(v.store, v.id);
				// The key only, never the content (spec §6.1).
				console.warn(`Ignite sync: ${key} couldn't sync`);
				round.invalid++;
				if (!(await unchanged(t, key, revs))) continue;
				// "none": the account never had this row. Storing that would
				// delete what I just typed, so the local row stays (approved
				// 2026-09-30).
				if (v.kind !== "none" && (await applyServerVersion(t, v))) {
					round.applied = true;
				}
				await t.delete("outbox", key);
			}
		});
	}

	// One change the server still refuses as too large. There is no server
	// version to store, so the local row stays and only the entry goes, so
	// the queue can't jam (spec §8).
	async function dropOversized(change: Change, revs: Revs, round: Round) {
		const key = keyOf(change.store, change.id);
		console.warn(`Ignite sync: ${key} is too large to sync`);
		round.invalid++;
		await db.transact("outbox", "readwrite", async (t) => {
			if (await unchanged(t, key, revs)) await t.delete("outbox", key);
		});
	}

	// Resolves null when the batch is settled, or the failure that ends the round.
	async function send(
		batch: Change[],
		revs: Revs,
		round: Round,
	): Promise<ApiFailure | null> {
		const res = await api.push(batch);
		if (res.ok) {
			await settle(res.data, revs, round);
			return null;
		}
		if (res.error !== "too-large") return res.error;
		if (batch.length === 1) {
			await dropOversized(batch[0], revs, round);
			return null;
		}
		const half = Math.ceil(batch.length / 2);
		return (
			(await send(batch.slice(0, half), revs, round)) ??
			(await send(batch.slice(half), revs, round))
		);
	}

	// Resolves null to go on to the pull, or the status that ends the round.
	async function push(round: Round): Promise<SyncStatus | null> {
		const { changes, revs } = await collect();
		// The margin leaves room for the {"protocol":1,"changes":[…]} envelope.
		for (const batch of splitBatches(changes, MAX_CHANGES, MAX_BODY_BYTES - 1024)) {
			const error = await send(batch, revs, round);
			if (error) return failed(error);
		}
		return null;
	}

	async function pull(round: Round): Promise<SyncStatus> {
		for (;;) {
			const meta = await readMeta();
			if (meta.mode !== "account") return { kind: "local" };
			const res = await api.pull(meta.cursor);
			if (!res.ok) return failed(res.error);
			const page = res.data;
			const at = now().toISOString();
			const kept = await db.transact(ROUND_STORES, "readwrite", async (t) => {
				const fresh = (await t.get("meta", "sync")) as SyncMeta | undefined;
				// Signed out while this page was in flight: it belongs to an
				// account this device no longer holds (spec §4.5).
				if (fresh?.mode !== "account") return false;
				for (const change of page.changes) {
					// Still queued: that change pushes next round and wins or
					// loses on the server (spec §6.2).
					if (await t.get("outbox", keyOf(change.store, change.id))) continue;
					if (await applyServerVersion(t, change)) round.applied = true;
				}
				await t.put("meta", { ...fresh, cursor: page.cursor, lastSyncedAt: at });
				return true;
			});
			if (!kept) return { kind: "local" };
			// A page that doesn't move the cursor would loop forever against the
			// free tier's request quota (R1).
			if (!page.more || page.cursor <= meta.cursor) break;
		}
		if (round.invalid > 0) return { kind: "invalid", count: round.invalid };
		return { kind: "synced", at: now().toISOString() };
	}

	async function roundBody(): Promise<void> {
		const round: Round = { applied: false, invalid: 0 };
		try {
			if ((await readMeta()).mode !== "account") {
				setStatus({ kind: "local" });
				return;
			}
			setStatus({ kind: "syncing" });
			setStatus((await push(round)) ?? (await pull(round)));
		} catch (err) {
			// An IndexedDB failure. The app keeps working and the next trigger
			// retries.
			console.error("Ignite sync: round failed", err);
			setStatus({ kind: "offline", pending: await pendingCount().catch(() => 0) });
		} finally {
			if (round.applied) onApplied();
		}
	}

	async function runRound(): Promise<void> {
		await locks.request(SYNC_LOCK, () => roundBody());
	}

	const fire = () => {
		void runRound();
	};
	const onVisible = () => {
		if (document.visibilityState === "visible") fire();
	};

	return {
		runRound,
		// For a caller that already holds SYNC_LOCK (sign-in, sign-out). Web
		// Locks are not reentrant: runRound there would wait for itself forever.
		runRoundLocked: roundBody,
		schedule() {
			clearTimeout(timer);
			timer = setTimeout(fire, debounceMs);
		},
		start() {
			fire();
			document.addEventListener("visibilitychange", onVisible);
			window.addEventListener("online", fire);
		},
		stop() {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("online", fire);
		},
		status: () => current,
	};
}
```

Network calls (`api.push`, `api.pull`) always happen between transactions, never inside one. Inside every `db.transact` callback the only awaits are `t.*` calls and `applyServerVersion`, which itself only awaits `t.*`.

- [ ] **Step 6: Run the tests, then the checks**

Run: `npx vitest run tests/sync && npx biome check --write src/sync tests/sync && npm run check`
Expected: PASS for every suite in `tests/sync`, then no Biome or `tsc --noEmit` errors.

- [ ] **Step 7: Commit**

```bash
git add src/sync/apply.ts src/sync/engine.ts tests/sync/helpers.ts tests/sync/apply.test.ts tests/sync/engine.test.ts
git commit -m "feat(sync): sync engine with push, pull and the sync lock"
```

---

### Task 14: Account flows

Sign-in and sign-up with the spec's copy, the first sign-in matrix, a different account after an expired session, and sign-out with its wipe. Spec §5.4, §7, §8.

**Files:**
- Create: `src/sync/account.ts`
- Test: `tests/sync/account.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `EPOCH`, `keyOf`, `SYNCED_STORES`.
  - Task 4: `isSeedOnly`; `toWire` (tests only).
  - Task 5: `Db`, `OutboxEntry`, `SyncMeta`, `LOCAL_META`.
  - Task 12: `Api`, `ApiFailure`; `ApiResult` (tests only).
  - Task 13: `SyncEngine`, `SYNC_LOCK`; `createSyncEngine` and the test helpers in `tests/sync/helpers.ts` (tests only).
- Produces:
  - `FirstSignInChoice`, `SignInResult`, `SignOutResult`, `interface Account` exactly as CONTRACT.
  - `createAccount(deps: { db: Db; api: Api; engine: SyncEngine; reseed: () => Promise<void>; chooseFirstSignIn: () => Promise<FirstSignInChoice>; onDataChanged: () => void; locks?: LockManager }): Account`. `onDataChanged` is called once after every local wipe (sign-out, "replace", and signing in as a different account), so Task 15 can run `controller.refresh()` and post `"data-changed"` on the `BroadcastChannel`.

**How each case is decided:**

- **Is the account empty?** `api.pull(0)` returns zero changes. An account that has ever synced holds at least the Focus area, which can't be deleted, so zero changes means it was never used. That first page is thrown away and the round pulls it again: one extra request, once per device.
- **Same account again** (the session expired, spec §7): the emails are compared trimmed and lowercased. The queue is kept and pushed. No wipe, no question.
- **Different account:** a local wipe, then the first sign-in matrix. **If the old account still has unsynced changes, the sign-in is refused** and the new session ended. This session can't push them to the old account, and wiping would lose them. I can still get out: Sign out (it asks "Sign out anyway?") and then sign in. This refusal and its copy are new (decision for Malin).
- **The whole of `signIn` runs under `SYNC_LOCK`.** Between the moment the new session cookie lands and the moment `meta` names the new account, a round started by a trigger would push the old account's queue with the new account's session. Holding the lock closes that window. So `signIn` calls `engine.runRoundLocked()`, not `runRound()`.
- **Cancel** ends the session with `api.signOut()` and leaves the device exactly as it was.
- **Sign-out when already local** does nothing. Wiping there would delete a local-only user's tasks.
- **Offline sign-out** still wipes. The session cookie can't be cleared without a response, so it stays until it expires (at most 60 days with "Stay signed in"). This device shows no account data either way (flag it).

New copy beyond spec §8's four messages (decisions for Malin): "Couldn't create that account." (every other sign-up failure, the allowlist refusal included, so it can't be probed) · "Sign-in cancelled. Nothing on this device changed." · "1 change from the last account hasn't synced. Sign in to that account, or sign out first." · "Ignite has updated. Reload to keep syncing." (reused from the status line).

Task 15 builds `reseed` with `createReseed(rawDb)` (`src/sync/reseed.ts`): the same model code the app runs at boot, on the UNDERLYING db, never the syncing wrapper, so nothing is queued and the seed rows serialize as `EPOCH`. The returned model objects are discarded; the controller's own models read the same stores.

- [ ] **Step 1: Write the failing tests**

`tests/sync/account.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	EPOCH,
	keyOf,
	type PulledChange,
	type PullResponse,
} from "../../shared/protocol";
import { createAreaModel } from "../../src/model/areas.js";
import { createSettingsModel } from "../../src/model/settings.js";
import { createAccount, type FirstSignInChoice } from "../../src/sync/account";
import type { ApiResult } from "../../src/sync/api";
import { createSyncEngine } from "../../src/sync/engine";
import { toWire } from "../../src/sync/records";
import { LOCAL_META, type SyncMeta } from "../../src/sync/types";
import {
	closeAll,
	type FakeApi,
	fakeApi,
	fakeLocks,
	freshDb,
	pulled,
	queueTask,
	wireTask,
} from "./helpers";

afterEach(closeAll);

const PASSWORD = "correct horse battery staple";
const SEED_KEYS = ["areas:focus", "sections:focus-default", "settings:app"];

// The account's Focus area, older than any fresh seed.
const accountFocus = pulled(
	"areas",
	toWire("areas", {
		id: "focus",
		name: "Focus",
		icon: "🔥",
		critical: false,
		order: 0,
		updatedAt: "2026-09-01T00:00:00.000Z",
	}),
);
const accountTask = pulled("tasks", wireTask("a1", "From my account"));

// Serves `changes` as the account's whole history: all of it from cursor 0,
// nothing after.
const history =
	(changes: PulledChange[]) =>
	async (since: number): Promise<ApiResult<PullResponse>> => ({
		ok: true,
		data:
			since === 0
				? { changes, cursor: changes.length, more: false }
				: { changes: [], cursor: since, more: false },
	});

async function setup({
	api = fakeApi(),
	meta,
	choice = "add",
}: { api?: FakeApi; meta?: Partial<SyncMeta>; choice?: FirstSignInChoice } = {}) {
	const db = await freshDb(meta);
	// What the app runs at boot, and what reseed must reproduce.
	const reseed = async () => {
		await createAreaModel(db);
		await createSettingsModel(db);
	};
	await reseed();
	const locks = fakeLocks();
	const engine = createSyncEngine({
		db,
		api,
		locks,
		onApplied: () => {},
		onStatus: () => {},
	});
	const chooseFirstSignIn = vi.fn(async () => choice);
	const onDataChanged = vi.fn();
	const account = createAccount({
		db,
		api,
		engine,
		reseed,
		chooseFirstSignIn,
		onDataChanged,
		locks,
	});
	return { db, api, account, chooseFirstSignIn, onDataChanged };
}

const pushedKeys = (api: FakeApi) =>
	api.pushed
		.flat()
		.map((c) => keyOf(c.store, c.id))
		.sort();

describe("first sign-in", () => {
	it("uploads every local row, seed rows included, when the account is empty", async () => {
		const { db, api, account, chooseFirstSignIn } = await setup();
		await queueTask(db, "t1", "Local"); // local mode: stored, not queued
		expect(await account.signIn("me@example.com", PASSWORD, false)).toEqual({
			ok: true,
			email: "me@example.com",
		});
		expect(api.pulled[0]).toBe(0);
		expect(pushedKeys(api)).toEqual([...SEED_KEYS, "tasks:t1"]);
		expect(chooseFirstSignIn).not.toHaveBeenCalled();
		expect(await account.meta()).toMatchObject({
			mode: "account",
			userEmail: "me@example.com",
		});
	});

	it("only downloads when this device holds nothing but the seed", async () => {
		const { db, api, account, chooseFirstSignIn } = await setup({
			api: fakeApi({ pull: history([accountFocus, accountTask]) }),
		});
		await account.signIn("me@example.com", PASSWORD, false);
		expect(api.pushed).toEqual([]);
		expect((await db.get("tasks", "a1"))?.title).toBe("From my account");
		expect((await db.get("areas", "focus"))?.updatedAt).toBe(
			"2026-09-01T00:00:00.000Z",
		);
		expect(chooseFirstSignIn).not.toHaveBeenCalled();
	});

	it('asks, and "add" uploads my rows but never the seed rows or settings', async () => {
		const { db, api, account, chooseFirstSignIn } = await setup({
			api: fakeApi({ pull: history([accountFocus, accountTask]) }),
			choice: "add",
		});
		await queueTask(db, "t1", "Local");
		await account.signIn("me@example.com", PASSWORD, false);
		expect(chooseFirstSignIn).toHaveBeenCalledTimes(1);
		expect(pushedKeys(api)).toEqual(["tasks:t1"]);
		expect((await db.get("tasks", "t1"))?.title).toBe("Local");
		expect((await db.get("tasks", "a1"))?.title).toBe("From my account");
	});

	it('"replace" deletes this device\'s tasks and takes the account\'s', async () => {
		const { db, api, account, onDataChanged } = await setup({
			api: fakeApi({ pull: history([accountFocus, accountTask]) }),
			choice: "replace",
		});
		await queueTask(db, "t1", "Local");
		await account.signIn("me@example.com", PASSWORD, false);
		expect(await db.get("tasks", "t1")).toBeUndefined();
		expect((await db.get("tasks", "a1"))?.title).toBe("From my account");
		expect((await db.get("areas", "focus"))?.updatedAt).toBe(
			"2026-09-01T00:00:00.000Z",
		);
		expect(api.pushed).toEqual([]);
		expect(onDataChanged).toHaveBeenCalledTimes(1);
	});

	it('"cancel" ends the session and leaves this device local and untouched', async () => {
		const { db, api, account } = await setup({
			api: fakeApi({ pull: history([accountFocus, accountTask]) }),
			choice: "cancel",
		});
		await queueTask(db, "t1", "Local");
		expect(await account.signIn("me@example.com", PASSWORD, false)).toEqual({
			ok: false,
			message: "Sign-in cancelled. Nothing on this device changed.",
		});
		expect(api.signedOut).toBe(1);
		expect((await account.meta()).mode).toBe("local");
		expect((await db.get("tasks", "t1"))?.title).toBe("Local");
		expect(await db.getAll("outbox")).toEqual([]);
	});

	it("ends the session when it can't read the account", async () => {
		const { api, account } = await setup({
			api: fakeApi({ pull: async () => ({ ok: false, error: "offline" }) }),
		});
		expect(await account.signIn("me@example.com", PASSWORD, false)).toEqual({
			ok: false,
			message: "Can't reach Ignite's server. Check your connection.",
		});
		expect(api.signedOut).toBe(1);
		expect((await account.meta()).mode).toBe("local");
	});
});

describe("signing in again", () => {
	it("keeps and pushes the queue when the same account signs in after its session expired", async () => {
		const { db, api, account, chooseFirstSignIn, onDataChanged } = await setup({
			meta: { mode: "account", userEmail: "me@example.com" },
		});
		await queueTask(db, "t1", "One");
		await queueTask(db, "t2", "Two");
		expect(await db.getAll("outbox")).toHaveLength(2);
		await account.signIn("me@example.com", PASSWORD, false);
		expect(chooseFirstSignIn).not.toHaveBeenCalled();
		expect(onDataChanged).not.toHaveBeenCalled();
		expect(pushedKeys(api)).toEqual(["tasks:t1", "tasks:t2"]);
		expect(await db.getAll("outbox")).toEqual([]);
		expect((await db.get("tasks", "t1"))?.title).toBe("One");
	});

	it("compares emails trimmed and lowercased", async () => {
		const { db, account, chooseFirstSignIn, onDataChanged } = await setup({
			meta: { mode: "account", userEmail: "malin@x.no" },
		});
		await queueTask(db, "t1", "Mine");
		await account.signIn("Malin@X.no ", PASSWORD, false);
		expect(onDataChanged).not.toHaveBeenCalled();
		expect(chooseFirstSignIn).not.toHaveBeenCalled();
		expect((await db.get("tasks", "t1"))?.title).toBe("Mine");
		expect((await account.meta()).userEmail).toBe("malin@x.no");
	});

	it("treats a different account as a sign-out, then a first sign-in", async () => {
		const { db, api, account, onDataChanged } = await setup({
			meta: { mode: "account", userEmail: "old@example.com", cursor: 12 },
		});
		await db.put("tasks", { id: "old1", sectionId: "focus-default", title: "Old" });
		await account.signIn("new@example.com", PASSWORD, false);
		expect(await db.get("tasks", "old1")).toBeUndefined();
		expect(pushedKeys(api)).toEqual(SEED_KEYS);
		expect(await account.meta()).toMatchObject({
			mode: "account",
			userEmail: "new@example.com",
			cursor: 0,
		});
		expect(onDataChanged).toHaveBeenCalledTimes(1);
	});

	it("refuses a different account while the last one has unsynced changes", async () => {
		const { db, api, account } = await setup({
			meta: { mode: "account", userEmail: "old@example.com" },
		});
		await queueTask(db, "t1", "Unsynced");
		expect(await account.signIn("new@example.com", PASSWORD, false)).toEqual({
			ok: false,
			message:
				"1 change from the last account hasn't synced. Sign in to that account, or sign out first.",
		});
		expect(api.signedOut).toBe(1);
		expect((await db.get("tasks", "t1"))?.title).toBe("Unsynced");
		expect((await account.meta()).userEmail).toBe("old@example.com");
	});
});

describe("sign-in errors", () => {
	it.each([
		["bad-credentials", false, "Email or password is wrong"],
		["rate-limited", false, "Too many attempts. Try again in a minute."],
		["offline", false, "Can't reach Ignite's server. Check your connection."],
		["server", false, "Can't reach Ignite's server. Check your connection."],
		["too-short", true, "Password must be at least 15 characters."],
		["rate-limited", true, "Too many attempts. Try again in a minute."],
		["exists", true, "Couldn't create that account."],
		["server", true, "Couldn't create that account."],
	] as const)("%s (sign-up: %s) reads %j", async (error, signUp, message) => {
		const fail = async (): Promise<ApiResult<{ email: string }>> => ({
			ok: false,
			error,
		});
		const { account } = await setup({ api: fakeApi({ signIn: fail, signUp: fail }) });
		expect(
			await account.signIn("me@example.com", PASSWORD, false, { signUp }),
		).toEqual({ ok: false, message });
		expect((await account.meta()).mode).toBe("local");
	});

	it("creates the account through sign-up when asked", async () => {
		const signUp = vi.fn(
			async (email: string, _password: string, _rememberMe: boolean) => ({
				ok: true as const,
				data: { email },
			}),
		);
		const { account } = await setup({ api: fakeApi({ signUp }) });
		await account.signIn("me@example.com", PASSWORD, true, { signUp: true });
		expect(signUp).toHaveBeenCalledWith("me@example.com", PASSWORD, true);
		expect((await account.meta()).mode).toBe("account");
	});
});

describe("sign-out", () => {
	it("pushes first, then wipes this device back to a fresh local install", async () => {
		const { db, api, account, onDataChanged } = await setup({
			meta: { mode: "account", userEmail: "me@example.com", cursor: 40 },
		});
		await queueTask(db, "t1", "Mine");
		expect(await account.signOut()).toEqual({ ok: true });
		expect(pushedKeys(api)).toEqual(["tasks:t1"]);
		expect(api.signedOut).toBe(1);
		expect(await db.getAll("tasks")).toEqual([]);
		expect(await db.getAll("outbox")).toEqual([]);
		expect((await db.getAll("areas")).map((a) => a.id)).toEqual(["focus"]);
		expect((await db.getAll("sections")).map((s) => s.id)).toEqual(["focus-default"]);
		expect(await db.get("meta", "sync")).toEqual(LOCAL_META);
		expect(onDataChanged).toHaveBeenCalledTimes(1);
	});

	it("refuses while changes are unsynced, and signs out when forced", async () => {
		const { db, api, account } = await setup({
			api: fakeApi({ push: async () => ({ ok: false, error: "offline" }) }),
			meta: { mode: "account", userEmail: "me@example.com" },
		});
		await queueTask(db, "t1", "Unsynced");
		expect(await account.signOut()).toEqual({
			ok: false,
			reason: "unsynced",
			pending: 1,
		});
		expect(api.signedOut).toBe(0);
		expect((await db.get("tasks", "t1"))?.title).toBe("Unsynced");

		expect(await account.signOut({ force: true })).toEqual({ ok: true });
		expect(api.signedOut).toBe(1);
		expect(await db.getAll("tasks")).toEqual([]);
	});

	it("keeps an edit another tab queued while the server sign-out ran", async () => {
		// The last push found nothing pending. The edit lands in the gap
		// between that check and the wipe.
		let queueLate = async () => {};
		const { db, api, account, onDataChanged } = await setup({
			api: fakeApi({
				signOut: async () => {
					await queueLate();
					return { ok: true, data: null };
				},
			}),
			meta: { mode: "account", userEmail: "me@example.com" },
		});
		queueLate = async () => {
			await queueTask(db, "t1", "Typed in another tab");
		};
		expect(await account.signOut()).toEqual({
			ok: false,
			reason: "unsynced",
			pending: 1,
		});
		expect(api.signedOut).toBe(1);
		expect((await db.get("tasks", "t1"))?.title).toBe("Typed in another tab");
		expect(await db.get("outbox", "tasks:t1")).toBeDefined();
		expect(onDataChanged).not.toHaveBeenCalled();
	});

	it("still wipes when the server can't be reached to end the session", async () => {
		const { db, account } = await setup({
			api: fakeApi({ signOut: async () => ({ ok: false, error: "offline" }) }),
			meta: { mode: "account", userEmail: "me@example.com" },
		});
		await db.put("tasks", { id: "t1", sectionId: "focus-default", title: "Synced" });
		expect(await account.signOut()).toEqual({ ok: true });
		expect(await db.getAll("tasks")).toEqual([]);
	});

	it("keeps the theme and sidebar state and resets the quiet hours", async () => {
		const { db, account } = await setup({
			meta: { mode: "account", userEmail: "me@example.com" },
		});
		await db.put("settings", {
			id: "app",
			quietStart: 21,
			quietEnd: 6,
			theme: "light",
			sidebarCollapsed: true,
			updatedAt: "2026-09-02T00:00:00.000Z",
		});
		await account.signOut();
		expect(await db.get("settings", "app")).toEqual({
			id: "app",
			quietStart: 23,
			quietEnd: 7,
			theme: "light",
			sidebarCollapsed: true,
			updatedAt: EPOCH,
		});
	});

	it("touches nothing in local mode", async () => {
		const { db, api, account, onDataChanged } = await setup();
		await queueTask(db, "t1", "Local only");
		expect(await account.signOut()).toEqual({ ok: true });
		expect((await db.get("tasks", "t1"))?.title).toBe("Local only");
		expect(api.signedOut).toBe(0);
		expect(onDataChanged).not.toHaveBeenCalled();
	});

	it("reads local meta when none is stored", async () => {
		const { account } = await setup();
		expect(await account.meta()).toEqual(LOCAL_META);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/sync/account.test.ts`
Expected: FAIL. The suite cannot import `../../src/sync/account`.

- [ ] **Step 3: Implement `src/sync/account.ts`**

```ts
// Sign-in, the first sign-in on a device, and sign-out (spec §7, §8).
// Everything that changes which account this device holds runs under the
// "ignite-sync" lock, so no round can push one account's queue with another
// account's session.

import { EPOCH, keyOf, SYNCED_STORES } from "../../shared/protocol";
import type { Api, ApiFailure } from "./api";
import { SYNC_LOCK, type SyncEngine } from "./engine";
import { isSeedOnly } from "./rules";
import { type Db, LOCAL_META, type OutboxEntry, type SyncMeta } from "./types";

export type FirstSignInChoice = "add" | "replace" | "cancel";
export type SignInResult =
	| { ok: true; email: string }
	| { ok: false; message: string };
export type SignOutResult =
	| { ok: true }
	| { ok: false; reason: "unsynced"; pending: number };

export interface Account {
	signIn(
		email: string,
		password: string,
		rememberMe: boolean,
		opts?: { signUp?: boolean },
	): Promise<SignInResult>;
	signOut(opts?: { force?: boolean }): Promise<SignOutResult>;
	meta(): Promise<SyncMeta>;
}

const WRONG = "Email or password is wrong";
const RATE_LIMITED = "Too many attempts. Try again in a minute.";
const OFFLINE = "Can't reach Ignite's server. Check your connection.";
const TOO_SHORT = "Password must be at least 15 characters.";
const RELOAD = "Ignite has updated. Reload to keep syncing.";
// Every other sign-up failure reads the same, the allowlist refusal
// included, so the allowlist can't be probed (spec §5.4).
const SIGN_UP_FAILED = "Couldn't create that account.";
const CANCELLED = "Sign-in cancelled. Nothing on this device changed.";

// "Add" never uploads these. Every install seeds the Focus rows with a fresh
// updatedAt, so they would beat the account's copies under last write wins
// (spec §7). The account's quiet hours win over this device's too.
const SKIP_ON_ADD = new Set(["areas:focus", "sections:focus-default", "settings:app"]);

// Must match DEFAULTS in src/model/settings.js.
const QUIET_DEFAULTS = { quietStart: 23, quietEnd: 7 };

const WIPED = ["areas", "sections", "tasks", "outbox"];

const sameEmail = (a: string | null, b: string) =>
	(a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

function messageFor(error: ApiFailure, signUp: boolean): string {
	if (error === "bad-credentials") return WRONG;
	if (error === "rate-limited") return RATE_LIMITED;
	if (error === "too-short") return TOO_SHORT;
	if (error === "offline") return OFFLINE;
	if (error === "outdated") return RELOAD;
	return signUp ? SIGN_UP_FAILED : OFFLINE;
}

function unsynced(pending: number): string {
	const changes = pending === 1 ? "1 change" : `${pending} changes`;
	const verb = pending === 1 ? "hasn't" : "haven't";
	return `${changes} from the last account ${verb} synced. Sign in to that account, or sign out first.`;
}

export function createAccount({
	db,
	api,
	engine,
	reseed,
	chooseFirstSignIn,
	onDataChanged,
	locks = navigator.locks,
}: {
	db: Db;
	api: Api;
	engine: SyncEngine;
	reseed: () => Promise<void>;
	chooseFirstSignIn: () => Promise<FirstSignInChoice>;
	onDataChanged: () => void;
	locks?: LockManager;
}): Account {
	const readMeta = async () =>
		((await db.get("meta", "sync")) as SyncMeta | undefined) ?? LOCAL_META;
	const pendingCount = async () => (await db.getAll("outbox")).length;

	// "data" clears what belongs to an account. "all" also resets the synced
	// settings fields and meta: a full sign-out (spec §7). Both re-seed Focus,
	// so the app always has its Focus area, even if the next pull fails.
	// With keepIfPending, a non-empty outbox stops the wipe inside its own
	// transaction: nothing is cleared, and the count comes back. Otherwise 0.
	async function wipe(
		scope: "data" | "all",
		{ keepIfPending = false } = {},
	): Promise<number> {
		const pending = await db.transact(
			[...WIPED, "settings", "meta"],
			"readwrite",
			async (t) => {
				if (keepIfPending) {
					const queued = (await t.getAll("outbox")).length;
					if (queued > 0) return queued;
				}
				for (const store of WIPED) await t.clear(store);
				if (scope === "data") return 0;
				const settings = await t.get("settings", "app");
				// Theme and sidebar state belong to this device and survive (§4.3).
				if (settings) {
					await t.put("settings", {
						...settings,
						...QUIET_DEFAULTS,
						updatedAt: EPOCH,
					});
				}
				await t.put("meta", { ...LOCAL_META });
				return 0;
			},
		);
		if (pending > 0) return pending;
		await reseed();
		onDataChanged();
		return 0;
	}

	// Queues the upload and switches to account mode in ONE transaction: either
	// the device is signed in with its upload queued, or neither happened.
	async function enterAccount(email: string, upload: "all" | "add" | "none") {
		await db.transact([...SYNCED_STORES, "outbox", "meta"], "readwrite", async (t) => {
			if (upload !== "none") {
				for (const store of SYNCED_STORES) {
					for (const row of await t.getAll(store)) {
						const id = row.id as string;
						const key = keyOf(store, id);
						if (upload === "add" && SKIP_ON_ADD.has(key)) continue;
						const entry: OutboxEntry = { key, store, id, op: "put", rev: 1 };
						await t.put("outbox", entry);
					}
				}
			}
			const meta: SyncMeta = {
				id: "sync",
				mode: "account",
				cursor: 0,
				userEmail: email,
				lastSyncedAt: null,
			};
			await t.put("meta", meta);
		});
	}

	// The first sign-in matrix (spec §7 table). Runs under SYNC_LOCK.
	async function firstSignIn(email: string): Promise<SignInResult> {
		// Zero changes from cursor 0 means the account was never used: one
		// that has synced holds at least the Focus area, which can't be deleted.
		const first = await api.pull(0);
		if (!first.ok) {
			await api.signOut();
			return { ok: false, message: messageFor(first.error, false) };
		}
		let upload: "all" | "add" | "none" = "all";
		if (first.data.changes.length > 0) {
			const local = await db.transact(
				["areas", "sections", "tasks"],
				"readonly",
				async (t) => ({
					areas: (await t.getAll("areas")) as { id: string }[],
					sections: (await t.getAll("sections")) as { id: string }[],
					tasks: await t.getAll("tasks"),
				}),
			);
			if (isSeedOnly(local)) {
				upload = "none";
			} else {
				const choice = await chooseFirstSignIn();
				if (choice === "cancel") {
					await api.signOut();
					return { ok: false, message: CANCELLED };
				}
				if (choice === "replace") await wipe("data");
				upload = choice === "add" ? "add" : "none";
			}
		}
		await enterAccount(email, upload);
		await engine.runRoundLocked();
		return { ok: true, email };
	}

	return {
		async signIn(email, password, rememberMe, opts = {}) {
			const signUp = opts.signUp === true;
			return locks.request(SYNC_LOCK, async (): Promise<SignInResult> => {
				const res = signUp
					? await api.signUp(email, password, rememberMe)
					: await api.signIn(email, password, rememberMe);
				if (!res.ok) return { ok: false, message: messageFor(res.error, signUp) };
				const signedIn = res.data.email;
				const meta = await readMeta();
				if (meta.mode === "account") {
					// The session expired and the same account came back: push
					// what queued meanwhile (spec §7). runRound would wait on the
					// lock this callback holds, so the locked variant runs.
					if (sameEmail(meta.userEmail, signedIn)) {
						await engine.runRoundLocked();
						return { ok: true, email: signedIn };
					}
					// A different account is a sign-out, then a first sign-in. The
					// old account's unsynced changes can't reach it with this
					// session, and a wipe would lose them, so refuse instead.
					const pending = await pendingCount();
					if (pending > 0) {
						await api.signOut();
						return { ok: false, message: unsynced(pending) };
					}
					await wipe("all");
				}
				return firstSignIn(signedIn);
			});
		},

		async signOut({ force = false } = {}) {
			return locks.request(SYNC_LOCK, async (): Promise<SignOutResult> => {
				// Nothing to sign out of. A wipe here would delete a local-only
				// user's tasks.
				if ((await readMeta()).mode !== "account") return { ok: true };
				// One last push, under the lock this callback already holds.
				await engine.runRoundLocked();
				const pending = await pendingCount();
				if (pending > 0 && !force) return { ok: false, reason: "unsynced", pending };
				// Offline, the cookie can't be cleared: it stays until it expires.
				// The wipe still runs, so this device shows no account data.
				await api.signOut();
				// Another tab can queue an edit while api.signOut() runs, after the
				// count above. The wipe checks the outbox again in its own
				// transaction, so it never deletes a change nobody was asked about.
				// The server session is already gone; signing in again as the same
				// email pushes the edit, like an expired session does (spec §7).
				const late = await wipe("all", { keepIfPending: !force });
				if (late > 0) return { ok: false, reason: "unsynced", pending: late };
				// Meta is local now, so this only resets the engine's status.
				await engine.runRoundLocked();
				return { ok: true };
			});
		},

		meta: readMeta,
	};
}
```

`locks.request` resolves with the callback's result. Both methods are `async`, so TypeScript checks the awaited value against `SignInResult` and `SignOutResult` whichever way the DOM typings declare `request`'s return type.

- [ ] **Step 4: Run the tests, then the whole suite and the checks**

Run: `npx vitest run tests/sync && npx biome check --write src/sync tests/sync && npm run check && npm run test:run`
Expected: PASS. Every suite in `tests/sync` and every existing model test is green, and Biome and `tsc --noEmit` report no errors.

- [ ] **Step 5: Commit**

```bash
git add src/sync/account.ts tests/sync/account.test.ts
git commit -m "feat(sync): sign-in, first sign-in matrix and sign-out"
```


---

### Task 15: App wiring

The syncing db goes under the models, sync starts after the first render, other tabs hear about remote changes, and the app moves from `/ignite/` to the root of its own origin. Spec §3, §4.1, §4.5, §6.3, §9 (service worker), §10 (R2), §11 (base).

**Files:**
- Modify: `src/controller.js` (header comment, `start()`, the returned object)
- Modify: `src/app.js` (whole file)
- Modify: `src/main.js` (the registration block)
- Modify: `public/sw.js` (`VERSION`, `SCOPE`, the top of the `fetch` handler)
- Modify: `vite.config.js` (whole file)
- Modify: `scripts/gen-preview.mjs` (one comment)
- Modify: `main.css` (one rule for the blocked-upgrade notice)
- Create: `src/sync/reseed.ts`
- Create (local, gitignored): `.superpowers/e2e/credentials.local` (Step 11), `.superpowers/r2-measurements.md` (Step 17)
- Test: `tests/sync/reseed.test.ts`

**Interfaces:**
- Consumes: `openDB(name?, { onBlocked?, onVersionChange? })` (Task 3), `createSyncingDb` and `Db` (Task 5), `EPOCH` (Task 2), `createApi` (Task 12), `createSyncEngine` (Task 13), `createAccount` (Task 14, including the `onDataChanged` dependency), `createAreaModel`, `createSettingsModel` (existing models).
- Produces:
  - `createController({ models, els })` returns `{ start(): Promise<void>; stop(): void; refresh(): Promise<void> }`. `start()` returns its first `applyState()` promise. `refresh` is `applyState`.
  - `createReseed(db: Db): () => Promise<void>` (`src/sync/reseed.ts`). Re-creates the Focus area, its section and the settings row's defaults, writing to the db it is given. App passes the UNDERLYING db.
  - `window.__ignite = { account, engine, db }`, **dev server only** (`import.meta.env.DEV`). A console handle for the browser checks in Tasks 15 and 16. It is dropped from every build.
  - Vite dev proxy: `/api` on the dev server goes to `http://localhost:8787` (wrangler dev), with the `Origin` header rewritten to `http://localhost:8787`.

**Where the browser checks run.** Never on `http://localhost:5173`. That origin holds my real tasks in IndexedDB, and signing out wipes them. Every check in Tasks 15, 16 and 19 runs on a throwaway origin: `http://localhost:5174` (a second Vite server), `http://localhost:4174` (a second `vite preview`), `http://localhost:8787` (wrangler dev) or `http://127.0.0.1:5175`. Each has its own IndexedDB.

**Why the proxy rewrites `Origin`.** The page is on `localhost:5174` and the Worker on `localhost:8787`. Better Auth checks `Origin` against `BETTER_AUTH_URL` (`http://localhost:8787` in `.dev.vars`), and the sync routes check it against their own origin. Rewriting it in the dev proxy keeps one `BETTER_AUTH_URL` for every local setup. Cookies ignore the port, so the session cookie the Worker sets reaches the page. This only exists in `vite.config.js`'s dev server; production has one origin and no proxy.

- [ ] **Step 1: Write the failing reseed tests**

`tests/sync/reseed.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { EPOCH } from "../../shared/protocol";
import { openDB } from "../../src/model/db.js";
import { createReseed } from "../../src/sync/reseed";
import type { Db } from "../../src/sync/types";

let handles: Db[] = [];
afterEach(() => {
	for (const h of handles) h.close();
	handles = [];
});

async function fresh(): Promise<Db> {
	const db = (await openDB(`ignite-test-${crypto.randomUUID()}`)) as Db;
	handles.push(db);
	return db;
}

describe("createReseed", () => {
	it("recreates the Focus area, its section and the settings row after a wipe", async () => {
		const db = await fresh();
		await createReseed(db)();
		expect(await db.get("areas", "focus")).toMatchObject({ id: "focus", name: "Focus" });
		expect(await db.get("sections", "focus-default")).toMatchObject({
			areaId: "focus",
			name: "Tasks",
		});
		expect(await db.get("settings", "app")).toMatchObject({ quietStart: 23, quietEnd: 7 });
	});

	it("leaves the seeded Focus rows unstamped, so they serialize as EPOCH and never win", async () => {
		const db = await fresh();
		await createReseed(db)();
		expect((await db.get("areas", "focus"))?.updatedAt).toBeUndefined();
		expect((await db.get("sections", "focus-default"))?.updatedAt).toBeUndefined();
	});

	it("keeps this device's theme and restores the quiet-hour defaults a wipe removed", async () => {
		const db = await fresh();
		await db.put("settings", {
			id: "app",
			theme: "light",
			sidebarCollapsed: true,
			updatedAt: "2026-09-01T00:00:00.000Z",
		});
		await createReseed(db)();
		expect(await db.get("settings", "app")).toEqual({
			id: "app",
			theme: "light",
			sidebarCollapsed: true,
			quietStart: 23,
			quietEnd: 7,
			updatedAt: EPOCH,
		});
	});

	it("does not touch rows that are already complete", async () => {
		const db = await fresh();
		const area = {
			id: "focus",
			name: "Focus",
			icon: "⭐",
			critical: false,
			order: 0,
			updatedAt: "2026-09-01T00:00:00.000Z",
		};
		const settings = {
			id: "app",
			quietStart: 22,
			quietEnd: 6,
			theme: "dark",
			sidebarCollapsed: false,
			updatedAt: "2026-09-01T00:00:00.000Z",
		};
		await db.put("areas", area);
		await db.put("settings", settings);
		await createReseed(db)();
		expect(await db.get("areas", "focus")).toEqual(area);
		expect(await db.get("settings", "app")).toEqual(settings);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/sync/reseed.test.ts`
Expected: FAIL, "Cannot find module '../../src/sync/reseed'".

- [ ] **Step 3: Implement `src/sync/reseed.ts`**

```ts
// Re-creates what a fresh install seeds: the Focus area, its section and the
// settings row. The account flows call it after a sign-out wipe and after a
// "replace" wipe (spec §7).
//
// Constructing a model runs its seed, so a throwaway instance does the work and
// is dropped at once. The models the controller holds keep no cache (every
// list() and get() reads IndexedDB), so controller.refresh() afterwards shows
// the new rows without re-creating them.
//
// Give it the UNDERLYING db, not the syncing wrapper. Through the wrapper, in
// account mode, the Focus rows would be queued with a fresh updatedAt and beat
// the account's own copies under last-write-wins. Unstamped, they serialize as
// EPOCH and never win.

import { EPOCH } from "../../shared/protocol";
import { createAreaModel } from "../model/areas.js";
import { createSettingsModel } from "../model/settings.js";
import type { Db } from "./types";

// Mirrors DEFAULTS in src/model/settings.js. That model seeds a row only when
// none exists, so it cannot refill quiet hours that a wipe removed from a row
// that is still there (the row keeps this device's theme).
const QUIET_DEFAULTS = { quietStart: 23, quietEnd: 7 };

export function createReseed(db: Db): () => Promise<void> {
	return async () => {
		await createAreaModel(db);
		await createSettingsModel(db);
		const row = await db.get("settings", "app");
		if (row && (row.quietStart === undefined || row.quietEnd === undefined)) {
			await db.put("settings", {
				...row,
				quietStart: row.quietStart ?? QUIET_DEFAULTS.quietStart,
				quietEnd: row.quietEnd ?? QUIET_DEFAULTS.quietEnd,
				updatedAt: EPOCH,
			});
		}
	};
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/sync/reseed.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Let the controller report its first render and expose `refresh`**

In `src/controller.js`, replace line 1:

```js
// createController({ models, els }) → { start(), stop(), refresh() }
```

In `start()`, the three lines after `unsubs.push(...)` read `currentRoute = routeFromHash();`, `mountMainView(currentRoute);`, `applyState();`. Replace the `applyState();` line (the one inside `start()`, directly after `mountMainView(currentRoute);`) with:

```js
		// The first render. Returned at the end of start() so app.js can start
		// sync only after it: the first paint never waits for the network (R2).
		const firstRender = applyState();
```

At the end of `start()`, after `tickHandle = setInterval(applyState, TICK_MS);`, add:

```js

		return firstRender;
```

Replace the last line of `createController`, `return { start, stop };`, with:

```js
	// refresh re-reads every model and re-renders. The sync engine calls it after
	// a round wrote remote rows straight to IndexedDB, where no model notify
	// fires (spec §4.5), and other tabs call it on "data-changed".
	return { start, stop, refresh: applyState };
```

- [ ] **Step 6: Rewrite `src/app.js`**

```js
// app.js: application wiring.
//
// Order matters (spec R2): open IndexedDB, wrap it in the syncing db (the one
// seam, spec D3), build the models on the wrapper, render from IndexedDB, and
// only then start sync. The first render never waits for the network.

import { createController } from "./controller.js";
import { createAreaModel } from "./model/areas.js";
import { openDB } from "./model/db.js";
import { createSectionModel } from "./model/sections.js";
import { createSettingsModel } from "./model/settings.js";
import { createTaskModel } from "./model/tasks.js";
import { createAccount } from "./sync/account";
import { createApi } from "./sync/api";
import { createSyncEngine } from "./sync/engine";
import { createReseed } from "./sync/reseed";
import { createSyncingDb } from "./sync/syncing-db";

// Shown while another tab still runs the previous version and holds the
// database open (spec §4.1). boot() overwrites #main once the upgrade runs.
function showBlocked(mainEl) {
	mainEl.innerHTML = `<p class="boot-notice" role="status">Close other Ignite tabs to finish updating</p>`;
}

// Shown when a newer version in another tab took the database over. This tab's
// connection is closed, so every write would fail silently until a reload.
function showUpdated(mainEl) {
	mainEl.innerHTML = `<p class="boot-notice" role="status">Ignite updated in another tab. Reload.</p>`;
}

async function boot() {
	const mainEl = document.getElementById("main");

	// The underlying db. Only the sync engine and the account flows write to it
	// directly, so rows from the server never re-enter the outbox (spec §4.5).
	const rawDb = await openDB(undefined, {
		onBlocked: () => showBlocked(mainEl),
		onVersionChange: () => showUpdated(mainEl),
	});

	// Assigned after the first render. A write before then has nothing to
	// schedule, and the engine's first round pushes it anyway.
	let engine = null;
	const db = createSyncingDb(rawDb, { onQueued: () => engine?.schedule() });

	const areas = await createAreaModel(db);
	const sections = await createSectionModel(db);
	const tasks = await createTaskModel(db);
	const settings = await createSettingsModel(db);

	const sidebarRoot = document.getElementById("sidebar");
	const topbarRoot = document.getElementById("topbar");
	const scrimEl = document.getElementById("scrim");

	mainEl.innerHTML = `
		<header class="page-header" id="page-header"></header>
		<section class="capture" id="capture-root"></section>
		<section id="main-root"></section>
	`;

	const toastRoot = document.createElement("div");
	toastRoot.id = "toast-root";
	document.body.appendChild(toastRoot);

	const repeatDialogRoot = document.createElement("div");
	repeatDialogRoot.id = "repeat-dialog-root";
	document.body.appendChild(repeatDialogRoot);

	const controller = createController({
		models: { areas, sections, tasks, settings },
		els: {
			sidebarRoot,
			topbarRoot,
			scrimEl,
			mainEl,
			pageHeaderRoot: document.getElementById("page-header"),
			captureRoot: document.getElementById("capture-root"),
			mainRoot: document.getElementById("main-root"),
			toastRoot,
			repeatDialogRoot,
		},
	});
	await controller.start();

	// Other open tabs share this IndexedDB but not this page's state. When data
	// changes underneath the models (a pull, a sign-out wipe), they re-read it.
	// A BroadcastChannel never delivers to the tab that posted.
	const channel = new BroadcastChannel("ignite");
	channel.addEventListener("message", (event) => {
		if (event.data === "data-changed") controller.refresh();
	});
	const dataChanged = () => {
		controller.refresh();
		channel.postMessage("data-changed");
	};

	const api = createApi();
	engine = createSyncEngine({
		db: rawDb,
		api,
		onApplied: dataChanged,
		// Task 16 connects the status to the account button and the dialog.
		onStatus: () => {},
	});
	const account = createAccount({
		db: rawDb,
		api,
		engine,
		reseed: createReseed(rawDb),
		// Task 16 replaces this with the dialog's question. Until then a device
		// with its own tasks answers "cancel": sign-in stops and nothing changes.
		chooseFirstSignIn: () => Promise.resolve("cancel"),
		onDataChanged: dataChanged,
	});
	engine.start();

	// Dev server only: a console handle for the plan's browser checks.
	// import.meta.env.DEV is false in every build, so this is dropped from dist.
	if (import.meta.env.DEV) window.__ignite = { account, engine, db: rawDb };
}

boot().catch((err) => {
	console.error("Ignite failed to boot:", err);
});
```

- [ ] **Step 7: Serve from the root and proxy `/api` in dev**

Replace `vite.config.js`:

```js
import { defineConfig } from "vite";

// The Worker that serves the API in development (`npx wrangler dev`).
const API_ORIGIN = "http://localhost:8787";

export default defineConfig({
	// One Cloudflare Worker serves the app at the root of its own origin
	// (spec §11). Unconditional, as "/ignite/" was: dev, preview and build must
	// agree, or `vite preview` serves HTML whose asset paths point elsewhere.
	base: "/",
	server: {
		port: 5173,
		open: false,
		// App and API share one origin in production. In dev the page is on
		// Vite's port, so /api goes through this proxy to wrangler dev. Origin is
		// rewritten to the Worker's own, which is what Better Auth's trusted
		// origin and the sync routes' same-origin check expect. Dev only: a
		// production request never passes through here. `vite preview` inherits
		// this proxy.
		proxy: {
			"/api": {
				target: API_ORIGIN,
				changeOrigin: true,
				configure(proxy) {
					proxy.on("proxyReq", (proxyReq) => {
						if (proxyReq.getHeader("origin")) {
							proxyReq.setHeader("origin", API_ORIGIN);
						}
					});
				},
			},
		},
	},
	build: {
		target: "es2022",
		outDir: "dist",
		sourcemap: true,
	},
});
```

In `src/main.js`, replace everything below `import "./app.js";` with:

```js

// Production builds only: `vite preview` and the Worker register the service
// worker; `vite dev` does not, so editing source never serves a stale module.
// Scope is the origin's root. It was /ignite/ on the shared github.io origin,
// where a root scope would have hijacked sibling projects. Ignite now owns its
// whole workers.dev origin.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		const base = import.meta.env.BASE_URL; // "/"
		navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
	});
}
```

In `scripts/gen-preview.mjs` line 58, the comment ends its example URL with `[22m/ignite/"`. Change that to `[22m/"`. The regex on line 61 already accepts any path, so no code changes.

`public/manifest.webmanifest` needs nothing: `start_url` and `scope` are `"./"`, relative to the manifest, so they follow the base.

- [ ] **Step 8: Keep `/api/` out of the service worker**

In `public/sw.js`, replace the `VERSION` and `SCOPE` lines (lines 3 and 4) with:

```js
const VERSION = "ignite-v3"; // bump to invalidate all caches (hygiene; online users self-heal)
const SCOPE = self.registration.scope; // e.g. https://ignite.<subdomain>.workers.dev/
// The sync and auth API. Never cached: a cached pull or session check would go
// stale forever (spec §9). Scope-relative, like every other URL in this file.
const API_PATH = new URL("./api/", SCOPE).pathname;
```

In the `fetch` handler, replace these two lines:

```js
	if (request.method !== "GET") return;
	if (new URL(request.url).origin !== self.location.origin) return;
```

with:

```js
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	// No respondWith: the browser goes straight to the network, as if this
	// worker did not exist. Must come before the navigation branch too.
	if (url.pathname.startsWith(API_PATH)) return;
```

`VERSION` moves to `ignite-v3` because the shell's URLs changed with the base. `activate` already deletes every cache that is not the current version.

- [ ] **Step 9: Style the blocked-upgrade notice**

In `main.css`, directly after the `#main { ... }` rule that ends with `gap: 1.5rem;` (before the `/* Tablet and up: side-by-side layout. */` block), add:

```css
/* Boot notice: shown in #main while another tab holds the database on an older
   version (app.js showBlocked), or after a newer tab took it over (app.js
   showUpdated). Replaced by the app once the upgrade runs or the page reloads. */
.boot-notice {
	margin-block: var(--space-6);
	text-align: center;
	color: var(--text);
}
```

- [ ] **Step 10: Run the checks and the build**

Run: `npm run check && npm run test:run && npm run build`
Expected: PASS. Biome and `tsc --noEmit` clean, every test green, the bundle gate passes.

Run: `grep -c "/ignite/" dist/index.html dist/sw.js; grep -l "__ignite" dist/assets/*.js`
Expected: `dist/index.html:0` and `dist/sw.js:0`, and the second grep prints nothing (the dev handle is not in the build).

- [ ] **Step 11: Create the test credentials (local only)**

```bash
mkdir -p .superpowers/e2e
node -e "const c=require('node:crypto');for(const n of ['one','two'])console.log('e2e-'+n+'@ignite.test '+c.randomBytes(18).toString('base64url'))" > .superpowers/e2e/credentials.local
git check-ignore -v .superpowers/e2e/credentials.local
```

Expected: `check-ignore` prints a `.gitignore` line ending in `.superpowers/`. Each line of the file is an email and a 24-character password. Never paste these values into chat, a commit or a PR.

- [ ] **Step 12: Start the servers for the browser checks**

Run each in the background:

```bash
npx wrangler dev --var ALLOWED_EMAILS:e2e-one@ignite.test,e2e-two@ignite.test
npx vite --port 5174 --strictPort
```

Expected: wrangler reports `Ready on http://localhost:8787`, Vite reports `http://localhost:5174/`. Open the Browser pane with `preview_start` and url `http://localhost:5174/`.

In the page console (`javascript_tool`): `await fetch("/api/auth/get-session").then((r) => r.status)`
Expected: `200` (the proxy reaches the Worker).

- [ ] **Step 13: Browser check: sign in through the handle, first render before sync**

Read e2e-one's email and password from `.superpowers/e2e/credentials.local`, then run in the page:

```js
await __ignite.account.signIn("<e2e-one email>", "<e2e-one password>", false, { signUp: true });
```

Expected: `{ ok: true, email: "e2e-one@ignite.test" }`. This origin was seed-only, so no first-sign-in question is asked.

Capture a task titled `Sync check` through the capture bar (set `.capture__input`'s value, then `document.querySelector(".capture__form").requestSubmit()`). Wait 3 seconds, then run `(await __ignite.db.getAll("outbox")).length`.
Expected: `0` (the debounced round pushed it).

Reload the page. Then run:

```js
const fcp = performance.getEntriesByName("first-contentful-paint")[0].startTime;
const api = performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/"));
({ fcp, firstApi: Math.min(...api.map((e) => e.startTime)), apiCalls: api.length });
```

Expected: `apiCalls` at least 1 and `firstApi` greater than `fcp`. The startup round began after the first paint (R2).

- [ ] **Step 14: Browser check: sign-out in one tab reaches the other**

Open a second tab on `http://localhost:5174/` (tab B) and select the Focus tab in both. In tab B run `document.getElementById("main-root").textContent.includes("Sync check")`.
Expected: `true`.

In tab A run `await __ignite.account.signOut({ force: true })`.
Expected: `{ ok: true }`.

Within one second, in tab B, without reloading, run the same `includes("Sync check")` line.
Expected: `false`. Tab B re-rendered on the `"data-changed"` message that `onDataChanged` posted after the wipe. Also in tab B: `(await __ignite.account.meta()).mode` returns `"local"`.

- [ ] **Step 15: Browser check: the blocked upgrade shows its message and then boots**

Close tab B. In tab A, navigate to `http://localhost:5174/icon.svg` (same origin, no app code). In its console:

```js
indexedDB.deleteDatabase("ignite");
const req = indexedDB.open("ignite", 1);
req.onupgradeneeded = () => {
	const d = req.result;
	d.createObjectStore("areas", { keyPath: "id" });
	d.createObjectStore("sections", { keyPath: "id" });
	const t = d.createObjectStore("tasks", { keyPath: "id" });
	t.createIndex("sectionId", "sectionId");
	t.createIndex("dueAt", "dueAt");
	t.createIndex("completed", "completed");
	t.createIndex("starred", "starred");
	d.createObjectStore("settings", { keyPath: "id" });
};
req.onsuccess = () => {
	window.oldTab = req.result; // a version 1 connection with no versionchange handler
};
```

Open a new tab on `http://localhost:5174/` (tab C). Run `document.getElementById("main").textContent.trim()` there.
Expected: `Close other Ignite tabs to finish updating`.

In the `icon.svg` tab run `oldTab.close()`. In tab C, within one second, run `!!document.querySelector(".page-header__title")`.
Expected: `true`. The upgrade went through and the app booted without a reload.

- [ ] **Step 16: Browser check: the service worker never touches `/api/`**

Stop the 5174 Vite server. Build and start a preview on its own origin: `npm run build && npx vite preview --port 4174 --strictPort` (background). Open `http://localhost:4174/`, wait for `navigator.serviceWorker.controller` to be non-null (reload once if it is `null`), then run:

```js
await fetch("/api/auth/get-session");
await fetch("/api/auth/get-session");
const cache = await caches.open("ignite-v3");
(await cache.keys()).map((r) => new URL(r.url).pathname).filter((p) => p.startsWith("/api/"));
```

Expected: `[]`. Also `(await caches.keys())` returns `["ignite-v3"]` only.

- [ ] **Step 17: Measure R2: a local write before and after the wrapper**

Restart `npx vite --port 5174 --strictPort` and open `http://localhost:5174/`. In the console:

```js
const { openDB } = await import("/src/model/db.js");
const { createSyncingDb } = await import("/src/sync/syncing-db.ts");
const name = "ignite-r2-bench";
const raw = await openDB(name);
const wrapped = createSyncingDb(raw);
const task = (i) => ({
	id: `bench-${i}`,
	sectionId: "focus-default",
	title: `Task ${i}`,
	notes: "",
	completed: 0,
	starred: 0,
	critical: 0,
	dueAt: null,
	order: i,
	createdAt: "2026-10-01T10:00:00.000Z",
});
const meta = (mode) => ({ id: "sync", mode, cursor: 0, userEmail: null, lastSyncedAt: null });
async function time(label, put) {
	const runs = [];
	for (let r = 0; r < 5; r++) {
		const t0 = performance.now();
		for (let i = 0; i < 100; i++) await put(task(i));
		runs.push((performance.now() - t0) / 100);
	}
	runs.sort((a, b) => a - b);
	return { label, medianMsPerWrite: Number(runs[2].toFixed(3)) };
}
const results = [await time("before: db.put", (t) => raw.put("tasks", t))];
await raw.put("meta", meta("local"));
results.push(await time("after, local mode", (t) => wrapped.put("tasks", t)));
await raw.put("meta", meta("account"));
results.push(await time("after, account mode", (t) => wrapped.put("tasks", t)));
raw.close();
await new Promise((done) => {
	const del = indexedDB.deleteDatabase(name);
	del.onsuccess = del.onerror = del.onblocked = done;
});
results;
```

Expected: three rows. Write all three numbers, the browser and the date (`date +"%Y-%m-%d %A"`) into `.superpowers/r2-measurements.md`. Task 19 copies them into the spec's verification record.

**Stop rule (R2):** if "after, account mode" is more than 2 ms per write slower than "before", stop and report the numbers to Malin before committing. Two milliseconds is where the write starts to eat into the 16 ms frame the re-render also needs.

- [ ] **Step 18: Stop the servers and commit**

Stop wrangler dev, Vite and the preview server.

```bash
git add src/controller.js src/app.js src/sync/reseed.ts tests/sync/reseed.test.ts main.css
git commit -m "feat(sync): wire the syncing db, sync engine and account into the app"
git add vite.config.js src/main.js public/sw.js scripts/gen-preview.mjs
git commit -m "build: serve from the root, proxy /api in dev, keep /api out of the service worker"
```

---

### Task 16: Account button, dialog and announcer

The only new UI in this project: one button, one dialog, one live region. Spec §7, §8 (sign-in copy, "a sync failure never shows a toast").

**Deviation from the spec, flagged for Malin:** §7 puts the button "in the top bar, next to the theme control". The theme control is in the sidebar footer, and the top bar is hidden at ≥768px. The button goes in `.sidebar__footer` beside `.sidebar__theme`, sharing its 44px height and bottom edge. On a phone it is reached through the drawer, like the theme control.

**Design decision, shown to Malin before the commit (Step 17):** the button is a 44px square with a person icon and no visible text. "Account" and "Theme: system" do not both fit one row of the 240px sidebar. The accessible name is on the button (`aria-label`) and carries the sync state.

**Files:**
- Create: `src/sync/account-ui.ts`, `src/sync/announce.ts`, `src/sync/account-dialog.ts`
- Test: `tests/sync/account-ui.test.ts`, `tests/sync/announce.test.ts`
- Modify: `src/views/sidebar.js` (header comment, callbacks, closure state, click action, return object, `template()`)
- Modify: `src/controller.js` (signature, sidebar callback, `onHashChange`, returned object)
- Modify: `src/app.js` (whole file)
- Modify: `index.html` (the announcer)
- Modify: `main.css` (sidebar footer, account button, rail, account dialog)

**Interfaces:**
- Consumes: `Account`, `FirstSignInChoice` (Task 14), `SyncStatus`, `statusText`, `needsAttention` (Task 4), `SyncMeta`, `LOCAL_META` (Task 5), `SyncEngine.status()` (Task 13).
- Produces:
  - `src/sync/account-ui.ts`:
    - `accountButtonState(status: SyncStatus): { label: string; attention: boolean }`
    - `type AccountView = "sign-in" | "reauth" | "signed-in"` and `accountView(meta: SyncMeta, status: SyncStatus): AccountView`
    - `type Field = "email" | "password" | "form"`
    - `validateSignIn(input: { email: string; password: string; signUp: boolean }): { field: "email" | "password"; message: string } | null`
    - `errorField(message: string): Field`
    - `unsyncedText(pending: number): string`
  - `src/sync/announce.ts`: `announce(message: string): void` and `trackAttention(last: SyncStatus | null, next: SyncStatus): { announce: boolean; last: SyncStatus | null }`
  - `src/sync/account-dialog.ts`: `interface AccountDialog { open(): void; close(): void; setStatus(status: SyncStatus): void; chooseFirstSignIn(): Promise<FirstSignInChoice> }` and `createAccountDialog(deps: { root: HTMLElement; account: Account; getStatus: () => SyncStatus; returnFocus: () => HTMLElement | null }): AccountDialog`
  - Sidebar: callback `onOpenAccount()`, method `setAccountStatus({ label, attention }): void`, button `.sidebar__account[data-action="open-account"]`.
  - Controller: `createController({ models, els, account })` with optional `account: { open(): void }`, and the returned object gains `setAccountStatus(state: { label: string; attention: boolean }): void`.
  - `index.html`: `<div id="sync-announcer" class="sr-only" role="status"></div>`.

**How the dialog behaves (fixed here, checked in the browser in Steps 12 to 16):**
- Signed out: a real `<form>`. Email (`autocomplete="email"`), password (`autocomplete="current-password"`, or `"new-password"` when "Create an account" is ticked), "Stay signed in on this device" unticked with "For 60 days. Sign out to end it." beside it. A field error sits under its field and is tied to it with `aria-describedby`; focus moves to that field. An error that belongs to no field (offline, rate limit) shows at the top of the form and is announced.
- Signed in: the email, the status line from `statusText`, Sign out, Close. A Reload button appears only on "Ignite has updated. Reload to keep syncing."
- Session expired (`needs-sign-in`): the form again, email filled in, focus on the password, plus a Sign out button.
- Sign out with unsynced changes: "3 changes haven't synced. Sign out anyway?" Focus starts on "Stay signed in".
- First sign-in with data on both sides: "Add this device's tasks to your account" (initial focus), "Replace them with your account (deletes this device's tasks)", "Cancel sign-in". Escape or a backdrop click on this step answers "cancel".
- Announced: "Signed in", "Signed out", a form error that belongs to no field, and a sync status that newly needs attention. A background round that went fine is silent.
- Inert: the dialog sets `inert` on every other child of `<body>` that is not inert yet (except its own root and the announcer), records only those, and clears only those on close. On a phone it opens over the open drawer, which has already made `#topbar`, `#main` and `#toast-root` inert; those stay the drawer's, so the drawer stays modal and focus returns to the account button inside it. If the drawer closes while the dialog is open (a route change, a rotation past 768 px), nothing re-inerts `#main` on close. A route change closes the dialog too, and focus then goes to `.topbar__menu`.
- Escape is caught on `window` in the capture phase and stopped. The sidebar's document-level Escape handler would otherwise close the drawer under the dialog in the same keypress.

- [ ] **Step 1: Write the failing tests**

`tests/sync/account-ui.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	accountButtonState,
	accountView,
	errorField,
	unsyncedText,
	validateSignIn,
} from "../../src/sync/account-ui";
import type { SyncStatus } from "../../src/sync/status";
import { LOCAL_META, type SyncMeta } from "../../src/sync/types";

const signedIn: SyncMeta = { ...LOCAL_META, mode: "account", userEmail: "a@ignite.test" };

describe("accountButtonState", () => {
	it("is plain Account when nothing needs doing", () => {
		const calm: SyncStatus[] = [
			{ kind: "local" },
			{ kind: "syncing" },
			{ kind: "synced", at: "2026-10-01T10:00:00.000Z" },
			{ kind: "offline", pending: 3 },
		];
		for (const status of calm) {
			expect(accountButtonState(status)).toEqual({ label: "Account", attention: false });
		}
	});

	it("carries the attention state in the name", () => {
		const loud: SyncStatus[] = [
			{ kind: "needs-sign-in" },
			{ kind: "needs-reload" },
			{ kind: "invalid", count: 1 },
		];
		for (const status of loud) {
			expect(accountButtonState(status)).toEqual({
				label: "Account, sync needs attention",
				attention: true,
			});
		}
	});
});

describe("accountView", () => {
	it("shows the sign-in form in local mode", () => {
		expect(accountView(LOCAL_META, { kind: "local" })).toBe("sign-in");
	});
	it("asks to sign in again when the session ended", () => {
		expect(accountView(signedIn, { kind: "needs-sign-in" })).toBe("reauth");
	});
	it("shows the account otherwise, offline included", () => {
		expect(accountView(signedIn, { kind: "offline", pending: 2 })).toBe("signed-in");
		expect(accountView(signedIn, { kind: "needs-reload" })).toBe("signed-in");
	});
});

describe("validateSignIn", () => {
	it("needs an email", () => {
		expect(validateSignIn({ email: "", password: "x", signUp: false })).toEqual({
			field: "email",
			message: "Enter your email.",
		});
	});
	it("needs something that looks like an email", () => {
		expect(validateSignIn({ email: "malin", password: "x", signUp: false })?.field).toBe(
			"email",
		);
	});
	it("needs a password", () => {
		expect(validateSignIn({ email: "a@ignite.test", password: "", signUp: false })).toEqual({
			field: "password",
			message: "Enter your password.",
		});
	});
	it("holds a new password to 15 characters, with the spec's copy", () => {
		expect(
			validateSignIn({ email: "a@ignite.test", password: "short", signUp: true }),
		).toEqual({ field: "password", message: "Password must be at least 15 characters." });
	});
	it("does not hold a sign-in to the length rule, so an old password still gets a real answer", () => {
		expect(validateSignIn({ email: "a@ignite.test", password: "short", signUp: false })).toBe(
			null,
		);
	});
});

describe("errorField", () => {
	it("ties credential and length errors to the password field", () => {
		expect(errorField("Email or password is wrong")).toBe("password");
		expect(errorField("Password must be at least 15 characters.")).toBe("password");
	});
	it("keeps the rest at form level", () => {
		expect(errorField("Too many attempts. Try again in a minute.")).toBe("form");
		expect(errorField("Can't reach Ignite's server. Check your connection.")).toBe("form");
	});
});

describe("unsyncedText", () => {
	it("uses the spec's copy, singular and plural", () => {
		expect(unsyncedText(1)).toBe("1 change hasn't synced. Sign out anyway?");
		expect(unsyncedText(3)).toBe("3 changes haven't synced. Sign out anyway?");
	});
});
```

`tests/sync/announce.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announce, trackAttention } from "../../src/sync/announce";
import type { SyncStatus } from "../../src/sync/status";

const at = "2026-10-01T10:00:00.000Z";

// Runs a sequence of statuses and returns which ones were announced.
function run(statuses: SyncStatus[]): boolean[] {
	let last: SyncStatus | null = null;
	return statuses.map((status) => {
		const result = trackAttention(last, status);
		last = result.last;
		return result.announce;
	});
}

describe("trackAttention", () => {
	it("announces a status that needs attention the first time", () => {
		expect(run([{ kind: "needs-sign-in" }])).toEqual([true]);
	});

	it("does not repeat it on every round while it holds", () => {
		expect(
			run([
				{ kind: "needs-sign-in" },
				{ kind: "syncing" },
				{ kind: "needs-sign-in" },
				{ kind: "offline", pending: 1 },
				{ kind: "needs-sign-in" },
			]),
		).toEqual([true, false, false, false, false]);
	});

	it("announces it again once it was resolved and came back", () => {
		expect(
			run([{ kind: "needs-sign-in" }, { kind: "synced", at }, { kind: "needs-sign-in" }]),
		).toEqual([true, false, true]);
	});

	it("announces a new count of changes that couldn't sync", () => {
		expect(
			run([
				{ kind: "invalid", count: 1 },
				{ kind: "invalid", count: 1 },
				{ kind: "invalid", count: 2 },
			]),
		).toEqual([true, false, true]);
	});

	it("stays silent for background success and ordinary states", () => {
		expect(
			run([
				{ kind: "local" },
				{ kind: "syncing" },
				{ kind: "synced", at },
				{ kind: "offline", pending: 3 },
			]),
		).toEqual([false, false, false, false]);
	});
});

describe("announce", () => {
	// The test environment has no DOM, so the announcer is a stand-in object.
	const el = { textContent: "" };

	beforeEach(() => {
		vi.useFakeTimers();
		el.textContent = "";
		vi.stubGlobal("document", { getElementById: () => el });
	});
	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("writes a message after a short pause", () => {
		announce("Signed in");
		expect(el.textContent).toBe("");
		vi.advanceTimersByTime(100);
		expect(el.textContent).toBe("Signed in");
	});

	it("keeps a message that was still waiting when the next one came", () => {
		announce("1 change couldn't sync.");
		vi.advanceTimersByTime(50);
		announce("Signed in");
		vi.advanceTimersByTime(100);
		expect(el.textContent).toBe("1 change couldn't sync. Signed in.");
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/sync/account-ui.test.ts tests/sync/announce.test.ts`
Expected: FAIL, "Cannot find module '../../src/sync/account-ui'" and the same for announce.

- [ ] **Step 3: Implement `src/sync/account-ui.ts`**

```ts
// The account UI's decisions, kept out of the DOM code so they can be tested.

import { needsAttention, type SyncStatus } from "./status";
import type { SyncMeta } from "./types";

export type AccountView = "sign-in" | "reauth" | "signed-in";
export type Field = "email" | "password" | "form";

// Spec §7: the name carries the state, because the visible marker alone is
// not seen by a screen reader.
export function accountButtonState(status: SyncStatus): {
	label: string;
	attention: boolean;
} {
	const attention = needsAttention(status);
	return { label: attention ? "Account, sync needs attention" : "Account", attention };
}

export function accountView(meta: SyncMeta, status: SyncStatus): AccountView {
	if (meta.mode !== "account") return "sign-in";
	return status.kind === "needs-sign-in" ? "reauth" : "signed-in";
}

// Client-side checks only catch what the server would refuse anyway. The
// 15-character rule applies to sign-up only: a sign-in always gets the
// server's answer.
export function validateSignIn(input: {
	email: string;
	password: string;
	signUp: boolean;
}): { field: "email" | "password"; message: string } | null {
	if (!input.email) return { field: "email", message: "Enter your email." };
	if (!/^[^\s@]+@[^\s@]+$/.test(input.email)) {
		return { field: "email", message: "Enter an email like name@example.com." };
	}
	if (!input.password) return { field: "password", message: "Enter your password." };
	if (input.signUp && input.password.length < 15) {
		return { field: "password", message: "Password must be at least 15 characters." };
	}
	return null;
}

// Matches the sign-in copy from spec §8 (produced by Task 14's account flows).
// "Email or password is wrong" goes on the password field: that is the field
// the user retypes, and the message never says which one was wrong.
export function errorField(message: string): Field {
	if (
		message === "Email or password is wrong" ||
		message === "Password must be at least 15 characters."
	) {
		return "password";
	}
	return "form";
}

export function unsyncedText(pending: number): string {
	return pending === 1
		? "1 change hasn't synced. Sign out anyway?"
		: `${pending} changes haven't synced. Sign out anyway?`;
}
```

- [ ] **Step 4: Implement `src/sync/announce.ts`**

```ts
// The one live region for sync (spec §7). #sync-announcer is in index.html from
// page load, outside every container that re-renders, so screen readers have
// registered it before the first message arrives.

import { needsAttention, type SyncStatus } from "./status";

let pending: ReturnType<typeof setTimeout> | undefined;
let waiting = "";

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

// Clearing first and writing after a short pause makes a repeated message
// ("Signed in" twice in one session) announce again instead of being ignored
// as unchanged text. A message still waiting for its pause is never dropped:
// a status line and "Signed in" can arrive within 100 ms, and trackAttention
// has already marked the first as said. Both are read, the waiting one first.
export function announce(message: string): void {
	const el = document.getElementById("sync-announcer");
	if (!el) return;
	clearTimeout(pending);
	waiting = waiting ? `${sentence(waiting)} ${sentence(message)}` : message;
	el.textContent = "";
	pending = setTimeout(() => {
		el.textContent = waiting;
		waiting = "";
	}, 100);
}

// Which status changes are news. Only a status that needs attention is
// announced, once, and not again on every round that ends the same way.
// "syncing" and "offline" sit between two rounds and change nothing; "synced"
// and "local" mean the problem is gone, so its next appearance is news again.
export function trackAttention(
	last: SyncStatus | null,
	next: SyncStatus,
): { announce: boolean; last: SyncStatus | null } {
	if (needsAttention(next)) {
		const isNew =
			!last ||
			last.kind !== next.kind ||
			(last.kind === "invalid" && next.kind === "invalid" && last.count !== next.count);
		return { announce: isNew, last: next };
	}
	if (next.kind === "synced" || next.kind === "local") return { announce: false, last: null };
	return { announce: false, last };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/sync/account-ui.test.ts tests/sync/announce.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 6: Implement `src/sync/account-dialog.ts`**

```ts
// createAccountDialog({ root, account, getStatus, returnFocus })
//   → { open(), close(), setStatus(status), chooseFirstSignIn() }
//
// The account dialog (spec §7). It follows recurrence-dialog.js: role="dialog",
// aria-modal, a labelled heading, Escape closes, focus returns to the opener.
// It reuses that dialog's .repeat-* classes, so Ignite has one dialog look.
//
// Two things differ, on purpose:
// - The dialog sets and clears the background `inert` itself, and only on the
//   elements it made inert. On a phone it opens over the open drawer, which
//   has already made #topbar, #main and #toast-root inert; those stay the
//   drawer's. The drawer can close while the dialog is open (a route change,
//   a rotation past 768 px), so restoring a snapshot on close would re-inert
//   #main with no drawer open, and the app would be dead until a reload.
// - Escape is caught on window in the capture phase and stopped there. The
//   sidebar listens for Escape on document to close the drawer, and one
//   keypress would otherwise close the dialog and the drawer under it.
//
// User data (the email, the status line) is written with textContent or
// .value after the markup is in place, never interpolated into it.

import type {
	Account,
	FirstSignInChoice,
	SignInResult,
	SignOutResult,
} from "./account";
import {
	accountView,
	errorField,
	type Field,
	unsyncedText,
	validateSignIn,
} from "./account-ui";
import { announce } from "./announce";
import { type SyncStatus, statusText } from "./status";

type Step = "form" | "signed-in" | "confirm" | "choice";

// For a failure that is not a server answer: a bug, or IndexedDB refusing a
// write. The dialog must never stay busy without saying anything.
const GENERIC_ERROR = "Something went wrong. Try again.";

export interface AccountDialog {
	open(): void;
	close(): void;
	setStatus(status: SyncStatus): void;
	chooseFirstSignIn(): Promise<FirstSignInChoice>;
}

export function createAccountDialog({
	root,
	account,
	getStatus,
	returnFocus,
}: {
	root: HTMLElement;
	account: Account;
	getStatus: () => SyncStatus;
	returnFocus: () => HTMLElement | null;
}): AccountDialog {
	let isOpen = false;
	let attached = false;
	let step: Step = "form";
	let reauth = false;
	let signUp = false;
	// "Stay signed in" survives a failed sign-in and the first-sign-in question,
	// so I never have to tick it twice (WCAG 3.3.7).
	let remember = false;
	let busy = false;
	let email = "";
	let pending = 0;
	let choose: ((choice: FirstSignInChoice) => void) | null = null;
	let madeInert: HTMLElement[] = [];
	let tick: ReturnType<typeof setInterval> | undefined;

	const q = <T extends HTMLElement = HTMLElement>(selector: string) =>
		root.querySelector<T>(selector);

	// ---- open and close ----

	function open(): void {
		if (isOpen) return;
		isOpen = true;
		void account.meta().then((meta) => {
			if (!isOpen) return; // closed while meta was being read
			const view = accountView(meta, getStatus());
			reauth = view === "reauth";
			step = view === "signed-in" ? "signed-in" : "form";
			email = meta.userEmail ?? "";
			signUp = false;
			remember = false;
			attach();
			render();
		});
	}

	function attach(): void {
		if (attached) return;
		attached = true;
		madeInert = [];
		for (const el of Array.from(document.body.children)) {
			if (!(el instanceof HTMLElement)) continue;
			if (el === root || el.id === "sync-announcer" || el.tagName === "SCRIPT") continue;
			// Already inert: the open drawer owns it, and closeDrawer() clears it.
			if (el.inert) continue;
			el.inert = true;
			madeInert.push(el);
		}
		document.body.classList.add("is-account-open");
		window.addEventListener("keydown", onKeydown, true);
		root.addEventListener("click", onClick);
		root.addEventListener("submit", onSubmit);
		root.addEventListener("change", onChange);
		// "Synced 2 min ago" has to age while the dialog is open.
		tick = setInterval(() => setStatus(getStatus()), 30_000);
	}

	function close(): void {
		if (!isOpen) return;
		isOpen = false;
		// A pending first-sign-in question needs an answer, or the sign-in waits
		// forever. Closing is not a choice to add or replace anything.
		resolveChoice("cancel");
		if (!attached) return;
		attached = false;
		clearInterval(tick);
		window.removeEventListener("keydown", onKeydown, true);
		root.removeEventListener("click", onClick);
		root.removeEventListener("submit", onSubmit);
		root.removeEventListener("change", onChange);
		root.innerHTML = "";
		document.body.classList.remove("is-account-open");
		// Clear BEFORE focusing: nothing inside an inert subtree takes focus.
		// Only what this dialog set: the drawer's inert is the drawer's to clear.
		for (const el of madeInert) el.inert = false;
		madeInert = [];
		returnFocus()?.focus();
	}

	// Escape and a backdrop click both mean "not now". On the first-sign-in
	// question that is an answer, "cancel", and the dialog goes back to the form.
	function dismiss(): void {
		if (step === "choice") resolveChoice("cancel");
		else close();
	}

	// ---- rendering ----

	function render(): void {
		root.innerHTML = `
			<div class="repeat-backdrop" data-action="account-backdrop">
				<div class="repeat-panel" role="dialog" aria-modal="true" aria-labelledby="account-heading">
					${body()}
				</div>
			</div>`;
		fill();
		initialFocus()?.focus();
	}

	function body(): string {
		if (step === "signed-in") return signedInBody();
		if (step === "confirm") return confirmBody();
		if (step === "choice") return choiceBody();
		return formBody();
	}

	function formBody(): string {
		const lead = reauth
			? `<p class="account-lead">Your session ended. Your changes stay on this device and sync once you sign in.</p>`
			: "";
		const toggle = reauth
			? ""
			: `<label class="account-check">
					<input type="checkbox" id="account-signup" />
					<span>Create an account</span>
				</label>`;
		const signOut = reauth
			? `<button type="button" class="repeat-btn account-btn--danger account-btn--start" data-action="account-sign-out">Sign out</button>`
			: "";
		return `
			<h2 class="repeat-panel__heading" id="account-heading">Sign in</h2>
			${lead}
			<form class="account-form" novalidate>
				<p class="account-error" id="account-form-error"></p>
				${toggle}
				<div class="repeat-field">
					<label for="account-email">Email</label>
					<input class="repeat-input" id="account-email" name="email" type="email"
						autocomplete="email" autocapitalize="off" spellcheck="false" required />
					<p class="account-error" id="account-email-error"></p>
				</div>
				<div class="repeat-field">
					<label for="account-password">Password</label>
					<input class="repeat-input" id="account-password" name="password" type="password"
						autocomplete="current-password" required />
					<p class="account-hint" id="account-password-hint" hidden>At least 15 characters.</p>
					<p class="account-error" id="account-password-error"></p>
				</div>
				<div class="account-check-group">
					<label class="account-check">
						<input type="checkbox" id="account-remember" name="remember"
							aria-describedby="account-remember-hint" />
						<span>Stay signed in on this device</span>
					</label>
					<p class="account-hint" id="account-remember-hint">For 60 days. Sign out to end it.</p>
				</div>
				<footer class="repeat-footer">
					${signOut}
					<button type="button" class="repeat-btn" data-action="account-close">Cancel</button>
					<button type="submit" class="repeat-btn repeat-btn--primary" data-role="submit">Sign in</button>
				</footer>
			</form>`;
	}

	function signedInBody(): string {
		return `
			<h2 class="repeat-panel__heading" id="account-heading">Account</h2>
			<dl class="account-summary">
				<div>
					<dt>Signed in as</dt>
					<dd data-role="email"></dd>
				</div>
				<div>
					<dt>Sync</dt>
					<dd data-role="status"></dd>
				</div>
			</dl>
			<p class="account-error" id="account-form-error"></p>
			<footer class="repeat-footer">
				<button type="button" class="repeat-btn account-btn--danger account-btn--start" data-action="account-sign-out">Sign out</button>
				<button type="button" class="repeat-btn repeat-btn--primary" data-action="account-reload" data-role="reload" hidden>Reload</button>
				<button type="button" class="repeat-btn" data-action="account-close">Close</button>
			</footer>`;
	}

	function confirmBody(): string {
		return `
			<h2 class="repeat-panel__heading" id="account-heading">Sign out?</h2>
			<p class="account-lead" data-role="unsynced"></p>
			<p class="account-lead">Signing out removes them from this device.</p>
			<p class="account-error" id="account-form-error"></p>
			<footer class="repeat-footer">
				<button type="button" class="repeat-btn account-btn--danger account-btn--start" data-action="account-sign-out-force">Sign out anyway</button>
				<button type="button" class="repeat-btn repeat-btn--primary" data-action="account-stay">Stay signed in</button>
			</footer>`;
	}

	function choiceBody(): string {
		return `
			<h2 class="repeat-panel__heading" id="account-heading">This device has its own tasks</h2>
			<p class="account-lead">Your account has tasks too. Choose what happens to the ones on this device.</p>
			<div class="account-choices">
				<button type="button" class="repeat-btn repeat-btn--primary" data-choice="add">Add this device's tasks to your account</button>
				<button type="button" class="repeat-btn account-btn--danger" data-choice="replace">Replace them with your account (deletes this device's tasks)</button>
				<button type="button" class="repeat-btn" data-choice="cancel">Cancel sign-in</button>
			</div>`;
	}

	function fill(): void {
		if (step === "signed-in") {
			const emailEl = q("[data-role='email']");
			if (emailEl) emailEl.textContent = email;
			setStatus(getStatus());
		} else if (step === "confirm") {
			const lead = q("[data-role='unsynced']");
			if (lead) lead.textContent = unsyncedText(pending);
		} else if (step === "form") {
			const input = q<HTMLInputElement>("#account-email");
			if (input) input.value = email;
			const rememberEl = q<HTMLInputElement>("#account-remember");
			if (rememberEl) rememberEl.checked = remember;
			syncMode();
		}
	}

	function initialFocus(): HTMLElement | null {
		if (step === "choice") return q("[data-choice='add']");
		if (step === "confirm") return q("[data-action='account-stay']");
		if (step === "signed-in") return q("[data-action='account-close']");
		return reauth ? q("#account-password") : q("#account-email");
	}

	// Sign in and sign up share one form. The toggle changes the heading, the
	// submit label, the password's autocomplete (so a password manager offers
	// to generate one) and whether the length hint shows.
	function syncMode(): void {
		const heading = q("#account-heading");
		if (heading) {
			heading.textContent = reauth ? "Sign in again" : signUp ? "Create an account" : "Sign in";
		}
		const toggle = q<HTMLInputElement>("#account-signup");
		if (toggle) toggle.checked = signUp;
		q("#account-password")?.setAttribute(
			"autocomplete",
			signUp ? "new-password" : "current-password",
		);
		const hint = q("#account-password-hint");
		if (hint) hint.hidden = !signUp;
		const submit = q("[data-role='submit']");
		if (submit && !busy) submit.textContent = signUp ? "Create account" : "Sign in";
		describe();
	}

	// aria-describedby names only what is on screen: the length hint while it
	// shows, and the field's error while it has one.
	function describe(): void {
		for (const field of ["email", "password"] as const) {
			const input = q<HTMLInputElement>(`#account-${field}`);
			if (!input) continue;
			const ids: string[] = [];
			if (field === "password" && signUp) ids.push("account-password-hint");
			const error = q(`#account-${field}-error`);
			const hasError = !!error?.textContent;
			if (hasError && error) ids.push(error.id);
			if (ids.length) input.setAttribute("aria-describedby", ids.join(" "));
			else input.removeAttribute("aria-describedby");
			if (hasError) input.setAttribute("aria-invalid", "true");
			else input.removeAttribute("aria-invalid");
		}
	}

	function clearErrors(): void {
		for (const field of ["email", "password", "form"] as const) {
			const el = q(`#account-${field}-error`);
			if (el) el.textContent = "";
		}
		describe();
	}

	function showError(field: Field, message: string): void {
		const el = q(`#account-${field}-error`);
		if (el) el.textContent = message;
		describe();
		if (field === "form") {
			// Tied to no field, so nothing reads it on focus. Say it once.
			announce(message);
			return;
		}
		const input = q<HTMLInputElement>(`#account-${field}`);
		input?.focus();
		input?.select();
	}

	// aria-disabled, not disabled: disabling the focused button would drop
	// focus to <body>.
	function setBusy(on: boolean): void {
		busy = on;
		const submit = q("[data-role='submit']");
		if (!submit) return;
		if (on) submit.setAttribute("aria-disabled", "true");
		else submit.removeAttribute("aria-disabled");
		submit.textContent = on ? "Signing in…" : signUp ? "Create account" : "Sign in";
	}

	// The same treatment for both sign-out buttons, so a slow sign-out never
	// looks dead and a second click does nothing.
	function setSignOutBusy(on: boolean): void {
		busy = on;
		const buttons = root.querySelectorAll<HTMLElement>(
			"[data-action^='account-sign-out']",
		);
		for (const button of buttons) {
			if (on) button.setAttribute("aria-disabled", "true");
			else button.removeAttribute("aria-disabled");
			const idle =
				button.dataset.action === "account-sign-out-force"
					? "Sign out anyway"
					: "Sign out";
			button.textContent = on ? "Signing out…" : idle;
		}
	}

	// ---- actions ----

	async function submit(form: HTMLFormElement): Promise<void> {
		if (busy) return;
		const data = new FormData(form);
		email = String(data.get("email") ?? "").trim();
		const password = String(data.get("password") ?? "");
		remember = data.get("remember") === "on";
		clearErrors();
		const problem = validateSignIn({ email, password, signUp });
		if (problem) {
			showError(problem.field, problem.message);
			return;
		}
		setBusy(true);
		let result: SignInResult;
		try {
			result = await account.signIn(email, password, remember, { signUp });
		} catch {
			result = { ok: false, message: GENERIC_ERROR };
		} finally {
			setBusy(false);
		}
		if (result.ok) {
			close();
			announce("Signed in");
			return;
		}
		if (!isOpen) {
			announce(result.message);
			return;
		}
		// Already on the form: only the error changes. A re-render would untick
		// "Stay signed in" and empty the fields I just filled in.
		if (step !== "form") {
			step = "form";
			render();
		}
		showError(errorField(result.message), result.message);
	}

	async function signOut(force: boolean): Promise<void> {
		if (busy) return;
		setSignOutBusy(true);
		let result: SignOutResult | null = null;
		try {
			result = await account.signOut({ force });
		} catch {
			// result stays null, and the generic error is shown below.
		} finally {
			setSignOutBusy(false);
		}
		if (!result) {
			if (isOpen) showError("form", GENERIC_ERROR);
			else announce(GENERIC_ERROR);
			return;
		}
		if (result.ok) {
			close();
			announce("Signed out");
			return;
		}
		if (!isOpen) return;
		pending = result.pending;
		step = "confirm";
		render();
	}

	function resolveChoice(choice: FirstSignInChoice): void {
		const resolve = choose;
		if (!resolve) return;
		choose = null;
		if (isOpen) {
			// Back to the form, busy, while the account flow adds, replaces or
			// cancels. The sign-in's own result closes the dialog or shows an error.
			step = "form";
			render();
			setBusy(true);
		}
		resolve(choice);
	}

	// ---- events ----

	function onClick(event: MouseEvent): void {
		const target = event.target as HTMLElement;
		const choiceEl = target.closest<HTMLElement>("[data-choice]");
		if (choiceEl) {
			resolveChoice(choiceEl.dataset.choice as FirstSignInChoice);
			return;
		}
		const actionEl = target.closest<HTMLElement>("[data-action]");
		switch (actionEl?.dataset.action) {
			case "account-backdrop":
				// Only a click on the backdrop itself, not one bubbling from the panel.
				if (target === actionEl) dismiss();
				return;
			case "account-close":
				close();
				return;
			case "account-sign-out":
				void signOut(false);
				return;
			case "account-sign-out-force":
				void signOut(true);
				return;
			case "account-stay":
				step = "signed-in";
				render();
				return;
			case "account-reload":
				window.location.reload();
				return;
		}
	}

	function onSubmit(event: Event): void {
		event.preventDefault();
		void submit(event.target as HTMLFormElement);
	}

	function onChange(event: Event): void {
		const target = event.target as HTMLInputElement;
		if (target.id !== "account-signup") return;
		signUp = target.checked;
		syncMode();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== "Escape" || event.isComposing) return;
		event.preventDefault();
		event.stopPropagation();
		dismiss();
	}

	// ---- public ----

	function setStatus(status: SyncStatus): void {
		if (!isOpen || step !== "signed-in") return;
		const line = q("[data-role='status']");
		if (line) line.textContent = statusText(status, new Date());
		const reload = q("[data-role='reload']");
		if (reload) reload.hidden = status.kind !== "needs-reload";
	}

	function chooseFirstSignIn(): Promise<FirstSignInChoice> {
		return new Promise((resolve) => {
			choose = resolve;
			// The dialog was closed during the sign-in: the question still needs
			// an answer, so it opens again to ask.
			if (!isOpen) isOpen = true;
			attach();
			step = "choice";
			render();
		});
	}

	return { open, close, setStatus, chooseFirstSignIn };
}
```

- [ ] **Step 7: Add the button to the sidebar**

In `src/views/sidebar.js`:

Replace the header comment's first five lines (up to and including `// }) → { render(state), enterRename(areaId), destroy() }`) with:

```js
// createSidebarView(rootEl, {
//   onToggleCollapse, onGoFocus, onOpenArea,
//   onAddArea, onCommitAreaRename, onMoveAreaUp, onMoveAreaDown, onDeleteArea,
//   onCloseDrawer, onCycleTheme, onPickAreaIcon, onOpenAccount,
// }) → { render(state), enterRename(areaId), setAccountStatus({ label, attention }), destroy() }
```

Below `const THEME_WORD = ...;` add:

```js
// A person outline. Inline SVG, not a glyph: a font may not carry a person
// symbol, and an emoji would not follow the theme's text colour.
const ACCOUNT_ICON = `<svg class="sidebar__account-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const ACCOUNT_DEFAULT = { label: "Account", attention: false };
```

In the destructured callbacks, add `onOpenAccount,` after `onPickAreaIcon,`.

After `let isRendering = false;` add:

```js
	// The account button's state. Set imperatively by setAccountStatus, not by
	// render(state): a sync status change must not cost a full applyState (R2).
	// Kept here so every innerHTML rewrite renders the current state.
	let accountStatus = ACCOUNT_DEFAULT;
```

In the `bindActions(rootEl, { ... })` map, after `"cycle-theme": () => onCycleTheme(),` add:

```js

		"open-account": () => onOpenAccount?.(),
```

In `doRender()`, change the `template(lastState, { ... })` call's options object to:

```js
			rootEl.innerHTML = template(lastState, {
				openAreaMenuId,
				renamingAreaId,
				pendingRenameValue,
				accountStatus,
			});
```

In the returned object, after the `enterRename(areaId) { ... },` method, add:

```js

		// Controller hook, called on every sync status change. Patches the live
		// button in place (no re-render), and the closure copy keeps the next
		// render in step.
		setAccountStatus(next) {
			accountStatus = next;
			const btn = rootEl.querySelector(".sidebar__account");
			if (!btn) return;
			btn.setAttribute("aria-label", next.label);
			btn.classList.toggle("is-attention", next.attention);
		},
```

In `destroy()`, after `isRendering = false;` add `accountStatus = ACCOUNT_DEFAULT;`.

Change `template`'s signature to:

```js
function template(
	state,
	{ openAreaMenuId, renamingAreaId, pendingRenameValue, accountStatus },
) {
```

Replace the footer in `template`'s returned markup (the `<div class="sidebar__footer">` block) with:

```js
		<div class="sidebar__footer">
			<button class="sidebar__account${accountStatus.attention ? " is-attention" : ""}" type="button"
				data-action="open-account" aria-haspopup="dialog"
				aria-label="${escapeHtml(accountStatus.label)}">
				${ACCOUNT_ICON}
				<span class="sidebar__account-marker" aria-hidden="true">!</span>
			</button>
			<button class="sidebar__theme" type="button" data-action="cycle-theme">
				<span class="sidebar__theme-icon" aria-hidden="true">${THEME_GLYPH[state.themeChoice]}</span>
				<span class="sidebar__theme-text">Theme: ${THEME_WORD[state.themeChoice]}</span>
			</button>
		</div>
```

- [ ] **Step 8: Pass the opener through the controller**

In `src/controller.js`, replace line 1 with:

```js
// createController({ models, els, account? }) → { start(), stop(), refresh(), setAccountStatus() }
```

Change the signature to `export function createController({ models, els, account }) {` and add, directly under it:

```js
	// account is optional: { open(), close() } opens and closes the account
	// dialog. The controller never learns what sync is; it only routes the
	// sidebar's button and route changes to it.
```

In `start()`, in the `createSidebarView(sidebarRoot, { ... })` callbacks, after the `onCycleTheme: async () => { ... },` entry add:

```js
			onOpenAccount: () => account?.open(),
```

In `onHashChange()`, directly after the `closeRecurrenceEditor({ rerender: false });` line add:

```js
		account?.close(); // a route change closes the account dialog too
```

A route change (Android's back button included) already closes the drawer and the recurrence editor. The account dialog closes with them, after `closeDrawer()`, so its focus return sees the drawer already shut.

Replace the returned object with:

```js
	// refresh re-reads every model and re-renders. The sync engine calls it after
	// a round wrote remote rows straight to IndexedDB, where no model notify
	// fires (spec §4.5), and other tabs call it on "data-changed".
	// setAccountStatus reaches the sidebar without a render (R2).
	return {
		start,
		stop,
		refresh: applyState,
		setAccountStatus: (state) => sidebar?.setAccountStatus(state),
	};
```

- [ ] **Step 9: Wire the dialog, the status and the announcer in `src/app.js`**

Replace `src/app.js`:

```js
// app.js: application wiring.
//
// Order matters (spec R2): open IndexedDB, wrap it in the syncing db (the one
// seam, spec D3), build the models on the wrapper, render from IndexedDB, and
// only then start sync. The first render never waits for the network.

import { createController } from "./controller.js";
import { createAreaModel } from "./model/areas.js";
import { openDB } from "./model/db.js";
import { createSectionModel } from "./model/sections.js";
import { createSettingsModel } from "./model/settings.js";
import { createTaskModel } from "./model/tasks.js";
import { createAccount } from "./sync/account";
import { createAccountDialog } from "./sync/account-dialog";
import { accountButtonState } from "./sync/account-ui";
import { announce, trackAttention } from "./sync/announce";
import { createApi } from "./sync/api";
import { createSyncEngine } from "./sync/engine";
import { createReseed } from "./sync/reseed";
import { statusText } from "./sync/status";
import { createSyncingDb } from "./sync/syncing-db";

// Shown while another tab still runs the previous version and holds the
// database open (spec §4.1). boot() overwrites #main once the upgrade runs.
function showBlocked(mainEl) {
	mainEl.innerHTML = `<p class="boot-notice" role="status">Close other Ignite tabs to finish updating</p>`;
}

// Shown when a newer version in another tab took the database over. This tab's
// connection is closed, so every write would fail silently until a reload.
function showUpdated(mainEl) {
	mainEl.innerHTML = `<p class="boot-notice" role="status">Ignite updated in another tab. Reload.</p>`;
}

async function boot() {
	const mainEl = document.getElementById("main");

	// The underlying db. Only the sync engine and the account flows write to it
	// directly, so rows from the server never re-enter the outbox (spec §4.5).
	const rawDb = await openDB(undefined, {
		onBlocked: () => showBlocked(mainEl),
		onVersionChange: () => showUpdated(mainEl),
	});

	// Assigned after the first render. A write before then has nothing to
	// schedule, and the engine's first round pushes it anyway.
	let engine = null;
	const db = createSyncingDb(rawDb, { onQueued: () => engine?.schedule() });

	const areas = await createAreaModel(db);
	const sections = await createSectionModel(db);
	const tasks = await createTaskModel(db);
	const settings = await createSettingsModel(db);

	const sidebarRoot = document.getElementById("sidebar");
	const topbarRoot = document.getElementById("topbar");
	const scrimEl = document.getElementById("scrim");

	mainEl.innerHTML = `
		<header class="page-header" id="page-header"></header>
		<section class="capture" id="capture-root"></section>
		<section id="main-root"></section>
	`;

	const toastRoot = document.createElement("div");
	toastRoot.id = "toast-root";
	document.body.appendChild(toastRoot);

	const repeatDialogRoot = document.createElement("div");
	repeatDialogRoot.id = "repeat-dialog-root";
	document.body.appendChild(repeatDialogRoot);

	const accountDialogRoot = document.createElement("div");
	accountDialogRoot.id = "account-dialog-root";
	document.body.appendChild(accountDialogRoot);

	// Created after the first render, like the engine. A click on the account
	// button in the few milliseconds before that does nothing.
	let dialog = null;

	const controller = createController({
		models: { areas, sections, tasks, settings },
		els: {
			sidebarRoot,
			topbarRoot,
			scrimEl,
			mainEl,
			pageHeaderRoot: document.getElementById("page-header"),
			captureRoot: document.getElementById("capture-root"),
			mainRoot: document.getElementById("main-root"),
			toastRoot,
			repeatDialogRoot,
		},
		account: { open: () => dialog?.open(), close: () => dialog?.close() },
	});
	await controller.start();

	// Other open tabs share this IndexedDB but not this page's state. When data
	// changes underneath the models (a pull, a sign-out wipe), they re-read it.
	// A BroadcastChannel never delivers to the tab that posted.
	const channel = new BroadcastChannel("ignite");
	channel.addEventListener("message", (event) => {
		if (event.data === "data-changed") controller.refresh();
	});
	const dataChanged = () => {
		controller.refresh();
		channel.postMessage("data-changed");
	};

	// A sync failure never throws into the controller and never shows a toast
	// (spec §8). It reaches the button, the dialog's status line, and the
	// announcer once.
	let lastAttention = null;
	const onStatus = (status) => {
		controller.setAccountStatus(accountButtonState(status));
		dialog?.setStatus(status);
		const next = trackAttention(lastAttention, status);
		lastAttention = next.last;
		if (next.announce) announce(statusText(status, new Date()));
	};

	const api = createApi();
	engine = createSyncEngine({ db: rawDb, api, onApplied: dataChanged, onStatus });
	const account = createAccount({
		db: rawDb,
		api,
		engine,
		reseed: createReseed(rawDb),
		chooseFirstSignIn: () => dialog.chooseFirstSignIn(),
		onDataChanged: dataChanged,
	});
	dialog = createAccountDialog({
		root: accountDialogRoot,
		account,
		getStatus: () => engine.status(),
		// Looked up at close time, never stored: the sidebar re-renders by
		// innerHTML, so a stored reference would be a detached button. On a phone
		// with the drawer shut (a route change closed it), the account button is
		// off screen, so focus goes to the menu button that opens the drawer.
		returnFocus: () =>
			!matchMedia("(min-width: 768px)").matches &&
			!document.body.classList.contains("is-drawer-open")
				? document.querySelector(".topbar__menu")
				: document.querySelector(".sidebar__account"),
	});
	onStatus(engine.status());
	engine.start();

	// Dev server only: a console handle for the plan's browser checks.
	// import.meta.env.DEV is false in every build, so this is dropped from dist.
	if (import.meta.env.DEV) window.__ignite = { account, engine, db: rawDb };
}

boot().catch((err) => {
	console.error("Ignite failed to boot:", err);
});
```

- [ ] **Step 10: The announcer, and the CSS**

In `index.html`, directly after `<div id="scrim"></div>`, add:

```html
		<!-- Sync announcements (spec §7). Present from page load and outside every
		     container that re-renders, so screen readers register it before the
		     first message. -->
		<div id="sync-announcer" class="sr-only" role="status"></div>
```

In `main.css`, replace the `.sidebar__footer` rule and the `.sidebar__theme` rule (the two rules under `/* --- Sidebar footer: theme control --- */`) with:

```css
/* --- Sidebar footer: account and theme controls --- */
/* One row, one 44px height, one bottom edge. `stretch` (not a fixed height)
   keeps the two equal even if the theme label ever wraps. */
.sidebar__footer {
	margin-top: auto;
	padding-top: var(--space-3);
	border-top: 1px solid var(--border);
	display: flex;
	align-items: stretch;
	gap: var(--space-2);
}
.sidebar__theme {
	display: flex;
	align-items: center;
	gap: var(--space-2);
	flex: 1 1 0;
	min-inline-size: 0;
	min-height: 2.75rem;
	padding: var(--space-2);
	border-radius: var(--radius-sm);
	color: var(--text-muted);
	transition: background-color var(--duration-base) var(--ease-standard);
}
```

Directly after the `.sidebar__theme-icon { ... }` rule (before the `/* Collapsed rail: hide the label ...` comment), add:

```css
/* The account control: a 44px square beside the theme control. Icon only,
   because "Account" and "Theme: system" do not both fit one row of the 240px
   sidebar. The name is in aria-label and carries the sync state. */
.sidebar__account {
	position: relative;
	flex: 0 0 2.75rem;
	display: grid;
	place-items: center;
	min-height: 2.75rem;
	border-radius: var(--radius-sm);
	color: var(--text-muted);
	transition: background-color var(--duration-base) var(--ease-standard);
}
.sidebar__account:hover {
	background: var(--surface-4);
	color: var(--text);
}
.sidebar__account-icon {
	inline-size: 1.25rem;
	block-size: 1.25rem;
}
/* Attention is a shape with a glyph in it, never colour alone (spec §7).
   Inset inside the button, so it stays inside the 48px rail too. */
.sidebar__account-marker {
	display: none;
	position: absolute;
	inset-block-start: 2px;
	inset-inline-end: 2px;
	min-inline-size: 1rem;
	block-size: 1rem;
	border-radius: 999px;
	background: var(--accent);
	/* --surface-2 on --accent clears 4.5:1 in both themes (4.66:1 light,
	   6.43:1 dark), the same pairing as the rail's count badges. */
	color: var(--surface-2);
	font-size: 0.6875rem;
	font-weight: 700;
	line-height: 1rem;
	text-align: center;
}
.sidebar__account.is-attention {
	color: var(--text);
}
.sidebar__account.is-attention .sidebar__account-marker {
	display: block;
}
```

Directly after the existing `@media (min-width: 768px) { body.is-sidebar-collapsed .sidebar__theme-text { ... } body.is-sidebar-collapsed .sidebar__theme { ... } }` block, add:

```css
/* Rail: 48px has no room for a row, so the two footer controls stack. Each
   stays 44px tall and fills the rail's width, as the theme control always has.
   align-self: the collapsed #sidebar centres its children, which would shrink
   the footer to its content. Same fix as .sidebar__areas in the rail. */
@media (min-width: 768px) {
	body.is-sidebar-collapsed .sidebar__footer {
		align-self: stretch;
		flex-direction: column;
		gap: var(--space-1);
	}
}
```

Directly after the recurrence dialog's last block (`@media (min-width: 768px) { .repeat-backdrop { ... } .repeat-panel { ... } }`) and before `/* --- Page header --- */`, add:

```css
/* ================================================================= */
/* Account dialog (src/sync/account-dialog.ts). Reuses the recurrence  */
/* dialog's .repeat-* classes (backdrop, panel, heading, fields,       */
/* inputs, buttons, footer), so Ignite has one dialog look. Only what  */
/* that dialog has no class for is added here.                         */
/* ================================================================= */
body.is-account-open {
	overflow: hidden;
}
.account-form {
	display: flex;
	flex-direction: column;
	gap: var(--space-4);
}
.account-lead,
.account-hint {
	color: var(--text-muted);
	font-size: var(--text-sm);
}
.account-error {
	color: var(--danger);
	font-size: var(--text-sm);
}
.account-error:empty {
	display: none;
}
.account-check {
	display: flex;
	align-items: center;
	gap: var(--space-2);
	min-block-size: 44px;
	cursor: pointer;
}
.account-check input {
	inline-size: 1.25rem;
	block-size: 1.25rem;
	flex-shrink: 0;
	accent-color: var(--accent);
}
.account-check-group {
	display: flex;
	flex-direction: column;
}
/* The hint lines up under the label's text, not under the box. */
.account-check-group .account-hint {
	padding-inline-start: calc(1.25rem + var(--space-2));
}
/* Labels look like labels: the term is small and muted, the value is body
   text in full colour. */
.account-summary {
	display: grid;
	gap: var(--space-3);
}
.account-summary dt {
	color: var(--text-muted);
	font-size: var(--text-sm);
}
.account-summary dd {
	margin: 0;
	color: var(--text);
	overflow-wrap: anywhere;
}
.account-choices {
	display: flex;
	flex-direction: column;
	gap: var(--space-2);
}
.account-choices .repeat-btn {
	inline-size: 100%;
	text-align: start;
}
.account-btn--danger {
	color: var(--danger);
}
.account-btn--start {
	margin-inline-end: auto;
}
```

- [ ] **Step 11: Run the checks**

Run: `npm run check && npm run test:run && npm run build`
Expected: PASS.

- [ ] **Step 12: Browser check: the footer row and the rail**

Start `npx wrangler dev --var ALLOWED_EMAILS:e2e-one@ignite.test,e2e-two@ignite.test` and `npx vite --port 5174 --strictPort` in the background. Open `http://localhost:5174/` with `preview_start`. Use `resize_window` with width 1280, height 800.

Run:

```js
const box = (s) => {
	const r = document.querySelector(s).getBoundingClientRect();
	return { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) };
};
({ account: box(".sidebar__account"), theme: box(".sidebar__theme"), sidebar: box("#sidebar") });
```

Expected (expanded, 1280): `account.w` 44, `account.h` 44, `theme.h` 44, `account.bottom === theme.bottom`. A `theme.h` above 44 means "Theme: system" wrapped: stop and show Malin.

Click `.sidebar__toggle` to collapse the rail and run the same script.
Expected (rail): `account.h` 44, `theme.h` 44, `account.w === theme.w`, both `right` at most `sidebar.right`. Click the toggle again to expand.

`resize_window` to the `mobile` preset (375 × 812), reload, click `.topbar__menu` to open the drawer, run the script.
Expected (drawer): `account.h` 44, `theme.h` 44, `account.bottom === theme.bottom`.

Accessible name: `document.querySelector(".sidebar__account").getAttribute("aria-label")`
Expected: `"Account"`.

- [ ] **Step 13: Browser check: the dialog on a phone, over the drawer**

Still at 375 with the drawer open. Click `.sidebar__account`. Run:

```js
({
	focused: document.activeElement.id,
	sidebarInert: document.getElementById("sidebar").inert,
	mainInert: document.getElementById("main").inert,
	announcerInert: document.getElementById("sync-announcer").inert,
	autocomplete: [
		document.getElementById("account-email").autocomplete,
		document.getElementById("account-password").autocomplete,
	],
	remember: document.getElementById("account-remember").checked,
});
```

Expected: `focused` `"account-email"`, `sidebarInert` true, `mainInert` true, `announcerInert` false, `autocomplete` `["email", "current-password"]`, `remember` false.

Tick "Create an account" (click `#account-signup`). Run `[document.getElementById("account-password").autocomplete, document.getElementById("account-password").getAttribute("aria-describedby"), document.getElementById("account-heading").textContent]`.
Expected: `["new-password", "account-password-hint", "Create an account"]`. Untick it again.

Submit empty: `document.querySelector(".account-form").requestSubmit()` (the pane's CDP Enter does not fire a native submit, see `lessons.md`). Run `[document.activeElement.id, document.activeElement.getAttribute("aria-describedby"), document.activeElement.getAttribute("aria-invalid"), document.getElementById("account-email-error").textContent]`.
Expected: `["account-email", "account-email-error", "true", "Enter your email."]`.

Escape (synthetic, the pane cannot send a real key): `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`. Then run:

```js
({
	dialogGone: document.getElementById("account-dialog-root").childElementCount === 0,
	drawerStillOpen: document.body.classList.contains("is-drawer-open"),
	sidebarInert: document.getElementById("sidebar").inert,
	mainInert: document.getElementById("main").inert,
	focusOnAccount: document.activeElement.classList.contains("sidebar__account"),
});
```

Expected: every value `true` except `sidebarInert`, which is `false`. The drawer stayed open and modal (`#main` still inert), and focus is back on the account button inside it.

The drawer closing under the open dialog. Still at 375 with the drawer open, click `.sidebar__account` again, then change the route the way Android's back button does: `location.hash = location.hash === "#today" ? "#focus" : "#today"`. Wait 300 ms and run:

```js
({
	dialogGone: document.getElementById("account-dialog-root").childElementCount === 0,
	drawerOpen: document.body.classList.contains("is-drawer-open"),
	mainMatchesDrawer:
		document.getElementById("main").inert === document.body.classList.contains("is-drawer-open"),
	topbarInert: document.getElementById("topbar").inert,
	sidebarInert: document.getElementById("sidebar").inert,
	focusOnMenu: document.activeElement.classList.contains("topbar__menu"),
});
```

Expected: `dialogGone` true, `drawerOpen` false, `mainMatchesDrawer` true, `topbarInert` false, `sidebarInert` false, `focusOnMenu` true. With a snapshot restore, `#main` would be inert again here with no drawer open, and nothing on the page would respond.

Then the rotation case. Click `.topbar__menu` to open the drawer, click `.sidebar__account`, and `resize_window` to width 1024, height 800 while the dialog is open (crossing 768 px closes the drawer). Dispatch Escape as above, then run the same script.
Expected: `dialogGone` true, `drawerOpen` false, `mainMatchesDrawer` true, `topbarInert` false, `sidebarInert` false (`focusOnMenu` does not apply at 1024: focus returns to `.sidebar__account`). `resize_window` back to the `mobile` preset before Step 14.

- [ ] **Step 14: Browser check: 320px, 200% text, 44px targets**

`resize_window` width 320, height 700. Open the drawer and the dialog again. Run:

```js
const panel = document.querySelector("#account-dialog-root [role=dialog]");
const small = [...panel.querySelectorAll("button, input.repeat-input, .account-check")]
	.filter((el) => el.offsetParent)
	.map((el) => [el.id || el.textContent.trim(), Math.round(el.getBoundingClientRect().height)])
	.filter(([, h]) => h < 44);
const footer = [...panel.querySelectorAll(".repeat-footer button")].filter((b) => !b.hidden);
({
	pageFits: document.documentElement.scrollWidth <= 320,
	panelFits: panel.scrollWidth <= panel.clientWidth,
	small,
	footerHeights: [...new Set(footer.map((b) => Math.round(b.getBoundingClientRect().height)))],
});
```

Expected: `pageFits` true, `panelFits` true, `small` `[]`, `footerHeights` one value (44).

Set 200% text: `document.documentElement.style.fontSize = "200%"`, run the same script.
Expected: `pageFits` true, `panelFits` true, `small` `[]`. The panel may scroll vertically; that is fine. Then `document.documentElement.style.fontSize = ""`.

`resize_window` preset `desktop`, reload, open the dialog from the sidebar. Run the `footerHeights` part plus `[...new Set(footer.map((b) => Math.round(b.getBoundingClientRect().bottom)))].length`.
Expected: heights one value (44) and one shared bottom edge.

- [ ] **Step 15: Browser check: signed in, sign-out confirm, attention, announcements**

Read e2e-one's credentials from `.superpowers/e2e/credentials.local`. In the dialog, type the email and password (ticking "Create an account" only if Task 15 Step 13 did not already create e2e-one), then `document.querySelector(".account-form").requestSubmit()`.
Expected within 3 seconds: the dialog closed, focus on `.sidebar__account`, `document.getElementById("sync-announcer").textContent === "Signed in"`.

The session cookie survives on the local origin. `useSecureCookies: true` (Task 8) names the cookie with a `__Secure-` prefix and marks it Secure, and the dev origin is plain `http://`. Chromium treats `localhost` and `127.0.0.1` as secure contexts, but that is the assumption under test. The cookie is HttpOnly, so read it through the server and in DevTools, not `document.cookie`. Run:

```js
await fetch("/api/auth/get-session").then((r) => r.json());
```

Expected: an object whose `user.email` is `"e2e-one@ignite.test"`, not `null`. In DevTools, Application, Cookies, the origin lists one cookie whose name starts `__Secure-` with HttpOnly, Secure and SameSite Strict ticked. Repeat both on the second dev origin (`127.0.0.1:5175`) when Task 19 Step 3 signs in there.

If `get-session` returns `null` or no cookie is listed, the browser dropped it. Then add `export function secureCookies(url: string): boolean { return url.startsWith("https://"); }` to `api/src/auth.ts` beside `parseAllowlist`, and in Task 8's `advanced` block set `useSecureCookies: secureCookies(env.BETTER_AUTH_URL)` and `secure: secureCookies(env.BETTER_AUTH_URL)`. Test it in `api/test/allowlist.test.ts` (Task 8), beside `parseAllowlist`: `true` for `https://ignite.example.workers.dev`, `false` for `http://localhost:8787`. A pure function, because the Workers handler tests pin one `BETTER_AUTH_URL` and can't try both. Re-run this check. Production always runs on `https://`, so it keeps the prefix either way.

Open the dialog again. Run:

```js
const dl = document.querySelector(".account-summary");
const dt = getComputedStyle(dl.querySelector("dt"));
const dd = getComputedStyle(dl.querySelector("dd"));
({
	email: dl.querySelector("[data-role=email]").textContent,
	status: dl.querySelector("[data-role=status]").textContent,
	focused: document.activeElement.dataset.action,
	labelDistinct: dt.fontSize !== dd.fontSize && dt.color !== dd.color,
});
```

Expected: `email` `"e2e-one@ignite.test"`, `status` starting `"Synced"`, `focused` `"account-close"`, `labelDistinct` true.

Background success is silent: note the announcer text, run `await __ignite.engine.runRound()`, read it again.
Expected: unchanged.

Unsynced sign-out: close the dialog, stop wrangler dev, capture a task `Unsynced`. Open the dialog and click Sign out.
Expected: heading "Sign out?", `[data-role=unsynced]` reads "1 change hasn't synced. Sign out anyway?", `document.activeElement.dataset.action === "account-stay"`. Click "Stay signed in": the signed-in view returns. Restart wrangler dev and dispatch `window.dispatchEvent(new Event("online"))`; within 3 seconds `(await __ignite.db.getAll("outbox")).length` is 0.

Attention: end the session on the server only: `await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })`, then `await __ignite.engine.runRound()`. Run:

```js
const btn = document.querySelector(".sidebar__account");
({
	label: btn.getAttribute("aria-label"),
	marker: getComputedStyle(btn.querySelector(".sidebar__account-marker")).display,
	announced: document.getElementById("sync-announcer").textContent,
});
```

Expected: `label` `"Account, sync needs attention"`, `marker` `"block"`, `announced` `"Sign in again to sync"`. Run `runRound()` twice more: the announcer is not rewritten (check with a `MutationObserver` or by clearing it first and reading it after).

Open the dialog: heading "Sign in again", email filled in, `document.activeElement.id === "account-password"`, a Sign out button present.

A failed sign-in keeps "Stay signed in" (WCAG 3.3.7). Click `#account-remember` to tick it, type `wrong-password-123` in the password field, and `document.querySelector(".account-form").requestSubmit()`. Within 3 seconds run:

```js
({
	remember: document.getElementById("account-remember").checked,
	error: document.getElementById("account-password-error").textContent,
	focused: document.activeElement.id,
	email: document.getElementById("account-email").value,
});
```

Expected: `remember` true, `error` `"Email or password is wrong"`, `focused` `"account-password"`, `email` `"e2e-one@ignite.test"`.

Sign in again with e2e-one's real password (the box stays ticked): the marker hides and the label returns to "Account".

Sign out from the dialog (the outbox is empty, so no confirm). Expected: the dialog closes, announcer "Signed out", `(await __ignite.account.meta()).mode === "local"`.

A sign-in that throws instead of answering. Stub the flow with one that rejects after half a second: `const realSignIn = __ignite.account.signIn; __ignite.account.signIn = () => new Promise((_, reject) => setTimeout(() => reject(new Error("stub")), 500));`. Open the dialog, type e2e-one's email and any password, call `requestSubmit()` as above, and at once run `[document.querySelector("[data-role=submit]").textContent, document.querySelector("[data-role=submit]").getAttribute("aria-disabled")]`.
Expected: `["Signing in…", "true"]`.

After one second run `[document.querySelector("[data-role=submit]").textContent, document.querySelector("[data-role=submit]").getAttribute("aria-disabled"), document.getElementById("account-form-error").textContent, document.getElementById("sync-announcer").textContent]`.
Expected: `["Sign in", null, "Something went wrong. Try again.", "Something went wrong. Try again."]`. Restore the flow with `__ignite.account.signIn = realSignIn;` and close the dialog.

- [ ] **Step 16: Browser check: the first-sign-in question**

In local mode, capture a task `Local only`. Open the dialog and sign in as e2e-one (the account holds `Sync check` from Task 15, so both sides have data).
Expected: heading "This device has its own tasks", `document.activeElement.dataset.choice === "add"`, and the Replace button's text contains "deletes this device's tasks".

Dispatch Escape as in Step 13.
Expected: the form is back, `(await __ignite.account.meta()).mode === "local"`, and `(await __ignite.db.getAll("tasks")).some((t) => t.title === "Local only")` is true. Nothing changed.

Sign in again at once, and choose Add. No wait is needed. `auth.ts` allows 5 sign-in attempts per IP, and Better Auth only resets the count after a full minute with no attempt. Step 15 made at most three (the first sign-in, the wrong password, the sign-in again; the stubbed one never reaches the server), and this step makes two, so even with no minute-long pause in between the total is 5, which is still allowed. If the form shows "Too many attempts. Try again in a minute." anyway, another sign-in landed without a pause: wait 60 seconds and submit again.
Expected: the dialog closes, announcer "Signed in", and after one round both `Local only` and `Sync check` are in `__ignite.db.getAll("tasks")`.

A sign-out that throws instead of answering. `const realSignOut = __ignite.account.signOut; __ignite.account.signOut = () => new Promise((_, reject) => setTimeout(() => reject(new Error("stub")), 500));`. Open the dialog, click Sign out, and at once run `[document.querySelector("[data-action=account-sign-out]").textContent, document.querySelector("[data-action=account-sign-out]").getAttribute("aria-disabled")]`.
Expected: `["Signing out…", "true"]`.

After one second run `[document.querySelector("[data-action=account-sign-out]").textContent, document.querySelector("[data-action=account-sign-out]").getAttribute("aria-disabled"), document.getElementById("account-form-error").textContent, (await __ignite.account.meta()).mode]`.
Expected: `["Sign out", null, "Something went wrong. Try again.", "account"]`. Restore with `__ignite.account.signOut = realSignOut;` and close the dialog. The device stays signed in as e2e-one, as before this check.

- [ ] **Step 17: Show Malin, then commit**

Take four screenshots: the expanded footer (1280, dark), the rail footer, the drawer footer (375), and the open dialog at 375 in light theme. Show them to Malin with the one open question: is an icon-only account button right, or should "Account" be visible text on its own row above the theme control? Wait for her answer. If she picks the row, change `.sidebar__footer` to `flex-direction: column` and give the button an `Account` text span; re-run Step 12.

Stop the servers.

```bash
git add src/sync/account-ui.ts src/sync/announce.ts src/sync/account-dialog.ts tests/sync/account-ui.test.ts tests/sync/announce.test.ts src/views/sidebar.js src/controller.js src/app.js index.html main.css
git commit -m "feat(sync): account button, account dialog and sync announcer"
```

---

### Task 17: Security headers for the static assets

A `_headers` file generated at build time, so the CSP's hash of the inline theme script is taken from the built `index.html` and cannot drift from it. Spec §9 (security headers, CSP by hash, report-only first).

**Files:**
- Create: `scripts/headers.mjs`
- Test: `tests/unit/headers.test.js`
- Modify: `vite.config.js` (import and `plugins`)

**Interfaces:**
- Consumes: nothing from other tasks. For the cross-check only, `SECURITY_HEADERS` in `api/src/http.ts` (Task 8).
- Produces (`scripts/headers.mjs`):
  - `export const CSP_REPORT_ONLY = true` (Task 19 flips it)
  - `export const PERMISSIONS_POLICY: string`
  - `inlineScriptHashes(html: string): string[]` (each `'sha256-<base64>'`)
  - `contentSecurityPolicy(scriptHashes: string[]): string`
  - `headersFile(html: string, options: { reportOnly: boolean }): string`
  - `headersPlugin(options?: { reportOnly?: boolean }): import("vite").Plugin`, which writes `dist/_headers` in `closeBundle`

**What the build actually needs, checked on the v0.9.0 build (`dist/`, 2026-09-24):** one stylesheet and one module script, both same-origin under `/assets/`. Fonts are `url(/assets/*.woff2)` references, all over Vite's 4 kB inline limit, so there is no `data:` URI in the CSS or JS. No `style=` attribute and no `<style>` element in `index.html`, `src/` or the bundle, and no `.style` writes in the JS. The design system has none either. So `default-src 'self'` already covers styles, fonts, images, the manifest and the service worker, and the only exception needed is the theme script's hash. Inline SVG presentation attributes (the account icon) are not styles and need nothing.

**Scope:** Cloudflare applies `_headers` to static asset responses only. Responses the Worker generates (`/api/*`, which runs first per `run_worker_first`) get theirs from `api/src/http.ts` (Task 8).

- [ ] **Step 1: Write the failing tests**

`tests/unit/headers.test.js`:

```js
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	contentSecurityPolicy,
	headersFile,
	inlineScriptHashes,
	PERMISSIONS_POLICY,
} from "../../scripts/headers.mjs";

// sha256("console.log(1)") in base64, computed with node:crypto.
const KNOWN = "'sha256-CihokcEcBW4atb/CW/XWsvWwbTjqwQlE9nj9ii5ww5M='";

describe("inlineScriptHashes", () => {
	it("hashes the exact text between the tags", () => {
		expect(inlineScriptHashes("<script>console.log(1)</script>")).toEqual([KNOWN]);
	});

	it("changes when a single character of the script changes", () => {
		const [a] = inlineScriptHashes("<script>console.log(1)</script>");
		const [b] = inlineScriptHashes("<script>console.log(2)</script>");
		expect(a).not.toBe(b);
	});

	it("counts whitespace, as the browser does", () => {
		expect(inlineScriptHashes("<script> console.log(1)</script>")).not.toEqual([KNOWN]);
	});

	it("skips scripts loaded by src", () => {
		const html =
			'<script type="module" crossorigin src="/assets/index.js"></script><script>console.log(1)</script>';
		expect(inlineScriptHashes(html)).toEqual([KNOWN]);
	});

	it("finds exactly one inline script in index.html: the theme script", () => {
		expect(inlineScriptHashes(readFileSync("index.html", "utf8"))).toHaveLength(1);
	});
});

describe("contentSecurityPolicy", () => {
	it("is the spec's policy with the script hash added", () => {
		expect(contentSecurityPolicy([KNOWN])).toBe(
			`default-src 'self'; script-src 'self' ${KNOWN}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
		);
	});
});

describe("headersFile", () => {
	const html = "<script>console.log(1)</script>";

	it("ships the CSP as report-only when asked", () => {
		const file = headersFile(html, { reportOnly: true });
		expect(file).toContain("  Content-Security-Policy-Report-Only: default-src 'self';");
		expect(file).not.toMatch(/^ {2}Content-Security-Policy:/m);
	});

	it("enforces it otherwise", () => {
		expect(headersFile(html, { reportOnly: false })).toMatch(
			/^ {2}Content-Security-Policy: default-src 'self';/m,
		);
	});

	it("applies to every path and carries the other four headers", () => {
		expect(headersFile(html, { reportOnly: true }).split("\n")).toEqual([
			"/*",
			`  Content-Security-Policy-Report-Only: ${contentSecurityPolicy([KNOWN])}`,
			"  Strict-Transport-Security: max-age=31536000",
			"  X-Content-Type-Options: nosniff",
			"  Referrer-Policy: same-origin",
			`  Permissions-Policy: ${PERMISSIONS_POLICY}`,
			"",
		]);
	});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/headers.test.js`
Expected: FAIL, "Failed to load url ../../scripts/headers.mjs".

- [ ] **Step 3: Implement `scripts/headers.mjs`**

```js
// scripts/headers.mjs: builds dist/_headers for Cloudflare's static assets.
//
// The CSP allows the inline theme script in index.html by its SHA-256, not with
// 'unsafe-inline' (spec §9). The hash is computed here from the BUILT
// index.html, the exact bytes the browser hashes, so editing that script can
// never leave a stale hash behind.
//
// _headers covers static assets only. Responses the Worker generates (/api/*)
// get their headers from api/src/http.ts (SECURITY_HEADERS).

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Report-only for the first deploy. Flipped to false once a browser session
// on the live site shows no violations (spec §9, Task 19).
export const CSP_REPORT_ONLY = true;

// Features Ignite never uses, denied outright. Keep in step with the
// Permissions-Policy in api/src/http.ts.
export const PERMISSIONS_POLICY =
	"camera=(), microphone=(), geolocation=(), payment=(), usb=()";

// A <script> element with no src attribute, and its text.
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

export function inlineScriptHashes(html) {
	return [...html.matchAll(INLINE_SCRIPT)].map(
		(m) => `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`,
	);
}

export function contentSecurityPolicy(scriptHashes) {
	return [
		"default-src 'self'",
		["script-src 'self'", ...scriptHashes].join(" "),
		"connect-src 'self'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join("; ");
}

export function headersFile(html, { reportOnly }) {
	const name = reportOnly
		? "Content-Security-Policy-Report-Only"
		: "Content-Security-Policy";
	return [
		"/*",
		`  ${name}: ${contentSecurityPolicy(inlineScriptHashes(html))}`,
		"  Strict-Transport-Security: max-age=31536000",
		"  X-Content-Type-Options: nosniff",
		"  Referrer-Policy: same-origin",
		`  Permissions-Policy: ${PERMISSIONS_POLICY}`,
		"",
	].join("\n");
}

// Writes <outDir>/_headers after Vite has written index.html.
export function headersPlugin({ reportOnly = CSP_REPORT_ONLY } = {}) {
	let outDir = "dist";
	return {
		name: "ignite-headers",
		apply: "build",
		configResolved(config) {
			outDir = resolve(config.root, config.build.outDir);
		},
		async closeBundle() {
			const html = await readFile(resolve(outDir, "index.html"), "utf8");
			await writeFile(resolve(outDir, "_headers"), headersFile(html, { reportOnly }));
		},
	};
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/headers.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Wire the plugin into the build**

In `vite.config.js`, add the import under `import { defineConfig } from "vite";`:

```js
import { headersPlugin } from "./scripts/headers.mjs";
```

and add, as the first key inside `defineConfig({`:

```js
	// Writes dist/_headers (CSP with the theme script's hash, HSTS, nosniff,
	// Referrer-Policy, Permissions-Policy). See scripts/headers.mjs.
	plugins: [headersPlugin()],
```

- [ ] **Step 6: Build and read the result**

Run: `npm run build && cat dist/_headers`
Expected: six lines as in the last test, with one `'sha256-…'` value. Cross-check it against the built HTML:

```bash
node -e "import('./scripts/headers.mjs').then(async (m) => console.log(m.inlineScriptHashes(await (await import('node:fs/promises')).readFile('dist/index.html', 'utf8'))))"
```

Expected: the same single hash as in `dist/_headers`.

- [ ] **Step 7: Browser check: the policy is served and the browser agrees with the hash**

Run `npx wrangler dev` (background). Run: `curl -sI http://localhost:8787/ | grep -iE "content-security|strict-transport|nosniff|referrer-policy|permissions-policy"`
Expected: five lines, the CSP one named `Content-Security-Policy-Report-Only`. If none appear, this wrangler version does not apply `_headers` locally: skip the rest of this step and run it against the live site in Task 19 Step 16 instead.

Open `http://localhost:8787/` in the Browser pane. Load the page, cycle the theme once, open and close the account dialog, capture one task. Then `read_console_messages` with pattern `Content Security Policy`.
Expected: no messages.

Negative control, to prove this check can go red: change one character of the hash in `dist/_headers`, restart wrangler dev, reload, and read the console again.
Expected: one `[Report Only]` message refusing the inline script. Then `npm run build` to restore the file.

- [ ] **Step 8: Cross-check the headers the Worker sends**

Run: `grep -n -A1 "Permissions-Policy\|Strict-Transport-Security\|Referrer-Policy\|nosniff" api/src/http.ts` (`-A1` because Biome wraps long values onto the next line)
Expected: the same values as `dist/_headers` for these four headers. If any differ, change `scripts/headers.mjs` to match `api/src/http.ts`, whose values Task 8 tested, and re-run Steps 4 and 6.

- [ ] **Step 9: Commit**

Stop wrangler dev.

```bash
git add scripts/headers.mjs tests/unit/headers.test.js vite.config.js
git commit -m "feat(security): generate _headers with a hashed CSP at build time"
```

---

### Task 18: Deploy pipeline and retiring GitHub Pages

One job on push to `main` that tests, builds, migrates and deploys the Worker. A one-off workflow that turns the old Pages site into a "moved" page. Spec §9 (trust boundaries), §11.

**Files:**
- Modify: `.github/workflows/deploy.yml` (whole file)
- Modify: `.github/workflows/ci.yml` (whole file)
- Create: `.github/workflows/retire-pages.yml`
- Create: `.github/retire-pages/index.html`, `.github/retire-pages/sw.js`, `.github/retire-pages/build.mjs`
- Modify: `.gitignore` (one line)

**Interfaces:**
- Consumes: `api/drizzle.config.ts` (Task 6), which reads the connection string from `process.env.DATABASE_URL`, which the workflow maps from the `NEON_DATABASE_URL` secret; the GitHub environment `production` (deployable from `main` only) and its secrets `CLOUDFLARE_API_TOKEN` and `NEON_DATABASE_URL` (Task 0, Step 11); `wrangler.jsonc` (Task 8); `npm run check` including `tsc --noEmit` and `npm run build` including the bundle gate (Task 2).
- Produces: repository variable `CLOUDFLARE_ACCOUNT_ID` (set by Malin), the `Deploy` workflow, the manually run `Retire GitHub Pages` workflow.

**Pinned actions (looked up 2026-09-30 with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`):**

| Action | Tag | Commit SHA |
|---|---|---|
| `actions/checkout` | v4.4.0 | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-node` | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `actions/upload-pages-artifact` | v5.0.0 | `fc324d3547104276b827a68afc52ff2a11cc49c9` |
| `actions/deploy-pages` | v5.0.1 | `368f82528645a54fb793d4d04e342629a3f51346` |

**Flag for Malin:** `checkout` v4.4.0 and `setup-node` v4.4.0 run on Node 20 (`using: node20` in their `action.yml`), which GitHub is retiring for actions. The current majors run on Node 24: `actions/checkout` v7.0.1 is `3d3c42e5aac5ba805825da76410c181273ba90b1` and `actions/setup-node` v7.0.0 is `820762786026740c76f36085b0efc47a31fe5020`. This task pins v4 as planned; moving to v7 is a two-line change once I have read their release notes.

**Only Malin can do these** (Claude cannot set secrets, change repo settings, or publish to Pages without me):
1. Confirm the `production` environment from Task 0 Step 11 still limits deploys to `main`: `gh api repos/malinfossum/ignite/environments/production/deployment-branch-policies` shows `"total_count": 1` and one policy named `main`, and `gh api repos/malinfossum/ignite/environments/production` shows `"custom_branch_policies": true`. If the environment is missing, create it as Task 0 Step 11 describes.
2. Confirm `gh secret list --env production` lists `CLOUDFLARE_API_TOKEN` and `NEON_DATABASE_URL` (the Neon `main` branch's direct string for the `ignite` role), and that plain `gh secret list` lists neither. A repository secret is readable by a workflow run on any branch; an environment secret only by a job on `main` that declares `environment: production` (spec §9).
3. Add repository variable (not secret) `CLOUDFLARE_ACCOUNT_ID`. It saves wrangler from guessing the account from the token.
4. Merge the PR. Then watch the first `Deploy` run.
5. Before running `Retire GitHub Pages`: open `malinfossum.github.io/ignite` on every device I used it on and copy any task I want to keep (into the new address, or anywhere else). After Retire runs, that origin's tasks are still in its IndexedDB but have no UI to show them. Malin confirms each device in chat, by name, before Claude moves on.
6. Once the Worker is live and checked (Task 19 Step 16) and step 5 is confirmed for every device, run `Retire GitHub Pages` from the Actions tab with the Worker's address.
7. Later, once I have opened the old address on each device I used it on, turn Pages off: Settings, Pages, Unpublish. After that the old service worker can no longer update itself, so do not skip step 6.

- [ ] **Step 1: Re-check the SHAs**

```bash
for x in "actions/checkout v4.4.0" "actions/setup-node v4.4.0" "actions/upload-pages-artifact v5.0.0" "actions/deploy-pages v5.0.1"; do set -- $x; echo "$1 $2 $(gh api repos/$1/git/ref/tags/$2 --jq '.object.sha + " " + .object.type')"; done
```

Expected: the four SHAs in the table, each of type `commit`. If a type reads `tag` (an annotated tag), resolve it with `gh api repos/<owner>/<repo>/git/tags/<sha> --jq .object.sha` and pin that commit.

- [ ] **Step 2: Replace `.github/workflows/deploy.yml`**

```yaml
name: Deploy

# Test, build, migrate and deploy the Worker on every push to main (spec §11).
# Never on pull_request, so no fork can reach the secrets. Wrangler and
# drizzle-kit come from the lockfile, so there is no third-party deploy action
# to pin or trust.
on:
  push:
    branches: [main]

permissions:
  contents: read

# Let an in-flight deploy finish rather than cancelling it: a migration cut off
# halfway is worse than a deploy that waits its turn.
concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    # The two secrets live in this environment, not in the repository, and
    # its branch policy lets only main deploy. A workflow edited on another
    # branch can't read them (spec §9).
    environment: production
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # Cheapest first. A red check, test or bundle gate stops the deploy
      # before anything touches Neon or Cloudflare.
      - run: npm run check
      - run: npm run test:run
      - run: npm run build
      # Every migration is additive (spec §11), so the running Worker keeps
      # working against the new schema while the new one rolls out.
      - name: Migrate the Neon main branch
        run: npx drizzle-kit migrate --config api/drizzle.config.ts
        env:
          DATABASE_URL: ${{ secrets.NEON_DATABASE_URL }}
      - name: Deploy the Worker
        run: npx wrangler deploy
        env:
          WRANGLER_SEND_METRICS: "false"
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 3: Pin `.github/workflows/ci.yml`**

```yaml
name: CI

# Verify every pull request into main. deploy.yml covers pushes to main, so
# this deliberately does not run there; it would duplicate that work.
# One job on purpose: the ruleset's "Require status checks to pass" then has a
# single check to require, rather than four that must each be enabled.
on:
  pull_request:
    branches: [main]
  workflow_dispatch:

# Nothing here writes; checkout is all we need.
permissions:
  contents: read

# A new push to the same PR makes the previous run irrelevant, so cancel it.
# (deploy.yml does the opposite, because a half-finished deploy is worse.)
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # Cheapest first, so an obvious formatting or lint failure reports in
      # seconds instead of after the suite and the build.
      - run: npm run check
      - run: npm run test:run
      - run: npm run build
```

- [ ] **Step 4: The "moved" page**

`.github/retire-pages/index.html`:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="robots" content="noindex" />
		<title>Ignite has moved</title>
		<style>
			body {
				margin: 0;
				min-height: 100vh;
				display: grid;
				place-items: center;
				padding: 1rem;
				background: #0b0a0a;
				color: #f3eee8;
				font: 1.125rem/1.5 system-ui, sans-serif;
			}
			main {
				max-width: 32rem;
			}
			a {
				color: #ff8a4c;
			}
		</style>
	</head>
	<body>
		<main>
			<h1>Ignite has moved</h1>
			<p>Ignite now lives at <a href="__NEW_URL__">__NEW_URL__</a>.</p>
			<p>Tasks added at this old address are not moved to the new one.</p>
		</main>
		<script>
			// Belt and braces next to sw.js: remove the old app's worker and caches.
			// Only Ignite's: every project on malinfossum.github.io shares this origin.
			navigator.serviceWorker?.getRegistrations().then((regs) => {
				for (const reg of regs) {
					if (reg.scope.startsWith(`${location.origin}/ignite/`)) reg.unregister();
				}
			});
			caches?.keys().then((keys) => {
				for (const key of keys) if (key.startsWith("ignite-")) caches.delete(key);
			});
		</script>
	</body>
</html>
```

`.github/retire-pages/sw.js`:

```js
// Replaces the old Ignite service worker at malinfossum.github.io/ignite/.
// The browser fetches this on its next update check, sees new bytes and
// installs it. It deletes Ignite's caches, unregisters itself and reloads any
// open Ignite tab, which then gets the "moved" page from the network.
// Only caches named "ignite-..." are touched: every project on
// malinfossum.github.io shares this origin's cache storage.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await self.caches.keys();
			await Promise.all(
				keys.filter((key) => key.startsWith("ignite-")).map((key) => self.caches.delete(key)),
			);
			await self.registration.unregister();
			const clients = await self.clients.matchAll({ type: "window" });
			for (const client of clients) client.navigate(client.url);
		})(),
	);
});
```

`.github/retire-pages/build.mjs`:

```js
// Writes the "moved" page into retire-dist/ with the Worker's address filled
// in. The address comes from the workflow input through an environment
// variable, never interpolated into the shell, and must look like a
// workers.dev URL before anything is written.

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const url = process.env.NEW_URL ?? "";
if (!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\/$/.test(url)) {
	console.error("NEW_URL must look like https://ignite.<subdomain>.workers.dev/");
	process.exit(1);
}

const here = new URL(".", import.meta.url);
const out = "retire-dist";
await mkdir(out, { recursive: true });
const html = await readFile(new URL("index.html", here), "utf8");
await writeFile(`${out}/index.html`, html.replaceAll("__NEW_URL__", url));
await copyFile(new URL("sw.js", here), `${out}/sw.js`);
console.log(`Wrote ${out}/ pointing at ${url}`);
```

Add `retire-dist` to `.gitignore`, on its own line directly after `dist-ssr`.

- [ ] **Step 5: The one-off workflow**

`.github/workflows/retire-pages.yml`:

```yaml
name: Retire GitHub Pages

# One-off, run by hand once the Worker is live. Publishes a small page at
# malinfossum.github.io/ignite that links to the new address, and an sw.js that
# replaces the old service worker, clears Ignite's caches and unregisters
# itself. Pages is turned off later, from Settings.
on:
  workflow_dispatch:
    inputs:
      new_url:
        description: "The Worker's address, like https://ignite.<subdomain>.workers.dev/"
        required: true
        type: string

permissions:
  contents: read

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          persist-credentials: false
      - name: Write the page
        # Passed through env, never ${{ }} inside run: that would be script
        # injection from a workflow input. build.mjs validates it.
        env:
          NEW_URL: ${{ inputs.new_url }}
        run: node .github/retire-pages/build.mjs
      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: retire-dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1
```

- [ ] **Step 6: Check it locally**

Run:

```bash
NEW_URL=https://ignite.example.workers.dev/ node .github/retire-pages/build.mjs && grep -c "https://ignite.example.workers.dev/" retire-dist/index.html && ls retire-dist
NEW_URL='https://evil.example.com/"><script>' node .github/retire-pages/build.mjs; echo "exit $?"
rm -r retire-dist
grep -nE "uses: [^ ]+@v[0-9]" .github/workflows/*.yml
npm run check
```

Expected: the first line prints `Wrote retire-dist/ ...`, then `1` (one line holds both occurrences), then `index.html  sw.js`. The second prints the error and `exit 1`. The `grep` for tag-pinned actions prints nothing. `npm run check` passes (Biome now lints the two new `.js`/`.mjs` files).

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/deploy.yml .github/workflows/ci.yml
git commit -m "ci: deploy the Worker from main and pin actions to commit SHAs"
git add .github/workflows/retire-pages.yml .github/retire-pages .gitignore
git commit -m "ci: add a one-off workflow that retires the GitHub Pages site"
```

The PR's own CI run is the proof that `ci.yml`'s pins resolve: it must go green. `deploy.yml` first runs after Malin merges.

- [ ] **Step 8: After the merge (Malin merges; Claude watches)**

Run: `gh run list --workflow deploy.yml --limit 1` until it finishes, then `gh run view <id> --log-failed` if it failed.
Expected: success. A failure on `Failed to FinalizeArtifact: (403)` or another GitHub-side 5xx/403 unrelated to the code is transient: `gh run rerun <id> --failed`. A failure in the migrate or deploy step is real: read the log, fix, new PR.

Then `curl -sI https://<the address wrangler printed>/ | head -1`
Expected: `HTTP/2 200`.

---

### Task 19: Two-device check, R2 record, README and release notes

Proves the whole feature end to end with two independent "devices", records the R2 numbers, turns on the CSP once it is quiet, and updates the README. Spec §7 (first sign-in matrix, sign-out), §8 (426), §9 (CSP), §10 (two devices, R2), §11 (README).

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-29-ignite-accounts-sync-design.md` (a verification record at the end)
- Modify: `docs/desktop_preview.png` (regenerated)
- Modify: `scripts/headers.mjs` (`CSP_REPORT_ONLY`, in a follow-up PR after the first deploy)
- Create (local, gitignored): `.superpowers/release/v0.10.0.md`

**Interfaces:**
- Consumes: everything from Tasks 2 to 18. The Worker's live address, printed by `wrangler deploy` in Task 11, called **the live address** below.
- Produces: nothing new in code.

**Two devices in one browser.** Device A is `http://localhost:8787`: the production build served by `wrangler dev`, with its service worker, `_headers` and a real same-origin API. Device B is `http://127.0.0.1:5175`: the Vite dev server, proxied to the same `wrangler dev`. They are different origins, so each has its own IndexedDB, Web Lock, BroadcastChannel and service worker. They are also different hosts, so each has its own cookie jar and its own session, which a second port on `localhost` would not give (cookies ignore the port). Both talk to the Neon `dev` branch. What this does not cover, and a real second device would: a phone's network, touch, and two browsers' password managers. Those are on my owed list at the end (Step 17).

- [ ] **Step 1: Build and start both devices**

```bash
npm run build
```

Run in the background: `npx wrangler dev --var ALLOWED_EMAILS:e2e-one@ignite.test,e2e-two@ignite.test` and `npx vite --host 127.0.0.1 --port 5175 --strictPort`.

Open `http://localhost:8787/` (tab A) and `http://127.0.0.1:5175/` (tab B) in the Browser pane.

Clean both devices first. In each tab, if the account button's dialog shows a signed-in account, sign out; then run `indexedDB.deleteDatabase("ignite")` and reload.
Expected: each shows the empty Focus surface.

`auth.ts` allows 5 sign-in attempts per IP (Task 8), and Better Auth only resets the count after a full minute with no attempt: each allowed attempt moves the window on. Both tabs share one IP. Keep a tally of sign-ins (sign-ups have their own count): after every fourth sign-in below, wait 60 seconds before the next one. If a form shows "Too many attempts. Try again in a minute.", the tally slipped: wait 60 seconds and submit again.

- [ ] **Step 2: The snapshot script**

Paste this in either tab whenever a step says "snapshot". It reads IndexedDB directly, so it works on both the dev and the production build:

```js
async function snapshot() {
	const db = await new Promise((ok, fail) => {
		const req = indexedDB.open("ignite");
		req.onsuccess = () => ok(req.result);
		req.onerror = () => fail(req.error);
	});
	const read = (store) =>
		new Promise((ok, fail) => {
			const req = db.transaction(store).objectStore(store).getAll();
			req.onsuccess = () => ok(req.result);
			req.onerror = () => fail(req.error);
		});
	const [tasks, outbox, meta, areas] = await Promise.all(
		["tasks", "outbox", "meta", "areas"].map(read),
	);
	db.close();
	return {
		tasks: tasks.map(({ title, starred, completed }) => `${title}|s${starred}|c${completed}`).sort(),
		outbox: outbox.length,
		mode: meta[0]?.mode ?? "local",
		areas: areas.map((a) => a.id).sort(),
	};
}
await snapshot();
```

To make a round run now instead of waiting for the next trigger: `window.dispatchEvent(new Event("online"))`. Switching tabs fires `visibilitychange`, which also runs one.

- [ ] **Step 3: An edit on one device arrives on the other**

Tab A: sign in through the account dialog as e2e-one (tick "Create an account" if Task 15 did not create it on this Neon branch; this origin is seed-only, so there is no question). Capture a task `Arrives`. Wait 3 seconds.
Tab B: sign in as e2e-one.

Expected in tab B (snapshot): `tasks` includes `Arrives|s0|c0`, `areas` is exactly `["focus"]` (the seed was not duplicated), `outbox` 0.

Tab A: star `Arrives` (click its `.task__star`). Wait 3 seconds. Tab B: dispatch `online`, then snapshot.
Expected: `Arrives|s1|c0`.

- [ ] **Step 4: Both offline, the later edit wins**

Stop `wrangler dev`. Both devices are now offline (A's fetch fails; B's proxy answers 5xx, which the engine treats the same way: the round ends and the outbox is kept).

Tab A: unstar `Arrives`. Wait 2 seconds. Tab B: complete `Arrives` (tick its `.task__check`). B's edit is the later one, and conflicts are per row: B's row wins whole, including B's star.

Snapshot both. Expected: A shows `Arrives|s0|c0` with `outbox` 1; B shows `Arrives|s1|c1` with `outbox` 1.

Restart `wrangler dev` with the same command. Dispatch `online` in tab B first, wait 3 seconds, then in tab A, wait 3 seconds, then in tab B again.
Expected in both snapshots: `Arrives|s1|c1`, `outbox` 0. A's older push came back as `lost` and A stored B's row.

- [ ] **Step 5: Delete on one device, edit on the other**

Capture `Delete then edit` in tab A and let both devices sync it (dispatch `online` in B). Stop `wrangler dev`.

Tab A: delete it (its `.task__menu-btn`, then `[data-action="delete-task"]`, and let the undo toast expire). Wait 2 seconds. Tab B: star it.
Restart `wrangler dev`; dispatch `online` in A, then B, then A.
Expected in both: `Delete then edit|s1|c0`. The edit made after the delete brought the task back.

The reverse order: stop `wrangler dev`. Tab B: unstar it. Wait 2 seconds. Tab A: delete it. Restart; `online` in B, then A, then B.
Expected in both: no `Delete then edit` in `tasks`, `outbox` 0.

- [ ] **Step 6: Sign-out wipes the device, not the account**

Tab A: open the account dialog and sign out.
Expected in tab A: announcer "Signed out", snapshot `tasks` `[]`, `outbox` 0, `mode` `"local"`, `areas` `["focus"]`. The theme is unchanged.
Expected in tab B (snapshot, then `online`, then snapshot): still signed in, still holding `Arrives|s1|c1`. The account kept its data.

Tab A: `document.cookie` in the console.
Expected: no Better Auth session cookie is readable (it is HttpOnly), and `await fetch("/api/auth/get-session").then((r) => r.json())` returns `null`.

- [ ] **Step 7: The first sign-in matrix**

Row 1, the account is empty. Tab A (local, from Step 6): capture `Row1 a` and `Row1 b`. Sign in as e2e-two with "Create an account" ticked.
Expected: no question. After 3 seconds, snapshot: `Row1 a` and `Row1 b` present, `outbox` 0, `mode` `"account"`.

Row 2, this device has only the seed. Tab B: sign out, then sign in as e2e-two.
Expected: no question. Snapshot: `tasks` exactly `["Row1 a|s0|c0", "Row1 b|s0|c0"]`, `areas` exactly `["focus"]`, `outbox` 0. The seeded rows were not uploaded over the account's.

Row 3, both sides have data. Tab B: sign out, capture `Row3 mine`, sign in as e2e-two.
Expected: the question, focus on "Add this device's tasks to your account". Dispatch Escape (`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`).
Expected: back on the form; snapshot `mode` `"local"`, `tasks` `["Row3 mine|s0|c0"]`. Nothing changed.

Sign in again, choose Add.
Expected in B: `Row1 a`, `Row1 b`, `Row3 mine`. In A after `online`: the same three.

Tab B: sign out, capture `Row3 replace me`, sign in as e2e-two, choose "Replace them with your account (deletes this device's tasks)".
Expected in B: `Row1 a`, `Row1 b`, `Row3 mine`, and no `Row3 replace me`. In A after `online`: never `Row3 replace me`.

- [ ] **Step 8: A deploy with a tab open: 426, one reload, nothing lost**

Tab A: sign out of e2e-two (still signed in from Step 7 Row 1), then sign in as e2e-one again. Note `document.querySelector('script[type="module"]').src` and confirm `navigator.serviceWorker.controller` is not `null` (reload once if it is).

Simulate a deploy that stops speaking protocol 1. In `shared/protocol.ts`, change `export const PROTOCOL_VERSION = 1;` to `2` (local only, never committed). Stop `wrangler dev`, run `npm run build`, start `wrangler dev` again. Tab A still runs the old bundle.

Tab A: capture `Queued across a deploy`. Wait 3 seconds.
Expected: the account button's label is "Account, sync needs attention" with the marker showing, the announcer reads "Ignite has updated. Reload to keep syncing.", the dialog's status line reads the same with a Reload button, and the snapshot shows `outbox` 1.

Click Reload in the dialog (one reload). Wait 3 seconds.
Expected: the module script's `src` hash differs from the one noted, the snapshot shows `outbox` 0 and `Queued across a deploy` present, and the button reads "Account" again.

Why one reload is enough: `public/sw.js` answers navigations network-first (`fetch(request)`, falling back to the cached shell only when the network fails). So the reload gets the new `index.html` from the server, which names new hashed bundles. Those URLs are not in the cache, so the cache-first asset branch fetches them from the network too. The service worker itself does not need to update.

Undo the simulation: set `PROTOCOL_VERSION` back to `1`, `git diff shared/protocol.ts` must print nothing, `npm run build`, restart `wrangler dev`, reload tab A once.

- [ ] **Step 9: CSP report-only, locally**

In tab A, `read_console_messages` with pattern `Content Security Policy`, covering the whole session from Step 1.
Expected: no messages. If there are any, stop: read each one, fix the cause (never widen the policy with `'unsafe-inline'`), and re-run Task 17's tests.

Stop both servers. Clean up the test data you may keep: the two e2e users stay on the Neon `dev` branch for the next run.

- [ ] **Step 10: Collect the numbers**

Run each and keep the output:

```bash
npm run test:run 2>&1 | tail -5
npm run check 2>&1 | tail -3
npm run build 2>&1 | tail -15
grep -rlE 'from "(better-auth|drizzle-orm|pg|zod)["/]' src shared || echo "no server-only imports"
```

The last line must print `no server-only imports`; it backs the record's "Server-only packages are not in the bundle". From them take: the test count and file count, the Biome file count, the JS and CSS sizes with their gzip sizes, and the bundle gate's line (its measured gzip size against its budget). From `.superpowers/r2-measurements.md` take the three write times from Task 15 Step 17. Run `date +"%Y-%m-%d %A"` for the record's date.

- [ ] **Step 11: The verification record in the spec**

Append to `docs/superpowers/specs/2026-09-29-ignite-accounts-sync-design.md`, after the last line, with the numbers from Step 10 in place of the bracketed names:

```markdown

---

## Verification record

Measured on the date in the heading line below, against `wrangler dev` and the Neon `dev` branch.

- **R2, bundle:** the gate measured [gzip JS] kB of JS against a budget of [budget] kB (baseline on `main`: `BASELINE_BYTES` in `scripts/bundle-size.mjs`). Server-only packages are not in the bundle.
- **R2, a local write:** [before] ms before the wrapper, [local] ms through it in local mode, [account] ms in account mode (median of 5 runs of 100 writes, [browser]).
- **Two devices** (two origins in one browser, separate storage and cookies): an edit arrives on the other device; both offline, the later edit wins per row; an edit after a delete brings the task back, a delete after an edit removes it; sign-out wipes the device and not the account; all three first-sign-in rows; a deploy with a tab open answers 426, and one reload resumes syncing with the queued edit intact.
- **CSP:** no violations in report-only mode across the whole session.
- **Not verified by me, owed to a real device:** see the list in the plan's Task 19.
```

Write the date line as `Recorded [date from Step 10].` directly under the heading.

- [ ] **Step 12: README**

In `README.md`:

Replace the intro sentence `An ADHD-friendly task app: capture a thought in one line, decide where it belongs later. Open source, local-first, no account, no paywall.` with:

```markdown
An ADHD-friendly task app: capture a thought in one line, decide where it belongs later. Open source, local-first, no account needed, no paywall.
```

Replace the `**Status:**` line with (test count from Step 10, the live address from Task 11):

```markdown
**Status:** Shipped, with versioned [releases](https://github.com/malinfossum/ignite/releases/latest): [N] tests passing. **Live:** [the live address, without https://](the live address)
```

In `## Features`, add after the **Install & offline** bullet:

```markdown
- **Sync, if you want it:** sign in and your tasks follow you between devices. Every change is saved on the device first, so the app never waits for the network. Without an account nothing leaves the device. Sign-up is limited to an allowlist for now.
```

Replace the whole `## Tech` section with:

```markdown
## Tech

Vanilla HTML, CSS and JavaScript for the app, in strict MVC with a `subscribe/notify` pattern. No frameworks. The sync layer and the server are TypeScript.

- **Build:** Vite
- **Persistence:** IndexedDB (hand-rolled wrapper) with an outbox for changes waiting to sync
- **Offline:** hand-rolled service worker + web app manifest
- **Server:** one Cloudflare Worker that serves the app and the API
- **Accounts:** Better Auth (email and password)
- **Database:** Neon Postgres in Frankfurt, through Cloudflare Hyperdrive, with Drizzle
- **Test:** Vitest + fake-indexeddb ([N] tests)
- **Format / lint:** Biome, and `tsc --noEmit` for the TypeScript
- **Deploy:** Cloudflare Workers via GitHub Actions
```

Replace the whole `## Run locally` section with:

````markdown
## Run locally

```bash
npm install
npm run dev        # the app on http://localhost:5173, in local mode
npm run test:run   # run the tests once (use `npm test` for watch mode)
npm run build      # production build, with the bundle-size gate
npm run check      # Biome lint + format check, and tsc
```

To work on sync as well, run the API next to the dev server. It needs a `.dev.vars` file (never committed) with `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:8787` and `ALLOWED_EMAILS`, and the connection string of a Neon development branch in the `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` environment variable.

```bash
npx wrangler dev   # the Worker and the API on http://localhost:8787
npm run dev        # the app; /api is proxied to the Worker
```

`npx wrangler dev` on its own also serves the last `npm run build`, which is the closest local match to production.
````

In `## Install`, replace the live app link `https://malinfossum.github.io/ignite/` with the live address.

Check `.dev.vars` stays out of git: `git check-ignore -v .dev.vars`.
Expected: a `.gitignore` line. If it prints nothing, add `.dev.vars` to `.gitignore` under `.env.*.local` and include it in the commit below.

- [ ] **Step 13: Regenerate the README screenshot**

The sidebar footer changed (Task 16), so `npm run gen:preview` no longer reproduces the committed image byte for byte. That is expected here and nowhere else.

Run: `npm run gen:preview`
Expected: it writes `docs/desktop_preview.png` and passes its own checks (no scroll, theme control inside the viewport, no clipped title). Read the new image and show it to Malin before committing it. The alt text still describes the Focus view correctly; it names "the area sidebar and theme control", which is still true.

- [ ] **Step 14: Release notes draft**

Write `.superpowers/release/v0.10.0.md` (local, gitignored; the release itself follows the release runbook after merge), with the Step 10 numbers in place of the bracketed names:

```markdown
Ignite can now keep your tasks in an account and carry them between devices. Nothing about using it without an account has changed: every change is still saved on the device first, and the app never waits for the network.

## Sync

Sign in from the new account button at the bottom of the sidebar. A change made offline on one device reaches the other the next time both have been online. Sync runs when the app opens, when you switch back to it, when the connection returns, and two seconds after an edit. If both devices changed the same task, the later change wins.

Signing in on a device that already has tasks asks once whether to add them to your account or replace them. Signing out removes the account's tasks from that device. Sign-up is limited to an allowlist for now.

## A new home

Ignite has moved from GitHub Pages to a Cloudflare Worker at [the live address]. The old address shows a page that links here and removes the old app's offline cache.

## Under the hood

The sync layer and the server are TypeScript. Accounts use Better Auth with a 15-character minimum password, and the data lives in Neon Postgres in Frankfurt. The pages ship a content security policy, and every deploy runs the tests, the type check and a bundle-size gate before it migrates and deploys.

[N] tests pass across [F] files, Biome is clean on [B] files, and the app bundle is [JS] kB of JavaScript ([gzip] kB gzipped).
```

- [ ] **Step 15: Commit and open the PR**

```bash
git add README.md docs/superpowers/specs/2026-09-29-ignite-accounts-sync-design.md
git commit -m "docs: README and verification record for accounts, sync and the Worker"
git add docs/desktop_preview.png
git commit -m "docs: regenerate the desktop preview with the account button"
```

Push the branch and open the PR. Stop here: Malin merges.

- [ ] **Step 16: After the first deploy: the live checks, then enforce the CSP**

After `Deploy` is green (Task 18 Step 8), open the live address in the Browser pane, signed out. Load the page, cycle the theme, capture a task, open and close the account dialog without typing in it. The pane stays signed out for the whole step.

Run: `curl -sI <the live address> | grep -iE "content-security|strict-transport|nosniff|referrer-policy|permissions-policy"` and `read_console_messages` with pattern `Content Security Policy`.
Expected: five lines (this also covers Task 17 Step 7 if it was skipped locally), the CSP one named `Content-Security-Policy-Report-Only`, and there are no messages.

Only then do I create my account, in my own browser and not in the Browser pane: I open the live address there, tick "Create an account" and sign up, because Task 11 deleted the measurement account. My real password never goes into the Claude-driven pane, because everything typed or read there passes through Anthropic's tooling. No pane step runs after my sign-up, and the pane never signs in to my account. I make one edit in my own browser and sign out there if I want.

Then, on a new branch, in `scripts/headers.mjs` set `export const CSP_REPORT_ONLY = false;` and run `npx vitest run tests/unit/headers.test.js && npm run build && grep -c "^  Content-Security-Policy:" dist/_headers`.
Expected: PASS and `1`.

```bash
git add scripts/headers.mjs
git commit -m "feat(security): enforce the content security policy"
```

Open that PR for Malin to merge. After it deploys, Claude repeats the `curl -sI` header check (from the shell, not the pane): the header is now `Content-Security-Policy`. The console check is Malin's, in her own browser where she is signed in: she reloads the live address with DevTools open and reports whether the console shows any `Content Security Policy` message. Expected: none. Then Malin runs `Retire GitHub Pages` (Task 18), but only after she has confirmed the per-device copy check in Task 18's list (item 5) for every device.

- [ ] **Step 17: Owed to Malin, plainly**

These are not verified and only Malin can verify them. Say so in the PR body, and do not substitute a resized viewport for any of them:

1. **A real phone:** the dialog as a bottom sheet with the on-screen keyboard open, the 44px targets under a thumb, and an installed PWA picking up the new version after a deploy.
2. **Password managers:** that my password manager offers to save on "Create account" and fills on "Sign in" (the `autocomplete` values are set; the behaviour is the manager's).
3. **Real keys:** a real Tab through the footer and every dialog step, a real Enter submitting the form, a real Escape. Every check above used synthetic events, because the pane's CDP input sends no native key default actions.
4. **A screen reader:** that "Signed in", "Signed out" and "Sign in again to sync" are spoken once from `#sync-announcer`, and that the button's name changes with its state.
5. **A second real device** signed into my real account on the live site, including the first-sign-in question with my own data. My real tasks live in the dev origin (`localhost:5173`); moving them into the account is my call.
6. **Settings only I can change:** the secrets and variable in Task 18, running the retire workflow, and turning Pages off afterwards.

---

## Stress test: considered and rejected

- **A moved page that reads the old origin's IndexedDB and lists its tasks.** I am the only user and only test data lives at the old address, so Task 18 has me check each device by hand before Retire runs.
- **A live check that Hyperdrive serves fresh reads.** Caching is off in the config (`hyperdrive get` in Task 0 shows it), and a push-then-pull freshness test would only re-test Cloudflare.
- **A test that triggers Better Auth's 429.** The limiter is Better Auth's own code. The plan pins its config (`customRules`) and the client maps 429 by status.
- **A check that paste works in the sign-in form.** Nothing in the dialog blocks paste, so there is no behaviour to test.
- **`lock_timeout` for a push killed while it holds the advisory lock.** It depends on how Hyperdrive cleans up a dropped connection, which is unverified. Worth one question when Task 9 runs, not a plan change.
- **A retried push after a clamped fast clock beating an edit made in between.** This follows from the locked last-write-wins rule (spec D7).

> Stress-tested 2026-10-07 (skill 81b73ff): 21 applied, 2 adapted, 0 decided by me.
