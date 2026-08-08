# ristretto

Lean feature implementation for Claude Code. A restricted shot: less ceremony, more concentration.

A small set of commands following the lifecycle **review → plan → build**, plus `tamp` to keep the built code lean. The two core ones split the way you actually work — plan a stack of features in one sitting, implement them later as the code shifts underneath:

- **`/ristretto:grind <feature>`** — honest refinement review: plain-language summary, story-point estimate, the problems it actually has, and a Ready / Not-Ready verdict. Read-only.
- **`/ristretto:prep <features | ideas> [deep]`** — turns features *or* raw ideas into plans and adds them to the project roadmap. Each plan carries a deep, durable **`## Contract`** (checkable acceptance criteria, `Provides:` / `Consumes:` at type level, resolved decisions, the seams of work) and a one-screen **`## Approach`**. Splits an input into sub-features only when there's a real seam (independent deliverables, separate "done", or too big for one sprint) — otherwise keeps it whole. Features that belong together get a shared `Flight` slug, and a real prerequisite is recorded as `Depends:` so ordering is explicit. Fast by default; **escalates into grill mode** — one question at a time, each with a recommended answer, checkpointed to the plan file after every answer — the moment a criterion can't be made checkable or `Provides:` can't be filled. `deep` forces it. Planning only, no code.
- **`/ristretto:pull <feature | next>`** — implements one feature against the *current* code, in auto mode, then closes it by archiving the plan and updating the roadmap. A **planner** subagent first expands the Contract into a throwaway build plan against HEAD — real paths, real signatures, real test code — so the implementer transcribes rather than re-plans. Tests come first (the build plan's cases become failing tests, then code to green), and before any commit the diff passes an **independent review** by a fresh subagent — bugs must be fixed, two rounds max.
- **`/ristretto:brew`** — brew the whole pot: autonomously pulls every eligible planned feature in sequence — same gates, evidence, review, and close as `pull`, one commit per feature on a single `feature/brew-<date>` session branch. **Each feature runs through fresh subagents** — planner, implementer, independent reviewer, closer: the main conversation stays a small orchestrator no matter how big the batch, every implementation sees exactly one spec, and nothing is committed unreviewed. A planner that can't satisfy the Contract blocks the feature before an implementer ever runs. Anything needing a decision gets status `blocked` with a one-line reason instead of a guess; you walk through `status blocked` afterward, refine, and re-brew. For when you've prepped a batch and don't want to babysit the roadmap.
- **`/ristretto:status [filter]`** — read-only view of the roadmap: what's planned, in progress, and done. Changes nothing.
- **`/ristretto:help`** — the menu: every command, the workflow, and the house rules as a CLI-style card. Read-only, instant.
- **`/ristretto:tamp [path | feature | nothing]`** — honest lean-code review: finds runtime waste, duplication, dead/over-built code, and readability drag in a diff or file, ranked and capped at the few that matter. Read-only; pass `fix` to apply the top findings. The code-analogue of `grind`.
- **`/ristretto:shot <feature>`** — prep + pull one small feature in a single pass, for trivial cases where the split is overkill. Same spec standard as `prep`, not a bypass lane: if it can't state checkable acceptance criteria **and a `Provides:`** on the spot, it stops and routes to `prep`. It expands the plan inline instead of dispatching a planner — one pass is the whole point.

## Why the plan splits in two

Most plan workflows bake exact file edits and literal code into the plan. That's fine if you execute immediately — but if you batch-plan ten features and implement them over days, the early plans rot, because the code moved out from under them.

The usual fix is to keep plans thin. That trades one problem for another: a one-screen plan omits the things that *don't* rot, and thin contracts are the single largest cause of inaccurate implementation. Drift kills turn-by-turn directions — exact paths, line numbers, literal code. It never touches an acceptance criterion, an interface signature, or a decision.

So ristretto puts depth in both places, at the moment each one is true:

- **`## Contract` — durable, written by `prep`, as deep as the feature deserves.** Checkable acceptance criteria, `Provides:` (the public surface this feature exposes, at type level), `Consumes:` (what it calls from its `Depends:`), the decisions that were resolved, and the seams of work inside it. Still zero code, so still drift-free — a signature is a contract, it names what exists, never how it works.
- **`## Approach` — the part that rots, so it stays to one screen.** Strategy and likely touchpoints, for orientation only.
- **The build plan — generated at pull time, then thrown away.** `pull` and `brew` dispatch a **planner** subagent that reads the Contract, takes each dependency's `Provides:` as fact, reads the code as it exists right now, and writes `.ristretto/build/<FEATURE-ID>.md`: real file paths, real names and signatures, real test code in this repo's style. The implementer transcribes it instead of re-planning. It lives in `.ristretto/` (gitignored) and is deleted at close — it cannot rot because it doesn't live long enough to, and it's reproducible from (plan + HEAD) anyway.

A planner that can't satisfy the Contract against the current code returns `blocked` and **no implementer ever runs** — the cheapest place for a bad spec to fail. Same drift-resistance as before, none of the thinness.

`prep` stays fast by default so you can batch-plan ten ideas in one sitting. It escalates into **grill mode** — one question at a time, each with a recommended answer, written to the plan file after every answer — exactly when it can't write a checkable criterion or can't fill `Provides:`. Force it with `/ristretto:prep <feature> deep`.

## The roadmap solves drift

State lives in files, not the conversation — clearing the chat never loses it.

- `roadmap.md` is the fast-read index; `pull` boots from it instead of re-scanning the repo.
- **`Provides:` / `Consumes:` close type drift across a Flight** — when B depends on A, B's `Consumes:` must be a subset of A's `Provides:`; `prep` checks it, and at close `pull` corrects `Provides:` in the archived plan to whatever was actually built, because that's what the next feature's planner reads as fact.
- **Flight grouping + `Depends:` give honest ordering without a scheduler** — `/ristretto:pull next` skips any feature still waiting on an unfinished prerequisite, so you can't pull work whose foundation isn't built yet. ristretto stays one-feature-at-a-time; the graph is recorded, not run as parallel waves.
- **Closing is `pull`'s job, every time** — it archives the plan and flips the roadmap row automatically. You never close by hand, so "forgot to close" can't happen.
- The roadmap is trusted as written. Keeping it honest is yours — but since closing is automatic, it stays honest with almost no effort, and it doubles as a plain-language view of what's done and what's next.

## Deterministic gates, not vibes

`pull` and `shot` don't self-report "tests pass" — the plugin ships hooks that enforce it:

- On the first pull in a repo, a `.ristretto.json` is created at the root with the repo's own `format` / `lint` / `typecheck` / `test` commands (stack auto-detected; existing tooling adopted, never replaced). Commit it.
- While a pull is active (marker file `.ristretto/pulling`), a **Stop hook** (and a **SubagentStop hook**, so each of brew's per-feature subagents is gated individually) runs lint + typecheck + test and blocks the agent (exit 2) until they're green. Red gate = not done — the agent can't rationalize past it, and it's instructed never to weaken or delete gates or tests to get there. After 3 forced retries it surfaces the failure to you instead of looping.
- A **PostToolUse hook** formats each touched file as the agent writes — a convenience that never blocks.
- Outside a pull, the hooks exit immediately: no nagging in casual sessions, and repos without a `.ristretto.json` are never touched.
- **Tests come first, red first**: acceptance criteria are transcribed into tests *before* implementation, and the failing run is the proof the tests test something. A test that passes before any code is written proves nothing.
- **An independent review gates every commit**: after the gates are green, a fresh subagent that never saw the implementation reasoning judges the diff — `bug` findings (a criterion not actually met, edge cases, dishonest tests) must be fixed, `lean` findings (tamp's facets) unless riskier than the win. Two rounds in `pull` and `shot`, then it surfaces instead of looping. `brew` gets a third: bugs still open after round 2 go to a **fresh implementer on a model one tier up**, given the plan, the findings, and the diff — not the failed attempts — then one final scoped re-review. Still open means `blocked`, not "done with caveats". Trivial diffs (a few lines, no new logic) skip the review.
- Closing a feature also records **Evidence** in the archived plan: how each acceptance criterion was proven — red→green test names, output, measurements — plus the gate summary and the review verdict. "Implemented successfully" is not evidence.

The gate runner is plain Node (`scripts/gate.js`) — no bash, no jq — so it works the same on Windows, macOS, and Linux. It fingerprints a green working tree and skips re-running gates while the tree is unchanged, so review/close subagents don't pay a full test run at every stop. Check it with `node scripts/gate.test.js`.

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
.ristretto.json         # gate commands for this repo (committed)
.ristretto/             # transient pull state — marker & retry counter (gitignored)
  build/
    BREW-224.md         # throwaway build plan, written at pull time, deleted at close
docs/ristretto/
  roadmap.md            # always-current index of every feature
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
/ristretto:pull next                          # implement the top planned feature
/ristretto:brew                              # brew every eligible feature, unattended
/ristretto:status                             # see the whole roadmap
/ristretto:status open                        # only what's not done yet
/ristretto:status blocked                     # the refinement queue after a brew
/ristretto:shot ROAST-150 rename the menu item # plan + do a trivial one in one pass
/ristretto:tamp                               # review the changes I just made
/ristretto:tamp src/auth                      # green-up pass on existing code
/ristretto:tamp BREW-224 fix                  # review a feature's diff and apply the top fixes
/ristretto:help                              # the menu — commands, workflow, house rules
```

Runs entirely in auto mode — no plan-mode switching.
