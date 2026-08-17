#!/usr/bin/env node
// ristretto format-version check — run with: node scripts/version.js check | stamp
//
// The plugin's commands read and write files in docs/ristretto/. That on-disk format changes
// between releases: statuses get renamed, Contract fields gain structure, checklist lines change
// shape. A project prepped under an older version is not broken — but it IS in a shape the
// current commands will misread, quietly, which is the worst way to find out.
//
// So the roadmap carries a stamp of the format it was written for, and every command that touches
// docs/ristretto/ checks it before doing anything. This is deliberately a separate, tiny program
// rather than something an agent eyeballs: "is this project on the current format" is a fact, and
// facts belong in code. Reading two files and comparing two strings cannot drift.
//
//   check   Compare the roadmap's stamp against this plugin's version.
//           exit 0 = current (or nothing to migrate yet), 1 = migration needed, 2 = can't tell.
//   stamp   Write the current format version into the roadmap, after a migration.
//
// The format version is the plugin's MAJOR.MINOR. Patch releases fix behaviour; they never
// change what is written to disk, so they must not trigger a migration.
'use strict';
const fs = require('fs');
const path = require('path');

const MODE = process.argv[2] || 'check';
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const roadmapPath = path.join(projectDir, 'docs', 'ristretto', 'roadmap.md');
const STAMP_RE = /<!--\s*ristretto-format:\s*(\d+\.\d+)\s*-->/;

// Where the plugin lives, not where the project does — this file ships with the plugin.
function pluginFormatVersion() {
  const manifest = path.join(__dirname, '..', '.claude-plugin', 'plugin.json');
  const version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
  const m = /^(\d+)\.(\d+)/.exec(String(version));
  if (!m) throw new Error(`plugin.json version "${version}" is not MAJOR.MINOR[.PATCH]`);
  return `${m[1]}.${m[2]}`;
}

// -1 / 0 / 1, comparing MAJOR.MINOR numerically. "0.9" is older than "0.13", which is exactly
// the comparison a string compare gets wrong.
function compare(a, b) {
  const [aMaj, aMin] = a.split('.').map(Number);
  const [bMaj, bMin] = b.split('.').map(Number);
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  return 0;
}

let current;
try {
  current = pluginFormatVersion();
} catch (e) {
  console.error(`ristretto: cannot read the plugin version (${e.message}).`);
  process.exit(2);
}

if (MODE === 'stamp') {
  let text;
  try {
    text = fs.readFileSync(roadmapPath, 'utf8');
  } catch {
    console.error(`ristretto: no roadmap at ${roadmapPath} — nothing to stamp.`);
    process.exit(2);
  }
  const stamp = `<!-- ristretto-format: ${current} -->`;
  const next = STAMP_RE.test(text)
    ? text.replace(STAMP_RE, stamp)
    // First line if there is no title, otherwise straight after it — the stamp is metadata, and
    // it should not be the first thing a human reads.
    : text.replace(/^(#[^\n]*\n)?/, (head) => `${head || ''}${head ? '' : ''}${stamp}\n`);
  fs.writeFileSync(roadmapPath, next);
  console.log(`ristretto: roadmap stamped ${current}`);
  process.exit(0);
}

if (MODE !== 'check') {
  console.error('usage: node scripts/version.js check | stamp');
  process.exit(2);
}

let text = null;
try { text = fs.readFileSync(roadmapPath, 'utf8'); } catch { /* no roadmap yet */ }

// No roadmap means no project state to migrate. prep will create it already stamped.
if (text === null) {
  console.log(`format: ${current} (no roadmap yet — nothing to migrate)`);
  process.exit(0);
}

const found = STAMP_RE.exec(text);
const stamped = found ? found[1] : null;

if (stamped === null) {
  console.log(`format: project UNSTAMPED, plugin ${current} — migration needed`);
  console.log('  A roadmap with no stamp predates format versioning (0.12 or earlier).');
  process.exit(1);
}

const cmp = compare(stamped, current);
if (cmp === 0) {
  console.log(`format: ${current} — up to date`);
  process.exit(0);
}

if (cmp > 0) {
  // Newer project than plugin. Migrating "forward" here would mean rewriting files into an older
  // shape and losing whatever the newer format added — so refuse, loudly. This is a stale
  // install, not a stale project.
  console.log(`format: project ${stamped}, plugin ${current} — the PROJECT IS NEWER`);
  console.log('  Do not migrate: that would rewrite these files into an older shape and lose');
  console.log('  whatever the newer format records. Update the ristretto plugin instead.');
  process.exit(1);
}

console.log(`format: project ${stamped}, plugin ${current} — migration needed`);
process.exit(1);
