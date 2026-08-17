---
description: Pull one feature from the roadmap and implement it cleanly in auto mode against the current code, then commit on a feature branch and close it. Pass "nocommit" to skip committing, or "raw" for an ungated spike (no gates, no red-first, no review).
argument-hint: <feature ID, or "next"> [nocommit] [raw]
---

You are in the **PULL** phase of ristretto. You implement exactly one feature, directly, in auto mode — there is no approval gate. Closing the feature is **your** job at the end, never the user's.

Target: $ARGUMENTS  (a feature ID, or `next` = the top `planned` row in the roadmap; add `nocommit` to skip the commit at the end)

## `raw` — the ungated lane

`raw` executes the plan and nothing else: no gates armed, no planner subagent, no red-first tests, no review. It exists for spikes, prototypes, and throwaway branches where the ceremony costs more than it returns — **not** for code you intend to keep.

When `raw` is passed: skip step 3 (no marker, so the hooks stay disarmed — the format hook still runs), do step 5 inline in this context instead of dispatching a planner, skip step 7, and skip step 10 entirely. Everything else holds: the Contract is still the contract, you still verify the criteria yourself in step 9, and you still close properly in step 11.

**Raw work is labelled as raw, always.** The `## Evidence` section records `gates: skipped (raw)` and `review: skipped (raw)`, and the roadmap row is appended with `raw`. Ungated code that looks gated on the roadmap is worse than no fast lane at all — you must be able to tell, months later, which commits nothing ever checked. Say so in the final summary too.

Everything below assumes a normal pull unless it says otherwise.

## 1. Read the roadmap first — trust it

Read `docs/ristretto/roadmap.md` before anything else. The roadmap is the source of truth; take it at its word. Don't scan the codebase to second-guess its status — keeping it honest is the developer's call.

- If the target is already **`done`** → **stop.** Tell the user it's already implemented (cite the Updated date / any recorded commit). Do not re-implement.
- Otherwise, proceed. The roadmap mostly stays honest on its own, because `pull` closes features automatically (step 11).

- If the target is **`blocked`**, surface the recorded reason and ask whether to proceed anyway — the block may have been resolved outside the roadmap.
- If the target is **`needs-human`**, its code is already built and committed; what's outstanding is a manual step. Read its section in `docs/ristretto/manual-checks.md`. If every `proves` check there is ticked `- [x]`, this run is a **check re-run**: skip to step 9, prove the criteria that were pending, and close it `done` (step 11). If checks are still unticked, print them and stop — nothing to build.

**Resolving `next`:** pick the top `planned` row *whose plan's `Depends:` are all satisfied* — skip any feature still waiting on an unfinished prerequisite. A `Depends:` is satisfied by `done` **or** `needs-human`: a pending manual check means an environment step is outstanding, not that the prerequisite's code and `Provides:` are missing, so it must never hold up the features behind it. Only `blocked` does that. If every `planned` feature is blocked, stop and say so, naming what each is waiting on. When a **specific feature ID** was named (not `next`) and its `Depends:` aren't satisfied, don't silently skip — warn that a prerequisite is unfinished and ask whether to proceed anyway.

## 2. Read the plan

Open `docs/ristretto/plans/<FEATURE-ID>.md`. **`## Contract` is binding** — acceptance criteria, `Provides:`/`Consumes:`, decisions, units. `## Approach` is guidance, not gospel; it was written before the code moved.

## 3. Arm the gates

The plugin ships deterministic gate hooks: while a pull is active, a Stop hook runs the repo's lint + typecheck + test and blocks you (exit 2) until they're green — enforced, not self-reported. (Skip this whole step under `raw`.)

1. **If `.ristretto.json` is missing at the repo root, create it now.** **Read the repo's `CLAUDE.md` / `AGENTS.md` first** — a repo that documents its own commands has already answered this, and what's written there wins over anything you infer (`pnpm test:ci`, not `pnpm test`). Otherwise detect the stack (`angular.json` → Angular, `next.config.*` → Next.js, `pubspec.yaml` → Flutter; else read `package.json` scripts) and write the resolved commands — adopt whatever format/lint/typecheck/test tooling the repo already uses (read its existing config), never impose new tools. Leave a gate as `""` only if the repo genuinely has no such tool; empty gates are skipped.

   ```json
   {
     "gates": {
       "format": "npx prettier --write {file}",
       "formatPaths": ["src/**/*.{ts,tsx,js,jsx,css}"],
       "lint": "npx eslint .",
       "typecheck": "npx tsc --noEmit",
       "test": "npx vitest run",
       "testChanged": "npx vitest related --run {files}"
     }
   }
   ```

   `{file}` is replaced with the touched file (format only). `.ristretto.json` belongs in git; also add `.ristretto/` (transient state) to `.gitignore` if it isn't there.

   **Always set `formatPaths` — scope the formatter to the paths it actually owns.** Unscoped, the format hook rewrites every file anyone edits, including documentation and generated files it was never run over. A two-line edit to a README comes back as a hundred-line reflow, and because each attempted fix re-triggers it, the churn can eat entire review rounds before anyone works out that the *gate* is what keeps changing the file. List the code directories and extensions your formatter is canonical for; everything else is left alone. Add it to an existing `.ristretto.json` that lacks it — this is a config migration, not a preference.

   **Every command must be self-contained.** The hooks run in their own environment and **do not inherit a PATH you exported in your shell**. If a repo needs a specific toolchain — a second SDK install, a version manager shim, a workaround build — put that path in the command itself (`C:\flutter\bin\flutter test`, `./node_modules/.bin/vitest run`). A gate that only works because of a PATH tweak you made by hand will pass your pre-flight and fail in the hook, on a tree you never touched, and the red will look like a repo problem. `verify` records which binary it resolved and the hook says so out loud when it resolves a different one — but the fix is to not let them differ.

   For the same reason: **never run the gates by hand to check them.** Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify`, plainly, with no environment of your own. That's the only run that reproduces what the hook does.

   **Set `testChanged` when the full suite takes more than a minute** — it is what keeps the loop fast on a real repo. It runs only the tests affected by what this feature touched; the full suite is proven once at the end, by `verify`. `{files}` is replaced with every modified *and untracked* path:

   | runner | `testChanged` |
   |---|---|
   | vitest | `npx vitest related --run {files}` |
   | jest | `npx jest --findRelatedTests {files} --passWithNoTests` |
   | pytest | `python -m pytest {files}` |
   | flutter | `flutter test {files}` |
   | go | *(usually fast enough — leave empty and let `test` run)* |

   **Prefer the `{files}` forms over a runner's own change detection.** `vitest --changed`, `jest -o` and friends read git's diff, which does not include untracked files — and a brand-new test file is exactly what red-first produces, so the tests that prove this feature would be the ones skipped. Leave `testChanged` as `""` when the suite is already quick; the loop then runs the full gate as it always did.

   Three optional keys tune the runner, all in seconds:
   - **`silence`** — how long a gate may print *nothing* before it's killed as hung. Defaults: `lint` 600, `typecheck` 600, `test`/`testChanged` 300. Raise it for a tool that's quiet by nature.
   - **`timeouts`** — a hard cap on total runtime. **Off by default, and usually should stay off**: a slow gate is not a broken gate, and a cap kills a working suite at an arbitrary number.
   - **`lockWait`** — how long a gate run waits for the repo-wide gate lock before giving up (default 900). Only one gate run executes at a time: two suites sharing a database, a port, or a fixture produce failures that belong to neither, and a red you can't trust is worse than no red at all. A run that waits this out reports *unverified* and never blocks. Raise it on a repo whose suite legitimately runs longer than 15 minutes.

   A gate judged hung is **surfaced immediately, never retried** — retrying a hang just hangs again — and the work is reported *unverified*, which is neither green nor red.

2. **Create the marker file `.ristretto/pulling`** (empty), and `.ristretto/build/` if it doesn't exist. The marker arms the Stop gate for the duration of the pull. The gates are infrastructure, not suggestions: never weaken, skip, or delete gates or tests to get green — a red gate means the work is not done.

## 4. Check the working tree

Before spending a planner run, confirm there's somewhere safe to work:

- If the working tree is **dirty** or it's unclear what to branch from, **stop and ask** — never work over uncommitted work.
- If it's clean, or you're already on a branch for this feature, continue. The branch itself is created in step 6, once there's a plan worth putting on it.

## 5. Expand the plan against the current code

The plan holds the destination. This step writes the directions — **now**, against HEAD, so they cannot be stale.

Dispatch one **planner** subagent (fresh context, capable model) with this brief verbatim. Under `raw`, do this yourself in this context instead — no subagent, no `.ristretto/build/` file.

> You are the PLANNER for ristretto feature **<FEATURE-ID>**. You write no implementation code and modify no source file.
>
> 1. Read `docs/ristretto/plans/<FEATURE-ID>.md`. `## Contract` is binding; `## Approach` is guidance that may be stale.
> 2. For every ID in `Depends:`, read that feature's archived plan and take its `Provides:` as fact — those signatures exist, use them verbatim.
> 3. Read the current code in the touchpoint areas. Find the existing utilities, patterns, and test conventions this repo already uses. What you find beats what the Approach says.
> 4. Read the repo's house rules — `CLAUDE.md` / `AGENTS.md`, including any nested one near the files this will touch. They bind the plan even where the surrounding code doesn't demonstrate them yet; inferring conventions from code alone misses everything the repo decided but hasn't applied.
> 5. Write `.ristretto/build/<FEATURE-ID>.md`: for each unit in `Contract.Units` (or the whole feature if `Units` is `—`) — exact file paths to create or modify, the real function/type names and signatures each unit produces and consumes, and the test cases that prove each acceptance criterion, as actual test code in this repo's test style.
> 6. **No placeholders.** No "TBD", no "add error handling", no "similar to the above", no reference to a type or function no unit defines. Any of these means the plan is not finished.
> 7. **Manual checks.** Some proofs a coding agent cannot produce: SQL against a live database, applying a migration to an environment, setting a secret, enabling something in a third-party console — and equally, anything that has to be *looked at* (does the dropdown open, does the mobile layout hold, does the copy read right). Take `Contract.Manual-Checks` as the starting list and **add any you find against the current code** — the column the Contract needs that the schema doesn't have, the env var nothing sets, the screen no test can judge. For each, record in the build plan: `proves` or `deploy`, **which acceptance criterion it proves**, where a human does it, and **the exact command, SQL, or thing to look at**, written against the code as you are planning it.
>
>    A manual check is **not** a blocker. The code is still fully planned and built — plan the tests that need the live environment as skipped-pending tests (this repo's idiom: `test.skip`, `@pytest.mark.skip`, `@Ignore`) each naming the check that unblocks it, so they exist and run the moment it lands.
> 8. If the Contract cannot be satisfied against the current code — a criterion contradicts what's there, a `Consumes:` signature doesn't exist, a decision was never made — do **not** guess. Write nothing and return `blocked`. A missing manual check is never a reason to return `blocked`; a missing *decision* is.
>
> Final message, exactly one of:
> `planned: <FEATURE-ID> — <n> units, <n> tests, <n> manual checks`
> `blocked: <FEATURE-ID> — <the spec gap, phrased as what the plan failed to decide>`
> Nothing else.

On `blocked:`, stop the pull and set the roadmap row to `blocked` with that reason (disarm the gates first — step 11.4). No branch was created, so there is nothing to clean up. On `planned:`, continue — steps 7 and 8 work from `.ristretto/build/<FEATURE-ID>.md`, not from the plan's `## Approach`.

**If the build plan carries manual checks, write them to `docs/ristretto/manual-checks.md` now** (create the file with the header below if missing), appending or replacing this feature's `##` section. Manual checks are the one place ristretto writes literal commands — they are for a human to run, not for the repo:

```markdown
# Manual Checks

Steps ristretto can't run itself. Do one, tick its box, then re-run
`/ristretto:pull <ID>` (or `/ristretto:brew`) to verify what was waiting on it.
A `proves` check blocks only its own feature's remaining criteria — never other features.

## BREW-224 — user tiers
- [ ] **proves** · criterion 2 · Supabase SQL editor (dev) · add the column the code reads
      ```sql
      alter table profiles add column tier text not null default 'free';
      ```
      _criterion:_ "a free user sees the upgrade banner" · _test:_ `tier banner renders` (skipped)
- [ ] **proves** · criterion 4 · your browser, 375px wide · the upgrade banner must not
      overlap the nav on a narrow screen — look at it and tick if it holds
- [ ] **deploy** · — · Supabase SQL editor (prod) · backfill existing rows
      ```sql
      update profiles set tier = 'pro' where id in (select user_id from subscriptions where active);
      ```
```

Keep the shape exactly — `- [ ] **proves|deploy** · criterion · where · what` — it's what later runs read to tell a done check from a pending one. A `proves` line always names the criterion it proves; a `deploy` line has no criterion, so it gets `—`. **A check with nothing to run is still a check**: "look at this and confirm" is exactly as valid as an `alter table`, and it is the kind the loop used to have no home for. Never tick a box yourself; that is the user's signature that the step really happened.

## 6. Branch

There's a build plan, so there's work to hold:

- If you're not already on a branch for this feature, create and switch to `feature/<FEATURE-ID>`.
- If you're already on a suitable branch, reuse it.

Never push, never set an upstream.

## 7. Write the contract as tests — red first

If the repo has a test gate, the build plan's test cases become tests **before any implementation** — they are already transcriptions of the acceptance criteria; do not re-derive them.

- **Transcribe, don't invent**: every assertion restates an acceptance criterion. If the AI decides what "correct" means, the loop is broken.
- **Run them and confirm they fail.** The red run is the proof that the tests actually test something. A test that passes before implementation proves nothing — rewrite it; if the criterion is genuinely already met by the current code, say so and investigate before continuing.
- Criteria that aren't test-checkable (measurements, binary observations) are exempt — they're proven in step 9. No test gate in `.ristretto.json` → skip this step entirely.
- **Criteria waiting on a `proves` manual check** are exempt from red-first too: their tests are written but skipped, each naming the check that unblocks it. They can't go red honestly — the environment they need doesn't exist yet — and a skipped test that names its reason is the honest form of that.

## 8. Implement the build plan

`.ristretto/build/<FEATURE-ID>.md` was written against the current code minutes ago; the `## Contract` behind it is the acceptance contract. Implement the plan; do not re-plan.

- Follow the build plan's file paths, names, and signatures. Reuse the existing patterns and utilities it identified.
- You're done implementing when the red tests from step 7 pass and every acceptance criterion in the Contract holds.

**Efficiency (the whole point of ristretto) — write it lean the first time:**
- **Reuse before writing**: before adding code, check the repo for an existing utility or pattern that already does the job. Reusing is the cheapest way to avoid duplication — `tamp` catching it later costs more than not writing it.
- **No waste in the code you write**: no N+1 or recomputation that could be hoisted, no copy-pasted logic, no scaffolding or abstraction nothing needs yet (YAGNI).
- **No waste in how you work**: don't re-read files already in context, don't restate the plan, targeted edits over rewrites — the smallest diff that meets the acceptance criteria.

## 9. Verify & record evidence

Check the result against each acceptance criterion. **Run the full suite once, now:**

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify
```

`verify` runs lint + typecheck + the *whole* test gate, ignoring both the scoped-test shortcut the loop uses and the green-tree cache. This is the run that proves nothing elsewhere in the repo broke; the scoped runs during implementation only ever proved the feature's own files. Fix until it's green — it exits 0 green, 1 red, and prints a `gates: lint ✓ typecheck ✓ test ✓` summary you'll reuse in the Evidence. Under `raw`, skip this and say so.

If a gate was killed as **hung** (it stopped printing) rather than failing, the work is unverified, not proven broken: don't commit on the strength of a hang. Find what it's waiting on — an open handle, a port, watch mode, a prompt — or raise that gate's `silence` budget if the tool is simply quiet for long stretches. Then verify again.

Then write down the **Evidence**: for each criterion, *how* it was proven — test names, command output, measurements — including **red→green**: which tests failed before implementation and pass now. "Implemented successfully" is not evidence. A criterion waiting on a `proves` manual check is recorded as `pending human: <the check>` with its skipped test named — never as proven.

## 10. Review gate — independent, before any commit

Gates prove the tests pass; they can't prove the code is right or lean. Before committing, the diff gets an **independent review** by a fresh subagent that never saw your implementation reasoning.

**Skip only when the diff is trivial**: roughly < 15 changed lines *and* no new logic (no new functions, branches, or loops — renames, copy, config tweaks). When in doubt, review. Under `raw`, skip this step entirely — that's what `raw` buys, and what the `review: skipped (raw)` label on the record costs.

Dispatch one subagent (general-purpose, fresh context) with this brief verbatim, filling in the ID and the diff scope:

> You are the independent REVIEW gate for ristretto feature **<FEATURE-ID>**. You did not write this code — judge it cold. Read `docs/ristretto/plans/<FEATURE-ID>.md` (`## Contract` is the contract), the repo's `CLAUDE.md` / `AGENTS.md` if present (the house rules — treat them as binding on the changed files), and the feature's diff: <files touched / branch vs merge-base>. You change no files. Do not run the gates: another run may hold the lock, and yours would either wait or measure a tree someone else is measuring.
>
> Two lenses, priority order:
> 1. **`bug`** — a criterion not actually satisfied, a documented house rule the diff violates, unhandled edge cases on the changed paths, logic errors the gates can't catch, tests that don't honestly restate a criterion.
> 2. **`lean`** — tamp's facets: runtime waste (N+1, hoistable work), duplication vs utilities that already exist in this repo, dead/over-built code, readability drag.
>
> Report at most **7 findings**, bugs first, each one line: `bug|lean · file:line · what's wrong · the fix`. Flag only what you can point at — no hypotheticals, no style nits. If nothing material, your final message is exactly `review: clean`. Otherwise: `review: N findings` followed by the findings. Nothing else.

Then act on the verdict — **capped at 2 rounds, never a ping-pong**:

- **`review: clean`** → proceed to close.
- **Findings** → fix **every `bug`** (mandatory); fix `lean` findings unless the fix is riskier than the win (state what you left in the summary). Re-run the gates.
- **Round 2** (only if round 1 found bugs): dispatch a fresh reviewer to *verify the prior findings and any defect introduced by the fixes* — not to open new lean fronts.
- **Bugs still open after round 2** → hard stop, mirroring the gate-retry rule: do **not** commit. Surface the findings to the user, leave the branch as it is, and disarm the gates (step 11.4).

## 11. Close — mandatory, automatic

Once criteria are met:

1. **Commit** (unless `nocommit` was passed): stage only the files you touched — never `git add -A` — and commit with a conventional message: `feat(<FEATURE-ID>): <short summary>`. Record the commit hash. If `nocommit` was passed, leave the changes uncommitted in the working tree and say so; the user will commit themselves.
   - **Never** push, set an upstream, `--force`, amend or reset existing commits, or open a PR. Local and append-only.
2. **Correct `Provides:` to whatever was actually built**, then append an `## Evidence` section to the plan (the proof from step 9, a one-line gate summary like `gates: lint ✓ typecheck ✓ test ✓`, and the review verdict — `review: clean`, `review: N findings resolved`, `review: skipped (trivial diff)`, or `review: skipped (raw)`), then move `docs/ristretto/plans/<FEATURE-ID>.md` → `docs/ristretto/plans/archived/<FEATURE-ID>.md`. A `Provides:` that drifted during implementation and was never corrected poisons every dependent feature — the archived plan is what the next feature's planner reads as fact.
3. Update the roadmap row: set Updated to today, append the files touched and the commit hash (or `uncommitted` if `nocommit`, plus `raw` if this was a raw pull), and set the status:
   - **`done`** — every acceptance criterion is proven.
   - **`needs-human`** — the code is built, committed, and gated, but at least one criterion is `pending human check`. The row's reason names the outstanding check and points at `manual-checks.md`. This is a *closing* status: the feature is finished as far as ristretto can take it, the plan is archived exactly as for `done`, and **it never holds up a dependent feature** — its `Provides:` exist in the code. Once you've run the check and ticked the box, `/ristretto:pull <ID>` re-checks the pending criteria and flips the row to `done`.
   - Features with only `deploy` checks close as **`done`** — the check is a deploy step, not an unproven criterion. It stays on the checks list; that's what the list is for.
4. **Disarm the gates:** delete `.ristretto/pulling` (and `.ristretto/gate-retries` if present). Do this even when a pull is aborted midway — a stale marker keeps gating sessions that aren't pulls.
5. **Delete `.ristretto/build/<FEATURE-ID>.md`.** It was derived from (plan + HEAD) and is reproducible; keeping it would commit rot. Delete it on an aborted pull too.

The file's location is the status. Archiving **is** closing — so it always happens here, and the user never has to remember.

## When done

Print a short summary: what changed, which criteria are satisfied, the review verdict (including any `lean` findings deliberately left), the branch and commit (or that it's left uncommitted), and confirm the plan was archived and the roadmap updated. If this was `raw`, say plainly that nothing gated or reviewed it. If manual checks are outstanding, list them and point at `docs/ristretto/manual-checks.md`:

```
🔧 1 manual check waiting — docs/ristretto/manual-checks.md
   proves · criterion 2 · Supabase SQL editor (dev) · add profiles.tier
```

End with a little cup:

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
