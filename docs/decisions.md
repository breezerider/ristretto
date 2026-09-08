# Decisions

This file is read by people, not by any ristretto dispatch — no command or brief
references it, and none should. It exists so the reasoning behind a rule survives after
the rule itself moved into code or shrank to a phrase nobody unpacks anymore. Each entry:
what happened, the rule it produced, where that rule lives now.

## The 16.8-minute silent gate

A commit titled "speed up gates" added `--no-progress` to this repo's own test command.
Hang detection reads a gate's output to tell a live suite from a wedged one; the flag
deleted that signal, so a suite that was working the whole time looked identical to a
hang for its entire 16.8-minute run. Three subagents were killed waiting on it, each with
its work already finished and proven green.

**Rule produced:** never give a `test` / `testChanged` command a flag that silences the
runner — `-q`, `--no-progress`, `--quiet`, a dots-only or summary-only reporter.

**Where it lives now:** `gate.js verify` detects a silencing flag on a `test` /
`testChanged` command itself (Task 5's audits) — it is no longer text anyone has to
remember to write or to read.

## The 289-second gate

An implementer verifying its own work typed `pytest -q` instead of copying the repo's
configured `pytest -q -n auto` — the same suite, but on one core instead of all of them.
What was a 289-second gate when run as configured took forty minutes of a subagent
sitting still when hand-rolled, and it proved something slightly different from what the
Stop hook was about to check.

**Rule produced:** verify by running the gate commands exactly as `.ristretto.json`
spells them — copy the string, substitute nothing, invent nothing.

**Where it lives now:** `gate.js prove` (Task 5) runs the exact configured command
itself, so there is no longer a hand-rolled command for an implementer to get wrong.
`briefs/implementer.md`'s "Finish with prove" section is where the implementer is told
to call it, in place of the old copy-it-yourself instruction.

## The 2.6-minute suite growth

Measured on a real feature: 11 acceptance criteria became 31 tests, each booting a web
server, and the suite went from 641 tests to 704 across two features — about
+2.6 minutes of gate, permanently, per feature. Nothing in that came from a criterion
nobody had thought of; it came from proving the same criterion three times.

**Rule produced:** one test per criterion is the default; prove it at the cheapest level
that is still honest; reuse an existing test before writing a new one; a decision is
never a test.

**Where it lives now:** `briefs/common.md`'s Tests section.
