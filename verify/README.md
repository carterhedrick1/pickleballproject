# Integration checks

These are the scripts that proved the bugs fixed on 2026-07-24 were real, and then
proved the fixes worked. They are deliberately blunt: they hit a running app and
count what actually survived, rather than reasoning about correctness on paper.

**None of these ever send a real text.** Two rules make that true, and both matter:

- Test players are created **without phone numbers**. `sendSMS` is only called when a
  phone is present, so no phone means no send.
- `sms-cancel.js` needs players who *do* have phone numbers, so it must be run against
  a server started with `TEXTBELT_API_KEY=""`. In that mode `sendSMS` logs
  `[DEV MODE] SMS would be sent to ...` and returns success without calling Textbelt.

If you ever change these, check Textbelt quota before and after:
`https://textbelt.com/quota/<TEXTBELT_API_KEY>`

## Running them

Two need nothing but the repo. The rest need the app running on port 3002.
**Use 3002, not 3001** — port 3001 is a different project on this machine.

```
# No server required (in-process, local SQLite)
npm run verify:reminders
npm run verify:reminder-safety

# Start the app first, in another terminal:
PORT=3002 npm start

npm run verify:app       # whole user journey + the hostToken check
npm run verify:races     # all three concurrency checks

# The SMS flow needs dev-mode SMS, so start the server this way instead:
TEXTBELT_API_KEY="" PORT=3002 node server.js
npm run verify:sms
```

Every script exits non-zero on failure, so they chain with `&&`.

All of them accept a base URL, so they can be pointed at production once a change is
deployed — which is how these fixes were confirmed live:

```
node verify/signup-race.js https://inorout.club 8
```

Running against production creates a real game and cancels it when finished. That is
safe (no phone numbers means no texts) but it does leave a cancelled game behind.

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

## Caveat worth remembering

The per-game lock in `utils/game-lock.js` guards a **single Node process**, which is
what Render runs today. These tests will keep passing if the service is scaled to more
than one instance, but the races would come back — ordering would have to move into the
database. The tests cannot see that, so it has to be remembered.
