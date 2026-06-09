# `/ristretto:tamp` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/ristretto:tamp` lean-code review command and sharpen `pull`/`shot` so generated code is lean the first time.

**Architecture:** ristretto commands are markdown prompt files in `commands/`, fronted by YAML. `tamp` is the code-analogue of `grind` (review-only, prints to conversation, mirrors its tasting-note style). Two existing commands get their efficiency discipline tightened. No code, no tests, no git in this repo — each task produces or edits a markdown file and is verified by a concrete review checklist.

**Tech Stack:** Markdown + YAML frontmatter (Claude Code plugin command format).

---

## File Structure

- **Create** `commands/tamp.md` — the new review command (one responsibility: find & rank code waste, optionally fix).
- **Modify** `commands/pull.md` — sharpen the Efficiency block; add an optional `tamp` pointer.
- **Modify** `commands/shot.md` — mirror the same write-it-lean discipline into step 3.
- **Modify** `README.md` — command list, flavor section, usage block.
- **Modify** `.claude-plugin/plugin.json` — version `0.6.0` → `0.7.0`.

> **Note on TDD/commits:** This repo is not under git and command files have no test harness. The skill's test/commit steps don't apply; "verification" below is reviewing the file against an explicit checklist. If the repo is later put under git, commit after each task.

---

### Task 1: Create `commands/tamp.md`

**Files:**
- Create: `commands/tamp.md`

- [ ] **Step 1: Write the file with this exact content**

````markdown
---
description: Honest lean-code review of a diff or file — finds runtime waste, duplication, dead/over-built code, and readability drag, ranked and capped. Read-only; pass "fix" to apply the top findings.
argument-hint: [path or ticket ID] [fix]
---

You are running **TAMP** — an honest lean-code review. Tamping presses the grounds flat so water can't *channel* (rush through gaps and waste the shot). You find channeling in code: where it wastes compute, repeats itself, carries weight it doesn't need, or is harder to read than it should be. Read-only by default — assess and print, change no files unless `fix` is passed.

Target: $ARGUMENTS

## 1. Pick the target

- **No path or ID given** → review the current changes: the uncommitted working-tree diff if the tree is dirty, otherwise the current branch vs its merge-base with the default branch (what `pull` just produced). This is the common case — "review what I just built."
- **A path** (file or directory) → review that code as it stands, not just a diff. Use this for green-up passes on existing code.
- **A ticket ID** → review that ticket's diff (`feature/<ID>` vs its merge-base).
- **`fix`** anywhere in the arguments → apply mode (see §5). Without it, change nothing.

If the target is empty (clean tree, no diff, no path) → say so and stop. Nothing to tamp.

## 2. The lens: where's the waste?

Read the target code. Ask one question — *where's the waste?* — across four facets. Flag only **real** waste you can point at, never hypotheticals:

- **Runtime efficiency** — N+1 queries, recomputation that could be hoisted or cached, needless IO/network calls, work inside a loop that belongs outside it, O(n²) where O(n) is trivial. The only facet that touches real server cost — weight it highest.
- **Duplication / DRY** — copy-pasted blocks, near-identical functions, logic that reinvents a utility that **already exists in the repo**. Check the repo for the existing util before flagging — don't assume.
- **Dead / over-built** — unused symbols, unreachable branches, speculative abstraction or scaffolding that nothing needs yet (YAGNI).
- **Readability / structure** — unclear names, oversized functions, deep nesting, a file doing too many jobs. Weight this lowest; it matters, but never above a real runtime cost.

## 3. Rank and cap — stay green, don't flood

A review that dumps 40 nitpicks is itself the waste you're fighting (noise, tokens, ignored output).

- Rank findings by **impact × confidence**. Runtime efficiency outranks readability.
- Report **at most 7 findings**, highest-severity first. If more exist, add one line — `+N minor nits omitted` — and stop. Never dump the rest.
- Keep each finding tight: a clickable `file:line`, one line on *what's wasted*, one line on *the fix*. No essays.

## 4. Output

Print to the conversation — no file is written. For each finding:

> **`path/to/file.ext:42`** — *what's wasted, in one line.*
> Fix: *one line.*

Then a **verdict** line that mirrors the result, coffee-consistent:
- Nothing material → **clean shot**.
- Real waste found → **channeling** (name the worst one).

## 5. Fix mode (only if `fix` was passed)

Apply only the findings you reported, in severity order:
- Smallest diff per fix; reuse existing patterns and utilities.
- **Never** `git add -A`, commit, push, or touch `docs/ristretto/roadmap.md`. `tamp` is a lens, not a lifecycle step — committing stays with `pull` or the user.
- After applying, restate what you changed and what you deliberately left (the low-severity findings), so the developer can decide on the rest.

## Tasting note

Close with a single coffee-themed line that mirrors the verdict:

- *clean shot* → e.g. `☕ Even extraction — nothing channeling.`
- *channeling* → e.g. `Channeling on the hot path — tamp it down before it ships.`

One line only.
````

- [ ] **Step 2: Verify the file against this checklist**

Read `commands/tamp.md` and confirm:
- Frontmatter has `description` and `argument-hint: [path or ticket ID] [fix]`.
- All four facets are present in §2, with runtime weighted highest and readability lowest.
- §3 states the hard cap of 7 and the `+N minor nits omitted` rule.
- §4 says "no file is written" / prints to conversation.
- §5 forbids `git add -A`, commit, push, and roadmap edits.
- Voice matches `grind.md` (terse, honest, coffee tasting note at the end).

Expected: all boxes true. Fix any that aren't.

---

### Task 2: Sharpen the Efficiency block in `commands/pull.md`

**Files:**
- Modify: `commands/pull.md` (the "Efficiency" block under step 4, currently lines 38-41)

- [ ] **Step 1: Replace the existing Efficiency block**

Find this block:

```markdown
**Efficiency (the whole point of ristretto):**
- Targeted edits over rewrites; smallest diff that meets the criteria.
- Don't re-read files already in context. Don't scaffold what you won't use.
```

Replace it with:

```markdown
**Efficiency (the whole point of ristretto) — write it lean the first time:**
- **Reuse before writing**: before adding code, check the repo for an existing utility or pattern that already does the job. Reusing is the cheapest way to avoid duplication — `tamp` catching it later costs more than not writing it.
- **No waste in the code you write**: no N+1 or recomputation that could be hoisted, no copy-pasted logic, no scaffolding or abstraction nothing needs yet (YAGNI).
- **No waste in how you work**: don't re-read files already in context, don't restate the plan, targeted edits over rewrites — the smallest diff that meets the acceptance criteria.
```

- [ ] **Step 2: Add an optional `tamp` pointer in the "When done" section**

In the `## When done` section, immediately after the first sentence (`Print a short summary: ...`) add this line:

```markdown
If the diff was non-trivial, you may add a single optional line suggesting `/ristretto:tamp` for a lean-code pass — never more than one line, and skip it for tiny diffs.
```

- [ ] **Step 3: Verify**

Read `commands/pull.md` and confirm: the Efficiency block now leads with "Reuse before writing," names the four kinds of waste, and keeps the "don't re-read / smallest diff" discipline. The `tamp` pointer is one optional line in "When done." No other content changed.

---

### Task 3: Mirror the discipline into `commands/shot.md`

**Files:**
- Modify: `commands/shot.md` (step 3, currently line 14)

- [ ] **Step 1: Replace step 3**

Find:

```markdown
3. **Implement now** against the current code. Reuse existing patterns. Smallest diff that meets the acceptance criteria. (No drift to worry about — you're implementing immediately.)
```

Replace with:

```markdown
3. **Implement now** against the current code, lean the first time: reuse an existing utility or pattern before writing new code; no duplication, no N+1 or hoistable recomputation, no scaffolding nothing needs yet (YAGNI); smallest diff that meets the acceptance criteria. Don't re-read files already in context. (No drift to worry about — you're implementing immediately.)
```

- [ ] **Step 2: Verify**

Read `commands/shot.md` and confirm step 3 now carries the same write-it-lean discipline as `pull.md` (reuse first, no waste, smallest diff, don't re-read), and nothing else changed.

---

### Task 4: Update `README.md`

**Files:**
- Modify: `README.md` (command list ~lines 5-11, Flavor section ~lines 36-43, Usage block ~lines 65-78)

- [ ] **Step 1: Add `tamp` to the command list**

After the `/ristretto:status` bullet (the one ending "Changes nothing."), add:

```markdown
- **`/ristretto:tamp [path | ticket | nothing]`** — honest lean-code review: finds runtime waste, duplication, dead/over-built code, and readability drag in a diff or file, ranked and capped at the few that matter. Read-only; pass `fix` to apply the top findings. The code-analogue of `grind`.
```

- [ ] **Step 2: Adjust the opening count sentence**

Find `Five commands following the lifecycle **review → plan → build**.` near the top and replace with:

```markdown
A small set of commands following the lifecycle **review → plan → build**, plus `tamp` to keep the built code lean.
```

- [ ] **Step 3: Add a flavor line for `tamp`**

In the `## Flavor` section, after the `status` bullet (the brew-gauge one), add:

```markdown
- `tamp` closes with a **tasting note** mirroring its verdict — `clean shot` (nothing channeling) or `channeling` (real waste found).
```

- [ ] **Step 4: Add usage examples**

In the `## Usage` fenced block, after the `/ristretto:shot ...` line, add:

```
/ristretto:tamp                              # review the changes I just made
/ristretto:tamp src/auth                     # green-up pass on existing code
/ristretto:tamp VDA-224 fix                  # review a ticket's diff and apply the top fixes
```

- [ ] **Step 5: Verify**

Read `README.md` and confirm: `tamp` appears in the command list, the opening sentence no longer says "Five commands," a flavor line exists, and three usage examples are present. Wording matches the house voice.

---

### Task 5: Bump the plugin version

**Files:**
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Change the version**

Replace `"version": "0.6.0",` with `"version": "0.7.0",`.

- [ ] **Step 2: Verify**

Read `.claude-plugin/plugin.json` and confirm version is `0.7.0` and the JSON is still valid (no trailing comma errors).

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-09-tamp-command-design.md`):
- Part A `tamp` command — Task 1 (target selection, four-facet lens, rank+cap of 7, conversation-only output, fix mode boundaries, tasting note). ✓
- Part B sharpen `pull`/`shot` — Tasks 2 & 3 (reuse-before-writing, write-it-lean lens, concrete token discipline, optional pointer). ✓
- README + version build notes — Tasks 4 & 5. ✓
- Out-of-scope items (no graphify graph, no caveman, no report file, no roadmap/git from tamp) — enforced by §4/§5 of Task 1; nothing in the plan adds them. ✓

**Placeholder scan:** No TBD/TODO; every file change shows exact find/replace text or full content. ✓

**Type/name consistency:** Command name `tamp`, verdicts `clean shot` / `channeling`, the 7-finding cap, and the four facet names are identical across Task 1, Task 4, and the spec. The `tamp` pointer text in Task 2 references the real command name. ✓
