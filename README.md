# ristretto

Lean feature implementation for Claude Code. A restricted shot: less ceremony, more concentration.

A small set of commands following the lifecycle **review → plan → build**, plus `tamp` to keep the built code lean. The two core ones split the way you actually work — plan a stack of features in one sitting, implement them later as the code shifts underneath:

- **`/ristretto:grind <feature>`** — honest refinement review: plain-language summary, story-point estimate, the problems it actually has, and a Ready / Not-Ready verdict. Read-only.
- **`/ristretto:prep <features | ideas>`** — turns features *or* raw ideas into lean *intent* plans and adds them to the project roadmap. Splits an input into sub-features only when there's a real seam (independent deliverables, separate "done", or too big for one sprint) — otherwise keeps it whole. Features that belong together get a shared `Flight` slug, and a real prerequisite is recorded as `Depends:` so ordering is explicit. Planning only, no code.
- **`/ristretto:pull <feature | next>`** — implements one feature against the *current* code, in auto mode, then closes it by archiving the plan and updating the roadmap.
- **`/ristretto:brew`** — brew the whole pot: autonomously pulls every eligible planned feature in sequence — same gates, evidence, and close as `pull`, one commit per feature on a single `feature/brew-<date>` session branch. Anything needing a decision gets status `blocked` with a one-line reason instead of a guess; you walk through `status blocked` afterward, refine, and re-brew. For when you've prepped a batch and don't want to babysit the roadmap.
- **`/ristretto:status [filter]`** — read-only view of the roadmap: what's planned, in progress, and done. Changes nothing.
- **`/ristretto:tamp [path | feature | nothing]`** — honest lean-code review: finds runtime waste, duplication, dead/over-built code, and readability drag in a diff or file, ranked and capped at the few that matter. Read-only; pass `fix` to apply the top findings. The code-analogue of `grind`.
- **`/ristretto:shot <feature>`** — prep + pull one small feature in a single pass, for trivial cases where the split is overkill.

## Why intent plans instead of code plans

Most plan workflows bake exact file edits and literal code into the plan. That's fine if you execute immediately — but if you batch-plan ten features and implement them over days, the early plans rot, because the code moved out from under them.

ristretto plans capture the **destination, not turn-by-turn directions**: a goal, **acceptance criteria** (the contract for "done"), an approach, and likely touchpoints — never the code itself. `pull` reads the intent and writes fresh code against whatever the repo looks like *now*. The plan guides; it never dictates stale edits. Smaller plans, no double-writing of code — concentrated, no waste.

## The roadmap solves drift

State lives in files, not the conversation — clearing the chat never loses it.

- `roadmap.md` is the fast-read index; `pull` boots from it instead of re-scanning the repo.
- **Flight grouping + `Depends:` give honest ordering without a scheduler** — `/ristretto:pull next` skips any feature still waiting on an unfinished prerequisite, so you can't pull work whose foundation isn't built yet. ristretto stays one-feature-at-a-time; the graph is recorded, not run as parallel waves.
- **Closing is `pull`'s job, every time** — it archives the plan and flips the roadmap row automatically. You never close by hand, so "forgot to close" can't happen.
- The roadmap is trusted as written. Keeping it honest is yours — but since closing is automatic, it stays honest with almost no effort, and it doubles as a plain-language view of what's done and what's next.

## Deterministic gates, not vibes

`pull` and `shot` don't self-report "tests pass" — the plugin ships hooks that enforce it:

- On the first pull in a repo, a `.ristretto.json` is created at the root with the repo's own `format` / `lint` / `typecheck` / `test` commands (stack auto-detected; existing tooling adopted, never replaced). Commit it.
- While a pull is active (marker file `.ristretto/pulling`), a **Stop hook** runs lint + typecheck + test and blocks the agent (exit 2) until they're green. Red gate = not done — the agent can't rationalize past it, and it's instructed never to weaken or delete gates or tests to get there. After 3 forced retries it surfaces the failure to you instead of looping.
- A **PostToolUse hook** formats each touched file as the agent writes — a convenience that never blocks.
- Outside a pull, the hooks exit immediately: no nagging in casual sessions, and repos without a `.ristretto.json` are never touched.
- Closing a feature now also records **Evidence** in the archived plan: how each acceptance criterion was proven — test names, output, measurements. "Implemented successfully" is not evidence.

The gate runner is plain Node (`scripts/gate.js`) — no bash, no jq — so it works the same on Windows, macOS, and Linux. Check it with `node scripts/gate.test.js`.

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
docs/ristretto/
  roadmap.md            # always-current index of every feature
  plans/
    BREW-224.md         # active intent plans
    archived/
      BREW-202.md       # closed → moved here
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
```

Runs entirely in auto mode — no plan-mode switching.
