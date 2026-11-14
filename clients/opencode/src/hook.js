// The one place the OpenCode plugin talks to the Strata core. Every OpenCode hook is turned into the same
// JSON the Claude Code hook entrypoint already accepts, so capture, redaction, the event outbox, the local
// queue, the summarizer, sync and the dashboard are all shared rather than reimplemented.
//
// Fail-open by design: a broken Strata must never block or break an OpenCode session.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "../../claude-code/scripts/lib/log.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The Strata core (the Claude Code client) that owns scripts/hook.mjs and scripts/lib. */
export const pluginRoot = () =>
  process.env.STRATA_ROOT ? path.resolve(process.env.STRATA_ROOT) : path.resolve(HERE, "../../claude-code");

export const hookPath = () => path.join(pluginRoot(), "scripts/hook.mjs");
export const cliPath = () => path.join(pluginRoot(), "scripts/strata.mjs");
export const mcpPath = () => path.join(pluginRoot(), "scripts/mcp.mjs");

const SYNC_TIMEOUT_MS = { "session-start": 15_000, prompt: 10_000 };

/**
 * Run a hook and wait for it. Only the two hooks that establish turn state need this: the host must not
 * proceed to a tool call before the prompt hook has recorded the turn. Mirrors the Claude Code hook table,
 * where SessionStart and UserPromptSubmit are synchronous.
 */
export function runHookSync(hook, input) {
  try {
    const result = spawnSync(process.execPath, [hookPath(), hook], {
      input: JSON.stringify(input),
      encoding: "utf8",
      timeout: SYNC_TIMEOUT_MS[hook] ?? 10_000,
      windowsHide: true,
    });
    const out = (result.stdout ?? "").trim();
    if (!out) return null;
    try {
      return JSON.parse(out);
    } catch {
      return null;
    }
  } catch (error) {
    log("warn", "opencode hook failed", { hook, error: String(error?.message ?? error) });
    return null;
  }
}

/**
 * Run a hook detached: the session never waits on Strata. Tests set STRATA_OPENCODE_INLINE=1 to run it
 * inline instead, the same way the core's STRATA_INLINE_WORKER=1 makes the summarizer deterministic.
 */
export function spawnHook(hook, input) {
  if (process.env.STRATA_OPENCODE_INLINE === "1") {
    runHookSync(hook, input);
    return;
  }
  try {
    const child = spawn(process.execPath, [hookPath(), hook], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
    });
    child.on("error", () => {});
    // A child that dies before reading stdin raises EPIPE on the parent; that is not our problem to surface.
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(input));
    child.unref();
  } catch (error) {
    log("warn", "opencode hook spawn failed", { hook, error: String(error?.message ?? error) });
  }
}

/** Run a CLI verb and return its combined output. Used by the registered commands. */
export function runCli(args, { cwd, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    try {
      const child = spawn(process.execPath, [cliPath(), ...args], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let out = "";
      let err = "";
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.stderr.on("data", (chunk) => {
        err += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ code: 1, out: "", err: String(error?.message ?? error) });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, out, err });
      });
    } catch (error) {
      resolve({ code: 1, out: "", err: String(error?.message ?? error) });
    }
  });
}

/** Capture is off when explicitly disabled. The core re-checks this; checking here avoids a useless spawn. */
export const captureDisabled = () => process.env.STRATA_DISABLED === "1";

export { log };
