---
description: Prep and pull one small feature in a single pass — plan it, implement it in auto mode, commit it on a feature branch, and close it. For trivial features where the prep/pull split is overkill. Pass "nocommit" to skip committing.
argument-hint: <one feature: ID + description, or pasted text> [nocommit]
---

You are running **SHOT** — prep and pull one small feature in a single pass. Auto mode, no gate. Use this only for trivial features; for anything with real scope, use `/ristretto:prep` then `/ristretto:pull`.

Feature: $ARGUMENTS  (add `nocommit` to skip the commit at the end)

Ensure `docs/ristretto/` exists (`roadmap.md`, `plans/`, `plans/archived/`) — create if missing.

1. **Plan, briefly — same standard as `prep`, no bypass lane.** Write `docs/ristretto/plans/<FEATURE-ID>.md` in the lean intent format: goal, **1–3 acceptance criteria that are checkable** by a test, a measurement, or a binary observation, short approach, likely touchpoints. **No code in the plan.** If you can't state checkable criteria on the spot, this isn't a shot — stop and route it to `/ristretto:prep` (nothing is lost; shot hasn't touched code yet). Add a `planned` row to the roadmap — a single shot is standalone, so its `Flight` is `—` and it has no `Depends:`.
2. **Arm the gates.** As in `pull`: if `.ristretto.json` is missing at the repo root, create it (detect the stack, adopt the repo's existing format/lint/typecheck/test tooling — never impose new tools; add `.ristretto/` to `.gitignore`). Then create the marker file `.ristretto/pulling` — while it exists, the plugin's Stop hook runs lint + typecheck + test and blocks until green. Never weaken, skip, or delete gates or tests to get green.
3. **Branch.** If the working tree is clean and you're not already on a branch for this feature, create and switch to `feature/<FEATURE-ID>`. If you're already on a suitable branch, reuse it. If the tree is dirty or it's unclear what to branch from, **stop and ask** — never branch over uncommitted work. Never push.
4. **Tests first, red first.** If the repo has a test gate: transcribe the acceptance criteria into tests before implementing — every assertion restates a criterion, never invented — and run them to confirm they fail. A test that passes before implementation proves nothing. Non-test-checkable criteria (measurements, binary observations) are proven in step 7 instead; no test gate → skip.
5. **Implement now** against the current code, lean the first time: reuse an existing utility or pattern before writing new code; no duplication, no N+1 or hoistable recomputation, no scaffolding nothing needs yet (YAGNI); smallest diff that meets the acceptance criteria. Done when the red tests pass. Don't re-read files already in context. (No drift to worry about — you're implementing immediately.)
6. **If it turns out bigger than "small,"** stop and tell the user this looks like a `prep` / `pull` job — what you've planned (and branched) so far is already saved. Delete `.ristretto/pulling` before stopping.
7. **Verify & record evidence:** check each acceptance criterion; note *how* each was proven (red→green test names, output, measurements) — "implemented successfully" is not evidence.
8. **Review gate — before any commit.** Skip only if the diff is trivial (roughly < 15 changed lines and no new functions/branches/loops; when in doubt, review — many shots will qualify for the skip, that's fine). Otherwise dispatch one fresh subagent with `pull`'s review brief verbatim: read the plan and the diff, change no files; lenses in priority order `bug` (criterion not actually satisfied, unhandled edge cases, logic errors gates can't catch, dishonest tests) then `lean` (runtime waste, duplication vs existing utilities, dead/over-built, readability); at most 7 one-line findings (`bug|lean · file:line · what · fix`), or exactly `review: clean`. Fix every `bug` (mandatory) and quick `lean`s, re-run gates; one confirming round max (2 total). Bugs still open after round 2 → do **not** commit; surface the findings, disarm the gates, stop.
9. **Close (mandatory):**
   - **Commit** (unless `nocommit` was passed): stage only the files you touched — never `git add -A` — and commit with `feat(<FEATURE-ID>): <short summary>`. Record the hash. If `nocommit`, leave the changes uncommitted and say so. Never push, `--force`, amend, reset, or open a PR.
   - Append an `## Evidence` section to the plan (the proof from step 7, a gate summary, and the review verdict — `review: clean`, `review: N findings resolved`, or `review: skipped (trivial diff)`), then move it to `plans/archived/` and flip the roadmap row to `done` with today's date, the files touched, and the commit hash (or `uncommitted`).
   - **Disarm the gates:** delete `.ristretto/pulling` (and `.ristretto/gate-retries` if present).

Finish with a short summary: what changed, criteria met, branch and commit (or left uncommitted), plan archived, roadmap updated. End with a little cup:

```
  ( (
   ) )
  c[__]  ☕ shot pulled
```

If closing this feature left **zero** open features on the roadmap, celebrate instead with the full milestone cup:

```
   ) )  ( (
.__________.
|          |]
|          |
`----------'
ALL BREWED — roadmap clear ☕
```
