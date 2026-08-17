---
description: Bring this project's roadmap, plans, and gate config up to the current ristretto format. Runs automatically when a command finds an out-of-date project; you can also run it directly.
---

You are running **MIGRATE** — bringing `docs/ristretto/` up to the format this version of ristretto reads and writes.

Nothing here is a product decision. You are changing the *shape* of records, never their meaning: no criterion is added, removed, or reworded, no status is invented, no plan is re-planned. If a migration step would require deciding something, it doesn't — stop and say so instead.

## 1. Establish where the project actually is

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" check
```

- **exit 0** → nothing to do. Say so in one line and stop. (This includes a repo with no roadmap yet: `prep` creates it already stamped.)
- **exit 2** → the check itself couldn't run. Report what it said and stop; don't guess.
- **"PROJECT IS NEWER"** → **stop.** The install is stale, not the project. Migrating would rewrite these files into an older shape and lose whatever the newer format records. Tell the user to update the plugin.
- **exit 1 otherwise** → migrate, starting with step 2.

## 2. Tell the user before touching anything

This is not optional and it is not a progress note. A migration rewrites plans they wrote, and they must know it happened *before* it does, not discover it in a diff later:

```
⚙ ristretto: this project is on format <old>, the plugin is <new>.
  Migrating docs/ristretto/ before continuing — <n> plan(s), the roadmap, and .ristretto.json.
  Records change shape only; no criterion, decision, or status meaning is altered.
```

If the working tree is dirty, say that the migration will be mixed in with their uncommitted work, and offer to stop so they can commit first. A migration is much easier to review as its own diff.

## 3. Apply every step below the project's recorded format

Each block is cumulative — a project on 0.11 gets all of them, in order. Do the mechanical renames with exact-match edits; never regenerate a file from scratch, because that loses everything the format doesn't know about.

### → 0.14 — one human state, and classified criteria

1. **Roadmap statuses:** `needs-ops` → `needs-human`. No other status changes.
2. **`docs/ristretto/manual-ops.md` → `docs/ristretto/manual-checks.md`** (rename the file; keep its history by using `git mv` if the file is tracked). Inside it, and in the header text:
   - `- [ ] **before** · <where> · <what>` → `- [ ] **proves** · <criterion> · <where> · <what>`
   - `- [ ] **after** · <where> · <what>` → `- [ ] **deploy** · — · <where> · <what>`
   - **Preserve every tick.** A `- [x]` stays `- [x]`. Re-ticking is the user's signature, not yours, and silently un-ticking one would make ristretto re-run work a human already did.
   - For a `proves` line, the criterion it proves is usually already recorded on its `_blocks:_` line — move it into the new slot. If it genuinely isn't recorded, write `?` and list that line in your summary rather than guessing which criterion it belongs to.
3. **Plans** in `plans/` and `plans/archived/`: `Manual-Ops:` → `Manual-Checks:`, with the same line-shape change as above.
4. **Classify every acceptance criterion** in `plans/` with `[auto]` or `[human]`. Archived plans are history — leave them alone.
   - `[human]` is anything no test or gate can prove: it needs a person to **run** something (a migration, a secret, a console switch, a signing step) or to **look at** something (a layout, an animation, copy in another language).
   - Everything else is `[auto]`. When genuinely unsure, mark `[auto]` — a criterion wrongly marked `[human]` silently stops being tested, which is the worse error.
   - **Every criterion you marked `[human]` goes in your summary, listed.** This is the one judgment in the whole migration, and the user needs to see it to correct it.
   - A `[human]` criterion with no matching line in `manual-checks.md` needs one. Add it with `?` for the "what to do" and flag it — you know a person must do something, not what.
5. **`.ristretto.json`:** add `testChanged` and `formatPaths` if absent, exactly as `pull` step 3 describes. Never change a command the user already wrote.

### → 0.13 — contracts, and a status for manual work

1. Plans with no `## Contract` section: move `Acceptance:` under a new `## Contract`, and add `Provides:`, `Consumes:`, `Decisions:`, `Units:`, `Manual-Checks:` as `—` where unknown. **Leave them `—`.** Filling them in is `prep`'s job with the user present — inventing a `Provides:` here would poison every dependent feature's planner, which reads it as fact.
2. Move `Blockers:` from `## Approach` into `## Contract` if it's in the old place.
3. Say in your summary which plans came out with empty Contract fields, and suggest `/ristretto:prep <ID> deep` for any that are still `planned` — a thin contract is the single largest cause of an inaccurate build.

## 4. Stamp and report

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" stamp
```

Then report, in this order:

1. What changed, by file count: plans updated, roadmap statuses renamed, checklist lines reshaped, config keys added.
2. **Every criterion you classified `[human]`**, listed, so the user can correct any you got wrong.
3. Anything you marked `?` because the old format didn't record it.
4. Plans left with empty Contract fields, and the `prep ... deep` suggestion for the ones still `planned`.
5. That the migration is uncommitted and worth reviewing as its own commit.

Never commit the migration yourself unless the user asked you to — reviewing a rewrite of your own plans is exactly the thing that shouldn't be automatic.

## Hard rules

- **Shape, never meaning.** No criterion added, removed, or reworded. No status invented. No plan re-planned. No box ticked or un-ticked.
- **Archived plans are history.** Rename fields inside them so they stay readable, but never reclassify or rewrite their content — an archived plan is the evidence of what was actually built.
- **Never migrate downward.** A project newer than the plugin is a stale install; say so and stop.
- **One judgment only** — `[auto]` vs `[human]` — and it is always reported, never silent.
