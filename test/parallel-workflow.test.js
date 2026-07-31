'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isInorOutWorkspace,
  parseFinishOptions,
  parseWorktrees,
  slugify,
} = require('../scripts/parallel-workflow');

test('parallel task names become safe branch and directory slugs', () => {
  assert.equal(slugify(' Add a New RSVP Button! '), 'add-a-new-rsvp-button');
  assert.equal(slugify('../../'), 'task');
  assert.equal(slugify('A'.repeat(100)).length, 42);
});

test('finish requires an explicit visibility classification', () => {
  assert.deepEqual(
    parseFinishOptions(['--message', 'Add RSVP button', '--visible']),
    { message: 'Add RSVP button', visibility: 'visible' }
  );
  assert.deepEqual(
    parseFinishOptions(['--server-only', '--message', 'Harden API']),
    { message: 'Harden API', visibility: 'server-only' }
  );
  assert.throws(
    () => parseFinishOptions(['--message', 'Ambiguous']),
    /--visible or --server-only/
  );
});

test('worktree parser identifies branches and detached workspaces', () => {
  const parsed = parseWorktrees([
    'worktree /repo',
    'HEAD abc',
    'branch refs/heads/main',
    '',
    'worktree /repo/.worktrees/example',
    'HEAD def',
    'branch refs/heads/task/example',
    '',
    'worktree /tmp/review',
    'HEAD 123',
    'detached',
    '',
  ].join('\n'));

  assert.deepEqual(parsed, [
    { path: '/repo', branch: 'main' },
    { path: '/repo/.worktrees/example', branch: 'task/example' },
    { path: '/tmp/review', detached: true },
  ]);
});

test('server restart guard accepts only the main repo and its task worktrees', () => {
  const context = { mainRoot: path.resolve('/repo') };
  assert.equal(isInorOutWorkspace(context, path.resolve('/repo')), true);
  assert.equal(
    isInorOutWorkspace(context, path.resolve('/repo/.worktrees/task-one')),
    true
  );
  assert.equal(isInorOutWorkspace(context, path.resolve('/repo-other')), false);
  assert.equal(isInorOutWorkspace(context, path.resolve('/tmp/another-app')), false);
});

test('Claude Code imports the shared project workflow', () => {
  const adapter = fs.readFileSync(path.resolve(__dirname, '..', 'CLAUDE.md'), 'utf8');
  assert.match(adapter, /@AGENTS\.md/);
});
