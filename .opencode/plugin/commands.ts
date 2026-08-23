import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

// --- Command loading --------------------------------------------------------------
// Each commands/<name>.md registers as `/ristretto-<name>`. Frontmatter yields the
// description; the markdown body is the template. `$ARGUMENTS` already works verbatim.
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
    if (!file.endsWith(".md")) continue
    const name = file.slice(0, -3)
    const raw = readFileSync(path.join(dir, file), "utf8")
    const { description, body } = parseFrontmatter(raw)
    // Installed command files are already prefixed `ristretto-<name>.md`; the npm
    // package ships bare `<name>.md`. Skip the prefix when already present.
    const key = name.startsWith("ristretto-") ? name : `ristretto-${name}`
    out.push({
      key,
      description: description || DEFAULT_DESCRIPTION,
      // Only rewrite in the body — frontmatter never carries the namespace. The
      // rewrite is idempotent, so installed (already-rewritten) files load as-is.
      template: body.replace(NAMESPACE_RE, "/ristretto-$1"),
    })
  }
  return out
}

function parseFrontmatter(raw: string): { description?: string; body: string } {
  if (!raw.startsWith("---\n")) return { body: raw }
  const end = raw.indexOf("\n---\n", 4)
  if (end === -1) return { body: raw }
  const fm = raw.slice(4, end)
  const body = raw.slice(end + 5)
  const m = fm.match(/^description:\s*(.+)$/m)
  return { description: m ? m[1].trim() : undefined, body }
}
