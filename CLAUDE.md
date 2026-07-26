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

## Deploys

Production auto-deploys from `upstream` (`carterhedrick1/pickleballproject`) `main`.
Pushing there IS the deploy — never push to `upstream` without Scott explicitly
asking to deploy. The plain Push button / `origin` is Scott's fork and is always safe.
