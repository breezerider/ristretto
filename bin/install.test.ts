// bin/install.test.ts — exercise the version-gated migration, the clean step, and
// the install path. Run with: bun test bin/install.test.ts
//
// Each test uses a throwaway tmpdir as the install prefix — no shared filesystem
// state, no cleanup. `install(prefix)` is called with the tmpdir explicitly so the
// default `resolvePrefix()` (which reads ~/.config/opencode) never runs.
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, copyFileSync, symlinkSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { cleanDir, install, migrate } from "./install.mjs"

test("migrate deletes <prefix>/commands/ristretto-*.md when plugin.json version is < 0.16", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  mkdirSync(path.join(prefix, "ristretto"), { recursive: true })
  writeFileSync(path.join(prefix, "ristretto", "plugin.json"), JSON.stringify({ version: "0.15.0" }))
  mkdirSync(path.join(prefix, "commands"), { recursive: true })
  writeFileSync(path.join(prefix, "commands", "ristretto-help.md"), "old")
  writeFileSync(path.join(prefix, "commands", "ristretto-brew.md"), "old")
  writeFileSync(path.join(prefix, "commands", "other-plugin.md"), "stays")
  migrate(prefix)
  expect(existsSync(path.join(prefix, "commands", "ristretto-help.md"))).toBe(false)
  expect(existsSync(path.join(prefix, "commands", "ristretto-brew.md"))).toBe(false)
  expect(existsSync(path.join(prefix, "commands", "other-plugin.md"))).toBe(true)
})

test("migrate is a no-op when <prefix>/ristretto/plugin.json is absent (first install)", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  mkdirSync(path.join(prefix, "commands"), { recursive: true })
  writeFileSync(path.join(prefix, "commands", "ristretto-help.md"), "stays")
  migrate(prefix)
  expect(existsSync(path.join(prefix, "commands", "ristretto-help.md"))).toBe(true)
})

test("migrate is a no-op when plugin.json version is >= 0.16", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  mkdirSync(path.join(prefix, "ristretto"), { recursive: true })
  writeFileSync(path.join(prefix, "ristretto", "plugin.json"), JSON.stringify({ version: "0.16.0" }))
  mkdirSync(path.join(prefix, "commands"), { recursive: true })
  writeFileSync(path.join(prefix, "commands", "ristretto-help.md"), "stays")
  migrate(prefix)
  expect(existsSync(path.join(prefix, "commands", "ristretto-help.md"))).toBe(true)
})

test("cleanDir is a no-op on a non-existent directory (force: true)", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  const dir = path.join(prefix, "ristretto") // never created
  expect(() => cleanDir(dir)).not.toThrow()
  expect(existsSync(dir)).toBe(false)
})

test("install writes commands to <prefix>/ristretto/skills/, LSP to <prefix>/ristretto/gate-lsp.mjs, not <prefix>/commands/", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  install(prefix)
  // 8 commands land under ristretto/skills/ristretto-*.md
  const skillsDir = path.join(prefix, "ristretto", "skills")
  const installed = readdirSync(skillsDir).filter((f) => f.startsWith("ristretto-") && f.endsWith(".md"))
  expect(installed.length).toBe(8)
  for (const name of ["brew", "grind", "help", "prep", "pull", "shot", "status", "tamp"]) {
    expect(installed).toContain(`ristretto-${name}.md`)
  }
  // No commands under <prefix>/commands/ — that dir never gets created
  expect(existsSync(path.join(prefix, "commands"))).toBe(false)
  // LSP moves to <prefix>/ristretto/gate-lsp.mjs
  expect(existsSync(path.join(prefix, "ristretto", "gate-lsp.mjs"))).toBe(true)
  expect(existsSync(path.join(prefix, "scripts", "gate-lsp.mjs"))).toBe(false)
  // plugin.json lands at <prefix>/ristretto/plugin.json carrying 0.16.0
  const pluginJson = JSON.parse(readFileSync(path.join(prefix, "ristretto", "plugin.json"), "utf8"))
  expect(pluginJson.version).toBe("0.16.0")
})

test("install runs migrate first: a pre-0.16 install's <prefix>/commands/ristretto-*.md get deleted before the new layout is written", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  // Seed a pre-0.16 install
  mkdirSync(path.join(prefix, "ristretto"), { recursive: true })
  writeFileSync(path.join(prefix, "ristretto", "plugin.json"), JSON.stringify({ version: "0.15.0" }))
  mkdirSync(path.join(prefix, "commands"), { recursive: true })
  writeFileSync(path.join(prefix, "commands", "ristretto-help.md"), "stale")
  install(prefix)
  // migrate ran before the new layout — stale file deleted, new layout under ristretto/skills/
  expect(existsSync(path.join(prefix, "commands", "ristretto-help.md"))).toBe(false)
  expect(existsSync(path.join(prefix, "ristretto", "skills", "ristretto-help.md"))).toBe(true)
  // Clean step ran — the pre-existing ristretto/ dir was wiped and rewritten
  expect(existsSync(path.join(prefix, "ristretto", "plugin.json"))).toBe(true)
})

test("installed commands carry no ${CLAUDE_PLUGIN_ROOT} residuals and no <prefix>/scripts/ paths", () => {
  // Path-baking must convert every ${CLAUDE_PLUGIN_ROOT}/scripts/* and
  // ${CLAUDE_PLUGIN_ROOT}/docs/* to <prefix>/ristretto/*. Enumerating the files
  // individually would silently miss new ones (testreport.js was the bug).
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  install(prefix)
  const skillsDir = path.join(prefix, "ristretto", "skills")
  for (const f of readdirSync(skillsDir).filter((f) => f.endsWith(".md"))) {
    const body = readFileSync(path.join(skillsDir, f), "utf8")
    expect(body).not.toContain("${CLAUDE_PLUGIN_ROOT}")
    expect(body).not.toContain(prefix + "/scripts/")
  }
})

test("ristretto-pull's testreport.js reference resolves to a file that exists on disk", () => {
  // The bug a future contributor would hit: a new scripts/*.js reference that
  // doesn't have a per-file rewrite silently falls through to <prefix>/scripts/.
  // pull.md references testreport.js for `--probe` — verify that path exists.
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-install-"))
  install(prefix)
  const pullBody = readFileSync(path.join(prefix, "ristretto", "skills", "ristretto-pull.md"), "utf8")
  const m = pullBody.match(/node "([^"]*testreport\.js)" --probe/)
  expect(m).not.toBeNull()
  expect(existsSync(m![1])).toBe(true)
})

test("install runs when invoked via a symlink (npm/npx .bin/ristretto path)", () => {
  // Bug 1 — isMain used path.resolve(process.argv[1]), which does NOT follow
  // symlinks. npm/npx invokes the bin via a symlink; install() silently no-op'd.
  const tmp = mkdtempSync(path.join(tmpdir(), "ristretto-symlink-"))
  const prefix = path.join(tmp, "prefix")
  mkdirSync(prefix, { recursive: true })

  const real = path.resolve("bin/install.mjs")
  const link = path.join(tmp, "ristretto-link.mjs")
  symlinkSync(real, link)

  // OPENCODE_CONFIG_DIR pins resolvePrefix() to <prefix>. PKG_ROOT resolves to
  // the real repo (has both source and staged trees), so this test isolates Bug 1.
  const result = spawnSync("node", [link], {
    env: { ...process.env, OPENCODE_CONFIG_DIR: prefix },
    encoding: "utf8",
  })
  expect(result.status).toBe(0)
  const skillsDir = path.join(prefix, "ristretto", "skills")
  expect(existsSync(skillsDir)).toBe(true)
  const installed = readdirSync(skillsDir).filter((f) => f.startsWith("ristretto-") && f.endsWith(".md"))
  expect(installed.length).toBe(8)
})

test("install reads from <pkgRoot>/ristretto/ when pkgRoot contains only the shipped tree (no commands/, no .claude-plugin/)", () => {
  // Bug 2 — installer previously read .claude-plugin/plugin.json and commands/,
  // which are source-layout paths absent from the npm tarball. Stage a temp
  // pkgRoot containing ONLY the shipped tree (ristretto/ + .opencode/plugins/
  // ristretto.mjs) and prove install() succeeds. A unique marker in
  // pkgRoot/ristretto/plugin.json proves the read came from pkgRoot (not PKG_ROOT).
  const prefix = mkdtempSync(path.join(tmpdir(), "ristretto-pkg-"))
  const pkgRoot = mkdtempSync(path.join(tmpdir(), "ristretto-root-"))
  const realRistretto = path.resolve("ristretto")
  const realPlugin = path.resolve(".opencode", "plugins", "ristretto.mjs")

  // Mirror the npm tarball layout.
  mkdirSync(path.join(pkgRoot, "ristretto", "skills"), { recursive: true })
  for (const f of readdirSync(realRistretto)) {
    const src = path.join(realRistretto, f)
    const dest = path.join(pkgRoot, "ristretto", f)
    if (f === "skills") {
      for (const g of readdirSync(src)) {
        copyFileSync(path.join(src, g), path.join(dest, g))
      }
    } else {
      copyFileSync(src, dest)
    }
  }
  mkdirSync(path.join(pkgRoot, ".opencode", "plugins"), { recursive: true })
  copyFileSync(realPlugin, path.join(pkgRoot, ".opencode", "plugins", "ristretto.mjs"))

  // Sanity — packaged root must NOT contain the source-layout paths the fix removes.
  expect(existsSync(path.join(pkgRoot, "commands"))).toBe(false)
  expect(existsSync(path.join(pkgRoot, ".claude-plugin"))).toBe(false)

  // Stamp a marker on the staged plugin.json so we can prove install read from
  // pkgRoot (not from PKG_ROOT/.claude-plugin/plugin.json, the source path).
  const MARKER = "9.99.99-from-pkgRoot"
  writeFileSync(path.join(pkgRoot, "ristretto", "plugin.json"),
    JSON.stringify({ name: "ristretto", version: MARKER }))

  // Act — must complete without ENOENT.
  expect(() => install(prefix, pkgRoot)).not.toThrow()

  // (a) plugin.json came from <pkgRoot>/ristretto/plugin.json (marker survives).
  const pluginJson = JSON.parse(readFileSync(path.join(prefix, "ristretto", "plugin.json"), "utf8"))
  expect(pluginJson.version).toBe(MARKER)

  // (b) commands landed at <prefix>/ristretto/skills/ristretto-<name>.md, exact staged names, no double-prefix.
  const skillsDir = path.join(prefix, "ristretto", "skills")
  const installed = readdirSync(skillsDir).filter((f) => f.endsWith(".md"))
  expect(installed.length).toBe(8)
  for (const f of installed) {
    expect(f).not.toMatch(/ristretto-ristretto-/)
    expect(f.startsWith("ristretto-")).toBe(true)
  }
  for (const name of ["brew", "grind", "help", "prep", "pull", "shot", "status", "tamp"]) {
    expect(installed).toContain(`ristretto-${name}.md`)
  }

  // (c) every staged file is present at the prefix; the plugin mjs lands at <prefix>/plugins/.
  for (const f of [
    "gate.js",
    "gate-lsp.mjs",
    "version.js",
    "testreport.js",
    "junit.js",
    "baseline.js",
    "format-migration.md",
    "plugin.json",
  ]) {
    expect(existsSync(path.join(prefix, "ristretto", f))).toBe(true)
  }
  expect(existsSync(path.join(prefix, "plugins", "ristretto.mjs"))).toBe(true)
})
