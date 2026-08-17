#!/usr/bin/env node
// Self-check for version.js — run with: node scripts/version.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const VERSION = path.join(__dirname, 'version.js');
const PLUGIN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
const CURRENT = /^(\d+)\.(\d+)/.exec(PLUGIN.version).slice(1, 3).join('.');

function run(dir, mode) {
  return spawnSync(process.execPath, [VERSION, mode], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
}

function project(roadmap) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristretto-ver-'));
  if (roadmap !== undefined) {
    fs.mkdirSync(path.join(dir, 'docs', 'ristretto'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'ristretto', 'roadmap.md'), roadmap);
  }
  return dir;
}

const read = (d) => fs.readFileSync(path.join(d, 'docs', 'ristretto', 'roadmap.md'), 'utf8');

// 1. No roadmap → nothing to migrate. prep creates it already stamped, so this must not be
//    treated as a problem; a fresh repo would otherwise be told to migrate before it has state.
let dir = project();
let r = run(dir, 'check');
assert.strictEqual(r.status, 0, 'a project with no roadmap must not demand a migration');
assert.ok(r.stdout.includes('nothing to migrate'), 'and must say why it is fine');

// 2. An unstamped roadmap predates versioning entirely → migration needed.
dir = project('# Ristretto Roadmap\n\n| Flight | Feature |\n');
r = run(dir, 'check');
assert.strictEqual(r.status, 1, 'an unstamped roadmap must report a migration is needed');
assert.ok(r.stdout.includes('UNSTAMPED'), 'the report must name the actual condition');
assert.ok(r.stdout.includes('0.13 or earlier'), 'and say what that implies about its age');

// 3. Stamping is idempotent, keeps the title first, and satisfies a later check.
r = run(dir, 'stamp');
assert.strictEqual(r.status, 0, 'stamping must succeed');
let text = read(dir);
assert.ok(text.startsWith('# Ristretto Roadmap\n'), 'the title must stay the first line a human reads');
assert.ok(text.includes(`<!-- ristretto-format: ${CURRENT} -->`), 'the stamp must record the current format');
assert.strictEqual(run(dir, 'check').status, 0, 'a stamped roadmap must check clean');
run(dir, 'stamp');
assert.strictEqual((read(dir).match(/ristretto-format/g) || []).length, 1,
  'stamping twice must not accumulate stamps');

// 4. An older stamp needs migrating, and both versions are named so the report is actionable.
dir = project(`# Ristretto Roadmap\n<!-- ristretto-format: 0.9 -->\n`);
r = run(dir, 'check');
assert.strictEqual(r.status, 1, 'an older format must report a migration is needed');
assert.ok(r.stdout.includes('project 0.9'), 'the project version must be named');
assert.ok(r.stdout.includes(CURRENT), 'the plugin version must be named');

// 5. THE ONE THAT MATTERS FOR ORDERING. 0.9 is OLDER than 0.14 — a string compare says the
//    opposite, and would send a current project through a pointless "migration" that rewrites
//    it into an older shape.
assert.ok(r.stdout.includes('migration needed'), '0.9 must be treated as older than 0.14, not newer');

// 6. A project NEWER than the plugin must refuse, not migrate. That is a stale install, and
//    "migrating" it would mean discarding whatever the newer format records.
dir = project('# Ristretto Roadmap\n<!-- ristretto-format: 99.0 -->\n');
r = run(dir, 'check');
assert.strictEqual(r.status, 1, 'a newer project must not report clean');
assert.ok(r.stdout.includes('PROJECT IS NEWER'), 'the direction of the mismatch must be unmistakable');
assert.ok(r.stdout.includes('Do not migrate'), 'and it must say plainly not to migrate');
assert.ok(r.stdout.includes('Update the ristretto plugin'), 'and name the actual remedy');

// 7. Stamping without a roadmap is a clear error, not a silently created file in the wrong place.
dir = project();
r = run(dir, 'stamp');
assert.strictEqual(r.status, 2, 'stamping a project with no roadmap must fail');
assert.ok(r.stderr.includes('nothing to stamp'), 'and say so');

// 8. A patch release must never trigger a migration — the format version is MAJOR.MINOR, and
//    patches change behaviour, never what is written to disk.
assert.ok(/^\d+\.\d+$/.test(CURRENT), 'the format version must be MAJOR.MINOR, with no patch component');

console.log('version.test.js: all checks passed');
