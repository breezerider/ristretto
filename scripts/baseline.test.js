#!/usr/bin/env node
// Self-check for baseline.js — run with: node scripts/baseline.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ratchet, load, save } = require('./baseline');

const S = (...xs) => new Set(xs);
const call = (b, e, f) => ratchet({ baseline: S(...b), executed: S(...e), failing: S(...f) });

// 1. A failure that was not in the baseline is new, and is the only thing reported.
let r = call(['old'], ['old', 'fresh'], ['old', 'fresh']);
assert.deepStrictEqual(r.newFailures, ['fresh'], 'only the new failure is named');
assert.deepStrictEqual(r.tolerated, ['old'], 'the pre-existing one is counted, not blamed');

// 2. Only pre-existing failures → nothing new, and the baseline is unchanged.
r = call(['a', 'b'], ['a', 'b'], ['a', 'b']);
assert.deepStrictEqual(r.newFailures, []);
assert.deepStrictEqual([...r.next].sort(), ['a', 'b']);

// 3. THE RATCHET. A baseline failure that now passes leaves the set, and can never come back
//    without blocking. This is the whole reason the tolerated set cannot rot.
r = call(['a', 'b'], ['a', 'b'], ['a']);
assert.deepStrictEqual([...r.next].sort(), ['a'], 'a fixed test leaves the baseline');

// 4. THE ONE THAT KEEPS SCOPED RUNS HONEST. A test that did not execute keeps its status.
//    Treating an absent test as passing would release failures the run never looked at — and a
//    scoped gate looks at almost nothing.
r = call(['a', 'b'], ['a'], ['a']);
assert.deepStrictEqual([...r.next].sort(), ['a', 'b'], 'b did not run, so nothing was learned about b');

// 5. A full run executes everything, so the rule collapses to "the baseline is what failed" —
//    which purges IDs that no longer exist. Parameterised tests change identity when their
//    parameter set changes, and those stale entries would otherwise accumulate forever.
r = call(['gone[x=1]', 'a'], ['a', 'b'], ['a']);
assert.deepStrictEqual([...r.next].sort(), ['a', 'gone[x=1]'],
  'an ID that did not run is kept — it is only purged by a run that actually covers it');
r = call(['gone[x=1]', 'a'], ['gone[x=1]', 'a', 'b'], ['a']);
assert.deepStrictEqual([...r.next].sort(), ['a'], 'once covered by a run, a stale ID is gone');

// 6. Empty everything is a valid, uneventful answer.
r = call([], [], []);
assert.deepStrictEqual(r.newFailures, []);
assert.strictEqual(r.next.size, 0);

// 7. Round-trips through disk, and a missing file is null rather than an empty baseline —
//    "no baseline" and "a baseline with nothing in it" mean very different things to the caller.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ristretto-baseline-'));
const p = path.join(dir, 'baseline.json');
assert.strictEqual(load(p), null, 'no file means no baseline, not an empty one');
save(p, S('x::y', 'x::z'), 'abc123');
assert.deepStrictEqual([...load(p)].sort(), ['x::y', 'x::z']);
const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
assert.strictEqual(raw.head, 'abc123', 'the baseline records the commit it was taken at');
assert.ok(Number.isFinite(raw.capturedAt));

// 8. A corrupt baseline is not a baseline. Returning an empty set would silently re-block every
//    tolerated failure; returning null lets the caller fall back deliberately.
fs.writeFileSync(p, '{ not json');
assert.strictEqual(load(p), null, 'an unreadable baseline is no baseline');

console.log('baseline.test.js: all checks passed');
