# Project Rules

## Test every change as a user before deploying

Never deploy a change without first seeing it work the way a real user would:

1. **Run the app locally** (`PORT=3002 npm start`, then http://localhost:3002 — 3002 is the
   port Scott's workflow and every `verify/` script expect) and exercise the
   change directly — load the affected page, click the buttons, walk the flow a
   player or organizer would actually take. A passing unit test alone is not enough.
2. **Use the `verify/` scripts** when the change touches what they cover
   (`npm run verify:app` for core user flows; see `verify/README.md` for the rest).
3. **After deploying**, confirm the change is actually live on https://inorout.club
   (check the affected page, or `/api/health` for server changes) and report the
   result to Scott — don't assume the deploy worked.

If a change can't be tested locally (e.g. real SMS delivery), say so explicitly
before deploying and state what was verified instead.

## Refresh the docs pages after any visible change

After deploying a change that alters anything a user sees (copy, layout, a new screen, a
changed flow), run `npm run docs` to regenerate the three pages in `docs/`, then
`npm run docs:publish` so they update inside the app at `/dev.html` → Screens. That in-app
copy is the one Scott actually uses as a reference, and a stale one is worse than none —
it shows the app as it used to be. Server-only changes with no visible surface don't need
this.

**Don't republish the Claude artifact copies.** The same three pages also exist as
artifacts (URLs in `docs/ARTIFACTS.md`), but on 2026-07-26 Scott asked to stop refreshing
them on every visible change — `/dev.html` is where he reads them. Leave those URLs alone
unless he asks for them specifically.

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
Pushing there IS the deploy.

On 2026-07-27 Scott asked for every commit on `main` to deploy automatically, without a
separate push or deploy request. `.githooks/post-commit` runs the deployment checks, pushes
to `origin`, and then pushes to `upstream`. A request to commit on `main` is therefore
standing authorization for that workflow.

If Scott explicitly asks to commit without deploying, run that commit with
`SKIP_AUTO_DEPLOY=1`. If the hook fails, report whether the commit stayed local, reached
`origin`, or reached `upstream`; do not describe it as deployed unless the upstream push
succeeded.
