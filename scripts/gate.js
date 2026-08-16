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
// Hang detection is by SILENCE, not duration. A slow suite is still working and prints as it
// goes; a hung one goes quiet. Killing on total runtime would murder a legitimately slow suite
// and call it broken, so there is no duration cap by default — set `timeouts` to opt into one.
// A stalled gate is reported and surfaced immediately, never retried: retrying a hang re-hangs.
//
// Reads hook JSON from stdin (Claude Code protocol) in quick/full mode.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execSync } = require('child_process');

const MODE = process.argv[2] || 'quick';
const MAX_RETRIES = 3;

// Seconds a gate may produce NO output before it's treated as hung.
// lint and typecheck get a long rope on purpose: tools like `tsc --noEmit` and `eslint .` print
// nothing at all until they finish, so their silence carries no information. Test runners stream
// progress, so silence from one is a much stronger signal.
const DEFAULT_SILENCE = { format: 30, lint: 600, typecheck: 600, test: 300, testChanged: 300 };

// Hard duration caps, seconds. OFF by default — a slow gate is not a broken gate. `format` is the
// exception: it's a per-keystroke convenience on a single file, and its hook is capped anyway.
const DEFAULT_HARD_CAP = { format: 30 };

const POLL_MS = 1000;
const MAX_CAPTURE = 2 * 1024 * 1024; // keep the tail of the output, not all of it

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const configPath = path.join(projectDir, '.ristretto.json');
const markerPath = path.join(projectDir, '.ristretto', 'pulling');
const retriesPath = path.join(projectDir, '.ristretto', 'gate-retries');
const greenPath = path.join(projectDir, '.ristretto', 'gate-green');
const stalledPath = path.join(projectDir, '.ristretto', 'gate-stalled');
const toolsPath = path.join(projectDir, '.ristretto', 'gate-tools.json');

// No config → ristretto not set up in this repo → never interfere.
if (!fs.existsSync(configPath)) process.exit(0);

let hook = {};
if (MODE !== 'verify') {
  try { hook = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* no/bad stdin is fine */ }
}

let gates = {};
let silence = DEFAULT_SILENCE;
let hardCaps = DEFAULT_HARD_CAP;
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  gates = config.gates || {};
  silence = { ...DEFAULT_SILENCE, ...(config.silence || {}) };
  hardCaps = { ...DEFAULT_HARD_CAP, ...(config.timeouts || {}) };
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

// Kill the whole process group. A test runner forks workers; killing only the shell leaves them
// holding the ports and file handles that caused the hang in the first place.
function killTree(child) {
  if (process.platform === 'win32') {
    try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); return; } catch { /* fall through */ }
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

// Returns null on success, or { output, stalled, hardCapped, quietFor } on failure.
// Watches the output stream: a gate that has printed nothing for `silenceSec` is hung, however
// long it has been running in total. `hardCapSec` (undefined = no cap) is a separate opt-in belt.
function run(cmd, { silenceSec, hardCapSec }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd: projectDir,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // own process group, so killTree can take the workers
    });

    const chunks = [];
    let size = 0;
    let lastOutput = Date.now();
    const startedAt = lastOutput;
    let stalled = false;
    let hardCapped = false;

    const capture = (buf) => {
      lastOutput = Date.now();
      chunks.push(buf);
      size += buf.length;
      while (size > MAX_CAPTURE && chunks.length > 1) size -= chunks.shift().length;
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    const watchdog = setInterval(() => {
      const now = Date.now();
      if (silenceSec && now - lastOutput >= silenceSec * 1000) {
        stalled = true;
        clearInterval(watchdog);
        killTree(child);
      } else if (hardCapSec && now - startedAt >= hardCapSec * 1000) {
        hardCapped = true;
        clearInterval(watchdog);
        killTree(child);
      }
    }, POLL_MS);

    const finish = (code) => {
      clearInterval(watchdog);
      const output = Buffer.concat(chunks).toString('utf8');
      if (stalled || hardCapped) {
        return resolve({ output, stalled, hardCapped, quietFor: Math.round((Date.now() - lastOutput) / 1000) });
      }
      resolve(code === 0 ? null : { output: output || `exited with code ${code}`, stalled: false, hardCapped: false });
    };

    child.on('close', (code) => finish(code));
    child.on('error', (err) => {
      clearInterval(watchdog);
      resolve({ output: String(err.message), stalled: false, hardCapped: false });
    });
  });
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

const budget = (gate) => ({ silenceSec: silence[gate.key], hardCapSec: hardCaps[gate.key] });

// --- Which binary is this gate actually going to run? ---
// A pre-flight run by the agent and a gate run by the hook inherit different environments. If
// the agent prepends a workaround toolchain to PATH, `verify` proves a green tree that the hook
// will never reproduce — and the hook's red looks like a repo problem instead of two Flutters.
// So verify records what it resolved, and the hook says so plainly when it resolved something else.

// First word of a shell command, minus quotes and any leading VAR=value assignments.
function firstToken(cmd) {
  for (const word of String(cmd).trim().split(/\s+/)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue; // env prefix, not the program
    return word.replace(/^["']|["']$/g, '');
  }
  return '';
}

function resolveTool(tok) {
  if (!tok || tok.includes('/') || tok.includes('\\')) return tok || null; // already a path
  try {
    const probe = process.platform === 'win32'
      ? spawnSync('where', [tok], { encoding: 'utf8' })
      : spawnSync('/bin/sh', ['-c', `command -v ${tok}`], { encoding: 'utf8' });
    const line = (probe.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)[0];
    return line || null;
  } catch {
    return null;
  }
}

// { flutter: "/usr/bin/flutter", npx: "/usr/local/bin/npx" } for every configured gate command.
function resolveGateTools() {
  const tools = {};
  for (const cmd of Object.values(gates)) {
    if (!cmd) continue;
    const tok = firstToken(cmd);
    if (tok && !(tok in tools)) tools[tok] = resolveTool(tok);
  }
  return tools;
}

// Lines describing every tool the hook resolves differently from the recorded verify run.
function toolDrift(now) {
  let recorded = null;
  try { recorded = JSON.parse(fs.readFileSync(toolsPath, 'utf8')); } catch { return []; }
  const drift = [];
  for (const [tok, was] of Object.entries(recorded)) {
    const is = now[tok];
    if (tok in now && was !== is) {
      drift.push(`ristretto: '${tok}' is not the one that was verified — verify used ${was || '(unresolved)'}, this gate ran ${is || '(unresolved)'}.`);
      drift.push(`  A green pre-flight proves nothing about a different toolchain. Put the intended path in .ristretto.json`);
      drift.push(`  (the hooks do not inherit a PATH you exported in your shell), or fix the install so both resolve the same.`);
    }
  }
  return drift;
}

function hangAdvice(gate, result) {
  const why = result.stalled
    ? `printed nothing for ${silence[gate.key]}s and was killed — it is hung, not slow`
    : `exceeded the hard cap of ${hardCaps[gate.key]}s in .ristretto.json and was killed`;
  return [
    `ristretto: gate '${gate.label}' ${why}.`,
    `  A hung gate is not a red gate — the work is UNVERIFIED, not proven broken.`,
    `  Find what it's waiting on (an open handle, a port, watch mode, a prompt), or:`,
    `  · scope the run — set "gates"."testChanged" (e.g. "npx jest --findRelatedTests {files}")`,
    `  · if the tool is simply quiet for long stretches, raise "silence"."${gate.key}" (now ${silence[gate.key]}s)`,
  ].join('\n');
}

async function main() {
  if (MODE === 'quick') {
    const file = hook.tool_input && hook.tool_input.file_path;
    if (gates.format && file && fs.existsSync(file)) {
      // convenience only — never block, stay quiet
      await run(gates.format.replace('{file}', `"${file}"`), budget({ key: 'format' }));
    }
    process.exit(0);
  }

  if (MODE === 'verify') {
    // Full scope, no cache, no marker required. Green here is the real proof.
    const results = [];
    let failures = '';
    let hung = false;
    for (const gate of gateList(false)) {
      const result = await run(gate.cmd, budget(gate));
      if (result === null) {
        results.push(`${gate.label} ✓`);
        continue;
      }
      results.push(`${gate.label} ✗`);
      if (result.stalled || result.hardCapped) {
        hung = true;
        failures += `\n${hangAdvice(gate, result)}`;
      } else {
        failures += `\n--- ristretto gate '${gate.label}' FAILED ---\n${result.output.split('\n').slice(-40).join('\n')}`;
      }
    }
    if (!results.length) {
      console.log('gates: none configured — nothing to verify');
      process.exit(0);
    }
    console.log(`gates: ${results.join(' ')}`);
    // Record and show the toolchain this verdict was produced with, so a hook that resolves
    // something else can say so instead of surfacing a mystery red on an untouched tree.
    const tools = resolveGateTools();
    const shown = Object.entries(tools).map(([tok, at]) => `${tok} → ${at || '(not found)'}`);
    if (shown.length) console.log(`tools: ${shown.join('  ')}`);
    try { fs.mkdirSync(path.dirname(toolsPath), { recursive: true }); fs.writeFileSync(toolsPath, JSON.stringify(tools, null, 2)); } catch { /* best-effort */ }
    if (failures) {
      console.error(failures);
      process.exit(1);
    }
    // A clean verify is the strongest green there is — seed the cache with it.
    if (!hung) {
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

    // Did the pre-flight prove a green tree with a different toolchain than this hook runs?
    const drift = toolDrift(resolveGateTools());
    const driftNote = drift.length ? `\n${drift.join('\n')}\n` : '';

    let failures = '';
    for (const gate of gateList(true)) {
      const result = await run(gate.cmd, budget(gate));
      if (result === null) continue;
      if (result.stalled || result.hardCapped) {
        // Surface immediately. Blocking here would send the agent back to a gate that hangs
        // again, burning the whole retry budget on the same wall — the exact wedge this avoids.
        try { fs.mkdirSync(path.dirname(stalledPath), { recursive: true }); fs.writeFileSync(stalledPath, gate.label); } catch { /* best-effort */ }
        console.error(driftNote + hangAdvice(gate, result));
        process.exit(0);
      }
      failures += `\n--- ristretto gate '${gate.label}' FAILED ---\n${result.output.split('\n').slice(-40).join('\n')}`;
    }

    if (!failures) {
      if (driftNote) console.error(driftNote.trim());
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
      console.error(`${driftNote}ristretto: gates still failing after ${MAX_RETRIES} forced retries — surfacing to user instead of looping.${failures}`);
      process.exit(0);
    }
    fs.writeFileSync(retriesPath, String(retries + 1));
    console.error(`${driftNote}ristretto: work is not done — deterministic gates failed. Fix these before stopping. Do NOT weaken, skip, or delete gates/tests to get green.${failures}`);
    process.exit(2);
  }

  process.exit(0);
}

main();
