import { spawn } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
// jsonc-parser's `main` is UMD (AMD-style `define`), which bundling under `--target node`
// emits as a broken require. Point at the real ESM build so it bundles cleanly.
import { parse } from "jsonc-parser/lib/esm/main.js"
import { type Plugin } from "@opencode-ai/plugin"
import { loadCommands } from "./commands.ts"

// --- Plugin root ------------------------------------------------------------------
// Resolves the package/project root that owns commands/ and scripts/. Two layouts:
//   npm package:  <pkg>/.opencode/plugins/ristretto.mjs → root = <pkg>
//   npx install:  <prefix>/plugins/ristretto.mjs        → root = <prefix>
// Walk up from this file's dir to the first ancestor containing commands/.
const PLUGIN_ROOT = (() => {
  let dir = import.meta.dir
  while (dir && dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, "commands"))) return dir
    dir = path.dirname(dir)
  }
  return path.join(import.meta.dir, "..", "..")
})()

// Commands live as markdown (single source of truth with the Claude Code plugin).
const COMMANDS_DIR = path.join(PLUGIN_ROOT, "commands")

// Gate runner. npx install copies it to <root>/ristretto/gate.js; the npm
// package keeps it at <root>/scripts/gate.js. Detect which layout we're in.
const GATE_JS = existsSync(path.join(PLUGIN_ROOT, "ristretto", "gate.js"))
  ? path.join(PLUGIN_ROOT, "ristretto", "gate.js")
  : path.join(PLUGIN_ROOT, "scripts", "gate.js")

// --- Plugin config ----------------------------------------------------------------
// ristretto.jsonc lives in the OpenCode config dir (== PLUGIN_ROOT for an npx install,
// the project .opencode dir for the npm layout). JSONC, must parse to a JSON object.
//   { "debug": { "logPath": "/abs/path/ristretto-debug.log" } }
// A missing/unparseable file, or no logPath, silently disables debug.
//
// RISTRETTO_CONFIG overrides the config dir (used by tests — points at a throwaway
// copy instead of the live config dir).
function configFile() {
  const dir = process.env.RISTRETTO_CONFIG || PLUGIN_ROOT
  return path.join(dir, "ristretto.jsonc")
}

// ristretto.jsonc config shape. Currently consumes debug.logPath and nodejsPath; the
// file must parse to an object and may grow.
type RistrettoConfig = { debug?: { logPath?: string }; nodejsPath?: string }

function loadConfig(): RistrettoConfig {
  try {
    const file = configFile()
    if (!existsSync(file)) return {}
    const val = parse(readFileSync(file, "utf8"))
    if (val && typeof val === "object" && !Array.isArray(val)) return val as RistrettoConfig
  } catch { /* broken/missing → no debug, never block the plugin */ }
  return {}
}

// Debug logging — append-only. Only enabled when ristretto.jsonc sets
// debug.logPath. Writes every gate call, and on failure the message the model is
// being sent.
function debugLog(msg: string) {
  // Read fresh each call: the file is tiny, and it makes the config both live-editable
  // and testable (RISTRETTO_CONFIG can switch config dirs mid-run).
  const cfg = loadConfig()
  const logPath = cfg.debug?.logPath
  if (!logPath) return
  try {
    mkdirSync(path.dirname(logPath), { recursive: true })
    appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* debug is best-effort — never break the plugin over a log write */ }
}

// --- Gate bridge ------------------------------------------------------------------
// Spawns gate.js (unchanged, shared with Claude Code) as a subprocess.
// CLAUDE_PROJECT_DIR points the gate at the project so it resolves .ristretto.json.
//
// Output is captured, never inherited, so a running gate can't spam the terminal or
// interleave with the model loop. A timeout kills a hung gate instead of blocking the
// turn. `fireAndForget` detaches the subprocess for the advisory session-idle gate —
// it must never stall turn end.
const GATE_TIMEOUT_MS = 30_000

function runGate(
  projectDir: string,
  mode: "quick" | "full",
  opts: { arg?: string; touchedFile?: string; fireAndForget?: boolean; captureOutput?: boolean } = {},
): Promise<{ code: number; output: string }> {
  const argv = [GATE_JS, mode, ...(opts.arg ? [opts.arg] : [])]
  // Resolve the node interpreter: optional `nodejsPath` from ristretto.jsonc, else PATH "node".
  // Never process.execPath — under opencode that is opencode.exe, not a Node runtime.
  // A plain "node" resolves via PATH in the inherited env. Non-string nodejsPath falls back
  // to "node" so a broken config never blocks the plugin.
  const cfgNode = loadConfig().nodejsPath
  const interpreter = typeof cfgNode === "string" && cfgNode ? cfgNode : "node"
  debugLog(`runGate spawn: ${interpreter} ${argv.join(" ")} (cwd ${projectDir})`)
  return new Promise((resolve) => {
    const child = spawn(interpreter, argv, {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
      stdio: ["pipe", "pipe", "pipe"],
      // Detached only for fire-and-forget so the process can outlive the turn handler.
      detached: !!opts.fireAndForget,
    })
    // gate.js reads hook JSON from stdin (quick needs tool_input.file_path; full ignores it).
    const hook = opts.touchedFile ? JSON.stringify({ tool_input: { file_path: opts.touchedFile } }) : "{}"
    child.stdin.end(hook)

    let output = ""
    child.stdout?.on("data", (d) => { output += d })
    child.stderr?.on("data", (d) => { output += d })

    const timer = setTimeout(() => {
      // A hung gate must never block the model. Kill it and report red.
      try { child.kill() } catch { /* already dead */ }
      if (!opts.fireAndForget) {
        console.error("[ristretto] gate timed out after " + GATE_TIMEOUT_MS + "ms")
      }
      resolve({ code: 2, output })
    }, GATE_TIMEOUT_MS)

    child.on("error", () => { clearTimeout(timer); resolve({ code: 2, output }) })
    child.on("close", (code) => {
      clearTimeout(timer)
      // Surface captured gate output so failures are visible without inheriting.
      if (output.trim() && !opts.fireAndForget && opts.captureOutput !== false) {
        console.error("[ristretto] gate output:\n" + output.trim())
      }
      resolve({ code: code ?? 0, output })
    })

    // For the fire-and-forget / session.idle case, unref so the timer/child handles
    // don't keep the event loop alive at turn end.
    if (opts.fireAndForget) {
      timer.unref()
      child.unref()
    }
  })
}

// --- Phase 3: session.idle orchestrator -------------------------------------------
// Stop-hook equivalent. On session.idle, run the full gate fire-and-forget; if it
// comes back red (exit 2), actively re-prompt the model via client.session.promptAsync
// so it fixes the tree instead of the failure being silent.
//
// Guards (from the event-driven research — mandatory):
//   advancing  — prevent re-entrant promptAsync when idle fires again mid-prompt.
//   retries    — per-session cap (matches gate.js MAX_RETRIES). gate.js also exits 0
//                after its own cap, so this is belt-and-suspenders.
//   fingerprint— gate.js already skips unchanged-green trees; a red tree re-runs and
//                increments its own retry counter, so the loop is naturally bounded.
const MAX_REPROMPTS = 3
let advancing = false
const retries = new Map<string, number>()

const IDLE_PROMPT = "ristretto: deterministic gates are red. Fix the failures before stopping. Do NOT weaken, skip, or delete gates/tests to get green."

async function onSessionIdle(client: any, projectDir: string, sessionID: string) {
  if (advancing) return
  advancing = true
  try {
    const { code } = await runGate(projectDir, "full", { fireAndForget: true })
    debugLog(`session.idle gate → exit ${code}`)
    if (code !== 2) { retries.delete(sessionID); return }
    const n = (retries.get(sessionID) || 0) + 1
    if (n > MAX_REPROMPTS) { retries.delete(sessionID); return }
    retries.set(sessionID, n)
    debugLog(`session.idle gate FAILED (re-prompt ${n}/${MAX_REPROMPTS}) — message sent to model:\n${IDLE_PROMPT}`)
    await client.session.promptAsync({
      path: { id: sessionID },
      body: {
        parts: [{
          type: "text",
          text: IDLE_PROMPT,
        }],
      },
    })
  } catch {
    // promptAsync can fail (session gone, server busy) — never crash the idle handler.
  } finally {
    advancing = false
  }
}

// --- Plugin -----------------------------------------------------------------------
export const RistrettoPlugin: Plugin = async ({ directory, worktree, client }) => {
  const projectDir = worktree || directory

  return {
    // Register the 8 slash-commands at startup.
    config: async (config) => {
      config.command = config.command || {}
      for (const cmd of loadCommands(COMMANDS_DIR)) {
        config.command[cmd.key] = { template: cmd.template, description: cmd.description }
      }
    },

    // SubagentStop → gate the subagent's result. Exit 2 throws → blocks the subagent.
    // `full subagent` is the never-exempt variant (a plain `full` Stop is exempted while
    // brew's orchestrator marker exists, but a subagent's work is never exempt).
    // Per-edit format is handled by the LSP server (scripts/gate-lsp.mjs), not here.
    "tool.execute.after": async (input) => {
      if (input.tool === "task") {
        const { code, output } = await runGate(projectDir, "full", { arg: "subagent", captureOutput: false })
        debugLog(`tool.execute.after task gate → exit ${code}${output.trim() ? ":\n" + output.trim() : ""}`)
        if (code === 2) {
          const err = new Error(
            "ristretto: work is not done — deterministic gates failed. Fix these before stopping. Do NOT weaken, skip, or delete gates/tests to get green.\n" + output.trim(),
          )
          debugLog(`tool.execute.after task gate FAILED — blocking subagent. Message sent to model:\n${err.message}`)
          throw err
        }
      }
    },

    // Stop → run the full gate; on red, re-prompt the model to fix it (guarded).
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await onSessionIdle(client, projectDir, event.properties.sessionID)
      }
    },
  }
}
