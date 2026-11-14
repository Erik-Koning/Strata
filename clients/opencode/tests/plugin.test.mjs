import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createFakeHost, tempHome } from "./fake-opencode.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.resolve(ROOT, "../claude-code");
const OPENCODE_BIN = path.join(ROOT, "tests/fake-opencode-bin.mjs");

const tmp = tempHome();
const HOME = path.join(tmp, "home");
const REPO = path.join(tmp, "repo");
const OPENCODE_LOG = path.join(tmp, "opencode-calls.log");

const env = {
  ...process.env,
  STRATA_HOME: HOME,
  STRATA_OPENCODE_INLINE: "1",
  STRATA_INLINE_WORKER: "1",
  STRATA_OPENCODE_BIN: OPENCODE_BIN,
  STRATA_CLAUDE_BIN: OPENCODE_BIN,
  FAKE_OPENCODE_LOG: OPENCODE_LOG,
  STRATA_SUMMARIZER_BACKEND: "opencode",
};
delete env.STRATA_DISABLED;
delete env.STRATA_INTERNAL;

let saved;

before(() => {
  saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);

  fs.mkdirSync(REPO, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "feature/PAY-412-capture"], { cwd: REPO });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/shop.git"], { cwd: REPO });
});

after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const eventFiles = () => {
  const dir = path.join(HOME, "events");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
};

const eventsOf = (kind) => eventFiles().filter((event) => event.kind === kind);

test("a prompt maps to the core's prompt hook, carrying prompt_id", async () => {
  const { ctx, hooks } = createFakeHost({ directory: REPO });
  const { createPlugin } = await import("../src/plugin.js");
  await createPlugin(ctx);

  await hooks.session.prompt({
    sessionID: "ses_abc123",
    messageID: "msg_turn_1",
    prompt: { text: "add capture for the opencode client" },
    delivery: "steer",
  });

  const prompts = eventsOf("prompt");
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].sessionID, "ses_abc123");
  assert.equal(prompts[0].promptID, "msg_turn_1");
  assert.equal(prompts[0].payload.role, "user");
  assert.match(prompts[0].payload.text, /opencode client/);
  assert.equal(prompts[0].v, 1);
});

test("a failing tool call is recorded as PostToolUseFailure", async () => {
  const { ctx, hooks } = createFakeHost({ directory: REPO });
  const { createPlugin } = await import("../src/plugin.js");
  await createPlugin(ctx);

  await hooks.tool["execute.after"]({
    tool: "bash",
    sessionID: "ses_tool",
    agent: "build",
    messageID: "msg_a",
    id: "call_1",
    input: { command: "pnpm test" },
    status: "error",
    error: { type: "unknown", message: "Exit code 1" },
  });

  const tools = eventsOf("tool").filter((event) => event.sessionID === "ses_tool");
  assert.equal(tools.length, 1);
  assert.equal(tools[0].payload.tool, "Bash", "OpenCode's lowercase tool names map to the core's names");
  assert.equal(tools[0].payload.status, "error");
  assert.equal(tools[0].payload.toolUseID, "call_1");
  assert.equal(tools[0].payload.command.class, "test");
  assert.equal(tools[0].payload.command.exit, 1);
});

test("a successful tool call is recorded as ok, with no output content", async () => {
  const { ctx, hooks } = createFakeHost({ directory: REPO });
  const { createPlugin } = await import("../src/plugin.js");
  await createPlugin(ctx);

  await hooks.tool["execute.after"]({
    tool: "bash",
    sessionID: "ses_tool_ok",
    agent: "build",
    messageID: "msg_b",
    id: "call_2",
    input: { command: "pnpm build" },
    status: "completed",
    result: { content: "SECRET OUTPUT SHOULD NOT BE CAPTURED" },
  });

  const tools = eventsOf("tool").filter((event) => event.sessionID === "ses_tool_ok");
  assert.equal(tools.length, 1);
  assert.equal(tools[0].payload.status, "ok");
  assert.equal(tools[0].payload.command.class, "build");
  assert.equal(JSON.stringify(tools[0]).includes("SECRET OUTPUT"), false);
});

test("idle maps to stop and stores the assistant reply", async () => {
  const messages = [
    { id: "m1", type: "user", text: "do the thing" },
    {
      id: "m2",
      type: "assistant",
      content: [
        { type: "reasoning", text: "thinking" },
        {
          type: "text",
          text: "Implemented the capture path for the OpenCode client and verified it with the new tests, including the tool-signal mapping, the compaction transcript and the deterministic session-id mapping.",
        },
      ],
    },
  ];
  const { ctx, hooks } = createFakeHost({ directory: REPO, messages });
  const { createPlugin } = await import("../src/plugin.js");
  await createPlugin(ctx);

  await hooks.session.prompt({
    sessionID: "ses_idle",
    messageID: "msg_turn_idle",
    prompt: { text: "do the thing" },
  });
  await hooks.session["experimental.idle"]({ sessionID: "ses_idle", background: [] });

  // The stop handler resolves the reply asynchronously; give the inline path a moment.
  await new Promise((resolve) => setTimeout(resolve, 150));

  const replies = eventsOf("assistant").filter((event) => event.sessionID === "ses_idle");
  assert.equal(replies.length, 1, "the assistant reply must be captured");
  assert.match(replies[0].payload.text, /Implemented the capture path/);
  assert.equal(replies[0].payload.text.includes("thinking"), false, "reasoning is not the reply");
  assert.equal(replies[0].promptID, "msg_turn_idle");
});

test("compaction records both the transcript and the summary", async () => {
  const { ctx, hooks, emit } = createFakeHost({ directory: REPO });
  const { createPlugin } = await import("../src/plugin.js");
  await createPlugin(ctx);

  await hooks.session.prompt({ sessionID: "ses_compact", messageID: "msg_c", prompt: { text: "hello" } });

  await hooks.session.compaction({
    sessionID: "ses_compact",
    agent: "build",
    model: { providerID: "anthropic", id: "claude" },
    system: [],
    messages: [
      { role: "user", content: [{ type: "text", text: "the original question" }] },
      { role: "assistant", content: [{ type: "text", text: "the original answer" }] },
    ],
    options: {},
    tools: {},
  });

  const transcripts = eventsOf("transcript").filter((event) => event.sessionID === "ses_compact");
  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0].payload.messages.length, 2);
  assert.match(transcripts[0].payload.messages[0].text, /original question/);

  // The summary text arrives on the compaction-ended event.
  emit({
    type: "session.compaction.ended",
    data: { sessionID: "ses_compact", reason: "auto", text: "Summary of the earlier work." },
  });
  await new Promise((resolve) => setTimeout(resolve, 200));

  const summaries = eventsOf("event").filter((event) => event.sessionID === "ses_compact");
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].payload.type, "compact_summary");
  assert.match(summaries[0].payload.text, /Summary of the earlier work/);
});

test("session-start overview is attached as an instruction entry, once", async () => {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(
    path.join(HOME, "config.json"),
    JSON.stringify({}), // no auth: the overview is still built from local state
  );
  // "Mention once" notices are deduped per day; an earlier test consumed the sign-in one.
  fs.rmSync(path.join(HOME, "notices.json"), { force: true });

  const { ctx, hooks, instructions } = createFakeHost({ directory: REPO });
  const { createPlugin } = await import("../src/plugin.js");
  await createPlugin(ctx);

  await hooks.session.prompt({ sessionID: "ses_start", messageID: "msg_s1", prompt: { text: "one" } });
  await hooks.session.prompt({ sessionID: "ses_start", messageID: "msg_s2", prompt: { text: "two" } });

  const sessions = eventFiles().filter(
    (event) => event.sessionID === "ses_start" && event.kind === "session" && event.payload.event === "start",
  );
  assert.equal(sessions.length, 1, "session-start runs once per session");

  // Not signed in, so the overview carries the sign-in notice; it must still be attached once.
  const keys = [...instructions.keys()];
  assert.equal(keys.filter((key) => key === "strata-overview").length, 1);
});

test("session deleted maps to session-end", async () => {
  const { ctx, emit } = createFakeHost({ directory: REPO });
  const { createPlugin } = await import("../src/plugin.js");
  await createPlugin(ctx);

  emit({ type: "session.deleted", data: { sessionID: "ses_deleted" } });
  await new Promise((resolve) => setTimeout(resolve, 150));

  const ends = eventFiles().filter(
    (event) => event.sessionID === "ses_deleted" && event.kind === "session" && event.payload.event === "end",
  );
  assert.equal(ends.length, 1);
});

test("a throwing hook never propagates into the session", async () => {
  const { ctx, hooks } = createFakeHost({ directory: REPO });
  const { createPlugin } = await import("../src/plugin.js");
  await createPlugin(ctx);

  // No session id at all: the handler must return quietly, not throw.
  await hooks.session.prompt({ sessionID: undefined, messageID: undefined, prompt: { text: "x" } });
  await hooks.tool["execute.after"]({ tool: "bash", sessionID: undefined, input: {}, status: "completed" });

  assert.equal(eventsOf("prompt").filter((event) => !event.sessionID).length, 0);
});

test("unsafe session ids map deterministically and stay distinct", async () => {
  const { sessionIdFor } = await import("../src/ids.js");
  const raw = "ses/with spaces and ✨ unicode";
  const first = sessionIdFor(raw);
  const second = sessionIdFor(raw);
  assert.equal(first, second, "the mapping must be stable");
  assert.match(first, /^[\w.-]{1,128}$/);
  assert.notEqual(first, sessionIdFor("ses/other ✨"));
  assert.equal(sessionIdFor("ses_plain"), "ses_plain", "valid ids pass through untouched");
  assert.equal(sessionIdFor(""), null);
});

test("commands are registered with OpenCode-safe names", async () => {
  const { ctx, transformations } = createFakeHost({ directory: REPO });
  const { registerCommands } = await import("../src/commands.js");
  await registerCommands(ctx);

  const names = transformations.command.map((command) => command.name).sort();
  assert.deepEqual(names, [
    "strata.dashboard",
    "strata.gaps",
    "strata.login",
    "strata.note",
    "strata.overview",
    "strata.project",
    "strata.review",
    "strata.rollup",
    "strata.search",
    "strata.status",
    "strata.sync",
  ]);
  for (const command of transformations.command) {
    assert.equal(typeof command.execute, "function");
    assert.equal(command.name.includes("${"), false, "no unresolved plugin-root placeholder");
  }
});

test("the MCP server and the log-context skill are registered against the real plugin root", async () => {
  const { ctx, transformations } = createFakeHost({ directory: REPO });
  const { registerMcpAndSkill } = await import("../src/registration.js");
  await registerMcpAndSkill(ctx);

  const mcp = transformations.mcp.get("strata");
  assert.ok(mcp, "the strata MCP server must be registered");
  assert.equal(mcp.type, "local");
  assert.ok(fs.existsSync(mcp.command[1]), `mcp entrypoint must exist: ${mcp.command[1]}`);
  assert.equal(mcp.environment.STRATA_ROOT, CORE);

  assert.equal(transformations.skill.length, 1);
  const [skill] = transformations.skill;
  assert.equal(skill.name, "log-context");
  assert.ok(skill.content.length > 0);
  assert.ok(fs.existsSync(skill.path));
  assert.match(skill.description ?? "", /non-obvious/i);
});

test("the real setup() entrypoint registers every hook and returns a cleanup", async () => {
  const { default: plugin } = await import("../src/server.js");
  assert.equal(plugin.id, "strata");
  assert.equal(typeof plugin.setup, "function");

  const { ctx, hooks, transformations } = createFakeHost({ directory: REPO });
  const cleanup = await plugin.setup(ctx);

  // Registering through setup() is what OpenCode does; the hooks must exist afterwards.
  assert.equal(typeof hooks.session.prompt, "function", "the prompt hook must be registered");
  assert.equal(typeof hooks.session.compaction, "function", "the compaction hook must be registered");
  assert.equal(typeof hooks.session["experimental.idle"], "function", "the idle hook must be registered");
  assert.equal(typeof hooks.tool["execute.after"], "function", "the tool hook must be registered");
  assert.ok(transformations.command?.length, "commands must be registered through setup()");
  assert.ok(transformations.mcp?.has("strata"), "the MCP server must be registered through setup()");
  assert.equal(typeof cleanup, "function", "setup() must return a cleanup");

  // The cleanup aborts the subscriptions and must not throw.
  await cleanup();
});

test("a prompt driven through setup() reaches the core", async () => {
  const { default: plugin } = await import("../src/server.js");
  const { ctx, hooks } = createFakeHost({ directory: REPO });
  const cleanup = await plugin.setup(ctx);

  await hooks.session.prompt({
    sessionID: "ses_via_setup",
    messageID: "msg_via_setup",
    prompt: { text: "capture through the real entrypoint" },
  });

  const prompts = eventsOf("prompt").filter((event) => event.sessionID === "ses_via_setup");
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].promptID, "msg_via_setup");
  await cleanup();
});

test("an unsafe session id is mapped for the core but the host gets the real id", async () => {
  const raw = "ses/unsafe id with spaces";
  fs.rmSync(path.join(HOME, "notices.json"), { force: true });
  const { ctx, hooks, instructionCalls } = createFakeHost({ directory: REPO });
  const { createPlugin } = await import("../src/plugin.js");
  const { sessionIdFor } = await import("../src/ids.js");
  await createPlugin(ctx);

  await hooks.session.prompt({ sessionID: raw, messageID: "msg_unsafe", prompt: { text: "one" } });

  const mapped = sessionIdFor(raw);
  assert.ok(
    eventFiles().some((event) => event.sessionID === mapped),
    "events must be written under the mapped id",
  );
  assert.equal(
    eventFiles().some((event) => event.sessionID === raw),
    false,
    "the raw id must never reach the core",
  );

  // The instruction entry is a host API call, so it needs OpenCode's real id, not the mapped one.
  assert.ok(instructionCalls.length > 0, "the overview must be attached");
  assert.equal(instructionCalls[0].sessionID, raw, "the host call must use OpenCode's real session id");
});

test("capture is fully skipped when STRATA_DISABLED is set", async () => {
  const before = eventFiles().length;
  process.env.STRATA_DISABLED = "1";
  try {
    const { ctx, hooks } = createFakeHost({ directory: REPO });
    const { createPlugin } = await import("../src/plugin.js");
    await createPlugin(ctx);
    await hooks.session.prompt({ sessionID: "ses_disabled", messageID: "msg_d", prompt: { text: "nope" } });
    await hooks.tool["execute.after"]({
      tool: "bash",
      sessionID: "ses_disabled",
      messageID: "m",
      id: "c",
      input: { command: "pnpm test" },
      status: "completed",
    });
    assert.equal(eventFiles().length, before, "no events may be written while disabled");
  } finally {
    delete process.env.STRATA_DISABLED;
  }
});
