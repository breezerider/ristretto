---
description: Brew the whole pot — autonomously pull every eligible planned feature from the roadmap in sequence, each planned and built by fresh subagents, gated by hooks, on a single session branch. Skips to `blocked` instead of guessing. Runs until nothing is left to brew.
argument-hint: [easy]
---

You are running **BREW** — an autonomous loop over the roadmap. The user batch-planned with `prep` and walked away; all judgment is front-loaded into the plans. You make **zero product decisions**: acceptance criteria define "done", the deterministic gates decide when a feature may close, and anything undecidable becomes `blocked` — never a guess.

Arguments: $ARGUMENTS  (add `easy` to force every feature through the easy path — see below)

**You are the orchestrator, not the implementer.** Each feature runs through fresh subagents — a planner, an implementer, an independent reviewer, and a closer; your context holds only bookkeeping and one-line results. Do not read the codebase, the plans, or any diffs yourself — a large batch must not grow the main conversation. Each subagent starts clean, sees exactly one job, and dies with all its noise; the reviewer's fresh context is also what makes the review independent — it never saw the implementer's reasoning.

## `easy` — the forced-easy experiment lane

`easy` treats **every** eligible feature as `easy`, whatever its `Tier` cell says. It exists to measure the tier design rather than argue about it.

- **It rewrites nothing.** The roadmap's `Tier` cells are left exactly as `prep` set them. A run that edited them would destroy the ability to run the comparison a second time, and would quietly launder an experiment into a data change.
- **The implementer runs on the capable model.** This is not an exception to the model rule but that rule applied honestly: the model tracks how much thinking the build plan already did, and under `easy` there is no build plan at all — the implementer plans and builds in one pass, which is the most demanding job in the loop, not the least.
- **Escalation is recorded and then ignored.** On any of the five triggers, write `would-escalate: <trigger>` into the result and **build anyway, without a plan.** Escalating normally would send every hard feature down the `normal` path and leave nothing to compare; stopping would leave features unbuilt. Recording-and-continuing is the only arm that produces both halves — a census of which tickets were genuinely easy, and an outcome for the ones that weren't.
- **Labelled forever, like `raw`.** `## Evidence` records `tier: easy (forced)` and every `would-escalate:` line verbatim; the roadmap row is appended with `easy`. Work built under an experiment must stay identifiable long after the experiment is forgotten.
- **Gates and review are untouched**, which is what makes this safe to run: the worst outcome is not unproven code but more blocks found and more rounds spent — and that is the measurement. A forced-easy run can never produce a green row over code no gate and no reviewer ever saw.

Across a batch, the run's final report names the `would-escalate:` count against the feature count — that ratio is the experiment's primary result, and it is the one number a forced-easy run exists to produce.

## 0. Check the project's format version — before anything else

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" check
```

Exit 0 → continue. Exit 1 → **the project's files are in an older shape than this version reads.** Read `${CLAUDE_PLUGIN_ROOT}/docs/format-migration.md` and apply it — it tells the user what is happening, brings `docs/ristretto/` up to date, and hands back here to continue. It is plumbing, not an errand: the user asked for this command, not for a migration. Do not proceed on an unmigrated project — a status or field this version doesn't recognise gets read as something else, silently, and the first sign of it is a wrong decision much further down. Exit 2, or "PROJECT IS NEWER" → stop and report; that is a stale plugin install, not a stale project.

## Before the loop

1. Read `docs/ristretto/roadmap.md` (the one file you do read — it's the index, built to be read in ten seconds). If it doesn't exist, tell the user to run `/ristretto:prep` first and stop.
2. If no feature is *eligible* (see loop condition below), do no work — just print the classic cup and stop:

   ```
         ) )
        ( (
      .________.
      |        |]
      |        |
      `--------'
      ☕ ristretto: nothing to brew.
   ```

   plus one short barista quip, and — if features exist but all are blocked — a line naming what's blocked and why. If any row is `needs-human` with unticked boxes, name those too, separately: they aren't waiting on refinement, they're waiting on you to run something. Same again for any `needs-review` row — those are waiting on your judgement, which is a third queue and a third remedy.
3. **Pre-flight — establish what "broken" already means here.** With `testReport` configured this no longer requires a fully green suite: the first `verify` captures the failures already present as a baseline, says how many, and tolerates exactly those for the rest of the run — a new failure still blocks, and the set can never grow. Without `testReport` it means what it always did: green, or nothing brews. Work `.ristretto.json` exactly as in `pull` step 3: create it if missing, complete it if it predates a key, and — if the suite is slower than a minute — **set `testChanged`**, which is what keeps the loop's per-subagent gate from re-running the whole suite dozens of times. An existing config is not a finished one; a `testChanged` that quietly dropped a flag the full `test` gate carries makes the loop's fast path slower than the suite it replaced, and the pre-flight below is where that gets named. Fix it here, before the loop — this is the last moment it costs nothing. Then prove the tree once, before arming anything:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify cached
   ```

   `cached` returns the stored verdict when the tree is byte-identical to one already proven green, and runs the full suite otherwise. On a repo whose suite takes ten minutes this is the difference between resuming a brew and re-paying for it: a session that restarts before the first feature would otherwise spend the whole cost again to re-prove a tree nobody touched. It is not a weaker check — an unchanged tree cannot have a different verdict, and if the toolchain resolves differently the cached verdict is discarded and the suite runs for real.

   **Run it exactly like that — bare.** Do not prepend to PATH, do not substitute a different toolchain, do not run the underlying test command yourself "to check". The hooks inherit none of that, so any environment you add makes this pre-flight prove a tree the hooks will never reproduce, and the first subagent goes red on code nobody touched. If a specific toolchain is required, it belongs *inside* `.ristretto.json`, not around the command. (`verify` prints and records the binary each gate resolved; a hook that resolves a different one will name the mismatch rather than blaming the repo.)

   Exit 0 → carry on. Exit 1 → stop immediately:

   With a baseline in play, exit 1 means the tree got *worse* since it was captured — not that it is red. Say which:

   ```
   ⛔ ristretto: repo is not green — nothing brewed.
      <gate>: <the failure, one line>
      fix this first; brew won't build on a red tree.
      (with "testReport" set, this instead means NEW failures since the baseline was
       captured — the named tests were passing then and are failing now.)
   ```

   Do not create the marker, do not create the branch, do not dispatch anything. This check costs one test run and is the cheapest failure in the whole command — without it the first *planner* subagent trips the SubagentStop hook, gets retried three times, and surfaces a confusing block for a failure it did not cause and could not fix, having written no source at all.

   **If a gate was killed as hung rather than failing**, say exactly that and stop — a hang is not a red tree, and it is the one failure that will otherwise repeat at every single stop for the whole run:

   ```
   ⛔ ristretto: the <gate> gate went silent for Ns and was killed — nothing brewed.
      find what it's waiting on (open handle, port, watch mode), or raise
      silence.<gate> in .ristretto.json if that tool is just quiet for long stretches.
   ```

4. **Arm the gates**, exactly as in `pull`: create the marker `.ristretto/pulling`, and `.ristretto/build/` if it doesn't exist. The marker stays armed for the whole loop — the **SubagentStop** hook runs lint + typecheck + test while it exists, so every per-feature subagent is gated individually; a subagent cannot return "done" with red gates. Three things keep that affordable across a long batch: the gate runner fingerprints a green tree and skips re-running on an unchanged one (so reviewers and closers, which change nothing, don't pay a test run at every stop); while the loop is running the test gate is the **scoped** `testChanged` command — only what the current feature touched; and only one gate run executes at a time repo-wide. Repo-wide proof happens once, after the loop.

5. **Declare yourself the orchestrator:** create the marker `.ristretto/orchestrating` (empty). While it exists, the Stop hook does not gate *your* turns — only SubagentStop gates, one subagent at a time.

   This is not a relaxation, it is the gate pointed at the right thing. You write no source; the subagents do, and each is gated on its own stop. Your turns end while a subagent is mid-edit — between "red tests written" and "implementation landed", or with a migration created but not yet applied — so gating them runs a suite against a tree that belongs to a half-finished cycle. It reports hundreds of failures that are nobody's defect, burns the retry budget saying so, and the only way out is to disarm the gates and improvise, which is exactly what must never be necessary. **Delete this marker when the loop ends**, alongside `.ristretto/pulling`.

6. **One branch for the whole session.** Create and switch to `feature/brew-<YYYY-MM-DD>` (reuse it if you're already on it). Every feature lands here as its own commit. Never push, never set an upstream.

   **A dirty tree is one of two things, and you can tell them apart without reading a diff.** If `.ristretto/build/<ID>.md` exists for a feature the roadmap still calls `planned`, the changes are a previous brew's own work, left behind when it died mid-feature — that is loop step 7's reconcile path, not a surprise. Resume that feature on the branch it was already on, and say so. It is the ordinary way an interrupted batch comes back, and it has already recovered a complete, green feature that would otherwise have been thrown away.

   Only genuinely foreign changes — no build plan, no roadmap row expecting them — mean stop, because that is someone's unsaved work and brewing over it would be destructive. Say what you found and stop; that is not "asking a question", it is refusing to overwrite something you cannot account for.

## The loop

A feature is **eligible** when its status is `planned`, all its `Depends:` are satisfied, and its `Blockers:` is `—`.

**A `Depends:` is satisfied by `done`, `needs-human`, or `needs-review`.** All three have their code built, committed, gated green, and their `Provides:` present — what is outstanding is a step in someone's console or an opinion in someone's inbox, not code in the repo. Treating any of them as unfinished would stall an entire flight behind one `alter table` or one reviewer's objection, which is precisely the failure these statuses exist to prevent. Only `blocked` — a genuine spec gap, where the prerequisite's code was never written — holds dependents back.

Also re-check manual checks each pass: a `needs-human` row whose `proves` checks are now all ticked `- [x]` in `docs/ristretto/manual-checks.md` is eligible as a **check re-run** — dispatch a closer to prove its pending criteria and flip it to `done`, no planner or implementer needed.

While an eligible feature exists:

1. **Pick** the topmost eligible feature (re-read the roadmap each iteration — subagents update it).
2. **Read the feature's `Tier` from its roadmap row first.**

   - `normal`, or no `Tier` cell at all → dispatch the planner exactly as in the next step.
   - `easy` → **skip the planner entirely.** The contract is the build plan. Dispatch the implementer directly and tell it to expand the contract inline before writing anything: read the current code in the touchpoint areas, find the utilities, patterns and test conventions this repo already uses, and settle the exact file paths, the real names and signatures, and the test cases that prove each criterion. Nothing is written to `.ristretto/build/`. **Everything else in this loop is unchanged**: the gates stay armed, the tests still go red first, the review still runs, the closer still closes.
   - The `easy` argument was passed → every feature is treated as `easy` regardless of its row. See **`easy` — the forced-easy experiment lane** above.

   **The ratchet — escalate, never lower.** While expanding an `easy` contract inline, the implementer stops **before writing any code** and returns `escalate: <trigger>` if any of these is true:

   1. the contract cannot be satisfied as written against the current code;
   2. it needs a new dependency, a migration, a schema change, or a manual check the contract does not already name;
   3. it must create public surface not named in `Provides:`;
   4. it spans more than three files;
   5. any acceptance criterion is `[human]`.

   On `escalate:`, **you** dispatch the planner as in the next step, then a fresh implementer against the build plan it wrote, and you tell the closer to flip the row's `Tier` to `normal` and record `escalated from easy: <trigger>` in the plan's `## Evidence`. **Nothing may ever lower a tier** — not this command, not a subagent, not a later run. An upfront label is an estimate made before anyone read the code, and this repo has receipts on those being optimistic; the ratchet is what makes being wrong cost minutes instead of a broken feature.

3. **Dispatch the planner** (fresh context, capable model) — **before** any implementer runs. The plan holds the destination; this writes the directions, now, against HEAD, so they cannot be stale. Use the planner brief from `pull` step 5 verbatim, filling in the ID: read the plan (`## Contract` binding, `## Approach` possibly stale), take each dependency's `Provides:` as fact, read the current code, write `.ristretto/build/<FEATURE-ID>.md` with real paths, signatures, and test code, no placeholders — and record any **manual check** it finds against HEAD, with the exact command and the criteria that wait on it. Then write those checks into `docs/ristretto/manual-checks.md` in the format `pull` defines.

   On `blocked:`, set the roadmap row to `blocked` with that reason and move to the next feature — **no implementer ever runs**. This is the cheap failure, and it is where you want failures to happen. A manual check is never a `blocked:` — the feature still gets built.

4. **Dispatch the implementer** (fresh context, general-purpose) — **one feature at a time, never in parallel**: subagents share one branch and one repo-wide gate. Give it this brief verbatim, filling in the ID:

   > You are implementing exactly one ristretto feature: **<FEATURE-ID>**. Work autonomously; you cannot ask the user anything.
   >
   > 1. Read `.ristretto/build/<FEATURE-ID>.md` — your plan, written against the current code minutes ago. `docs/ristretto/plans/<FEATURE-ID>.md`'s `## Contract` is the acceptance contract behind it. Implement the plan; do not re-plan.
   > 2. **Tests first, red first**: where the stack has a test gate, the build plan's test cases become tests before implementing — they are already transcriptions of the acceptance criteria; do not re-derive them — and run them to confirm they fail. A test that passes before implementation proves nothing. Tests the build plan marks as waiting on a **manual check** are the exception: write them skipped, each naming the check that unblocks it. They can't go red honestly — the environment they need doesn't exist yet.
   > 3. Implement the build plan against the current code, lean the first time: its file paths, names, and signatures; reuse before writing, smallest diff that meets the criteria, no scaffolding nothing needs yet. Done when the red tests pass.
   > 4. Read the repo's house rules — `CLAUDE.md` / `AGENTS.md`, including any nested one near the files you touch. They bind you even where the surrounding code doesn't demonstrate them yet. Never write to those files.
   > 5. Verify by running the gate commands **exactly as `.ristretto.json` spells them** — copy the string, substitute nothing, invent nothing. Typing your own equivalent is the single most expensive mistake available to you here: a hand-rolled `pytest -q` next to a configured `pytest -q -n auto` runs the same suite on one core instead of all of them, which on a real repo turned a 289-second gate into forty minutes of a subagent sitting still. It also proves something slightly different from what the SubagentStop gate is about to check, so a green you produced that way is not the green you are being measured on. If a gate command looks wrong to you, say so in your final message and run it anyway. Fix until green; never weaken, skip, or delete gates or tests to get there. **Never sit in one silent command for more than about five minutes.** You are killed if you go quiet for ten, and being killed is the worst of all endings: your result is lost entirely, so the orchestrator gets no answer rather than a failure it could act on, and everything you built is stranded unproven in the tree. So for anything that might run long — a full suite, a slow build, a run that queues behind the repo-wide gate lock — **start it in the background and poll it to completion yourself**, checking every 30–60 seconds *inside the turn you are already in*. Each check is a sign of life, and the wait costs nothing extra.
   >
   >    **Poll with short checks — never a chain of long blocking waits.** Reaching for a wait-until-done command turns "poll" into "sleep": every one of them adds its own length to how late you notice a result that was ready at the start of it, and they pile up as a row of identical waiters on the same run. One finished suite noticed ten minutes late, per gate, per feature, is a slow batch built entirely out of nothing happening.
   >
   >    **Never end a turn with a run still in flight.** That is the whole of it, and it is the half of this rule that gets dropped: backgrounding a gate and then ending your turn is not "running the gates in the background", it is not running them at all — you die, the run is orphaned or finishes for nobody, and your result is lost exactly as if you had been killed. Background *and* poll, or run it in the foreground; there is no third option where you start something and leave.
   >
   >    **Concretely: never hand the wait to something that ends your turn.** `Monitor`, any wait-for-completion helper, or the sentence “I'll wait for the notification and continue when it lands” — these read like a plan and execute as a death. The turn ends, you are killed, the run finishes for nobody, and the orchestrator gets no answer rather than a failure it could have acted on. Three subagents in one batch died exactly this way, each having politely announced it would wait; that batch lost about an hour to re-running one of them from a half-finished tree and to killing two that woke later and collided with their own replacements. Poll with your own repeated checks in the turn you are already in, or run the command in the foreground with a generous timeout — 600s is fine for a full suite. A gate you did not watch finish is not a gate you passed. Short gates (lint, typecheck, a scoped test run) can simply run in the foreground. If a run seems to hang at the start it is most likely queued — only one gate run executes at a time repo-wide, and it now says so out loud when it is waiting.
   > 6. **Do NOT commit, archive, or touch the roadmap** — an independent review happens after you.
   > 7. **Skip, never guess.** If you hit a real product decision the plan doesn't make, a missing contract, a blocker prep didn't see, or gates you cannot get green honestly: `git restore` every file you touched (leave the tree clean), set the roadmap row to `blocked` with a one-line reason **phrased as the spec gap** — what the plan failed to decide, not what the code couldn't do ("acceptance criterion 'fast' isn't measurable — needs a number") — and stop there.
   > 8. **A manual check is not a block, and never a `git restore` — but your default is that there isn't one.** A criterion is only a human's to prove when **this repo gives you no path to its subject**. Before you defer anything, try: does the compose file, a `migrate`/`seed` script, a `Makefile` target or the test harness already apply that migration? Is there a browser or widget driver in the dev dependencies that can press that button? If yes, run it and write the test — a migration you can apply is an `[auto]` criterion, and deferring it is just an untested feature with a note attached. The build plan may already say otherwise; the build plan was a guess made before anyone read the code, and you are looking at the code. **Never a check about production** — rollout, prod backfill, prod flags are not yours and not the user's. Only when nothing in the repo reaches it — a hosted console with no credential in this environment, a device that isn't here — do you skip the test that needs it and keep going. Then make sure the check is in `docs/ristretto/manual-checks.md`, naming the criterion it proves **and what specifically was out of reach**, and report it. Never tick a box there.
   > 9. No scope creep: don't fix adjacent problems; mention them in your final message as suggestions.
   >
   > Your final message must be exactly one of:
   > `ready: <FEATURE-ID> — <files touched> — <red→green test names, or how criteria were proven>`
   > `needs-human: <FEATURE-ID> — <files touched> — <criteria proven> — pending: <the check, one line>`
   > `blocked: <FEATURE-ID> — <spec gap>`
   > followed by at most 3 short lines. Nothing else — your full reasoning dies with you; only this summary survives.

   A `needs-human:` result continues exactly like `ready:` — review, then close. The only difference is the status the closer writes.

5. **Dispatch the reviewer** (fresh subagent, capable model) on a `ready:` or `needs-human:` result — unless the diff is trivial (roughly < 15 changed lines and no new functions/branches/loops; when in doubt, review). Use the review brief from `pull` verbatim: read the plan, the repo's `CLAUDE.md` / `AGENTS.md` if present, and the feature's diff, change no files and run no gates, three buckets in priority order — `block` (the shipped product misbehaves: a criterion genuinely unsatisfied, a `[human]` criterion silently treated as proven, data loss, a security hole, a documented house rule the diff violates, a reachable unhandled edge case on a changed path), `note` (the product is right but the proof is weaker than it claims: a vacuously passing test, a docblock overstating what is proven, a criterion proven by proxy without saying so, a changed path with no coverage), and `lean` (runtime waste, duplication vs existing repo utilities, dead/over-built, readability). **The line between `block` and `note` is the one that decides what this costs:** a test you believe is vacuous is a `note`. A test that is vacuous **and** whose criterion you went and checked and found actually unmet is a `block` — name the criterion and say how you checked. Report every `block` it can point at — that list is never truncated — then at most 5 `note` and at most 5 `lean`, one line each (`block|note|lean · file:line · what · fix`), blocks first, each note carrying in that same line one clause saying why a user cannot be harmed by it; house-rule *staleness* is a trailing note, never a finding, since nothing in the loop may edit those files; and the final line is exactly one of `review: clean`, `review: notes-only (n note, m lean)`, or `review: blocking (n)`.

6. **Act on the verdict** — capped at 3 rounds:
   - `review: clean` → dispatch the **closer**.
   - `review: notes-only` → dispatch the **closer**, and hand it the notes and leans to copy **verbatim** into the archived plan under `## Open findings`. The row still closes `done` — a note cannot harm a user by its own definition, and routing it to `needs-review` would refill your judgement queue with things nobody needs to act on. `needs-review` is for open **blocks**. No fixer, no round.
   - `review: blocking (n)` → dispatch a **fixer** subagent: "Fix these review findings for <FEATURE-ID>: every `block` is mandatory; clear the `note` and `lean` findings in the same pass unless a fix is riskier than the win, and say which you left. Get the gates green by running the commands in `.ristretto.json` **exactly as written** — never a hand-rolled equivalent, which drops flags the real gate has and can cost you forty minutes on one core. Never end your turn with a run still in flight: background it and poll it with your own checks, or run it in the foreground with a generous timeout (600s), but report only what you watched finish. **Never `Monitor`, and never any other wait-for-a-notification tool** — it ends your turn, which kills you and loses your result entirely. Do not commit or close. Final message: `fixed: <FEATURE-ID> — <what was fixed / left>`." Then a fresh reviewer verifies (round 2).
   - **Round 3 — escalate, and tell it what round it is.** Blocks still open after round 2: dispatch a **fresh** implementer on a model one tier above the one that got stuck, given the plan, the open findings, the diff, and — this is the part that was missing — **which criterion has now failed review twice, across two independent attempts.** Not the failed diffs; those anchor a fresh mind onto a bad approach, which is why they were withheld. But the *pattern* is the diagnosis: one attempt failing is probably the code, and the same criterion failing twice is probably the criterion. Withholding that sent a better model at the same wall with no way to see it was a wall. Then one final scoped re-review.

     **If the findings turn on a decision the plan never made** — a criterion that admits two readings, a case the contract is silent on — **do not stop. Take the recommended reading, implement it, and say so.** Record it in `## Evidence` as `decision taken: <the question> → <the ruling> — not in the contract`, and carry it in the result line. A stall costs the whole night; the same question answered defensibly and flagged costs a minute in the morning, and it stays fixable all of that minute. This is the one place the loop may settle a question the contract left open, it must never be silent about doing so, and it is not licence to reinterpret a criterion the contract *did* settle.

   - **Still open after round 3 → commit it as `needs-review`. Never `git restore`.** The gates are green. The tests pass, the code works, and what remains outstanding is an advisory opinion from an actor that runs no gates and changes no files. Deleting a green tree over that is disproportionate — and the rule that said to has been declined by every subagent that ever met it: one ignored the findings and carried on, one took a fourth round, one invented `.ristretto/stranded/` to park work the command gave it nowhere to keep. Three improvisations, one diagnosis, and they were right. Dispatch the **closer** exactly as for a `ready:` result, with the status **`needs-review`** and the open findings copied **verbatim** into the archived plan under an `## Open findings` heading — not summarised, not resolved, not softened. Then move to the next feature.

     **`needs-review` satisfies `Depends:`, and that is the whole point of it.** The `Provides:` are in the code and the gates are green, so the features behind it keep brewing. One reviewer's unresolved objection must never cost you the eleven features downstream of it — that cascade, not the finding itself, is what used to empty a pot at feature 4 of 15. Name in the report every feature that was built on a `needs-review` foundation, so the exposure is visible rather than merely absent.

     **Three rounds, then keep the work: still bounded, and now genuinely never stuck.** A fourth round is not needed and not allowed — subagents reached for one because round 3 ended in destruction, and with a resting state to land in, the reason is gone.
   - **Round 2 is a confirmation pass, and its scope is now closed.** It verifies the round-1 blocks and any new **block** the fixes introduced *in files the fixer touched* — that is what catches a fixer breaking something while mending something else, which is the entire reason this round exists. A block in code the fixer never touched is reported and copied into `## Open findings`; it does not start another round. New notes and new leans are not reportable in round 2 at all. What it must never become is nothing: a fix is code no reviewer has ever seen, and "the evidence looked strong" is the feeling that precedes every regression. If you are tempted to skip it to save time, the honest read is that something else in the run is too slow — scope the tests, not the review.
   - **Closer** brief: "Close ristretto feature <FEATURE-ID>: commit `feat(<FEATURE-ID>): <summary>` staging only the touched files (never `git add -A`) — keep the subject plain ASCII, since a shell re-interprets backticks, `@`, `$`, `!` and quotes; if the summary truly needs them, write the message to a file and use `git commit -F <path>` (never a heredoc), and never repair a mangled subject with `--amend`; in the plan, correct `Provides:` to whatever was actually built, append `## Evidence` — how each criterion was proven (red→green test names, output, measurements), a gate summary, and the review verdict **with the number of rounds it took** (`review: clean (1 round)`, `review: notes-only — 3 open (1 round)`, `review: 4 blocks resolved in 2 rounds`, `review: skipped (trivial diff)`) — the run's report is read back off this section, so a verdict without its round count is a measurement thrown away — and move it to `docs/ristretto/plans/archived/`; delete `.ristretto/build/<FEATURE-ID>.md`; flip the roadmap row to `done` with today's date, files touched, and the commit hash. A criterion that can only be proven after a manual check is recorded as `pending human: <the check>`, never as proven, and the row's status is **`needs-human`** instead of `done` — the plan is still archived, the commit still made. If you were told this feature closes **`needs-review`**, the commit and the archive are exactly the same, the row's status is `needs-review`, and you additionally copy the open review findings **verbatim** into the archived plan under an `## Open findings` heading — one line each, in the reviewer's own words, neither softened nor marked resolved, because a person is about to read them cold and your paraphrase is not evidence. `## Evidence` additionally records `tier: easy` or `tier: easy (forced)` where either applies, every `would-escalate: <trigger>` line **verbatim**, and `escalated from easy: <trigger>` where the ratchet fired. Any `decision taken:` line you were given goes in `## Evidence` unchanged. Never push, never amend or reset, no PRs. Final message: `brewed: <FEATURE-ID> <commit-hash> — <one-line summary>`, `brewed-needs-human: <FEATURE-ID> <commit-hash> — pending: <check>`, or `brewed-needs-review: <FEATURE-ID> <commit-hash> — <n> finding(s) open — <the sharpest one, one line>`."
   - **Check re-run** (a `needs-human` row whose `proves` checks are now all ticked): no planner, no implementer. Dispatch a closer to un-skip the tests that named those checks, run them, and — if they pass — replace the `pending human check` lines in the archived plan's Evidence with real proof and flip the row to `done`. If they fail, the check did not do what the plan assumed: set the row to `blocked` with that as the reason.

7. **When a subagent comes back with nothing.** Any dispatch can die: killed for going silent too long, ended by a transport error, or returning something in none of the shapes its brief allows. **This is never the user, and never a reason to ask them anything.**

   From where you sit a killed subagent and a user interrupt are indistinguishable — the same shape arrives either way, and you cannot tell them apart. So do not try. Treat both as what you can actually verify: a subagent that produced no usable result. That is a failure of that subagent, handled here, now, by you. If the user really did interrupt, they are awake and will say so; the one thing that helps nobody is stopping to ask an empty room, which is exactly what "it looks like you interrupted me" turns into at three in the morning.

   1. Run `git status --short`. That is the only evidence of what it managed before it died.
   2. **Clean tree** → dispatch the same brief again, once, fresh context. Something that died before touching anything costs nothing to retry.
   3. **Dirty tree** → the work is unproven: no gate ran on it, no reviewer saw it, and its own author never got to say whether it was finished. Dispatch **one** fresh subagent with the same brief plus: *"a previous attempt died and left partial work in the tree. Reconcile it against the build plan and finish the feature. Verify all of it as if you had written it yourself — nothing here has been proven."*
   4. **A second death on the same feature ends it.** `git restore` the tracked files it changed, delete the untracked files it created (`git status --short` lists both, and the tree was clean when the feature started, so everything dirty is its doing), set the row to `blocked` — reason: `implementation aborted twice — no verifiable result` — and **move to the next feature**. Never a third attempt. Never a question.

   Print `⛔ <FEATURE-ID> blocked — subagent died twice` so the trail reads honestly afterwards. If subagents keep dying across *different* features, that is an environment problem rather than a feature problem: finish the loop anyway, and name it in the final report. Diagnosing it is not this run's job.

8. **Record the result — and print nothing else.** Each subagent's one-liner is all you keep. Print `☕ <FEATURE-ID> brewed (n/m)`, `🔧 <FEATURE-ID> brewed, needs a human check — <check>`, `👀 <FEATURE-ID> brewed, needs review — <n> finding(s) open`, or `⛔ <FEATURE-ID> blocked — <reason>` between features so the trail is readable. A feature where round 3 settled an open question adds `· decision taken: <the ruling>` to its line — that is the one thing in this loop a person might want to overrule, and it must not wait for the final report to be seen.

   **That line, a blocker, and the final report are the whole of what the main chat gets.** For the entire run: one result line per feature, anything that has genuinely stopped the loop and needs the user *now*, and the report at the end. Everything else stays out — which feature is next and why it is eligible, that a planner or a reviewer has been dispatched, that the gates went green, which review round you are on, a subagent's summary restated in your own words, what you are about to do next. The harness already shows the user that agents are running and files are changing; narrating it in prose tells them nothing they cannot already see, and across a batch this long it buries the handful of lines that actually carry the run. Someone who steps away for eight hours should be able to read the whole main chat in under a minute and know exactly where the pot is.

   **This is not silence.** A loop that can no longer make progress — a dead environment, a database the gates need that is not there, a tool that vanished from PATH — says so immediately and in full. Quiet is for progress; a run that has stopped being able to progress is the one thing that must never wait for the final report.
9. **Hygiene check** (cheap, no reading): `git status --short` must be clean before the next feature's planner is dispatched. If a subagent died mid-work and left changes, `git restore` them and set that row to `blocked` (reason: "implementation aborted mid-work — re-brew or refine"). Delete any leftover `.ristretto/build/<FEATURE-ID>.md` for a feature that blocked.
9. Next eligible feature.

## When you stop — for any reason

**This section is not "after a successful loop". It runs whenever this command stops running**, and the abnormal endings are the ones it exists for: the pot is empty, or a feature blocked, or something died, or you believe you were interrupted, or you are simply out of room to continue. "The loop didn't finish" is the reason to do this, never a reason to skip it. A brew that ends without it leaves the next session a repo it will misread — armed markers, a stranded tree — and that has now happened more than once.

**Before you write a single word of the report, run `git status --short`, and describe only what it printed.** Never state what is or isn't in the tree from memory of what you dispatched: a subagent that died still wrote files, and "nothing is stranded" is a claim that has been wrong exactly when it mattered most. If it is dirty, that is loop step 7 — handle it there, then report what you did.

Then, in order:

1. **Run the full suite — once, over everything.** The loop gated each feature against `testChanged`, which only ever proved the files that feature touched. Nothing yet has proven that feature 7 didn't break feature 2. So before you disarm anything:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify
   ```

   - **Exit 0** → the batch holds. Record the summary line in the report.
   - **Exit 1** → say so loudly and first, above everything else. **Do not amend, revert, or reset the commits** — they're already made, nothing was pushed, and the branch is the user's to review:

     ```
     ⛔ full suite RED after the batch — <n> features are committed on <branch> but the repo is not green.
        <gate>: <the failure, one line>
        cross-feature breakage the scoped runs couldn't see. fix on the branch, or
        /ristretto:prep a fix and pull it before merging.
     ```

     This is the known cost of scoping tests during the loop, and it's the right trade — a fast batch with one honest red at the end beats a batch too slow to finish. What isn't acceptable is a quiet one.
   - **A gate killed as hung** is neither: report the batch as unverified, name the gate, and point at what it might be waiting on / `silence` in `.ristretto.json`.

2. **Disarm the gates — this one is not optional and not last.** Delete `.ristretto/pulling` and `.ristretto/orchestrating`, and `.ristretto/gate-retries` / `.ristretto/gate-stalled` if present, and delete any remaining `.ristretto/build/` files. If step 1 could not run at all, do this anyway, first.

   `orchestrating` is the dangerous one to leave behind: while it exists the Stop hook does not gate, so a leftover turns the gates off for every later session in that repo — with no error, no symptom, and nothing to notice until something red is committed. The runner now expires it after a couple of hours without a subagent gate, but that is a backstop for the case where you never got to run at all, not permission to skip this.

   Keep `.ristretto/build/<ID>.md` for a feature you planned but did not implement, and say in the report that it is there — the next brew re-plans from HEAD by default, and a plan the user paid for is worth naming before it is silently redone.
3. **Report — read it off the archived plans, never off your memory of the run.** Before writing a word of it, read the roadmap rows this run touched and the `## Evidence` section of every plan it archived. That is the record: a closer wrote it at the time, with the diff in front of it. Your own context is hours or days deep by now, and the earliest features are the first thing compressed out of it — a report recalled rather than read has already under-counted review rounds this command itself ordered, and a summary is exactly where nobody downstream can catch that.

   Report the full-suite verdict, features brewed (with commit hashes), features `needs-human` (each with its check), features `needs-review` (each with its open findings and any `decision taken:` — plus, named explicitly, **every feature that was built on a `needs-review` foundation**, so the exposure is visible rather than merely absent), features `blocked` (each with its spec gap — suggest refining them and re-running), **how many review rounds each feature actually took** and how many features closed `notes-only`, how many features ran `easy`, how many escalated, and — under `easy` — the `would-escalate:` count against the feature count — the two together are what tell you whether the bar is set right, the branch name, and any suggestions the subagents surfaced — do not add those to the roadmap and do not fix them. The round counts are the cheapest quality signal the run produces and they are already written down; a batch where most features needed every round is telling you something about the plans, not about the reviewer.

   If any checks are outstanding, close with the checklist pointer — this is the whole point of writing them down:

   ```
   🔧 3 manual checks waiting — docs/ristretto/manual-checks.md
      run them, tick the boxes, then /ristretto:brew again to verify what was pending.
   ```

   **Tasting note — reward the specs, honestly:** if every eligible feature brewed with zero blocks *and* the full suite is green, lead the report with `☕ perfectly dialed in — every spec held end to end.` That's the payoff for doing refinement properly; never print it when anything blocked or the final suite is red. Outstanding manual checks don't disqualify it — the specs did hold; a human just has a key to turn.
4. If the roadmap is now fully `done`, end with the milestone cup:

   ```
      ) )  ( (
   .__________.
   |          |]
   |          |
   `----------'
   ALL BREWED — roadmap clear ☕
   ```

   Otherwise end with the little cup and `☕ pot empty — N blocked feature(s) waiting on you.` (Count only `blocked` there; `needs-human` gets its own 🔧 line and `needs-review` its own 👀 line — three queues with three different remedies, and merging them is what made this confusing in the first place. Refine a `blocked`, run a `needs-human`, judge a `needs-review`.)

## Hard rules

- **Always name the model when dispatching.** Planner and reviewer: capable. Implementer: cheap when the build plan contains the code to write (that work is transcription plus testing); standard when it spans several files. An omitted model silently inherits the session's, defeating this. On an `easy` feature there is no build plan at all, so the implementer plans and builds in one pass — give it the **capable** model. This is the same rule, not an exception to it: the model tracks how much thinking the build plan already did, and here it did none.
- **Orchestrator stays out of the code — with one narrow lane.** You never implement, read source, or inspect diffs yourself; that's what the subagents are for, and it's what keeps your context small enough to survive a long batch.

  The lane: when a reviewer's finding **states the exact fix** and it is a one-or-two-line change in a single file, you may apply it directly instead of paying a fixer round-trip. You are not reading the code to decide *what* to do — the reviewer already decided; you are typing what it dictated. Anything larger, anything spanning files, or anything where you'd have to read around the change to understand it: dispatch the fixer. Applying it still requires green gates before the closer runs, and **say in the report which findings you applied yourself** — the point of the review being independent is lost if nobody can see where that independence stopped.

  If a subagent fails oddly, that is not this lane: handle it by loop step 7 — one retry, then `blocked` — and move on. Never debug a subagent's mess in the main context.
- **No product decisions.** Ambiguity → `blocked` → next. A wrong guess costs more than a skipped feature.
- **Never stop to ask the user anything.** Not once, for any reason. `planned` means `prep` already resolved every decision the feature needs — so a question arising here is a prep bug, and the answer is `blocked` with the missing decision named, not a prompt into an empty room. You were started because nobody is watching; a run that pauses for input has failed at the one thing it exists to do. **Go as far as you possibly can, every time.**
- **A subagent that dies is not the user changing their mind.** The single most convincing way this loop breaks is a dispatch that comes back empty and *reads* as an interruption — so you conclude the user is steering, and stopping for a user who is steering is correct behaviour. It is the right rule fired on a false premise, and it ends the run just as dead as breaking a rule would. You cannot distinguish the two, so never infer intent from a dead subagent, and never build a theory out of two of them. Loop step 6 says what to do instead; it is not a judgement call.
- **A missing decision blocks; a thing you cannot reach does not.** `blocked` is for spec gaps only. A criterion whose subject this repo gives you **no path to** becomes a line in `manual-checks.md` and a `needs-human` close — the code still gets built, and the features behind it still get brewed. Stalling a whole flight on one `alter table` is the failure mode this replaced.
- **But reach is the whole test, and the default answer is that you have it.** `needs-human` is not for work that is awkward, slow, or unautomated — only for work with no path from this repo. A migration the dev stack applies, a screen a driver can press, a fixture the harness can seed: all `[auto]`, all yours. **Nothing about production is ever a check.** Every false check is an item the user must read, evaluate and dismiss by hand, and a list that fills with them is one they stop reading — which costs exactly the entry that was real. Over-checking has no cost the loop can see and a large one it cannot; when genuinely unsure, write the test.
- **Gates are infrastructure, not suggestions.** A red gate means the work is not done — and if it can't be made green honestly, the feature is `blocked`, not "done with caveats". A gate that *hangs* is a third thing: unverified. Never treat a timeout as green.
- **Never push, never open a PR, never reset or rewrite existing commits.** Local and append-only; reviewing and pushing the session branch is the user's job.
- **`--amend` has exactly one legal use:** repairing the message of the commit *you just made*, when nothing has been committed since, and only your own. A mangled subject otherwise leaves a closer with no legal move, which is how a hard rule gets broken by someone doing the right thing. Disclose it in the final message — an amend nobody mentions is indistinguishable from history being quietly rewritten. Everything else stays forbidden: never amend a commit you didn't just create, never amend to change *content*, never amend after any other commit has landed.
