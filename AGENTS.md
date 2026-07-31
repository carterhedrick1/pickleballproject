# Project workflow

## Isolate every change request automatically

Every chat that will change repository files must work in its own Git worktree. This keeps
simultaneous requests from sharing files, the Git index, commits, port 3002, or a deployment.
Scott does not manage these worktrees or branches.

Before editing files for a new change request:

1. If the current workspace already contains `.parallel-task.json`, continue in that task.
2. Otherwise run `npm run task:start -- <short-descriptive-name>` from the primary repository.
3. Read the `Workspace:` path printed by the command and use that absolute directory as the
   working directory for every subsequent read, edit, check, and command in the task.
4. Do not edit the primary `main` worktree directly and do not manually create a branch.

Read-only investigation, explanations, monitoring, and a direct request to restart the existing
server do not need a task workspace because they do not change repository files.

Do not manually commit, merge, push, restart port 3002, or deploy from an isolated task.
After the change and its relevant checks are ready, complete it with exactly one of:

- `npm run task:finish -- --message "Short Commit Message" --visible` for anything a user sees.
- `npm run task:finish -- --message "Short Commit Message" --server-only` when no visible surface
  changes.

`task:finish` commits the isolated work, waits for the repository-wide completion lock, updates
the task with the latest `main`, runs the deployment gate, regenerates and publishes Screens when
needed, prepares and verifies the integrated local app, merges into `main`, pushes both remotes,
waits for the fresh production process, verifies production, and removes the completed worktree.
Only one task can perform those shared completion steps at a time; other chats keep working in
their own worktrees while they wait.

If completion stops because of a test, conflict, upload, or deployment failure, keep working in
the printed task workspace and rerun the same `task:finish` command after addressing the cause.
Never bypass the queue or discard a task workspace to force another deployment through. Use
`npm run task:status` to inspect the queue and active task workspaces.

## Verify changes before committing

Run the checks that cover the changed behavior and exercise user-facing changes locally.
`npm run verify:deploy` is the minimum deployment gate.

## Keep the developer Screens tab current

After every completed change that alters anything a user sees—including copy, styles, layout,
controls, or an added, removed, or changed screen or flow—the `--visible` completion path runs
`npm run docs` to regenerate the current app views. If the changed state is not already covered,
update `scripts/capture-screens.js` so the gallery photographs it.

The completion queue publishes the regenerated pages locally and verifies them through
`/dev.html` → Screens. After the production deployment is live, it publishes them to production
and confirms that the Screens tab reports the new publication time and opens the refreshed
Actual Screens gallery. Treat this refresh as part of completing every user-visible change;
server-only changes with no visible surface are exempt.

## Restart local and production after completed app updates

The serialized `task:finish` queue performs this sequence after every completed app change:

1. Run the relevant checks, including `npm run verify:deploy`.
2. Restart the local IN or OUT server on port 3002. Resolve the process listening on that
   exact port, stop only that process, then run `PORT=3002 npm start`. If nothing is listening,
   start the server instead of treating that as a successful restart. Confirm
   `http://127.0.0.1:3002/api/health` and exercise the affected behavior locally.
3. Prepare the isolated change on `main` and create the merge commit. The post-commit workflow
   pushes to `upstream`, and Render's resulting deployment starts a fresh production server
   process. That deployment is the production restart; do not invoke the Render deploy hook
   afterward when the automatic deployment is healthy.
4. Wait for the production server to report a new start time, then confirm `/api/health` and
   the affected behavior on https://inorout.club.

Use the manual Render deploy hook only when the automatic deployment did not start, failed, or
left production on the previous version, or when Scott explicitly asks for an additional
production restart. Never restart an unidentified Node process: confirm its port and working
directory first so another local project is not interrupted.

## Commit and deploy completed changes

Unless Scott explicitly says otherwise, commit completed changes made to IN or OUT and deploy
them to production through `task:finish`. Follow the automatic deployment workflow below and
verify the affected behavior in production.

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

### Button labels use every-word title capitalization

Capitalize the first letter of every word in authored button labels, including native buttons
and links or labels styled as buttons. This includes short words such as "a", "and", "for",
"of", "or", "the", and "to". Preserve intentional acronym casing such as SMS, DUPR, and API,
and do not apply capitalization with CSS because that can corrupt intentional casing.

`npm run verify:frontend` enforces this convention for authored titles in the public UI.
