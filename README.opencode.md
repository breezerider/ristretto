# ristretto — OpenCode

Native TypeScript plugin (`.opencode/plugin/index.ts`), compiled to a pre-built ES
module (`.opencode/plugins/ristretto.mjs`) that ships in the npm package. Commands and
the gate runner are shared with the Claude Code plugin — single source of truth.

## Install

Three ways, all loading the same compiled plugin (`.opencode/plugins/ristretto.mjs`).

**From a local clone** — the plugin directory must be on disk so `ctx` resolves it:

```json
// opencode.json
{ "plugin": ["./path/to/ristretto"] }
```

**From npm** — the package ships the compiled `.mjs`, `commands/`, and `scripts/gate.js`:

```json
{ "plugin": ["ristretto@0.12.0"] }
```

**Via npx** — copies the plugin, commands, and gate runner into the OpenCode config
dir and registers it (idempotent):

```bash
npx ristretto --opencode
```

Installs to the global config dir (`~/.config/opencode`), or `--local` for the project
(`.opencode/`), or `--global` to force global. The installer registers the plugin in
`opencode.jsonc` (preferred by OpenCode; falls back to `opencode.json`, creating it if
neither exists). `opencode.jsonc` is edited structurally with `jsonc-parser`, so
comments and formatting are preserved. Layout written:

```
<prefix>/plugins/ristretto.mjs   # the plugin
<prefix>/commands/ristretto-*.md # slash-command prompts (prefixed, /ristretto: → /ristretto-)
<prefix>/ristretto/gate.js       # gate runner
```

Installed command files are prefixed `ristretto-<name>.md` and their bodies have
`/ristretto:` rewritten to `/ristretto-` (OpenCode command keys are flat). The plugin
skips the prefix when already present and the rewrite is idempotent, so installed files
load as-is.

The plugin resolves its root from its own file, so it finds `commands/` and `gate.js`
in either the npm layout or the npx-installed layout.

Restart OpenCode, then confirm the menu with `/ristretto-help`.

## Build & package

The plugin is compiled to `.opencode/plugins/ristretto.mjs` with Bun. `prepack` rebuilds
it automatically before every `npm pack`/`publish`, so the shipped artifact is always
fresh — no committed-drift risk.

`jsonc-parser` (a dependency of the installer) is pulled from `node_modules` when the
installer runs via `npx`; it ships in the published package's dependency graph.

```bash
# build the plugin artifact
bun run build

# gate runner self-check (plain Node)
node scripts/gate.test.js

# OpenCode adapter tests (Bun) — run against the compiled artifact
bun test ./.opencode/plugin/adapter.test.ts

# or both at once
npm test

# confirm exactly what ships — .opencode/plugins/ristretto.mjs, bin/install.mjs,
# commands/, scripts/gate.js — and that tests + .claude-plugin/ are excluded
npm pack --dry-run

# publish (prepack rebuilds the artifact first)
bun publish   # or: npm publish
```

Pin version: OpenCode resolves `latest` once and caches it, so bump the `@0.12.0`
pin in `package.json` on every release.

## Usage

Commands are namespaced `/ristretto-` in OpenCode (Claude Code used `/ristretto:`) — the bodies reference each other through that namespace, rewritten at load.

```
/ristretto-grind BREW-224                     # honest review before committing to it
/ristretto-prep BREW-224 BREW-210 ROAST-150  # plan a batch of features
/ristretto-prep add rate-limiting to login   # plan a raw idea (→ login-rate-limit plan)
/ristretto-prep BREW-224 deep                 # force grill mode — one question at a time
/ristretto-pull BREW-224                      # implement one (branch + commit)
/ristretto-pull BREW-224 nocommit             # implement, but leave the commit to you
/ristretto-pull next                          # implement the top planned feature
/ristretto-brew                              # brew every eligible feature, unattended
/ristretto-status                             # see the whole roadmap
/ristretto-status open                        # only what's not done yet
/ristretto-status blocked                     # the refinement queue after a brew
/ristretto-shot ROAST-150 rename the menu item # plan + do a trivial one in one pass
/ristretto-tamp                               # review the changes I just made
/ristretto-tamp src/auth                      # green-up pass on existing code
/ristretto-tamp BREW-224 fix                  # review a feature's diff and apply the top fixes
/ristretto-help                              # the menu — commands, workflow, house rules
```

## OpenCode hooks and the advisory Stop gate

OpenCode maps ristretto's hooks one-to-one except one place — there is no blocking
session-end hook, so the Stop gate downgrades to advisory:

| Claude Code        | OpenCode                          | Effect                          |
| ------------------ | --------------------------------- | ------------------------------- |
| `PostToolUse`      | `tool.execute.after` (write/edit) | `gate.js quick` — formats, never blocks |
| `SubagentStop`     | `tool.execute.after` (task)       | `gate.js full` — **throws on exit 2** → blocks the subagent |
| `Stop`             | `event` + `session.idle`          | `gate.js full` — **advisory**, reports red, does not prevent the turn |

Because per-subagent and per-edit gating are preserved, `pull`/`brew`/`shot` still fail
fast on a dirty tree. Only a completed session can end with red gates, and since
`session.idle` fires after the turn, a red tree is surfaced rather than enforced. The
commands already self-verify ("run the gates; fix until green"), so the advisory Stop
is a safety net, not the primary mechanism — a real regression still blocks the
feature inside the pull's own gates. No `.ristretto.json` or outside a pull → gates
exit immediately, unchanged.
