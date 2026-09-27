#!/usr/bin/env node
// strata.mjs — helpers for collapsing docs/ristretto commits.
// Platform-agnostic (node) counterpart of the bash helper. Never rewrites
// history itself — it reports, classifies, validates, and suggests.
//
// Verbs:
//   check-branch            print whether the current branch is the default
//   validate-range <range>   check the range is usable; exit non-zero + stderr on error
//   authors <range>         list distinct authors in the range + the repo's
//                           configured identity, for attribution confirmation
//   analyze <range> [--mode M] [--ticket ID]
//                           enumerate/classify relevant commits, remote check,
//                           recommend a mode, suggest a PR branch name, draft a subject
//   coalesce-runs <range> [--strict]
//                           emit machine-readable runs of contiguous same-scope,
//                           same-area commits (for --fold orchestration)

import { execFileSync } from 'node:child_process';

// NOTE: execFileSync passes args directly to the binary — there is NO shell,
// so refs/hashes are passed bare (never wrapped in quotes) and a range is
// passed as one arg like `a..b`.
function git(args) {
  try {
    const r = execFileSync('git', args, { encoding: 'utf8' });
    return r.replace(/\n$/, '');
  } catch { return null; }
}

function gitQuiet(args) {
  try { execFileSync('git', args, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function defaultBranch() {
  try {
    const h = git(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    if (h) return h.replace('refs/remotes/origin/', '');
  } catch { /* no origin/HEAD */ }
  for (const b of ['main', 'master']) {
    if (gitQuiet(['show-ref', '--verify', '--quiet', `refs/heads/${b}`])) return b;
  }
  return null;
}

function rangeError(range, verb) {
  console.error(`${verb}: cannot read range '${range}' — not a valid hash or ref in this repository (typo? wrong branch? not fetched?)`);
  process.exit(2);
}

function currentBranch() {
  const b = git(['branch', '--show-current']);
  return b && b.length ? b : null; // null when detached
}

// Resolve the configured upstream remote for the current branch. Reads
// branch.<cur>.remote, falls back to init.defaultRemote, then 'origin'.
// Cheap (one config read per step), called once per analyze.
function resolveRemote() {
  const cur = currentBranch();
  if (cur) {
    const r = git(['config', '--get', `branch.${cur}.remote`]);
    if (r) return r;
  }
  const def = git(['config', '--get', 'init.defaultRemote']);
  if (def) return def;
  return 'origin';
}

// ONE batched `git log --remotes=<remote> --format=%H <range>` call.
// Returns a Set of full 40-char hashes reachable from the upstream remote.
// Replaces the prior O(n) per-hash `git branch -r --contains <hash>` loop and
// the later short-hash prefix-guessing intersection.
function pushedHashes(range, remote) {
  const out = git(['log', `--remotes=${remote}`, '--format=%H', range]);
  if (!out) return new Set();
  return new Set(out.split('\n').filter(Boolean));
}

// ---- verb: check-branch ------------------------------------------------
function checkBranch() {
  const cur = currentBranch();
  const def = defaultBranch();
  const isDefault = def !== null && cur === def;
  console.log(`current: ${cur ?? '(detached)'}`);
  console.log(`default: ${def ?? '(none)'}`);
  console.log(`is_default: ${isDefault}`);
  if (def && cur !== def) {
    console.log(`suggested_range: merge-base(${def}, HEAD)..HEAD`);
  }
}

// ---- verb: validate-range ----------------------------------------------
function resolveSide(side, errors, label) {
  if (!side) return null; // empty side ('..B' / 'A..') resolved to HEAD by caller
  const h = git(['rev-parse', '--verify', `${side}^{commit}`]);
  if (h === null) {
    errors.push(
      `range ${label} '${side}' is not a valid hash or ref in this repository — ` +
      `cannot resolve it to a commit (typo? wrong branch? not fetched?)`
    );
    return null;
  }
  return h;
}

function validateRange(range) {
  const trimmed = (range || '').trim();
  if (!trimmed) {
    console.error('no range given to validate');
    process.exit(2);
  }
  if (trimmed.includes('...')) {
    console.error(`invalid range '${trimmed}': strata takes a two-dot range A..B — '...' (symmetric difference) has no meaning here`);
    process.exit(2);
  }
  const sides = trimmed.split('..');
  if (sides.length !== 2) {
    console.error(`invalid range '${trimmed}': expected exactly <start>..<end>`);
    process.exit(2);
  }

  const startRaw = sides[0];
  const endRaw = sides[1];
  // git conventions: '..B' => HEAD..B, 'A..' => A..HEAD.
  const startActual = startRaw || 'HEAD';
  const endActual = endRaw || 'HEAD';

  const errors = [];
  const startHash = resolveSide(startActual, errors, 'start');
  const endHash = resolveSide(endActual, errors, 'end');
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(2);
  }

  if (startHash === endHash) {
    console.log('valid: true');
    console.log('note: range start and end resolve to the same commit — the range is empty');
    process.exit(0);
  }

  if (gitQuiet(['merge-base', '--is-ancestor', endActual, startActual])) {
    console.error(`invalid range '${trimmed}': end '${endActual}' is an ancestor of start '${startActual}' (end before start)`);
    process.exit(2);
  }

  const count = git(['rev-list', '--count', `${startActual}..${endActual}`]);
  console.log('valid: true');
  console.log(`start: ${startActual}`);
  console.log(`end: ${endActual}`);
  console.log(`commits_in_range: ${count}`);
  process.exit(0);
}

// ---- verb: authors ------------------------------------------------------
function authors(range) {
  const lines = git(['log', '--format=%an%x09%ae', range]);
  if (!lines) {
    console.error(`cannot list authors for '${range}' — invalid or empty range`);
    process.exit(2);
  }
  const seen = new Map();
  for (const l of lines.split('\n')) {
    const tab = l.indexOf('\t');
    const name = tab === -1 ? l : l.slice(0, tab);
    const email = tab === -1 ? '' : l.slice(tab + 1);
    seen.set(`${name} <${email}>`, (seen.get(`${name} <${email}>`) || 0) + 1);
  }
  const user = git(['config', 'user.name']);
  const email = git(['config', 'user.email']);
  const configured = (user ? `${user} <${email || '(no email)'}>` : null);
  console.log('== Authors in range (commits each) ==');
  for (const [who, n] of seen) console.log(`  (${n})  ${who}`);
  console.log('== Default configured identity ==');
  console.log(`  ${configured || '(none set — ask the user for an identity)'}`);
  if (configured && seen.size > 0) {
    const match = seen.has(configured);
    console.log(`  configured_is_in_range: ${match}`);
  }
}

// ---- verb: analyze ------------------------------------------------------
// ONE batched call: per-commit hash, subject, and merged file list, in
// topological-first order (newest first), replacing the prior two
// shell-outs per commit (diff-tree + log -1 for every hash).
function commitsInRange(range) {
  const out = git(['log', '--format=%H|%s', '--name-only', range]);
  if (out === null) return null; // git failed — caller must not read this as "empty range"
  const commits = [];
  let cur = null;
  for (const line of out.split('\n')) {
    const m = /^([0-9a-f]{40})\|(.*)$/.exec(line);
    if (m) {
      cur = { hash: m[1], subj: m[2], files: [] };
      commits.push(cur);
    } else if (line && cur) {
      cur.files.push(line);
    }
  }
  return commits;
}

function classify(c) {
  const pathDocs = c.files.some((f) => f.startsWith('docs/ristretto'));
  const others = c.files.filter((f) => !f.startsWith('docs/ristretto'));
  const subjDocs = /^docs\([^)]*\):/.test(c.subj);
  let kind;
  if (pathDocs && others.length === 0) kind = 'docs-only';
  else if (pathDocs && others.length > 0) kind = 'MIXED (docs path + non-docs files)';
  else if (!pathDocs && subjDocs) kind = 'docs-SCOPED but NO docs path (retitle to real scope)';
  else kind = 'non-docs (leave untouched)';
  return { kind, subjDocs };
}

function firstTicket(candidates) {
  for (const c of candidates) {
    const m = /[A-Z]{1,8}-[0-9]+/.exec(c);
    if (m) return m[0];
  }
  return null;
}

function scopeOf(subject) {
  const m = /^([a-z]+)\(([^)]+)\):\s/.exec(subject);
  return m ? m[2] : null;
}

function typeOf(subject) {
  const m = /^([a-z]+)(?:\([^)]*\))?:\s/.exec(subject);
  return m ? m[1] : null;
}

function areaOf(file) {
  const parts = file.split('/');
  if (parts.length <= 2) return parts.slice(0, -1).join('/') || parts[0];
  return parts.slice(0, 2).join('/');
}

// Union of files across a run's members, computed from the commits themselves —
// no mutation state carried on candidates.
function curFilesOf(run, commitsByHash) {
  const set = new Set();
  for (const c of run) {
    const commit = commitsByHash.get(c.hash);
    if (commit) for (const f of commit.files) set.add(f);
  }
  return set;
}

// Assign kind/subjDocs onto each commit in place (shared by analyze and
// coalesce-runs).
function classifyAll(commits) {
  for (const c of commits) Object.assign(c, classify(c));
}

// The JSON shape shared by analyze's Fold-runs section and coalesce-runs.
// coalesce-runs adds `files` on top via the spread in coalesceRunsJson.
function runJson(run) {
  const start = run[run.length - 1].hash;
  const end = run[0].hash;
  return {
    start,
    end,
    start_short: start.slice(0, 7),
    end_short: end.slice(0, 7),
    scope: run[0].scope,
    type: run[0].type,
    count: run.length,
    subjects: run.map((c) => c.subj),
  };
}

function coalesceRuns(commits, { minLen = 2 } = {}) {
  const runs = [];
  let cur = [];
  let curAreas = new Set(); // union of all member areas — membership reads this
  const flush = () => {
    if (cur.length >= minLen) runs.push(cur);
    cur = [];
    curAreas = new Set();
  };
  for (const c of commits) {
    // Break the run on ANY docs-related commit: docs-only, MIXED (docs path +
    // non-docs files), docs-SCOPED-but-no-docs-path. A MIXED commit's docs
    // files must not ride a fold commit — fold runs are non-docs only, per
    // briefs/strata-fold.md ("any docs commit breaks a run").
    if (c.kind !== 'non-docs (leave untouched)') { flush(); continue; }
    const scope = scopeOf(c.subj);
    const areas = new Set(c.files.map(areaOf).filter((a) => !a.startsWith('docs/ristretto')));
    if (!scope || areas.size === 0) { flush(); continue; }
    const candidate = { hash: c.hash, scope, subj: c.subj, type: typeOf(c.subj) };
    if (cur.length === 0) {
      cur.push(candidate);
      for (const a of areas) curAreas.add(a);
      continue;
    }
    const sameScope = cur[cur.length - 1].scope === scope;
    const sharedArea = [...curAreas].some((a) => areas.has(a));
    if (sameScope && sharedArea) {
      cur.push(candidate);
      for (const a of areas) curAreas.add(a);
    } else {
      flush();
      cur.push(candidate);
      for (const a of areas) curAreas.add(a);
    }
  }
  flush();
  return runs;
}

function coalesceRunsJson(range, mode) {
  if (!range) {
    console.error('coalesce-runs: no range given — usage: coalesce-runs <range> [--strict]');
    process.exit(2);
  }
  const commits = commitsInRange(range);
  if (commits === null) rangeError(range, 'coalesce-runs');
  if (commits.length === 0) {
    console.log(JSON.stringify({ range, mode: mode || 'loose', runs: [] }, null, 2));
    return;
  }
  classifyAll(commits);
  const minLen = mode === 'strict' ? 3 : 2;
  const useMode = coalesceRuns(commits, { minLen });
  const commitsByHash = new Map(commits.map((c) => [c.hash, c]));
  const out = useMode.map((run) => ({
    ...runJson(run),
    files: [...curFilesOf(run, commitsByHash)].sort(),
  }));
  console.log(JSON.stringify({ range, mode: mode || 'loose', runs: out }, null, 2));
}

function analyze(range, mode, ticket) {
  if (!range) {
    console.error('analyze: no range given — usage: analyze <range> [--mode M] [--ticket ID]');
    process.exit(2);
  }
  const commits = commitsInRange(range);
  if (commits === null) rangeError(range, 'analyze');
  classifyAll(commits);
  const relevant = commits.filter((c) => c.kind !== 'non-docs (leave untouched)');
  if (relevant.length === 0) {
    console.log(`>> No relevant commits in '${range}'. Nothing to squash.`);
    process.exit(0);
  }

  // Batched push-history narrowing (ONE git call + in-memory Set lookup);
  // recommend derives from it.
  const { pushed, hasRemote } = computePushed(commits, range);
  const recommend = pushed.length ? 'branch' : 'rewrite';
  printRemoteCheck(pushed, hasRemote);
  printRelevantCommits(range, relevant);
  const runs = coalesceRuns(commits, { minLen: 2 });
  printCoalesceHint(runs);
  printFoldRuns(runs);
  printModeAndPrBranch(mode, recommend, relevant, ticket);
  printDraftSubject(relevant);
  console.log('');
  console.log('>> This helper stops here — it never rewrites history itself.');
  console.log('>> Run the workflow in the chosen mode (briefs/strata-rewrite.md or briefs/strata-branch.md).');
}

// Batched push-history narrowing: ONE git call + in-memory Set lookup.
function computePushed(commits, range) {
  const pushed = [];
  const remote = resolveRemote();
  const hasRemote = !!git(['remote']);
  if (hasRemote) {
    const remoteSet = pushedHashes(range, remote);
    for (const c of commits) {
      if (remoteSet.has(c.hash)) pushed.push(c.hash.slice(0, 7));
    }
  }
  return { pushed, hasRemote };
}

function printRemoteCheck(pushed, hasRemote) {
  console.log('');
  console.log('== Remote check ==');
  if (pushed.length) {
    console.log(`WARNING: affected commits are already on a remote: ${pushed.join(' ')}`);
    console.log('Rewriting diverges pushed history. Prefer --mode branch unless the user');
    console.log('explicitly wants an in-place rewrite and confirms it.');
  } else if (!hasRemote) {
    console.log('No remotes configured — nothing is pushed, no push-divergence risk.');
  } else {
    console.log('None affected are on a remote — safe to rewrite locally.');
  }
}

function printRelevantCommits(range, relevant) {
  console.log('');
  console.log(`== Commits in ${range} relevant to docs/ristretto ==`);
  for (const r of relevant) {
    console.log(`  ${r.hash.slice(0, 7)}  [${r.kind}]  ${r.subj}`);
  }
}

// Coalesce-hint human-readable view — the same runs the Fold-runs JSON below
// reports. Computed once in analyze() and passed to both printers.
function printCoalesceHint(runs) {
  console.log('');
  console.log('== Coalesce-hint ==');
  if (runs.length === 0) {
    console.log('  No contiguous runs of small same-scope commits detected.');
    return;
  }
  for (const run of runs) {
    console.log(`  ${run.length} consecutive non-docs commits share scope (${run[0].scope}):`);
    for (const c of run) {
      console.log(`    - ${c.hash.slice(0, 7)} ${c.subj}`);
    }
    console.log('  Consider asking the user whether to coalesce these into one');
    console.log('  <type>(scope) commit before proceeding.');
    console.log('  (Suggestion only — NEVER auto-merge; this is the user\'s call.)');
  }
}

// Loose runs for --fold action (≥2, same scope, same area; type-agnostic) —
// the same runs the hint above printed.
function printFoldRuns(runs) {
  console.log('');
  console.log('== Fold-runs (machine-readable) ==');
  console.log(JSON.stringify(runs.map(runJson), null, 2));
}

function printModeAndPrBranch(mode, recommend, relevant, ticket) {
  console.log('');
  console.log('== Mode ==');
  console.log(`  Mode requested: ${mode || '<unspecified — ask the user>'}`);
  console.log(`  Recommended:   ${recommend}`);
  console.log('  (branch mode = non-destructive, source branch untouched;');
  console.log('   rewrite mode = rewrites working branch in place)');

  if (!ticket) {
    const cur = currentBranch() || '';
    const subjects = relevant.map((r) => r.subj);
    ticket = firstTicket([cur, ...subjects]);
  }
  const prBranch = ticket ? `${ticket}-pr` : `${currentBranch() || 'feature'}-pr`;
  console.log(`  PR branch:     ${prBranch}`);
}

function printDraftSubject(relevant) {
  const first = relevant[0];
  const draft = first.subjDocs ? first.subj : `docs(ristretto): ${first.subj}`;
  console.log('');
  console.log('== Draft subject ==');
  console.log(`  ${draft}  (review/adjust — capture the whole collapsed set, not the first member)`);
}

// ---- dispatch -----------------------------------------------------------
const [verb, ...args] = process.argv.slice(2);
switch (verb) {
  case 'check-branch': checkBranch(); break;
  case 'validate-range': validateRange(args[0] || ''); break;
  case 'authors': authors(args[0] || ''); break;
  case 'analyze': {
    let mode = null; let ticket = null; let range = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--mode') { mode = args[i + 1]; i++; }
      else if (a.startsWith('--mode=')) mode = a.slice('--mode='.length);
      else if (a === '--ticket') { ticket = args[i + 1]; i++; }
      else if (a.startsWith('--ticket=')) ticket = a.slice('--ticket='.length);
      else if (!range) range = a;
    }
    analyze(range, mode, ticket);
    break;
  }
  case 'coalesce-runs': {
    let range = null; let mode = null;
    for (const a of args) {
      if (a === '--strict') mode = 'strict';
      else if (!range) range = a;
    }
    coalesceRunsJson(range, mode);
    break;
  }
  default:
    console.log('usage: node scripts/strata.mjs <verb> [args]');
    console.log('verbs: check-branch | validate-range <range> | authors <range> | analyze <range> [--mode M] [--ticket ID] | coalesce-runs <range> [--strict]');
    process.exit(1);
}
