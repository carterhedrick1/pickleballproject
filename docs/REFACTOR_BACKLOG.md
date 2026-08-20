# Refactor and Hardening Backlog

Written 2026-08-20, after the Priority 0 security pass (webhook signatures, signup
eligibility, config validation, dependency updates) shipped. These are the audit findings
that were verified against the code but deliberately deferred, in priority order. Each
item is scoped so one future task worktree can take it alone.

## How to use this list

Every item was re-verified on 2026-08-20; if much time has passed, re-check the named
files before starting. Work top to bottom unless something breaks in production first.

## Completed since the list was written

- **Separate app construction from process startup** (was P1 item 1) - done 2026-08-20.
  `app.js` exports `createApp(options)`; `server.js` is startup-only
  (`startServer`/`startSchedulers`/`stopSchedulers`/`shutdown`, process handlers, and a
  `require.main` guard). `game-logic.js` no longer wipes reminder state at require time;
  `verify/reminder-catchup.js` resets it explicitly. `test/app-http.test.js` now drives
  the real app over HTTP inside `npm test`: webhook signature rejection, 410s for
  cancelled/ended signups, duplicate tagging, and host-token 403s. Note the pg Pool was
  already lazy (no connection until first query); only SQLite's local file-open still
  happens at import, accepted as harmless.

- **Standardize host authentication transport** (was P1 item 2) - done 2026-08-20.
  `requestHostToken` in `utils/host-auth.js` resolves X-Host-Token header, then
  Authorization: Bearer, then the historical body/query transports; every `?token=` route
  site uses it. The manage page captures the link token once, remembers it per game in
  localStorage, strips it from the address bar, and sends X-Host-Token on the calls that
  used query strings. The request logger and error capture redact `token=` values.
  Remaining: body-token POST/PUT calls migrate to the header alongside the shared API
  client in the management-frontend item below; SMS links themselves still carry the
  token by design (they are the key).

- **Redacted logging** (was P1 item 3) - done 2026-08-20 for the personal-data part.
  `maskPhone` in `utils/sms-format.js` is the one allowed log form (`***4567`); every
  phone-bearing log line in `services/sms-client.js`, `services/reminders.js`,
  `services/sms-webhook.js`, `database/messaging-reminders.js`, `routes/games.js` and
  `routes/players.js` uses it, the `[SMS DEBUG]` scan-noise lines are DEBUG-gated, and
  the create/update routes log field names instead of request bodies. Verified by
  driving the SMS cancel rig and grepping the server log for full numbers (zero).
  Deliberately NOT done: a structured logging library/abstraction with consistent
  fields - console lines with stable prefixes are still how this app logs, and swapping
  that wholesale is low-value churn until something consumes structured logs.

## P2. Persistence and concurrency

### 4. Explicit migrations instead of runtime schema creation
`database/schema.js` mixes PostgreSQL and SQLite DDL, conditional ALTERs, cleanup, and
seeds. Introduce an ordered, idempotent migration list with a `schema_migrations` table,
separating schema / reference seeds / message seeds / one-time repairs. Must preserve
production data; test against a fresh DB and a copy of the current production schema.

### 5. PostgreSQL parity testing
The unit suite is SQLite-only while production is PostgreSQL. Add an opt-in integration
path (disposable database or container) for persistence, transactions, JSON handling and
constraints. Do not make `npm test` depend on it.

### 6. Database-backed concurrency for game writes
`saveGame` rewrites the whole game JSON blob and the in-memory lock
(`utils/game-lock.js`) only protects one process. Before the app can ever run two
instances, add optimistic concurrency (a `version` column with compare-and-swap) or
row-level locking in PostgreSQL. Add a concurrency test proving overlapping mutations
cannot lose roster changes. Consider an incremental `game_participants` index table for
the phone-based scans the SMS webhook does today.

## P3. Service decomposition

### 7. Decompose `services/sms-webhook.js` (~960 lines)
Transport is now separated (`utils/textbelt-webhook.js`), but the file still combines
command parsing, conversation state, full-table game scans, roster transitions, message
composition and delivery. Extract a command parser, per-command handlers (1/2/9/custom),
and targeted repository queries (`findUpcomingGamesForPhone`, `findHostedGamesForPhone`,
`findCancellableGamesForPhone`) to replace the getAllGames + per-game host-info scans.

### 8. Finish compatibility-facade migrations
`database.js`, `sms-handler.js`, and `game-logic.js` are transitional facades; every
module that loads one loads the whole persistence layer. Move callers to the specific
repositories/services, then delete the facades. (`game-logic.js` also still triggers
`resetReminderState()` on require - see P1 item 1.)

### 9. Split `database/message-randomizer.js`
Row mapping, CRUD, metrics, selection history, seeds, migrations, repairs and legacy sync
in one file. Split into repositories plus migration/seed modules without changing
selection behavior.

## P4. Validation and time handling

### 10. Centralized request validation
Add shared validators for game creation/updates, player identity, invitations,
announcements, media metadata and dev configuration at the HTTP boundary: dates, times,
durations, capacity bounds, registration modes, string/array shapes, phone numbers
(`isValidUsPhone` in `utils/sms-format.js` is the phone rule). Consistent 400s for caller
errors.

### 11. One canonical Central Time model
Four time implementations still exist: `utils/central-time.js` (shifted-central model, now
also the signup cutoff via `hasGameEnded`), manual DST offset math in
`public/js/game-utils.js`, browser-local `getTimeUntilGame`, and assorted `new Date()`
parsing. Replace with one well-tested module (or server-provided canonical status
timestamps) covering upcoming/started/ended/recently-finished/reminder windows, with
CST/CDT transition tests. Until then, keep server and browser cutoffs matched by hand.

## P5. Frontend decomposition

### 12. Modularize the management frontend
`public/js/manage-scripts.js` and friends rely on global load order and 100+ top-level
functions. Introduce native ES modules, a shared API client (which is also where the
Authorization-header change in P1 item 2 lands), a state container, per-tab controllers,
and safe DOM helpers. Remove stale comments like "NEW ENDPOINT" while touching each area.
No visible UI change.

### 13. Split `public/dev.html` (~3,850 lines)
Extract the ~835 inline CSS lines and ~1,600 inline JS lines into files per tab (auth,
notes, messaging editors, rosters, images, errors) plus shared API/render helpers. Avoid
`innerHTML` interpolation; keep the visible behavior identical.

## P6. Quality gates

### 14. Make the browser smoke fixtures hermetic
Diagnosed 2026-08-20: the old combined dev-area assertion failed because its "22 You're
IN messages" pin captured a count that included a since-deleted DUPR message, and the
smoke kept passing only while the primary database's saved `youre-in-config` still held
the old list. The assertion is now split into focused asserts and the count pin follows
`DEFAULT_MESSAGES.length`, but a saved `youre-in-config` in the local database still
shadows the defaults. The real fix: have the smoke seed/reset the dev assets it asserts
about (extend `scripts/lib/fixtures.js`) so no mutable dashboard data can change the
outcome.

### 15. Expand the default deployment gate
Mostly done 2026-08-20. Inside `npm test` on every deploy: webhook signature rejection,
closed-signup rejection, host-token authorization boundaries (`test/app-http.test.js`),
concurrent signup/capacity/mixed races and the signed reply-9 cancellation flow
(`test/app-http-races.test.js`), and reminder idempotency across a simulated restart
(`test/reminder-idempotency.test.js`). The local SQLite connection now sets a 5s busy
timeout so parallel test workers and rigs sharing the file wait instead of failing.
Still hand-run: the promotion-modes rig and the SMS-failure UI rigs (both slower,
multi-server scenarios), and PostgreSQL persistence parity, which is its own item 5.
The original verify rigs remain for interactive debugging.

### 16. sqlite3 6.x major upgrade
The 7 remaining `npm audit --omit=dev` advisories (1 critical) are all in sqlite3 5.x's
install-time toolchain (node-gyp → tar/cacache); nothing in that chain runs while the app
serves traffic, and production uses PostgreSQL. Upgrading to sqlite3@6 clears them but is
a native-module major bump: take it as its own task, run the full gate plus the race and
reminder rigs on macOS, and check Render's build still works.
