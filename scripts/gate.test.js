#!/usr/bin/env node
// Self-check for gate.js — run with: node scripts/gate.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.join(__dirname, 'gate.js');
const PASS = `node -e "process.exit(0)"`;
const FAIL = `node -e "console.error('boom'); process.exit(1)"`;
const HANG = `node -e "setTimeout(()=>{}, 60000)"`;

function gate(dir, mode, stdin = '{}') {
  return spawnSync(process.execPath, [GATE, mode], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
}

function tmpRepo(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristretto-gate-'));
  if (config !== undefined) fs.writeFileSync(path.join(dir, '.ristretto.json'), config);
  return dir;
}

function arm(dir) {
  fs.mkdirSync(path.join(dir, '.ristretto'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ristretto', 'pulling'), '');
}

// 1. No config → never interfere, all modes.
let dir = tmpRepo();
assert.strictEqual(gate(dir, 'quick').status, 0, 'quick without config must exit 0');
assert.strictEqual(gate(dir, 'full').status, 0, 'full without config must exit 0');
assert.strictEqual(gate(dir, 'verify').status, 0, 'verify without config must exit 0');

// 2. Config but no marker → full gate stays disarmed.
dir = tmpRepo(JSON.stringify({ gates: { lint: FAIL } }));
assert.strictEqual(gate(dir, 'full').status, 0, 'full without marker must exit 0');

// 3. Armed + failing gate → blocks with exit 2 and names the gate.
arm(dir);
let r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'failing gate while armed must exit 2');
assert.ok(r.stderr.includes("gate 'lint' FAILED"), 'stderr must name the failing gate');

// 4. Retry budget: two more blocks, then it surfaces with exit 0.
assert.strictEqual(gate(dir, 'full').status, 2, 'retry 2 must still block');
assert.strictEqual(gate(dir, 'full').status, 2, 'retry 3 must still block');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'after retry budget it must surface, not loop');
assert.ok(r.stderr.includes('surfacing to user'), 'exhausted budget must say so');
assert.strictEqual(gate(dir, 'full').status, 2, 'budget must reset after surfacing');

// 5. Passing gates → exit 0 and the retry counter resets.
dir = tmpRepo(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }));
arm(dir);
fs.writeFileSync(path.join(dir, '.ristretto', 'gate-retries'), '2');
assert.strictEqual(gate(dir, 'full').status, 0, 'green gates must exit 0');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-retries')), 'green gates must reset retries');

// 6. Broken config while armed → fail closed (exit 2), not silently disarmed.
dir = tmpRepo('{not json');
arm(dir);
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'broken config while armed must fail closed');
assert.ok(r.stderr.includes('unparseable'), 'broken config must be named');
assert.strictEqual(gate(dir, 'quick').status, 0, 'broken config in quick mode must not block');
assert.strictEqual(gate(dir, 'verify').status, 1, 'broken config in verify mode must exit 1');

// 7. Quick mode formats the touched file via {file}.
dir = tmpRepo(JSON.stringify({ gates: { format: `node -e "require('fs').writeFileSync(process.argv[1] + '.formatted', '')" {file}` } }));
const touched = path.join(dir, 'a.txt');
fs.writeFileSync(touched, 'x');
r = gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: touched } }));
assert.strictEqual(r.status, 0, 'quick must exit 0');
assert.ok(fs.existsSync(touched + '.formatted'), 'format command must receive the touched file');

// --- Fingerprint cache: an unchanged green tree must not re-run the gates. ---
// COUNT appends one char to ./count per gate invocation, so the file length counts runs.
const COUNT = `node -e "require('fs').appendFileSync('count', 'x')"`;
const runs = (d) => { try { return fs.readFileSync(path.join(d, 'count'), 'utf8').length; } catch { return 0; } };

function gitTmpRepo(config) {
  const d = tmpRepo(config);
  fs.writeFileSync(path.join(d, '.gitignore'), '.ristretto/\ncount\n');
  fs.writeFileSync(path.join(d, 'src.txt'), 'v1');
  const g = (args) => spawnSync('git', args, { cwd: d, encoding: 'utf8' });
  g(['init', '-q']);
  g(['add', '-A']);
  g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  return d;
}

// 8. Green run stores a fingerprint; identical tree → gates skipped on the next run.
dir = gitTmpRepo(JSON.stringify({ gates: { test: COUNT } }));
arm(dir);
assert.strictEqual(gate(dir, 'full').status, 0, 'green gates must exit 0 (git repo)');
assert.strictEqual(runs(dir), 1, 'first green run must execute the gates');
assert.strictEqual(gate(dir, 'full').status, 0, 'unchanged tree must exit 0');
assert.strictEqual(runs(dir), 1, 'unchanged tree must NOT re-run the gates');

// 9. Any tree change invalidates the fingerprint → gates run again.
fs.writeFileSync(path.join(dir, 'src.txt'), 'v2');
assert.strictEqual(gate(dir, 'full').status, 0, 'changed tree must exit 0 when green');
assert.strictEqual(runs(dir), 2, 'changed tree must re-run the gates');

// 10. Same file names, different content → still a cache miss (content is hashed, not just paths).
fs.writeFileSync(path.join(dir, 'src.txt'), 'v3');
assert.strictEqual(gate(dir, 'full').status, 0);
assert.strictEqual(runs(dir), 3, 'content-only change must re-run the gates');

// 11. Outside a git repo there is no caching — gates always run (safe fallback).
dir = tmpRepo(JSON.stringify({ gates: { test: COUNT } }));
arm(dir);
gate(dir, 'full');
gate(dir, 'full');
assert.strictEqual(runs(dir), 2, 'non-git repo must run the gates every time');

// --- Timeouts: a hung gate is surfaced immediately, never retried. ---

// 12. A gate that hangs is killed, reported as a timeout, and does NOT block (exit 0).
dir = tmpRepo(JSON.stringify({ gates: { test: HANG }, timeouts: { test: 1 } }));
arm(dir);
const startedAt = Date.now();
r = gate(dir, 'full');
assert.ok(Date.now() - startedAt < 30000, 'a hung gate must be killed at its timeout, not run to completion');
assert.strictEqual(r.status, 0, 'a hung gate must surface (exit 0), not block into another hang');
assert.ok(r.stderr.includes('did not finish within 1s'), 'timeout must name the budget it blew');
assert.ok(r.stderr.includes('testChanged'), 'timeout advice must point at the scoped-test escape hatch');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-retries')), 'a timeout must not consume the retry budget');
assert.strictEqual(fs.readFileSync(path.join(dir, '.ristretto', 'gate-timeout'), 'utf8'), 'test',
  'a timeout must be recorded so the close step can report the work as unverified');

// 13. verify mode reports a hang too, and fails (exit 1) rather than passing it off as green.
r = gate(dir, 'verify');
assert.strictEqual(r.status, 1, 'a hung gate in verify must exit 1');
assert.ok(r.stdout.includes('test ✗'), 'verify must mark the hung gate failed in its summary');

// --- Scoped tests: the loop tests what changed, verify tests everything. ---

// SCOPED/FULL each append a distinct char to ./count so we can tell which ran.
const SCOPED = `node -e "require('fs').appendFileSync('count', 's')"`;
const FULL = `node -e "require('fs').appendFileSync('count', 'f')"`;
const trace = (d) => { try { return fs.readFileSync(path.join(d, 'count'), 'utf8'); } catch { return ''; } };

// 14. full mode prefers gates.testChanged; verify mode always runs the whole suite.
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: SCOPED } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
assert.strictEqual(gate(dir, 'full').status, 0);
assert.strictEqual(trace(dir), 's', 'the loop must run the scoped test gate when one is configured');
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0, 'verify must exit 0 when green');
assert.strictEqual(trace(dir), 'sf', 'verify must run the FULL suite, never the scoped one');
assert.ok(r.stdout.includes('test ✓'), 'verify must print a gate summary');

// 15. verify ignores the green-tree cache — its whole job is to re-prove the tree.
gate(dir, 'verify');
assert.strictEqual(trace(dir), 'sff', 'verify must not be short-circuited by the fingerprint cache');

// 16. Without testChanged, the loop falls back to the full test gate (today's behavior).
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
assert.strictEqual(gate(dir, 'full').status, 0);
assert.strictEqual(trace(dir), 'f', 'no testChanged → the full suite still runs, unchanged behavior');

// 17. {files} in a scoped command is substituted with the touched files.
const ARGS = `node -e "require('fs').appendFileSync('args', process.argv.slice(1).join(',') + '\\n')" {files}`;
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: ARGS } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
fs.writeFileSync(path.join(dir, 'new.txt'), 'added');
assert.strictEqual(gate(dir, 'full').status, 0);
let args = fs.readFileSync(path.join(dir, 'args'), 'utf8').trim();
assert.ok(args.includes('src.txt'), 'a modified file must reach the scoped command');
assert.ok(args.includes('new.txt'), 'an untracked file must reach the scoped command too');
assert.ok(!args.includes('{files}'), 'the placeholder must be substituted, not passed through');

// 18. {files} with an untouched tree → nothing to scope to, so the test gate is skipped, not
//     run bare (which would silently become a full-suite run at the worst possible moment).
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: ARGS } }));
arm(dir);
assert.strictEqual(gate(dir, 'full').status, 0);
assert.ok(!fs.existsSync(path.join(dir, 'args')), 'an untouched tree must not run a bare scoped command');
assert.strictEqual(trace(dir), '', 'an untouched tree must not fall back to the full suite either');

// 19. A scoped failure still blocks — scoping changes what runs, never whether it's enforced.
dir = gitTmpRepo(JSON.stringify({ gates: { test: PASS, testChanged: FAIL } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a failing scoped test must block like any other red gate');
assert.ok(r.stderr.includes("gate 'test (changed)' FAILED"), 'the scoped gate must be named as such');

// 20. verify with no gates configured is a no-op success, not a false green claim.
dir = tmpRepo(JSON.stringify({ gates: {} }));
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0);
assert.ok(r.stdout.includes('none configured'), 'verify must say when there was nothing to run');

console.log('gate.test.js: all checks passed');
