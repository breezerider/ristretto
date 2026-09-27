# Mode: rewrite (in place)

Follow this only after the user chose `rewrite` (see `commands/strata.md`). This mode **rewrites the working branch in place** — it is destructive.

## Goal state

A single `docs(ristretto): <summary>` commit sitting at the **topmost** point of the range. Every pure non-docs commit keeps its original position and SHA. The squashed commit is new, so everything after it on the branch gets a new SHA — the minimal unavoidable rewrite.

### Why topmost, and what rewrite is truly unavoidable

A commit's SHA is derived from its parent + full tree + message + author + committer. Change any descendant's parent and you re-create that descendant.

- **Never place the squashed commit at the root (base+1) of the range.** The root commit is every other commit's ancestor, so inserting a new commit there forces a **total rewrite** of the entire range. Prefer topmost so every clean commit *below* the first docs-touching commit keeps its SHA.
- Accept that clean commits **above** the topmost docs-touching commit are collateral: their ancestor chain changed because a docs commit sat beneath them, so they are re-created regardless of placement. That is arithmetic — expect it when docs commits sit early in the range.

## How — `git rebase -i` + manual file splits

Work on a throwaway branch or with a backup so nothing is lost. The safest sequence:

1. **Resolve the range** into a concrete "rebase this", e.g. `git rebase -i <base>` where `<base>` is the start of the range.
2. In the todo list, mark each docs-touching commit to be squashed, and set the one at the top of that group to `reword`. Goal: one commit named `docs(ristretto): ...`.
3. For **mixed commits**, during the rebase separate the `docs/ristretto/` changes from the rest: `git edit` the mixed commit, `git restore --source=<parent> --staged --worktree docs/ristretto/`, then `git commit --amend` with a message that drops the docs reference, then `git rebase --continue`. The `<parent>` here is the actual parent commit in the rebase todo — this works for both "parent has docs/ristretto/" and "parent does not" because the rebase todo carries the parent context.
4. For **docs-scoped-but-non-docs-path commits** (type 3): just `reword` their message to the real scope. Do not fold them into the docs stratify.

**Type-3 retitle heuristic** — the type prefix is determined by the paths touched, using a 4-rule precedence:
1. repo-root metadata only (e.g. `package.json`, `README.md` at root) → `chore`
2. documented config slot only (e.g. `.ristretto.json` keys per `reference/config.md`) → `chore`
3. obvious intent markers (`BUG:`/`FIX:`/`HACK:` in the message, a single-file revert, `fix_*` function names) → `fix`
4. otherwise → `chore`

**Ignore the original commit's `docs(ristretto):` scope** — type-3 retitles REPLACE that scope. The scope token and one-line summary are model choices.

## Mode-specific verify

Everything in `commands/strata.md`'s §4e post-stratify verification applies. Additionally, confirm the source branch was rewritten as intended: the squashed docs commit is present at the topmost point and pure non-docs commits below the first docs-touching commit kept their SHAs. Run the repo's configured test gate to confirm no tree content was lost.
