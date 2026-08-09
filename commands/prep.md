---
description: Prep one or more features into drift-resistant plans — a deep, durable contract plus a lean approach — and add them to the project roadmap. Planning only — no code. Pass "deep" to force grill mode.
argument-hint: <feature IDs, pasted feature text, or short descriptions> [deep]
---

You are in the **PREP** phase of ristretto. You plan; you do **not** write or modify any implementation code. The code is written fresh later, by `pull`.

Inputs to prep: $ARGUMENTS  (add `deep` to force grill mode on every input)

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

Status values: `planned` · `in-progress` · `blocked` · `done`.
`blocked` is set by `pull`/`brew` when a feature can't proceed without a decision — the row carries a one-line reason. Re-prepping a `blocked` feature (refining its plan to resolve the reason) flips it back to `planned`.
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

1. **Fast by default; deep on demand or on failure.**

   - **Fast (default):** scope clear → write the plan. Push back once on a vague criterion with a sharpened version to confirm.
   - **Deep (`deep` argument, or automatic):** enter grill mode. **Escalate automatically the moment you cannot write a checkable acceptance criterion, or cannot fill `Provides:` for a feature that something else `Depends:` on.** That is the condition that used to become a silent `Blockers:` line; now it becomes a conversation.

   **Grill mode:**
   1. One question at a time. Always attach your **recommended answer** — your best inference — so the user confirms, corrects, or redirects rather than composing from scratch.
   2. **If the answer is in the codebase, a doc, or the ticket, read it — don't ask.** Only surface what is net-new.
   3. Resolve upstream decisions before dependent ones. Walk each branch to its end before starting the next.
   4. **Write to the plan file after every single answer, before asking the next question.** The file is the source of truth, not the conversation. Never batch.
   5. Unanswerable → one line in `Blockers:` naming **who or what can answer it**, then move on. Never stall, never invent.
   6. Before closing: "Anything we haven't touched that should be in here?"

   Exit grill mode when every acceptance criterion is checkable and `Provides:` is filled, or when what's left is genuinely blocked and recorded as such.

2. **Make every acceptance criterion checkable** — by a test, a measurement, or a binary observation. This is the contract `pull` and `brew` are held to; a vague criterion makes the gates meaningless.
   - ✗ "improve the list" → ✓ "list renders 500 items in <100ms"
   - ✗ "better error handling" → ✓ "every failed API call shows a retry action within 1s"

   Push back **once** on a vague input, offering a sharpened version to confirm. If a criterion still can't be made checkable, that is the escalation trigger in step 1 — grill it out. Only what survives the grill unanswered lands in `Blockers:`, naming who or what can answer it; `brew` will skip the feature, and the blocked row names exactly what refinement is missing. Never write an unmeasurable criterion, and never invent one the user didn't confirm.

3. **Write `docs/ristretto/plans/<FEATURE-ID>.md`**:

   ```
   # <FEATURE-ID> — <title>

   ## Spec
   - Source: <tracked ID, parent ID, or "idea">
   - Flight: <slug, or —>
   - Goal: one line.

   ## Contract
   - Acceptance:
     - <checkable criterion>
   - Provides: <public surface this feature exposes, at type level —
       `sendOtp(phone: string): Promise<OtpToken>` — or — >
   - Consumes: <surface from Depends: features this one calls, same form, or — >
   - Decisions: <resolved question -> the ruling, one line each>
   - Units: <the 2-6 units of work inside this feature, one line each, or — >
   - Blockers: <what could not be made checkable -> who/what can answer, or — >

   ## Approach
   - Strategy in prose.
   - Likely touchpoints: src/... (orientation, NOT exact edits)
   - Depends: <IDs, or —>
   - Parallel-with: <IDs, or —>

   status: planned
   ```

4. **Fill `Units:` whenever the feature needs more than one red→green cycle** — 2–6 lines, each an independently testable deliverable inside this one feature. Only a genuinely single-cycle feature gets `—`.

   **This is the opposite default from "Decompose only when there's a real seam" above, and the two must not be confused.** Splitting one input into several *roadmap features* is discouraged — it multiplies git-tracking IDs. Naming the *units of work inside one feature* is encouraged and costs nothing: same ID, same plan, same branch, same commit. `Units:` is what `pull`'s planner expands into per-unit file paths, signatures, and tests; a feature that arrives with `Units: —` when it plainly has several is the single most common cause of a thin build plan and inaccurate code.

5. **Check `Consumes:` against `Provides:`.** When feature B lists A in `Depends:`, B's `Consumes:` must be a subset of A's `Provides:`. Check this at prep time and say so if it isn't — a mismatch here is the cheapest bug you will ever fix. Read A's plan wherever it lives, `plans/` or `plans/archived/`.

6. **Add or update one row** in `roadmap.md` for the feature — fill the `Flight` cell with its slug (or `—`).

## Hard rules

- **`## Approach` is the part that rots — keep it to one screen.** `## Contract` is drift-free by construction and should be as deep as the feature deserves: a criterion, a signature, or a decision is true regardless of what the code looks like on the day it's pulled. Thin contracts are the single largest cause of inaccurate implementation. Depth here is not ceremony.
- **No code** still holds everywhere: no code blocks, no line edits, no shell commands. A type-level signature in `Provides:`/`Consumes:` is a contract, not code — it names what exists, never how it works. You are batch-planning; by the time `pull` runs, the code will have moved, and `pull` expands the contract into real directions against HEAD.
- **The acceptance criteria are the contract.** They must define "done" independently of how the code currently looks.

## When done

Print a short summary: which features were planned, their titles, and the path to `docs/ristretto/roadmap.md`. Do not start implementing anything.
