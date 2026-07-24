# Integration checks

These are the scripts that proved the bugs fixed on 2026-07-24 were real, and then
proved the fixes worked. They are deliberately blunt: they hit a running app and
count what actually survived, rather than reasoning about correctness on paper.

**None of these ever send a real text.** Three rules make that true, and all of them matter:

- Test players are created **without phone numbers**. `sendSMS` is only called when a
  phone is present, so no phone means no send.
- `sms-cancel.js` needs players who *do* have phone numbers, so it must be run against
  a server started with `TEXTBELT_API_KEY=""`. In that mode `sendSMS` logs
  `[DEV MODE] SMS would be sent to ...` and returns success without calling Textbelt.
- The two `sms-failure` scripts need sends that *fail*, so they run against a server started
  with `SMS_SIMULATE_FAILURE=1`. That check sits at the very top of `sendSMS` and returns a
  failure before a Textbelt request is even built. Start that server with `TEXTBELT_API_KEY=""`
  as well: then if the flag is ever forgotten, `sendSMS` falls back to dev mode and still
  contacts nobody, and the script fails loudly instead of quietly texting someone.

If you ever change these, check Textbelt quota before and after:
`https://textbelt.com/quota/<TEXTBELT_API_KEY>`

## Running them

Two need nothing but the repo. The rest need the app running on port 3002.
**Use 3002, not 3001** — port 3001 is a different project on this machine.

```
# No server required (in-process, local SQLite)
npm run verify:reminders
npm run verify:reminder-safety
npm run verify:late-joiner

# Start the app first, in another terminal:
PORT=3002 npm start

npm run verify:app       # whole user journey + the hostToken check
npm run verify:races     # all three concurrency checks

# The SMS flow needs dev-mode SMS, so start the server this way instead:
TEXTBELT_API_KEY="" PORT=3002 node server.js
npm run verify:sms

# The SMS-failure flow needs every send to fail, so start the server this way:
TEXTBELT_API_KEY="" SMS_SIMULATE_FAILURE=1 PORT=3002 node server.js
npm run verify:sms-failure
npm run verify:sms-failure-ui
```

Every script exits non-zero on failure, so they chain with `&&`.

**Two exceptions: `sms-failure.js` and `sms-failure-ui.js` must never be pointed at production.**
Every other script signs players up without phone numbers, which is what makes them safe
anywhere. These two need players who *do* have phone numbers, because they exist to test what
happens when a text fails. Against production that would ask Textbelt to text those numbers for
real, so both scripts refuse to run against anything but localhost.

The rest accept a base URL, so they can be pointed at production once a change is
deployed — which is how these fixes were confirmed live:

```
node verify/signup-race.js https://inorout.club 8
```

Running against production creates a real game and cancels it when finished. That is
safe (no phone numbers means no texts) but it does leave a cancelled game behind.

**Run them one at a time against production, with a pause between.** Rate limiting is on in
production only (30 requests/minute on `/api/games`, 15 new games per 15 minutes) and off
locally, so a burst that is fine locally gets 429s live. A 429 does not mean the app is broken -
but it used to *look* like it did: `mixed-race.js` turned a rate-limited read into "every player
was lost", and crashed before its cleanup step, leaving live test games behind. Both are fixed,
and every script now reports a 429 as a 429.

## What each one covers

| Script | What it proves |
|---|---|
| `user-flow.js` | Pages load, a game can be created, players join, the roster caps, overflow waitlists, "I'm out" works, and the host dashboard opens. Also checks `hostToken` is absent without a token, present with the right one, and 403 on a wrong one. Cancels its own test game. |
| `signup-race.js` | Simultaneous signups all survive. Before the fix this reported 6 accepted but only 2 on the roster. |
| `capacity-race.js` | 10 people rushing a 4-seat game fill it to exactly 4, waitlist 6, lose nobody, and each person's confirmation matches where they actually ended up. |
| `mixed-race.js` | Host actions and player signups firing together leave no duplicates, no overbooking, and nobody on both the roster and the waitlist. |
| `sms-cancel.js` | Texting 9 cancels the right player and promotes off the waitlist. Also that a repeat cancel does nothing — it used to delete the last person on the roster, someone who never asked. |
| `reminder-catchup.js` | A reminder missed while the server was down still goes out; no duplicates on a second run or after a restart; past, cancelled and >24h-away games are left alone; wording says "today" or "tomorrow" accurately. |
| `reminder-safety.js` | A permanently failing number stops after 3 attempts instead of retrying every 2 minutes until game time, and two overlapping reminder checks never text the same person twice. |
| `reminder-late-joiner.js` | Someone who joins *after* everyone else has been reminded still gets their own reminder. Before the fix they got nothing: the game was cached as done and skipped forever. Also checks nobody is texted twice and a player who leaves again is not texted. |
| `sms-failure.js` | A join or "I'm out" whose text fails still saves the signup, reports the failure to the client, and retries once. Also that permanent errors (out of quota, invalid number) are *not* retried, and that a blip followed by success actually delivers. |
| `sms-failure-ui.js` | Drives the real confirmation screen in headless Chrome: when the text fails the player sees a warning instead of "You'll receive a confirmation text message shortly". Skips if Chrome is not installed. |

## Caveat worth remembering

The per-game lock in `utils/game-lock.js` guards a **single Node process**, which is
what Render runs today. These tests will keep passing if the service is scaled to more
than one instance, but the races would come back — ordering would have to move into the
database. The tests cannot see that, so it has to be remembered.
