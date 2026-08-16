# ristretto

Lean feature implementation for Claude Code. A restricted shot: less ceremony, more concentration.

A small set of commands following the lifecycle **review → plan → build**, plus `tamp` to keep the built code lean. The two core ones split the way you actually work — plan a stack of features in one sitting, implement them later as the code shifts underneath:

- **`/ristretto:grind <feature>`** — honest refinement review: plain-language summary, story-point estimate, the problems it actually has, and a Ready / Not-Ready verdict. Read-only.
- **`/ristretto:prep <features | ideas> [deep]`** — turns features *or* raw ideas into plans and adds them to the project roadmap. Each plan carries a deep, durable **`## Contract`** (checkable acceptance criteria, `Provides:` / `Consumes:` at type level, resolved decisions, the units of work) and a one-screen **`## Approach`**. Splits an input into sub-features only when there's a real seam (independent deliverables, separate "done", or too big for one sprint) — otherwise keeps it whole. Features that belong together get a shared `Flight` slug, and a real prerequisite is recorded as `Depends:` so ordering is explicit. Fast by default; **escalates into grill mode** — one question at a time, each with a recommended answer, checkpointed to the plan file after every answer — the moment a criterion can't be made checkable or `Provides:` can't be filled. `deep` forces it. Planning only, no code.
- **`/ristretto:pull <feature | next>`** — implements one feature against the *current* code, in auto mode, then closes it by archiving the plan and updating the roadmap. A **planner** subagent first expands the Contract into a throwaway build plan against HEAD — real paths, real signatures, real test code — so the implementer transcribes rather than re-plans. Tests come first (the build plan's cases become failing tests, then code to green), and before any commit the diff passes an **independent review** by a fresh subagent — bugs must be fixed, two rounds max. Pass `raw` for an ungated spike (see below).
- **`/ristretto:brew`** — brew the whole pot: autonomously pulls every eligible planned feature in sequence — same gates, evidence, review, and close as `pull`, one commit per feature on a single `feature/brew-<date>` session branch. **Each feature runs through fresh subagents** — planner, implementer, independent reviewer, closer: the main conversation stays a small orchestrator no matter how big the batch, every implementation sees exactly one spec, and nothing is committed unreviewed. A planner that can't satisfy the Contract blocks the feature before an implementer ever runs. Anything needing a **decision** gets status `blocked` with a one-line reason instead of a guess; anything needing a **human to run something** gets `needs-ops`, a line in `manual-ops.md`, and still gets built — it never stalls the features behind it. You walk through `status blocked` and `status ops` afterward, refine or run, and re-brew. Tests are scoped to each feature during the loop and the full suite is proven once at the end, so a slow suite doesn't make a batch impossible. For when you've prepped a batch and don't want to babysit the roadmap.
- **`/ristretto:status [filter]`** — read-only view of the roadmap: what's planned, in progress, and done. Changes nothing.
- **`/ristretto:help`** — the menu: every command, the workflow, and the house rules as a CLI-style card. Read-only, instant.
- **`/ristretto:tamp [path | feature | nothing]`** — honest lean-code review: finds runtime waste, duplication, dead/over-built code, and readability drag in a diff or file, ranked and capped at the few that matter. Read-only; pass `fix` to apply the top findings. The code-analogue of `grind`.
- **`/ristretto:shot <feature>`** — prep + pull one small feature in a single pass, for trivial cases where the split is overkill. Same spec standard as `prep`, not a bypass lane: if it can't state checkable acceptance criteria **and a `Provides:`** on the spot, it stops and routes to `prep`. It expands the plan inline instead of dispatching a planner — one pass is the whole point.

## Why the plan splits in two

Most plan workflows bake exact file edits and literal code into the plan. That's fine if you execute immediately — but if you batch-plan ten features and implement them over days, the early plans rot, because the code moved out from under them.

The usual fix is to keep plans thin. That trades one problem for another: a one-screen plan omits the things that *don't* rot, and thin contracts are the single largest cause of inaccurate implementation. Drift kills turn-by-turn directions — exact paths, line numbers, literal code. It never touches an acceptance criterion, an interface signature, or a decision.

So ristretto puts depth in both places, at the moment each one is true:

- **`## Contract` — durable, written by `prep`, as deep as the feature deserves.** Checkable acceptance criteria, `Provides:` (the public surface this feature exposes, at type level), `Consumes:` (what it calls from its `Depends:`), the decisions that were resolved, and the units of work inside it. Still zero code, so still drift-free — a signature is a contract, it names what exists, never how it works.
- **`## Approach` — the part that rots, so it stays to one screen.** Strategy and likely touchpoints, for orientation only.
- **The build plan — generated at pull time, then thrown away.** `pull` and `brew` dispatch a **planner** subagent that reads the Contract, takes each dependency's `Provides:` as fact, reads the code as it exists right now, and writes `.ristretto/build/<FEATURE-ID>.md`: real file paths, real names and signatures, real test code in this repo's style. The implementer transcribes it instead of re-planning. It lives in `.ristretto/` (gitignored) and is deleted at close — it cannot rot because it doesn't live long enough to, and it's reproducible from (plan + HEAD) anyway.

A planner that can't satisfy the Contract against the current code returns `blocked` and **no implementer ever runs** — the cheapest place for a bad spec to fail. Same drift-resistance as before, none of the thinness.

`prep` stays fast by default so you can batch-plan ten ideas in one sitting. It escalates into **grill mode** — one question at a time, each with a recommended answer, written to the plan file after every answer — exactly when it can't write a checkable criterion or can't fill `Provides:`. Force it with `/ristretto:prep <feature> deep`.

## The roadmap solves drift

State lives in files, not the conversation — clearing the chat never loses it.

- `roadmap.md` is the fast-read index; `pull` boots from it instead of re-scanning the repo.
- **`Provides:` / `Consumes:` close type drift across a Flight** — when B depends on A, B's `Consumes:` must be a subset of A's `Provides:`; `prep` checks it, and at close `pull` corrects `Provides:` in the archived plan to whatever was actually built, because that's what the next feature's planner reads as fact.
- **Flight grouping + `Depends:` give honest ordering without a scheduler** — `/ristretto:pull next` skips any feature still waiting on an unfinished prerequisite, so you can't pull work whose foundation isn't built yet. A prerequisite counts as finished when it's `done` **or** `needs-ops`; only `blocked` holds dependents back. ristretto stays one-feature-at-a-time; the graph is recorded, not run as parallel waves.
- **Closing is `pull`'s job, every time** — it archives the plan and flips the roadmap row automatically. You never close by hand, so "forgot to close" can't happen.
- The roadmap is trusted as written. Keeping it honest is yours — but since closing is automatic, it stays honest with almost no effort, and it doubles as a plain-language view of what's done and what's next.

## Deterministic gates, not vibes

`pull` and `shot` don't self-report "tests pass" — the plugin ships hooks that enforce it:

- On the first pull in a repo, a `.ristretto.json` is created at the root with the repo's own `format` / `lint` / `typecheck` / `test` / `testChanged` commands (stack auto-detected; existing tooling adopted, never replaced). Commit it.
- While a pull is active (marker file `.ristretto/pulling`), a **Stop hook** (and a **SubagentStop hook**, so each of brew's per-feature subagents is gated individually) runs lint + typecheck + test and blocks the agent (exit 2) until they're green. Red gate = not done — the agent can't rationalize past it, and it's instructed never to weaken or delete gates or tests to get there. After 3 forced retries it surfaces the failure to you instead of looping.
- **A hang is caught by silence, not by a stopwatch — and a hang is not a red gate.** A suite that never returns used to take the whole session with it: `execSync` had no timeout at all, so the hook was eventually killed with nothing to report, and the next stop hit the same wall. The obvious fix — cap total runtime — is the wrong one, because it can't tell a wedged suite from a slow one and murders the slow one at an arbitrary number. So the gate watches the *output stream* instead: a gate that has printed nothing for its `silence` budget is hung and gets killed (along with its whole process group, so forked workers don't survive holding the port that caused it); a gate that keeps printing is working and is left alone however long it takes. A hard duration cap still exists as `timeouts`, but it's **off by default**. A hang is reported as *unverified* — neither failed nor green — and **surfaced immediately rather than retried**, since retrying a hang only hangs again.

  Defaults are per gate, in seconds: `lint` and `typecheck` get 600 because tools like `eslint .` and `tsc --noEmit` legitimately print nothing until they finish, so their silence carries no information; test runners stream progress, so 300 of silence from one is a much stronger signal.
- **The pre-flight and the hook must run the same toolchain, and now they can prove it.** The hooks run in their own environment and don't inherit a PATH you exported in your shell — so a pre-flight run with a workaround SDK prepended proves a green tree the hook will never reproduce, and the hook's red looks like a repo problem rather than two installs of the same tool. `verify` prints and records which binary each gate resolved to; when a hook resolves a different one it names the mismatch instead of surfacing a mystery failure on an untouched tree. The fix is still to not let them differ: put the intended path *inside* `.ristretto.json` rather than around the command.
- A **PostToolUse hook** formats each touched file as the agent writes — a convenience that never blocks.
- Outside a pull, the hooks exit immediately: no nagging in casual sessions, and repos without a `.ristretto.json` are never touched.
- **Tests come first, red first**: acceptance criteria are transcribed into tests *before* implementation, and the failing run is the proof the tests test something. A test that passes before any code is written proves nothing.
- **An independent review gates every commit**: after the gates are green, a fresh subagent that never saw the implementation reasoning judges the diff — `bug` findings (a criterion not actually met, edge cases, dishonest tests) must be fixed, `lean` findings (tamp's facets) unless riskier than the win. Two rounds in `pull` and `shot`, then it surfaces instead of looping. `brew` gets a third: bugs still open after round 2 go to a **fresh implementer on a model one tier up**, given the plan, the findings, and the diff — not the failed attempts — then one final scoped re-review. Still open means `blocked`, not "done with caveats". Trivial diffs (a few lines, no new logic) skip the review.
- Closing a feature also records **Evidence** in the archived plan: how each acceptance criterion was proven — red→green test names, output, measurements — plus the gate summary and the review verdict. "Implemented successfully" is not evidence.

The gate runner is plain Node (`scripts/gate.js`) — no bash, no jq — so it works the same on Windows, macOS, and Linux. It fingerprints a green working tree and skips re-running gates while the tree is unchanged, so review/close subagents don't pay a full test run at every stop. Check it with `node scripts/gate.test.js`.

## Fast loop, honest end

On a repo whose suite takes ten minutes, gating every subagent stop on the full suite doesn't make a batch slow — it makes it impossible. So the test gate has two speeds:

- **During the loop: `gates.testChanged`** — only the tests affected by what this feature touched. `{files}` is substituted with every modified *and untracked* path: `vitest related --run {files}`, `jest --findRelatedTests {files}`, `pytest {files}`. Prefer that over a runner's own change detection (`vitest --changed`, `jest -o`) — those read git's diff, which excludes untracked files, and a brand-new test file is exactly what red-first produces. Lint and typecheck stay repo-wide; they're cheap next to a suite, and a scoped typecheck is a contradiction in terms.
- **Once at the end: `node scripts/gate.js verify`** — lint + typecheck + the *whole* suite, ignoring both the scoped shortcut and the green-tree cache. `brew` runs it twice: as pre-flight (a red tree is the cheapest possible failure, and it's caught before a single subagent is dispatched) and after the last feature closes.

That trade is explicit: scoped runs can't see cross-feature breakage, so the end-of-batch run is where it shows up. When it goes red, `brew` reports it loudly and first — and does **not** amend or revert the commits. Nothing was pushed, the branch is yours to review, and a fast batch with one honest red beats a batch too slow to finish. What isn't acceptable is a quiet one.

If `testChanged` is empty, the loop just runs the full suite as before — nothing changes for repos where that's already fast, and that's the right setting until a suite is slow enough to hurt.

## Manual ops: things a coding agent can't do

Some steps aren't code. Running SQL against a live database, applying a migration, setting a secret, enabling an API in someone's console — an agent cannot do any of it, and a plan that needs one used to collapse into `blocked`, which is the wrong word. `blocked` means *the spec is broken, go refine it*. "Run this migration" is not a spec gap; the spec is fine and a human just has to turn a key. Same status, opposite remedy — so they're now two statuses:

- **`blocked`** — a missing decision. `/ristretto:status blocked` is the refinement queue; fix it with `prep`.
- **`needs-ops`** — a missing keystroke. `/ristretto:status ops` is the do-it-yourself queue; fix it with your hands.

`prep` declares known ops in the Contract's `Manual-Ops:`, and the **planner discovers the rest against HEAD** — it reads the code and sees that the column the Contract needs isn't in the schema. Either way the op lands in `docs/ristretto/manual-ops.md` as a ticked-by-you checklist item with the exact command:

```markdown
## BREW-224 — user tiers
- [ ] **before** · Supabase SQL editor (dev) · add the column the code reads
      ```sql
      alter table profiles add column tier text not null default 'free';
      ```
      _blocks:_ criterion 2 ("a free user sees the upgrade banner") · _test:_ `tier banner renders`
```

**The feature still gets built.** The code is written, gated, reviewed, and committed exactly as always; only the tests that need the live environment are written *skipped*, each naming the op that unblocks it. `needs-ops` is a **closing** status, not a blocking one — the plan is archived, the commit is made, and the row records which criteria are `pending ops` instead of proven.

The part that matters for an unattended `brew`: **`needs-ops` never holds up another feature.** A `Depends:` is satisfied by `done` *or* `needs-ops`, because the prerequisite's `Provides:` exist in the code either way — what's outstanding is in a database console, not in the repo. Only `blocked` stops dependents. One pending `alter table` can't stall a whole flight.

Run the op, tick the box, and `/ristretto:pull <ID>` (or the next `brew`) un-skips those tests, proves the pending criteria, and flips the row to `done`. Ops marked `after` — backfills, prod flags, key rotations — don't hold anything up at all: the feature closes `done` and the op stays on the list as a deploy step. ristretto never ticks a box itself; that check is your signature that it really happened.

## `raw`: the ungated lane

The gates are why the output compiles, so they aren't optional on real work. But spikes exist. `/ristretto:pull <ID> raw` executes the plan and nothing else — no gates armed, no planner subagent, no red-first, no review — for prototypes and throwaway branches where the ceremony costs more than it returns.

The one rule is honesty: raw work is **labelled raw, permanently**. The Evidence records `gates: skipped (raw)` and `review: skipped (raw)`, and the roadmap row is tagged `raw`. Months later you can still tell which commits nothing ever checked — an ungated lane that looks gated on the roadmap would be worse than having no fast lane at all.

## Git: branch & commit, never push

`pull`, `shot`, and `brew` handle git for you, with one firm boundary — **they never push.**

- `pull` and `shot` work on a `feature/<FEATURE-ID>` branch (created from a clean tree, or your current feature branch is reused); `brew` puts the whole session on one `feature/brew-<date>` branch, one commit per feature, so you review the batch linearly.
- At close they stage only the files touched and commit `feat(<FEATURE-ID>): …`, then write the real hash into the roadmap row.
- Committing locally is reversible; pushing is the one team-visible, irreversible step — so that stays with you. They never push, set an upstream, force, amend, reset, or open a PR.
- Pass `nocommit` to skip the commit and leave the changes in your working tree: `/ristretto:pull BREW-224 nocommit`.

## Flavor

The coffee metaphor carries real signal, not just decoration — and nothing animated sits in the work path, so there's no latency cost:

- `grind` signs off with a **tasting note** that mirrors the verdict (Ready → "clean extraction"; Not Ready → "under-extracted").
- `status` leads with a **brew gauge** — `☕ [█████░░░░░] 5/10 brewed` — and shows a full **milestone cup** when the roadmap clears.
- `tamp` closes with a **tasting note** mirroring its verdict — `clean shot` (nothing channeling) or `channeling` (real waste found).
- `pull` and `shot` end with a little cup when a feature lands, and the milestone cup when it was the last one.
- `brew` prints a `☕ <ID> brewed (n/m)` line per feature, and closes with the milestone cup when the roadmap clears — invoked with nothing to brew, it just prints the classic cup and a barista quip (the original easter egg lives on).

## Layout it generates (per project)

```
.ristretto.json         # gate commands + hang budgets for this repo (committed)
.ristretto/             # transient pull state — marker, retry counter, green cache (gitignored)
  build/
    BREW-224.md         # throwaway build plan, written at pull time, deleted at close
docs/ristretto/
  roadmap.md            # always-current index of every feature
  manual-ops.md         # the SQL, migrations & secrets only you can run — tick a box when done
  plans/
    BREW-224.md         # active plans — durable ## Contract + one-screen ## Approach
    archived/
      BREW-202.md       # closed → moved here, with Evidence and a corrected Provides:
```

## Install (local, no GitHub needed)

```
/plugin marketplace add /path/to/ristretto
/plugin install ristretto@ristretto-dev
```

To share with the team, push this folder to a Git repo and `/plugin marketplace add <user>/<repo>` instead.

## Usage

```
/ristretto:grind BREW-224                     # honest review before committing to it
/ristretto:prep BREW-224 BREW-210 ROAST-150  # plan a batch of features
/ristretto:prep add rate-limiting to login   # plan a raw idea (→ login-rate-limit plan)
/ristretto:prep BREW-224 deep                 # force grill mode — one question at a time
/ristretto:pull BREW-224                      # implement one (branch + commit)
/ristretto:pull BREW-224 nocommit             # implement, but leave the commit to you
/ristretto:pull BREW-224 raw                  # ungated spike — no gates, no review
/ristretto:pull next                          # implement the top planned feature
/ristretto:brew                              # brew every eligible feature, unattended
/ristretto:status                             # see the whole roadmap
/ristretto:status open                        # only what's not done yet
/ristretto:status blocked                     # the refinement queue after a brew
/ristretto:status ops                         # the do-it-yourself queue: SQL, migrations
/ristretto:shot ROAST-150 rename the menu item # plan + do a trivial one in one pass
/ristretto:tamp                               # review the changes I just made
/ristretto:tamp src/auth                      # green-up pass on existing code
/ristretto:tamp BREW-224 fix                  # review a feature's diff and apply the top fixes
/ristretto:help                              # the menu — commands, workflow, house rules
```

Runs entirely in auto mode — no plan-mode switching.
