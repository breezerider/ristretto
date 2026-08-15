#!/usr/bin/env node
// ristretto gate runner — deterministic gates, framework-agnostic via .ristretto.json.
// Node instead of bash+jq so it runs identically on Windows, macOS, Linux.
//
// Modes:
//   quick   PostToolUse hook. Formats the touched file. ALWAYS exits 0 (convenience, not gate).
//   full    Stop/SubagentStop hook. Runs lint + typecheck + test. Exits 2 on failure (blocks the
//           agent), but ONLY while .ristretto/pulling exists. Outside a pull: exits 0 immediately.
//           Uses gates.testChanged (scoped to the touched files) when configured — the loop stays
//           fast; the full suite is proven once at the end via `verify`.
//   verify  Not a hook — run directly (`node gate.js verify`). Runs lint + typecheck + the FULL
//           test gate, ignoring both the marker and the green-tree cache. Prints a one-line
//           summary. Exits 0 green, 1 red. This is brew's pre-flight and its end-of-run proof.
//
// Every gate runs under a timeout (.ristretto.json "timeouts", seconds). A gate that hangs is
// reported and surfaced immediately — never retried, because retrying a hang just hangs longer.
//
// Reads hook JSON from stdin (Claude Code protocol) in quick/full mode.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const MODE = process.argv[2] || 'quick';
const MAX_RETRIES = 3;

// Seconds. The sum of lint + typecheck + test must stay under the hook timeout in hooks.json,
// or the hook is killed before it can report anything — which is the failure these exist to end.
const DEFAULT_TIMEOUTS = { format: 30, lint: 180, typecheck: 300, test: 900, testChanged: 300 };

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const configPath = path.join(projectDir, '.ristretto.json');
const markerPath = path.join(projectDir, '.ristretto', 'pulling');
const retriesPath = path.join(projectDir, '.ristretto', 'gate-retries');
const greenPath = path.join(projectDir, '.ristretto', 'gate-green');
const timeoutPath = path.join(projectDir, '.ristretto', 'gate-timeout');

// No config → ristretto not set up in this repo → never interfere.
if (!fs.existsSync(configPath)) process.exit(0);

let hook = {};
if (MODE !== 'verify') {
  try { hook = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* no/bad stdin is fine */ }
}

let gates = {};
let timeouts = DEFAULT_TIMEOUTS;
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  gates = config.gates || {};
  timeouts = { ...DEFAULT_TIMEOUTS, ...(config.timeouts || {}) };
} catch (e) {
  if (MODE === 'verify') {
    console.error(`ristretto: .ristretto.json is unparseable (${e.message}) — fix it, the gate cannot run.`);
    process.exit(1);
  }
  if (MODE === 'full' && fs.existsSync(markerPath)) {
    // Fail closed: a broken config while a pull is active must not silently disarm the gate.
    console.error(`ristretto: .ristretto.json is unparseable (${e.message}) — fix it, the gate cannot run.`);
    process.exit(2);
  }
  process.exit(0);
}

// Returns null on success, or { output, timedOut } on failure.
function run(cmd, timeoutSec) {
  try {
    execSync(cmd, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      timeout: Math.max(1, timeoutSec) * 1000,
      killSignal: 'SIGKILL',
    });
    return null;
  } catch (e) {
    const output = ((e.stdout || '') + (e.stderr || '')) || String(e.message);
    // execSync surfaces a timeout kill as ETIMEDOUT, or as the kill signal itself.
    const timedOut = e.code === 'ETIMEDOUT' || e.signal === 'SIGKILL' || e.killed === true;
    return { output, timedOut };
  }
}

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// Paths of every dirty or untracked file, as git reports them.
function dirtyPaths() {
  const status = git('status --porcelain -uall');
  if (status === null) return null;
  return status.split('\n').filter(Boolean).map((line) => {
    let p = line.slice(3);
    if (p.includes(' -> ')) p = p.split(' -> ')[1];
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1).replace(/\\(.)/g, '$1');
    return p;
  });
}

// Fingerprint of the working tree: HEAD + status + content of every dirty/untracked
// file. If the tree is byte-identical to one that already passed the gates, re-running
// them proves nothing — subagents that change no code (reviewers, closers) would
// otherwise pay a full test-suite run at every stop. Returns null outside a git repo:
// no caching, gates always run.
function treeFingerprint() {
  const head = git('rev-parse HEAD');
  const paths = dirtyPaths();
  if (head === null || paths === null) return null;
  const h = crypto.createHash('sha256');
  h.update(head + '\0' + paths.join('\0'));
  for (const p of paths) {
    try { h.update(fs.readFileSync(path.join(projectDir, p))); } catch { h.update('\0gone'); }
    h.update('\0');
  }
  return h.digest('hex');
}

// The test gate to run at this point in the lifecycle.
// scoped → prefer gates.testChanged, which tests only what this feature touched. A command
// containing {files} gets the touched file list substituted; one that doesn't (`vitest run
// --changed`, `jest -o`) is run as-is and works out the scope itself.
// Returns null when there is nothing to run — no command, or {files} with an untouched tree.
function testGate(scoped) {
  const useChanged = scoped && gates.testChanged;
  const cmd = useChanged ? gates.testChanged : gates.test;
  if (!cmd) return null;
  const key = useChanged ? 'testChanged' : 'test';
  if (!cmd.includes('{files}')) return { key, label: useChanged ? 'test (changed)' : 'test', cmd };
  const files = (dirtyPaths() || []).filter((p) => {
    try { return fs.statSync(path.join(projectDir, p)).isFile(); } catch { return false; }
  });
  if (!files.length) return null; // nothing touched → nothing to scope a run to
  return { key, label: 'test (changed)', cmd: cmd.replace('{files}', files.map((f) => `"${f}"`).join(' ')) };
}

// The gates for one pass, in order. Lint and typecheck are always repo-wide: they're cheap
// next to a test suite, and a scoped typecheck is a contradiction in terms.
function gateList(scoped) {
  const list = [];
  for (const key of ['lint', 'typecheck']) {
    if (gates[key]) list.push({ key, label: key, cmd: gates[key] });
  }
  const test = testGate(scoped);
  if (test) list.push(test);
  return list;
}

function timeoutAdvice(gate) {
  return [
    `ristretto: gate '${gate.label}' did not finish within ${timeouts[gate.key]}s and was killed.`,
    `  A hung gate is not a red gate — the work is UNVERIFIED, not proven broken.`,
    `  Fix the hang, or in .ristretto.json: set "gates".."testChanged" to a scoped test command`,
    `  (e.g. "npx vitest run {files}" / "npx jest --findRelatedTests {files}" / "pytest {files}"),`,
    `  and/or raise "timeouts"."${gate.key}".`,
  ].join('\n');
}

if (MODE === 'quick') {
  const file = hook.tool_input && hook.tool_input.file_path;
  if (gates.format && file && fs.existsSync(file)) {
    run(gates.format.replace('{file}', `"${file}"`), timeouts.format); // convenience only — never block, stay quiet
  }
  process.exit(0);
}

if (MODE === 'verify') {
  // Full scope, no cache, no marker required. Green here is the real proof.
  const results = [];
  let failures = '';
  let timedOut = false;
  for (const gate of gateList(false)) {
    const result = run(gate.cmd, timeouts[gate.key]);
    if (result === null) {
      results.push(`${gate.label} ✓`);
      continue;
    }
    results.push(`${gate.label} ✗`);
    if (result.timedOut) {
      timedOut = true;
      failures += `\n${timeoutAdvice(gate)}`;
    } else {
      failures += `\n--- ristretto gate '${gate.label}' FAILED ---\n${result.output.split('\n').slice(-40).join('\n')}`;
    }
  }
  if (!results.length) {
    console.log('gates: none configured — nothing to verify');
    process.exit(0);
  }
  console.log(`gates: ${results.join(' ')}`);
  if (failures) {
    console.error(failures);
    process.exit(1);
  }
  // A clean verify is the strongest green there is — seed the cache with it.
  if (!timedOut) {
    const green = treeFingerprint();
    if (green !== null) {
      try { fs.mkdirSync(path.dirname(greenPath), { recursive: true }); fs.writeFileSync(greenPath, green); } catch { /* best-effort */ }
    }
  }
  process.exit(0);
}

if (MODE === 'full') {
  if (!fs.existsSync(markerPath)) process.exit(0); // only gate while a pull is active

  // Tree unchanged since the last green run → already proven, skip.
  const fp = treeFingerprint();
  let lastGreen = null;
  try { lastGreen = fs.readFileSync(greenPath, 'utf8'); } catch { /* no green run yet */ }
  if (fp !== null && fp === lastGreen) process.exit(0);

  let failures = '';
  for (const gate of gateList(true)) {
    const result = run(gate.cmd, timeouts[gate.key]);
    if (result === null) continue;
    if (result.timedOut) {
      // Surface immediately. Blocking here would send the agent back to a gate that hangs
      // again, burning the whole retry budget on the same wall — the exact wedge this avoids.
      try { fs.mkdirSync(path.dirname(timeoutPath), { recursive: true }); fs.writeFileSync(timeoutPath, gate.label); } catch { /* best-effort */ }
      console.error(timeoutAdvice(gate));
      process.exit(0);
    }
    failures += `\n--- ristretto gate '${gate.label}' FAILED ---\n${result.output.split('\n').slice(-40).join('\n')}`;
  }

  if (!failures) {
    try { fs.unlinkSync(retriesPath); } catch { /* never existed */ }
    // Recompute — the gate commands themselves may have written artifacts.
    const green = treeFingerprint();
    if (green !== null) {
      try { fs.writeFileSync(greenPath, green); } catch { /* cache is best-effort */ }
    }
    process.exit(0);
  }

  let retries = 0;
  try { retries = parseInt(fs.readFileSync(retriesPath, 'utf8'), 10) || 0; } catch { /* first failure */ }
  if (retries >= MAX_RETRIES) {
    try { fs.unlinkSync(retriesPath); } catch { /* ignore */ }
    console.error(`ristretto: gates still failing after ${MAX_RETRIES} forced retries — surfacing to user instead of looping.${failures}`);
    process.exit(0);
  }
  fs.writeFileSync(retriesPath, String(retries + 1));
  console.error(`ristretto: work is not done — deterministic gates failed. Fix these before stopping. Do NOT weaken, skip, or delete gates/tests to get green.${failures}`);
  process.exit(2);
}

process.exit(0);
