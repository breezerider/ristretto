#!/usr/bin/env node
// ristretto — OpenCode installer.
//
// Usage: npx ristretto --opencode
//
// Copies the plugin, commands, and gate runner into the OpenCode config dir
// (the "installation prefix"), then registers the plugin in opencode.json[c].
// OpenCode auto-discovers plugins/*.mjs, so the copy alone would load it — the
// config edit is belt-and-suspenders and matches the declarative path.
//
// Layout written (OpenCode's opencode.jsonc is preferred over opencode.json):
//   <prefix>/plugins/ristretto.mjs   (the plugin)
//   <prefix>/commands/*.md           (slash-command prompts, paths baked absolute)
//   <prefix>/ristretto/gate.js       (gate runner)
//   <prefix>/ristretto/version.js    (format-version check)
//   <prefix>/ristretto/format-migration.md  (format migration guide)
//   <prefix>/ristretto/testreport.js (report reader, required by gate.js)
//   <prefix>/ristretto/junit.js      (JUnit reader, required by testreport.js)
//   <prefix>/ristretto/baseline.js   (failure-ratchet, required by gate.js)
//   <prefix>/scripts/gate-lsp.mjs    (LSP adapter)
//
// The plugin resolves its root from its own file: <prefix>. It finds commands/
// there and the gate runner under ristretto/ (see .opencode/plugin/index.ts).
// OpenCode command templates have no runtime ${VAR} interpolation, so the
// installer rewrites every ${CLAUDE_PLUGIN_ROOT}/... reference in commands/ to the
// absolute installed path (see writeCommand below).

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Package root: <pkg>/bin/install.mjs → <pkg>
const PKG_ROOT = path.join(__dirname, "..")

// --- Config dir resolution (OpenCode) -------------------------------------------
// Global: ~/.config/opencode (XDG). Local: <project>/.opencode. --local forces the
// project dir; otherwise prefer global, falling back to local if no global config.
function resolvePrefix() {
  const local = process.env.OPENCODE_CONFIG_DIR || path.join(process.cwd(), ".opencode")
  const global = process.env.OPENCODE_CONFIG_DIR
    || (process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, "opencode")
      : path.join(process.env.HOME || process.env.USERPROFILE, ".config", "opencode"))

  if (process.argv.includes("--local")) return local
  if (process.argv.includes("--global")) return global
  // Default: global if it exists, else local.
  return existsSync(global) ? global : local
}

function copy(src, dest) {
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  console.log(`  ${path.relative(process.cwd(), dest)}`)
}

// Preferred config file is opencode.jsonc — it is the one OpenCode loads first
// and the one users actually edit (it holds default_agent, providers, mcp, etc.).
// Fall back to opencode.json. Both are merged by OpenCode, so we target whichever
// exists; if neither, create opencode.json.
function resolveConfigPath(prefix) {
  const jsonc = path.join(prefix, "opencode.jsonc")
  const json = path.join(prefix, "opencode.json")
  if (existsSync(jsonc)) return jsonc
  return json // exists or will be created
}

// Insert pluginRef into the `plugin` array by editing the raw text, so a .jsonc
// file's comments and formatting survive. Returns true if it wrote the file.
function insertIntoPluginArray(configPath, pluginRef) {
  const raw = readFileSync(configPath, "utf8")
  const tree = parseTree(raw)
  const arr = tree && findNodeAtLocation(tree, ["plugin"])
  // Array nodes carry items in `children`, not `value`. Verify it's really an array.
  if (!arr || arr.type !== "array") return false // no plugin array — leave it
  const existing = arr.children.map((c) => c.value)
  if (existing.includes(pluginRef)) return false // already registered

  // Append `pluginRef` at the end of the array. isArrayInsertion tells modify()
  // to insert at that index rather than overwrite.
  const edits = modify(raw, ["plugin", existing.length], pluginRef, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
    isArrayInsertion: true,
  })
  writeFileSync(configPath, applyEdits(raw, edits))
  return true
}

// Register the LSP server (per-edit format feedback) under the `lsp` key.
// OpenCode spawns it per project; it runs gate.js `quick` on didOpen/didChange.
function registerLsp(prefix) {
  const configPath = resolveConfigPath(prefix)
  const lspRef = {
    command: ["node", path.join(prefix, "scripts", "gate-lsp.mjs")],
    extensions: [".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".json", ".md"],
  }

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf8")
    const tree = parseTree(raw)
    const node = tree && findNodeAtLocation(tree, ["lsp", "ristretto"])
    if (node) return // already registered
    const edits = modify(raw, ["lsp", "ristretto"], lspRef, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    writeFileSync(configPath, applyEdits(raw, edits))
    console.log(`registered ristretto LSP in ${configPath}`)
    return
  }

  // No config yet — create a minimal opencode.json.
  writeFileSync(configPath, JSON.stringify({ lsp: { ristretto: lspRef } }, null, 2) + "\n")
  console.log(`created ${configPath}`)
}

function registerPlugin(prefix) {
  const configPath = resolveConfigPath(prefix)
  const pluginRef = "./plugins/ristretto.mjs"

  // .jsonc is edited structurally via jsonc-parser to preserve comments/format.
  // If the plugin key is absent, leave the file untouched and warn — never munge.
  if (existsSync(configPath)) {
    if (insertIntoPluginArray(configPath, pluginRef)) {
      console.log(`registered ristretto in ${configPath}`)
    } else {
      console.log(`ristretto already registered in ${configPath}`)
    }
    return
  }

  // No config yet — create a minimal opencode.json.
  writeFileSync(configPath, JSON.stringify({ plugin: [pluginRef] }, null, 2) + "\n")
  console.log(`created ${configPath}`)
}

const prefix = resolvePrefix()
console.log(`Installing ristretto into ${prefix}`)

copy(path.join(PKG_ROOT, ".opencode", "plugins", "ristretto.mjs"), path.join(prefix, "plugins", "ristretto.mjs"))
copy(path.join(PKG_ROOT, "scripts", "gate.js"), path.join(prefix, "ristretto", "gate.js"))
// gate.js requires ./testreport, ./baseline and ./junit at module load — if the
// installed copy lacks them, the runner dies on `require` before the first gate.
// testreport.js itself requires ./junit. Copy all three beside the gate runner.
copy(path.join(PKG_ROOT, "scripts", "testreport.js"), path.join(prefix, "ristretto", "testreport.js"))
copy(path.join(PKG_ROOT, "scripts", "junit.js"), path.join(prefix, "ristretto", "junit.js"))
copy(path.join(PKG_ROOT, "scripts", "baseline.js"), path.join(prefix, "ristretto", "baseline.js"))
copy(path.join(PKG_ROOT, "scripts", "gate-lsp.mjs"), path.join(prefix, "scripts", "gate-lsp.mjs"))
// Copy version.js, then patch the installed copy's manifest path. The source file is shared
// Claude Code code and must not be edited, but its hardcoded ../.claude-plugin/plugin.json
// path points at a manifest the opencode install does not (and should not) carry — that
// layout is Claude-Code-specific. So the installer drops plugin.json next to it and rewrites
// the path inside the *installed* copy to read from there. The source stays untouched.
const installedVersionJs = path.join(prefix, "ristretto", "version.js")
copy(path.join(PKG_ROOT, "scripts", "version.js"), installedVersionJs)
copy(path.join(PKG_ROOT, ".claude-plugin", "plugin.json"), path.join(prefix, "ristretto", "plugin.json"))
// Patch string must match version.js exactly (path.join(__dirname, '..', '.claude-plugin', 'plugin.json')).
writeFileSync(
  installedVersionJs,
  readFileSync(installedVersionJs, "utf8").replace(
    "path.join(__dirname, '..', '.claude-plugin', 'plugin.json')",
    "path.join(__dirname, 'plugin.json')",
  ),
)
copy(path.join(PKG_ROOT, "docs", "format-migration.md"), path.join(prefix, "ristretto", "format-migration.md"))

// --- Command packaging -----------------------------------------------------------
// Installed command files are prefixed `ristretto-<name>.md` and their bodies have
// `/ristretto:` rewritten to `/ristretto-` (OpenCode command keys are flat). The
// plugin's loadCommands skips the prefix when already present and the body rewrite
// is idempotent, so the installed files load as-is.
//
// OpenCode command templates support no `${VAR}` interpolation at runtime (unlike
// Claude Code's `${CLAUDE_PLUGIN_ROOT}`), so the installer bakes the installed
// asset paths to absolutes: every `${CLAUDE_PLUGIN_ROOT}/...` reference is rewritten
// to the concrete file it resolves to under the install prefix. The plugin root
// differs from the package layout — gate runner + helpers land in <prefix>/ristretto/,
// not <prefix>/scripts/ — so each reference maps to its on-disk location.
const NAMESPACE_RE = /\/ristretto:([a-zA-Z0-9-]+)/g

function writeCommand(src, dest) {
  mkdirSync(path.dirname(dest), { recursive: true })
  const raw = readFileSync(src, "utf8")
  // Surrounding quotes/backticks already live in the text — replace the placeholder
  // path once per asset, keeping whatever quoting the command carries.
  const body = raw
    .replace(NAMESPACE_RE, "/ristretto-$1")
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/scripts/gate.js", path.join(prefix, "ristretto", "gate.js"))
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/scripts/version.js", path.join(prefix, "ristretto", "version.js"))
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/docs/format-migration.md", path.join(prefix, "ristretto", "format-migration.md"))
    // Any other ${CLAUDE_PLUGIN_ROOT} reference → the install prefix (no further mapping).
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", prefix)
  writeFileSync(dest, body)
  console.log(`  ${path.relative(process.cwd(), dest)}`)
}

const commandsDir = path.join(PKG_ROOT, "commands")
for (const file of readdirSync(commandsDir).filter((f) => f.endsWith(".md"))) {
  writeCommand(path.join(commandsDir, file), path.join(prefix, "commands", `ristretto-${file}`))
}

registerPlugin(prefix)
registerLsp(prefix)
console.log("Restart OpenCode, then confirm with /ristretto-help.")
