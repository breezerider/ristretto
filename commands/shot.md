---
description: Prep and pull one small feature in a single pass — plan it, implement it in auto mode, commit it on a feature branch, and close it. For trivial features where the prep/pull split is overkill. Pass "nocommit" to skip committing.
argument-hint: <one feature: ID + description, or pasted text> [nocommit]
---

You are running **SHOT** — prep and pull one small feature in a single pass. Auto mode, no gate. Use this only for trivial features; for anything with real scope, use `/ristretto:prep` then `/ristretto:pull`.

Feature: $ARGUMENTS  (add `nocommit` to skip the commit at the end)

Ensure `docs/ristretto/` exists (`roadmap.md`, `plans/`, `plans/archived/`) — create if missing.

1. **Plan, briefly — same standard as `prep`, no bypass lane.** Write `docs/ristretto/plans/<FEATURE-ID>.md` in prep's format: `## Spec` (goal), `## Contract` (**1–3 acceptance criteria that are checkable** by a test, a measurement, or a binary observation, plus `Provides:` — the public surface at type level — and any decisions), `## Approach` (short strategy, likely touchpoints). **No code in the plan.** If you can't state checkable criteria **or fill `Provides:`** on the spot, this isn't a shot — stop and route it to `/ristretto:prep` (nothing is lost; shot hasn't touched code yet). Add a `planned` row to the roadmap — a single shot is standalone, so its `Flight` is `—` and it has no `Depends:`.
2. **Arm the gates.** As in `pull` step 3: if `.ristretto.json` is missing at the repo root, create it (read `CLAUDE.md` / `AGENTS.md` first — commands documented there win over anything inferred, and set `formatPaths` so the formatter stays off files it doesn't own — otherwise detect the stack, adopt the repo's existing format/lint/typecheck/test tooling — never impose new tools; set `testChanged` if the suite is slow; add `.ristretto/` to `.gitignore`). Then create the marker file `.ristretto/pulling` — while it exists, the plugin's Stop hook runs lint + typecheck + the scoped test gate and blocks until green. Never weaken, skip, or delete gates or tests to get green.
3. **Branch.** If the working tree is clean and you're not already on a branch for this feature, create and switch to `feature/<FEATURE-ID>`. If you're already on a suitable branch, reuse it. If the tree is dirty or it's unclear what to branch from, **stop and ask** — never branch over uncommitted work. Never push.
4. **Expand the plan — inline, not as a subagent.** The whole point of `shot` is one pass, so you do this yourself in this context rather than dispatching a planner: read the current code in the touchpoint areas, find the existing utilities, patterns, and test conventions this repo already uses, and settle the exact file paths, the real names and signatures, and the test cases that prove each criterion — before writing anything. What you find beats what the Approach says. **No placeholders.** If the Contract can't be satisfied against the current code, don't guess — say what the plan failed to decide and stop. Nothing is written to `.ristretto/build/`; a shot's directions live only in this context and are used seconds later.

   **If a step needs a human** — SQL against a live database, a migration, a secret, a console switch — that is not a stop. Write it into `docs/ristretto/manual-checks.md` in the format `pull` step 5 defines (`proves`/`deploy`, which criterion, where, the exact command or thing to look at), write the test that needs it as skipped naming the check, and carry on building. Never tick a box there yourself.
5. **Tests first, red first.** If the repo has a test gate: the test cases from step 4 become tests before implementing — every assertion restates a criterion, never invented — and run them to confirm they fail. A test that passes before implementation proves nothing. Non-test-checkable criteria (measurements, binary observations) are proven in step 8 instead; no test gate → skip.
6. **Implement now** against the current code, lean the first time: read the repo's house rules (`CLAUDE.md` / `AGENTS.md`, including any nested one near the files you touch) — they bind you even where the surrounding code doesn't demonstrate them yet; reuse an existing utility or pattern before writing new code; no duplication, no N+1 or hoistable recomputation, no scaffolding nothing needs yet (YAGNI); smallest diff that meets the acceptance criteria. Done when the red tests pass. Don't re-read files already in context. (No drift to worry about — you're implementing immediately.)
7. **If it turns out bigger than "small,"** stop and tell the user this looks like a `prep` / `pull` job — what you've planned (and branched) so far is already saved. Delete `.ristretto/pulling` before stopping.
8. **Verify & record evidence:** run the full suite once — `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify` — which runs lint + typecheck + the whole test gate, ignoring the scoped shortcut and the green-tree cache. Fix until it exits 0. Then check each acceptance criterion and note *how* each was proven (red→green test names, output, measurements) — "implemented successfully" is not evidence. A gate killed as *hung* (it stopped printing) means unverified, not green: find what it's waiting on, or raise its `silence` budget, before going on.
9. **Review gate — before any commit.** Skip only if the diff is trivial (roughly < 15 changed lines and no new functions/branches/loops; when in doubt, review — many shots will qualify for the skip, that's fine). Otherwise dispatch one fresh subagent with `pull`'s review brief verbatim: read the plan, the repo's `CLAUDE.md` / `AGENTS.md` if present, and the diff, change no files and run no gates; lenses in priority order `bug` (criterion not actually satisfied, a documented house rule the diff violates, unhandled edge cases, logic errors gates can't catch, dishonest tests) then `lean` (runtime waste, duplication vs existing utilities, dead/over-built, readability); at most 7 one-line findings (`bug|lean · file:line · what · fix`), or exactly `review: clean`. Fix every `bug` (mandatory) and quick `lean`s, re-run gates; one confirming round max (2 total). Bugs still open after round 2 → do **not** commit; surface the findings, disarm the gates, stop.
10. **Close (mandatory):**
   - **Commit** (unless `nocommit` was passed): stage only the files you touched — never `git add -A` — and commit with `feat(<FEATURE-ID>): <short summary>`. Record the hash. If `nocommit`, leave the changes uncommitted and say so. Never push, `--force`, amend, reset, or open a PR. Keep the subject plain ASCII — no backticks, `@`, `$`, `!`, or quotes — or write it to a file and use `git commit -F <path>`; a shell re-interprets those characters, and the mangled result must never be repaired with `--amend`.
   - Correct `Provides:` to whatever was actually built, then append an `## Evidence` section to the plan (the proof from step 8, a gate summary, and the review verdict — `review: clean`, `review: N findings resolved`, or `review: skipped (trivial diff)`), then move it to `plans/archived/` and flip the roadmap row to `done` with today's date, the files touched, and the commit hash (or `uncommitted`). If a criterion is waiting on a `proves` manual check, record it as `pending human: <the check>` and set the row to **`needs-human`** instead — same commit, same archive, and it still satisfies any `Depends:` on it.
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
