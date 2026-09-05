// README.opencode.test.ts — README describes the 0.16 layout, hook table, brew
// example, pin, and local-clone note. Run with: bun test README.opencode.test.ts
import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const README = readFileSync(path.join(process.cwd(), "README.opencode.md"), "utf8")

test("README describes the unified ristretto/skills/ install layout (not <prefix>/commands/)", () => {
  expect(README).toContain("ristretto/skills/")
  expect(README).not.toMatch(/<prefix>\/commands\/ristretto-\*\.md/)
})

test("README hook table has 4 rows including tool.execute.before", () => {
  expect(README).toContain("tool.execute.before")
  // Count hook rows in the table — every row is "| <name> | <name> | <effect> |".
  const tableRows = (README.match(/^\| [^|]+ \| [^|]+ \| [^|]+ \|$/gm) || [])
    .filter((line) => /tool\.execute|session\.idle/.test(line))
  expect(tableRows.length).toBeGreaterThanOrEqual(4)
})

test("README Stop row says active re-prompt via promptAsync (not advisory)", () => {
  expect(README).toContain("promptAsync")
  expect(README).not.toMatch(/Stop.*\b(advisory)\b/i)
})

test("README brew example shows [easy]", () => {
  expect(README).toMatch(/\/ristretto-brew \[easy\]/)
})

test("README pins @0.16.0", () => {
  expect(README).toContain("@0.16.0")
  expect(README).not.toMatch(/@0\.(12|15)\.0/)
})

test("README mentions local-clone requires bun run build", () => {
  expect(README).toMatch(/local.?clone/i)
  expect(README).toMatch(/bun run build/)
})
