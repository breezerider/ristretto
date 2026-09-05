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

After cloning, run `bun run build` to stage `ristretto/` in-repo; the plugin's
`PLUGIN_ROOT` walk needs `ristretto/gate.js` to be present, and only the build
step creates it. Without `bun run build`, the local-clone install does not resolve.

**From npm** — the package ships the compiled `.mjs` and the staged `ristretto/`
tree (skills, gate runner, LSP server, manifest):

```json
{ "plugin": ["ristretto@0.16.0"] }
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
<prefix>/plugins/ristretto.mjs             # the plugin
<prefix>/ristretto/skills/ristretto-*.md   # slash-command prompts (prefixed, /ristretto: → /ristretto-)
<prefix>/ristretto/gate.js                 # gate runner
<prefix>/ristretto/gate-lsp.mjs            # LSP server (per-edit format)
<prefix>/ristretto/plugin.json             # installed manifest (version stamp for migrations)
```

Installed command files are prefixed `ristretto-<name>.md` and their bodies have
`/ristretto:` rewritten to `/ristretto-` (OpenCode command keys are flat). The plugin
skips the prefix when already present and the rewrite is idempotent, so installed files
load as-is.

The plugin resolves its root from its own file, so it finds `ristretto/skills/` and
`ristretto/gate.js` in either the npm layout or the npx-installed layout.

Restart OpenCode, then confirm the menu with `/ristretto-help`.

## Build & package

The plugin is compiled to `.opencode/plugins/ristretto.mjs` with Bun. `prepack` rebuilds
it automatically before every `npm pack`/`publish`, so the shipped artifact is always
fresh — no committed-drift risk.

`jsonc-parser` (a dependency of the installer) is pulled from `node_modules` when the
installer runs via `npx`; it ships in the published package's dependency graph.

```bash
# build the plugin artifact + stage ristretto/
bun run build

# gate runner self-check (plain Node)
node scripts/gate.test.js

# OpenCode adapter, install, package, and README tests (Bun)
bun test .opencode/plugin/adapter.test.ts bin/install.test.ts package.test.ts README.opencode.test.ts

# or all of the above at once
npm test

# confirm exactly what ships — .opencode/plugins/ristretto.mjs, bin/install.mjs,
# ristretto/ (skills, gate runner, LSP server, manifest) — and that tests + .claude-plugin/
# are excluded
npm pack --dry-run

# publish (prepack rebuilds the artifact first)
bun publish   # or: npm publish
```

Pin version: OpenCode resolves `latest` once and caches it, so bump the `@0.16.0`
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
/ristretto-brew [easy]                       # brew, forcing every feature through the easy path
/ristretto-status                             # see the whole roadmap
/ristretto-status open                        # only what's not done yet
/ristretto-status blocked                     # the refinement queue after a brew
/ristretto-shot ROAST-150 rename the menu item # plan + do a trivial one in one pass
/ristretto-tamp                               # review the changes I just made
/ristretto-tamp src/auth                      # green-up pass on existing code
/ristretto-tamp BREW-224 fix                  # review a feature's diff and apply the top fixes
/ristretto-help                              # the menu — commands, workflow, house rules
```

## OpenCode hooks

Four hooks, four responsibilities:

| Claude Code        | OpenCode                          | Effect                          |
| ------------------ | --------------------------------- | ------------------------------- |
| —                  | `tool.execute.before` (write/edit) | `gate.js guard` — **throws on exit 2** → blocks writes to CLAUDE.md / AGENTS.md while a run is armed |
| `PostToolUse`      | `tool.execute.after` (write/edit) | `gate.js quick` (LSP, per-edit) — formats, never blocks |
| `SubagentStop`     | `tool.execute.after` (task)       | `gate.js full` — **throws on exit 2** → blocks the subagent |
| `Stop`             | `event` + `session.idle`          | `gate.js full` — **active re-prompt via `promptAsync`** on exit 2 |

`guard` keeps house-rule files (CLAUDE.md / AGENTS.md) out of agent reach while a
ristretto run is armed — a write/edit that targets one throws before the tool
executes, so the file is never touched. The LSP-driven format runs on every
didOpen/didChange. Subagent-stop blocks any subagent whose tree is red. Session.idle
is **active**: a red tree at session end fires `promptAsync` to tell the model to fix
the failures and retry, capped per session. No `.ristretto.json` or outside a pull →
gates exit immediately, unchanged.
