# Design: `/ristretto:tamp` — lean-code review + `pull`/`shot` generation discipline

**Date:** 2026-06-09
**Status:** Approved (design), pending implementation plan
**Scope:** Add one new command to the ristretto plugin and sharpen two existing ones.

## Motivation

Company goal: "green code / save tokens." Three *separate* costs were tangled in the
original ask, and the design keeps them straight:

| Lever | Cost it attacks | Where it lives |
|---|---|---|
| 1. Cheap-to-**run** code | Runtime/compute of shipped software ("green software") | new `tamp` command (and `pull` writes lean) |
| 2. Cheap **generation** | The Claude session cost while coding | sharpened `pull`/`shot` discipline |
| 3. Readable / DRY | *Future* cost to re-read & re-explain | new `tamp` command |

Researched tools, deliberately **not** adopted:
- **graphify** (knowledge-graph context reuse): only pays off above ~500 files; ristretto's
  `roadmap.md` already serves the "don't re-scan the repo" idea at this scale.
- **caveman** (terse prose output): wrong tool for code; weak (14–21%) and a 6-line version
  beats the full skill. We want clear code, not caveman variable names.

The real, honest token saver at this scale is **scope discipline** — already half-present in
`pull` and made explicit here.

## Part A — New command: `/ristretto:tamp`

**Metaphor:** tamping presses the grounds flat so water can't *channel* (rush through gaps
wastefully). `tamp` finds channeling in code. It is the code-analogue of `grind`
(which reviews a *ticket*); `tamp` reviews the *code*.

**Frontmatter**
- `description`: house style, one line.
- `argument-hint`: `[path or ticket ID] [fix]`

**1. Pick the target**
- **No arg** → the current changes: uncommitted working-tree diff if the tree is dirty,
  else the current branch vs its base (what `pull` just produced). Makes `tamp` the natural
  "review what I just built" step after `pull`.
- **A path** → review that file/dir as it stands (existing code, not just a diff) — reusable
  for green-up passes on legacy code.
- **A ticket ID** → that ticket's diff (`feature/<ID>` vs base).
- **`fix`** anywhere in args → apply mode (see §5).

**2. The lens — one question, four facets**
One organizing question: *where's the waste?* Each facet flags only **real** waste:
- **Runtime efficiency** *(highest weight — only facet touching real server cost)*: N+1,
  recomputation, needless IO/network, work inside a loop that belongs outside, O(n²) where
  O(n) is trivial.
- **Duplication / DRY**: copy-paste blocks, near-identical functions, reinventing a util that
  **already exists in the repo** — it must check the repo before flagging.
- **Dead / over-built**: unused symbols, unreachable branches, speculative abstraction (YAGNI).
- **Readability / structure** *(lowest weight)*: naming, function size, nesting depth, files
  doing too much.

**3. Rank and cap** (keeps it green, not noisy)
- Severity = impact × confidence; runtime outranks readability.
- **Hard cap ~7 findings**, highest-severity first. If more exist, one summary line
  ("+N minor nits omitted") — never a dump.
- Each finding: clickable `file:line`, one line of *what's wasted*, one line of *fix*.
  No essays.

**4. Verdict + tasting note** (mirrors `grind`)
- Verdict line, coffee-consistent: e.g. **"clean shot"** (nothing material) vs
  **"channeling"** (waste found).
- A tasting note that matches the verdict, as `grind` does.

**5. Fix mode** (only when `fix` passed)
- Applies only the reported findings, smallest diff each, reusing existing patterns/utils.
- **Never commits, never `git add -A`, never touches the roadmap.** `tamp` is a lens, not a
  lifecycle step. Its report output is the conversation; its fix output is the working tree.
- Restates what it changed and what it deliberately left (low-severity).

**Output destination:** conversation only (like `grind`). No report file is written — a
review artifact you must read then clean up is itself the waste `tamp` fights. Deferred
findings, if worth keeping, belong in a **ticket** via `prep`, not a bespoke report.

**Boundaries:** read-only by default; never commits/pushes; never edits the roadmap; no
animation in the work path (consistent with the rest of ristretto).

## Part B — Sharpen `pull` and `shot` (lever 2)

The "Efficiency" block in `commands/pull.md` is good but soft. Tighten it and mirror into
`shot`:
- **Reuse before writing**: search for an existing util/pattern before adding code — kills
  duplication at the source, cheaper than `tamp` catching it later.
- **Same four-facet waste lens, applied while writing** — not only after.
- **Concrete token discipline**: don't re-read files already in context; don't restate the
  plan; don't scaffold unused; smallest diff that meets the acceptance criteria.
- **Light pointer**: at the end of `pull`, a one-line suggestion to run `/ristretto:tamp`
  when the diff was non-trivial — optional, not nagging.

## Out of scope (YAGNI)
- No graphify-style knowledge graph.
- No caveman prose mode.
- No `tamp` report file; no roadmap or git interaction from `tamp`.

## Build notes
- New file: `commands/tamp.md`.
- Edit: `commands/pull.md`, `commands/shot.md`.
- Update `README.md` (command list, flavor section).
- Bump `.claude-plugin/plugin.json` version `0.6.0` → `0.7.0`.
- Repo is **not** under git, so the spec is not committed; future commits are the user's call.
