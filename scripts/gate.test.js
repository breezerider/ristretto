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
// Silent forever — a genuine hang.
const HANG = `node -e "setTimeout(()=>{}, 60000)"`;
// Slow but alive: prints every 250ms for ~3s, then succeeds. Must NEVER be killed, however
// short the silence budget — this is the legitimately-slow suite that a duration cap murders.
const SLOW = `node -e "let n=0; const t=setInterval(()=>{console.log('tick'+(++n)); if(n>11){clearInterval(t); process.exit(0);}}, 250)"`;
// Prints once, then goes quiet forever — the shape of a real hang (suite starts, then wedges).
const STALL = `node -e "console.log('starting'); setTimeout(()=>{}, 60000)"`;
// Talks for ~8s. Used only where a killed run must be distinguishable from an unkilled one by
// wall-clock: the gap has to be wide enough that a loaded machine can't blur the two. A tight
// bound against a 3s command is exactly the kind of red that means "the box was busy".
const VERY_SLOW = `node -e "let n=0; const t=setInterval(()=>{console.log('tick'+(++n)); if(n>31){clearInterval(t); process.exit(0);}}, 250)"`;

function gate(dir, mode, stdin = '{}', env = {}, arg) {
  return spawnSync(process.execPath, arg ? [GATE, mode, arg] : [GATE, mode], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
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

// --- Hang detection by SILENCE, not duration. ---

// 12. A gate that never prints is killed, reported, and does NOT block (exit 0).
dir = tmpRepo(JSON.stringify({ gates: { test: HANG }, silence: { test: 1 } }));
arm(dir);
let startedAt = Date.now();
r = gate(dir, 'full');
assert.ok(Date.now() - startedAt < 30000, 'a hung gate must be killed at its silence budget, not run to completion');
assert.strictEqual(r.status, 0, 'a hung gate must surface (exit 0), not block into another hang');
assert.ok(r.stderr.includes('printed nothing for 1s'), 'the report must say it went silent, and for how long');
assert.ok(r.stderr.includes('hung, not slow'), 'the report must distinguish hung from slow');
assert.ok(r.stderr.includes('testChanged'), 'hang advice must point at the scoped-test escape hatch');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-retries')), 'a hang must not consume the retry budget');
assert.strictEqual(fs.readFileSync(path.join(dir, '.ristretto', 'gate-stalled'), 'utf8'), 'test',
  'a hang must be recorded so the close step can report the work as unverified');

// 13. verify mode reports a hang too, and fails (exit 1) rather than passing it off as green.
r = gate(dir, 'verify');
assert.strictEqual(r.status, 1, 'a hung gate in verify must exit 1');
assert.ok(r.stdout.includes('test ✗'), 'verify must mark the hung gate failed in its summary');

// 14. THE REGRESSION TEST. A gate that runs far longer than its silence budget but keeps
//     printing is working, not hung, and must be left alone to finish. A duration cap would
//     kill this; watching the output stream does not.
dir = tmpRepo(JSON.stringify({ gates: { test: SLOW }, silence: { test: 1 } }));
arm(dir);
startedAt = Date.now();
r = gate(dir, 'full');
const slowRanFor = Date.now() - startedAt;
assert.ok(slowRanFor > 2500, `the slow gate must actually have run its course (ran ${slowRanFor}ms)`);
assert.strictEqual(r.status, 0, 'a slow but talking gate must pass, not be killed');
assert.ok(!r.stderr.includes('printed nothing'), 'a gate that keeps printing must never be called hung');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-stalled')), 'a slow gate must not be recorded as stalled');

// 15. Output resets the clock: a gate that starts, prints, then wedges is still caught.
dir = tmpRepo(JSON.stringify({ gates: { test: STALL }, silence: { test: 1 } }));
arm(dir);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a gate that stalls mid-run must surface');
assert.ok(r.stderr.includes('printed nothing for 1s'), 'the stall must be detected after the last output');

// 16. No duration cap by default: a gate slower than any budget still passes on its own terms.
dir = tmpRepo(JSON.stringify({ gates: { test: SLOW } }));
arm(dir);
assert.strictEqual(gate(dir, 'full').status, 0, 'with no timeouts configured, nothing caps a working gate');

// 17. A hard cap is opt-in and still works when asked for — it kills a talking gate too.
dir = tmpRepo(JSON.stringify({ gates: { test: VERY_SLOW }, timeouts: { test: 1 } }));
arm(dir);
startedAt = Date.now();
r = gate(dir, 'full');
const cappedAfter = Date.now() - startedAt;
assert.ok(cappedAfter < 5000, `an explicit hard cap must cut a long gate short (ran ${cappedAfter}ms of a ~8s command)`);
assert.strictEqual(r.status, 0, 'a hard-capped gate must surface, not block');
assert.ok(r.stderr.includes('hard cap of 1s'), 'a hard-cap kill must be named as such, not as a stall');

// --- Scoped tests: the loop tests what changed, verify tests everything. ---

// SCOPED/FULL each append a distinct char to ./count so we can tell which ran.
const SCOPED = `node -e "require('fs').appendFileSync('count', 's')"`;
const FULL = `node -e "require('fs').appendFileSync('count', 'f')"`;
const trace = (d) => { try { return fs.readFileSync(path.join(d, 'count'), 'utf8'); } catch { return ''; } };

// 18. full mode prefers gates.testChanged; verify mode always runs the whole suite.
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: SCOPED } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
assert.strictEqual(gate(dir, 'full').status, 0);
assert.strictEqual(trace(dir), 's', 'the loop must run the scoped test gate when one is configured');
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0, 'verify must exit 0 when green');
assert.strictEqual(trace(dir), 'sf', 'verify must run the FULL suite, never the scoped one');
assert.ok(r.stdout.includes('test ✓'), 'verify must print a gate summary');

// 19. verify ignores the green-tree cache — its whole job is to re-prove the tree.
gate(dir, 'verify');
assert.strictEqual(trace(dir), 'sff', 'verify must not be short-circuited by the fingerprint cache');

// 20. Without testChanged, the loop falls back to the full test gate (today's behavior).
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
assert.strictEqual(gate(dir, 'full').status, 0);
assert.strictEqual(trace(dir), 'f', 'no testChanged → the full suite still runs, unchanged behavior');

// 21. {files} in a scoped command is substituted with the touched files.
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

// 22. {files} with an untouched tree → nothing to scope to, so the test gate is skipped, not
//     run bare (which would silently become a full-suite run at the worst possible moment).
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: ARGS } }));
arm(dir);
assert.strictEqual(gate(dir, 'full').status, 0);
assert.ok(!fs.existsSync(path.join(dir, 'args')), 'an untouched tree must not run a bare scoped command');
assert.strictEqual(trace(dir), '', 'an untouched tree must not fall back to the full suite either');

// 23. A scoped failure still blocks — scoping changes what runs, never whether it's enforced.
dir = gitTmpRepo(JSON.stringify({ gates: { test: PASS, testChanged: FAIL } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a failing scoped test must block like any other red gate');
assert.ok(r.stderr.includes("gate 'test (changed)' FAILED"), 'the scoped gate must be named as such');

// 24. verify with no gates configured is a no-op success, not a false green claim.
dir = tmpRepo(JSON.stringify({ gates: {} }));
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0);
assert.ok(r.stdout.includes('none configured'), 'verify must say when there was nothing to run');

// --- Toolchain drift: a pre-flight proved with a different binary than the hook runs. ---
// The real-world shape: two installs of the same tool on one machine, the agent prepends the
// working one to PATH for its pre-flight, and the hook — which inherits no such thing — runs
// the other and goes red on an untouched tree. The red looks like a repo problem. It isn't.
if (process.platform !== 'win32') {
  const mkTool = (name, body) => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristretto-bin-'));
    const exe = path.join(binDir, name);
    fs.writeFileSync(exe, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(exe, 0o755);
    return binDir;
  };
  const goodBin = mkTool('faketool', 'echo "1068 tests passed"; exit 0');
  const badBin = mkTool('faketool', 'echo "2 tests failed: shader manifest"; exit 1');

  // 25. verify records the toolchain it proved the tree with, and shows it.
  dir = tmpRepo(JSON.stringify({ gates: { test: 'faketool' } }));
  r = gate(dir, 'verify', '{}', { PATH: `${goodBin}:${process.env.PATH}` });
  assert.strictEqual(r.status, 0, 'the good toolchain must verify green');
  assert.ok(r.stdout.includes(`faketool → ${goodBin}/faketool`), 'verify must show which binary it used');
  const recorded = JSON.parse(fs.readFileSync(path.join(dir, '.ristretto', 'gate-tools.json'), 'utf8'));
  assert.strictEqual(recorded.faketool, `${goodBin}/faketool`, 'verify must record the resolved binary');

  // 26. The hook resolving a DIFFERENT binary names the drift, so the red is explained rather
  //     than blamed on the repo. This is the whole point: the pre-flight proved nothing here.
  arm(dir);
  r = gate(dir, 'full', '{}', { PATH: `${badBin}:${process.env.PATH}` });
  assert.strictEqual(r.status, 2, 'a red gate still blocks');
  assert.ok(r.stderr.includes('is not the one that was verified'), 'the drift must be called out');
  assert.ok(r.stderr.includes(goodBin) && r.stderr.includes(badBin), 'both binaries must be named');
  assert.ok(r.stderr.includes('do not inherit a PATH you exported'), 'the advice must name the actual cause');
  assert.ok(r.stderr.includes('shader manifest'), 'the underlying failure must still be reported');

  // 27. Same binary → no noise. The warning must only fire on a genuine mismatch.
  fs.rmSync(path.join(dir, '.ristretto', 'gate-retries'), { force: true });
  r = gate(dir, 'full', '{}', { PATH: `${goodBin}:${process.env.PATH}` });
  assert.strictEqual(r.status, 0, 'the verified toolchain must pass');
  assert.ok(!r.stderr.includes('is not the one that was verified'), 'no drift warning when nothing drifted');
}

// --- The orchestrator exemption. ---
// brew's main agent writes no source; gating its stops runs a suite against a tree a live
// subagent is mid-edit on, and reports a red that belongs to a half-finished TDD cycle.

// 28. While orchestrating, a Stop is exempt but a SubagentStop is still fully gated.
dir = tmpRepo(JSON.stringify({ gates: { lint: FAIL } }));
arm(dir);
fs.writeFileSync(path.join(dir, '.ristretto', 'orchestrating'), '');
assert.strictEqual(gate(dir, 'full').status, 0, 'an orchestrator Stop must not be gated');
r = gate(dir, 'full', '{}', {}, 'subagent');
assert.strictEqual(r.status, 2, 'a SubagentStop must be gated even while orchestrating');
assert.ok(r.stderr.includes("gate 'lint' FAILED"), 'the subagent gate must still name the failure');

// 29. The exemption is opt-in per run: without the marker, Stop gates exactly as before. pull
//     and shot never write it, because there the main agent IS the implementer.
fs.rmSync(path.join(dir, '.ristretto', 'orchestrating'));
fs.rmSync(path.join(dir, '.ristretto', 'gate-retries'), { force: true });
assert.strictEqual(gate(dir, 'full').status, 2, 'without the marker a red Stop must block as usual');

// 30. The event name from the hook payload identifies a SubagentStop too, so a hooks.json that
//     predates the argument still gates subagents rather than silently exempting them.
fs.writeFileSync(path.join(dir, '.ristretto', 'orchestrating'), '');
fs.rmSync(path.join(dir, '.ristretto', 'gate-retries'), { force: true });
r = gate(dir, 'full', JSON.stringify({ hook_event_name: 'SubagentStop' }));
assert.strictEqual(r.status, 2, 'the payload event name must be enough to identify a subagent stop');

// --- The gate lock: one run at a time, repo-wide. ---

// 31. A held lock is waited on, never run through. THE KEY PROPERTY: it BLOCKS rather than
//     waving the stop through. Exiting 0 here would let an agent stop with the gates never run
//     — the self-reporting this whole mechanism exists to replace. A lock conflict is transient
//     (unlike a hang), so telling the agent to try again is exactly right.
const lockDir = (d) => path.join(d, '.ristretto', 'gate-lock');
dir = tmpRepo(JSON.stringify({ gates: { test: COUNT }, lockWait: 1 }));
arm(dir);
fs.mkdirSync(path.join(dir, '.ristretto'), { recursive: true });
fs.writeFileSync(lockDir(dir), JSON.stringify({ pid: process.pid, label: 'a full suite', at: Date.now() })); // ours = alive
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a lock conflict must block, not wave the stop through unverified');
assert.strictEqual(runs(dir), 0, 'the gates must NOT run while another run holds the lock');
assert.ok(r.stderr.includes('UNVERIFIED'), 'a lock conflict must be reported as unverified, not as red');
assert.ok(r.stderr.includes('a full suite'), 'the report must name who is holding the lock');
assert.ok(r.stderr.includes('Nothing is wrong with your work'), 'the agent must not be sent hunting for a defect');

// 32. It cannot block forever: the shared retry budget bounds it, then it surfaces.
assert.strictEqual(gate(dir, 'full').status, 2, 'second lock conflict still blocks');
assert.strictEqual(gate(dir, 'full').status, 2, 'third lock conflict still blocks');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a wedged lock must surface, not loop forever');
assert.ok(r.stderr.includes('appears wedged'), 'the surfaced message must name the cause');
assert.strictEqual(runs(dir), 0, 'no gate may have run during any of that');

// 33. A lock left by a dead process is stolen, not obeyed forever.
fs.writeFileSync(lockDir(dir), JSON.stringify({ pid: 0x7ffffffe, label: 'a crashed run', at: Date.now() }));
assert.strictEqual(gate(dir, 'full').status, 0, 'a stale lock must not wedge the gates');
assert.strictEqual(runs(dir), 1, 'a stale lock must be stolen and the gates run');

// 34. Pid reuse must not make a lock immortal. A live pid on an ancient lock is a recycled
//     number, not a two-hour gate run — no gate can outlive the hook backstop.
fs.writeFileSync(path.join(dir, 'x.txt'), 'bust'); // (no git repo here, but keep it honest)
fs.writeFileSync(lockDir(dir), JSON.stringify({
  pid: process.pid, label: 'a recycled pid', at: Date.now() - 3 * 60 * 60 * 1000 }));
assert.strictEqual(gate(dir, 'full').status, 0, 'an ancient lock must be stolen despite a live pid');
assert.strictEqual(runs(dir), 2, 'the gates must actually run after stealing a recycled-pid lock');

// 35. The lock is released on exit, so back-to-back runs are not blocked by the previous one.
//     Three consecutive gate runs have now happened in this repo with no lock left behind.
assert.strictEqual(gate(dir, 'full').status, 0);
assert.strictEqual(runs(dir), 3, 'the lock must be released when a run finishes');
assert.ok(!fs.existsSync(path.join(dir, '.ristretto', 'gate-lock')), 'no lock file may survive a finished run');

// 36. verify refuses to claim green it could not prove — a lock conflict is exit 1, not 0.
dir = tmpRepo(JSON.stringify({ gates: { test: PASS }, lockWait: 1 }));
fs.mkdirSync(path.join(dir, '.ristretto'), { recursive: true });
fs.writeFileSync(path.join(dir, '.ristretto', 'gate-lock'),
  JSON.stringify({ pid: process.pid, label: 'a full suite', at: Date.now() }));
r = gate(dir, 'verify');
assert.strictEqual(r.status, 1, 'verify must not report success it never established');
assert.ok(r.stderr.includes('UNVERIFIED'), 'verify must say the tree is unverified, not red');

// --- verify cached: do not re-pay for an unchanged tree. ---

// 37. A plain verify always re-runs; `verify cached` returns the stored verdict for the same tree.
dir = gitTmpRepo(JSON.stringify({ gates: { test: COUNT } }));
assert.strictEqual(gate(dir, 'verify').status, 0, 'the first verify must run and pass');
assert.strictEqual(runs(dir), 1, 'the first verify must actually execute the suite');
r = gate(dir, 'verify', '{}', {}, 'cached');
assert.strictEqual(r.status, 0, 'a cached green tree must verify green');
assert.strictEqual(runs(dir), 1, 'an unchanged tree must NOT re-run the suite in cached mode');
assert.ok(r.stdout.includes('cached green'), 'a cached verdict must say it was cached');

// 38. Any change to the tree makes the cache miss — the pre-flight is real again.
fs.writeFileSync(path.join(dir, 'src.txt'), 'moved on');
assert.strictEqual(gate(dir, 'verify', '{}', {}, 'cached').status, 0);
assert.strictEqual(runs(dir), 2, 'a changed tree must re-run even in cached mode');

// --- Format scoping: the convenience formatter stays where it belongs. ---
const MARK = `node -e "require('fs').appendFileSync(process.argv[1] + '.formatted', 'x')" {file}`;
const formatted = (f) => fs.existsSync(f + '.formatted');

// 39. With formatPaths set, a file inside the patterns is formatted and one outside is left alone.
dir = tmpRepo(JSON.stringify({ gates: { format: MARK, formatPaths: ['src/**/*.{ts,tsx}'] } }));
fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
const code = path.join(dir, 'src', 'deep', 'a.ts');
const doc = path.join(dir, 'DEPLOY.md');
fs.writeFileSync(code, 'x');
fs.writeFileSync(doc, '# heading');
assert.strictEqual(gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: code } })).status, 0);
assert.ok(formatted(code), 'a file matching formatPaths must still be formatted');
assert.strictEqual(gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: doc } })).status, 0);
assert.ok(!formatted(doc), 'a file outside formatPaths must be left completely alone');

// 40. `**/` matches zero directories too, so `src/**/*.ts` covers `src/a.ts`.
const shallow = path.join(dir, 'src', 'b.ts');
fs.writeFileSync(shallow, 'x');
gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: shallow } }));
assert.ok(formatted(shallow), '**/ must match zero directories as well as many');

// 41. Unconfigured formatPaths keeps today's behavior — everything is formatted.
dir = tmpRepo(JSON.stringify({ gates: { format: MARK } }));
const anything = path.join(dir, 'README.md');
fs.writeFileSync(anything, 'x');
gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: anything } }));
assert.ok(formatted(anything), 'without formatPaths the formatter must behave exactly as before');

// --- Stale marker: a dead session must not arm a live one. ---

// 42. A marker with no gate activity for a day is a leftover, not a pull. It is reported and ignored.
dir = tmpRepo(JSON.stringify({ gates: { lint: FAIL } }));
arm(dir);
const old = Date.now() / 1000 - 48 * 3600;
fs.utimesSync(path.join(dir, '.ristretto', 'pulling'), old, old);
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a stale marker must not gate a session that never asked');
assert.ok(r.stderr.includes('no gate run for 48h'), 'the staleness must be reported as idleness, with its duration');
assert.ok(r.stderr.includes('delete it'), 'the report must say how to clear it');

// 43. A fresh marker gates exactly as before — the age-out must not weaken a live pull.
arm(dir);
assert.strictEqual(gate(dir, 'full').status, 2, 'a fresh marker must still gate');

// 44. THE REGRESSION THAT MATTERS HERE. Staleness is measured from the last gate run, not from
//     when the marker was created — every armed run touches it. Without this, an unattended
//     batch that runs longer than the window would silently disarm its own gates halfway
//     through, which is the exact opposite of what a long run needs.
dir = tmpRepo(JSON.stringify({ gates: { lint: PASS } }));
arm(dir);
const marker = path.join(dir, '.ristretto', 'pulling');
const halfWay = Date.now() / 1000 - 12 * 3600; // idle a while, but not aged out
fs.utimesSync(marker, halfWay, halfWay);
assert.strictEqual(gate(dir, 'full').status, 0, 'a marker within the window must still gate');
const idleAfter = Date.now() - fs.statSync(marker).mtimeMs;
assert.ok(idleAfter < 60000, `a gate run must reset the marker's idle clock (was ${Math.round(idleAfter / 1000)}s)`);

// --- Routed testChanged: a polyglot repo needs more than one runner. ---
// A single command string gets EVERY changed path substituted into it, so on a backend+frontend
// repo `pytest {files}` would be handed .tsx files. Routed, each runner sees only its own — and
// a runner with nothing to do never starts, which is where the wall-clock actually goes.
const BE = `node -e "require('fs').appendFileSync('args', 'BE:' + process.argv.slice(1).join(',') + '\\n')" {files}`;
const FE = `node -e "require('fs').appendFileSync('args', 'FE:' + process.argv.slice(1).join(',') + '\\n')" {files}`;
const ran = (d) => { try { return fs.readFileSync(path.join(d, 'args'), 'utf8'); } catch { return ''; } };

const routed = (extra = []) => JSON.stringify({
  gates: {
    test: FULL,
    testChanged: [
      { match: ['backend/**/*.py'], cmd: BE, name: 'backend' },
      { match: ['frontend/**/*.{ts,tsx}'], cmd: FE, name: 'frontend' },
      ...extra,
    ],
  },
});

function polyRepo(config) {
  const d = gitTmpRepo(config);
  fs.mkdirSync(path.join(d, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(d, 'frontend'), { recursive: true });
  return d;
}

// 45. Each route receives ONLY its own files — never the other stack's.
dir = polyRepo(routed());
arm(dir);
fs.writeFileSync(path.join(dir, 'backend', 'api.py'), 'x');
fs.writeFileSync(path.join(dir, 'frontend', 'ui.tsx'), 'x');
assert.strictEqual(gate(dir, 'full').status, 0, 'a routed run must exit 0 when green');
let out = ran(dir);
assert.ok(/BE:[^\n]*backend\/api\.py/.test(out), 'the backend route must receive its .py file');
assert.ok(!/BE:[^\n]*\.tsx/.test(out), 'the backend route must NEVER receive a .tsx file');
assert.ok(/FE:[^\n]*frontend\/ui\.tsx/.test(out), 'the frontend route must receive its .tsx file');
assert.ok(!/FE:[^\n]*\.py/.test(out), 'the frontend route must never receive a .py file');
assert.strictEqual(trace(dir), '', 'a fully routed change must never fall back to the full suite');

// 46. THE ONE THAT SAVES THE TIME. A change touching only one stack must not start the other's
//     suite at all — that is the whole difference between an 11-minute stop and a 20-second one.
dir = polyRepo(routed());
arm(dir);
fs.writeFileSync(path.join(dir, 'frontend', 'only.tsx'), 'x');
assert.strictEqual(gate(dir, 'full').status, 0);
out = ran(dir);
assert.ok(out.includes('FE:'), 'the touched stack must be tested');
assert.ok(!out.includes('BE:'), 'the untouched stack must NOT run at all');

// 47. Fail-safe: a changed file matching no route runs the FULL suite rather than a partial
//     one. An unrecognised path may be exactly the one that breaks everything, and a green
//     that quietly skipped it would be a lie.
dir = polyRepo(routed());
arm(dir);
fs.writeFileSync(path.join(dir, 'backend', 'api.py'), 'x');
fs.writeFileSync(path.join(dir, 'infra.tf'), 'resource {}'); // routed nowhere
r = gate(dir, 'full');
assert.strictEqual(r.status, 0);
assert.strictEqual(trace(dir), 'f', 'an unrouted file must force the full suite');
assert.strictEqual(ran(dir), '', 'no partial route may run when the full suite was chosen');
assert.ok(r.stderr.includes('match no "testChanged" route'), 'the fallback must say why it happened');
assert.ok(r.stderr.includes('infra.tf'), 'the fallback must name the unrouted file');

// 48. An empty cmd claims files deliberately — the explicit "these need no tests" route.
dir = polyRepo(routed([{ match: ['**/*.md', '*.tf'], cmd: '' }]));
arm(dir);
fs.writeFileSync(path.join(dir, 'README.md'), '# docs');
fs.writeFileSync(path.join(dir, 'infra.tf'), 'resource {}');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0);
assert.strictEqual(trace(dir), '', 'a claimed-but-untested change must not trigger the full suite');
assert.strictEqual(ran(dir), '', 'an empty cmd must run nothing');
assert.ok(!r.stderr.includes('match no'), 'an explicitly claimed file is not unrouted');

// 49. A failing route still blocks, and names which route failed.
dir = polyRepo(JSON.stringify({ gates: { test: PASS, testChanged: [{ match: ['backend/**'], cmd: FAIL, name: 'backend' }] } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'backend', 'api.py'), 'x');
r = gate(dir, 'full');
assert.strictEqual(r.status, 2, 'a failing route must block like any other red gate');
assert.ok(r.stderr.includes("gate 'test (changed: backend)' FAILED"), 'the failing route must be named');

// 50. verify ignores routing entirely — its job is to prove the whole repo.
dir = polyRepo(routed());
fs.writeFileSync(path.join(dir, 'frontend', 'only.tsx'), 'x');
r = gate(dir, 'verify');
assert.strictEqual(r.status, 0);
assert.strictEqual(trace(dir), 'f', 'verify must run the FULL suite regardless of routes');
assert.strictEqual(ran(dir), '', 'verify must never run a scoped route');

// --- The slow-unscoped-suite hint. Measured, not guessed, so it fires in any language. ---
// A `.ristretto.json` that already exists is exactly where "add testChanged" gets skipped: the
// repo looks configured, so nobody looks. The runner is the one thing that knows, from the clock,
// that the suite is slow enough for it to matter.

// 51. A slow full suite with no testChanged says so, and shows both config forms.
const SLOW_TEST = `node -e "let n=0; const t=setInterval(()=>{console.log('t'+(++n)); if(n>4){clearInterval(t); process.exit(0);}}, 250)"`;
dir = tmpRepo(JSON.stringify({ gates: { test: SLOW_TEST } }));
arm(dir);
r = gate(dir, 'full', '{}', {}, undefined);
assert.strictEqual(r.status, 0, 'a green slow suite must still pass');
// The real threshold is 60s; assert the mechanism instead of waiting a minute for it.
assert.ok(!r.stderr.includes('will run again at every stop'),
  'a suite under the threshold must NOT nag — the hint has to stay rare enough to be read');

// 52. The hint never fires when testChanged is already configured — no nagging about a
//     setting the repo has already made.
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: SCOPED } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0);
assert.ok(!r.stderr.includes('will run again at every stop'), 'a configured repo must never see the hint');
assert.strictEqual(trace(dir), 's', 'and it must be running the scoped gate, not the full one');



// 53. A run that has to queue says so IMMEDIATELY, not only when it gives up. This is the whole
//     lesson of the stall: an agent that emits nothing for ~10 minutes is killed, and a killed
//     agent's result is lost entirely — so a silent wait costs far more than the wait itself.
dir = tmpRepo(JSON.stringify({ gates: { test: COUNT }, lockWait: 1 }));
arm(dir);
fs.mkdirSync(path.join(dir, '.ristretto'), { recursive: true });
fs.writeFileSync(lockDir(dir), JSON.stringify({ pid: process.pid, label: 'a full suite', at: Date.now() }));
r = gate(dir, 'full');
assert.ok(r.stderr.includes('waiting for the gate lock'),
  'a queued run must announce the wait, not sit silent until the deadline');
assert.ok(r.stderr.includes('a full suite'), 'and name what it is waiting on');
assert.strictEqual(runs(dir), 0, 'announcing must not mean running');

// 54. The default wait is a CEILING, not a preference: it exists to end before the caller is
//     killed for going quiet. A future edit that raises it past the stall watchdog would restore
//     exactly the failure this replaced — a subagent killed mid-wait, its work stranded unproven.
const gateSrc = fs.readFileSync(path.join(__dirname, 'gate.js'), 'utf8');
const declared = /const DEFAULT_LOCK_WAIT = (\d+);/.exec(gateSrc);
assert.ok(declared, 'DEFAULT_LOCK_WAIT must stay a plain literal this check can read');
assert.ok(Number(declared[1]) <= 600,
  `DEFAULT_LOCK_WAIT is ${declared[1]}s — it must stay under the ~600s agent stall watchdog`);
// 55. The scoped-gate hint must stay rare: a scoped run that is actually fast says nothing. A hint
//     that fires on every loop is a hint nobody reads by the third feature.
dir = gitTmpRepo(JSON.stringify({ gates: { test: FULL, testChanged: SCOPED } }));
arm(dir);
fs.writeFileSync(path.join(dir, 'src.txt'), 'touched');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0);
assert.ok(!r.stderr.includes('that is the fast path'), 'a fast scoped gate must not be flagged as slow');

// 56. And its threshold is a ceiling for the same reason the lock's is: it exists to be read by
//     whoever is still alive. Past the stall watchdog the advice arrives after the run it would
//     have saved. (The firing path itself is not exercised here — it needs a five-minute gate.)
const scopedHint = /const SLOW_SCOPED_HINT_MS = ([^;]+);/.exec(gateSrc);
assert.ok(scopedHint, 'SLOW_SCOPED_HINT_MS must stay a plain literal this check can read');
assert.ok(eval(scopedHint[1]) <= 600 * 1000,
  'SLOW_SCOPED_HINT_MS must stay under the ~600s agent stall watchdog');
assert.ok(/gate\.key === 'testChanged' && scopedMs >= SLOW_SCOPED_HINT_MS/.test(gateSrc),
  'the hint must stay wired to the scoped gate — an unwired hint is silently never emitted');

// 57. THE ONE THAT WOULD HAVE SAVED THE RUN. A scoped route that dropped a flag its full `test`
//     gate carries is named before anything slow happens — structurally, without knowing what the
//     flag means. Nothing about this config looks wrong to a reader; only the two commands side by
//     side show that the fast path lost the parallelism the slow one has.
const POLY = {
  test: 'cd backend && pytest -q -n auto && cd .. && cd frontend && npm run test',
  testChanged: [
    { name: 'backend', match: ['backend/**/*.py'], cmd: 'pytest -q {files}' },
    { name: 'frontend', match: ['frontend/**'], cmd: 'cd frontend && npm run test' },
  ],
};
dir = gitTmpRepo(JSON.stringify({ gates: POLY }));
arm(dir);
r = gate(dir, 'verify');
assert.ok(r.stderr.includes("missing a flag its full \"test\" gate has: -n auto"),
  'the dropped flag must be named exactly, at pre-flight, before a single subagent runs');
assert.ok(r.stderr.includes('backend'), 'and it must say WHICH route dropped it');

// 58. And it must not cry wolf on the polyglot case it was written for: the frontend route shares
//     `npm run test` with the same chained gate, and the backend's flags are not its to carry.
//     A check that flags every well-configured multi-stack repo would be turned off within a day.
assert.ok(!/changed: frontend'\) is missing|changed: frontend' is missing/.test(r.stderr),
  'a route matching a different segment of the chain must not inherit the other stack\'s flags');

// 59. Once the flag is carried across, the runner goes quiet — the signal has to clear, or it
//     becomes background noise nobody reads.
const FIXED = JSON.parse(JSON.stringify(POLY));
FIXED.testChanged[0].cmd = 'pytest -q -n auto {files}';
dir = gitTmpRepo(JSON.stringify({ gates: FIXED }));
arm(dir);
r = gate(dir, 'verify');
assert.ok(!r.stderr.includes('missing a flag'), 'a corrected config must produce no advice at all');

// 60. THE SILENT ONE. A leftover `orchestrating` marker turns Stop gating off — no error, no
//     symptom, nothing to notice until something red is committed. A brew that dies without
//     disarming leaves exactly that behind, and before this the exemption never expired.
dir = tmpRepo(JSON.stringify({ gates: { test: COUNT } }));
arm(dir);
const orchPath = path.join(dir, '.ristretto', 'orchestrating');
fs.writeFileSync(orchPath, '');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'a live brew orchestrator is still exempt');
assert.strictEqual(runs(dir), 0, 'and exempt means no gate ran');

const stale = Date.now() / 1000 - 3 * 60 * 60; // 3h without a single subagent stop
fs.utimesSync(orchPath, stale, stale);
r = gate(dir, 'full');
assert.ok(r.stderr.includes('leftover from a dead brew'), 'a stale exemption must be named, not honoured');
assert.strictEqual(runs(dir), 1, 'and the gates must actually run — an expired exemption is no exemption');

// 61. A subagent stopping is the only thing that proves the loop is alive, so it — and nothing
//     else — keeps the exemption current. Without this a long feature would expire its own brew.
r = gate(dir, 'full', undefined, {}, 'subagent');
assert.ok(Date.now() - fs.statSync(orchPath).mtimeMs < 60 * 1000,
  'a subagent gate must refresh the exemption it runs under');
r = gate(dir, 'full');
assert.strictEqual(r.status, 0, 'and the orchestrator is exempt again once the loop has proven itself alive');

console.log('gate.test.js: all checks passed');
