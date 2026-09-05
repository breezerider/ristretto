#!/usr/bin/env node
// Stages the shipped ristretto/ tree from the source layout. Source files
// stay in place — this builds the published artifact only. Run by `bun run
// build`, which the npm test/prepack pipelines invoke.
//
// Layout produced (one tree, all three install paths read from the same files):
//   ristretto/skills/ristretto-*.md   slash-command prompts
//   ristretto/gate.js                 gate runner
//   ristretto/gate-lsp.mjs            LSP server (per-edit format)
//   ristretto/testreport.js           report reader (required by gate.js)
//   ristretto/junit.js                JUnit reader (required by testreport.js)
//   ristretto/baseline.js             failure-ratchet (required by gate.js)
//   ristretto/version.js              format-version check
//   ristretto/plugin.json             installed manifest (version stamp)
//   ristretto/format-migration.md     format migration guide
//
// `version.js`'s hardcoded plugin.json path is rewritten from `..` (Claude Code
// layout) to `.` (ristretto/ layout). Same logic the installer runs today; we
// hoist it to the build step so the artifact is self-contained.

import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// scripts/{gate,testreport,junit,baseline,version}.js → ristretto/. These shared
// modules stay at <repo>/scripts/ (consumed by Claude Code too); the OpenCode
// build reads them from there. gate-lsp.mjs is OpenCode-only and lives beside
// this script under .opencode/scripts/.
const PKG_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))
const STAGE = path.join(PKG_ROOT, "ristretto")
const SKILLS = path.join(STAGE, "skills")
mkdirSync(SKILLS, { recursive: true })

// commands/*.md → ristretto/skills/ristretto-<name>.md (the prefix is load-bearing:
// the loader's filter is `ristretto-*.md`, matching the install convention).
const commandsSrc = path.join(PKG_ROOT, "commands")
for (const f of readdirSync(commandsSrc).filter((f) => f.endsWith(".md"))) {
  copyFileSync(path.join(commandsSrc, f), path.join(SKILLS, `ristretto-${f}`))
}

// scripts/{gate,testreport,junit,baseline,version}.js → ristretto/
for (const name of ["gate.js", "testreport.js", "junit.js", "baseline.js", "version.js"]) {
  copyFileSync(path.join(PKG_ROOT, "scripts", name), path.join(STAGE, name))
}
// gate-lsp.mjs is OpenCode-only — lives beside this script, not under scripts/.
copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "gate-lsp.mjs"), path.join(STAGE, "gate-lsp.mjs"))

// .claude-plugin/plugin.json → ristretto/plugin.json
copyFileSync(path.join(PKG_ROOT, ".claude-plugin", "plugin.json"), path.join(STAGE, "plugin.json"))

// docs/format-migration.md → ristretto/format-migration.md
copyFileSync(path.join(PKG_ROOT, "docs", "format-migration.md"), path.join(STAGE, "format-migration.md"))

// Patch version.js to read plugin.json from beside it. Source file is shared with
// Claude Code (where plugin.json lives at ../.claude-plugin/plugin.json) and must
// not be edited — only the staged copy gets the rewrite.
const stagedVersionJs = path.join(STAGE, "version.js")
writeFileSync(stagedVersionJs, readFileSync(stagedVersionJs, "utf8").replace(
  "path.join(__dirname, '..', '.claude-plugin', 'plugin.json')",
  "path.join(__dirname, 'plugin.json')",
))
