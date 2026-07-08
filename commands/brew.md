---
description: Brew the whole pot — autonomously pull every eligible planned feature from the roadmap in sequence, gated by hooks, on a single session branch. Skips to `blocked` instead of guessing. Runs until nothing is left to brew.
---

You are running **BREW** — an autonomous loop over the roadmap. The user batch-planned with `prep` and walked away; all judgment is front-loaded into the plans. You make **zero product decisions**: acceptance criteria define "done", the deterministic gates decide when you may move on, and anything undecidable becomes `blocked` — never a guess.

## Before the loop

1. Read `docs/ristretto/roadmap.md`. If it doesn't exist, tell the user to run `/ristretto:prep` first and stop.
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
3. **Arm the gates**, exactly as in `pull`: create `.ristretto.json` if missing (detect the stack, adopt the repo's existing format/lint/typecheck/test tooling, add `.ristretto/` to `.gitignore`), then create the marker `.ristretto/pulling`. It stays armed for the whole loop.
4. **One branch for the whole session.** Require a clean working tree — if dirty, stop and ask; never brew over uncommitted work. Create and switch to `feature/brew-<YYYY-MM-DD>` (reuse it if you're already on it). Every feature lands here as its own commit. Never push, never set an upstream.

## The loop

A feature is **eligible** when its status is `planned`, all its `Depends:` are `done`, and its `Blockers:` is `—`. While an eligible feature exists, take the topmost:

1. **Read its plan** (`docs/ristretto/plans/<FEATURE-ID>.md`). The acceptance criteria are the contract; the approach is guidance.
2. **Implement** against the current code, lean the first time: reuse before writing, smallest diff that meets the criteria, no scaffolding nothing needs yet.
3. **Skip, never guess.** If you hit something the plan doesn't decide — a real product decision, a missing contract, a blocker the prep didn't see, or gates you cannot get green without weakening them:
   - discard the partial changes for this feature (`git restore` the files you touched — the branch must be clean for the next one),
   - set the roadmap row to `blocked` with a one-line reason (this is the refinement queue the user walks through after the loop),
   - continue with the next eligible feature.
4. **Verify & record evidence.** Transcribe the acceptance criteria into tests where the stack has a test gate — every assertion restates a criterion, never invented. Run the gates; fix until green. Evidence = how each criterion was proven (test names, output, measurements).
5. **Close, exactly as `pull` does:** commit `feat(<FEATURE-ID>): <summary>` staging only the files you touched (never `git add -A`); append `## Evidence` (proof + gate summary) to the plan and move it to `plans/archived/`; flip the roadmap row to `done` with today's date, files touched, and the commit hash.
6. Next eligible feature. Print one line between features — `☕ <FEATURE-ID> brewed (n/m)` — so the trail is readable afterward.

## After the loop

1. **Disarm the gates:** delete `.ristretto/pulling` and `.ristretto/gate-retries` if present. Do this even if the loop aborts.
2. **Report:** features brewed (with commit hashes), features `blocked` (each with its reason — suggest refining them and re-running), and the branch name. If you noticed adjacent problems while working, list them as *suggestions* at the end — do not add them to the roadmap and do not fix them.
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

- **No product decisions.** Ambiguity → `blocked` → next. A wrong guess costs more than a skipped feature.
- **No scope creep.** Adjacent problems go in the final report as suggestions, nothing more.
- **Gates are infrastructure, not suggestions.** Never weaken, skip, or delete gates or tests to get green. A red gate means the work is not done — and if it can't be made green honestly, the feature is `blocked`, not "done with caveats".
- **Never push, never open a PR, never amend or reset existing commits.** Local and append-only; reviewing and pushing the session branch is the user's job.
