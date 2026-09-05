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
//   <prefix>/plugins/ristretto.mjs             (the plugin)
//   <prefix>/ristretto/skills/ristretto-*.md   (slash-command prompts, paths baked absolute)
//   <prefix>/ristretto/gate.js                 (gate runner)
//   <prefix>/ristretto/version.js              (format-version check, patched)
//   <prefix>/ristretto/format-migration.md     (format migration guide)
//   <prefix>/ristretto/testreport.js           (report reader, required by gate.js)
//   <prefix>/ristretto/junit.js                (JUnit reader, required by testreport.js)
//   <prefix>/ristretto/baseline.js             (failure-ratchet, required by gate.js)
//   <prefix>/ristretto/gate-lsp.mjs            (LSP adapter)
//   <prefix>/ristretto/plugin.json             (version stamp for migrations)
//
// The plugin resolves its root from its own file: <prefix>. It finds
// ristretto/skills/ there and the gate runner under ristretto/ (see
// .opencode/plugin/index.ts). OpenCode command templates have no runtime ${VAR}
// interpolation, so the installer rewrites every ${CLAUDE_PLUGIN_ROOT}/...
// reference in commands/ to the absolute installed path (see writeCommand below).

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
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

// Wipe a directory before writing fresh contents into it. force: true makes this
// a no-op when the directory doesn't exist (first install never fails on the
// clean step — there is nothing to clean). ristretto.jsonc lives at
// <prefix>/ristretto.jsonc, outside the cleaned dir, so it survives.
export function cleanDir(p) {
  rmSync(p, { recursive: true, force: true })
}

// Version-gated migration from the pre-0.16 layout. Reads
// <prefix>/ristretto/plugin.json (already written by a prior install at line ~157
// in the legacy flow); when its version is < 0.16, deletes the stale
// <prefix>/commands/ristretto-*.md files. Missing plugin.json → first install,
// nothing to migrate. MAJOR.MINOR numeric compare — the same comparison
// scripts/version.js makes.
export function migrate(prefix) {
  const manifest = path.join(prefix, "ristretto", "plugin.json")
  if (!existsSync(manifest)) return // first install — nothing to migrate
  let installed
  try {
    installed = JSON.parse(readFileSync(manifest, "utf8")).version
  } catch { return } // unparseable — leave existing files alone
  const m = /^(\d+)\.(\d+)/.exec(String(installed))
  if (!m) return
  const [, majStr, minStr] = m
  const maj = Number(majStr), min = Number(minStr)
  if (maj > 0 || (maj === 0 && min >= 16)) return // already 0.16 or newer
  // pre-0.16 layout: commands lived at <prefix>/commands/ristretto-*.md
  const oldDir = path.join(prefix, "commands")
  if (!existsSync(oldDir)) return
  for (const f of readdirSync(oldDir).filter((f) => f.startsWith("ristretto-") && f.endsWith(".md"))) {
    rmSync(path.join(oldDir, f), { force: true })
  }
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
    command: ["node", path.join(prefix, "ristretto", "gate-lsp.mjs")],
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

function writeCommand(src, dest, prefix) {
  mkdirSync(path.dirname(dest), { recursive: true })
  const raw = readFileSync(src, "utf8")
  // Surrounding quotes/backticks already live in the text — replace the placeholder
  // path once per asset, keeping whatever quoting the command carries.
  // One prefix rule per directory: every <prefix>/scripts/* and <prefix>/docs/*
  // reference resolves to <prefix>/ristretto/* (the unified installed layout).
  // Enumerating files individually would silently miss new ones (e.g. testreport.js).
  const ristrettoDir = path.join(prefix, "ristretto")
  const body = raw
    .replace(NAMESPACE_RE, "/ristretto-$1")
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/scripts/", ristrettoDir + "/")
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/docs/", ristrettoDir + "/")
    // Any other ${CLAUDE_PLUGIN_ROOT} reference → the install prefix.
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", prefix)
  writeFileSync(dest, body)
  console.log(`  ${path.relative(process.cwd(), dest)}`)
}

export function install(prefix = resolvePrefix(), pkgRoot = PKG_ROOT) {
  console.log(`Installing ristretto into ${prefix}`)

  // Pre-0.16 layouts had commands in <prefix>/commands/ristretto-*.md; delete them
  // before writing the new layout so OpenCode's auto-discovery glob doesn't pick
  // them up as duplicate commands. Runs before the clean step because migrate reads
  // <prefix>/ristretto/plugin.json — the clean step wipes that file out.
  migrate(prefix)

  // Wipe <prefix>/ristretto/ before writing fresh contents. force: true makes
  // this a no-op on first install (the dir doesn't exist yet). ristretto.jsonc
  // lives at <prefix>/ristretto.jsonc — outside the cleaned dir, so it survives.
  cleanDir(path.join(prefix, "ristretto"))
  mkdirSync(path.join(prefix, "ristretto"), { recursive: true })

  copy(path.join(pkgRoot, ".opencode", "plugins", "ristretto.mjs"), path.join(prefix, "plugins", "ristretto.mjs"))
  // Gate runner + helpers all live under ristretto/ now (single layout).
  copy(path.join(pkgRoot, "ristretto", "gate.js"), path.join(prefix, "ristretto", "gate.js"))
  // gate.js requires ./testreport, ./baseline and ./junit at module load — if the
  // installed copy lacks them, the runner dies on `require` before the first gate.
  // testreport.js itself requires ./junit. Copy all three beside the gate runner.
  copy(path.join(pkgRoot, "ristretto", "testreport.js"), path.join(prefix, "ristretto", "testreport.js"))
  copy(path.join(pkgRoot, "ristretto", "junit.js"), path.join(prefix, "ristretto", "junit.js"))
  copy(path.join(pkgRoot, "ristretto", "baseline.js"), path.join(prefix, "ristretto", "baseline.js"))
  // LSP server moves from <prefix>/scripts/ to <prefix>/ristretto/ alongside gate.js.
  copy(path.join(pkgRoot, "ristretto", "gate-lsp.mjs"), path.join(prefix, "ristretto", "gate-lsp.mjs"))
  // Copy version.js — already patched by scripts/build-ristretto.mjs to read
  // plugin.json from beside it (`plugin.json` rather than `../.claude-plugin/plugin.json`).
  // The installer only needs to drop the source files where the staged layout expects them.
  const installedVersionJs = path.join(prefix, "ristretto", "version.js")
  copy(path.join(pkgRoot, "ristretto", "version.js"), installedVersionJs)
  copy(path.join(pkgRoot, "ristretto", "plugin.json"), path.join(prefix, "ristretto", "plugin.json"))
  copy(path.join(pkgRoot, "ristretto", "format-migration.md"), path.join(prefix, "ristretto", "format-migration.md"))

  // Commands land at <prefix>/ristretto/skills/ristretto-<name>.md — invisible to
  // OpenCode's {command,commands}/**/*.md auto-discovery glob, so co-installed
  // plugins stop colliding. The plugin's config hook is the sole registration path.
  // The staged tree already names these files with the ristretto- prefix
  // (scripts/build-ristretto.mjs stages ristretto/skills/ristretto-<name>.md),
  // so we copy each one to its staged filename as-is — no second ristretto- prefix.
  const commandsDir = path.join(pkgRoot, "ristretto", "skills")
  for (const file of readdirSync(commandsDir).filter((f) => f.startsWith("ristretto-") && f.endsWith(".md"))) {
    writeCommand(path.join(commandsDir, file), path.join(prefix, "ristretto", "skills", file), prefix)
  }

  registerPlugin(prefix)
  registerLsp(prefix)
  console.log("Restart OpenCode, then confirm with /ristretto-help.")
}

// Run only when invoked as a script. `import { install } from "./install.mjs"` in
// a test never triggers the side effects — cleanDir/migrate/install are called
// explicitly, and the script invocation is gated on argv[1].
const isMain = process.argv[1] && realpathSync(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) install()
