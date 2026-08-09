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

   plus one short barista quip, and — if features exist but all are blocked — a line naming what's blocked and why.
3. **Pre-flight — the repo must already be green.** Create `.ristretto.json` if missing (detect the stack, adopt the repo's existing format/lint/typecheck/test tooling, add `.ristretto/` to `.gitignore`), then **run its gates once yourself, before arming anything.** If lint, typecheck, or test is red on an untouched tree, stop immediately:

   ```
   ⛔ ristretto: repo is not green — nothing brewed.
      <gate>: <the failure, one line>
      fix this first; brew won't build on a red tree.
   ```

   Do not create the marker, do not create the branch, do not dispatch anything. This check costs one test run and is the cheapest failure in the whole command — without it the first *planner* subagent trips the SubagentStop hook, gets retried three times, and surfaces a confusing block for a failure it did not cause and could not fix, having written no source at all.

4. **Arm the gates**, exactly as in `pull`: create the marker `.ristretto/pulling`, and `.ristretto/build/` if it doesn't exist. The marker stays armed for the whole loop — the plugin's Stop **and SubagentStop** hooks run lint + typecheck + test while it exists, so every per-feature subagent is gated individually; a subagent cannot return "done" with red gates. (The gate runner fingerprints a green tree and skips re-running on an unchanged one, so read-only subagents — reviewers, closers — don't pay a full test run at every stop.)

5. **One branch for the whole session.** Require a clean working tree — if dirty, stop and ask; never brew over uncommitted work. Create and switch to `feature/brew-<YYYY-MM-DD>` (reuse it if you're already on it). Every feature lands here as its own commit. Never push, never set an upstream.

## The loop

A feature is **eligible** when its status is `planned`, all its `Depends:` are `done`, and its `Blockers:` is `—`. While an eligible feature exists:

1. **Pick** the topmost eligible feature (re-read the roadmap each iteration — subagents update it).
2. **Dispatch the planner** (fresh context, capable model) — **before** any implementer runs. The plan holds the destination; this writes the directions, now, against HEAD, so they cannot be stale. Give it this brief verbatim, filling in the ID:

   > You are the PLANNER for ristretto feature **<FEATURE-ID>**. You write no implementation code and modify no source file.
   >
   > 1. Read `docs/ristretto/plans/<FEATURE-ID>.md`. `## Contract` is binding; `## Approach` is guidance that may be stale.
   > 2. For every ID in `Depends:`, read that feature's archived plan and take its `Provides:` as fact — those signatures exist, use them verbatim.
   > 3. Read the current code in the touchpoint areas. Find the existing utilities, patterns, and test conventions this repo already uses. What you find beats what the Approach says.
   > 4. Write `.ristretto/build/<FEATURE-ID>.md`: for each unit in `Contract.Units` (or the whole feature if `Units` is `—`) — exact file paths to create or modify, the real function/type names and signatures each unit produces and consumes, and the test cases that prove each acceptance criterion, as actual test code in this repo's test style.
   > 5. **No placeholders.** No "TBD", no "add error handling", no "similar to the above", no reference to a type or function no unit defines. Any of these means the plan is not finished.
   > 6. If the Contract cannot be satisfied against the current code — a criterion contradicts what's there, a `Consumes:` signature doesn't exist, a decision was never made — do **not** guess. Write nothing and return `blocked`.
   >
   > Final message, exactly one of:
   > `planned: <FEATURE-ID> — <n> units, <n> tests`
   > `blocked: <FEATURE-ID> — <the spec gap, phrased as what the plan failed to decide>`
   > Nothing else.

   On `blocked:`, set the roadmap row to `blocked` with that reason and move to the next feature — **no implementer ever runs**. This is the cheap failure, and it is where you want failures to happen.

3. **Dispatch the implementer** (fresh context, general-purpose) — **one feature at a time, never in parallel**: subagents share one branch and one repo-wide gate. Give it this brief verbatim, filling in the ID:

   > You are implementing exactly one ristretto feature: **<FEATURE-ID>**. Work autonomously; you cannot ask the user anything.
   >
   > 1. Read `.ristretto/build/<FEATURE-ID>.md` — your plan, written against the current code minutes ago. `docs/ristretto/plans/<FEATURE-ID>.md`'s `## Contract` is the acceptance contract behind it. Implement the plan; do not re-plan.
   > 2. **Tests first, red first**: where the stack has a test gate, the build plan's test cases become tests before implementing — they are already transcriptions of the acceptance criteria; do not re-derive them — and run them to confirm they fail. A test that passes before implementation proves nothing.
   > 3. Implement the build plan against the current code, lean the first time: its file paths, names, and signatures; reuse before writing, smallest diff that meets the criteria, no scaffolding nothing needs yet. Done when the red tests pass.
   > 4. Verify: run the gates (`.ristretto.json`); fix until green. A Stop-hook gate will also verify you independently — never weaken, skip, or delete gates or tests to get green.
   > 5. **Do NOT commit, archive, or touch the roadmap** — an independent review happens after you.
   > 6. **Skip, never guess.** If you hit a real product decision the plan doesn't make, a missing contract, a blocker prep didn't see, or gates you cannot get green honestly: `git restore` every file you touched (leave the tree clean), set the roadmap row to `blocked` with a one-line reason **phrased as the spec gap** — what the plan failed to decide, not what the code couldn't do ("acceptance criterion 'fast' isn't measurable — needs a number") — and stop there.
   > 7. No scope creep: don't fix adjacent problems; mention them in your final message as suggestions.
   >
   > Your final message must be exactly one of:
   > `ready: <FEATURE-ID> — <files touched> — <red→green test names, or how criteria were proven>`
   > `blocked: <FEATURE-ID> — <spec gap>`
   > followed by at most 3 short lines. Nothing else — your full reasoning dies with you; only this summary survives.

4. **Dispatch the reviewer** (fresh subagent, capable model) on a `ready:` result — unless the diff is trivial (roughly < 15 changed lines and no new functions/branches/loops; when in doubt, review). Use the review brief from `pull` verbatim: read the plan and the feature's diff, change no files, two lenses in priority order — `bug` (criterion not actually satisfied, unhandled edge cases on changed paths, logic errors gates can't catch, tests that don't honestly restate a criterion) and `lean` (runtime waste, duplication vs existing repo utilities, dead/over-built, readability). At most 7 one-line findings (`bug|lean · file:line · what · fix`), bugs first; nothing material → exactly `review: clean`.

5. **Act on the verdict** — capped at 3 rounds:
   - `review: clean` → dispatch the **closer**.
   - Findings → dispatch a **fixer** subagent: "Fix these review findings for <FEATURE-ID>: every `bug` is mandatory, `lean` unless riskier than the win. Gates green. Do not commit or close. Final message: `fixed: <FEATURE-ID> — <what was fixed / left>`." Then a fresh reviewer verifies (round 2) — prior findings and any defect the fixes introduced, no new lean fronts. Clean → closer.
   - **Round 3 — escalate before you give up.** Bugs still open after round 2: dispatch a **fresh** implementer on a model one tier above the one that got stuck, given the plan, the open findings, and the diff — not the failed attempts. Then one final scoped re-review. Still open → `git restore` the touched files, set the row to `blocked` with the defect as the one-line reason (e.g. `review: criterion 2 unmet after 3 rounds — <what>`), and move on. Three rounds, then stop: still bounded, still never stuck.
   - **Closer** brief: "Close ristretto feature <FEATURE-ID>: commit `feat(<FEATURE-ID>): <summary>` staging only the touched files (never `git add -A`); in the plan, correct `Provides:` to whatever was actually built, append `## Evidence` — how each criterion was proven (red→green test names, output, measurements), a gate summary, and the review verdict — and move it to `docs/ristretto/plans/archived/`; delete `.ristretto/build/<FEATURE-ID>.md`; flip the roadmap row to `done` with today's date, files touched, and the commit hash. Never push, never amend or reset, no PRs. Final message: `brewed: <FEATURE-ID> <commit-hash> — <one-line summary>`."

6. **Record the result** — each subagent's one-liner is all you keep. Print `☕ <FEATURE-ID> brewed (n/m)` or `⛔ <FEATURE-ID> blocked — <reason>` between features so the trail is readable.
7. **Hygiene check** (cheap, no reading): `git status --short` must be clean before the next feature's planner is dispatched. If a subagent died mid-work and left changes, `git restore` them and set that row to `blocked` (reason: "implementation aborted mid-work — re-brew or refine"). Delete any leftover `.ristretto/build/<FEATURE-ID>.md` for a feature that blocked.
8. Next eligible feature.

## After the loop

1. **Disarm the gates:** delete `.ristretto/pulling` and `.ristretto/gate-retries` if present, and delete any remaining `.ristretto/build/` files. Do this even if the loop aborts.
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

- **Always name the model when dispatching.** Planner and reviewer: capable. Implementer: cheap when the build plan contains the code to write (that work is transcription plus testing); standard when it spans several files. An omitted model silently inherits the session's, defeating this.
- **Orchestrator stays out of the code.** You never implement, read source, or inspect diffs yourself — that's what the subagents are for. If a subagent fails oddly, mark the feature `blocked` and move on; never "just fix it quickly" in the main context.
- **No product decisions.** Ambiguity → `blocked` → next. A wrong guess costs more than a skipped feature.
- **Gates are infrastructure, not suggestions.** A red gate means the work is not done — and if it can't be made green honestly, the feature is `blocked`, not "done with caveats".
- **Never push, never open a PR, never amend or reset existing commits.** Local and append-only; reviewing and pushing the session branch is the user's job.
