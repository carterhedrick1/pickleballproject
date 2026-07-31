# Parallel Development Without Git Administration

Scott can open multiple chats and request unrelated IN or OUT changes at the same time. Each
chat is responsible for putting its request into an isolated task workspace before it edits a
file. Scott does not need to create branches, choose ports, merge code, or decide when a
deployment is safe.

## What Happens Automatically

When a chat begins a change, it runs:

```sh
npm run task:start -- short-task-name
```

The command creates a uniquely named branch and a Git worktree under the ignored `.worktrees/`
directory. The workspace gets access to the repository's installed packages and local
environment configuration, but its source files, local SQLite database, uncommitted changes,
and branch are isolated from every other chat.

When the chat has finished the change, it classifies the work as user-visible or server-only
and runs one of:

```sh
npm run task:finish -- --message "Describe The Change" --visible
npm run task:finish -- --message "Describe The Change" --server-only
```

The finish command uses a shared completion lock. Chats can continue implementing in parallel,
but only one task at a time can:

1. merge the latest `main` into its isolated branch;
2. run the deployment verification;
3. regenerate Screens when the task is user-visible;
4. prepare the change in the primary worktree;
5. restart and verify the local server on port 3002;
6. create the `main` merge commit and invoke the existing deployment hook;
7. confirm both GitHub repositories received the exact commit;
8. wait for a newly started production process;
9. publish and verify the production Screens gallery when applicable; and
10. remove the completed worktree and task branch.

If a test or merge fails, `main` remains unchanged. If the merge commit succeeds but an upload
or production check fails, the task remains registered as pending and can resume without making
a duplicate commit. No later task is allowed to deploy past that pending task.

## Seeing What Is Active

Anyone can run:

```sh
npm run task:status
```

It reports whether the completion queue is available and lists every isolated task, its state,
and its workspace. This is diagnostic only; Scott normally does not need to run it.

## Requests That Do Not Need A Workspace

Questions, explanations, code review, monitoring, and restarting the already-running local
server do not change repository files, so they do not create a task workspace. Any request that
will edit repository files does.
