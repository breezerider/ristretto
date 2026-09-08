#!/usr/bin/env node
// Structural guard for ristretto's commands and briefs — run with: node scripts/briefs.test.js
//
// It does not judge what the rules say. It checks the one property that broke: that a rule
// lives in exactly one file, and that a command hands out a path rather than a pasted brief.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const words = (s) => s.split(/\s+/).filter(Boolean).length;

const COMMANDS = ['commands/brew.md', 'commands/pull.md', 'commands/shot.md'];
const BRIEFS = ['briefs/common.md', 'briefs/planner.md', 'briefs/implementer.md',
                'briefs/reviewer.md', 'briefs/closer.md'];

// 1. Every brief file exists.
for (const b of BRIEFS) {
  assert.ok(fs.existsSync(path.join(ROOT, b)), `${b} must exist`);
}

// 2. No rule in two places. Each fingerprint is a phrase distinctive to one rule; it may appear
//    in exactly one file across commands + briefs. Add a fingerprint whenever a rule is moved.
const FINGERPRINTS = [
  'git add -A',              // stage only what you touched
  'plain ASCII',             // commit subject safety
  'per criterion',           // test proportionality
  'cheapest level',          // prove it at the cheapest honest level
  'tick a box',              // manual checks
  'about production',        // never a check about production
  'weaken, skip, or delete', // gates are infrastructure
  'gate.js" prove',          // the implementer's final proof — note the quote: the real call is
                             // node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" prove, so a
                             // fingerprint of `gate.js prove` would match nothing
  'more than three files',   // deleted ratchet trigger — must appear NOWHERE
];
const FILES = [...COMMANDS, ...BRIEFS, 'reference/config.md'];
for (const fp of FINGERPRINTS) {
  const hits = FILES.filter((f) => fs.existsSync(path.join(ROOT, f)) && read(f).includes(fp));
  if (fp === 'more than three files') {
    assert.strictEqual(hits.length, 0, `ratchet trigger 4 was deleted — "${fp}" still in: ${hits.join(', ')}`);
  } else {
    assert.strictEqual(hits.length, 1, `"${fp}" must live in exactly one file — found in: ${hits.join(', ') || '(nowhere)'}`);
  }
}

// 3. A command hands out a path, it does not paste a brief. The regression this whole cleanup
//    exists to prevent is a brief creeping back inline, so bound the file instead of trusting it.
for (const c of COMMANDS) {
  assert.ok(words(read(c)) < 2500, `${c} is ${words(read(c))} words — a command is a flow, not a brief`);
}

// 4. Every command reads the version check and hands off to briefs by path.
for (const c of COMMANDS) {
  assert.ok(/version\.js" check/.test(read(c)), `${c} must run the version check`);
}

// 5. Every brief is reachable: each one is named by at least one command or by common.md.
const corpus = [...COMMANDS, 'briefs/common.md'].map(read).join('\n');
for (const b of BRIEFS.filter((b) => b !== 'briefs/common.md')) {
  assert.ok(corpus.includes(path.basename(b)), `${b} is never referenced — nothing would read it`);
}

// 6. The anecdote archive exists and no command reads it.
assert.ok(fs.existsSync(path.join(ROOT, 'docs/decisions.md')), 'docs/decisions.md must exist');
for (const c of COMMANDS) {
  assert.ok(!read(c).includes('decisions.md'), `${c} must not send anyone to the anecdote archive`);
}

// 7. common.md carries what more than one role needs, and stays a reference not an essay.
const common = read('briefs/common.md');
for (const fp of ['tick a box', 'about production', 'cheapest level', 'per criterion',
                  'weaken, skip, or delete']) {
  assert.ok(common.includes(fp), `common.md must carry "${fp}"`);
}
assert.ok(words(common) < 450, `common.md is ${words(common)} words — it is shared, so every role pays it`);

console.log('briefs.test.js: all checks passed');
