---
description: Brew the whole pot — autonomously pull every eligible planned feature from the roadmap in sequence, each planned and built by fresh subagents, gated by hooks, on a single session branch. Skips to `blocked` instead of guessing. Runs until nothing is left to brew.
---

You are running **BREW** — an autonomous loop over the roadmap. The user batch-planned with `prep` and walked away; all judgment is front-loaded into the plans. You make **zero product decisions**: acceptance criteria define "done", the deterministic gates decide when a feature may close, and anything undecidable becomes `blocked` — never a guess.

**You are the orchestrator, not the implementer.** Each feature runs through fresh subagents — a planner, an implementer, an independent reviewer, and a closer; your context holds only bookkeeping and one-line results. Do not read the codebase, the plans, or any diffs yourself — a large batch must not grow the main conversation. Each subagent starts clean, sees exactly one job, and dies with all its noise; the reviewer's fresh context is also what makes the review independent — it never saw the implementer's reasoning.

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

   plus one short barista quip, and — if features exist but all are blocked — a line naming what's blocked and why. If any row is `needs-human` with unticked boxes, name those too, separately: they aren't waiting on refinement, they're waiting on you to run or look at something.
3. **Pre-flight — the repo must already be green.** Work `.ristretto.json` exactly as in `pull` step 3: create it if missing, complete it if it predates a key, and — if the suite is slower than a minute — **set `testChanged`**, which is what keeps the loop's per-subagent gate from re-running the whole suite dozens of times. An existing config is not a finished one; a `testChanged` that quietly dropped a flag the full `test` gate carries makes the loop's fast path slower than the suite it replaced, and the pre-flight below is where that gets named. Fix it here, before the loop — this is the last moment it costs nothing. Then prove the tree once, before arming anything:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.js" verify cached
   ```

   `cached` returns the stored verdict when the tree is byte-identical to one already proven green, and runs the full suite otherwise. On a repo whose suite takes ten minutes this is the difference between resuming a brew and re-paying for it: a session that restarts before the first feature would otherwise spend the whole cost again to re-prove a tree nobody touched. It is not a weaker check — an unchanged tree cannot have a different verdict, and if the toolchain resolves differently the cached verdict is discarded and the suite runs for real.

   **Run it exactly like that — bare.** Do not prepend to PATH, do not substitute a different toolchain, do not run the underlying test command yourself "to check". The hooks inherit none of that, so any environment you add makes this pre-flight prove a tree the hooks will never reproduce, and the first subagent goes red on code nobody touched. If a specific toolchain is required, it belongs *inside* `.ristretto.json`, not around the command. (`verify` prints and records the binary each gate resolved; a hook that resolves a different one will name the mismatch rather than blaming the repo.)

   Exit 0 → carry on. Exit 1 → stop immediately:

   ```
   ⛔ ristretto: repo is not green — nothing brewed.
      <gate>: <the failure, one line>
      fix this first; brew won't build on a red tree.
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

6. **One branch for the whole session.** Require a clean working tree — if dirty, stop and ask; never brew over uncommitted work. Create and switch to `feature/brew-<YYYY-MM-DD>` (reuse it if you're already on it). Every feature lands here as its own commit. Never push, never set an upstream.

## The loop

A feature is **eligible** when its status is `planned`, all its `Depends:` are satisfied, and its `Blockers:` is `—`.

**A `Depends:` is satisfied by `done` or `needs-human`.** A prerequisite waiting on a manual check has its code built, committed, and its `Provides:` present — the outstanding step is in someone's database console, not in the repo. Treating it as unfinished would stall an entire flight behind one `alter table`, which is precisely the failure this status exists to prevent. Only `blocked` — a genuine spec gap, where the prerequisite's code was never written — holds dependents back.

Also re-check manual checks each pass: a `needs-human` row whose `proves` checks are now all ticked `- [x]` in `docs/ristretto/manual-checks.md` is eligible as a **check re-run** — dispatch a closer to prove its pending criteria and flip it to `done`, no planner or implementer needed.

While an eligible feature exists:

1. **Pick** the topmost eligible feature (re-read the roadmap each iteration — subagents update it).
2. **Dispatch the planner** (fresh context, capable model) — **before** any implementer runs. The plan holds the destination; this writes the directions, now, against HEAD, so they cannot be stale. Use the planner brief from `pull` step 5 verbatim, filling in the ID: read the plan (`## Contract` binding, `## Approach` possibly stale), take each dependency's `Provides:` as fact, read the current code, write `.ristretto/build/<FEATURE-ID>.md` with real paths, signatures, and test code, no placeholders — and record any **manual check** it finds against HEAD, with the exact command and the criteria that wait on it. Then write those checks into `docs/ristretto/manual-checks.md` in the format `pull` defines.

   On `blocked:`, set the roadmap row to `blocked` with that reason and move to the next feature — **no implementer ever runs**. This is the cheap failure, and it is where you want failures to happen. A manual check is never a `blocked:` — the feature still gets built.

3. **Dispatch the implementer** (fresh context, general-purpose) — **one feature at a time, never in parallel**: subagents share one branch and one repo-wide gate. Give it this brief verbatim, filling in the ID:

   > You are implementing exactly one ristretto feature: **<FEATURE-ID>**. Work autonomously; you cannot ask the user anything.
   >
   > 1. Read `.ristretto/build/<FEATURE-ID>.md` — your plan, written against the current code minutes ago. `docs/ristretto/plans/<FEATURE-ID>.md`'s `## Contract` is the acceptance contract behind it. Implement the plan; do not re-plan.
   > 2. **Tests first, red first**: where the stack has a test gate, the build plan's test cases become tests before implementing — they are already transcriptions of the acceptance criteria; do not re-derive them — and run them to confirm they fail. A test that passes before implementation proves nothing. Tests the build plan marks as waiting on a **manual check** are the exception: write them skipped, each naming the check that unblocks it. They can't go red honestly — the environment they need doesn't exist yet.
   > 3. Implement the build plan against the current code, lean the first time: its file paths, names, and signatures; reuse before writing, smallest diff that meets the criteria, no scaffolding nothing needs yet. Done when the red tests pass.
   > 4. Read the repo's house rules — `CLAUDE.md` / `AGENTS.md`, including any nested one near the files you touch. They bind you even where the surrounding code doesn't demonstrate them yet. Never write to those files.
   > 5. Verify: run the gates (`.ristretto.json`); fix until green. A SubagentStop gate will also verify you independently — never weaken, skip, or delete gates or tests to get green. **Never sit in one silent command for more than about five minutes.** You are killed if you go quiet for ten, and being killed is the worst of all endings: your result is lost entirely, so the orchestrator gets no answer rather than a failure it could act on, and everything you built is stranded unproven in the tree. So for anything that might run long — a full suite, a slow build, a run that queues behind the repo-wide gate lock — **start it in the background and poll it to completion**, checking every 30–60 seconds. Each check is a sign of life, and the wait costs nothing extra.
   >
   >    **Never end a turn with a run still in flight.** That is the whole of it, and it is the half of this rule that gets dropped: backgrounding a gate and then ending your turn is not "running the gates in the background", it is not running them at all — you die, the run is orphaned or finishes for nobody, and your result is lost exactly as if you had been killed. Background *and* poll, or run it in the foreground; there is no third option where you start something and leave. A gate you did not watch finish is not a gate you passed. Short gates (lint, typecheck, a scoped test run) can simply run in the foreground. If a run seems to hang at the start it is most likely queued — only one gate run executes at a time repo-wide, and it now says so out loud when it is waiting.
   > 6. **Do NOT commit, archive, or touch the roadmap** — an independent review happens after you.
   > 7. **Skip, never guess.** If you hit a real product decision the plan doesn't make, a missing contract, a blocker prep didn't see, or gates you cannot get green honestly: `git restore` every file you touched (leave the tree clean), set the roadmap row to `blocked` with a one-line reason **phrased as the spec gap** — what the plan failed to decide, not what the code couldn't do ("acceptance criterion 'fast' isn't measurable — needs a number") — and stop there.
   > 8. **A manual check is not a block, and never a `git restore`.** If a criterion can only be proven once a human runs something (SQL, a migration, a secret, a console switch) **or looks at something no test can judge** (a layout, a visual state, copy in another language), the code still gets written and the gates still go green — you skip the test that needs the live environment and keep going. Make sure the check is in `docs/ristretto/manual-checks.md`, naming the criterion it proves and the exact command or thing to look at, and report it. Never tick a box there.
   > 9. No scope creep: don't fix adjacent problems; mention them in your final message as suggestions.
   >
   > Your final message must be exactly one of:
   > `ready: <FEATURE-ID> — <files touched> — <red→green test names, or how criteria were proven>`
   > `needs-human: <FEATURE-ID> — <files touched> — <criteria proven> — pending: <the check, one line>`
   > `blocked: <FEATURE-ID> — <spec gap>`
   > followed by at most 3 short lines. Nothing else — your full reasoning dies with you; only this summary survives.

   A `needs-human:` result continues exactly like `ready:` — review, then close. The only difference is the status the closer writes.

4. **Dispatch the reviewer** (fresh subagent, capable model) on a `ready:` or `needs-human:` result — unless the diff is trivial (roughly < 15 changed lines and no new functions/branches/loops; when in doubt, review). Use the review brief from `pull` verbatim: read the plan, the repo's `CLAUDE.md` / `AGENTS.md` if present, and the feature's diff, change no files and run no gates, two lenses in priority order — `bug` (criterion not actually satisfied, a documented house rule the diff violates, a `[human]` criterion silently treated as proven, unhandled edge cases on changed paths, logic errors gates can't catch, tests that don't honestly restate a criterion) and `lean` (runtime waste, duplication vs existing repo utilities, dead/over-built, readability). At most 7 one-line findings (`bug|lean · file:line · what · fix`), bugs first; nothing material → exactly `review: clean`.

5. **Act on the verdict** — capped at 3 rounds:
   - `review: clean` → dispatch the **closer**.
   - Findings → dispatch a **fixer** subagent: "Fix these review findings for <FEATURE-ID>: every `bug` is mandatory, `lean` unless riskier than the win. Gates green. Do not commit or close. Final message: `fixed: <FEATURE-ID> — <what was fixed / left>`." Then a fresh reviewer verifies (round 2) — prior findings and any defect the fixes introduced, no new lean fronts. Clean → closer.
   - **Round 3 — escalate before you give up.** Bugs still open after round 2: dispatch a **fresh** implementer on a model one tier above the one that got stuck, given the plan, the open findings, and the diff — not the failed attempts. Then one final scoped re-review. Still open → `git restore` the touched files, set the row to `blocked` with the defect as the one-line reason (e.g. `review: criterion 2 unmet after 3 rounds — <what>`), and move on. Three rounds, then stop: still bounded, still never stuck.
   - **Round 2 may be scoped down, never skipped.** When the fixer changed only what the findings named and the gates are green, round 2 can be a *confirmation* pass — verify those findings and any defect the fixes introduced, nothing else — which is a two-minute subagent, not a full review. What it must never become is nothing at all. A fix is code no reviewer has ever seen; the whole reason round 2 exists is that fixing one thing is exactly when you break another, and "the evidence looked strong" is the feeling that precedes every regression. If you are tempted to skip it to save time, the honest read is that something else in the run is too slow — scope the tests, not the review.
   - **Closer** brief: "Close ristretto feature <FEATURE-ID>: commit `feat(<FEATURE-ID>): <summary>` staging only the touched files (never `git add -A`) — keep the subject plain ASCII, since a shell re-interprets backticks, `@`, `$`, `!` and quotes; if the summary truly needs them, write the message to a file and use `git commit -F <path>` (never a heredoc), and never repair a mangled subject with `--amend`; in the plan, correct `Provides:` to whatever was actually built, append `## Evidence` — how each criterion was proven (red→green test names, output, measurements), a gate summary, and the review verdict — and move it to `docs/ristretto/plans/archived/`; delete `.ristretto/build/<FEATURE-ID>.md`; flip the roadmap row to `done` with today's date, files touched, and the commit hash. A criterion that can only be proven after a manual check is recorded as `pending human: <the check>`, never as proven, and the row's status is **`needs-human`** instead of `done` — the plan is still archived, the commit still made. Features with only `deploy` checks close as `done`. Never push, never amend or reset, no PRs. Final message: `brewed: <FEATURE-ID> <commit-hash> — <one-line summary>` or `brewed-needs-human: <FEATURE-ID> <commit-hash> — pending: <check>`."
   - **Check re-run** (a `needs-human` row whose `proves` checks are now all ticked): no planner, no implementer. Dispatch a closer to un-skip the tests that named those checks, run them, and — if they pass — replace the `pending human check` lines in the archived plan's Evidence with real proof and flip the row to `done`. If they fail, the check did not do what the plan assumed: set the row to `blocked` with that as the reason.

6. **When a subagent comes back with nothing.** Any dispatch can die: killed for going silent too long, ended by a transport error, or returning something in none of the shapes its brief allows. **This is never the user, and never a reason to ask them anything.**

   From where you sit a killed subagent and a user interrupt are indistinguishable — the same shape arrives either way, and you cannot tell them apart. So do not try. Treat both as what you can actually verify: a subagent that produced no usable result. That is a failure of that subagent, handled here, now, by you. If the user really did interrupt, they are awake and will say so; the one thing that helps nobody is stopping to ask an empty room, which is exactly what "it looks like you interrupted me" turns into at three in the morning.

   1. Run `git status --short`. That is the only evidence of what it managed before it died.
   2. **Clean tree** → dispatch the same brief again, once, fresh context. Something that died before touching anything costs nothing to retry.
   3. **Dirty tree** → the work is unproven: no gate ran on it, no reviewer saw it, and its own author never got to say whether it was finished. Dispatch **one** fresh subagent with the same brief plus: *"a previous attempt died and left partial work in the tree. Reconcile it against the build plan and finish the feature. Verify all of it as if you had written it yourself — nothing here has been proven."*
   4. **A second death on the same feature ends it.** `git restore` the tracked files it changed, delete the untracked files it created (`git status --short` lists both, and the tree was clean when the feature started, so everything dirty is its doing), set the row to `blocked` — reason: `implementation aborted twice — no verifiable result` — and **move to the next feature**. Never a third attempt. Never a question.

   Print `⛔ <FEATURE-ID> blocked — subagent died twice` so the trail reads honestly afterwards. If subagents keep dying across *different* features, that is an environment problem rather than a feature problem: finish the loop anyway, and name it in the final report. Diagnosing it is not this run's job.

7. **Record the result** — each subagent's one-liner is all you keep. Print `☕ <FEATURE-ID> brewed (n/m)`, `🔧 <FEATURE-ID> brewed, needs a human check — <check>`, or `⛔ <FEATURE-ID> blocked — <reason>` between features so the trail is readable.
8. **Hygiene check** (cheap, no reading): `git status --short` must be clean before the next feature's planner is dispatched. If a subagent died mid-work and left changes, `git restore` them and set that row to `blocked` (reason: "implementation aborted mid-work — re-brew or refine"). Delete any leftover `.ristretto/build/<FEATURE-ID>.md` for a feature that blocked.
9. Next eligible feature.

## When you stop — for any reason

**This section is not "after a successful loop". It runs whenever this command stops running**, and the abnormal endings are the ones it exists for: the pot is empty, or a feature blocked, or something died, or you believe you were interrupted, or you are simply out of room to continue. "The loop didn't finish" is the reason to do this, never a reason to skip it. A brew that ends without it leaves the next session a repo it will misread — armed markers, a stranded tree — and that has now happened more than once.

**Before you write a single word of the report, run `git status --short`, and describe only what it printed.** Never state what is or isn't in the tree from memory of what you dispatched: a subagent that died still wrote files, and "nothing is stranded" is a claim that has been wrong exactly when it mattered most. If it is dirty, that is loop step 6 — handle it there, then report what you did.

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
3. **Report:** the full-suite verdict, features brewed (with commit hashes), features `needs-human` (each with its check), features `blocked` (each with its spec gap — suggest refining them and re-running), the branch name, and any suggestions the subagents surfaced — do not add those to the roadmap and do not fix them.

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

   Otherwise end with the little cup and `☕ pot empty — N blocked feature(s) waiting on you.` (Count only `blocked` there; `needs-human` gets its own 🔧 line — they are different queues with different remedies, and merging them is what made this confusing in the first place.)

## Hard rules

- **Always name the model when dispatching.** Planner and reviewer: capable. Implementer: cheap when the build plan contains the code to write (that work is transcription plus testing); standard when it spans several files. An omitted model silently inherits the session's, defeating this.
- **Orchestrator stays out of the code — with one narrow lane.** You never implement, read source, or inspect diffs yourself; that's what the subagents are for, and it's what keeps your context small enough to survive a long batch.

  The lane: when a reviewer's finding **states the exact fix** and it is a one-or-two-line change in a single file, you may apply it directly instead of paying a fixer round-trip. You are not reading the code to decide *what* to do — the reviewer already decided; you are typing what it dictated. Anything larger, anything spanning files, or anything where you'd have to read around the change to understand it: dispatch the fixer. Applying it still requires green gates before the closer runs, and **say in the report which findings you applied yourself** — the point of the review being independent is lost if nobody can see where that independence stopped.

  If a subagent fails oddly, that is not this lane: handle it by loop step 6 — one retry, then `blocked` — and move on. Never debug a subagent's mess in the main context.
- **No product decisions.** Ambiguity → `blocked` → next. A wrong guess costs more than a skipped feature.
- **Never stop to ask the user anything.** Not once, for any reason. `planned` means `prep` already resolved every decision the feature needs — so a question arising here is a prep bug, and the answer is `blocked` with the missing decision named, not a prompt into an empty room. You were started because nobody is watching; a run that pauses for input has failed at the one thing it exists to do. **Go as far as you possibly can, every time.**
- **A subagent that dies is not the user changing their mind.** The single most convincing way this loop breaks is a dispatch that comes back empty and *reads* as an interruption — so you conclude the user is steering, and stopping for a user who is steering is correct behaviour. It is the right rule fired on a false premise, and it ends the run just as dead as breaking a rule would. You cannot distinguish the two, so never infer intent from a dead subagent, and never build a theory out of two of them. Loop step 6 says what to do instead; it is not a judgement call.
- **A missing decision blocks; a missing keystroke does not.** `blocked` is for spec gaps only. Anything a human simply has to *run or look at* becomes a line in `manual-checks.md` and a `needs-human` close — the code still gets built, and the features behind it still get brewed. Stalling a whole flight on one `alter table`, or on a UI criterion nobody automated could judge, is the failure mode this replaced.
- **Gates are infrastructure, not suggestions.** A red gate means the work is not done — and if it can't be made green honestly, the feature is `blocked`, not "done with caveats". A gate that *hangs* is a third thing: unverified. Never treat a timeout as green.
- **Never push, never open a PR, never reset or rewrite existing commits.** Local and append-only; reviewing and pushing the session branch is the user's job.
- **`--amend` has exactly one legal use:** repairing the message of the commit *you just made*, when nothing has been committed since, and only your own. A mangled subject otherwise leaves a closer with no legal move, which is how a hard rule gets broken by someone doing the right thing. Disclose it in the final message — an amend nobody mentions is indistinguishable from history being quietly rewritten. Everything else stays forbidden: never amend a commit you didn't just create, never amend to change *content*, never amend after any other commit has landed.
