// Every hook's entry (dist/hook.mjs): reads the event from stdin, does what hooks.ts says, prints the hook JSON or
// nothing, and always exits 0. Without an address and a token it does nothing at all. A failure is written to
// <home>/errors.log and never reaches Claude.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, statSync, truncateSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeApi } from "./api.ts";
import { loadConfig } from "./config.ts";
import { type HookInput, handle } from "./hooks.ts";
import { openStore } from "./store.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

// The flusher, detached: it outlives this hook, and holds none of its output, so Claude Code isn't kept waiting.
function kickFlush(): void {
  try {
    const flusher = join(dirname(fileURLToPath(import.meta.url)), "flush.mjs");
    spawn(process.execPath, [flusher], { detached: true, stdio: "ignore", env: process.env }).unref();
  } catch {
    // The next hook starts one.
  }
}

function logError(home: string, error: unknown): void {
  try {
    mkdirSync(home, { recursive: true });
    const log = join(home, "errors.log");
    try {
      if (statSync(log).size > 256 * 1024) truncateSync(log, 0);
    } catch {
      // No log yet.
    }
    const message = error instanceof Error ? error.message : String(error);
    appendFileSync(log, `${new Date().toISOString()} ${message.slice(0, 500)}\n`);
  } catch {
    // Nowhere to write: nothing more to do.
  }
}

async function main(): Promise<void> {
  let input: HookInput;
  try {
    input = JSON.parse(await readStdin()) as HookInput;
  } catch {
    return;
  }
  const config = loadConfig(process.env, input.cwd);
  if (!config) return;
  try {
    const output = await handle(input, {
      config,
      store: openStore(config.home),
      api: makeApi(config),
      kick: kickFlush,
    });
    if (output) process.stdout.write(output);
  } catch (error) {
    logError(config.home, error);
  }
}

main().finally(() => {
  process.exitCode = 0;
});
