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

// 1. No config → never interfere, both modes.
let dir = tmpRepo();
assert.strictEqual(gate(dir, 'quick').status, 0, 'quick without config must exit 0');
assert.strictEqual(gate(dir, 'full').status, 0, 'full without config must exit 0');

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

// 7. Quick mode formats the touched file via {file}.
dir = tmpRepo(JSON.stringify({ gates: { format: `node -e "require('fs').writeFileSync(process.argv[1] + '.formatted', '')" {file}` } }));
const touched = path.join(dir, 'a.txt');
fs.writeFileSync(touched, 'x');
r = gate(dir, 'quick', JSON.stringify({ tool_input: { file_path: touched } }));
assert.strictEqual(r.status, 0, 'quick must exit 0');
assert.ok(fs.existsSync(touched + '.formatted'), 'format command must receive the touched file');

console.log('gate.test.js: all checks passed');
