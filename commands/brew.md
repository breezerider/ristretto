---
description: Brew the whole pot — autonomously pull every eligible planned feature from the roadmap in sequence, each planned and built by fresh subagents, gated by hooks, on a single session branch. Skips to `blocked` instead of guessing. Runs until nothing is left to brew.
---

You are running **BREW** — an autonomous loop over the roadmap. The user batch-planned with `prep` and walked away; all judgment is front-loaded into the plans. You make **zero product decisions**: acceptance criteria define "done", the deterministic gates decide when a feature may close, and anything undecidable becomes `blocked` — never a guess.

**You are the orchestrator, not the implementer.** Each feature runs through fresh subagents — a planner, an implementer, an independent reviewer, and a closer; your context holds only bookkeeping and one-line results. Do not read the codebase, the plans, or any diffs yourself — a large batch must not grow the main conversation. Each subagent starts clean, sees exactly one job, and dies with all its noise; the reviewer's fresh context is also what makes the review independent — it never saw the implementer's reasoning.

## Before the loop

1. Read `docs/ristretto/roadmap.md` (the one file you do read — it's the index, built to be read in ten seconds). If it doesn't exist, tell the user to run `/ristretto:prep` first and stop.
2. If no feature is *eligible* (see loop condition below), do no work — just print the classic cup and stop:

   ```
         ) )
        ( (
      .________.
      |        |]
      |        |
      `--------'
      ☕ ristretto: nothing to brew.
   ```

   plus one short barista quip, and — if features exist but all are blocked — a line naming what's blocked and why. If any row is `needs-ops` with unticked boxes, name those too, separately: they aren't waiting on refinement, they're waiting on you to run something.
3. **Pre-flight — the repo must already be green.** Create `.ristretto.json` if missing, exactly as in `pull` step 3 — and if the suite is slower than a minute, **set `testChanged`**, which is what keeps the loop's per-subagent gate from re-running the whole suite dozens of times. Then prove the tree once, before arming anything:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify
   ```

   Exit 0 → carry on. Exit 1 → stop immediately:

   ```
   ⛔ ristretto: repo is not green — nothing brewed.
      <gate>: <the failure, one line>
      fix this first; brew won't build on a red tree.
   ```

   Do not create the marker, do not create the branch, do not dispatch anything. This check costs one test run and is the cheapest failure in the whole command — without it the first *planner* subagent trips the SubagentStop hook, gets retried three times, and surfaces a confusing block for a failure it did not cause and could not fix, having written no source at all.

   **If a gate was killed as hung rather than failing**, say exactly that and stop — a hang is not a red tree, and it is the one failure that will otherwise repeat at every single stop for the whole run:

   ```
   ⛔ ristretto: the <gate> gate went silent for Ns and was killed — nothing brewed.
      find what it's waiting on (open handle, port, watch mode), or raise
      silence.<gate> in .ristretto.json if that tool is just quiet for long stretches.
   ```

4. **Arm the gates**, exactly as in `pull`: create the marker `.ristretto/pulling`, and `.ristretto/build/` if it doesn't exist. The marker stays armed for the whole loop — the plugin's Stop **and SubagentStop** hooks run lint + typecheck + test while it exists, so every per-feature subagent is gated individually; a subagent cannot return "done" with red gates. Two things keep that affordable across a long batch: the gate runner fingerprints a green tree and skips re-running on an unchanged one (so reviewers and closers, which change nothing, don't pay a test run at every stop), and while the loop is running the test gate is the **scoped** `testChanged` command — only what the current feature touched. Repo-wide proof happens once, after the loop.

5. **One branch for the whole session.** Require a clean working tree — if dirty, stop and ask; never brew over uncommitted work. Create and switch to `feature/brew-<YYYY-MM-DD>` (reuse it if you're already on it). Every feature lands here as its own commit. Never push, never set an upstream.

## The loop

A feature is **eligible** when its status is `planned`, all its `Depends:` are satisfied, and its `Blockers:` is `—`.

**A `Depends:` is satisfied by `done` or `needs-ops`.** A prerequisite waiting on a manual op has its code built, committed, and its `Provides:` present — the outstanding step is in someone's database console, not in the repo. Treating it as unfinished would stall an entire flight behind one `alter table`, which is precisely the failure this status exists to prevent. Only `blocked` — a genuine spec gap, where the prerequisite's code was never written — holds dependents back.

Also re-check ops each pass: a `needs-ops` row whose `before` ops are now all ticked `- [x]` in `docs/ristretto/manual-ops.md` is eligible as an **ops re-check** — dispatch a closer to prove its pending criteria and flip it to `done`, no planner or implementer needed.

While an eligible feature exists:

1. **Pick** the topmost eligible feature (re-read the roadmap each iteration — subagents update it).
2. **Dispatch the planner** (fresh context, capable model) — **before** any implementer runs. The plan holds the destination; this writes the directions, now, against HEAD, so they cannot be stale. Use the planner brief from `pull` step 5 verbatim, filling in the ID: read the plan (`## Contract` binding, `## Approach` possibly stale), take each dependency's `Provides:` as fact, read the current code, write `.ristretto/build/<FEATURE-ID>.md` with real paths, signatures, and test code, no placeholders — and record any **manual op** it finds against HEAD, with the exact command and the criteria that wait on it. Then write those ops into `docs/ristretto/manual-ops.md` in the format `pull` defines.

   On `blocked:`, set the roadmap row to `blocked` with that reason and move to the next feature — **no implementer ever runs**. This is the cheap failure, and it is where you want failures to happen. A manual op is never a `blocked:` — the feature still gets built.

3. **Dispatch the implementer** (fresh context, general-purpose) — **one feature at a time, never in parallel**: subagents share one branch and one repo-wide gate. Give it this brief verbatim, filling in the ID:

   > You are implementing exactly one ristretto feature: **<FEATURE-ID>**. Work autonomously; you cannot ask the user anything.
   >
   > 1. Read `.ristretto/build/<FEATURE-ID>.md` — your plan, written against the current code minutes ago. `docs/ristretto/plans/<FEATURE-ID>.md`'s `## Contract` is the acceptance contract behind it. Implement the plan; do not re-plan.
   > 2. **Tests first, red first**: where the stack has a test gate, the build plan's test cases become tests before implementing — they are already transcriptions of the acceptance criteria; do not re-derive them — and run them to confirm they fail. A test that passes before implementation proves nothing. Tests the build plan marks as waiting on a **manual op** are the exception: write them skipped, each naming the op that unblocks it. They can't go red honestly — the environment they need doesn't exist yet.
   > 3. Implement the build plan against the current code, lean the first time: its file paths, names, and signatures; reuse before writing, smallest diff that meets the criteria, no scaffolding nothing needs yet. Done when the red tests pass.
   > 4. Verify: run the gates (`.ristretto.json`); fix until green. A Stop-hook gate will also verify you independently — never weaken, skip, or delete gates or tests to get green.
   > 5. **Do NOT commit, archive, or touch the roadmap** — an independent review happens after you.
   > 6. **Skip, never guess.** If you hit a real product decision the plan doesn't make, a missing contract, a blocker prep didn't see, or gates you cannot get green honestly: `git restore` every file you touched (leave the tree clean), set the roadmap row to `blocked` with a one-line reason **phrased as the spec gap** — what the plan failed to decide, not what the code couldn't do ("acceptance criterion 'fast' isn't measurable — needs a number") — and stop there.
   > 7. **A manual op is not a block, and never a `git restore`.** If a criterion can only be proven once a human runs something (SQL, a migration, a secret, a console switch), the code still gets written and the gates still go green — you skip the test that needs the live environment and keep going. Make sure the op is in `docs/ristretto/manual-ops.md` with the exact command, and report it. Never tick a box there.
   > 8. No scope creep: don't fix adjacent problems; mention them in your final message as suggestions.
   >
   > Your final message must be exactly one of:
   > `ready: <FEATURE-ID> — <files touched> — <red→green test names, or how criteria were proven>`
   > `needs-ops: <FEATURE-ID> — <files touched> — <criteria proven> — pending: <the op, one line>`
   > `blocked: <FEATURE-ID> — <spec gap>`
   > followed by at most 3 short lines. Nothing else — your full reasoning dies with you; only this summary survives.

   A `needs-ops:` result continues exactly like `ready:` — review, then close. The only difference is the status the closer writes.

4. **Dispatch the reviewer** (fresh subagent, capable model) on a `ready:` or `needs-ops:` result — unless the diff is trivial (roughly < 15 changed lines and no new functions/branches/loops; when in doubt, review). Use the review brief from `pull` verbatim: read the plan and the feature's diff, change no files, two lenses in priority order — `bug` (criterion not actually satisfied, unhandled edge cases on changed paths, logic errors gates can't catch, tests that don't honestly restate a criterion) and `lean` (runtime waste, duplication vs existing repo utilities, dead/over-built, readability). At most 7 one-line findings (`bug|lean · file:line · what · fix`), bugs first; nothing material → exactly `review: clean`.

5. **Act on the verdict** — capped at 3 rounds:
   - `review: clean` → dispatch the **closer**.
   - Findings → dispatch a **fixer** subagent: "Fix these review findings for <FEATURE-ID>: every `bug` is mandatory, `lean` unless riskier than the win. Gates green. Do not commit or close. Final message: `fixed: <FEATURE-ID> — <what was fixed / left>`." Then a fresh reviewer verifies (round 2) — prior findings and any defect the fixes introduced, no new lean fronts. Clean → closer.
   - **Round 3 — escalate before you give up.** Bugs still open after round 2: dispatch a **fresh** implementer on a model one tier above the one that got stuck, given the plan, the open findings, and the diff — not the failed attempts. Then one final scoped re-review. Still open → `git restore` the touched files, set the row to `blocked` with the defect as the one-line reason (e.g. `review: criterion 2 unmet after 3 rounds — <what>`), and move on. Three rounds, then stop: still bounded, still never stuck.
   - **Closer** brief: "Close ristretto feature <FEATURE-ID>: commit `feat(<FEATURE-ID>): <summary>` staging only the touched files (never `git add -A`); in the plan, correct `Provides:` to whatever was actually built, append `## Evidence` — how each criterion was proven (red→green test names, output, measurements), a gate summary, and the review verdict — and move it to `docs/ristretto/plans/archived/`; delete `.ristretto/build/<FEATURE-ID>.md`; flip the roadmap row to `done` with today's date, files touched, and the commit hash. A criterion that can only be proven after a manual op is recorded as `pending ops: <op>`, never as proven, and the row's status is **`needs-ops`** instead of `done` — the plan is still archived, the commit still made. Features with only `after` ops close as `done`. Never push, never amend or reset, no PRs. Final message: `brewed: <FEATURE-ID> <commit-hash> — <one-line summary>` or `brewed-needs-ops: <FEATURE-ID> <commit-hash> — pending: <op>`."
   - **Ops re-check** (a `needs-ops` row whose `before` ops are now all ticked): no planner, no implementer. Dispatch a closer to un-skip the tests that named those ops, run them, and — if they pass — replace the `pending ops` lines in the archived plan's Evidence with real proof and flip the row to `done`. If they fail, the op didn't do what the plan assumed: set the row to `blocked` with that as the reason.

6. **Record the result** — each subagent's one-liner is all you keep. Print `☕ <FEATURE-ID> brewed (n/m)`, `🔧 <FEATURE-ID> brewed, needs ops — <op>`, or `⛔ <FEATURE-ID> blocked — <reason>` between features so the trail is readable.
7. **Hygiene check** (cheap, no reading): `git status --short` must be clean before the next feature's planner is dispatched. If a subagent died mid-work and left changes, `git restore` them and set that row to `blocked` (reason: "implementation aborted mid-work — re-brew or refine"). Delete any leftover `.ristretto/build/<FEATURE-ID>.md` for a feature that blocked.
8. Next eligible feature.

## After the loop

1. **Run the full suite — once, over everything.** The loop gated each feature against `testChanged`, which only ever proved the files that feature touched. Nothing yet has proven that feature 7 didn't break feature 2. So before you disarm anything:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify
   ```

   - **Exit 0** → the batch holds. Record the summary line in the report.
   - **Exit 1** → say so loudly and first, above everything else. **Do not amend, revert, or reset the commits** — they're already made, nothing was pushed, and the branch is the user's to review:

     ```
     ⛔ full suite RED after the batch — <n> features are committed on <branch> but the repo is not green.
        <gate>: <the failure, one line>
        cross-feature breakage the scoped runs couldn't see. fix on the branch, or
        /ristretto:prep a fix and pull it before merging.
     ```

     This is the known cost of scoping tests during the loop, and it's the right trade — a fast batch with one honest red at the end beats a batch too slow to finish. What isn't acceptable is a quiet one.
   - **A gate killed as hung** is neither: report the batch as unverified, name the gate, and point at what it might be waiting on / `silence` in `.ristretto.json`.

2. **Disarm the gates:** delete `.ristretto/pulling`, and `.ristretto/gate-retries` / `.ristretto/gate-stalled` if present, and delete any remaining `.ristretto/build/` files. Do this even if the loop aborts.
3. **Report:** the full-suite verdict, features brewed (with commit hashes), features `needs-ops` (each with its op), features `blocked` (each with its spec gap — suggest refining them and re-running), the branch name, and any suggestions the subagents surfaced — do not add those to the roadmap and do not fix them.

   If any ops are outstanding, close with the checklist pointer — this is the whole point of writing them down:

   ```
   🔧 3 manual ops waiting — docs/ristretto/manual-ops.md
      run them, tick the boxes, then /ristretto:brew again to verify what was pending.
   ```

   **Tasting note — reward the specs, honestly:** if every eligible feature brewed with zero blocks *and* the full suite is green, lead the report with `☕ perfectly dialed in — every spec held end to end.` That's the payoff for doing refinement properly; never print it when anything blocked or the final suite is red. Outstanding manual ops don't disqualify it — the specs did hold; a human just has a key to turn.
4. If the roadmap is now fully `done`, end with the milestone cup:

   ```
      ) )  ( (
   .__________.
   |          |]
   |          |
   `----------'
   ALL BREWED — roadmap clear ☕
   ```

   Otherwise end with the little cup and `☕ pot empty — N blocked feature(s) waiting on you.` (Count only `blocked` there; `needs-ops` gets its own 🔧 line — they are different queues with different remedies, and merging them is what made this confusing in the first place.)

## Hard rules

- **Always name the model when dispatching.** Planner and reviewer: capable. Implementer: cheap when the build plan contains the code to write (that work is transcription plus testing); standard when it spans several files. An omitted model silently inherits the session's, defeating this.
- **Orchestrator stays out of the code.** You never implement, read source, or inspect diffs yourself — that's what the subagents are for. If a subagent fails oddly, mark the feature `blocked` and move on; never "just fix it quickly" in the main context.
- **No product decisions.** Ambiguity → `blocked` → next. A wrong guess costs more than a skipped feature.
- **A missing decision blocks; a missing keystroke does not.** `blocked` is for spec gaps only. Anything a human simply has to *run* becomes a line in `manual-ops.md` and a `needs-ops` close — the code still gets built, and the features behind it still get brewed. Stalling a whole flight on one `alter table` is the failure mode this replaced.
- **Gates are infrastructure, not suggestions.** A red gate means the work is not done — and if it can't be made green honestly, the feature is `blocked`, not "done with caveats". A gate that *hangs* is a third thing: unverified. Never treat a timeout as green.
- **Never push, never open a PR, never amend or reset existing commits.** Local and append-only; reviewing and pushing the session branch is the user's job.
