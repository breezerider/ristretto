#!/usr/bin/env node
// Drives the fake-git shim to exercise strata.mjs end-to-end without a real
// git repo. Sets PATH so `git` resolves to strata.fixtures/fake-git.mjs, picks
// a scenario via GIT_SCENARIO, runs a verb, and asserts on stdout/stderr +
// exit code. No real git is touched.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _d = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_d, '..', 'strata.mjs'); // strata.fixtures/ -> scripts/
const FAKE_GIT = join(_d, 'fake-git.mjs');

let pass = 0, fail = 0;

function run({ scenario, verb, args = [], expectedExit = 0, expectOut = [], expectErr = [], directShim = false }) {
  const env = { ...process.env, GIT_SCENARIO: scenario };
  let stdout = '', stderr = '', code = null;
  if (directShim) {
    // Drive fake-git directly (no strata.mjs, no PATH wrapper) to pin the
    // shim's own call-contract — e.g. that dead forms fail loud.
    try {
      stdout = execFileSync(process.execPath, [FAKE_GIT, ...args], { env, encoding: 'utf8' });
      code = 0;
    } catch (e) {
      code = e.status ?? 1;
      stderr = e.stderr ? String(e.stderr) : '';
    }
  } else {
    const binDir = mkdtempSync(join(tmpdir(), 'rds-'));
    const gitShim = join(binDir, 'git');
    writeFileSync(gitShim, `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE_GIT)} "$@"\n`);
    chmodSync(gitShim, 0o755);
    env.PATH = binDir + ':' + env.PATH;
    try {
      stdout = execFileSync(process.execPath, [SCRIPT, verb, ...args], { env, encoding: 'utf8' });
      code = 0;
    } catch (e) {
      code = e.status ?? 1;
      stdout = e.stdout ? String(e.stdout) : '';
      stderr = e.stderr ? String(e.stderr) : '';
    }
  }
  let okc = true;
  const problems = [];
  if (code !== expectedExit) { okc = false; problems.push(`exit: expected ${expectedExit}, got ${code}`); }
  for (const s of expectOut) if (!stdout.includes(s)) { okc = false; problems.push(`stdout missing: "${s}"`); }
  for (const s of expectErr) if (!stderr.includes(s)) { okc = false; problems.push(`stderr missing: "${s}"`); }
  const label = directShim ? 'shim' : verb;
  if (okc) { pass++; console.log(`  PASS  ${label} [${scenario}] ${args.join(' ')}`); }
  else {
    fail++; console.log(`  FAIL  ${label} [${scenario}] ${args.join(' ')}`);
    for (const p of problems) console.log(`        - ${p}`);
    if (stdout.trim()) console.log(`        stdout: ${JSON.stringify(stdout.trim().slice(0, 200))}`);
    if (stderr.trim()) console.log(`        stderr: ${JSON.stringify(stderr.trim().slice(0, 200))}`);
  }
}

console.log('== check-branch ==');
run({ scenario: 'feature_pushed_ticket', verb: 'check-branch',
  expectOut: ['current: feature/ABC-123-otp', 'default: main', 'is_default: false', 'suggested_range: merge-base(main, HEAD)..HEAD'] });
run({ scenario: 'default_branch_clean', verb: 'check-branch',
  expectOut: ['current: main', 'default: main', 'is_default: true'] });

console.log('== validate-range ==');
run({ scenario: 'feature_pushed_ticket', verb: 'validate-range', args: ['main..HEAD'],
  expectOut: ['valid: true', 'start: main', 'end: HEAD', 'commits_in_range: 3'] });
run({ scenario: 'feature_pushed_ticket', verb: 'validate-range', args: ['perl..main'], expectedExit: 2 });
run({ scenario: 'feature_pushed_ticket', verb: 'validate-range', args: ['deadbeef..main'], expectedExit: 2,
  expectErr: ['not a valid hash or ref'] });
run({ scenario: 'feature_pushed_ticket', verb: 'validate-range', args: ['main..deadbeef'], expectedExit: 2,
  expectErr: ['not a valid hash or ref'] });
run({ scenario: 'feature_pushed_ticket', verb: 'validate-range', args: ['a..b..c'], expectedExit: 2,
  expectErr: ['exactly <start>..<end>'] });
run({ scenario: 'feature_pushed_ticket', verb: 'validate-range', args: [], expectedExit: 2,
  expectErr: ['no range given'] });

console.log('== authors ==');
run({ scenario: 'feature_pushed_ticket', verb: 'authors', args: ['main..HEAD'],
  expectOut: ['Ada Lovelace <ada@example.com>', 'Alan Turing <alan@example.com>', 'configured_is_in_range: true'] });

console.log('== analyze ==');
// Batched push-history narrowing now correctly detects the pushed hash
// (the prior shim masked this with an empty ok()).
run({ scenario: 'feature_pushed_ticket', verb: 'analyze', args: ['main..HEAD'],
  expectOut: ['[MIXED (docs path + non-docs files)]', 'docs-SCOPED but NO docs path (retitle to real scope)',
              'WARNING: affected commits are already on a remote', 'Recommended:   branch', 'PR branch:     ABC-123-pr',
              'Coalesce-hint'] });
run({ scenario: 'default_branch_clean', verb: 'analyze', args: ['a1a1a1a1..HEAD'],
  expectOut: ['Recommended:   rewrite', 'docs-only',
              'Coalesce-hint'] });

console.log('== coalesce-runs ==');
// (a) same_scope_streak_gate happy-path — loose mode, 3-commit streak on scripts/gate.js, scope 'gate'
run({ scenario: 'same_scope_streak_gate', verb: 'coalesce-runs', args: ['main..HEAD'],
  expectOut: ['"count": 3', '"scope": "gate"'] });

// (b) same_scope_streak_gate strict-mode — same fixture, --strict flag
run({ scenario: 'same_scope_streak_gate', verb: 'coalesce-runs', args: ['main..HEAD', '--strict'],
  expectOut: ['"count": 3', '"scope": "gate"'] });

// (c) feature_pushed_ticket — no same-scope streak, runs: []
run({ scenario: 'feature_pushed_ticket', verb: 'coalesce-runs', args: ['main..HEAD'],
  expectOut: ['"runs": []'] });

// (d) bootstrap_first_mixed_commit — parent a0a0a0a0 has no docs/ristretto/ path,
// mixed commit c2c2c2c2 classified as MIXED.
run({ scenario: 'bootstrap_first_mixed_commit', verb: 'analyze', args: ['main..HEAD'],
  expectOut: ['c2c2c2c', '[MIXED (docs path + non-docs files)]'] });

console.log('== error paths fail loud (exit 2) ==');
run({ scenario: 'feature_pushed_ticket', verb: 'coalesce-runs', args: [], expectedExit: 2,
  expectErr: ['no range given'] });
run({ scenario: 'feature_pushed_ticket', verb: 'coalesce-runs', args: ['nonsense..xyz'], expectedExit: 2,
  expectErr: ['cannot read range'] });
run({ scenario: 'feature_pushed_ticket', verb: 'analyze', args: ['nonsense..xyz'], expectedExit: 2,
  expectErr: ['cannot read range'] });
run({ scenario: 'feature_pushed_ticket', verb: 'analyze', args: ['--mode', 'branch'], expectedExit: 2,
  expectErr: ['no range given'] });
run({ scenario: 'feature_pushed_ticket', verb: 'authors', args: ['nonsense..xyz'], expectedExit: 2,
  expectErr: ['cannot list authors'] });

console.log('== flag parsing (index-based) ==');
// Range AFTER a flag value must still resolve — the old parser swallowed it.
run({ scenario: 'feature_pushed_ticket', verb: 'analyze', args: ['--mode', 'branch', 'main..HEAD'],
  expectOut: ['Recommended:   branch', 'PR branch:     ABC-123-pr'] });
// Two-dot ranges only — '...' gets a dedicated message.
run({ scenario: 'feature_pushed_ticket', verb: 'validate-range', args: ['main...HEAD'], expectedExit: 2,
  expectErr: ['two-dot range'] });

console.log('== coalesce-runs union areas ==');
// A 3-commit run spanning two areas — hint + JSON both carry the union.
run({ scenario: 'two_area_same_scope', verb: 'coalesce-runs', args: ['main..HEAD'],
  expectOut: ['"count": 3', '"scope": "gate"', '"scripts/gate.js"', '"lib/app.rb"'] });

console.log('== authors tab-parsing ==');
run({ scenario: 'pipe_in_author_name', verb: 'authors', args: ['main..HEAD'],
  expectOut: ['Ada / Lovelace <ada@example.com>', 'configured_is_in_range: true'] });

console.log('== fake-git rejects dead call forms ==');
// The shim answers only the call shapes the product actually makes. Dead
// handlers were deleted (tamp lean finding) — these drive the shim directly
// and assert the unhandled-call fallthrough fails loud: exit 1 + stderr.
run({ scenario: 'feature_pushed_ticket', directShim: true, args: ['log', '--oneline', 'main..HEAD'],
  expectedExit: 1, expectErr: ['fake git: unhandled'] });
run({ scenario: 'feature_pushed_ticket', directShim: true, args: ['diff-tree', '--no-commit-id', '--name-only', '-r', 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'],
  expectedExit: 1, expectErr: ['fake git: unhandled'] });
run({ scenario: 'feature_pushed_ticket', directShim: true, args: ['log', '--format=%an|%ae', 'main..HEAD'],
  expectedExit: 1, expectErr: ['fake git: unhandled'] });
run({ scenario: 'feature_pushed_ticket', directShim: true, args: ['log', '--format=%H', 'main..HEAD'],
  expectedExit: 1, expectErr: ['fake git: unhandled'] });
run({ scenario: 'feature_pushed_ticket', directShim: true, args: ['log', '-1', 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'],
  expectedExit: 1, expectErr: ['fake git: unhandled'] });

console.log('== Coalesce-hint fires at 2 commits ==');
// Hint previously required 3 (minLen 3 in analyze); now 2 — same threshold as
// the Fold-runs section built from the same runs.
run({ scenario: 'two_commit_run', verb: 'analyze', args: ['main..HEAD'],
  expectOut: ['== Coalesce-hint ==', '2 consecutive non-docs commits share scope (gate):',
              // Hint == Fold-runs pinned on the same fixture: same run appears
              // in the machine-readable section too.
              '"scope": "gate"', '"count": 2'] });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
