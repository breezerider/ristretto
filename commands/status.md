---
description: Print the project roadmap — a read-only view of what's planned, in progress, and done. Changes nothing.
argument-hint: [optional filter: "open", "done", or a ticket ID]
---

You are running **STATUS**. This is **read-only** — do not create, modify, archive, or implement anything.

Filter (optional): $ARGUMENTS

1. Read `docs/ristretto/roadmap.md`. If it doesn't exist, tell the user there's no roadmap yet and to run `/ristretto:prep` to start one, then stop.
2. **Brew gauge.** Lead with a 10-segment gauge of done / total, filled proportionally (round to nearest segment), e.g.:
   `☕ [█████░░░░░] 5/10 brewed`
3. Print a one-line count summary: planned / in-progress / done.
4. Print the roadmap rows. If a filter was given, show only matching rows:
   - `open` → everything not `done`
   - `done` → only `done`
   - a ticket ID → just that row
5. If nothing matches the filter, say so plainly.
6. **Milestone.** If every ticket is `done` (gauge full), replace the gauge with a full celebratory cup:
   ```
      ) )  ( (
   .__________.
   |          |]
   |          |
   `----------'
   ALL BREWED — roadmap clear ☕
   ```

Keep it tight — just the picture of where the project stands. No analysis unless asked.
