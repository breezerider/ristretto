// Adapter self-check for the OpenCode plugin. Run with: bun test .opencode/plugin/adapter.test.ts
// Covers command loading, namespace rewrite, the gate bridge hook mapping, the
// session.idle promptAsync orchestrator, and the LSP server (per-edit format).
import { test, expect } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { loadCommands } from "./commands.ts"
import { RistrettoPlugin } from "../plugins/ristretto.mjs"

const REPO = path.join(import.meta.dir, "..", "..")

function tmpProject(config: string, armed: boolean) {
  const dir = mkdtempSync(path.join(tmpdir(), "ristretto-adapter-"))
  writeFileSync(path.join(dir, ".ristretto.json"), config)
  if (armed) {
    mkdirSync(path.join(dir, ".ristretto"), { recursive: true })
    writeFileSync(path.join(dir, ".ristretto", "pulling"), "")
  }
  return dir
}

test("every commands/*.md registers as ristretto-<name> with template + description", () => {
  const cmds = loadCommands(path.join(REPO, "commands"))
  expect(cmds.length).toBeGreaterThan(0)
  for (const c of cmds) {
    expect(c.key).toMatch(/^ristretto-[a-z]+$/)
    expect(c.template.length).toBeGreaterThan(0)
    expect(c.description.length).toBeGreaterThan(0)
  }
})

test("namespace /ristretto: is rewritten to /ristretto- in bodies", () => {
  const [cmd] = loadCommands(path.join(REPO, "commands")).filter((c) => c.key === "ristretto-help")
  expect(cmd).toBeDefined()
  expect(cmd.template).not.toContain("/ristretto:")
  expect(cmd.template).toContain("/ristretto-help")
})

test("malformed/missing frontmatter falls back to the default description", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ristretto-fm-"))
  writeFileSync(path.join(dir, "no-fm.md"), "Just a body, no frontmatter")
  const [cmd] = loadCommands(dir)
  expect(cmd.description).toBe("ristretto command")
  expect(cmd.template).toBe("Just a body, no frontmatter")
})

const PASS = `node -e "process.exit(0)"`
const FAIL = `node -e "console.error('boom'); process.exit(1)"`

// Phase 1 removed the write/edit tool.execute.after branch — per-edit format now
// flows through the LSP server (scripts/gate-lsp.mjs), not a subprocess per edit.
test("write/edit no longer spawns gate.js quick (LSP owns per-edit format)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { format: `node -e "require('fs').appendFileSync(process.argv[1] + '.fmt', '')" {file}` } }), false)
  const touched = path.join(dir, "a.txt")
  writeFileSync(touched, "x")
  const plugin = await RistrettoPlugin({ directory: dir, worktree: dir } as any)
  await plugin["tool.execute.after"]!({ tool: "write", args: { filePath: touched } } as any, {} as any)
  // The quick gate must NOT have run — no .fmt sidecar.
  expect(existsSync(touched + ".fmt")).toBe(false)
})

test("task gate throws on gate.js exit 2 (blocks the subagent)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL, typecheck: FAIL, test: FAIL } }), true)
  const plugin = await RistrettoPlugin({ directory: dir, worktree: dir } as any)
  await expect(
    plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any),
  ).rejects.toThrow(/work is not done/)
})

test("task gate passes when gates are green (does not throw)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  const plugin = await RistrettoPlugin({ directory: dir, worktree: dir } as any)
  await plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any)
})

test("session.idle re-prompts the model when gates are red (promptAsync)", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL } }), true)
  const calls: any[] = []
  const client = { session: { promptAsync: async (o: any) => { calls.push(o) } } }
  const plugin = await RistrettoPlugin({ directory: dir, worktree: dir, client } as any)
  await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
  expect(calls.length).toBe(1)
  expect(calls[0].path.id).toBe("s1")
  expect(calls[0].body.parts[0].type).toBe("text")
})

test("session.idle does not re-prompt when gates are green", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
  const calls: any[] = []
  const client = { session: { promptAsync: async (o: any) => { calls.push(o) } } }
  const plugin = await RistrettoPlugin({ directory: dir, worktree: dir, client } as any)
  await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
  expect(calls.length).toBe(0)
})

test("session.idle stops re-prompting after the retry cap", async () => {
  const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL } }), true)
  const calls: any[] = []
  const client = { session: { promptAsync: async (o: any) => { calls.push(o) } } }
  const plugin = await RistrettoPlugin({ directory: dir, worktree: dir, client } as any)
  // 3 red idles → 3 prompts; the 4th is capped.
  for (let i = 0; i < 4; i++) {
    await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
  }
  expect(calls.length).toBe(3)
})

test("LSP server publishes a severity-1 diagnostic when the format gate changes a file", async () => {
  // Format gate appends to the file itself (like prettier --write) so the LSP's
  // before/after content check detects the change.
  const dir = tmpProject(JSON.stringify({ gates: { format: `node -e "require('fs').appendFileSync(process.argv[1], 'x')" {file}` } }), false)
  const file = path.join(dir, "a.txt")
  writeFileSync(file, "x")
  const lsp = path.join(REPO, "scripts", "gate-lsp.mjs")
  const child = spawn(process.execPath, [lsp], { stdio: ["pipe", "pipe", "pipe"] })
  let out = ""
  child.stdout.on("data", (d) => { out += d })
  const send = (msg: any) => {
    const body = JSON.stringify(msg)
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  send({ jsonrpc: "2.0", method: "initialized", params: {} })
  send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: "file://" + file } } })
  await new Promise((r) => setTimeout(r, 500))
  child.kill()
  expect(out).toContain("publishDiagnostics")
  expect(out).toContain('"severity":1')
  expect(out).toContain("auto-formatted by gate")
})

test("config hook registers all commands", async () => {
  const config: any = {}
  const plugin = await RistrettoPlugin({ directory: REPO, worktree: REPO } as any)
  await plugin.config!(config)
  expect(config.command["ristretto-help"]).toBeDefined()
  expect(config.command["ristretto-status"]).toBeDefined()
  expect(config.command["ristretto-prep"]).toBeDefined()
})

// --- Config + debug logging ---------------------------------------------------------
// ristretto.jsonc in the config dir (overridable via RISTRETTO_CONFIG) enables an
// append-only debug log. Test that a gate call and a failing gate each write to it.

function withDebugConfig(): { cfgDir: string; logPath: string } {
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-config-"))
  const logPath = path.join(cfgDir, "debug.log")
  writeFileSync(path.join(cfgDir, "ristretto.jsonc"), JSON.stringify({ debug: { logPath } }))
  return { cfgDir, logPath }
}

function readDebugLog(logPath: string): string {
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
}

async function withConfigEnv(cfgDir: string, fn: () => Promise<void>) {
  const prev = process.env.RISTRETTO_CONFIG
  process.env.RISTRETTO_CONFIG = cfgDir
  try { await fn() } finally {
    if (prev === undefined) delete process.env.RISTRETTO_CONFIG
    else process.env.RISTRETTO_CONFIG = prev
  }
}

test("debug log writes every gate call when ristretto.jsonc sets debug.logPath", async () => {
  const { cfgDir, logPath } = withDebugConfig()
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL } }), true)
    const plugin = await RistrettoPlugin({ directory: dir, worktree: dir, client: { session: { promptAsync: async () => {} } } } as any)
    await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
    await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
    const log = readDebugLog(logPath)
    expect(log).toContain("session.idle gate → exit 2")
    expect(log).toContain("message sent to model")
    expect(log).toContain("deterministic gates are red")
  })
  expect(readDebugLog(logPath)).toContain("session.idle gate → exit 2")
})

test("task gate failure logs the blocking message sent to the model", async () => {
  const { cfgDir, logPath } = withDebugConfig()
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL, typecheck: FAIL, test: FAIL } }), true)
    const plugin = await RistrettoPlugin({ directory: dir, worktree: dir } as any)
    await expect(plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any)).rejects.toThrow()
    const log = readDebugLog(logPath)
    expect(log).toContain("tool.execute.after task gate → exit 2")
    expect(log).toContain("Message sent to model")
    expect(log).toContain("work is not done")
  })
})

test("no ristretto.jsonc → no debug log is written", async () => {
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-config-")) // empty dir, no config file
  const logPath = path.join(cfgDir, "debug.log")
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: FAIL } }), true)
    const plugin = await RistrettoPlugin({ directory: dir, worktree: dir, client: { session: { promptAsync: async () => {} } } } as any)
    await plugin.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } as any })
    expect(existsSync(logPath)).toBe(false)
  })
})

// --- gate-spawn-node: runGate must spawn real node, never process.execPath ---
// Under opencode, process.execPath is opencode.exe — not a Node runtime. gate.js
// must be interpreted by a real `node` (or the configured path). The default and both
// config edges are covered here; the live-opencode proof is a manual check.

test("runGate spawns plain node by default, never process.execPath", async () => {
  const { cfgDir, logPath } = withDebugConfig()
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
    const plugin = await RistrettoPlugin({ directory: dir, worktree: dir } as any)
    await plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any)
  })
  const log = readDebugLog(logPath)
  expect(log).toMatch(/runGate spawn: node .*scripts[\\/]gate\.js full/)
  expect(log).not.toContain(process.execPath)
})

test("configured node path is used exactly as the gate.js interpreter (stub argv)", async () => {
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-nodecfg-"))
  const stubOut = path.join(cfgDir, "spawned.log")
  const stub = path.join(cfgDir, "fake-node.mjs")
  writeFileSync(stub,
    "#!/usr/bin/env node\n" +
    `import { appendFileSync } from "node:fs"\n` +
    `appendFileSync(${JSON.stringify(stubOut)}, JSON.stringify(process.argv) + "\\n")\n`)
  if (process.platform !== "win32") { chmodSync(stub, 0o755) }
  const logPath = path.join(cfgDir, "debug.log")
  writeFileSync(path.join(cfgDir, "ristretto.jsonc"),
    JSON.stringify({ nodejsPath: stub, debug: { logPath } }))

  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
    const plugin = await RistrettoPlugin({ directory: dir, worktree: dir } as any)
    await plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any)
  })

  const argv = JSON.parse(readFileSync(stubOut, "utf8"))
  expect(argv.includes(stub)).toBe(true)
  expect(argv.some((a: string) => a.endsWith("gate.js"))).toBe(true)
  expect(argv.includes("full")).toBe(true)
  expect(readDebugLog(logPath)).toContain(`runGate spawn: ${stub} `)
})

test("non-string node config falls back to plain node and never blocks", async () => {
  const cfgDir = mkdtempSync(path.join(tmpdir(), "ristretto-nodebad-"))
  const logPath = path.join(cfgDir, "debug.log")
  writeFileSync(path.join(cfgDir, "ristretto.jsonc"),
    JSON.stringify({ nodejsPath: 123, debug: { logPath } }))
  await withConfigEnv(cfgDir, async () => {
    const dir = tmpProject(JSON.stringify({ gates: { lint: PASS, typecheck: PASS, test: PASS } }), true)
    const plugin = await RistrettoPlugin({ directory: dir, worktree: dir } as any)
    await plugin["tool.execute.after"]!({ tool: "task", args: {} } as any, {} as any) // must not throw
    expect(readDebugLog(logPath)).toMatch(/runGate spawn: node /)
    expect(readDebugLog(logPath)).not.toContain(process.execPath)
  })
})
