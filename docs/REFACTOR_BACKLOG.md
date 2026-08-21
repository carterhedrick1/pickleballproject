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

- **One canonical Central Time model** (was P4 item 11) - done 2026-08-21.
  `public/js/central-time.js` is the only implementation, loaded by the pages as
  `window.CentralTime` and required by the server the way `player-capacity.js` and
  `invite-status.js` already were. `utils/central-time.js` and `public/js/game-utils.js` are
  deleted. It exports the conversion (`wallClockToInstant`, `centralOffsetMs`,
  `centralWallClock`, `centralDateKey`), the windows (`isGameUpcoming`, `hasGameStarted`,
  `hasGameEnded`, `isGameRecentlyFinished`, `gameStart`, `gameEnd`) and what the pages ask for
  (`getGameStatus`, `getTimeUntilGame`).

  There were five implementations, not four. The fifth - `utils/calendar-invite.js` - was the
  only correct one, and it is the one kept: it asks `Intl.DateTimeFormat` what offset
  America/Chicago really had at that instant, then converts in two passes so the hour a clock
  moves lands on the right side. Nothing does offset arithmetic by hand any more, so the next
  change to the DST rules arrives with the platform's timezone data instead of a patch.
  calendar-invite.js now imports it under its old local name.

  Three bugs fell out of the merge rather than being hunted for:
  - A game ending after midnight never expired. The browser built its end time by adding the
    duration to the start hour, so 23:00 + 120 minutes became the string "25:00:00", which
    parses as Invalid Date, which the code read as "not expired". The signup form stayed open
    on it for ever.
  - The countdown was built in the *browser's* timezone, so a player in New York was told a
    game was an hour further away than it was.
  - `new Date(game.date)` in the two host-lookup routes read a bare YYYY-MM-DD as UTC
    midnight - up to six hours from when the game was scheduled - and decided the 7-day and
    30-day windows on it. Those now start from the same Central wall clock as everything else,
    and the sorts order by the moment a game starts, so two games on one day come back in the
    order they are played.

  The signup cutoff no longer needs matching by hand: `domain/join-policy.js` and the game page
  call the same `hasGameEnded`. `services/reminders.js` compares real instants on both sides
  instead of a "now" shifted into Central against a naive parse of the game's wall clock, and
  names today and tomorrow with `centralDateKey`.

  Proof: `test/central-time.test.js` (22 cases, every "now" written in UTC so the fixture means
  the same thing in any timezone) covers both clock changes in 2026 - the 02:00-03:00 gap on
  2026-03-08 and the repeated 01:30 on 2026-11-01 - plus the midnight-crossing game and the
  countdown. `test/join-policy.test.js` measures a game running through the spring-forward gap
  in real hours. 399 tests, 103 browser-smoke assertions, all four reminder rigs, the
  signup-eligibility rig (the cutoff itself), user-flow, all-routes and stats.

  Folded in while the docs were being regenerated: the copy deck and `docs/README.md` both told
  the reader the app's running copy lives in "public/js/ and sms-handler.js", a file deleted two
  tasks ago.

## P5. Frontend decomposition

- **Modularize the management frontend** (was P5 item 12) - done 2026-08-21.
  `public/js/manage/` holds the page now: `main.js` (the one entry point and the only start-up
  sequence), `state.js`, `api.js`, `dom.js`, `render.js`, and one module per tab - `game.js`,
  `players.js`, `communications.js`, `media.js`. manage.html loads a single
  `<script type="module">` where it used to load five script tags whose order silently
  mattered.

  The three shared values (`gameData`, `gameId`, `hostToken`) turned out to be assigned in
  exactly one file and only read in the others, so they became live-binding exports from
  `state.js` and no reading call site had to change - 170 references, none of them renamed.

  **The Authorization-header half of P1 item 2 is finished.** `api.js` is the only place that
  knows how to prove host-ness, and it sends `X-Host-Token`. Ten routes read `req.body.token`
  directly and now read `requestHostToken`, which still accepts the body and query forms - the
  SMS management links carry the token by design and a page cached in somebody's browser still
  posts it in the body. `test/app-http-host-token.test.js` drives every host route with the
  header, checks each still refuses a stranger holding one, and pins the body and query forms
  so the compatibility cannot be dropped by accident.

  Deleted rather than moved: `updateGame` (a stub whose body was `// ... rest of your update
  logic ...`), `loadGameDetails` (no caller), and a DOMContentLoaded block that unchecked every
  checkbox on the page 200ms after load.

  Two things worth knowing for the next frontend task:
  - The cross-file coupling was easy to under-count. Functions passed to `addEventListener` by
    name - `addEventListener('click', addPlayersFromRoster)` - do not look like calls, so a
    scan for `name(` missed four of them and boot died silently at `setupEventListeners`. The
    check that found them is a scan for *any* reference to a name another module owns.
  - The browser smoke called `hostAuthHeaders()` in page context, a page internal that only
    existed because the page ran on globals. It uses `ManageApp.state.hostToken` now.
    `window.ManageApp` is still assembled - in `main.js` rather than in four files - because
    the smoke drives the roster and recipient list through it.

  Not done, deliberately: the shared page libraries (`page-utils`, `central-time`,
  `invite-status`, `player-capacity`, `invitation-generator`, `host-verification`) are still
  classic scripts on `window`. They are loaded by every other page too, so converting them is
  its own task; classic scripts run before any module, so the modules read them safely.

  Proof: 421 tests, 103 browser-smoke assertions, all-routes (42 routes, no 500s), user-flow
  and roster rigs. Also fixed while chasing a false failure: `test/app-http-validation.test.js`
  and the new host-token test now cancel and delete their fixture games. They were accumulating
  in the shared local SQLite file and adding courts to the create page's picker, which is the
  same class of problem as item 14 below.

- **Split `public/dev.html`** (was P5 item 13) - done 2026-08-21. 3,853 lines down to 1,403 of
  markup. The 835 lines of CSS are `public/css/dev.css`, unchanged and in the same order, so
  the cascade is identical. The 1,617 lines of script are `public/js/dev/`: `main.js`,
  `shared.js` (el, escapeHtml, timeAgo, formatUptime and the two tab lists), `api.js`, and one
  module per tab - `auth`, `tabs`, `status`, `ideas`, `slogans`, `reply-options`,
  `text-messages`, `rosters`, `errors`, `images`. dev.html loads one module.

  `api.js` holds the two shapes every tab wrote out longhand: sending JSON (nine call sites,
  each having to remember the Content-Type header) and what a 401 means here (seven copies of
  "hide the dashboard, show the sign-in screen" - the cookie lasts thirty days, so any loader
  can be the one that finds it expired). `message-randomizer-admin.js` stays a classic script:
  it is a self-contained IIFE with its own helpers, and the dashboard only ever calls
  `window.MessageRandomizerAdmin.load()`.

  **The `innerHTML` interpolation was audited rather than removed.** Every interpolated value
  in the remaining templates is one of: passed through `escapeHtml`, a number, an
  `encodeURIComponent` result, or a server-side constant - `command` comes from
  `CUSTOM_COMMANDS` in sms-reply-options.js, which the server rejects anything outside of, and
  the one bare `${message}` in status.js was escaped a line earlier. So there is no escaping
  gap to fix, and rewriting forty template blocks into DOM building on Scott's operational
  dashboard would be risk without a bug behind it. Worth doing next time a tab is opened up for
  another reason; the audit is what makes that a choice rather than an unknown.

  Lesson worth keeping, because it cost three rounds: **do not bulk-edit this code with
  regular expressions.** A DOTALL non-greedy `fetch(...)` pattern matched across statement
  boundaries and rewrote a GET as a JSON send; a follow-up pattern renamed the arguments but
  left the function as `fetch`, so `fetch(url, 'DELETE', {...})` silently did a GET and Delete
  Host stopped working. The browser smoke caught that one. What found the rest was a
  line-by-line diff of each module against the original inline segment, normalizing away the
  edits that were intended - that check belongs in any future split of this kind.

  Two dependency scans were needed, not one. The first stripped template literals before
  looking for cross-module references, which is precisely where this code calls `escapeHtml`,
  so two modules were missing that import and their tabs rendered nothing.

  Proof: 421 tests, 103 browser-smoke assertions (which cover sign-in, slogans, reply options,
  the You're In editor, the roster editors and both delete confirmations), and a scripted
  browser pass over the idea board - the one write path the smoke does not touch - creating a
  note, changing its status through the PUT path, reading both back through the API, and
  deleting it again.

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
