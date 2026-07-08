---
description: Pull one feature from the roadmap and implement it cleanly in auto mode against the current code, then commit on a feature branch and close it. Pass "nocommit" to skip committing.
argument-hint: <feature ID, or "next"> [nocommit]
---

You are in the **PULL** phase of ristretto. You implement exactly one feature, directly, in auto mode — there is no approval gate. Closing the feature is **your** job at the end, never the user's.

Target: $ARGUMENTS  (a feature ID, or `next` = the top `planned` row in the roadmap; add `nocommit` to skip the commit at the end)

## 1. Read the roadmap first — trust it

Read `docs/ristretto/roadmap.md` before anything else. The roadmap is the source of truth; take it at its word. Don't scan the codebase to second-guess its status — keeping it honest is the developer's call.

- If the target is already **`done`** → **stop.** Tell the user it's already implemented (cite the Updated date / any recorded commit). Do not re-implement.
- Otherwise, proceed. The roadmap mostly stays honest on its own, because `pull` closes features automatically (step 6).

- If the target is **`blocked`**, surface the recorded reason and ask whether to proceed anyway — the block may have been resolved outside the roadmap.

**Resolving `next`:** pick the top `planned` row *whose plan's `Depends:` are all `done`* — skip any feature still waiting on an unfinished prerequisite. If every `planned` feature is blocked, stop and say so, naming what each is waiting on. When a **specific feature ID** was named (not `next`) and its `Depends:` aren't all done, don't silently skip — warn that a prerequisite is unfinished and ask whether to proceed anyway.

## 2. Read the plan

Open `docs/ristretto/plans/<FEATURE-ID>.md`. The **acceptance criteria are the contract**; the approach is guidance, not gospel.

## 3. Arm the gates

The plugin ships deterministic gate hooks: while a pull is active, a Stop hook runs the repo's lint + typecheck + test and blocks you (exit 2) until they're green — enforced, not self-reported.

1. **If `.ristretto.json` is missing at the repo root, create it now.** Detect the stack (`angular.json` → Angular, `next.config.*` → Next.js, `pubspec.yaml` → Flutter; otherwise read `package.json` scripts) and write the resolved commands — adopt whatever format/lint/typecheck/test tooling the repo already uses (read its existing config), never impose new tools. Leave a gate as `""` only if the repo genuinely has no such tool; empty gates are skipped.

   ```json
   {
     "gates": {
       "format": "npx prettier --write {file}",
       "lint": "npx eslint .",
       "typecheck": "npx tsc --noEmit",
       "test": "npx vitest run"
     }
   }
   ```

   `{file}` is replaced with the touched file (format only; the other gates run repo-wide). `.ristretto.json` belongs in git; also add `.ristretto/` (transient state) to `.gitignore` if it isn't there.

2. **Create the marker file `.ristretto/pulling`** (empty). This arms the Stop gate for the duration of the pull. The gates are infrastructure, not suggestions: never weaken, skip, or delete gates or tests to get green — a red gate means the work is not done.

## 4. Branch

Work on a feature branch for the feature:

- If the working tree is **clean** and you're not already on a branch for this feature, create and switch to `feature/<FEATURE-ID>`.
- If you're already on a suitable branch, reuse it.
- If the working tree is **dirty** or it's unclear what to branch from, **stop and ask** — never branch over uncommitted work.

Never push, never set an upstream.

## 5. Implement against the *current* code

The plan deliberately contains no code, and the repo has likely shifted since prep. So:

- Read the current code in the touchpoint areas fresh. Reuse existing patterns and utilities.
- Implement to satisfy the acceptance criteria, following the approach where it still fits.

**Efficiency (the whole point of ristretto) — write it lean the first time:**
- **Reuse before writing**: before adding code, check the repo for an existing utility or pattern that already does the job. Reusing is the cheapest way to avoid duplication — `tamp` catching it later costs more than not writing it.
- **No waste in the code you write**: no N+1 or recomputation that could be hoisted, no copy-pasted logic, no scaffolding or abstraction nothing needs yet (YAGNI).
- **No waste in how you work**: don't re-read files already in context, don't restate the plan, targeted edits over rewrites — the smallest diff that meets the acceptance criteria.

## 6. Verify & record evidence

Check the result against each acceptance criterion. If the project has a test gate, cover the criteria with tests — **transcribe, don't invent**: every assertion must restate an acceptance criterion. If the AI decides what "correct" means, the loop is broken. Run the gates yourself; fix until green.

Then write down the **Evidence**: for each criterion, *how* it was proven — test names, command output, measurements. "Implemented successfully" is not evidence.

## 7. Close — mandatory, automatic

Once criteria are met:

1. **Commit** (unless `nocommit` was passed): stage only the files you touched — never `git add -A` — and commit with a conventional message: `feat(<FEATURE-ID>): <short summary>`. Record the commit hash. If `nocommit` was passed, leave the changes uncommitted in the working tree and say so; the user will commit themselves.
   - **Never** push, set an upstream, `--force`, amend or reset existing commits, or open a PR. Local and append-only.
2. Append an `## Evidence` section to the plan (the proof from step 6, plus a one-line gate summary like `gates: lint ✓ typecheck ✓ test ✓`), then move `docs/ristretto/plans/<FEATURE-ID>.md` → `docs/ristretto/plans/archived/<FEATURE-ID>.md`.
3. Update the roadmap row: status → `done`, set Updated to today, append the files touched and the commit hash (or `uncommitted` if `nocommit`).
4. **Disarm the gates:** delete `.ristretto/pulling` (and `.ristretto/gate-retries` if present). Do this even when a pull is aborted midway — a stale marker keeps gating sessions that aren't pulls.

The file's location is the status. Archiving **is** closing — so it always happens here, and the user never has to remember.

## When done

Print a short summary: what changed, which criteria are satisfied, the branch and commit (or that it's left uncommitted), and confirm the plan was archived and the roadmap updated. If the diff was non-trivial, you may add a single optional line suggesting `/ristretto:tamp` for a lean-code pass — never more than one line, and skip it for tiny diffs. End with a little cup:

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
