# ristretto

Lean ticket implementation for Claude Code. A restricted shot: less ceremony, more concentration.

A small set of commands following the lifecycle **review → plan → build**, plus `tamp` to keep the built code lean. The two core ones split the way you actually work — plan a stack of tickets in one sitting, implement them later as the code shifts underneath:

- **`/ristretto:grind <ticket>`** — honest refinement review: plain-language summary, story-point estimate, the problems it actually has, and a Ready / Not-Ready verdict. Read-only.
- **`/ristretto:prep <tickets | ideas>`** — turns tickets *or* raw ideas into lean *intent* plans and adds them to the project roadmap. Splits an input into sub-tickets only when there's a real seam (independent deliverables, separate "done", or too big for one sprint) — otherwise keeps it whole. Tickets that belong together get a shared `Feature` slug, and a real prerequisite is recorded as `Depends:` so ordering is explicit. Planning only, no code.
- **`/ristretto:pull <ticket | next>`** — implements one ticket against the *current* code, in auto mode, then closes it by archiving the plan and updating the roadmap.
- **`/ristretto:status [filter]`** — read-only view of the roadmap: what's planned, in progress, and done. Changes nothing.
- **`/ristretto:tamp [path | ticket | nothing]`** — honest lean-code review: finds runtime waste, duplication, dead/over-built code, and readability drag in a diff or file, ranked and capped at the few that matter. Read-only; pass `fix` to apply the top findings. The code-analogue of `grind`.
- **`/ristretto:shot <ticket>`** — prep + pull one small ticket in a single pass, for trivial cases where the split is overkill.

## Why intent plans instead of code plans

Most plan workflows bake exact file edits and literal code into the plan. That's fine if you execute immediately — but if you batch-plan ten tickets and implement them over days, the early plans rot, because the code moved out from under them.

ristretto plans capture the **destination, not turn-by-turn directions**: a goal, **acceptance criteria** (the contract for "done"), an approach, and likely touchpoints — never the code itself. `pull` reads the intent and writes fresh code against whatever the repo looks like *now*. The plan guides; it never dictates stale edits. Smaller plans, no double-writing of code — concentrated, no waste.

## The roadmap solves drift

State lives in files, not the conversation — clearing the chat never loses it.

- `roadmap.md` is the fast-read index; `pull` boots from it instead of re-scanning the repo.
- **Feature grouping + `Depends:` give honest ordering without a scheduler** — `/ristretto:pull next` skips any ticket still waiting on an unfinished prerequisite, so you can't pull work whose foundation isn't built yet. ristretto stays one-ticket-at-a-time; the graph is recorded, not run as parallel waves.
- **Closing is `pull`'s job, every time** — it archives the plan and flips the roadmap row automatically. You never close by hand, so "forgot to close" can't happen.
- The roadmap is trusted as written. Keeping it honest is yours — but since closing is automatic, it stays honest with almost no effort, and it doubles as a plain-language view of what's done and what's next.

## Git: branch & commit, never push

`pull` and `shot` handle git for you, with one firm boundary — **they never push.**

- They work on a `feature/<TICKET-ID>` branch (created from a clean tree, or your current ticket branch is reused).
- At close they stage only the files touched and commit `feat(<TICKET-ID>): …`, then write the real hash into the roadmap row.
- Committing locally is reversible; pushing is the one team-visible, irreversible step — so that stays with you. They never push, set an upstream, force, amend, reset, or open a PR.
- Pass `nocommit` to skip the commit and leave the changes in your working tree: `/ristretto:pull VDA-224 nocommit`.

## Flavor

The coffee metaphor carries real signal, not just decoration — and nothing animated sits in the work path, so there's no latency cost:

- `grind` signs off with a **tasting note** that mirrors the verdict (Ready → "clean extraction"; Not Ready → "under-extracted").
- `status` leads with a **brew gauge** — `☕ [█████░░░░░] 5/10 brewed` — and shows a full **milestone cup** when the roadmap clears.
- `tamp` closes with a **tasting note** mirroring its verdict — `clean shot` (nothing channeling) or `channeling` (real waste found).
- `pull` and `shot` end with a little cup when a ticket lands, and the milestone cup when it was the last one.
- **`/ristretto:brew`** — an easter egg. Prints a cup and a barista quip, nothing else.

## Layout it generates (per project)

```
docs/ristretto/
  roadmap.md            # always-current index of every ticket
  plans/
    VDA-224.md          # active intent plans
    archived/
      VDA-202.md        # closed → moved here
```

## Install (local, no GitHub needed)

```
/plugin marketplace add /path/to/ristretto
/plugin install ristretto@ristretto-dev
```

To share with the team, push this folder to a Git repo and `/plugin marketplace add <user>/<repo>` instead.

## Usage

```
/ristretto:grind VDA-224                     # honest review before committing to it
/ristretto:prep VDA-224 VDA-210 NGS-150     # plan a batch of tickets
/ristretto:prep add rate-limiting to login  # plan a raw idea (→ login-rate-limit plan)
/ristretto:pull VDA-224                      # implement one (branch + commit)
/ristretto:pull VDA-224 nocommit             # implement, but leave the commit to you
/ristretto:pull next                         # implement the top planned ticket
/ristretto:status                            # see the whole roadmap
/ristretto:status open                       # only what's not done yet
/ristretto:shot NGS-150 rename the menu item # plan + do a trivial one in one pass
/ristretto:tamp                              # review the changes I just made
/ristretto:tamp src/auth                     # green-up pass on existing code
/ristretto:tamp VDA-224 fix                  # review a ticket's diff and apply the top fixes
/ristretto:brew                              # pull a shot, do nothing useful ☕
```

Runs entirely in auto mode — no plan-mode switching.
