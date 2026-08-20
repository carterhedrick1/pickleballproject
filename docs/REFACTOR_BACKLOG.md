# Refactor and Hardening Backlog

Written 2026-08-20, after the Priority 0 security pass (webhook signatures, signup
eligibility, config validation, dependency updates) shipped. These are the audit findings
that were verified against the code but deliberately deferred, in priority order. Each
item is scoped so one future task worktree can take it alone.

## How to use this list

Every item was re-verified on 2026-08-20; if much time has passed, re-check the named
files before starting. Work top to bottom unless something breaks in production first.

## P1. Architecture and testability

### 1. Separate Express app construction from process startup
`server.js` still starts listening, starts reminder timers, and opens the database as a
side effect of being imported (`app.listen` at the bottom, `setInterval` for reminders,
`reminders.resetReminderState()` inside `game-logic.js` at require time). Split into
`createApp(deps)` / `startServer()` / `startSchedulers()` / `shutdown()`. This unlocks real
HTTP integration tests (today the webhook and eligibility tests over HTTP live in
`verify/webhook-auth.js` and `verify/signup-eligibility.js`, which need a hand-started
server). Preserve `npm start` behavior exactly.

### 2. Standardize host authentication transport
Host tokens ride in query strings (`manage.html?id=...&token=...`, `?token=` on many API
GETs) and the global logger in `server.js` prints `req.url`, so tokens can land in logs
and browser history. Move to: bootstrap from the management link once, strip the token
from the URL bar via `history.replaceState`, send `Authorization: Bearer` afterwards,
keep old links working during a transition, and never log token-bearing URLs. Central
helper already exists (`utils/host-auth.js`) - extend it rather than adding a parallel
mechanism.

### 3. Structured, redacted logging
The request logger prints full URLs; several paths still print full phone numbers and
request bodies (`[SMS DEBUG]` lines in `services/sms-webhook.js`, game-creation logging in
`routes/games.js`, reminder debug output). The webhook entry log now masks to last-4 -
apply the same standard everywhere via a small logging helper with consistent fields
(gameId, eventId, status) and a DEBUG gate. The 500 handler already returns a generic
message; keep it that way.

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
`verify:deploy` is unit tests + frontend smoke. The security rigs added in the P0 pass
(`verify:webhook-auth`, `verify:signup-eligibility`) and the existing race/SMS/reminder
rigs run only by hand. Once P1 item 1 lands, convert the important ones into fast
integration tests inside `npm test`: authorization boundaries, webhook signature
rejection, closed-signup rejection, concurrent mutations, reminder idempotency.

### 16. sqlite3 6.x major upgrade
The 7 remaining `npm audit --omit=dev` advisories (1 critical) are all in sqlite3 5.x's
install-time toolchain (node-gyp → tar/cacache); nothing in that chain runs while the app
serves traffic, and production uses PostgreSQL. Upgrading to sqlite3@6 clears them but is
a native-module major bump: take it as its own task, run the full gate plus the race and
reminder rigs on macOS, and check Render's build still works.
