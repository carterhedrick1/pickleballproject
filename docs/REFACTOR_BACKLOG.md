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

- **Explicit migrations instead of runtime schema creation** (was P2 item 4) - done
  2026-08-20. `database/migrations/` holds the ordered list (`001-baseline-schema`,
  `002-game-version`); `database/migration-runner.js` runs whatever is not yet recorded in
  `schema_migrations`, one transaction per migration, and refuses a list with duplicate or
  out-of-order ids. It takes a connection rather than reaching for the app's own, which is
  what lets the tests migrate throwaway databases. PostgreSQL runs hold a session advisory
  lock so two Render instances cannot migrate at once; SQLite uses BEGIN IMMEDIATE for the
  same reason. `database/schema.js` is now three named stages (migrate, reference seeds,
  message seeds) and `database/seeds.js` owns the seed courts, the retired-court repair and
  `locationKey`/`isRetiredLocation`. Conditional column adds ask the catalog
  (`addColumnIfMissing`) instead of catching "already exists" strings, which differ per
  engine. Verified: a fresh database, a rerun, a database built from the pre-migration DDL,
  a copy of the real 87-game local SQLite file, and - on real PostgreSQL 16 - a replica of
  production's schema with rows in it (`test-pg/production-upgrade.test.js`). A schema diff
  against live production confirmed the migrations reproduce production exactly, the only
  differences being the two intended additions.

- **Database-backed concurrency for game writes** (was P2 item 6) - done 2026-08-20.
  `games.version` is a compare-and-swap token: `getGame` tags the game with the version it
  was read at, and `saveGame` only writes when the stored version still matches, so no
  call site had to change to become safe. `updateGame(gameId, apply)` adds the retry loop -
  on a conflict it re-reads and re-applies - and `services/player-service.js` runs every
  roster transition through it, so a signup that races another signup is re-decided against
  the newer roster rather than overwriting it. `database/dev-rosters.js` bulk edits move the
  version too. A refused write reaches a person as 409 with "This game just changed
  somewhere else", never a 500 (`utils/route-error.js`). Proof:
  `test/game-version-concurrency.test.js` (7 cases, deliberately bypassing the in-memory
  lock) and the same expectations on PostgreSQL in `test/support/persistence-cases.js`.
  Deliberately NOT done: the `game_participants` index table. The phone-based scans are
  still fine at dozens of games, and it is a separate change with its own migration - see
  the note left under item 5 below.

- **PostgreSQL parity testing** (was P2 item 5) - done 2026-08-20. `npm run test:pg` runs
  `test-pg/` against a disposable database named in `TEST_DATABASE_URL`; `npm test` and the
  deployment gate do not know it exists. `scripts/run-postgres-tests.js` refuses a URL that
  matches any other `*DATABASE_URL` in the environment (production included) or whose
  database name does not look disposable, and prints the target before running.
  `test/support/persistence-cases.js` holds the shared expectations - JSON round-trips,
  BYTEA/BLOB photos, the delete transaction, reminder_log's primary key, and the whole
  compare-and-swap story - and both `test/persistence-parity.test.js` (SQLite, in the gate)
  and `test-pg/persistence-parity.test.js` run them. Verified against real PostgreSQL 16:
  12 cases green. It immediately earned its keep - `database/context.js` forced
  `ssl: rejectUnauthorized:false` on every connection, which Render needs and a local
  PostgreSQL refuses outright; SSL is now chosen from the URL (explicit `sslmode` wins, then
  loopback means no TLS, everything else keeps it).

## P2. Persistence and concurrency

### 5. A `game_participants` index table (carried over)
The SMS webhook still finds a caller's games by scanning every game's JSON in JavaScript
(`services/sms-game-lookup.js`). Fine at dozens of games, wrong at thousands. When it stops
being fine: add an incremental index table as migration `003`, keep it in step inside
`saveGame`'s compare-and-swap write, and move the lookups to SQL. Both engines now have a
migration path for it, and the parity suite is where the SQL would be proven.

- **Decompose `services/sms-webhook.js`** (was P3 item 7) - done 2026-08-20 for the
  structural part. `services/sms-command-parser.js` classifies replies (unit-tested,
  including the any-number-answers-a-pending-list rule), `services/sms-game-lookup.js`
  owns the phone-to-game scans, `services/sms-composer.js` builds the reply texts, and
  sms-webhook.js keeps only dispatch, handlers, and organizer notifications (~720 lines
  from ~960). Deliberately NOT done: SQL-side `find*GamesForPhone` repository queries -
  the JS scans are fine at dozens of games and SQL-side JSON queries belong with the
  persistence work (P2), where a `game_participants` index table would serve both.

## P3. Service decomposition

- **Finish compatibility-facade migrations** (was P3 item 8) - done 2026-08-20.
  `database.js`, `sms-handler.js` and `game-logic.js` are deleted. Every caller now names the
  module it actually wants. Requiring the old facade pulled 15 files under `database/` into
  whatever loaded it; the same modules now load what they use and nothing else -
  `utils/route-error.js` 2, `utils/host-auth.js` 2, `services/host-roster.js` 3,
  `services/sms-client.js` 0 (its one read is a lazy require inside the send path).
  Three things were more than a rename:
  - `game-logic.js` was not only a facade. `createGameData` moved to
    `domain/game-factory.js` and `validatePlayerData` to `domain/player-validation.js`,
    beside the join rules they belong with. `isValidPhoneNumber` was a one-line alias for
    `isValidUsPhone` in `utils/sms-format.js`, so callers use that directly, and
    `checkExistingPlayer`/`addPlayerToGame`/`removePlayerFromGame` were dead wrappers over
    `domain/player-transitions.js` with no caller anywhere - deleted rather than rehomed.
  - The reminder SMS stub seam moved. `services/reminders.js` holds the `services/sms-client`
    module object and resolves `sendSMS` at call time, so `test/reminder-idempotency.test.js`
    and the four `verify/reminder-*.js` rigs replace it there instead of on the old facade.
    That seam is the only reason a reminder run never reaches Textbelt; keep it a module
    property, never a destructured import.
  - The message-randomizer stack injects a `database` object (`resolveRandomizedMessage`,
    `generateFreshMessages`, `queuePoolRefill`, `buildRandomizedInvitation`). Its default is
    now `database/message-randomizer` specifically. The three reads that were not randomizer
    rows were pulled out of the injected object: generation status is a dev asset
    (`getGenerationStatus`/`saveGenerationStatus` lost their `database` first parameter and
    call `database/dev` directly), and the routes read the master roster and a game from
    `database/dev-rosters` and `database/games`.

  Verified: 325 tests, 103 browser-smoke assertions, and all four reminder rigs plus the
  roster rig green. Noticed while running the gate and left alone deliberately:
  `recordSelection` in `database/message-randomizer.js` opens `BEGIN IMMEDIATE` on the shared
  SQLite connection, so two concurrent signups log "Message Randomizer fallback for youre-in:
  cannot start a transaction within a transaction" and fall back to the legacy text. It
  predates this work and belongs to item 9 below, which owns that file.

  One stale reference left on purpose: the copy deck `scripts/extract-copy.js` generates still
  tells the reader the app's running copy lives in "public/js/ and sms-handler.js". Correcting
  it changes a generated page, so it wants a `--visible` completion, which needs DEV_PASSWORD
  set on Render first. Fold it into the next visible change that regenerates the docs.

- **Split `database/message-randomizer.js`** (was P3 item 9) - done 2026-08-20. The 1,460-line
  file is gone, replaced by seven modules that each do one thing: `message-rows.js` (the row
  mappers and `normalizeMessageText`, pure functions with no connection), `message-personalities.js`
  (personalities, surface settings, Codex prompts), `message-inventory.js` (the message pool),
  `message-target-rules.js`, `message-selection.js` (history, `recordSelection`, metrics),
  `message-seeds.js` (the boot-time seeding, migration and repairs) and `realist-seed-copy.js`
  (the shipped Realist copy, kept apart because it changes for editorial reasons).

  Why the seeds are not migration `003`: every step in `message-seeds.js` already records that
  it ran by writing a marker into `dev_assets`, and those markers exist in production today.
  Moving them into the ordered list would make `schema_migrations` the record of "has this
  run", so every database already carrying a dev_asset marker would seed a second time. The
  ordered list stays for schema; content seeding keeps its own markers, and `database/schema.js`
  still calls it as the named message-seeds stage.

  Proof that selection and seeding behaviour did not move: a fresh boot on SQLite produces a
  byte-identical database before and after (personalities, surface settings, all message rows,
  and every dev_asset marker with timestamps stripped), the same comparison is identical on
  real PostgreSQL 16, and booting the new code against a database the old code seeded changes
  nothing on either engine - the markers still short-circuit. Plus 325 tests, 103 browser-smoke
  assertions, `npm run test:pg` 12/12, and the five reminder/roster rigs.

  One correction worth recording: the injected `database` parameter on `resolveRandomizedMessage`,
  `generateFreshMessages`, `queuePoolRefill` and `saveCodexPromptUpdate` looks unused but is
  not - four unit tests pass a fake through it (as a shorthand `database,` property, which is
  easy to miss when grepping for `database:`). It is kept, and each service now builds its
  default from the specific repositories it needs (`MESSAGE_STORE` in
  `services/message-randomizer.js` and `services/message-generation.js`, `CODEX_PROMPT_STORE`
  in `routes/message-randomizer.js`). Those objects list their functions by hand on purpose:
  they are test seams scoped to one service, not a persistence facade.

## P4. Validation and time handling

- **Centralized request validation** (was P4 item 10) - done 2026-08-21.
  `utils/request-validation.js` holds the primitives (`requiredText`, `calendarDate`,
  `clockTime`, `wholeNumber`, `choice`, `list`, `objectBody`, `usPhone`) and one
  `ValidationError`; `utils/route-error.js` recognises its code and answers 400 with the
  validator's own sentence, so a rule can throw from anywhere a route already catches.
  `domain/game-validation.js` builds the create and edit shapes from those primitives and
  sits in front of `domain/game-factory.js` and `utils/game-update.js`, neither of which
  changed - they are simply no longer the first thing to see the request.
  `domain/player-validation.js` throws instead of returning, which is what made the host's
  manual-add route stop answering a missing name with a 500.

  Bounds are deliberately wider than the forms allow (duration 15-1440 against a form
  minimum of 30, up to 100 players against a form maximum of 50), so a host filling the form
  in normally cannot meet one. Existing wording is preserved everywhere a page can actually
  reach it: the organizer phone sentence, "Player name is required.", "Message is required",
  "At least one recipient is required", "A 10-digit phone number is required.".
  `isValidUsPhone` stayed the one phone rule - `usPhone` only adds wording and formatting -
  and the developer roster editors, which spelled their own `formatPhoneNumber(x).length !==
  10` version of it, now call it too.

  Three things it fixed rather than tidied: the manual-add 500 above; `POST /api/games`
  only checking `hostPhone || organizerPhone`, so a valid hostPhone let a broken
  organizerPhone through and stored it; and the court-image routes calling
  `decodeURIComponent` on a path parameter Express had already decoded, which turned a court
  named "50% Off Courts" into a URIError and a 500. Deliberately NOT narrowed: `action` on
  the signup route and `addTo` on the manual-add route. Both are two-way switches whose
  callers have sent 'in', 'join', null, 'add' and 'confirmed' over the years, and the HTTP
  tests caught the attempt.

  Proof: `test/request-validation.test.js` (20), `test/game-validation.test.js` (16) and
  `test/app-http-validation.test.js` (25 over real HTTP), plus the existing 325 - 386 green.
  Also `verify/all-routes.js` (42 routes, no 500s), `verify/user-flow.js`,
  `verify/signup-eligibility.js` and `verify/roster-locations.js` against a worktree server.

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
multi-server scenarios), and the PostgreSQL parity suite (`npm run test:pg`), which needs a
disposable database the gate cannot assume exists. Run it before shipping anything that
touches persistence. PostgreSQL 16 is installed on Scott's Mac now (Homebrew, no login item -
start it by hand; the socket directory has to be short, so `-k /tmp/pgs5433`).

Known flake, stopped 2026-08-21. It was measured at one run in four on 2026-08-20 and had
grown worse: `main` failed 2 runs in 4, in two different race files, always
`SQLITE_BUSY: database is locked`. `npm test` now passes `--test-concurrency=1`, so the test
*files* no longer run at once and cannot contend on the shared local SQLite file. Nothing was
lost by it - every race the app actually cares about is raced inside one file with
`Promise.all`, which still runs concurrently - and it costs 3.6 seconds (0.9s to 4.5s). This
is a stopgap, not item 14's fix: the fixtures are still not hermetic, and giving each file its
own database would let the files run in parallel again. Measured after the change: 5 runs of
386 tests, 0 failures.

Also fixed 2026-08-21, and it had taken the whole gate down: `scripts/refactor-browser-smoke.js`
and `scripts/capture-screens.js` signed in to the developer area with
`process.env.DEV_PASSWORD || 'vibe123'`, but neither loads dotenv, while the throwaway server
they spawn does. The day a real `DEV_PASSWORD` was added to the local `.env` the two stopped
agreeing and every developer-area assertion and screenshot failed on a password mismatch -
`npm run verify:frontend` and `npm run docs` both. `scripts/lib/local-server.js` now pins a
`DEV_PASSWORD` for the throwaway server and exports it for the scripts to use, so they agree
with each other and no longer depend on what a developer keeps in `.env`. The real local
server on 3002 and production still read `DEV_PASSWORD` as before.

The original verify rigs remain for interactive debugging;
`verify/user-flow.js` now derives its game date and its idempotency key instead of
hardcoding them, so it neither expires nor blocks its own second run.

### 16. sqlite3 6.x major upgrade
The 7 remaining `npm audit --omit=dev` advisories (1 critical) are all in sqlite3 5.x's
install-time toolchain (node-gyp → tar/cacache); nothing in that chain runs while the app
serves traffic, and production uses PostgreSQL. Upgrading to sqlite3@6 clears them but is
a native-module major bump: take it as its own task, run the full gate plus the race and
reminder rigs on macOS, and check Render's build still works.
