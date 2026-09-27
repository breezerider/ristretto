---
description: Stratify a noisy docs/ristretto planning history into one docs(ristretto) commit — branch or rewrite mode, optional --mr and --fold.
argument-hint: <range> [--mode branch|rewrite] [--ticket ID] [--mr] [--fold]
---

☕ strata — collapse the docs/ristretto planning trail into one clean docs(ristretto) commit.

You are running **STRATA**. Collapse every commit in a range that belongs to `docs/ristretto/` into ONE `docs(ristretto)` commit, keeping the rest of each commit's changes intact. The result is history stratified into clean, reviewable layers — one docs stratum apart from the intact code strata, like the layered glass of a latte macchiato. Ask the user which mode they want before doing any work, using `analyze`'s `Recommended:` (pushed-check) as the driver.

Target: `$ARGUMENTS`  (`<range>` plus `--mode branch|rewrite`, `--ticket ID`, `--mr`, `--fold`)

## 0. Check the format version — before anything else

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" check
```

Exit 0 → continue. Exit 1, 2, or 3 → follow what it printed.

## 1. Pre-flight state

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" state
```

Read-only. Refuse (print the **murky glass**, go to Step 7) if:
- `pulling: armed by ANOTHER session` (any owner that is not this session) → show what it printed, stop.
- `pulling: armed, unclaimed` → show what it printed, stop.
- `tree: N changed path(s) — unproven` → show what it printed, stop.

Permit proceed ONLY when `pulling: not armed`. `unrecognised: <n> file(s)` is informational only, never a stop. A tree marked PROVEN GREEN is finished work — tell the user to commit it, never discard.

## 2. Prove the tree once (ratchet baseline)

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify cached
```

Exit 0 → continue. Exit 1 → refuse with:

```
⛔ ristretto: repo is not green — nothing stratified.
   <gate>: <the failure, one line>
```

Exit 3 → UNVERIFIED — surface the message, refuse.

## 3. Arm

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" arm
```

Plain `arm` — NOT `arm orchestrator`. (strata does not dispatch subagents; brew's orchestrator mode is reserved for brew alone.) The marker `.ristretto/pulling` is required during Steps 3–6 and MUST be absent afterward (Step 7 disarms). Exit 1 only if it cannot write its marker — stop and report.

## 4. Stratify (the work)

### 4a. Default-branch refusal (rewrite mode only)

When `mode == rewrite` AND `current_branch == default_branch` AND no explicit user confirmation → refuse. Print the murky glass, go to Step 7.

When `process.stdin.isTTY === false` on default-branch rewrite → refuse upfront, do not block (no blocking). Print the murky glass, go to Step 7.

When `mode == branch` → no default-branch refusal fires (branch mode preserves the source branch untouched).

Resolve `current_branch` and `default_branch` via the helper script's `check-branch` verb (`node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" check-branch`).

### 4b. Resolve and validate the range

- Missing range → run `check-branch`. Non-default branch → offer `suggested_range` (`merge-base(<default>, HEAD)..HEAD`), let the user confirm or override. Default branch → always prompt; never invent a range.
- Given/confirmed range → run `validate-range` (`node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" validate-range <range>`). Reject on any non-zero exit / stderr. If it reports nothing to fold (`commits_in_range: 0` or start==end), stop.
- In rewrite mode, reject a range whose end is `HEAD` if that end would capture the squashed commit you're about to create — you cannot squash a commit into itself.

### 4c. Analyze and choose mode

Run `analyze` (`node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" analyze <range> [--mode M] [--ticket T]`). Read from its output, in this order:

1. `== Remote check ==` — the narrowed push-history set, FIRST (basis for every later recommendation).
2. `== Commits in <range> relevant to docs/ristretto ==` — MIXED / type-3 / docs-only / non-docs classification.
3. `== Mode ==`.
4. `== Draft subject ==`.

Use `Recommended: branch|rewrite` plus the pushed-warning to drive the mode choice. Default to `branch` when any relevant commit is already on a remote or intent is a clean PR; `rewrite` only for an explicit in-place clean of unpushed history. **Ask the user to confirm the mode and the suggested PR branch name before working.**

When `analyze` reports a `Coalesce-hint` run, surface it to the user and ASK. Do NOT auto-coalesce. If the user says yes and `--fold` was passed, fold those commits (after the docs stratify, per stratify-first default).

### 4d. Perform the stratify in the chosen mode

Follow the matching workflow file:

- `branch` mode → `${CLAUDE_PLUGIN_ROOT}/briefs/strata-branch.md` (non-destructive: builds a fresh PR branch off the range base, source branch untouched).
- `rewrite` mode → `${CLAUDE_PLUGIN_ROOT}/briefs/strata-rewrite.md` (destructive: rewrites the working branch in place).

If `--fold` is passed, it runs within the SAME arm/disarm cycle — NO re-arm. After the docs stratify, re-invoke `coalesce-runs` against the post-stratify range, then apply the chosen mode's cherry-pick mechanic per run. The marker is set once at Step 3 and cleared at Step 7. See `${CLAUDE_PLUGIN_ROOT}/briefs/strata-fold.md`.

If `--mr` is passed, after the squash and its verify pass, write a ticket-named `<TICKET>.md` at the repo root from the cleaned history — do NOT commit it. See `${CLAUDE_PLUGIN_ROOT}/briefs/strata-mr.md`.

### 4e. Post-stratify verification

After the stratify work completes, verify per the Verify subsection:
- `git log --oneline <range> -- docs/ristretto/` shows exactly 1 commit.
- No commit in the range still carries a `docs(ristretto):` (or `docs(...):`) scope in its subject except the single squashed one. A leftover docs-scoped subject is the same failure as a leftover docs file — check for both.
- `git status` is clean (unless `--mr` left `<TICKET>.md` intentionally unstaged — that is expected).
- The non-docs commits retain their intended content and (except the unavoidable ones re-created by a rewrite) their messages.
- In **branch** mode specifically: the source branch is unchanged (its tip SHA is identical), and the new branch's tip tree matches the source branch's tip tree.
- In **rewrite** mode: the squashed docs commit is present at the topmost point and pure non-docs commits below the first docs-touching commit kept their SHAs.

On ANY post-stratify verification failure → Step-6 refusal path: print the murky glass, go to Step 5 (which runs `gate.js verify` and surfaces failure formally), then Step 7.

## 5. Prove the whole repo (full verify, ratchet attribution)

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify
```

Full, NO `cached` — HEAD changed during the stratify, so the cached verdict no longer applies. Parse the exit code AND the `ristretto: N NEW test failure(s) — these were not failing before this change:` blocks in stderr:

- Exit 0 → proceed to success terminal (print the **success macchiato glass**), then Step 7.
- Exit 1 + `newFailures` attribution (the `ristretto: N NEW test failure(s)` block names tests not in the tolerated set) → REGRESSION. Print the murky glass, then Step 7. Name the failing tests.
- Exit 1 + only `tolerated` failures (the `(N pre-existing failure(s) tolerated — already failing when this feature started)` line, no NEW block) → proceed to success terminal (ratchet-clean), print the success glass, then Step 7.
- Exit 1 + no `gates.testReport` (no attribution possible) → REFUSE. Print the murky glass. Surface "cannot attribute — no test report configured" and the raw failure, then Step 7.
- Exit 3 → UNVERIFIED. Print the murky glass. Surface the UNVERIFIED message, then Step 7.

A gate killed as hung is unverified, not proven broken — find what it's waiting on before going on; if it can't be resolved, UNVERIFIED path.

## 6. Step-6 refusal

If any of the stratify's own post-conditions (Step 4e) failed AND Step 5 returned exit 0 (the gates passed but the stratify itself was wrong — e.g. leftover docs-scoped subjects, source branch SHA changed in branch mode) → refuse. Print the murky glass. Surface the specific post-condition that failed, then Step 7.

## 7. Disarm (always)

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" disarm
```

Always — on success, on REGRESSION, on REFUSE, on UNVERIFIED, on §4a refusal, on Step-6 refusal, on helper-script non-zero exit, on user abort. The marker is removed on every exit path.

---

## Which commits in the range matter

Detect by **path OR subject** — a commit matters if it touches `docs/ristretto/` **or** its subject is scoped as a docs commit. The subject case is what a path-only scan misses: a commit whose subject is `docs(ristretto):` (or `docs(...):`) but whose only real change is a non-docs file. Such a commit is still a docs-scoped commit and must not be left dangling.

Ignore (and leave untouched) a commit only when it neither touches `docs/ristretto/` **nor** carries a docs scope in its subject.

Classify the ones that matter into:

1. **Docs-only commit** — touched only `docs/ristretto/` files (subject may or may not be docs-scoped). The whole commit's content folds into the single squashed commit.
2. **Mixed commit (docs path + other files)** — touched `docs/ristretto/` **and** other files. Split the `docs/ristretto/` portion out; the rest of the commit stays as its own (rewritten) commit, and its message is rewritten to drop the docs scope/mention.
3. **Docs-scoped but touches no docs path** — subject is `docs(ristretto):` (or `docs(...):`) but the diff is only non-docs files. There is no docs content to fold; **retitle** the commit to its **real scope** (whatever the files it changed actually are — often a `chore(...)`, `fix(...)`, or packaging commit) and keep it in place. Do **not** fold a commit like this into the docs stratify — it has no docs content to contribute.

> Common real-world case for type 3: a commit titled `docs(ristretto): update archived plan to reflect X` whose only real change is `debian/conffiles` or another non-docs file. Retitle it to `fix(...)` / `chore(...)` / the real scope and keep it — don't leave a dangling `docs(...)` commit and don't fold nothing into the docs stratify.

## Pushed history

In **rewrite** mode, if any commit in the range exists on a **remote**, warn loudly and require explicit confirmation before rewriting — a history rewrite diverges pushed history. Offer **branch** mode instead, which sidesteps the problem entirely. In **branch** mode no such warning is needed; the source branch is never touched.

Push-history narrowing in `analyze` uses the current branch's configured upstream remote (`git config --get branch.<cur>.remote`, falling back to `init.defaultRemote`, then `origin`) — `git log --remotes=<remote> --format=%H <range>` is called ONCE and the commit-hash set is intersected against the range's hashes in memory. No per-hash `git branch -r --contains <hash>` shell-out.

## Commit message

Use Conventional Commits: `docs(ristretto): <summary>`. The `<summary>` should be a short phrase capturing what the collapsed planning edits did — e.g. `docs(ristretto): plan the auth and rate-limit features`, or `docs(ristretto): track and archive the current flight's plans`. Derive it from the content being squashed, not from one arbitrary member commit.

**Describe the docs outcome, never the git surgery.** The message reads as "what this commit does", not "what the author did to history". So:

- ✗ "Collapsed all history into a single commit"
- ✗ "Includes: plan A + plan B + archive C" (a list of folded commits)
- ✓ "docs(ristretto): track and archive the current flight's plans"

The body (if any) lists the *documents* now present and their state. Retitled type-3 commits keep a body describing their real change.

## The helper script

`scripts/strata.mjs` is a platform-agnostic (node) helper. It never rewrites history itself — it reports and validates, and the workflow feeds its output into the decisions below. It exposes five **verbs**:

- `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" check-branch`
  Prints `current`, `default`, and `is_default`. **Run this first** to decide how to handle a missing range: if `is_default` is `true`, the user must supply an explicit range (never invent one); if `false`, use the printed `suggested_range`.
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" validate-range <range>`
  Checks the range is usable: both endpoints resolve to real commits, end is not before start, and it prints `valid`, the resolved endpoints, and `commits_in_range`. **Run this on every range** before doing work, and treat any non-zero exit / stderr as input to reject (bad hash, end-before-start, malformed range). A "valid" range with `commits_in_range: 0` or a start==end note means there is nothing to fold.
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/strata.mjs" analyze <range> [--mode M] [--ticket T]`
  Enumerates and classifies the relevant commits, reports whether any are pushed, recommends a mode, suggests a ticket-aware PR branch name, and drafts a subject. `--ticket` overrides ticket auto-detection. Prints `Recommended: branch|rewrite` which drives the mode decision below; `PR` branch name and draft subject are suggestions, not decisions you apply without the user.

`analyze` output prints in this order: (1) `== Remote check ==`, (2) `== Commits in <range> relevant to docs/ristretto ==`, (3) `== Mode ==`, (4) `== Draft subject ==`. The Remote check is the basis for every later recommendation — it comes first so a reader sees the data before the conclusions drawn from it.

### Feeding the verbs' output into decisions

1. **Missing range** → run `check-branch`. Non-default branch: offer the `suggested_range` and confirm. Default branch: no default; ask for an explicit range and flag that it means rewriting since the initial commit.
2. **Given/confirmed range** → run `validate-range`. Reject on any error; if it reports nothing to fold, stop.
3. **Mode choice** → use `analyze`'s `Recommended:` plus the pushed-warning it prints. Default to `branch` when history is pushed or intent is a clean PR; `rewrite` only for an explicit in-place clean of unpushed history. Ask the user to confirm the mode and the suggested PR branch name before working.
4. The classification, remote check, and draft subject from `analyze` are the same inputs the shared sections above describe — treat `analyze` as the concrete realization of "which commits in the range matter".

### Coalesce-hint — contiguous small-commit runs

When the range holds any docs-relevant commits, `analyze` emits a `Coalesce-hint` section. It flags runs of **2 or more consecutive non-docs commits** that share the same conventional-commit scope token (the scope is usually a feature slug, not a ticket). The commit type doesn't matter — any combination of types counts, as long as the scope is shared. (The helper additionally groups members around a common area; the hint prints scope and subjects only — the same runs the Fold-runs section reports.) An all-non-docs range stops earlier, printing `>> No relevant commits … Nothing to squash.` with no hint — run `coalesce-runs <range>` directly to see the fold-runs it would have reported.

These look like one feature implemented as a string of small commits — clean to read once it's one commit, noisy as a run.

**When analyze reports a coalesce run, surface it to the user and ASK. Do NOT auto-coalesce.** This is a suggestion, not an action; the user decides whether to merge them into one commit first, and may decline for good reasons (each commit is logically separate, the reviewer already saw them as-is, etc.).

Concretely, the message to the user reads like:

> Heads up: analyze found N consecutive commits on scope `(foldable-gate)` that read like a single feature split across small fixes: `<subject 1>`, `<subject 2>`, `<subject 3>` (the actual subjects from the run).
>
> Want to coalesce them into one `<type>(<scope>): <summary>` commit? I won't act without your say-so; if you want me to fold, pass `--fold` or just say "yes, fold" and I'll do it (after the docs stratify, per the skill default).

The `<type>` is whatever fits the run — same type if all members share one, otherwise pick a sensible default. The point is to fold the noise; the exact type label is secondary.

The model is reporting, not deciding. If the user says yes, fold those commits into one (in the chosen mode), then proceed with the docs stratify. If no or unclear, proceed with the stratify as planned and leave them as-is. Don't loop or re-ask once they've answered.

### `--fold` — explicit coalesce action

Pass `--fold` when the user wants the runs **actually merged**, not just suggested (without `--fold`, the hint is a suggestion and the model asks first).

For the full mechanics — stratify-first default, type/area rules, subject derivation, how to perform the fold per mode, fold-first/interleave variants, verification, and what `--fold` explicitly does NOT do — see [briefs/strata-fold.md](briefs/strata-fold.md).

## Tests

`scripts/strata.fixtures/test.mjs` exercises all five verbs against a fake `git` shim (`scripts/strata.fixtures/fake-git.mjs`) selected by `GIT_SCENARIO` — no real git repo is touched:

```
node scripts/strata.fixtures/test.mjs
```

It asserts on stdout/stderr and exit codes for the common cases: default vs feature branch, valid/backwards/bad-hash/malformed/empty ranges, an unresolvable range failing loud on `analyze`/`coalesce-runs`/`authors` (exit 2 + stderr), a range given after `--mode` still resolving, pushed vs unpushed mode recommendation, ticket-aware PR branch naming, multi-author attribution (`authors` lists each author and the configured identity; author names containing `|` parse via the tab-separated format), `coalesce-runs` happy-path and strict-mode against a same-scope streak (member file union printed in the JSON), `coalesce-runs` returning empty against an unrelated fixture, and bootstrap-classification of a MIXED commit whose parent has no `docs/ristretto/` path. A failing exit code means a verb regressed against the mocked git responses. Runs are fully deterministic — no network, no real git.

---

## Banners — literal strings embedded in this file

Both banners below are LITERAL strings that live in `commands/strata.md` itself. They are NOT in `scripts/strata.mjs`. They are NOT in `briefs/`. They are NOT loaded from any external file. This file's body prints the success macchiato glass on success-path terminal (Step 5 exits 0 or only tolerated failures, before Step 7 disarm) and the murky macchiato glass on every failure-path terminal (REGRESSION, REFUSE, UNVERIFIED, §4a refusal, Step-6 refusal, helper-script non-zero exit). The success glass and the murky glass are **mutually exclusive** — only one is ever printed in a single run.

### Success macchiato glass — print this on success path

```
_________________________________________
\_______________________________________/
 \...................................../
  \.................................../
   \         docs(ristretto)         /
    \-------------------------------/
     \#############################/
      \###########################/
       \#########################/
        \         feats         /
         \---------------------/
          \~~~~~~~~~~~~~~~~~~~/
           \~~~~~~~~~~~~~~~~~/
            \ base commits  /
             \-------------/
             /             \
             |_____________|
              ☕ stratified
```

### Murky macchiato glass — print this on every failure path

```
_________________________________________
\_______________________________________/
 \·^▒*?=▒+;=:~;░^~%?^!+?·:+*░:▒%░=!%;·!/
  \▒+;=:~;░^~%?^!+?·:+*░:▒%░=!%;·!~*·^/
   \;░^~%?^!+?·:+*░:▒%░=!%;·!~*·^▒*?=/
    \^!+?·:+*░:▒%░=!%;·!~*·^▒*?=▒+;=/
     \+*░:▒%░=!%;·!~*·^▒*?=▒+;=:~;░/
      \░=!%;·!~*·^▒*?=▒+;=:~;░^~%?/
       \!~*·^▒*?=▒+;=:~;░^~%?^!+?/
        \*?=▒+;=:~;░^~%?^!+?·:+*/
         \=:~;░^~%?^!+?·:+*░:▒%/
          \~%?^!+?·:+*░:▒%░=!%/
           \?·:+*░:▒%░=!%;·!~/
            \:▒%░=!%;·!~*·^▒/
             \-------------/
             /             \
             |_____________|
              ☕ murky — stratify refused
```
