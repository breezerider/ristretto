---
description: Print the ristretto menu — every command, the workflow, and the house rules. Read-only, instant, changes nothing.
---

You are running **HELP**. Do **no** work — no file reads, no git, no roadmap, no tools. Just print the menu below verbatim (it is the complete output), then stop.

```
☕ ristretto — spec-driven features, lean extraction
═══════════════════════════════════════════════════

THE WORKFLOW
  1. /ristretto:grind <feature>     honest refinement review — story points,
                                    problems, Ready / Not-Ready. read-only.
  2. /ristretto:prep <features>     batch-plan into lean intent plans. every
                                    acceptance criterion must be checkable
                                    (test, measurement, or binary observation)
                                    — what can't be, becomes a Blocker.
  3. /ristretto:brew                brew the whole pot: implements every
                                    eligible feature unattended, one gated
                                    commit each, on feature/brew-<date>.
                                    each feature runs in a fresh subagent —
                                    the main context stays lean, batches scale.
                                    ambiguity → status "blocked", never a guess.
     …or /ristretto:pull <ID|next>  pull exactly one feature, human between shots.
  4. /ristretto:status blocked      your refinement queue after a brew —
                                    each row names its spec gap. refine via
                                    prep (flips it back to planned), re-brew.

THE REST OF THE MENU
  /ristretto:shot <feature>         prep + pull one trivial feature in one pass.
                                    same spec standard — no checkable criteria
                                    on the spot → it routes you to prep.
  /ristretto:status [filter]        roadmap view: gauge + rows.
                                    filters: open | done | blocked | ID | flight
  /ristretto:tamp [target] [fix]    lean-code review of a diff/file: waste,
                                    duplication, over-build. "fix" applies.
  /ristretto:help                   this menu.

HOUSE RULES
  • specs first — nothing is built that isn't planned with checkable criteria.
  • deterministic gates — while implementing, a Stop hook runs your repo's
    lint + typecheck + test (.ristretto.json) and blocks until green.
    enforced, not self-reported. evidence is recorded, not claimed.
  • skip, never guess — undecidable → blocked with the spec gap named.
  • git: feature branches, one commit per feature, NEVER pushes. reviewing
    and pushing is yours.
  • state lives in files (docs/ristretto/) — clearing the chat loses nothing.

full docs: README.md in the plugin repo.
```
