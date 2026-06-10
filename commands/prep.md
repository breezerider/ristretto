---
description: Prep one or more features into lean, drift-resistant intent plans and add them to the project roadmap. Planning only — no code.
argument-hint: <feature IDs, pasted feature text, or short descriptions>
---

You are in the **PREP** phase of ristretto. You plan; you do **not** write or modify any implementation code. The code is written fresh later, by `pull`.

Inputs to prep: $ARGUMENTS

Each input is one of: a **tracked feature** (has an ID like `BREW-224` — keep that ID exactly, it's how the work is tracked in git), a **raw idea** you want to build, or a **feature too big** to plan as one unit.

## Setup

Work against the project roadmap at `docs/ristretto/`. Create these if missing — do not ask, just create:

- `docs/ristretto/roadmap.md`
- `docs/ristretto/plans/`
- `docs/ristretto/plans/archived/`

If `roadmap.md` is new, start it with this table:

```
# Ristretto Roadmap

| Flight | Feature | Title | Status | Plan | Updated |
|--------|---------|-------|--------|------|---------|
```

Status values: `planned` · `in-progress` · `done`.
Flight: a short kebab slug grouping related features, or `—` for a standalone feature.

## Decompose only when there's a real seam

Default to **one** plan per input. The ID is the git-tracking key, so don't multiply keys without cause — over-splitting is the failure mode and the opposite of what ristretto is for.

Split one input into several only when there's a genuine seam:

- independently shippable deliverables, or
- separate acceptance contracts (no shared definition of "done"), or
- it would estimate **≥ 21** (`grind`'s "too large, split it" line).

When unsure, keep it whole. Before writing any plans, **print the proposed split** — one line per resulting feature — and let the user merge or veto it. Then plan each resulting feature below.

### IDs — never drop the git-tracking number

- **Tracked feature, not split:** use its ID verbatim (`BREW-224`).
- **Split of a tracked feature:** keep the number, add a short kebab suffix — `BREW-224-otp-resend`, `BREW-224-rate-limit`. The number stays greppable in git; the suffix says which part.
- **Raw idea (no number):** mint a plain descriptive slug from the title — `login-rate-limit`, `dark-mode-toggle`. No prefix — once planned it's just a feature, and the `Source:` line records that it began as an idea. Keep it short; it must be unique in the roadmap.
- Record the origin in the plan's `Spec` (`Source:` line below) so a split or idea still points back to where it came from.

### Flights & dependencies — record the shape, don't schedule it

When inputs belong together — a split of one feature, or several features that form one deliverable — give them a shared **Flight** slug (kebab, e.g. `dpk-detail`). A lone feature with no siblings gets `—`. This is just a grouping label; it changes nothing about how a feature is planned or pulled.

When one resulting feature can't start until another lands, record it with **`Depends:`** (the prerequisite feature IDs) on the dependent plan. When two are independent and could be worked side by side, note it with **`Parallel-with:`**. Both default to `—` (no constraint). These are honest notes about the graph — `pull next` reads `Depends:` to avoid pulling a feature whose foundation isn't built yet; `Parallel-with:` is informational. ristretto stays one-feature-at-a-time; you're recording order, not running waves.

Keep it light: only add `Depends:` where a real prerequisite exists. Most features depend on nothing.

## For each resulting feature

1. **Only ask if genuinely ambiguous.** If scope is clear, proceed — no mandatory brainstorm gate. If something is truly unresolvable (missing API contract, undecided UX), ask 1–2 sharp questions, then continue with the rest.

2. **Write `docs/ristretto/plans/<FEATURE-ID>.md`** as a *lean intent plan*:

   ```
   # <FEATURE-ID> — <title>

   ## Spec
   - Source: <tracked feature ID, parent ID, or "idea">
   - Flight: <flight slug, or —>
   - Goal: one line.
   - Acceptance:
     - bullet
     - bullet
   ## Approach
   - Strategy in prose (a few sentences).
   - Likely touchpoints: src/... (areas for orientation, NOT exact edits)
   - Decisions / tradeoffs: ...
   - Depends: <feature IDs that must be done first, or —>
   - Parallel-with: <feature IDs safe to work alongside, or —>
   - Blockers: <external blockers — missing API, undecided UX — or —>

   status: planned
   ```

3. **Add or update one row** in `roadmap.md` for the feature — fill the `Flight` cell with its slug (or `—`).

## Hard rules

- **No code.** No code blocks, no exact line edits, no shell commands in the plan. You are batch-planning; by the time `pull` runs, the code will have moved. A plan that bakes in today's code rots. Capture the **destination** (acceptance criteria) and the **route** (approach), never turn-by-turn directions.
- **The acceptance criteria are the contract.** They must define "done" independently of how the code currently looks.
- **Keep it slim.** Resist over-specifying. A plan that fits on one screen is the target.

## When done

Print a short summary: which features were planned, their titles, and the path to `docs/ristretto/roadmap.md`. Do not start implementing anything.
