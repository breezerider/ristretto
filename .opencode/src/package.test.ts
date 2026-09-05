// package.test.ts — npm pack ships the staged ristretto/ tree, not the source
// commands/ or scripts/ paths. Run with: bun test package.test.ts
import { test, expect } from "bun:test"
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

const REPO = process.cwd()

test("package.json version is 0.16.0", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"))
  expect(pkg.version).toBe("0.16.0")
})

test("npm pack --dry-run ships ristretto/ contents, not commands/ or scripts/gate.js", () => {
  // --ignore-scripts skips the prepack build, so bun's stdout doesn't pollute
  // npm's JSON output. The staged ristretto/ tree is already on disk from the
  // outer `bun run build` that `npm test` invokes.
  const out = execSync("npm pack --dry-run --json --ignore-scripts", { cwd: REPO, encoding: "utf8" })
  const files: string[] = JSON.parse(out)[0].files.map((f: any) => f.path)
  expect(files.some((f) => f.startsWith("ristretto/"))).toBe(true)
  expect(files.some((f) => f.startsWith("commands/"))).toBe(false)
  expect(files).not.toContain("scripts/gate.js")
  expect(files).not.toContain("scripts/gate-lsp.mjs")
})
