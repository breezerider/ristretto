---
description: Prep and pull one small feature in a single pass — plan it, implement it in auto mode, commit it on a feature branch, and close it. For trivial features where the prep/pull split is overkill. Pass "nocommit" to skip committing.
argument-hint: <one feature: ID + description, or pasted text> [nocommit]
---

You are running **SHOT** — prep and pull one small feature in a single pass. Auto mode, no gate. Use this only for trivial features; for anything with real scope, use `/ristretto:prep` then `/ristretto:pull`.

Feature: $ARGUMENTS  (add `nocommit` to skip the commit at the end)

Ensure `docs/ristretto/` exists (`roadmap.md`, `plans/`, `plans/archived/`) — create if missing.

1. **Plan, briefly.** Write `docs/ristretto/plans/<FEATURE-ID>.md` in the lean intent format: goal, acceptance criteria, short approach, likely touchpoints. **No code in the plan.** Add a `planned` row to the roadmap — a single shot is standalone, so its `Flight` is `—` and it has no `Depends:`.
2. **Arm the gates.** As in `pull`: if `.ristretto.json` is missing at the repo root, create it (detect the stack, adopt the repo's existing format/lint/typecheck/test tooling — never impose new tools; add `.ristretto/` to `.gitignore`). Then create the marker file `.ristretto/pulling` — while it exists, the plugin's Stop hook runs lint + typecheck + test and blocks until green. Never weaken, skip, or delete gates or tests to get green.
3. **Branch.** If the working tree is clean and you're not already on a branch for this feature, create and switch to `feature/<FEATURE-ID>`. If you're already on a suitable branch, reuse it. If the tree is dirty or it's unclear what to branch from, **stop and ask** — never branch over uncommitted work. Never push.
4. **Implement now** against the current code, lean the first time: reuse an existing utility or pattern before writing new code; no duplication, no N+1 or hoistable recomputation, no scaffolding nothing needs yet (YAGNI); smallest diff that meets the acceptance criteria. Don't re-read files already in context. (No drift to worry about — you're implementing immediately.)
5. **If it turns out bigger than "small,"** stop and tell the user this looks like a `prep` / `pull` job — what you've planned (and branched) so far is already saved. Delete `.ristretto/pulling` before stopping.
6. **Verify & record evidence:** check each acceptance criterion; if the project has a test gate, cover the criteria with tests — every assertion restates a criterion, never invented. Note *how* each criterion was proven (test names, output, measurements) — "implemented successfully" is not evidence.
7. **Close (mandatory):**
   - **Commit** (unless `nocommit` was passed): stage only the files you touched — never `git add -A` — and commit with `feat(<FEATURE-ID>): <short summary>`. Record the hash. If `nocommit`, leave the changes uncommitted and say so. Never push, `--force`, amend, reset, or open a PR.
   - Append an `## Evidence` section to the plan, then move it to `plans/archived/` and flip the roadmap row to `done` with today's date, the files touched, and the commit hash (or `uncommitted`).
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
