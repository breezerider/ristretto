#!/usr/bin/env node
// The tolerated-failure set, and the one rule that governs it.
//
//   next = (baseline \ executed) ∪ failing
//   new  = failing \ baseline
//
// Everything the design promises falls out of those two lines:
//   · a test that was failing and now passes is executed, so it leaves the set — the ratchet
//   · a test that fails and was not in the set is new, so the run blocks and the set is never
//     written: an unattended run can only ever shrink it
//   · a test that DID NOT RUN keeps its previous status, which is what makes a scoped gate safe.
//     Treating an absent test as passing would release failures nothing looked at, and a scoped
//     gate looks at almost nothing.
//   · a full run executes everything, so the rule collapses to next = failing, purging IDs that
//     no longer exist. No ageing logic is needed for parameterised tests that changed shape.
'use strict';
const fs = require('fs');
const path = require('path');

function ratchet({ baseline, executed, failing }) {
  const next = new Set();
  for (const id of baseline) if (!executed.has(id)) next.add(id);
  for (const id of failing) next.add(id);
  const newFailures = [...failing].filter((id) => !baseline.has(id)).sort();
  const tolerated = [...failing].filter((id) => baseline.has(id)).sort();
  return { newFailures, tolerated, next };
}

function load(absPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    if (!Array.isArray(raw.failing)) return null;
    return new Set(raw.failing);
  } catch {
    return null; // absent, or corrupt — either way the caller has no baseline to reason from
  }
}

function save(absPath, failingSet, head) {
  const body = {
    capturedAt: Date.now(),
    head: head || null,
    failing: [...failingSet].sort(),
  };
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, JSON.stringify(body, null, 2));
  } catch { /* best-effort: a baseline that cannot be written degrades to today's behaviour */ }
}

module.exports = { ratchet, load, save };
