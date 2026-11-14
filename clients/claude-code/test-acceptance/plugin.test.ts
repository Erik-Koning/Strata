// The brief's acceptance list, for the Claude Code plugin as Claude Code runs it: the built dist/hook.mjs, a new
// process for every hook, the event as JSON on stdin, and a fake API on a real port.
//   1. Bytes already sent in a session never change: the frozen block is the same on every start, resume and
//      restart, and a turn only ever adds its own recall.
//   2. With the API down, a prompt goes ahead at once with nothing added, and once the API is back every captured
//      event arrives exactly once.
//   3. Only the user's own words are captured as the user's; a tool's input and output are never captured.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { duplicates, type FakeApi, freePort, startFakeApi, TOKEN } from "../test/fake-api.ts";
import { tempHome } from "../test/helpers.ts";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PROJECT = "github.com/acme/app";

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

function run(script: string, env: Record<string, string>, stdin?: unknown, args: string[] = []): Promise<Run> {
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(DIST, script), ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => done({ code, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(stdin === undefined ? "" : JSON.stringify(stdin));
  });
}

const envFor = (url: string, home: string): Record<string, string> => ({
  PATH: process.env.PATH ?? "",
  HOME: home,
  MEMORY_API_URL: url,
  MEMORY_API_TOKEN: TOKEN,
  MEMORY_HOME: home,
  MEMORY_PROJECT: PROJECT,
});
const hook = (env: Record<string, string>, input: Record<string, unknown>) => run("hook.mjs", env, input);
const outbox = (home: string): string[] => readdirSync(join(home, "kv")).filter((f) => f.startsWith("ob%3a"));

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 50));
  }
}

let api: FakeApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

describe("acceptance: Claude Code plugin", () => {
  it("1. never changes bytes already sent: the frozen block survives restarts, and turns add only their recall", async () => {
    api = await startFakeApi();
    api.frozen = [
      { _id: "6750a0000000000000000002", kind: "convention", text: "Tests sit next to the code." },
      { _id: "6750a0000000000000000001", kind: "preference", text: "Prefers pnpm over npm." },
    ];
    api.recalled = [{ _id: "6750a0000000000000000009", kind: "decision", text: "One envelope for every answer." }];
    const home = tempHome();
    const env = envFor(api.url, home);
    const session = { session_id: "sess-1", cwd: home };

    const start = await hook(env, { ...session, hook_event_name: "SessionStart", source: "startup" });
    expect(start.code).toBe(0);
    const block = JSON.parse(start.stdout).hookSpecificOutput.additionalContext as string;
    expect(block).toContain("<memory-frozen>");

    // Memory changes on the server while the session runs.
    api.frozen = [{ _id: "6750a00000000000000000aa", kind: "fact", text: "Something learned later." }];

    for (const prompt of ["first", "second", "third"]) {
      const turn = await hook(env, { ...session, hook_event_name: "UserPromptSubmit", prompt });
      expect(turn.code).toBe(0);
      const added = JSON.parse(turn.stdout).hookSpecificOutput.additionalContext as string;
      expect(added.startsWith("<memory>\n")).toBe(true);
      expect(added).not.toContain("memory-frozen");
    }

    // Claude Code restarts and resumes the session; and a start that fires twice: the same bytes, byte for byte.
    const resumed = await hook(env, { ...session, hook_event_name: "SessionStart", source: "resume" });
    const twice = await hook(env, { ...session, hook_event_name: "SessionStart", source: "startup" });
    expect(resumed.stdout).toBe(start.stdout);
    expect(twice.stdout).toBe(start.stdout);
    expect(api.requests.filter((r) => r.path === "/api/memory/frozen")).toHaveLength(1);

    // Compaction is the one place the block is refreshed; from then on the new block is the one that stays.
    const compacted = await hook(env, { ...session, hook_event_name: "SessionStart", source: "compact" });
    expect(compacted.stdout).toContain("Something learned later.");
    const afterCompact = await hook(env, { ...session, hook_event_name: "SessionStart", source: "resume" });
    expect(afterCompact.stdout).toBe(compacted.stdout);
  });

  it("2. with the API down, prompts go ahead at once with nothing added; once it's back, every event arrives exactly once", async () => {
    const port = await freePort();
    const home = tempHome();
    const env = envFor(`http://127.0.0.1:${port}`, home);
    const session = { session_id: "sess-2", cwd: home };

    const start = await hook(env, { ...session, hook_event_name: "SessionStart", source: "startup" });
    expect(start).toMatchObject({ code: 0, stdout: "" });
    for (const prompt of ["one", "two", "three"]) {
      const turn = await hook(env, { ...session, hook_event_name: "UserPromptSubmit", prompt });
      expect(turn.code).toBe(0);
      expect(turn.stdout).toBe("");
      expect(turn.ms).toBeLessThan(1500);
    }
    await hook(env, { ...session, hook_event_name: "PostToolUse", tool_name: "Read" });
    await hook(env, { ...session, hook_event_name: "Stop", last_assistant_message: "Done." });
    // Give the flushers the hooks started (against a dead API) time to fail.
    await new Promise((r) => setTimeout(r, 500));
    // The start, three prompts, the tool and Claude's last message.
    const captured = outbox(home).length;
    expect(captured).toBe(6);

    // The API comes back on the same address. After the backoff, the next Stop starts a flusher that drains it all.
    api = await startFakeApi(port);
    await new Promise((r) => setTimeout(r, 2100));
    await hook(env, { ...session, hook_event_name: "Stop", last_assistant_message: "Back." });
    await until(() => outbox(home).length === 0);
    expect(api.deliveries.size).toBe(captured + 1);
    expect(duplicates(api)).toBe(0);

    // A forced flush with nothing left sends nothing more.
    const again = await run("flush.mjs", env, undefined, ["--force"]);
    expect(again.code).toBe(0);
    expect(duplicates(api)).toBe(0);
    expect(api.deliveries.size).toBe(captured + 1);
  });

  it("2b. an API that doesn't answer costs a prompt at most the recall budget", async () => {
    api = await startFakeApi();
    api.mode = "hang";
    const home = tempHome();
    const env = envFor(api.url, home);
    const turn = await hook(env, {
      session_id: "sess-3",
      cwd: home,
      hook_event_name: "UserPromptSubmit",
      prompt: "hello",
    });
    expect(turn).toMatchObject({ code: 0, stdout: "" });
    expect(turn.ms).toBeLessThan(1500);
  });

  it("3. prompts are captured as the user's, and a tool's input and output never are", async () => {
    api = await startFakeApi();
    const home = tempHome();
    const env = envFor(api.url, home);
    const session = { session_id: "sess-4", cwd: home };
    await hook(env, { ...session, hook_event_name: "UserPromptSubmit", prompt: "Always use pnpm here." });
    await hook(env, {
      ...session,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "cat .env.secret-file" },
      tool_response: { stdout: "STRIPE_KEY=sk_live_abcdefghijklmnop1234" },
    });
    await hook(env, { ...session, hook_event_name: "Stop", last_assistant_message: "Noted." });
    await until(() => outbox(home).length === 0);

    const events = [...api.events.values()];
    const prompts = events.filter((e) => e.kind === "prompt");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.payload).toEqual({ role: "user", text: "Always use pnpm here." });
    const tools = events.filter((e) => e.kind === "tool");
    expect(tools.map((e) => Object.keys(e.payload).sort())).toEqual([["status", "tool"]]);
    expect(events.filter((e) => e.kind === "assistant").map((e) => e.payload.role)).toEqual(["assistant"]);
    const everything = JSON.stringify(api.requests);
    expect(everything).not.toContain(".env.secret-file");
    expect(everything).not.toContain("sk_live_");
    expect(events.every((e) => e.scope.project === PROJECT && e.sessionID === "sess-4")).toBe(true);
  });

  it("does nothing at all without an address and a key", async () => {
    const home = tempHome();
    const turn = await run(
      "hook.mjs",
      { PATH: process.env.PATH ?? "", HOME: home, MEMORY_HOME: home },
      {
        session_id: "s",
        hook_event_name: "UserPromptSubmit",
        prompt: "hi",
      },
    );
    expect(turn).toMatchObject({ code: 0, stdout: "", stderr: "" });
  });

  it("serves the memory tools over stdio", async () => {
    api = await startFakeApi();
    api.recalled = [{ _id: "6750a0000000000000000009", kind: "decision", text: "One envelope." }];
    const home = tempHome();
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "memory_search", arguments: { query: "envelope" } },
      },
    ];
    const answer = await new Promise<string>((done) => {
      const child = spawn(process.execPath, [join(DIST, "mcp.mjs")], { env: envFor(api!.url, home) });
      let out = "";
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.on("close", () => done(out));
      child.stdin.end(`${messages.map((m) => JSON.stringify(m)).join("\n")}\n`);
    });
    const lines = answer
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { id: number; result: Record<string, unknown> });
    expect(lines.map((l) => l.id).sort()).toEqual([1, 2, 3]);
    const byId = new Map(lines.map((l) => [l.id, l.result]));
    const tools = (byId.get(2)?.tools ?? []) as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual(["memory_search", "memory_save", "memory_forget"]);
    expect(JSON.stringify(byId.get(3))).toContain("One envelope.");
  });
});
