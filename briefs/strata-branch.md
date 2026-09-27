# Mode: branch (non-destructive)

Follow this only after the user chose `branch` (see `commands/strata.md`). This mode **does not touch the source branch** — it builds a fresh PR branch.

## Goal state

A new branch built off the range base that contains the range's non-docs commits (each kept as itself) plus ONE `docs(ristretto): <summary>` commit at its tip carrying the final `docs/ristretto/` tree. The source branch and its history are untouched — no pushed history diverges.

## PR branch name

Suggest a name and confirm with the user before creating:

- If a ticket id is known (from the current branch name like `feature/ABC-123-...`, from a `feat(ABC-123)` commit subject in the range, or the user supplies one), use `<TICKET>-pr` e.g. `ABC-123-pr`.
- Otherwise fall back to `<current-branch>-pr`, or `<current-branch>-ristretto-clean` if the feature has no ticket.
- The helper script prints this suggestion; it never names the branch itself.

## How — reconstruct onto a fresh branch

1. **Create it off the range base**:
   `git checkout -b <PR_BRANCH> <base>`
2. **Replay each non-docs commit in order.** For every commit in the range that is NOT a docs-only commit, bring its non-docs changes over with a docs-free message:
   - **Mixed commits — two cases depending on whether the PARENT commit has `docs/ristretto/`:**
     - **If the parent HAS `docs/ristretto/`** (the existing path): `git cherry-pick <hash> --no-commit`, then `git restore --source=HEAD --staged --worktree docs/ristretto/` to drop the docs portion, then `git commit` with a message stripped of the docs note. The docs files already exist on the branch from the parent, so restoring from HEAD reverts them to the pre-commit state.
     - **Else (parent does NOT have `docs/ristretto/`)** — the bootstrap case: the mixed commit's docs portion is all-new in this commit. `git cherry-pick <hash> --no-commit`, then `git rm --cached -r docs/ristretto/` to strip the new path from the index while leaving the working tree intact, then `git commit` with a docs-stripped message. The docs files' first appearance lands in the final docs commit via the standard `git restore --source=<range-tip> --staged --worktree docs/ristretto/` at the end of the workflow (step 3 below). Do NOT use `git restore --source=HEAD` here — HEAD has no `docs/ristretto/` to restore from, so it would fail silently or leave the path staged.
   - **Docs-scoped-but-non-docs commits (type 3)**: `git cherry-pick <hash>`, then `git commit --amend` to retitle to the real scope.
     **Type-3 retitle heuristic** — the type prefix is determined by the paths touched, using a 4-rule precedence:
     1. repo-root metadata only (e.g. `package.json`, `README.md` at root) → `chore`
     2. documented config slot only (e.g. `.ristretto.json` keys per `reference/config.md`) → `chore`
     3. obvious intent markers (`BUG:`/`FIX:`/`HACK:` in the message, a single-file revert, `fix_*` function names) → `fix`
     4. otherwise → `chore`

     **Ignore the original commit's `docs(ristretto):` scope** — type-3 retitles REPLACE that scope. The scope token and one-line summary are model choices (the model has contextual knowledge the brief does not), not part of this heuristic.
   - **Pure code commits**: `git cherry-pick <hash>` unchanged.
   - Where the message was already correct, prefer `git cherry-pick --no-commit` + `git commit -C <hash>` to preserve author identity and message.
3. **Append the single docs commit at the tip.** Copy the final `docs/ristretto/` tree from the range tip and add it as one `docs(ristretto)` commit:
   `git restore --source=<range-tip> --staged --worktree docs/ristretto/`,
   then `git commit` with the docs message.
4. **Return** to the source branch. Do **not** push; tell the user the branch is ready to push and open a PR from.

## Renames inside docs/ristretto/

A rename WITHIN `docs/ristretto/` (e.g. `docs/ristretto/plans/foo.md` → `docs/ristretto/plans/bar.md`) stays on the docs side of the split. Both old and new names live under `docs/ristretto/`, so `git restore --source=HEAD --staged --worktree docs/ristretto/` correctly retains the rename as docs work. No special handling needed — the rename is docs work, full stop.

## Mid-range docs/ristretto/ creation

If `docs/ristretto/` is created mid-range (the path does not exist at the range base, appears for the first time in some commit inside the range), the first mixed commit that adds the path is the "bootstrap". Apply the §5a "Else" branch on it: `git cherry-pick --no-commit`, `git rm --cached -r docs/ristretto/`, commit the rest. The docs files' first appearance lands in the final docs commit.

Verify post-stratify: `git log --diff-filter=A --oneline -- docs/ristretto/ <range>` shows exactly ONE creation commit, which must be the squashed docs commit. If it shows more than one, a docs file leaked into a code-side commit — fix it before proceeding.

## Mode-specific verify

Everything in `commands/strata.md`'s §4e post-stratify verification applies. Additionally, confirm:
- the **source branch tip SHA is unchanged** (`git rev-parse <source-branch>` before and after must match), and
- the new branch's tip tree matches the source branch's tip tree (`git diff <source-branch> <PR_BRANCH> --exit-code` except for the docs commit's own structural differences — the docs/ristretto content should be identical).
