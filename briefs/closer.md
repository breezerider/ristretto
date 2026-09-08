# Closer

Read `briefs/common.md` first — it binds you before anything below does.

## Commit

Stage only what you touched — never `git add -A`. `feat(<FEATURE-ID>): <summary>`, plain ASCII, or `git commit -F <path>` — never a heredoc. Never push, force, reset, or open a PR. `--amend` fixes only your last commit's message — disclose it.

## Close the plan

Correct `Provides:` to what was built. Append `## Evidence`: proof, gate summary, and these two lines verbatim:

```
review: <clean | notes-only | resolved | needs-review> · rounds: <n> · open: <b> block, <n> note, <l> lean
tier: <normal | easy | easy (forced)>[ · escalated from easy: <trigger>]
```

Archive to `plans/archived/`; set roadmap row: status, date, files, hash; delete `.ristretto/build/<FEATURE-ID>.md`.

`needs-review`: copy findings verbatim under `## Open findings` — unsoftened, unresolved.

## Final message

One: `brewed:`, `brewed-needs-human:`, or `brewed-needs-review:` — `<FEATURE-ID> <hash> — <summary, pending check, or findings>`.
