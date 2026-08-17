---
description: Print the project roadmap — a read-only view of what's planned, in progress, and done. Changes nothing.
argument-hint: [optional filter: "open", "done", "blocked", "checks", or a feature ID]
---

You are running **STATUS**. This is **read-only** — do not create, modify, archive, or implement anything.

Filter (optional): $ARGUMENTS

0. Check the format first: `node "${CLAUDE_PLUGIN_ROOT}/scripts/version.js" check`. On exit 1, print one line above the gauge — `⚙ this project is on an older ristretto format — run /ristretto:migrate` — and then **carry on and print the status anyway**. This command is read-only and it is what people run to orient themselves; refusing to show the roadmap because of a format mismatch would be the least helpful possible moment to stop. Just don't let a stale row read as current.
1. Read `docs/ristretto/roadmap.md`. If it doesn't exist, tell the user there's no roadmap yet and to run `/ristretto:prep` to start one, then stop.
2. **Brew gauge.** Lead with a 10-segment gauge of done / total, filled proportionally (round to nearest segment), e.g.:
   `☕ [█████░░░░░] 5/10 brewed`
   If any feature is `needs-human`, add one line under it: `🔧 2 waiting on you — /ristretto:status checks`.
3. Print a one-line count summary: planned / in-progress / blocked / needs-human / done.
4. Print the roadmap rows. If a filter was given, show only matching rows:
   - `open` → everything not `done` (a `needs-human` row is still open — its code is built, but a criterion is unproven)
   - `done` → only `done`
   - `blocked` → only `blocked`, each with its recorded reason — this is the **refinement queue** after a `brew` run
   - `checks` → only `needs-human`, each with its outstanding step read from `docs/ristretto/manual-checks.md` (`- [ ]` items only) — this is the **do-it-yourself queue**, and a different job from refining a spec
   - a feature ID → just that row
   - a flight slug → only rows in that flight

   If any rows carry a `Flight`, group the output by flight (standalone `—` rows last under "Other"). Within a group, a feature still waiting on an unfinished `Depends:` prerequisite gets a small `⏳` marker so it's clear why `pull next` would skip it — only a `blocked` prerequisite earns that marker, since `done` and `needs-human` both satisfy a dependency. A `needs-human` row itself gets a 🔧. Don't over-decorate — one marker, no analysis.
5. If nothing matches the filter, say so plainly.
6. **Milestone.** If every feature is `done` (gauge full), replace the gauge with a full celebratory cup:
   ```
      ) )  ( (
   .__________.
   |          |]
   |          |
   `----------'
   ALL BREWED — roadmap clear ☕
   ```

Keep it tight — just the picture of where the project stands. No analysis unless asked.
