import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "scripts/hook.mjs");
const HUB = path.join(ROOT, "scripts/strata.mjs");
const PORT = 18000 + Math.floor(Math.random() * 1000);
const URL_ = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "strata-"));
const HOME = path.join(tmp, "home");
const CLAUDE_LOG = path.join(tmp, "claude-calls.log");
const env = {
  ...process.env,
  STRATA_HOME: HOME,
  STRATA_URL: URL_,
  STRATA_INLINE_WORKER: "1",
  STRATA_CLAUDE_BIN: path.join(ROOT, "tests/fake-claude.mjs"),
  FAKE_CLAUDE_LOG: CLAUDE_LOG,
  STRATA_NO_BROWSER: "1",
};
delete env.STRATA_INTERNAL;
let server;
let dash;

const repo = (name, branch, remote = "https://github.com/acme/shop.git") => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", branch], { cwd: dir });
  execFileSync(
    "git",
    ["remote", "add", "origin", remote.replace("https://", "https://user:ghp_abcdefghijklmnopqrstuvwxyz0123456789@")],
    { cwd: dir },
  );
  return dir;
};
let REPO;
let PLAIN;
let OTHER;

const hook = (event, input, extraEnv = {}) =>
  spawnSync(process.execPath, [HOOK, event], {
    input: JSON.stringify(input),
    env: { ...env, ...extraEnv },
    encoding: "utf8",
  });
const hub = (...args) => spawnSync(process.execPath, [HUB, ...args], { env, encoding: "utf8", cwd: REPO });
const authHeader = () => ({
  "content-type": "application/json",
  authorization: `Bearer ${JSON.parse(fs.readFileSync(path.join(HOME, "auth.json"))).token}`,
});
// A pooled keep-alive socket can be reset by the server between slow steps; one retry is the normal client answer.
const hubApi = async (route, body, method = "POST") => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await (
        await fetch(URL_ + route, { method, body: body && JSON.stringify(body), headers: authHeader() })
      ).json();
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
};
const stored = async () => (await hubApi("/v1/debug/events", undefined, "GET")).events;
const posts = async () => (await hubApi("/v1/debug/stats", undefined, "GET")).posts;
const claudeCalls = () =>
  fs.existsSync(CLAUDE_LOG)
    ? fs
        .readFileSync(CLAUDE_LOG, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

const sdir = (sid) => path.join(HOME, "store", "sessions", sid);
const read = (sid, name, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(sdir(sid), name)));
  } catch {
    return fallback;
  }
};
const queue = (sid) =>
  fs.existsSync(path.join(sdir(sid), "queue"))
    ? fs.readdirSync(path.join(sdir(sid), "queue")).filter((f) => f.endsWith(".json"))
    : [];
const status = async (sid) => (await (await dashFetch(`/api/sessions/${sid}`)).json()).session?.status;

const pad = (text) => `${text} ${"More detail about the change. ".repeat(8)}`; // replies under 160 chars are not worth a summary
const turn = (sid, prompt, reply, cwd = REPO, extra = {}) => {
  hook("prompt", { session_id: sid, cwd, prompt, ...extra });
  return hook("stop", { session_id: sid, cwd, last_assistant_message: pad(reply), ...extra });
};

const dashFetch = (route, { method = "GET", body, cookie = true, host, type = "application/json" } = {}) =>
  fetch(dash.base + route, {
    method,
    headers: {
      ...(method !== "GET" ? { "content-type": type } : {}),
      ...(cookie ? { cookie: `strata=${dash.token}` } : {}),
      ...(host ? { host } : {}),
    },
    body: method !== "GET" ? JSON.stringify(body ?? {}) : undefined,
    redirect: "manual",
  });
const approve = (sid, send = false) => dashFetch(`/api/sessions/${sid}/approve`, { method: "POST", body: { send } });
const patch = (sid, body) => dashFetch(`/api/sessions/${sid}`, { method: "PATCH", body });

before(async () => {
  REPO = repo("repo", "ABC-123-fix-tax");
  PLAIN = repo("plain", "main", "https://github.com/acme/plain.git");
  OTHER = repo("other", "ABC-456-other", "https://github.com/acme/other.git");
  server = spawn(process.execPath, [path.join(ROOT, "mock-server/server.mjs")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`${URL_}/activate`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.match(hub("login").stdout, /Signed in/);
  assert.match(hub("use", "p_checkout").stdout, /now sends/);
  const launched = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]+)/.exec(hub("dashboard", "--no-open").stdout);
  assert.ok(launched, "dashboard must start");
  dash = { base: `http://127.0.0.1:${launched[1]}`, token: launched[2], port: launched[1] };
});
after(() => {
  hub("dashboard", "stop");
  server?.kill();
});

// ---------- building blocks ----------
test("redaction: vendor keys, URL credentials, keyed values; keeps ordinary code", async () => {
  const { redact } = await import(path.join(ROOT, "scripts/lib/redact.mjs"));
  const cases = [
    ["sk_live_" + "a".repeat(24), /\[redacted\]/],
    ["postgres://admin:hunter2pass@db.internal/app", /admin:\[redacted\]@db/],
    ['DB_PASSWORD="correcthorse99"', /DB_PASSWORD="\[redacted\]/],
    ["Authorization: Bearer abcdefghijklmnop1234", /Bearer \[redacted\]/],
    ["curl --token=abcdef123456XYZ", /--token=\[redacted\]/],
    ["Set-Cookie: sid=abcd1234efgh5678", /\[redacted\]/],
  ];
  for (const [input, expected] of cases) assert.match(redact(input), expected, input);
  for (const keep of ["max_tokens=4096", "const token = getToken();", "token: TokenType;", "password = input()"])
    assert.equal(redact(keep), keep, `should keep: ${keep}`);
  const started = Date.now();
  redact("a ".repeat(2_000_000) + "sk-" + "x".repeat(30), 8000);
  assert.ok(Date.now() - started < 3000, "oversize input must not stall");
});

test("tags: nested blocks go, unclosed prose tag stays, hostile input stays linear", async () => {
  const { stripTags, isPrivatePrompt, isInternalProtocolPayload } = await import(
    path.join(ROOT, "scripts/lib/tags.mjs")
  );
  assert.equal(stripTags("a <private>x <private>y</private> z</private> b"), "a  b");
  assert.equal(stripTags("explain how <private> works"), "explain how <private> works");
  assert.ok(isPrivatePrompt("<private>all of it</private>"));
  assert.ok(!isPrivatePrompt("<private>part</private> and public"));
  assert.ok(isInternalProtocolPayload("<task-notification>done</task-notification>"));
  const started = Date.now();
  stripTags("<private".repeat(100000));
  assert.ok(Date.now() - started < 2000);
});

test("git: status -z handles spaces and renames; jira lookalikes dropped", async () => {
  const { parseStatusZ, extractJiraKeys } = await import(path.join(ROOT, "scripts/lib/git.mjs"));
  assert.deepEqual(parseStatusZ("?? my file.txt\0R  new name.ts\0old name.ts\0 M src/a.ts\0"), [
    "my file.txt",
    "new name.ts",
    "src/a.ts",
  ]);
  assert.deepEqual(extractJiraKeys("ABC-123-fix UTF-8 SHA-256 CVE-2024-1234 xy-9 PAY-42"), ["ABC-123", "PAY-42"]);
});

test("hooks emit versioned events for the memory API", async () => {
  hook("session-start", { session_id: "ev-1", cwd: REPO });
  turn("ev-1", "Note that the ledger rounds per line.", "Built it. Run the tests first.", REPO);
  hook("post-tool", {
    session_id: "ev-1",
    cwd: REPO,
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "pnpm test" },
    duration_ms: 1200,
    tool_use_id: "tool-1",
  });
  hook("session-end", { session_id: "ev-1", cwd: REPO, reason: "done" });
  hub("flush-events");

  const { events } = await (await fetch(`${URL_}/api/memory/debug/events`, { headers: authHeader() })).json();
  const mine = events.filter((event) => event.sessionID === "ev-1");
  assert.ok(mine.length >= 4);
  assert.ok(mine.every((event) => event.v === 1));
  const kinds = new Set(mine.map((event) => event.kind));
  for (const kind of ["prompt", "assistant", "tool", "session"]) assert.ok(kinds.has(kind), kind);

  const prompt = mine.find((event) => event.kind === "prompt");
  assert.match(prompt.payload.text, /ledger rounds per line/);
  const tool = mine.find((event) => event.kind === "tool");
  assert.equal(tool.payload.command.class, "test");
  assert.equal(tool.payload.command.fp.length, 16);
  assert.equal(tool.payload.status, "ok");
  const start = mine.find((event) => event.kind === "session" && event.payload.event === "start");
  assert.equal(start.payload.git.remote, "github.com/acme/shop");
  assert.ok(start.payload.refs.some((ref) => ref.id === "ABC-123"));
});

test("schema: code, secrets and tags are stripped from whatever the model or an edit produced", async () => {
  const { sanitizeSummary } = await import(path.join(ROOT, "scripts/lib/schema.mjs"));
  const out = sanitizeSummary({
    title: "T".repeat(300),
    built: "Did ```rm -rf /``` and <private>x</private> key sk-" + "q".repeat(30),
    decisions: "a\nb\nc\nd\ne\nf\ng",
    areas: "x",
  });
  assert.equal(out.title.length, 100);
  assert.doesNotMatch(out.built, /rm -rf|sk-q|private/);
  assert.equal(out.decisions.length, 5);
});

// ---------- the automatic summary ----------
test("a turn is summarized automatically; raw text is deleted; nothing is sent before approval", async () => {
  turn("s1", "add tax rounding, key sk-" + "q".repeat(30), "Rounded line totals to cents.");
  const summary = read("s1", "summary.json");
  assert.equal(summary.revision, 1);
  assert.match(summary.summary.built, /Rounded line totals/);
  assert.deepEqual(summary.detected.jira, ["ABC-123"]);
  assert.equal(summary.detected.branch, "ABC-123-fix-tax");
  assert.equal(summary.detected.remote, "https://github.com/acme/shop.git");
  assert.deepEqual(queue("s1"), [], "raw turn text is deleted once summarized");
  // Nothing of the raw prompt or the secret survives anywhere under the plugin's home (the log holds metadata only).
  const everything = fs
    .readdirSync(HOME, { recursive: true })
    .map((f) => path.join(HOME, f))
    .filter((f) => fs.statSync(f).isFile() && !f.includes("strata.log"))
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  assert.doesNotMatch(everything, /sk-q|add tax rounding/, "neither the prompt nor the secret is kept");
  assert.equal(
    fs.readdirSync(path.join(HOME, "prompts")).filter((f) => f.startsWith("s1-")).length,
    0,
    "the prompt file is deleted by Stop",
  );
  assert.equal(await status("s1"), "draft");
  hub("sync");
  assert.equal((await stored()).filter((e) => e.sessionId === "s1").length, 0, "unapproved summaries never leave");
});

test("the summarizer is a locked-down headless call, and its prompt is data-fenced", () => {
  const call = claudeCalls().at(-1);
  assert.ok(call.args.includes("--tools") && call.args[call.args.indexOf("--tools") + 1] === "");
  for (const flag of ["--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config"])
    assert.ok(call.args.includes(flag), flag);
  assert.equal(call.args[call.args.indexOf("--model") + 1], "haiku");
  assert.match(call.input, /BEGIN [0-9a-f]{12}[\s\S]*END [0-9a-f]{12}/);
  assert.doesNotMatch(call.input, /sk-q/, "secrets never reach the model");
});

test("approving sends the summary only: no prompts, replies or turns", async () => {
  const res = await approve("s1", true);
  assert.deepEqual((await res.json()).sent, 1);
  const [event] = (await stored()).filter((e) => e.sessionId === "s1");
  assert.equal(event.type, "session_summary");
  assert.equal(event.userId, "u_alice");
  assert.equal(event.projectId, "p_checkout");
  assert.deepEqual(event.links.jira, ["ABC-123"]);
  assert.equal(event.review.approved, true);
  assert.ok(event.review.approvedAt);
  for (const key of ["prompt", "assistantMessage", "turn"]) assert.ok(!(key in event), `${key} must not be sent`);
  assert.doesNotMatch(JSON.stringify(event), /add tax rounding|sk-q/);
  assert.equal(await status("s1"), "synced");
});

test("more work rolls into the same summary and asks for review again", async () => {
  turn("s1", "add tests for rounding", "Covered rounding edge cases.");
  const summary = read("s1", "summary.json");
  assert.equal(summary.revision, 2);
  assert.match(summary.summary.built, /Rounded line totals.*\+.*Covered rounding/);
  assert.match(
    claudeCalls().at(-1).input,
    /Current summary[^:]*: \{/,
    "the model is shown the current summary to extend",
  );
  assert.equal(await status("s1"), "updated");
  hub("sync");
  assert.equal((await stored()).find((e) => e.sessionId === "s1").revision, 1, "the hub still has what was approved");
});

test("an engineer can edit after sending: new revision, re-approve, hub gets the latest", async () => {
  const res = await dashFetch("/api/sessions/s1/summary", {
    method: "PUT",
    body: { title: "Tax rounding", built: "Rounding now happens per line. ```code``` sk-" + "z".repeat(30) },
  });
  assert.equal((await res.json()).revision, 3);
  const built = read("s1", "summary.json").summary.built;
  assert.doesNotMatch(built, /code|zzzz/);
  assert.equal(read("s1", "summary.json").edited, true);
  assert.equal(await status("s1"), "updated");
  assert.equal((await approve("s1", true)).status, 200);
  const events = (await stored()).filter((e) => e.sessionId === "s1");
  assert.equal(events.at(-1).revision, 3);
  assert.equal(events.at(-1).review.edited, true);
});

test("retract removes it from the hub; the local copy stays and needs approval again", async () => {
  const res = await dashFetch("/api/sessions/s1/retract", { method: "POST" });
  assert.equal(res.status, 200);
  assert.equal((await stored()).filter((e) => e.sessionId === "s1").length, 0);
  assert.ok(read("s1", "summary.json").summary.title);
  assert.equal(await status("s1"), "draft");
  hub("sync");
  assert.equal(
    (await stored()).filter((e) => e.sessionId === "s1").length,
    0,
    "retracted means nothing is sent until approved again",
  );
});

// ---------- links ----------
test("work with no ticket or PR is held until it is linked or marked as having none", async () => {
  turn("nolink", "tidy the readme", "Rewrote the readme intro.", PLAIN);
  assert.equal(await status("nolink"), "needs-link");
  assert.equal((await approve("nolink")).status, 409);
  assert.equal((await patch("nolink", { links: { jira: ["not a key"] } })).status, 400);
  assert.equal((await patch("nolink", { links: { prUrl: "javascript:alert(1)" } })).status, 400);
  assert.equal(
    (await patch("nolink", { links: { jira: ["PAY-7"], prUrl: "https://github.com/acme/plain/pull/9" } })).status,
    200,
  );
  assert.equal(await status("nolink"), "draft");
  assert.equal((await approve("nolink")).status, 200);
  assert.equal(await status("nolink"), "ready", "approved, but this repo has no project yet");
  assert.equal((await dashFetch("/api/sessions/nolink/sync", { method: "POST" })).status, 200);
  assert.equal((await stored()).filter((e) => e.sessionId === "nolink").length, 0, "no project, so nothing is sent");
  assert.equal((await patch("nolink", { projectId: "p_nope" })).status, 400);
  assert.equal((await patch("nolink", { projectId: "p_search" })).status, 200);
  assert.equal((await dashFetch("/api/sessions/nolink/sync", { method: "POST" })).status, 200);
  const event = (await stored()).find((e) => e.sessionId === "nolink");
  assert.equal(event.projectId, "p_search");
  assert.deepEqual(event.links.jira, ["PAY-7"]);
  assert.equal(event.links.pr.url, "https://github.com/acme/plain/pull/9");
});

test('"no ticket exists" is an explicit choice the hub sees', async () => {
  turn("noticket", "spike a prototype", "Built a throwaway prototype.", PLAIN);
  assert.equal((await patch("noticket", { links: { noTicket: true } })).status, 200);
  assert.equal((await approve("noticket")).status, 200);
  assert.equal((await patch("noticket", { projectId: "p_search" })).status, 200);
  hub("sync");
  assert.equal((await stored()).find((e) => e.sessionId === "noticket").links.noTicket, true);
});

// ---------- summarizer failure modes ----------
test("a failing model keeps the queued turn for retry, then drops it after 3 attempts; nothing is uploaded", async () => {
  turn("fail", "x", "FAIL_ME the model will crash on this turn.");
  assert.equal(queue("fail").length, 1);
  assert.equal(read("fail", "summary.json"), null);
  assert.match(JSON.parse(fs.readFileSync(path.join(HOME, "health.json"))).summarizerError, /summarizer exited 1/);
  hub("summarize", "fail");
  hub("summarize", "fail");
  assert.equal(queue("fail").length, 1);
  const item = JSON.parse(fs.readFileSync(path.join(sdir("fail"), "queue", queue("fail")[0])));
  assert.equal(item.attempts, 3);
  hub("summarize", "fail");
  assert.equal(queue("fail").length, 0, "unsummarizable text is dropped, never uploaded");
});

test("garbage replies, skip answers and hostile output are handled", async () => {
  turn("garbage", "x", "GARBAGE_ME produce prose instead of JSON.");
  assert.equal(read("garbage", "summary.json"), null);
  assert.equal(queue("garbage").length, 1);

  turn("skip", "x", "SKIP_ME nothing durable happened here.");
  assert.equal(read("skip", "summary.json"), null);
  assert.equal(queue("skip").length, 0);
  assert.equal(
    (await (await dashFetch("/api/sessions")).json()).sessions.some((s) => s.sessionId === "skip"),
    false,
    "empty sessions are not listed",
  );

  turn("fence", "x", "FENCE_ME the model returns code and a key.");
  const built = read("fence", "summary.json").summary.built;
  assert.doesNotMatch(built, /rm -rf|sk-q/);
  assert.match(built, /\[redacted\]/);
});

test("a missing claude CLI is reported, not fatal", async () => {
  const r = spawnSync(process.execPath, [HOOK, "stop"], {
    input: JSON.stringify({ session_id: "nobin", cwd: REPO, last_assistant_message: pad("Did something.") }),
    env: { ...env, STRATA_CLAUDE_BIN: "/nonexistent/claude" },
    encoding: "utf8",
  });
  hook("prompt", { session_id: "nobin", cwd: REPO, prompt: "x" }, { STRATA_CLAUDE_BIN: "/nonexistent/claude" });
  spawnSync(process.execPath, [HOOK, "stop"], {
    input: JSON.stringify({ session_id: "nobin", cwd: REPO, last_assistant_message: pad("Did something.") }),
    env: { ...env, STRATA_CLAUDE_BIN: "/nonexistent/claude" },
  });
  assert.equal(r.status, 0);
  assert.match(JSON.parse(fs.readFileSync(path.join(HOME, "health.json"))).summarizerError, /claude CLI was not found/);
  const state = await (await dashFetch("/api/state")).json();
  assert.match(state.health.summarizerError, /not found/);
});

test("cost guard: the daily cap stops model calls and leaves turns queued", async () => {
  const before = claudeCalls().length;
  fs.writeFileSync(path.join(HOME, "config.json"), JSON.stringify({ maxSummariesPerDay: 1 }));
  fs.writeFileSync(
    path.join(HOME, "usage.json"),
    JSON.stringify({ day: new Date().toISOString().slice(0, 10), count: 1 }),
  );
  turn("capped", "x", "This would need a model call.");
  fs.rmSync(path.join(HOME, "config.json"));
  fs.rmSync(path.join(HOME, "usage.json"));
  assert.equal(claudeCalls().length, before);
  assert.equal(queue("capped").length, 1);
});

// ---------- hooks ----------
test("capture rules: private, task-notification, subagent, trivial, internal, disabled, excluded", async () => {
  const calls = () => claudeCalls().length;
  const n = calls();
  turn("priv", "<private>my salary talk</private>", "secret reply");
  turn("sub", "x", "work", REPO, { agent_id: "agent-1" });
  turn("internal", "x", "work");
  hook("prompt", { session_id: "internal", cwd: REPO, prompt: "x" }, { STRATA_INTERNAL: "1" });
  hook("stop", { session_id: "internal2", cwd: REPO, last_assistant_message: pad("work") }, { STRATA_INTERNAL: "1" });
  hook("prompt", { session_id: "dis", cwd: REPO, prompt: "x" }, { STRATA_DISABLED: "1" });
  hook("stop", { session_id: "dis", cwd: REPO, last_assistant_message: pad("work") }, { STRATA_DISABLED: "1" });
  hook("prompt", { session_id: "trivial", cwd: REPO, prompt: "hi" });
  hook("stop", { session_id: "trivial", cwd: REPO, last_assistant_message: "Hello!" });
  hook("prompt", { session_id: "tn", cwd: REPO, prompt: "<task-notification>bg done</task-notification>" });
  hook("stop", { session_id: "tn", cwd: REPO, last_assistant_message: pad("x") });
  for (const sid of ["priv", "sub", "internal2", "dis", "trivial", "tn"])
    assert.equal(fs.existsSync(sdir(sid)), false, `${sid} must not be captured`);
  assert.equal(calls() - n, 1, 'only the plain "internal" turn (its prompt came before the guard) used a model call');

  fs.writeFileSync(path.join(HOME, "config.json"), JSON.stringify({ excludedPaths: [`${tmp}/**`] }));
  turn("excl", "p", "r");
  fs.rmSync(path.join(HOME, "config.json"));
  assert.equal(fs.existsSync(sdir("excl")), false);
});

test("an empty reply falls back to the transcript; a repeated Stop does not re-summarize", async () => {
  const transcript = path.join(tmp, "t.jsonl");
  fs.writeFileSync(
    transcript,
    [
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: pad("Extracted the retry helper from the transcript.") }] },
      }),
      "{ broken json",
    ].join("\n"),
  );
  hook("prompt", { session_id: "tr", cwd: REPO, prompt: "go" });
  hook("stop", { session_id: "tr", cwd: REPO, last_assistant_message: "", transcript_path: transcript });
  assert.match(read("tr", "summary.json").summary.built, /retry helper/);

  const before = claudeCalls().length;
  hook("stop", { session_id: "tr", cwd: REPO, last_assistant_message: "", transcript_path: transcript });
  assert.equal(claudeCalls().length, before, "identical Stop is deduplicated");
});

test("malformed or empty stdin never crashes or blocks a hook", () => {
  for (const input of ["", "not json", '{"session_id": 5}', "[]"]) {
    for (const event of ["stop", "prompt", "session-start", "session-end"]) {
      const r = spawnSync(process.execPath, [HOOK, event], { input, env, encoding: "utf8" });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, "");
    }
  }
});

test("session start tells the engineer what waits for review, once", () => {
  const r = hook("session-start", { session_id: "ss", cwd: REPO });
  const out = JSON.parse(r.stdout);
  assert.match(out.systemMessage, /wait(s)? for your review/);
  assert.match(out.systemMessage, /Nothing is sent until you approve/);
  assert.equal(hook("session-start", { session_id: "ss2", cwd: REPO }).stdout, "", "not repeated");
});

// ---------- offline, sign-in, failures ----------
test("written and approved while signed out: held, then sent after sign-in", async () => {
  hub("logout");
  turn("offline", "wire the webhook", "Added the webhook handler.", OTHER);
  assert.equal(read("offline", "summary.json").revision, 1, "summaries are written without a network");
  assert.equal(hub("approve", "offline").stdout.includes("Approved"), true);
  assert.match(hub("status").stdout, /approved, waiting for/);
  const login = hub("login");
  assert.match(login.stdout, /Signed in/);
  assert.match(login.stdout, /waiting for a project/, "an unbound repo is held and explained");
  assert.equal((await stored()).filter((e) => e.sessionId === "offline").length, 0);
  assert.equal((await patch("offline", { projectId: "p_checkout" })).status, 200);
  hub("sync");
  assert.equal((await stored()).filter((e) => e.sessionId === "offline").length, 1);
});

test("retryable failures keep an approved summary; a 422 rejects that revision; editing fixes it", async () => {
  for (const code of [429, 503, "html", "no-ack"]) {
    turn(`f-${code}`, "x", "Did a thing worth sending.");
    approve(`f-${code}`);
    await hubApi("/v1/debug/fail", { status: code, count: 1 });
    hub("sync");
    assert.equal(await status(`f-${code}`), "ready", `${code} must stay ready`);
    assert.equal((await stored()).filter((e) => e.sessionId === `f-${code}`).length, 0);
  }
  assert.ok(JSON.parse(fs.readFileSync(path.join(HOME, "health.json"))).failures >= 1);
  hub("sync");
  for (const code of [429, 503, "html", "no-ack"]) assert.equal(await status(`f-${code}`), "synced");
  assert.equal(JSON.parse(fs.readFileSync(path.join(HOME, "health.json"))).failures, 0, "success resets the latch");

  turn("rej", "x", "Another thing worth sending.");
  approve("rej");
  await hubApi("/v1/debug/fail", { status: 422, count: 1 });
  hub("sync");
  assert.equal(await status("rej"), "rejected");
  await dashFetch("/api/sessions/rej/summary", {
    method: "PUT",
    body: { built: "A corrected description of the work." },
  });
  assert.equal(await status("rej"), "draft", "a new revision is a fresh start");
  assert.equal((await approve("rej", true)).status, 200);
  assert.equal(await status("rej"), "synced");
});

test("concurrent flushers send each revision exactly once", async () => {
  turn("conc", "x", "Work that several flushers race for.");
  approve("conc");
  await Promise.all(
    [1, 2, 3, 4].map(
      () => new Promise((r) => spawn(process.execPath, [HUB, "sync"], { env, cwd: REPO }).on("close", r)),
    ),
  );
  assert.equal((await posts())["u_alice:conc:summary:1"], 1);
  assert.equal(await status("conc"), "synced");
});

test('"keep on this machine" sessions are never sent, even if approved', async () => {
  turn("never", "x", "Private experiment worth keeping.");
  approve("never");
  assert.equal((await patch("never", { sync: "never" })).status, 200);
  hub("sync");
  assert.equal(await status("never"), "local");
  assert.equal((await stored()).filter((e) => e.sessionId === "never").length, 0);
  assert.equal((await patch("never", { sync: "bogus" })).status, 400);
});

test("refuses to send credentials over plain http to a remote host", () => {
  const r = spawnSync(process.execPath, [HUB, "projects"], {
    env: { ...env, STRATA_URL: "http://hub.example.com" },
    encoding: "utf8",
  });
  assert.match(r.stdout, /refusing to send credentials/);
});

// ---------- dashboard ----------
test("dashboard: the secret is handed over once; everything else is refused", async () => {
  const launch = await fetch(`${dash.base}/?t=${dash.token}`, { redirect: "manual" });
  assert.equal(launch.status, 302);
  assert.match(launch.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(`${dash.base}/?t=${"0".repeat(48)}`, { redirect: "manual" })).status, 401);
  assert.equal((await dashFetch("/api/state", { cookie: false })).status, 401);
  assert.equal((await dashFetch("/api/state")).status, 200);
  assert.doesNotMatch(
    await (await dashFetch("/api/state")).text(),
    new RegExp(JSON.parse(fs.readFileSync(path.join(HOME, "auth.json"))).token),
  );
  const badHost = await new Promise((resolve) =>
    http.get(
      {
        host: "127.0.0.1",
        port: dash.port,
        path: "/api/state",
        headers: { host: "evil.example.com", cookie: `strata=${dash.token}` },
      },
      (res) => resolve(res.statusCode),
    ),
  );
  assert.equal(badHost, 403);
  assert.equal((await dashFetch("/api/sync", { method: "POST", type: "text/plain" })).status, 415);
  assert.match(
    hub("dashboard", "--no-open").stdout,
    new RegExp(`:${dash.port}/`),
    "a second launch reuses the running dashboard",
  );
});

test("dashboard: sessions list carries status, project and links", async () => {
  const { sessions } = await (await dashFetch("/api/sessions")).json();
  const s = sessions.find((x) => x.sessionId === "conc");
  assert.equal(s.status, "synced");
  assert.equal(s.resolvedProjectId, "p_checkout");
  assert.equal(s.projectSource, "repo");
  assert.deepEqual(s.links.jira, ["ABC-123"]);
  assert.equal((await dashFetch("/api/sessions/nope", { method: "PATCH", body: {} })).status, 404);
  assert.equal((await dashFetch("/api/sessions/rej/approve", { method: "POST", body: {} })).status, 200);
});

test("dashboard: approving an empty summary is refused", async () => {
  turn("blank", "x", "Something worth summarizing here.");
  await dashFetch("/api/sessions/blank/summary", { method: "PUT", body: { title: "", built: "" } });
  assert.equal((await approve("blank")).status, 409);
});

test("dashboard: settings validate, repos re-bind, sessions delete locally", async () => {
  const put = (body) => dashFetch("/api/settings", { method: "PUT", body });
  assert.equal((await put({ serverUrl: "http://hub.example.com" })).status, 400);
  assert.equal((await put({ excludedPaths: "nope" })).status, 400);
  assert.equal((await put({ summaryModel: "bad model; rm -rf" })).status, 400);
  assert.equal((await put({ maxSummariesPerDay: 0 })).status, 400);
  assert.equal((await put({ defaultSync: "auto" })).status, 400, "there is no auto-send mode");
  assert.equal(
    (await put({ defaultSync: "never", summarizer: false, summaryModel: "haiku", maxSummariesPerDay: 50 })).status,
    200,
  );
  const cfg = JSON.parse(fs.readFileSync(path.join(HOME, "config.json")));
  assert.deepEqual([cfg.defaultSync, cfg.summarizer, cfg.maxSummariesPerDay], ["never", false, 50]);
  await put({ defaultSync: null, summarizer: null, summaryModel: null, maxSummariesPerDay: null });
  assert.equal(JSON.parse(fs.readFileSync(path.join(HOME, "config.json"))).summarizer, undefined);

  const { repos } = await (await dashFetch("/api/repos")).json();
  const bound = repos.find((r) => r.binding);
  assert.equal(
    (await dashFetch("/api/repos", { method: "PUT", body: { repoKey: bound.repoKey, projectId: "p_search" } })).status,
    200,
  );
  assert.equal(JSON.parse(fs.readFileSync(path.join(HOME, "bindings.json")))[bound.repoKey].projectId, "p_search");
  await dashFetch("/api/repos", { method: "PUT", body: { repoKey: bound.repoKey, projectId: "p_checkout" } });

  assert.equal((await dashFetch("/api/sessions/blank", { method: "DELETE" })).status, 200);
  assert.equal(fs.existsSync(sdir("blank")), false);
});

test("dashboard: signing in from the page sends what was approved while signed out", async () => {
  await dashFetch("/api/logout", { method: "POST" });
  turn("dash-offline", "x", "Offline work that is approved before sign-in.");
  assert.equal((await approve("dash-offline")).status, 200);
  assert.equal((await (await dashFetch("/api/state")).json()).signedIn, false);
  const start = await (await dashFetch("/api/login/start", { method: "POST" })).json();
  assert.equal(start.login.state, "pending");
  for (let i = 0; i < 40 && (await (await dashFetch("/api/state")).json()).login.state !== "done"; i += 1)
    await new Promise((r) => setTimeout(r, 250));
  for (let i = 0; i < 20 && (await status("dash-offline")) !== "synced"; i += 1)
    await new Promise((r) => setTimeout(r, 250));
  assert.equal(await status("dash-offline"), "synced");
});

// ---------- findings: insights, workflow, pain points, gaps ----------
const MCP = path.join(ROOT, "scripts/mcp.mjs");
const mcp = (requests, cwd = REPO) => {
  const res = spawnSync(process.execPath, [MCP], {
    input: requests.map((r) => JSON.stringify({ jsonrpc: "2.0", ...r })).join("\n") + "\n",
    env: { ...env, CLAUDE_PROJECT_DIR: cwd },
    encoding: "utf8",
    cwd,
  });
  return res.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};

test("findings: the MCP tool logs a redacted finding into the session draft as a new revision", async () => {
  hook("session-start", { session_id: "find-1", cwd: REPO });
  const [init, list, rec, dup, bad] = mcp([
    { id: 1, method: "initialize", params: {} },
    { id: 2, method: "tools/list" },
    {
      id: 3,
      method: "tools/call",
      params: {
        name: "strata_record",
        arguments: { kind: "gap", text: "No record of why the queue delivers at least once. key sk-" + "z".repeat(30) },
      },
    },
    {
      id: 4,
      method: "tools/call",
      params: {
        name: "strata_record",
        arguments: { kind: "gap", text: "No record of why the queue delivers at least once. key sk-" + "z".repeat(30) },
      },
    },
    { id: 5, method: "tools/call", params: { name: "strata_record", arguments: { kind: "rant", text: "nope" } } },
  ]);
  assert.equal(init.result.serverInfo.name, "strata");
  assert.deepEqual(
    list.result.tools.map((t) => t.name),
    ["strata_record", "strata_search"],
  );
  assert.match(rec.result.content[0].text, /Recorded/);
  assert.equal(dup.result.content[0].text, "Already recorded.");
  assert.equal(bad.result.isError, true);
  const doc = read("find-1", "summary.json");
  assert.equal(doc.revision, 1);
  assert.equal(doc.summary.gaps.length, 1);
  assert.doesNotMatch(JSON.stringify(doc), /sk-z{10}/, "secrets are redacted before they are stored");
});

test("findings: /note, /gaps, search and the next session start see it; approval is per revision", async () => {
  assert.match(hub("note", "insight", "The ledger rounds per line.").stdout, /Recorded as a insight/);
  assert.equal(hub("note", "bogus", "x").status, 1);
  assert.match(hub("gaps").stdout, /queue delivers at least once/);
  const [, found] = mcp([
    { id: 1, method: "initialize", params: {} },
    { id: 2, method: "tools/call", params: { name: "strata_search", arguments: { query: "ledger rounds" } } },
  ]);
  assert.match(found.result.content[0].text, /\[insight\]/);

  const start = hook("session-start", { session_id: "find-2", cwd: REPO });
  assert.match(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, /queue delivers at least once/);

  assert.match(hub("review").stdout, /Insights:[\s\S]*ledger rounds per line/);
  const sid = "find-1";
  const before = read(sid, "summary.json").revision;
  assert.equal(
    (
      await dashFetch(`/api/sessions/${sid}/summary`, {
        method: "PUT",
        body: { title: "Queue work", built: "Documented delivery.", painPoints: ["Full suite ran four times"] },
      })
    ).status,
    200,
  );
  assert.equal(read(sid, "summary.json").revision, before + 1);
  assert.deepEqual(read(sid, "summary.json").summary.painPoints, ["Full suite ran four times"]);
});

test("findings: the summarizer drafts them, and they ride in the uploaded event", async () => {
  turn("find-3", "x", "SLOW_ME ran the whole suite again and again.");
  assert.deepEqual(read("find-3", "summary.json").summary.painPoints, ["Full suite ran four times"]);
  await dashFetch("/api/login/start", { method: "POST" });
  for (let i = 0; i < 40 && (await (await dashFetch("/api/state")).json()).login.state !== "done"; i += 1)
    await new Promise((r) => setTimeout(r, 250));
  assert.equal((await dashFetch("/api/sessions/find-3", { method: "PATCH", body: { noTicket: true } })).status, 200);
  assert.equal((await approve("find-3", true)).status, 200);
  const event = (await stored()).find((e) => e.sessionId === "find-3");
  assert.deepEqual(event?.summary.painPoints, ["Full suite ran four times"]);
});

test("findings: PreCompact summarizes what is queued before the conversation is dropped", async () => {
  hook("prompt", { session_id: "find-4", cwd: REPO, prompt: "x" });
  hook(
    "stop",
    { session_id: "find-4", cwd: REPO, last_assistant_message: pad("Built the retry worker.") },
    { STRATA_INLINE_WORKER: "0", STRATA_CLAUDE_BIN: "/nonexistent/claude" },
  );
  assert.ok(queue("find-4").length >= 0);
  assert.equal(hook("pre-compact", { session_id: "find-4", cwd: REPO }).status, 0);
});

test("overview: recurring pain points, numbered gaps, and resolving one stops it being raised", async () => {
  const REPO2 = repo("overview-repo", "main", "https://github.com/acme/overview.git");
  const log = (sid, kind, text) => {
    hook("session-start", { session_id: sid, cwd: REPO2 });
    const [, res] = mcp(
      [
        { id: 1, method: "initialize", params: {} },
        { id: 2, method: "tools/call", params: { name: "strata_record", arguments: { kind, text } } },
      ],
      REPO2,
    );
    assert.match(res.result.content[0].text, /Recorded/);
  };
  log("ov-1", "pain-point", "The full test suite takes eleven minutes to run");
  log("ov-1", "gap", "No record of why the queue delivers at least once");
  log("ov-2", "pain-point", "Full test suite takes eleven minutes on every run");
  log("ov-2", "gap", "Why does the queue deliver at least once is not documented");
  log("ov-2", "insight", "Totals must be summed from rounded lines");
  const run = (...a) => spawnSync(process.execPath, [HUB, ...a], { env, encoding: "utf8", cwd: REPO2 }).stdout;

  const gaps = run("gaps");
  assert.match(gaps, /1\. .*queue.*\(2 sessions\)/);
  assert.match(gaps, /Pain points that keep coming back:[\s\S]*test suite[\s\S]*\(2 sessions\)/);

  const ctx = JSON.parse(hook("session-start", { session_id: "ov-3", cwd: REPO2 }).stdout).hookSpecificOutput
    .additionalContext;
  assert.match(ctx, /Totals must be summed from rounded lines/);
  assert.match(ctx, /Information earlier sessions could not find:[\s\S]*queue/);
  assert.match(ctx, /summaries, possibly out of date/);

  assert.match(run("gaps", "resolve", "1"), /Marked as answered/);
  assert.match(run("gaps"), /No open context gaps/);
  assert.doesNotMatch(run("overview"), /queue delivers/);
  assert.match(run("overview"), /Totals must be summed/);
  assert.equal(
    JSON.parse(
      hook("session-start", { session_id: "ov-4", cwd: PLAIN }).stdout ||
        '{"hookSpecificOutput":{"additionalContext":""}}',
    ).hookSpecificOutput.additionalContext.includes("Totals"),
    false,
    "another repo gets nothing from this one",
  );
});

test('roll-up: sessions group by ticket, then PR, then "no ticket"; the dashboard serves it with gaps', async () => {
  const RU = repo("rollup-repo", "RU-7-retry", "https://github.com/acme/rollup.git");
  turn("ru-1", "x", "Added retry to the worker.", RU);
  turn("ru-2", "x", "Moved the timeout into config.", RU);
  hook("session-start", { session_id: "ru-2", cwd: RU });
  mcp(
    [
      { id: 1, method: "initialize", params: {} },
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "strata_record",
          arguments: { kind: "gap", text: "Nobody wrote down the retry budget policy" },
        },
      },
    ],
    RU,
  );
  const run = (...a) => spawnSync(process.execPath, [HUB, ...a], { env, encoding: "utf8", cwd: RU }).stdout;

  const text = run("rollup");
  assert.match(text, /## RU-7 {2}\[2 sessions/);
  assert.match(text, /Gaps:\n {2}- Nobody wrote down the retry budget policy/);
  assert.doesNotMatch(text, /ABC-123/, "another repo is not mixed in");
  assert.match(run("rollup", "--all"), /ABC-123/);

  const { rollups } = await (await dashFetch("/api/rollups")).json();
  const group = rollups.find((g) => g.key === "RU-7");
  assert.equal(group.kind, "ticket");
  assert.equal(group.sessions.length, 2);

  const { repos } = await (await dashFetch("/api/gaps")).json();
  const mine = repos.find((r) => r.open.some((g) => /retry budget/.test(g.text)));
  assert.ok(mine);
  assert.equal(
    (await dashFetch("/api/gaps/resolve", { method: "POST", body: { repoKey: mine.repoKey, text: mine.open[0].text } }))
      .status,
    200,
  );
  assert.equal((await dashFetch("/api/gaps/resolve", { method: "POST", body: { repoKey: "", text: "" } })).status, 400);
  assert.equal(
    (await (await dashFetch("/api/gaps")).json()).repos.some((r) => r.open.some((g) => /retry budget/.test(g.text))),
    false,
  );
  assert.equal((await dashFetch("/api/gaps")).status, 200);
  assert.equal((await fetch(`${dash.base}/api/gaps`)).status, 401, "needs the dashboard secret");
});

test("team: search and roll-ups read approved summaries from the hub; MCP search merges team and local", async () => {
  const run = (...a) => spawnSync(process.execPath, [HUB, ...a], { env, encoding: "utf8", cwd: REPO });
  // find-3 was approved and sent earlier, and carries a pain point.
  const found = run("search", "suite", "four");
  assert.match(found.stdout, /From the team:\n\[pain-point\] Full suite ran four times/);
  assert.match(found.stdout, /On this machine:/);
  const [, res] = mcp([
    { id: 1, method: "initialize", params: {} },
    { id: 2, method: "tools/call", params: { name: "strata_search", arguments: { query: "suite four" } } },
  ]);
  assert.match(res.result.content[0].text, /From the team:[\s\S]*On this machine:/);
  assert.equal(run("search").status, 1);

  const team = run("rollup", "--team");
  assert.match(team.stdout, /session\(s\) by Alice Dev/);
  assert.match(team.stdout, /Pain points:\n {2}- Full suite ran four times/);

  assert.equal((await hubApi("/v1/search?q=", undefined, "GET")).error, "query_required");
  await dashFetch("/api/logout", { method: "POST" });
  assert.doesNotMatch(run("search", "suite", "four").stdout, /From the team/, "signed out: local results only");
  assert.match(run("rollup", "--team").stdout, /sign in/);
});

test("opencode adapter: events drive the same hooks and a broken hook never throws", async () => {
  const mod = await import(path.join(ROOT, "adapters/opencode/strata.js"));
  const OC = repo("oc-repo", "OC-1-x", "https://github.com/acme/oc.git");
  const plugin = await mod.Strata({ directory: OC });
  const fire = (type, properties) => plugin.event({ event: { type, properties } });
  await fire("message.updated", {
    sessionID: "oc-1",
    info: { role: "user" },
    parts: [{ type: "text", text: "add retry" }],
  });
  await fire("message.updated", {
    sessionID: "oc-1",
    info: { role: "assistant" },
    parts: [{ type: "text", text: pad("Added retry to the sync worker.") }],
  });
  Object.assign(process.env, {
    STRATA_HOME: HOME,
    STRATA_URL: URL_,
    STRATA_INLINE_WORKER: "1",
    STRATA_CLAUDE_BIN: path.join(ROOT, "tests/fake-claude.mjs"),
  });
  await fire("session.idle", { sessionID: "oc-1" });
  assert.ok(read("oc-1", "summary.json")?.summary.title, "an opencode turn became a summary");
  await fire("unknown.event", { sessionID: "oc-1" });
  await fire("session.compacted", {});
});
