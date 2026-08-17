---
description: Prep one or more features into drift-resistant plans — a deep, durable contract plus a lean approach — and add them to the project roadmap. Planning only — no code. Pass "deep" to force roast mode.
argument-hint: <feature IDs, pasted feature text, or short descriptions> [deep]
---

You are in the **PREP** phase of ristretto. You plan; you do **not** write or modify any implementation code. The code is written fresh later, by `pull`.

Inputs to prep: $ARGUMENTS  (add `deep` to force roast mode on every input)

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

Status values: `planned` · `in-progress` · `blocked` · `needs-human` · `done`.
`blocked` is set by `pull`/`brew` when a feature can't proceed without a **decision** — the row carries a one-line reason. Re-prepping a `blocked` feature (refining its plan to resolve the reason) flips it back to `planned`.
`needs-human` means the opposite kind of stuck: the spec is fine and the code is built, but a **human has to run something** ristretto can't (see *Manual checks* below). It is a closing status, not a blocking one.
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

A `Depends:` is satisfied by a prerequisite that is `done` **or** `needs-human` — a pending manual check means an environment step is outstanding, not that the code and its `Provides:` are missing. Only `blocked` holds dependents back.

Keep it light: only add `Depends:` where a real prerequisite exists. Most features depend on nothing.

## For each resulting feature

1. **Fast by default; deep on demand or on failure.**

   - **Fast (default):** scope clear → write the plan. Push back once on a vague criterion with a sharpened version to confirm.
   - **Deep (`deep` argument, or automatic):** enter roast mode. **Escalate automatically the moment you cannot write a checkable acceptance criterion, cannot fill `Provides:` for a feature that something else `Depends:` on, or hit a product decision the input does not settle.** Each of those used to become a silent `Blockers:` line, or worse, a decision `brew` discovered at 3am and had to stop on. Here it becomes a conversation, while you are still in the room.

   **Roast mode:**
   1. One question at a time. Always attach your **recommended answer** — your best inference — so the user confirms, corrects, or redirects rather than composing from scratch.
   2. **If the answer is in the codebase, a doc, or the ticket, read it — don't ask.** Only surface what is net-new.
   3. Resolve upstream decisions before dependent ones. Walk each branch to its end before starting the next.
   4. **Write to the plan file after every single answer, before asking the next question.** The file is the source of truth, not the conversation. Never batch.
   5. Unanswerable → one line in `Blockers:` naming **who or what can answer it**, then move on. Never stall, never invent.
   6. Before closing: "Anything we haven't touched that should be in here?"

   Exit roast mode when every acceptance criterion is checkable **and carries a proof method**, `Provides:` is filled, and every decision the feature needs has a ruling in `Decisions:` — or when what's left is genuinely blocked and recorded as such.

2. **Make every acceptance criterion checkable** — by a test, a measurement, or a binary observation. This is the contract `pull` and `brew` are held to; a vague criterion makes the gates meaningless.
   - ✗ "improve the list" → ✓ "list renders 500 items in <100ms"
   - ✗ "better error handling" → ✓ "every failed API call shows a retry action within 1s"

   Push back **once** on a vague input, offering a sharpened version to confirm. If a criterion still can't be made checkable, that is the escalation trigger in step 1 — roast it out. Only what survives the roast unanswered lands in `Blockers:`, naming who or what can answer it; `brew` will skip the feature, and the blocked row names exactly what refinement is missing. Never write an unmeasurable criterion, and never invent one the user didn't confirm.

   **Then give every criterion a proof method — there are exactly two, and "none" is not one of them.**

   - **`[auto]`** — a test, a gate, or a measurement the agent can run proves it. The default; most criteria are this.
   - **`[human]`** — nobody automated can prove it, so a person must. Something that has to be *run* against a live environment (a migration, a seeded record, a third-party console) or something that has to be *looked at* (does the dropdown open, does the mobile layout hold, does the German copy read right). Every `[human]` criterion gets a matching line in `Manual-Checks:`.

   **A criterion with no proof method is the bug this rule exists to kill.** Unclassified is what made `brew` stop dead in the night on a UI criterion nobody could execute, waiting on an answer no one was awake to give. Classifying it costs one word and the loop never stalls again — it builds the feature, commits it, and leaves you a checklist. **Do not drop a criterion because it can't be automated.** That loses the migration you needed to run and the screen you needed to look at, which is worse than any stall: the plan quietly stops describing the feature.

3. **Write `docs/ristretto/plans/<FEATURE-ID>.md`**:

   ```
   # <FEATURE-ID> — <title>

   ## Spec
   - Source: <tracked ID, parent ID, or "idea">
   - Flight: <slug, or —>
   - Goal: one line.

   ## Contract
   - Acceptance:
     - [auto] <criterion a test, gate, or measurement proves>
     - [human] <criterion only a person can run or look at>
   - Provides: <public surface this feature exposes, at type level —
       `sendOtp(phone: string): Promise<OtpToken>` — or — >
   - Consumes: <surface from Depends: features this one calls, same form, or — >
   - Decisions: <resolved question -> the ruling, one line each>
   - Units: <the 2-6 units of work inside this feature, one line each, or — >
   - Manual-Checks: <proves|deploy · which criterion · where · what to do or look at,
       one line each, or — >
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

5. **Fill `Manual-Checks:` — one line for every `[human]` criterion, plus any deploy step.** Each line is:

   `<proves|deploy> · <the criterion it proves, or —> · <where a human does it> · <what to do or look at>`

   - **`proves`** — this check is the *only* proof of a `[human]` acceptance criterion. Running SQL against a live database, applying a migration, setting a secret, flipping a switch in a third-party console — and equally, looking at the thing: the dropdown opens, the mobile layout holds, the copy reads right in German. The code is still written, gated, reviewed and committed; that one criterion just isn't proven until a person ticks the box. **Every `[human]` criterion needs exactly one of these, and every `proves` line names the criterion it belongs to.**
   - **`deploy`** — a rollout step that proves nothing (backfill prod, rotate a key, enable the flag for real users). Nothing about the build or the closing status waits on it; it stays on the list because that's what the list is for.

   Ask about this in roast mode whenever a feature touches a schema, an external service, configuration, or anything visual — it is the single most common thing a plan forgets, and it is what used to stop an unattended `brew` in its tracks. Don't put the SQL or the command here; `Manual-Checks:` names the step. The exact thing to run or look at is written by `pull`/`brew` into `docs/ristretto/manual-checks.md`, against the code as it actually ends up.

   `pull`/`brew` may also discover checks that prep didn't foresee — the planner reads HEAD and sees the column that isn't there. That's expected, not a prep failure.

6. **Check `Consumes:` against `Provides:`.** When feature B lists A in `Depends:`, B's `Consumes:` must be a subset of A's `Provides:`. Check this at prep time and say so if it isn't — a mismatch here is the cheapest bug you will ever fix. Read A's plan wherever it lives, `plans/` or `plans/archived/`.

7. **Add or update one row** in `roadmap.md` for the feature — fill the `Flight` cell with its slug (or `—`).

## Hard rules

- **`planned` means every decision is already made.** This is the load-bearing rule of the whole plugin. `brew` runs unattended and must never stop on a planned feature — so a feature is only `planned` when nothing is left for a human to *decide*: every criterion checkable and classified, every ruling in `Decisions:`, `Provides:` filled. If a decision is missing, the feature is `blocked` and says which decision — it does not go out as `planned` and get discovered at 3am. **A `brew` that stops to ask a question is a prep bug, not a brew bug.** Work left for a human to *do or look at* is not a decision and does not block: that is `[human]` + `Manual-Checks:`, and it closes as `needs-human`.
- **`## Approach` is the part that rots — keep it to one screen.** `## Contract` is drift-free by construction and should be as deep as the feature deserves: a criterion, a signature, or a decision is true regardless of what the code looks like on the day it's pulled. Thin contracts are the single largest cause of inaccurate implementation. Depth here is not ceremony.
- **The repo's house rules constrain the plan.** Read `CLAUDE.md` / `AGENTS.md` before writing the `## Approach`, and don't route around a documented constraint — if the house rules rule out the obvious approach, plan the one they allow, or record the conflict in `Blockers:`. Still no code; a documented constraint is part of the destination, not turn-by-turn directions. ristretto only ever *reads* those files and never writes to them.
- **No code** still holds everywhere: no code blocks, no line edits, no shell commands. A type-level signature in `Provides:`/`Consumes:` is a contract, not code — it names what exists, never how it works. You are batch-planning; by the time `pull` runs, the code will have moved, and `pull` expands the contract into real directions against HEAD.
- **The acceptance criteria are the contract.** They must define "done" independently of how the code currently looks.

## When done

Print a short summary: which features were planned, their titles, and the path to `docs/ristretto/roadmap.md`. Do not start implementing anything.
