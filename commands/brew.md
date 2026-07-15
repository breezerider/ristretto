---
description: Brew the whole pot — autonomously pull every eligible planned feature from the roadmap in sequence, each in a fresh subagent, gated by hooks, on a single session branch. Skips to `blocked` instead of guessing. Runs until nothing is left to brew.
---

You are running **BREW** — an autonomous loop over the roadmap. The user batch-planned with `prep` and walked away; all judgment is front-loaded into the plans. You make **zero product decisions**: acceptance criteria define "done", the deterministic gates decide when a feature may close, and anything undecidable becomes `blocked` — never a guess.

**You are the orchestrator, not the implementer.** Each feature runs through fresh subagents — an implementer, an independent reviewer, and a closer; your context holds only bookkeeping and one-line results. Do not read the codebase, the plans, or any diffs yourself — a large batch must not grow the main conversation. Each subagent starts clean, sees exactly one job, and dies with all its noise; the reviewer's fresh context is also what makes the review independent — it never saw the implementer's reasoning.

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
3. **Arm the gates**, exactly as in `pull`: create `.ristretto.json` if missing (detect the stack, adopt the repo's existing format/lint/typecheck/test tooling, add `.ristretto/` to `.gitignore`), then create the marker `.ristretto/pulling`. It stays armed for the whole loop — the plugin's Stop **and SubagentStop** hooks run lint + typecheck + test while it exists, so every per-feature subagent is gated individually; a subagent cannot return "done" with red gates. (The gate runner fingerprints a green tree and skips re-running on an unchanged one, so read-only subagents — reviewers, closers — don't pay a full test run at every stop.)
4. **One branch for the whole session.** Require a clean working tree — if dirty, stop and ask; never brew over uncommitted work. Create and switch to `feature/brew-<YYYY-MM-DD>` (reuse it if you're already on it). Every feature lands here as its own commit. Never push, never set an upstream.

## The loop

A feature is **eligible** when its status is `planned`, all its `Depends:` are `done`, and its `Blockers:` is `—`. While an eligible feature exists:

1. **Pick** the topmost eligible feature (re-read the roadmap each iteration — subagents update it).
2. **Dispatch the implementer** (fresh context, general-purpose) — **one feature at a time, never in parallel**: subagents share one branch and one repo-wide gate. Give it this brief verbatim, filling in the ID:

   > You are implementing exactly one ristretto feature: **<FEATURE-ID>**. Work autonomously; you cannot ask the user anything.
   >
   > 1. Read `docs/ristretto/plans/<FEATURE-ID>.md`. The acceptance criteria are the contract; the approach is guidance.
   > 2. **Tests first, red first**: where the stack has a test gate, transcribe the acceptance criteria into tests before implementing — every assertion restates a criterion, never invented — and run them to confirm they fail. A test that passes before implementation proves nothing.
   > 3. Implement against the current code, lean the first time: reuse before writing, smallest diff that meets the criteria, no scaffolding nothing needs yet. Done when the red tests pass.
   > 4. Verify: run the gates (`.ristretto.json`); fix until green. A Stop-hook gate will also verify you independently — never weaken, skip, or delete gates or tests to get green.
   > 5. **Do NOT commit, archive, or touch the roadmap** — an independent review happens after you.
   > 6. **Skip, never guess.** If you hit a real product decision the plan doesn't make, a missing contract, a blocker prep didn't see, or gates you cannot get green honestly: `git restore` every file you touched (leave the tree clean), set the roadmap row to `blocked` with a one-line reason **phrased as the spec gap** — what the plan failed to decide, not what the code couldn't do ("acceptance criterion 'fast' isn't measurable — needs a number") — and stop there.
   > 7. No scope creep: don't fix adjacent problems; mention them in your final message as suggestions.
   >
   > Your final message must be exactly one of:
   > `ready: <FEATURE-ID> — <files touched> — <red→green test names, or how criteria were proven>`
   > `blocked: <FEATURE-ID> — <spec gap>`
   > followed by at most 3 short lines. Nothing else — your full reasoning dies with you; only this summary survives.

3. **Dispatch the reviewer** (fresh subagent) on a `ready:` result — unless the diff is trivial (roughly < 15 changed lines and no new functions/branches/loops; when in doubt, review). Use the review brief from `pull` verbatim: read the plan and the feature's diff, change no files, two lenses in priority order — `bug` (criterion not actually satisfied, unhandled edge cases on changed paths, logic errors gates can't catch, tests that don't honestly restate a criterion) and `lean` (runtime waste, duplication vs existing repo utilities, dead/over-built, readability). At most 7 one-line findings (`bug|lean · file:line · what · fix`), bugs first; nothing material → exactly `review: clean`.

4. **Act on the verdict** — capped at 2 review rounds:
   - `review: clean` → dispatch the **closer**.
   - Findings → dispatch a **fixer** subagent: "Fix these review findings for <FEATURE-ID>: every `bug` is mandatory, `lean` unless riskier than the win. Gates green. Do not commit or close. Final message: `fixed: <FEATURE-ID> — <what was fixed / left>`." Then a fresh reviewer verifies (round 2) — prior findings and any defect the fixes introduced, no new lean fronts. Clean → closer; **bugs still open → `git restore` the touched files, set the row to `blocked`** with the defect as the one-line reason (e.g. `review: criterion 2 unmet after 2 rounds — <what>`), and move on.
   - **Closer** brief: "Close ristretto feature <FEATURE-ID>: commit `feat(<FEATURE-ID>): <summary>` staging only the touched files (never `git add -A`); append `## Evidence` to the plan — how each criterion was proven (red→green test names, output, measurements), a gate summary, and the review verdict — and move it to `docs/ristretto/plans/archived/`; flip the roadmap row to `done` with today's date, files touched, and the commit hash. Never push, never amend or reset, no PRs. Final message: `brewed: <FEATURE-ID> <commit-hash> — <one-line summary>`."

5. **Record the result** — each subagent's one-liner is all you keep. Print `☕ <FEATURE-ID> brewed (n/m)` or `⛔ <FEATURE-ID> blocked — <reason>` between features so the trail is readable.
6. **Hygiene check** (cheap, no reading): `git status --short` must be clean before the next feature's implementer is dispatched. If a subagent died mid-work and left changes, `git restore` them and set that row to `blocked` (reason: "implementation aborted mid-work — re-brew or refine").
7. Next eligible feature.

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
