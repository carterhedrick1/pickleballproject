# Project workflow

## Verify changes before committing

Run the checks that cover the changed behavior and exercise user-facing changes locally.
`npm run verify:deploy` is the minimum deployment gate.

## Restart local and production after completed app updates

Use this sequence after every completed app change:

1. Run the relevant checks, including `npm run verify:deploy`.
2. Restart the local IN or OUT server on port 3002. Resolve the process listening on that
   exact port, stop only that process, then run `PORT=3002 npm start`. If nothing is listening,
   start the server instead of treating that as a successful restart. Confirm
   `http://127.0.0.1:3002/api/health` and exercise the affected behavior locally.
3. Commit the completed change on `main`. The post-commit workflow pushes to `upstream`,
   and Render's resulting deployment starts a fresh production server process. That deployment
   is the production restart; do not invoke the Render deploy hook afterward when the automatic
   deployment is healthy.
4. Wait for the production server to report a new start time, then confirm `/api/health` and
   the affected behavior on https://inorout.club.

Use the manual Render deploy hook only when the automatic deployment did not start, failed, or
left production on the previous version, or when Scott explicitly asks for an additional
production restart. Never restart an unidentified Node process: confirm its port and working
directory first so another local project is not interrupted.

## Commit and deploy completed changes

Unless Scott explicitly says otherwise, commit completed changes made to IN or OUT and deploy
them to production. Follow the automatic deployment workflow below and verify the affected
behavior in production.

## Commits on main deploy automatically

This repository uses `.githooks/post-commit`. After every commit on `main`, the hook:

1. runs `npm run verify:deploy`;
2. pushes `main` to `origin` (`scotthedrick/pickleballproject`);
3. pushes `main` to `upstream` (`carterhedrick1/pickleballproject`), which triggers the
   production deployment to https://inorout.club.

A request to commit changes on `main` is standing authorization to run that automatic
deployment workflow. Do not ask separately whether to push or deploy.

If Scott explicitly asks to commit without deploying, use `SKIP_AUTO_DEPLOY=1` for that
commit. If the hook reports a failure, say clearly whether the commit stayed local, reached
`origin`, or reached `upstream`.

After a production deployment, confirm the affected behavior on https://inorout.club, or
check `/api/health` for server-only changes.

## UI copy uses every-word title capitalization

Capitalize the first letter of every word in titles, headings, short field labels, tabs, and
card/option titles. This includes short words such as "a", "and", "for", "of", "or", "the",
and "to". Preserve intentional acronym casing such as SMS, DUPR, and API. Keep explanatory
sentences, help text, placeholders, and user-provided content in normal sentence case. Preserve
the product-name styling "IN or OUT" (or "In or Out" where that form is used).

`npm run verify:frontend` enforces this convention for authored titles in the public UI.
