# Design: Review gate + tests-first for pull/brew/shot

Date: 2026-07-15
Status: approved

## Problem

`pull` enforces a deterministic correctness floor (lint/typecheck/test gates) but code
*quality* is self-graded prose: the same agent that writes the code polices its own
leanness, and the only quality check (`tamp`) is an optional suggestion after the commit.
Evidence is likewise self-reported. Result: messy or subtly broken code can reach a
commit, and rejected MRs happen downstream.

## Decisions (user-confirmed)

1. **Trigger:** review runs on every pull, auto-skipped only for trivial diffs.
2. **Loop control:** all `bug` findings must be fixed; hard cap of 2 review rounds,
   then surface instead of looping.
3. **Scope:** pull, brew (per-feature), and shot — no path to a commit without review.
4. **TDD:** strict red→green — acceptance tests written first, confirmed failing,
   then implement to green.
5. **Reviewer:** a dedicated fresh subagent with a verbatim brief (independence is the
   point). Not `tamp` (same-context, no bug lens), not a hook (review is judgment).

## 1. New pull lifecycle

Steps 1–4 (roadmap, plan, arm gates, branch) unchanged. Then:

- **5. Tests first (red).** If the repo has a test gate: transcribe acceptance criteria
  into tests *before implementing* — every assertion restates a criterion. Run them,
  confirm they fail. A test that passes before implementation proves nothing — rewrite
  it, or if the criterion is genuinely already met, investigate before continuing.
  Non-test-checkable criteria (measurements, binary observations) are exempt; repos
  without a test gate skip the step.
- **6. Implement to green** — existing lean rules; done when the red tests pass.
- **7. Verify & evidence** — as today, plus Evidence records red→green (which tests
  failed before implementation and pass now).
- **8. Review gate** — see below.
- **9. Close** — as today, plus the review verdict in Evidence
  (`review: clean` / `review: N findings resolved`). The "suggest /ristretto:tamp"
  summary line is dropped — the diff was just reviewed.

## 2. The reviewer

After gates are green, before any commit, dispatch **one fresh general-purpose
subagent** that never saw the implementation reasoning. Skip only when the diff is
trivial: roughly < 15 changed lines *and* no new logic (no new functions/branches/
loops). When in doubt, review.

Brief (verbatim in the command files): read the plan (criteria = contract) and the
feature diff; change no files. Two lenses, priority order:

1. `bug` — a criterion not actually satisfied, unhandled edge cases on changed paths,
   logic errors the gates can't catch, tests that don't honestly restate a criterion.
2. `lean` — tamp's facets: runtime waste, duplication vs existing repo utilities,
   dead/over-built, readability drag.

At most 7 findings, bugs first, one line each
(`bug|lean · file:line · what · fix`). Nothing material → final message exactly
`review: clean`, else `review: N findings` + the findings. Nothing else.

## 3. Loop control

- **Round 1:** `clean` → close. Findings → every `bug` fixed (mandatory); `lean` fixed
  unless riskier than the win (leftovers stated in the summary). Gates re-run.
- **Round 2:** only if round 1 had bugs — fresh reviewer, instructed to verify the
  prior findings and any defect introduced by the fixes, not to open new lean fronts.
- **Bugs still open after round 2:** hard stop (mirrors the 3-retry gate rule).
  pull/shot: don't commit, surface findings, leave the branch. brew: `git restore`
  touched files, row → `blocked` with the defect as the one-line reason.

## 4. Brew wiring

Per-feature flow splits so nothing is committed unreviewed; orchestrator still never
reads code:

1. **Implementer** subagent — as today minus closing: tests-first, gates green,
   **no commit, no archive**. Returns `ready: <ID> — <files touched>` or `blocked: …`.
2. **Reviewer** subagent — brief above.
3. `clean` → **closer** subagent (commit, Evidence, archive, roadmap). Findings →
   **fixer** subagent (fix bugs + quick leans, gates green, no close) → reviewer
   round 2 → clean → closer; bugs remain → restore + `blocked`.

Common case 3 dispatches per feature, worst case 5. Shot gets the same review step
inline.

## 5. Gate fingerprint (scripts/gate.js)

Every subagent stop triggers the full SubagentStop gate; review adds 2–4 stops per
brew feature where nothing changed. Fix: on a green full run, store a fingerprint of
the working tree (HEAD + `git status --porcelain -uall` + content hash of each dirty/
untracked file) in `.ristretto/gate-green`; on the next full run, if the fingerprint
matches, exit 0 immediately. Not a git repo / git unavailable → no caching, gates
always run (safe fallback, keeps non-git tests valid). Covered in `gate.test.js`.

## 6. Files touched

`commands/pull.md`, `commands/brew.md`, `commands/shot.md`, `scripts/gate.js`,
`scripts/gate.test.js`, `README.md`.
