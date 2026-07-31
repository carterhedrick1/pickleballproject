#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const TASK_MARKER = '.parallel-task.json';
const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://inorout.club';
const LOCAL_PORT = Number(process.env.WORKFLOW_LOCAL_PORT || 3002);
const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;
const COMPLETION_LOCK_WAIT_MS = 20 * 60 * 1000;
const PRODUCTION_WAIT_MS = 12 * 60 * 1000;

class WorkflowError extends Error {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value) {
  const normalized = String(value || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  return normalized || 'task';
}

function parseWorktrees(raw) {
  const entries = [];
  let current = null;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length) };
      entries.push(current);
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (current && line === 'detached') {
      current.detached = true;
    }
  }

  return entries;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new WorkflowError(
      `${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`
    );
  }

  return {
    status: result.status,
    stdout: options.inherit ? '' : (result.stdout || '').trim(),
    stderr: options.inherit ? '' : (result.stderr || '').trim(),
  };
}

function git(cwd, args, options = {}) {
  return run('git', args, { cwd, ...options });
}

function repositoryContext(cwd = process.cwd()) {
  const worktreeOutput = git(cwd, ['worktree', 'list', '--porcelain']).stdout;
  const worktrees = parseWorktrees(worktreeOutput);
  const main = worktrees.find((entry) => entry.branch === 'main');
  if (!main) throw new WorkflowError('The main worktree could not be found.');

  const commonOutput = git(cwd, ['rev-parse', '--git-common-dir']).stdout;
  const commonGitDir = path.resolve(cwd, commonOutput);
  const workflowDir = path.join(commonGitDir, 'parallel-workflow');

  return {
    mainRoot: path.resolve(main.path),
    commonGitDir,
    workflowDir,
    activeTasksDir: path.join(workflowDir, 'tasks'),
    historyDir: path.join(workflowDir, 'history'),
    lockDir: path.join(workflowDir, 'completion.lock'),
    workspaceLockDir: path.join(workflowDir, 'workspace.lock'),
    worktrees,
  };
}

function ensureWorkflowDirectories(context) {
  fs.mkdirSync(context.activeTasksDir, { recursive: true });
  fs.mkdirSync(context.historyDir, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function markerPath(taskPath) {
  return path.join(taskPath, TASK_MARKER);
}

function registryPath(context, taskId) {
  return path.join(context.activeTasksDir, `${taskId}.json`);
}

function saveTask(context, task) {
  task.updatedAt = new Date().toISOString();
  writeJson(markerPath(task.path), task);
  writeJson(registryPath(context, task.id), task);
}

function loadTaskFromCurrentWorktree(context, cwd = process.cwd()) {
  let cursor = path.resolve(cwd);
  while (cursor.startsWith(context.mainRoot) && cursor !== context.mainRoot) {
    const candidate = markerPath(cursor);
    if (fs.existsSync(candidate)) return readJson(candidate);
    cursor = path.dirname(cursor);
  }
  return null;
}

function loadActiveTasks(context) {
  if (!fs.existsSync(context.activeTasksDir)) return [];
  return fs.readdirSync(context.activeTasksDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return readJson(path.join(context.activeTasksDir, name));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock(context, lockDir, label, waitMs) {
  ensureWorkflowDirectories(context);
  const startedAt = Date.now();
  let lastNotice = 0;

  while (true) {
    try {
      fs.mkdirSync(lockDir);
      writeJson(path.join(lockDir, 'owner.json'), {
        pid: process.pid,
        label,
        acquiredAt: new Date().toISOString(),
      });
      return () => fs.rmSync(lockDir, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      const ownerFile = path.join(lockDir, 'owner.json');
      let owner = null;
      try {
        owner = readJson(ownerFile);
      } catch {
        // A process may still be writing the owner file.
      }

      const lockAge = owner?.acquiredAt
        ? Date.now() - Date.parse(owner.acquiredAt)
        : 0;
      if (owner && !isProcessAlive(owner.pid) && lockAge > 5000) {
        console.log(`Recovering an abandoned lock from ${owner.label || 'another task'}...`);
        fs.rmSync(lockDir, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - startedAt > waitMs) {
        throw new WorkflowError(
          `Timed out waiting for ${owner?.label || 'another task'} to release its workflow lock.`
        );
      }

      if (Date.now() - lastNotice > 15000) {
        console.log(
          `Waiting safely for ${owner?.label || 'another task'}...`
        );
        lastNotice = Date.now();
      }
      await sleep(2000);
    }
  }
}

function acquireCompletionLock(context, label) {
  return acquireLock(
    context,
    context.lockDir,
    label,
    COMPLETION_LOCK_WAIT_MS
  );
}

function acquireWorkspaceLock(context, label) {
  return acquireLock(context, context.workspaceLockDir, label, 60 * 1000);
}

function assertCleanMain(context) {
  const branch = git(context.mainRoot, ['branch', '--show-current']).stdout;
  if (branch !== 'main') {
    throw new WorkflowError(`The primary worktree is on '${branch}', not 'main'.`);
  }
  const status = git(context.mainRoot, ['status', '--porcelain']).stdout;
  if (status) {
    throw new WorkflowError(
      'The primary worktree has uncommitted files. A task will not merge until main is clean.'
    );
  }
}

function timestampId() {
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace(/\..+$/, '');
  return `${stamp}-${crypto.randomBytes(2).toString('hex')}`;
}

function createOptionalSymlink(source, destination) {
  if (!fs.existsSync(source) || fs.existsSync(destination)) return;
  fs.symlinkSync(source, destination);
}

async function startTask(name) {
  const context = repositoryContext();
  const existing = loadTaskFromCurrentWorktree(context);
  if (existing) {
    console.log(`This chat already has an isolated task workspace:\n${existing.path}`);
    return;
  }

  const release = await acquireWorkspaceLock(context, `starting ${name || 'a task'}`);
  try {
    const slug = slugify(name);
    const id = `${slug}-${timestampId()}`;
    const taskPath = path.join(context.mainRoot, '.worktrees', id);
    const branch = `task/${id}`;

    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    console.log(`Creating an isolated workspace for “${name || slug}”...`);
    git(context.mainRoot, ['worktree', 'add', '-b', branch, taskPath, 'main'], { inherit: true });

    createOptionalSymlink(path.join(context.mainRoot, '.env'), path.join(taskPath, '.env'));

    const task = {
      id,
      name: name || slug,
      branch,
      path: taskPath,
      mainRoot: context.mainRoot,
      status: 'active',
      startedAt: new Date().toISOString(),
    };
    saveTask(context, task);

    console.log('\nTask workspace ready.');
    console.log(`Workspace: ${taskPath}`);
    console.log(`Branch:    ${branch}`);
    console.log('\nAll edits and checks for this request must use that workspace.');
  } finally {
    release();
  }
}

function parseFinishOptions(args) {
  const options = { message: '', visibility: null };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--message') {
      options.message = args[index + 1] || '';
      index += 1;
    } else if (value === '--visible') {
      options.visibility = 'visible';
    } else if (value === '--server-only') {
      options.visibility = 'server-only';
    } else {
      throw new WorkflowError(`Unknown finish option: ${value}`);
    }
  }
  if (!options.message.trim()) {
    throw new WorkflowError('Finish requires --message "A short description".');
  }
  if (!options.visibility) {
    throw new WorkflowError('Finish requires either --visible or --server-only.');
  }
  return options;
}

function commitTaskChanges(task, message) {
  const branch = git(task.path, ['branch', '--show-current']).stdout;
  if (branch !== task.branch) {
    throw new WorkflowError(`Task workspace is on '${branch}', not '${task.branch}'.`);
  }

  const dirty = git(task.path, ['status', '--porcelain']).stdout;
  if (dirty) {
    git(task.path, ['add', '--all']);
    console.log(`Saving the isolated task commit: ${message}`);
    git(task.path, ['commit', '-m', message], { inherit: true });
  }
}

function branchAheadOfMain(task) {
  return Number(git(task.path, ['rev-list', '--count', `main..${task.branch}`]).stdout);
}

function mergeCurrentMainIntoTask(context, task) {
  const before = git(task.path, ['rev-parse', 'HEAD']).stdout;
  const result = git(task.path, ['merge', '--no-edit', 'main'], { allowFailure: true });
  if (result.status !== 0) {
    git(task.path, ['merge', '--abort'], { allowFailure: true });
    throw new WorkflowError(
      'This task overlaps a change merged earlier. Its work remains isolated and safe, but the conflict must be resolved before completion can resume.'
    );
  }
  const after = git(task.path, ['rev-parse', 'HEAD']).stdout;
  if (before !== after) console.log('Updated this task with the latest completed work from main.');
}

function runDeploymentVerification(task) {
  console.log('\nRunning the deployment verification inside the isolated workspace...');
  run('npm', ['run', 'verify:deploy'], { cwd: task.path, inherit: true });
}

function generateScreens(task) {
  console.log('\nRegenerating the Screens gallery for this user-visible task...');
  run('npm', ['run', 'docs'], { cwd: task.path, inherit: true });
}

function listenerPids(port) {
  const result = run(
    'lsof',
    ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
    { allowFailure: true }
  );
  if (result.status !== 0 || !result.stdout) return [];
  return [...new Set(
    result.stdout.split(/\s+/).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0)
  )];
}

function processCwd(pid) {
  const result = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    allowFailure: true,
  });
  const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith('n'));
  return line ? path.resolve(line.slice(1)) : '';
}

function isInorOutWorkspace(context, cwd) {
  if (!cwd) return false;
  if (cwd === context.mainRoot) return true;
  return cwd.startsWith(`${path.join(context.mainRoot, '.worktrees')}${path.sep}`);
}

async function waitForLocalHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${LOCAL_URL}/api/health`);
      if (response.ok) {
        const body = await response.json();
        if (body.status === 'OK' && body.environment === 'local') return body;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new WorkflowError(`Local server did not become healthy${lastError ? `: ${lastError.message}` : '.'}`);
}

async function restartLocalServer(context) {
  const pids = listenerPids(LOCAL_PORT);
  if (pids.length > 1) {
    throw new WorkflowError(
      `More than one process is listening on port ${LOCAL_PORT}: ${pids.join(', ')}`
    );
  }

  if (pids.length === 1) {
    const pid = pids[0];
    const cwd = processCwd(pid);
    if (!isInorOutWorkspace(context, cwd)) {
      throw new WorkflowError(
        `Port ${LOCAL_PORT} belongs to an unidentified project at '${cwd || 'unknown'}'; it was not stopped.`
      );
    }
    console.log(
      `Stopping the confirmed IN or OUT server on port ${LOCAL_PORT} (PID ${pid})...`
    );
    process.kill(pid, 'SIGTERM');
    const deadline = Date.now() + 10000;
    while (listenerPids(LOCAL_PORT).length && Date.now() < deadline) await sleep(250);
    if (listenerPids(LOCAL_PORT).length) {
      throw new WorkflowError(`The confirmed server process ${pid} did not stop cleanly.`);
    }
  }

  const logPath = path.join(context.workflowDir, `server-${LOCAL_PORT}.log`);
  const logFd = fs.openSync(logPath, 'a');
  const env = {
    ...process.env,
    PORT: String(LOCAL_PORT),
    NODE_ENV: 'development',
  };
  delete env.DATABASE_URL;

  console.log(`Starting the integrated main worktree on port ${LOCAL_PORT}...`);
  const child = spawn('npm', ['start'], {
    cwd: context.mainRoot,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  const health = await waitForLocalHealth();
  console.log(`Local health is OK (started ${health.startedAt}).`);
}

function publishLocalScreens(task) {
  console.log('Publishing the regenerated Screens gallery locally...');
  run('npm', ['run', 'docs:publish', '--', '--local'], { cwd: task.path, inherit: true });
}

function loadDeveloperPassword(context) {
  try {
    require('dotenv').config({ path: path.join(context.mainRoot, '.env') });
  } catch {
    // dotenv is optional for the default local developer password.
  }
  return process.env.DEV_PASSWORD || 'vibe123';
}

async function verifyScreens(context, baseUrl, earliestPublication) {
  const headers = { 'X-Dev-Password': loadDeveloperPassword(context) };
  const [statusResponse, galleryResponse] = await Promise.all([
    fetch(`${baseUrl}/api/dev/status`, { headers }),
    fetch(`${baseUrl}/dev/screens`, { headers }),
  ]);
  if (!statusResponse.ok || !galleryResponse.ok) {
    throw new WorkflowError(
      `Screens verification failed (${statusResponse.status}/${galleryResponse.status}).`
    );
  }
  const status = await statusResponse.json();
  const gallery = await galleryResponse.text();
  const publishedAt = status.screens?.publishedAt;
  if (!publishedAt || Date.parse(publishedAt) < earliestPublication || gallery.length < 1000) {
    throw new WorkflowError('The Screens tab did not return the newly published gallery.');
  }
  console.log(`Screens gallery verified (${status.screens.sizeBytes} bytes, published ${publishedAt}).`);
}

async function productionHealth() {
  const response = await fetch(`${PRODUCTION_URL}/api/health`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function remoteMainHead(context, remote) {
  const result = git(context.mainRoot, ['ls-remote', remote, 'refs/heads/main'], {
    allowFailure: true,
  });
  if (result.status !== 0 || !result.stdout) return '';
  return result.stdout.split(/\s+/)[0] || '';
}

function ensureCommitUploaded(context, mainCommit) {
  const originHead = remoteMainHead(context, 'origin');
  const upstreamHead = remoteMainHead(context, 'upstream');
  if (originHead === mainCommit && upstreamHead === mainCommit) return;

  console.log('The merge commit is not present on both remotes; safely retrying the deployment hook...');
  run('sh', [path.join(context.mainRoot, '.githooks', 'post-commit')], {
    cwd: context.mainRoot,
    inherit: true,
  });

  const retriedOrigin = remoteMainHead(context, 'origin');
  const retriedUpstream = remoteMainHead(context, 'upstream');
  if (retriedOrigin !== mainCommit || retriedUpstream !== mainCommit) {
    throw new WorkflowError(
      'The merge is saved on main but could not be uploaded to both repositories. Completion can be resumed later.'
    );
  }
}

async function waitForProduction(commitTime) {
  const threshold = Date.parse(commitTime) - 5000;
  const deadline = Date.now() + PRODUCTION_WAIT_MS;
  let lastNotice = 0;
  let lastError = '';

  while (Date.now() < deadline) {
    try {
      const health = await productionHealth();
      if (
        health.status === 'OK' &&
        health.environment === 'production' &&
        Date.parse(health.startedAt) >= threshold
      ) {
        console.log(`Production health is OK (started ${health.startedAt}).`);
        return health;
      }
      lastError = `production still reports start time ${health.startedAt}`;
    } catch (error) {
      lastError = error.message;
    }

    if (Date.now() - lastNotice > 30000) {
      console.log(`Waiting for the new production process (${lastError})...`);
      lastNotice = Date.now();
    }
    await sleep(10000);
  }

  throw new WorkflowError(
    `Production did not report the new deployment within 12 minutes (${lastError}). Completion can be resumed safely.`
  );
}

function beginMainMerge(context, task) {
  console.log('\nEntering the serialized completion queue...');
  const result = git(
    context.mainRoot,
    ['merge', '--no-commit', '--no-ff', task.branch],
    { allowFailure: true }
  );
  if (result.status !== 0) {
    git(context.mainRoot, ['merge', '--abort'], { allowFailure: true });
    throw new WorkflowError('The final merge could not be prepared. Main was restored unchanged.');
  }
}

function commitMainMerge(context, task, message) {
  const before = git(context.mainRoot, ['rev-parse', 'HEAD']).stdout;
  const result = git(
    context.mainRoot,
    ['commit', '-m', `Merge task: ${message}`],
    { allowFailure: true, inherit: true }
  );
  const after = git(context.mainRoot, ['rev-parse', 'HEAD']).stdout;
  if (after === before) {
    throw new WorkflowError('The main merge commit was not created.');
  }
  if (result.status !== 0) {
    console.log(
      'The merge commit was created, but its automatic deployment hook needs to be retried.'
    );
  }
  task.status = 'merged';
  task.mainCommit = after;
  task.mainCommitTime = git(context.mainRoot, ['show', '-s', '--format=%cI', after]).stdout;
  task.mergedAt = new Date().toISOString();
  return after;
}

function cleanupCompletedTask(context, task) {
  task.status = 'complete';
  task.completedAt = new Date().toISOString();
  const historyFile = path.join(context.historyDir, `${task.id}.json`);
  writeJson(historyFile, task);
  fs.rmSync(registryPath(context, task.id), { force: true });

  process.chdir(context.mainRoot);
  git(context.mainRoot, ['worktree', 'remove', '--force', task.path], { inherit: true });
  git(context.mainRoot, ['branch', '-d', task.branch], { inherit: true });
}

async function finishMergedTask(context, task) {
  ensureCommitUploaded(context, task.mainCommit);
  const health = await waitForProduction(task.mainCommitTime);

  if (task.visibility === 'visible') {
    const publicationStarted = Date.now();
    console.log('Publishing the regenerated Screens gallery to production...');
    run('npm', ['run', 'docs:publish'], { cwd: task.path, inherit: true });
    await verifyScreens(context, PRODUCTION_URL, publicationStarted - 5000);
  }

  task.productionStartedAt = health.startedAt;
  saveTask(context, task);
  cleanupCompletedTask(context, task);
  console.log('\nTask completed, merged, deployed, verified, and removed from the active queue.');
  console.log(`Production commit: ${task.mainCommit}`);
}

async function finishTask(args) {
  const options = parseFinishOptions(args);
  const context = repositoryContext();
  const task = loadTaskFromCurrentWorktree(context);
  if (!task) {
    throw new WorkflowError(
      'This command must run inside a workspace created by npm run task:start.'
    );
  }

  const release = await acquireCompletionLock(context, `finishing “${task.name}”`);
  let mainMergePending = false;
  let localRestartedDuringMerge = false;
  try {
    const pending = loadActiveTasks(context).find(
      (candidate) => candidate.id !== task.id && candidate.status === 'merged'
    );
    if (pending) {
      throw new WorkflowError(
        `“${pending.name}” has already merged and must finish production verification before another task can deploy.`
      );
    }

    if (task.status === 'merged') {
      console.log(`Resuming production completion for “${task.name}”...`);
      await finishMergedTask(context, task);
      return;
    }

    assertCleanMain(context);
    commitTaskChanges(task, options.message.trim());
    if (branchAheadOfMain(task) < 1) {
      throw new WorkflowError('This task has no changes to merge.');
    }

    mergeCurrentMainIntoTask(context, task);
    runDeploymentVerification(task);
    if (options.visibility === 'visible') generateScreens(task);

    beginMainMerge(context, task);
    mainMergePending = true;
    await restartLocalServer(context);
    localRestartedDuringMerge = true;

    if (options.visibility === 'visible') {
      const publicationStarted = Date.now();
      publishLocalScreens(task);
      await verifyScreens(context, LOCAL_URL, publicationStarted - 5000);
    }

    task.message = options.message.trim();
    task.visibility = options.visibility;
    const mainCommit = commitMainMerge(context, task, task.message);
    mainMergePending = false;
    saveTask(context, task);

    ensureCommitUploaded(context, mainCommit);
    await finishMergedTask(context, task);
  } catch (error) {
    if (mainMergePending) {
      git(context.mainRoot, ['merge', '--abort'], { allowFailure: true });
      if (localRestartedDuringMerge) {
        try {
          await restartLocalServer(context);
        } catch (restartError) {
          console.error(`Main was restored, but its local restart failed: ${restartError.message}`);
        }
      }
    }
    throw error;
  } finally {
    release();
  }
}

function printStatus() {
  const context = repositoryContext();
  const tasks = loadActiveTasks(context);
  let owner = null;
  try {
    owner = readJson(path.join(context.lockDir, 'owner.json'));
  } catch {
    // No completion lock is currently held.
  }

  console.log(owner
    ? `Completion queue: busy with ${owner.label}`
    : 'Completion queue: available');
  if (!tasks.length) {
    console.log('Active isolated tasks: none');
    return;
  }
  console.log('Active isolated tasks:');
  for (const task of tasks) {
    console.log(`- ${task.name} [${task.status}]`);
    console.log(`  ${task.path}`);
  }
}

function printHelp() {
  console.log(`Parallel development workflow

  npm run task:start -- <short-task-name>
  npm run task:finish -- --message "Describe the change" --visible
  npm run task:finish -- --message "Describe the change" --server-only
  npm run task:status

Each task is isolated immediately. Finishing tasks share one guarded merge,
restart, deployment, and production-verification queue.`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'start') {
    await startTask(args.join(' ').trim());
  } else if (command === 'finish') {
    await finishTask(args);
  } else if (command === 'status') {
    printStatus();
  } else {
    printHelp();
    if (command && command !== 'help' && command !== '--help') process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nParallel workflow stopped safely: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  isInorOutWorkspace,
  parseFinishOptions,
  parseWorktrees,
  slugify,
};
