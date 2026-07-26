# Project Rules

## Test every change as a user before deploying

Never deploy a change without first seeing it work the way a real user would:

1. **Run the app locally** (`npm start`, then http://localhost:3001) and exercise the
   change directly — load the affected page, click the buttons, walk the flow a
   player or organizer would actually take. A passing unit test alone is not enough.
2. **Use the `verify/` scripts** when the change touches what they cover
   (`npm run verify:app` for core user flows; see `verify/README.md` for the rest).
3. **After deploying**, confirm the change is actually live on https://inorout.club
   (check the affected page, or `/api/health` for server changes) and report the
   result to Scott — don't assume the deploy worked.

If a change can't be tested locally (e.g. real SMS delivery), say so explicitly
before deploying and state what was verified instead.

## Refresh the artifact pages after any visible change

The three pages in `docs/` are also published as Claude artifacts that Scott opens in a
browser, and a stale one is worse than none — it shows the app as it used to be. So after
deploying a change that alters anything a user sees (copy, layout, a new screen, a changed
flow), run `npm run docs` and republish all three files to their existing URLs, listed in
`docs/ARTIFACTS.md`. Pass each URL explicitly, or the link Scott has goes stale while a new
page quietly takes its place. Server-only changes with no visible surface don't need this.

Then run `npm run docs:publish` so the same three pages update inside the app, at
`/dev.html` → Screens. That copy is the one Scott actually uses as a reference, and
it goes stale the same way the artifacts do.

## The developer area

`/dev.html` (password `DEV_PASSWORD`, default `vibe123`) is Scott's own dashboard:
Textbelt credit, hosting health, the idea board, errors real users hit, and live copies
of the `docs/` pages. It is deliberately unlisted — no link in the nav.

Two things to keep working: the idea board is the record of what is half-built or
finished-but-not-deployed, so when a `done-not-deployed` item ships, move it to `live`.
And errors only reach it because `public/js/header.js` reports them — that reporter must
stay fail-silent, since it runs on every player-facing page.

## Deploys

Production auto-deploys from `upstream` (`carterhedrick1/pickleballproject`) `main`.
Pushing there IS the deploy — never push to `upstream` without Scott explicitly
asking to deploy. The plain Push button / `origin` is Scott's fork and is always safe.
