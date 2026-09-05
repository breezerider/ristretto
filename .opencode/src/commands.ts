import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

// --- Command loading --------------------------------------------------------------
// Each ristretto/skills/ristretto-<name>.md registers as `/ristretto-<name>`. The
// directory is ristretto/skills/ (invisible to OpenCode's auto-discovery glob
// {command,commands}/**/*.md) so co-installed plugins' commands don't get re-keyed
// under our prefix. Frontmatter yields the description; the markdown body is the
// template. `$ARGUMENTS` already works verbatim.
//
// Kept in its own module so index.ts exports exactly one plugin-shaped function.
// OpenCode's legacy plugin loader treats every function export from a plugin module
// as a plugin; a stray export would be invoked with the plugin context and throw.

// Claude Code slash-namespace is `:`, OpenCode command keys are flat — rewrite in bodies.
const NAMESPACE_RE = /\/ristretto:([a-zA-Z0-9-]+)/g

const DEFAULT_DESCRIPTION = "ristretto command"

export type Command = { key: string; template: string; description: string }

export function loadCommands(dir: string): Command[] {
  const out: Command[] = []
  for (const file of readdirSync(dir).sort()) {
    // Filter to ristretto-prefixed files only. The directory lives at
    // ristretto/skills/, away from OpenCode's command glob, so non-ristretto .md
    // files here (if any sneak in) are picked up by name, not auto-discovered.
    if (!file.startsWith("ristretto-") || !file.endsWith(".md")) continue
    const name = file.slice(0, -3)
    const raw = readFileSync(path.join(dir, file), "utf8")
    const { description, body } = parseFrontmatter(raw)
    out.push({
      key: name,
      description: description || DEFAULT_DESCRIPTION,
      // Only rewrite in the body — frontmatter never carries the namespace. The
      // rewrite is idempotent, so installed (already-rewritten) files load as-is.
      template: body.replace(NAMESPACE_RE, "/ristretto-$1"),
    })
  }
  return out
}

// Folds `argument-hint` into `description` with " — " so OpenCode's palette
// surfaces both. OpenCode's Command schema has no arg field, so the only way to
// show the hint is via description. The regex is whole-line so inner colons
// in `[optional filter: "open", ...]` survive — a YAML `key: value` split
// would chop the hint at the first colon.
function parseFrontmatter(raw: string): { description?: string; body: string } {
  if (!raw.startsWith("---\n")) return { body: raw }
  const end = raw.indexOf("\n---\n", 4)
  if (end === -1) return { body: raw }
  const fm = raw.slice(4, end)
  const body = raw.slice(end + 5)
  const descM = fm.match(/^description:\s*(.+)$/m)
  const hintM = fm.match(/^argument-hint:\s*(.+)$/m)
  const description = descM ? descM[1].trim() : undefined
  const hint = hintM ? hintM[1].trim() : undefined
  let folded: string | undefined
  if (description && hint) folded = `${hint} — ${description}`
  else if (description) folded = description
  else if (hint) folded = hint
  return { description: folded, body }
}
