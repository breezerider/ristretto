#!/usr/bin/env node
// Fake `git` for strata tests. Placed on PATH ahead of the real git; the script
// under test calls execFileSync('git', args), so this shim answers from an
// in-memory fixture selected by $GIT_SCENARIO, returning the exact shapes the
// real git returns for each invocation. No real git is ever touched.

const FIXTURES = {
  // A working feature branch, one docs-scoped-but-non-docs commit, a mixed
  // commit, and one pushed commit in range => recommend branch, detect ticket.
  feature_pushed_ticket: {
    branch: 'feature/ABC-123-otp',
    defaultBranch: 'main',
    mainExists: true,
    configUser: 'Ada Lovelace', configEmail: 'ada@example.com',
    revs: { main: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'HEAD': 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2' },
    hashesInRange: ['b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3', 'd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4'],
    commit: {
      'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2': { subject: 'feat(ABC-123): add otp resend', files: ['lib/app.rb', 'docs/ristretto/plans/otp.md'] },
      'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3': { subject: 'docs(ristretto): drop stale plan', files: ['debian/conffiles'] },
      'd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4': { subject: 'docs(ristretto): add otp plan', files: ['docs/ristretto/plans/otp.md'] },
    },
    authors: ['Ada Lovelace|ada@example.com', 'Alan Turing|alan@example.com'],
    count: 3,
    ancestors: {},
    pushed: ['b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'],
  },

  // A detached / default-branch position, no ticket, nothing pushed.
  default_branch_clean: {
    branch: 'main',
    defaultBranch: 'main',
    mainExists: true,
    configUser: null, configEmail: null,
    revs: { main: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1' },
    hashesInRange: ['a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'],
    commit: {
      'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1': { subject: 'docs(ristretto): plan X', files: ['docs/ristretto/plans/x.md'] },
    },
    authors: ['Ada Lovelace|ada@example.com'],
    count: 1,
    ancestors: {},
    pushed: [],
  },

  // A 3-commit streak on scripts/gate.js all sharing scope 'gate'. Used by
  // coalesce-runs tests to assert count: 3, scope: 'gate'.
  same_scope_streak_gate: {
    branch: 'feature/gate-polish',
    defaultBranch: 'main',
    mainExists: true,
    configUser: 'Ada Lovelace', configEmail: 'ada@example.com',
    revs: { main: 'e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5', 'HEAD': 'f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8' },
    hashesInRange: ['e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6', 'e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7', 'f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8'],
    commit: {
      'e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6': { subject: 'fix(gate): tighten lock timeout', files: ['scripts/gate.js'] },
      'e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7': { subject: 'refactor(gate): extract ratchet', files: ['scripts/gate.js'] },
      'f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8': { subject: 'chore(gate): rename helper', files: ['scripts/gate.js'] },
    },
    authors: ['Ada Lovelace|ada@example.com'],
    count: 3,
    ancestors: {},
    pushed: [],
  },

  // Parent a0a0a0a0 has no docs/ristretto/ path; mixed commit c2c2c2c2 adds
  // one. Used by analyze test to assert MIXED classification.
  bootstrap_first_mixed_commit: {
    branch: 'feature/bootstrap',
    defaultBranch: 'main',
    mainExists: true,
    configUser: 'Ada Lovelace', configEmail: 'ada@example.com',
    revs: { main: 'a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0', 'HEAD': 'c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2' },
    hashesInRange: ['c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2'],
    commit: {
      'a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0': { subject: 'chore: initial commit', files: ['lib/app.rb'] },
      'c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2': { subject: 'feat: add app + plan', files: ['lib/app.rb', 'docs/ristretto/plans/bootstrap.md'] },
    },
    authors: ['Ada Lovelace|ada@example.com'],
    count: 1,
    ancestors: {},
    pushed: [],
  },

  // A 3-commit run sharing scope 'gate' and the 'scripts' area; the middle
  // commit also touches lib/ — proves the hint + JSON print the UNION of all
  // member areas, not just the first member's.
  two_area_same_scope: {
    branch: 'feature/two-area',
    defaultBranch: 'main',
    mainExists: true,
    configUser: 'Ada Lovelace', configEmail: 'ada@example.com',
    revs: { main: 'b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1', 'HEAD': 'b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3' },
    hashesInRange: ['b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1', 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', 'b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3'],
    commit: {
      'b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1': { subject: 'fix(gate): first', files: ['scripts/gate.js'] },
      'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2': { subject: 'fix(gate): second', files: ['scripts/strata.mjs', 'lib/app.rb'] },
      'b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3': { subject: 'fix(gate): third', files: ['scripts/gate.js'] },
    },
    authors: ['Ada Lovelace|ada@example.com'],
    count: 3,
    ancestors: {},
    pushed: [],
  },

  // An author name containing a literal pipe — proves tab-separated parsing.
  pipe_in_author_name: {
    branch: 'feature/pipe-author',
    defaultBranch: 'main',
    mainExists: true,
    configUser: 'Ada / Lovelace', configEmail: 'ada@example.com',
    revs: { main: 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1' },
    hashesInRange: ['d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1'],
    commit: {
      'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1': { subject: 'docs(ristretto): plan', files: ['docs/ristretto/plans/p.md'] },
    },
    authors: ['Ada / Lovelace|ada@example.com'],
    count: 1,
    ancestors: {},
    pushed: [],
  },

  // A 2-commit non-docs run sharing scope 'gate' (overlapping areas), plus a
  // plain docs commit so analyze passes its "relevant" gate and reaches the
  // hint. Proves the Coalesce-hint fires at 2 commits, not only at 3.
  two_commit_run: {
    branch: 'feature/two-run',
    defaultBranch: 'main',
    mainExists: true,
    configUser: 'Ada Lovelace', configEmail: 'ada@example.com',
    revs: { main: 'c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1', 'HEAD': 'c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4' },
    hashesInRange: ['c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2', 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3', 'c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4'],
    commit: {
      'c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2c2': { subject: 'fix(gate): widen timeout', files: ['scripts/gate.js'] },
      'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3': { subject: 'feat(gate): add retry path', files: ['scripts/gate.js', 'lib/app.rb'] },
      'c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4c4': { subject: 'docs(ristretto): refresh gate plan', files: ['docs/ristretto/plans/gate.md'] },
    },
    authors: ['Ada Lovelace|ada@example.com'],
    count: 3,
    ancestors: {},
    pushed: [],
  },
};

const F = FIXTURES[process.env.GIT_SCENARIO] || FIXTURES.feature_pushed_ticket;

function fail() { process.exit(1); }
function ok() { process.exit(0); }

const args = process.argv.slice(2);
const [sub, ...rest] = args;

// --- branch --------------------------------------------------------------
if (sub === 'branch' && rest[0] === '--show-current') { console.log(F.branch); ok(); }

// --- remote (fixtures always configure 'origin') -------------------------
if (sub === 'remote') { console.log('origin'); ok(); }

// --- config --get branch.<b>.remote / init.defaultRemote -----------------
if (sub === 'config' && rest[0] === '--get') {
  const key = rest[1];
  if (key === `branch.${F.branch}.remote`) { console.log('origin'); ok(); }
  if (key === 'init.defaultRemote') { console.log('origin'); ok(); }
  fail();
}

// --- config user.name / user.email ---------------------------------------
if (sub === 'config' && rest[0] === 'user.name') {
  F.configUser ? console.log(F.configUser) : fail(); ok();
}
if (sub === 'config' && rest[0] === 'user.email') {
  if (F.configEmail) { console.log(F.configEmail); ok(); } fail();
}

// --- symbolic-ref / show-ref (default branch detection) -------------------
if (sub === 'symbolic-ref') {
  if (F.defaultBranch) { console.log(`refs/remotes/origin/${F.defaultBranch}`); ok(); }
  fail();
}
if (sub === 'show-ref' && rest[0] === '--verify') {
  const ref = rest.slice(-1)[0];
  if (ref === `refs/heads/${F.defaultBranch}`) ok();
  fail();
}

// --- rev-parse [–verify] <ref>^{commit} -----------------------------------
// The helper now uses ONE call: `rev-parse --verify <side>^{commit}`, which
// prints the resolved hash on success. Old two-call shape kept for nothing —
// --verify prints the hash too (matches real git).
if (sub === 'rev-parse') {
  const hasVerify = rest[0] === '--verify';
  const target = (hasVerify ? rest[1] : rest[0]) || '';
  const base = target.replace(/\^\{commit\}$/, '');
  const inRevs = Object.prototype.hasOwnProperty.call(F.revs, base);
  const valid = inRevs || /^[0-9a-f]{40}$/.test(base);
  if (!valid) fail();
  console.log(inRevs ? F.revs[base] : base);
  ok();
}

// --- merge-base --is-ancestor <end> <start> --------------------------------
if (sub === 'merge-base' && rest[0] === '--is-ancestor') {
  const [end, start] = [rest[1], rest[2]];
  if (F.ancestors && F.ancestors[start] === end) ok();
  fail();
}

// --- rev-list --count <a>..<b> --------------------------------------------
if (sub === 'rev-list' && rest[0] === '--count') {
  console.log(String(F.count)); ok();
}

// --- log ------------------------------------------------------------------
if (sub === 'log') {
  // Range validation — real git fails on an unknown ref; the shim must too,
  // or the helper's null-on-failure path never fires.
  const rangeArg = rest.find((a) => a && a.includes('..'));
  if (rangeArg) {
    const sides = rangeArg.split('..');
    const okSide = (s) => {
      if (!s || s === 'HEAD' || s === F.defaultBranch || s === F.branch) return true;
      if (/^[0-9a-f]{40}$/.test(s)) return true;
      // Abbreviated hash: valid iff it prefixes a revs value or an in-range hash.
      const full = [...Object.values(F.revs), ...(F.hashesInRange || [])];
      return full.some((v) => v.startsWith(s)) || Object.keys(F.revs).includes(s);
    };
    if (!sides.every(okSide)) fail();
  }
  // Batched push-history: git log --remotes=<remote> --format=%H <range>
  const remotesArg = rest.find((a) => a && a.startsWith('--remotes='));
  if (remotesArg) {
    for (const h of (F.pushed || [])) {
      if ((F.hashesInRange || []).includes(h) && F.commit[h]) console.log(h);
    }
    ok();
  }
  // Batched classification: git log --format=%H|%s --name-only <range>
  if (rest[0] === '--format=%H|%s' && rest.includes('--name-only')) {
    for (const h of F.hashesInRange) {
      const c = F.commit[h];
      if (!c) continue;
      console.log(`${h}|${c.subject}`);
      for (const fn of c.files) console.log(fn);
      console.log('');
    }
    ok();
  }
  const f = rest[0];
  if (f === '--format=%an%x09%ae') {
    for (const a of F.authors) {
      const tab = a.indexOf('|');
      console.log(`${a.slice(0, tab)}\t${a.slice(tab + 1)}`);
    }
    ok();
  }
  // Dead forms (%an|%ae, bare --format=%H, log -1, --oneline, diff-tree) are
  // NOT handled: unrecognized call shapes fall through to the unhandled-call
  // message below and fail loud, instead of green-lighting something the
  // product stopped calling (tamp lean finding).
  console.error(`fake git: unhandled: ${args.join(' ')}`);
  fail();
}

// fallthrough — unknown call
console.error(`fake git: unhandled: ${args.join(' ')}`);
fail();
