# Project workflow

## Verify changes before committing

Run the checks that cover the changed behavior and exercise user-facing changes locally.
`npm run verify:deploy` is the minimum deployment gate.

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
