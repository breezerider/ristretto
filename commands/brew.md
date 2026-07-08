---
description: Brew the whole pot — autonomously pull every eligible planned feature from the roadmap in sequence, each in a fresh subagent, gated by hooks, on a single session branch. Skips to `blocked` instead of guessing. Runs until nothing is left to brew.
---

You are running **BREW** — an autonomous loop over the roadmap. The user batch-planned with `prep` and walked away; all judgment is front-loaded into the plans. You make **zero product decisions**: acceptance criteria define "done", the deterministic gates decide when a feature may close, and anything undecidable becomes `blocked` — never a guess.

**You are the orchestrator, not the implementer.** Each feature is implemented by a fresh subagent; your context holds only bookkeeping and one-line results. Do not read the codebase, the plans, or any diffs yourself — a large batch must not grow the main conversation. Each subagent starts clean, sees exactly one spec, and dies with all its implementation noise; that fresh context is also more faithful to "build exactly the spec" than one mind carrying the whole batch.

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

   plus one short barista quip, and — if features exist but all are blocked — a line naming what's blocked and why.
3. **Arm the gates**, exactly as in `pull`: create `.ristretto.json` if missing (detect the stack, adopt the repo's existing format/lint/typecheck/test tooling, add `.ristretto/` to `.gitignore`), then create the marker `.ristretto/pulling`. It stays armed for the whole loop — the plugin's Stop **and SubagentStop** hooks run lint + typecheck + test while it exists, so every per-feature subagent is gated individually; a subagent cannot return "done" with red gates.
4. **One branch for the whole session.** Require a clean working tree — if dirty, stop and ask; never brew over uncommitted work. Create and switch to `feature/brew-<YYYY-MM-DD>` (reuse it if you're already on it). Every feature lands here as its own commit. Never push, never set an upstream.

## The loop

A feature is **eligible** when its status is `planned`, all its `Depends:` are `done`, and its `Blockers:` is `—`. While an eligible feature exists:

1. **Pick** the topmost eligible feature (re-read the roadmap each iteration — subagents update it).
2. **Dispatch one subagent** (fresh context, general-purpose) for it — **one at a time, never in parallel**: they share one branch and one repo-wide gate. Give it this brief verbatim, filling in the ID:

   > You are implementing exactly one ristretto feature: **<FEATURE-ID>**. Work autonomously; you cannot ask the user anything.
   >
   > 1. Read `docs/ristretto/plans/<FEATURE-ID>.md`. The acceptance criteria are the contract; the approach is guidance.
   > 2. Implement against the current code, lean the first time: reuse before writing, smallest diff that meets the criteria, no scaffolding nothing needs yet.
   > 3. Verify & record evidence: transcribe the acceptance criteria into tests where the stack has a test gate — every assertion restates a criterion, never invented. Run the gates (`.ristretto.json`); fix until green. A Stop-hook gate will also verify you independently — never weaken, skip, or delete gates or tests to get green.
   > 4. Close: commit `feat(<FEATURE-ID>): <summary>` staging only the files you touched (never `git add -A`); append `## Evidence` (how each criterion was proven — test names, output, measurements; plus a gate summary) to the plan and move it to `docs/ristretto/plans/archived/`; flip the roadmap row to `done` with today's date, files touched, and the commit hash. Never push, never amend or reset existing commits, no PRs.
   > 5. **Skip, never guess.** If you hit a real product decision the plan doesn't make, a missing contract, a blocker prep didn't see, or gates you cannot get green honestly: `git restore` every file you touched (leave the tree clean), set the roadmap row to `blocked` with a one-line reason **phrased as the spec gap** — what the plan failed to decide, not what the code couldn't do ("acceptance criterion 'fast' isn't measurable — needs a number") — and stop there.
   > 6. No scope creep: don't fix adjacent problems; mention them in your final message as suggestions.
   >
   > Your final message must be exactly one of:
   > `brewed: <FEATURE-ID> <commit-hash> — <one-line summary>`
   > `blocked: <FEATURE-ID> — <spec gap>`
   > followed by at most 3 short lines (evidence highlights or suggestions). Nothing else — your full reasoning dies with you; only this summary survives.

3. **Record the result** — the subagent's one-liner is all you keep. Print `☕ <FEATURE-ID> brewed (n/m)` or `⛔ <FEATURE-ID> blocked — <spec gap>` between features so the trail is readable.
4. **Hygiene check** (cheap, no reading): `git status --short` must be clean before the next dispatch. If a subagent died mid-work and left changes, `git restore` them and set that row to `blocked` (reason: "implementation aborted mid-work — re-brew or refine").
5. Next eligible feature.

## After the loop

1. **Disarm the gates:** delete `.ristretto/pulling` and `.ristretto/gate-retries` if present. Do this even if the loop aborts.
2. **Report:** features brewed (with commit hashes), features `blocked` (each with its spec gap — suggest refining them and re-running), the branch name, and any suggestions the subagents surfaced — do not add those to the roadmap and do not fix them.
   **Tasting note — reward the specs, honestly:** if every eligible feature brewed with zero blocks, lead the report with `☕ perfectly dialed in — every spec held end to end.` That's the payoff for doing refinement properly; never print it when anything blocked.
3. If the roadmap is now fully `done`, end with the milestone cup:

   ```
      ) )  ( (
   .__________.
   |          |]
   |          |
   `----------'
   ALL BREWED — roadmap clear ☕
   ```

   Otherwise end with the little cup and `☕ pot empty — N blocked feature(s) waiting on you.`

## Hard rules

- **Orchestrator stays out of the code.** You never implement, read source, or inspect diffs yourself — that's what the subagents are for. If a subagent fails oddly, mark the feature `blocked` and move on; never "just fix it quickly" in the main context.
- **No product decisions.** Ambiguity → `blocked` → next. A wrong guess costs more than a skipped feature.
- **Gates are infrastructure, not suggestions.** A red gate means the work is not done — and if it can't be made green honestly, the feature is `blocked`, not "done with caveats".
- **Never push, never open a PR, never amend or reset existing commits.** Local and append-only; reviewing and pushing the session branch is the user's job.
