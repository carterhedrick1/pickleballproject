# Documentation you can regenerate

Three views of the app, built from the code rather than written by hand, so they cannot drift
out of date without you noticing. Everything here is regenerated on demand — the scripts are
tracked in git, the output is not.

```
npm run docs                      # all three, desktop widths
npm run docs:copy                 # the two text views only (fast, no browser)
npm run docs:screens              # screenshots only
npm run docs:screens -- --phone   # screenshots at phone width
```

Then open them:

```
open docs/screens.html docs/containers.html docs/copy-deck.html
```

## What each one gives you

| File | What it is | Point at things by |
| --- | --- | --- |
| `screens.html` | 27 screenshots of the running app, grouped under the page file that produced each | the file — "`@create.html` add a level field" |
| `containers.html` | Every panel on every page, shown whole with its copy | `page.container` — `4.11` is the Game Actions panel |
| `copy-deck.html` | Every individual line of fixed text | `page.line` — `4.83` is one exact sentence |

The page numbers are the same in both text views: 1 Home, 2 Create, 3 Invite, 4 Manage,
5 My Games, 6 Find My Games, 7 Demo, 8 Privacy, 9 Terms.

## What the screenshot script actually does

`scripts/capture-screens.js` is the only one that runs the app. In order, it:

1. starts a throwaway server on a free port, on SQLite, with SMS in dev mode
2. seeds three demo games — an open first-come game, a full one, an approval one with applicants
3. drives headless Chrome through the real pages: submits the create form, signs up as a player,
   clicks the management tabs, runs a phone lookup
4. writes `docs/screens.html` with the images inlined, plus loose `.webp` files
5. deletes the demo games and stops the server, **even if a capture failed partway**

### It will not text anyone, and will not touch production

- `TEXTBELT_API_KEY` is blanked for the child server, so `sendSMS` takes its dev-mode branch and
  returns success without building a Textbelt request. The run reports how many sends it logged.
- It refuses to start if `DATABASE_URL` is set, and aborts unless `/api/health` reports SQLite.
- Demo games use `555` phone numbers and carry a marker string in their message. Cleanup only
  matches rows with **both** the marker and a fixture 555 number, so an interrupted run can be
  swept up later without any chance of deleting a real game.
- It picks its own free port, so a server you already have running on 3001 or 3002 is untouched.

### Useful flags

| Flag | Effect |
| --- | --- |
| `--phone` | Capture at 420px instead of desktop. Writes `screens-phone.html` and `screens-phone/`. |
| `--only=manage` | Only screens whose filename or route contains the string. Substring match, so `--only=game` also catches `my-games`. |
| `--keep-fixtures` | Leave the demo games in the local database, for poking at them by hand. |

Set `CHROME_PATH` if Chrome is not in the usual place.

## Adding or changing a screen

Edit the `buildScreens()` list in `scripts/capture-screens.js`. Each entry is:

```js
{ file: 'manage-players',                  // becomes screens/manage-players.webp
  of: '/manage.html?id=…&token=…',         // which group it appears under
  size: 'wide',                            // narrow | wide | tall
  url: `/manage.html?id=${fx.open.gameId}&token=${fx.open.hostToken}`,
  title: 'Players tab',
  note: 'What to notice about this screen.',
  act: clickTab(1) }                       // optional: interact before the shot
```

`act` receives a page handle with `goto`, `evaluate`, `size` and `screenshot`. If the page throws,
`evaluate` throws too, so a step that silently stops working fails the run instead of quietly
photographing the wrong screen.

## What is deliberately missing

None of these cover text the app generates while running: player names and rosters, status and
error messages, and every outbound SMS. That copy lives in `public/js/` and `sms-handler.js`.
The text messages are what most players actually read, so they are the obvious next view to add.

## Files

```
scripts/
  capture-screens.js     screenshots + gallery
  extract-copy.js        containers.html + copy-deck.html
  lib/
    cdp.js               minimal Chrome DevTools client (no Puppeteer dependency)
    local-server.js      throwaway app instance, with the safety guards
    fixtures.js          seeds and removes the three demo games
    page-text.js         reads visible copy out of public/*.html
    doc-shell.js         shared page shell and palette
```
