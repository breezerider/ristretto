---
description: Pull one ticket from the roadmap and implement it cleanly in auto mode against the current code, then commit on a feature branch and close it. Pass "nocommit" to skip committing.
argument-hint: <ticket ID, or "next"> [nocommit]
---

You are in the **PULL** phase of ristretto. You implement exactly one ticket, directly, in auto mode — there is no approval gate. Closing the ticket is **your** job at the end, never the user's.

Target: $ARGUMENTS  (a ticket ID, or `next` = the top `planned` row in the roadmap; add `nocommit` to skip the commit at the end)

## 1. Read the roadmap first — trust it

Read `docs/ristretto/roadmap.md` before anything else. The roadmap is the source of truth; take it at its word. Don't scan the codebase to second-guess its status — keeping it honest is the developer's call.

- If the target is already **`done`** → **stop.** Tell the user it's already implemented (cite the Updated date / any recorded commit). Do not re-implement.
- Otherwise, proceed. The roadmap mostly stays honest on its own, because `pull` closes tickets automatically (step 6).

## 2. Read the plan

Open `docs/ristretto/plans/<TICKET-ID>.md`. The **acceptance criteria are the contract**; the approach is guidance, not gospel.

## 3. Branch

Work on a feature branch for the ticket:

- If the working tree is **clean** and you're not already on a branch for this ticket, create and switch to `feature/<TICKET-ID>`.
- If you're already on a suitable branch, reuse it.
- If the working tree is **dirty** or it's unclear what to branch from, **stop and ask** — never branch over uncommitted work.

Never push, never set an upstream.

## 4. Implement against the *current* code

The plan deliberately contains no code, and the repo has likely shifted since prep. So:

- Read the current code in the touchpoint areas fresh. Reuse existing patterns and utilities.
- Implement to satisfy the acceptance criteria, following the approach where it still fits.

**Efficiency (the whole point of ristretto) — write it lean the first time:**
- **Reuse before writing**: before adding code, check the repo for an existing utility or pattern that already does the job. Reusing is the cheapest way to avoid duplication — `tamp` catching it later costs more than not writing it.
- **No waste in the code you write**: no N+1 or recomputation that could be hoisted, no copy-pasted logic, no scaffolding or abstraction nothing needs yet (YAGNI).
- **No waste in how you work**: don't re-read files already in context, don't restate the plan, targeted edits over rewrites — the smallest diff that meets the acceptance criteria.

## 5. Verify

Check the result against each acceptance criterion. If the project has a build or tests, run them. Fix until the criteria are met.

## 6. Close — mandatory, automatic

Once criteria are met:

1. **Commit** (unless `nocommit` was passed): stage only the files you touched — never `git add -A` — and commit with a conventional message: `feat(<TICKET-ID>): <short summary>`. Record the commit hash. If `nocommit` was passed, leave the changes uncommitted in the working tree and say so; the user will commit themselves.
   - **Never** push, set an upstream, `--force`, amend or reset existing commits, or open a PR. Local and append-only.
2. Move `docs/ristretto/plans/<TICKET-ID>.md` → `docs/ristretto/plans/archived/<TICKET-ID>.md`.
3. Update the roadmap row: status → `done`, set Updated to today, append the files touched and the commit hash (or `uncommitted` if `nocommit`).

The file's location is the status. Archiving **is** closing — so it always happens here, and the user never has to remember.

## When done

Print a short summary: what changed, which criteria are satisfied, the branch and commit (or that it's left uncommitted), and confirm the plan was archived and the roadmap updated. If the diff was non-trivial, you may add a single optional line suggesting `/ristretto:tamp` for a lean-code pass — never more than one line, and skip it for tiny diffs. End with a little cup:

```
  ( (
   ) )
  c[__]  ☕ shot pulled
```

If closing this ticket left **zero** open tickets on the roadmap, celebrate instead with the full milestone cup:

```
   ) )  ( (
.__________.
|          |]
|          |
`----------'
ALL BREWED — roadmap clear ☕
```
