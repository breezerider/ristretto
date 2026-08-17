#!/usr/bin/env node
// ristretto gate runner — deterministic gates, framework-agnostic via .ristretto.json.
// Node instead of bash+jq so it runs identically on Windows, macOS, Linux.
//
// Modes:
//   quick            PostToolUse hook. Formats the touched file — only if it matches
//                    gates.formatPaths, when that is configured. ALWAYS exits 0 (convenience).
//   full             Stop hook. Runs lint + typecheck + test. Exits 2 on failure (blocks the
//                    agent), but ONLY while .ristretto/pulling exists. Outside a pull: exits 0.
//                    Uses gates.testChanged (scoped to the touched files) when configured — the
//                    loop stays fast; the full suite is proven once at the end via `verify`.
//   full subagent    SubagentStop hook. Same, but never exempt (see ORCHESTRATOR below).
//   verify           Not a hook — run directly (`node gate.js verify`). Runs lint + typecheck +
//                    the FULL test gate, ignoring the marker and the cache. One-line summary.
//                    Exits 0 green, 1 red. brew's pre-flight and its end-of-run proof.
//   verify cached    Same, but a tree byte-identical to one already proven green returns that
//                    verdict instead of re-running. For a pre-flight repeated after a session
//                    restart: re-paying a ten-minute suite to re-prove an unchanged tree is
//                    waste, and waste at the worst moment — before anything has been built.
//
// ORCHESTRATOR. brew's main agent writes no source by design; it dispatches subagents, which are
// gated individually on SubagentStop. Gating its OWN stops means running a suite against a tree a
// live subagent is mid-edit on — a half-applied migration reads as hundreds of red tests that
// belong to nobody. So while .ristretto/orchestrating exists, Stop is exempt and SubagentStop is
// not. pull and shot never write that marker: there the main agent IS the implementer.
//
// LOCK. Exactly one gate run at a time, repo-wide (.ristretto/gate-lock). Two concurrent suites
// sharing one database or port produce failures that belong to neither — a red that is pure
// artifact, and indistinguishable from a real one without knowing what else was running. A run
// that cannot get the lock reports UNVERIFIED and never blocks: a collision must not look like a
// defect. Waiting is usually cheap, because the holder often proves the very tree we came to test.
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
const ARG = process.argv[3] || '';
const MAX_RETRIES = 3;

// Seconds a gate run will wait for the lock before giving up and reporting UNVERIFIED.
const DEFAULT_LOCK_WAIT = 900;

// A marker this old is left over from a session that died, not from a live pull. Honouring it
// arms the gates on a session that never asked for them — the stale-marker trap.
const MARKER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
const lockPath = path.join(projectDir, '.ristretto', 'gate-lock');
const orchestratingPath = path.join(projectDir, '.ristretto', 'orchestrating');

// No config → ristretto not set up in this repo → never interfere.
if (!fs.existsSync(configPath)) process.exit(0);

let hook = {};
if (MODE !== 'verify') {
  try { hook = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* no/bad stdin is fine */ }
}

// Which stop is this? The hooks.json argument is authoritative; the event name from the hook
// payload is a fallback for a hooks.json that predates the argument.
const IS_SUBAGENT = ARG === 'subagent' || hook.hook_event_name === 'SubagentStop';
const CACHED = ARG === 'cached';

let gates = {};
let silence = DEFAULT_SILENCE;
let hardCaps = DEFAULT_HARD_CAP;
let lockWait = DEFAULT_LOCK_WAIT;
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  gates = config.gates || {};
  silence = { ...DEFAULT_SILENCE, ...(config.silence || {}) };
  hardCaps = { ...DEFAULT_HARD_CAP, ...(config.timeouts || {}) };
  if (Number.isFinite(config.lockWait)) lockWait = config.lockWait;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Is that pid still around? EPERM means it exists but belongs to someone else — still alive.
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// --- The gate lock: one gate run at a time, repo-wide. ---
// Not an optimisation. Two `pytest -n auto` runs against one shared database produce a stable,
// convincing, entirely fictional set of failures; the same is true of any suite that binds a
// port or a fixture. Serialising is the only way a red gate can be trusted to mean something.

let holdsLock = false;

// true if the lock is ours, false if we waited out `waitSec` without getting it.
async function acquireLock(label) {
  const deadline = Date.now() + lockWait * 1000;
  for (;;) {
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      // 'wx' fails if the file exists — the atomic create that makes this a lock at all.
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, label, at: Date.now() }));
      fs.closeSync(fd);
      holdsLock = true;
      return true;
    } catch (e) {
      // Can't create it for a reason other than "taken" (read-only checkout, odd permissions):
      // proceed unlocked rather than refuse to gate at all. Enforcement beats serialisation.
      if (e.code !== 'EEXIST') return true;
      let held = null;
      try { held = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* torn or empty */ }
      if (!held || !alive(held.pid)) {
        try { fs.unlinkSync(lockPath); } catch { /* someone else cleaned up first */ }
        continue; // the holder died — steal it
      }
      if (Date.now() >= deadline) return false;
      await sleep(POLL_MS);
    }
  }
}

function releaseLock() {
  if (!holdsLock) return;
  try {
    const held = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (held.pid === process.pid) fs.unlinkSync(lockPath);
  } catch { /* already gone, or not ours to remove */ }
  holdsLock = false;
}
process.on('exit', releaseLock);

function lockHolder() {
  try {
    const held = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return `${held.label || 'a gate run'} (pid ${held.pid}, started ${Math.round((Date.now() - held.at) / 1000)}s ago)`;
  } catch {
    return 'another gate run';
  }
}

// --- Which files may the format convenience touch? ---
// Unconfigured, it formats whatever was written — which is how a repo-wide formatter ends up
// reflowing a doc nobody asked it to, and how a two-line edit becomes a hundred-line diff that
// the next edit re-triggers. gates.formatPaths scopes it to the paths the formatter owns.

function expandBraces(glob) {
  const m = /\{([^{}]*)\}/.exec(glob);
  if (!m) return [glob];
  return m[1].split(',').flatMap((opt) =>
    expandBraces(glob.slice(0, m.index) + opt + glob.slice(m.index + m[0].length)));
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // `**/` also matches zero directories
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

function formatAllowed(file) {
  const patterns = gates.formatPaths;
  if (!Array.isArray(patterns) || !patterns.length) return true; // unconfigured → format anything
  const rel = path.relative(projectDir, file).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return false; // outside the repo — never ours to rewrite
  return patterns.some((p) => expandBraces(p).some((g) => globToRegExp(g).test(rel)));
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
    if (gates.format && file && fs.existsSync(file) && formatAllowed(file)) {
      // convenience only — never block, stay quiet
      await run(gates.format.replace('{file}', `"${file}"`), budget({ key: 'format' }));
    }
    process.exit(0);
  }

  if (MODE === 'verify') {
    // A pre-flight repeated on an unchanged tree proves nothing the first one didn't. `cached`
    // is how brew asks for that verdict instead of re-paying for it after a session restart.
    if (CACHED) {
      const fp = treeFingerprint();
      let lastGreen = null;
      try { lastGreen = fs.readFileSync(greenPath, 'utf8'); } catch { /* nothing proven yet */ }
      if (fp !== null && fp === lastGreen) {
        const drift = toolDrift(resolveGateTools());
        if (drift.length) {
          // The cached green was proved with a different toolchain than this run would use, so
          // it says nothing about this one. Fall through and prove it properly.
          console.error(drift.join('\n'));
        } else {
          console.log('gates: cached green — tree byte-identical to the last proven run, nothing re-run');
          process.exit(0);
        }
      }
    }

    // Full scope, no cache, no marker required. Green here is the real proof.
    if (!(await acquireLock('verify'))) {
      console.error(`ristretto: could not start — ${lockHolder()} still holds the gate lock after ${lockWait}s.`);
      console.error('  The tree is UNVERIFIED, not red. Let that run finish, then verify again.');
      process.exit(1);
    }
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

    // A marker nobody disarmed keeps gating sessions that are not pulls. Age it out rather than
    // silently arming a session that never asked — and say so, so it gets cleaned up.
    let markerAge = null;
    try { markerAge = Date.now() - fs.statSync(markerPath).mtimeMs; } catch { /* keep gating */ }
    if (markerAge !== null && markerAge > MARKER_MAX_AGE_MS) {
      console.error(`ristretto: .ristretto/pulling is ${Math.round(markerAge / 3600000)}h old — treating it as a leftover from a dead session and NOT gating.`);
      console.error('  If a pull really is in progress, touch the marker; otherwise delete it.');
      process.exit(0);
    }

    // brew's orchestrator writes no source and its subagents are gated one by one. Running a
    // suite here measures a tree that a live subagent is mid-edit on — the red belongs to a
    // half-finished cycle, not to anyone's work, and it burns the retry budget to say so.
    if (!IS_SUBAGENT && fs.existsSync(orchestratingPath)) process.exit(0);

    // Tree unchanged since the last green run → already proven, skip.
    const fp = treeFingerprint();
    let lastGreen = null;
    try { lastGreen = fs.readFileSync(greenPath, 'utf8'); } catch { /* no green run yet */ }
    if (fp !== null && fp === lastGreen) process.exit(0);

    // Serialise. A gate that runs alongside another one measures both.
    if (!(await acquireLock(IS_SUBAGENT ? 'subagent stop' : 'stop'))) {
      console.error(`ristretto: gates did not run — ${lockHolder()} still holds the gate lock after ${lockWait}s.`);
      console.error('  This stop is UNVERIFIED, not green. Two suites at once invent failures that belong to neither,');
      console.error('  so ristretto waits rather than reporting a red it cannot trust. Re-run the gates once that finishes.');
      process.exit(0);
    }

    // The holder may have proven exactly the tree we came to test while we waited.
    const afterWait = treeFingerprint();
    try { lastGreen = fs.readFileSync(greenPath, 'utf8'); } catch { /* still nothing */ }
    if (afterWait !== null && afterWait === lastGreen) process.exit(0);

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
