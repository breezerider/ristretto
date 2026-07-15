#!/usr/bin/env node
// ristretto gate runner — deterministic gates, framework-agnostic via .ristretto.json.
// Node instead of bash+jq so it runs identically on Windows, macOS, Linux.
//
// Modes:
//   quick  PostToolUse hook. Formats the touched file. ALWAYS exits 0 (convenience, not gate).
//   full   Stop hook. Runs lint + typecheck + test. Exits 2 on failure (blocks the agent),
//          but ONLY while .ristretto/pulling exists. Outside a pull: exits 0 immediately.
//
// Reads hook JSON from stdin (Claude Code protocol).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const MODE = process.argv[2] || 'quick';
const MAX_RETRIES = 3;

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const configPath = path.join(projectDir, '.ristretto.json');
const markerPath = path.join(projectDir, '.ristretto', 'pulling');
const retriesPath = path.join(projectDir, '.ristretto', 'gate-retries');
const greenPath = path.join(projectDir, '.ristretto', 'gate-green');

// No config → ristretto not set up in this repo → never interfere.
if (!fs.existsSync(configPath)) process.exit(0);

let hook = {};
try { hook = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* no/bad stdin is fine */ }

let gates = {};
try {
  gates = JSON.parse(fs.readFileSync(configPath, 'utf8')).gates || {};
} catch (e) {
  if (MODE === 'full' && fs.existsSync(markerPath)) {
    // Fail closed: a broken config while a pull is active must not silently disarm the gate.
    console.error(`ristretto: .ristretto.json is unparseable (${e.message}) — fix it, the gate cannot run.`);
    process.exit(2);
  }
  process.exit(0);
}

function run(cmd) {
  try {
    execSync(cmd, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });
    return null;
  } catch (e) {
    return ((e.stdout || '') + (e.stderr || '')) || String(e.message);
  }
}

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return null;
  }
}

// Fingerprint of the working tree: HEAD + status + content of every dirty/untracked
// file. If the tree is byte-identical to one that already passed the gates, re-running
// them proves nothing — subagents that change no code (reviewers, closers) would
// otherwise pay a full test-suite run at every stop. Returns null outside a git repo:
// no caching, gates always run.
function treeFingerprint() {
  const head = git('rev-parse HEAD');
  const status = git('status --porcelain -uall');
  if (head === null || status === null) return null;
  const h = crypto.createHash('sha256');
  h.update(head + '\0' + status);
  for (const line of status.split('\n').filter(Boolean)) {
    let p = line.slice(3);
    if (p.includes(' -> ')) p = p.split(' -> ')[1];
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1).replace(/\\(.)/g, '$1');
    try { h.update(fs.readFileSync(path.join(projectDir, p))); } catch { h.update('\0gone'); }
    h.update('\0');
  }
  return h.digest('hex');
}

if (MODE === 'quick') {
  const file = hook.tool_input && hook.tool_input.file_path;
  if (gates.format && file && fs.existsSync(file)) {
    run(gates.format.replace('{file}', `"${file}"`)); // convenience only — never block, stay quiet
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
  for (const gate of ['lint', 'typecheck', 'test']) {
    if (!gates[gate]) continue;
    const output = run(gates[gate]);
    if (output !== null) {
      const tail = output.split('\n').slice(-40).join('\n');
      failures += `\n--- ristretto gate '${gate}' FAILED ---\n${tail}`;
    }
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
