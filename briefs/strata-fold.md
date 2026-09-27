# `--fold` — explicit coalesce action

Pass `--fold` when the user wants the runs **actually merged**, not just suggested. Without `--fold`, the hint stays a suggestion and the model asks first — that's the safer default. With `--fold`, the model runs the detection and the fold.

**Default order: stratify first, then fold.** When `--fold` is on, the intended sequence is:

1. Run the docs stratify first (single `docs(ristretto)` commit, TYPE-3 retitles in place, MIXED split, docs-only commits absorbed). This produces a clean history.
2. Then run the fold against the post-stratify range — re-invoke the script against the cleaned range (`development..HEAD` after the stratify, or `<post-stratify-tip>`) and fold any remaining contiguous code-side runs the stratify didn't already collapse.

The reasoning for stratify-first: the docs stratify removes the noisy `docs/ristretto/*` commit churn and retitles TYPE-3 commits to their real scope. Against that cleaned range, `coalesce-runs` sees the surviving code commits more clearly and detects runs that were hidden behind docs commits or had their adjacency broken by the docs trail. Fold-second still preserves tree-byte-equivalence; it just exposes runs that the pre-stratify view couldn't.

**`--fold` doesn't restrict by commit type.** Any streak of contiguous non-docs commits that shares the conventional-commit scope token and touches the same area is a run — regardless of conventional-commit type. Same type, mixed types, any combination qualifies. The user said "fold", so any streak in the post-stratify range gets folded.

**When to use:**

- The user said "fold", "merge", "squash into one", or otherwise asked to collapse the runs. Coalesce-hint is a *suggestion*; `--fold` is the *action* for cases where the user has already given the go-ahead up front (e.g. "stratify the docs AND fold any small-commit streaks").
- Multiple detected runs: `--fold` folds every run in the range, not just the first. Each run becomes one commit, in the same place in history the run used to occupy (relative to the non-folded commits around it).

**Subject of the folded commit:**

`<type>(<scope>): <summary>` — the conventional-commit type and scope. The `<type>` is whatever fits the run: if all members share a type, use that; if types vary, default to `chore` (the neutral catch-all) or pick the dominant type. Derive the `<summary>` from the combined content: a short phrase that captures what the run collectively did, not a list of folded commits. Example for a 3-commit streak on `FoldableContainer.tsx` / `FoldableContainer.css`:

```
refactor(foldable-gate): tighten FoldableContainer internals
```

The model reads the `subjects` array from each run and the combined file list, then drafts the summary. Don't just take the first member's summary — that reads as "what the first commit did", not "what the fold did".

**How to perform the fold — both modes:**

1. Run the docs stratify first (if not already done). This produces a clean history with one `docs(ristretto)` commit and TYPE-3 retitles in place.
2. Call the script against the post-stratify range to get the runs (machine-readable):

   ```
   node scripts/strata.mjs coalesce-runs development..HEAD
   ```

   This emits JSON like `[{ start, end, scope, type, count, subjects, files }]`. The script's own `analyze` output already includes the same JSON under the `Fold-runs (machine-readable)` section.
3. For each run (oldest first), perform the fold in the chosen mode:
   - **branch mode**: in the new PR branch being built, when you reach the position of the run, do one cherry-pick with `--no-commit` for the first member, then `--no-commit` for the rest, then `git commit` with the folded subject. The combined diff lands as one commit.
   - **rewrite mode**: `git rebase -i <base>`, mark the run's first commit as `reword` (with the folded subject), mark the rest as `fixup`. After `rebase --continue`, the run is a single commit.

**Fold-first, instead — when you want it:**

The skill defaults to stratify-first because the post-stratify view is usually clearer, but fold-first is also valid. Tree-byte-equivalence is preserved in both directions. Fold-first makes sense when:

- The runs you want to fold are obvious pre-stratify and don't depend on the cleaned view.
- The user explicitly said "fold first, then stratify" or asked for the inverse order.
- You're replaying commits onto a new branch (branch mode) and want to keep the fold mechanic the same as the rebase mechanic — fold during replay, then stratify at the tip.

Mechanically, fold-first is the same operation against the original range — just run the script against `development..HEAD` *before* doing the docs stratify, perform the fold, then stratify as usual.

**Interleave** (fold one run, do part of the stratify, fold the next) is fine too — but unless there's a specific reason, doing them in one clean pass per operation is simpler and easier to verify.

**Verification after fold:**

- For each run: `git log --format='%s' <start>..<end> -- .` should now show exactly one commit with the folded subject (or one of `git diff` against the range tip proves tree equivalence).
- Tip tree still byte-identical to the original range tip — folding is a pure regrouping, it doesn't drop or change content.

**What `--fold` does NOT do:**

- It doesn't fold commits across docs commit boundaries (any docs commit in the range breaks a run — the script guarantees this).
- It doesn't fold commits whose only shared file is in `docs/ristretto/` — the script filters that out, so a docs-touching commit doesn't accidentally drag a code-only commit into a fold.

Prefer the script when the tree is normal/reviewable; fall back to the mode workflow when the script can't handle the shape and say why.
