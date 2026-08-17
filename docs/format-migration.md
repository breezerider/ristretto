# Format migration

**This is not a command.** No one runs it, and it is not in the menu — a user should never have to know their project has a format. A command that finds an out-of-date project reads this file and applies it, then carries on with what it was actually asked to do.

Nothing here is a product decision. You are changing the *shape* of records, never their meaning: no criterion is added, removed, or reworded, no status is invented, no plan is re-planned. If a migration step would require deciding something, it doesn't — stop and say so instead.

## 1. Say what is about to happen

You already know the project is behind — that's why you're reading this. Announce it before touching anything. Not optional, and not a progress note: this rewrites plans the user wrote, and they should know as it happens rather than find it in a diff later.

```
⚙ ristretto: this project was written for format <old>; this is <new>.
  Bringing docs/ristretto/ up to date first — <n> plan(s), the roadmap, and .ristretto.json.
  Shape only: no criterion, decision, or status meaning changes.
```

If the working tree is dirty, say the migration will be mixed into their uncommitted work, and offer to stop so they can commit first — it is far easier to review as its own diff.

## 2. Apply every block below the project's recorded format

Each block is cumulative — an unstamped project gets all of them, in order. Do the mechanical renames with exact-match edits; never regenerate a file from scratch, because that loses everything the format doesn't know about.

### → 0.13 — contracts, one human state, and classified criteria

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

**Also, for a project that predates `## Contract` entirely:**

6. Plans with no `## Contract` section: move `Acceptance:` under a new `## Contract`, and add `Provides:`, `Consumes:`, `Decisions:`, `Units:`, `Manual-Checks:` as `—` where unknown. **Leave them `—`.** Filling them in is `prep`'s job with the user present — inventing a `Provides:` here would poison every dependent feature's planner, which reads it as fact.
7. Move `Blockers:` from `## Approach` into `## Contract` if it's in the old place.
8. Say in your summary which plans came out with empty Contract fields, and suggest `/ristretto:prep <ID> deep` for any that are still `planned` — a thin contract is the single largest cause of an inaccurate build.

## 3. Stamp, report, and carry on

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

Then **continue with the command the user actually ran.** The migration is not the errand; it is the thing that had to be true first.

## Hard rules

- **Shape, never meaning.** No criterion added, removed, or reworded. No status invented. No plan re-planned. No box ticked or un-ticked.
- **Archived plans are history.** Rename fields inside them so they stay readable, but never reclassify or rewrite their content — an archived plan is the evidence of what was actually built.
- **Never migrate downward.** A project newer than the plugin is a stale install; say so and stop.
- **One judgment only** — `[auto]` vs `[human]` — and it is always reported, never silent.
