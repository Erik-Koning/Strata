// Relay in the plugin: the repository checks, the test runs, the five tools against a fake API, and the MCP server
// listing and dispatching them with the plugin's own sign-in (STRATA_HOME/auth.json) and server (STRATA_URL).
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { appOrigin, callRelayTool, checkRepo, RELAY_TOOLS, repoState, runCommand } from "../scripts/lib/relay.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MCP = join(here, "..", "scripts", "mcp.mjs");

const sh = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// An origin (bare), and a clone with one pushed commit.
function repos() {
  const root = mkdtempSync(join(tmpdir(), "strata-relay-"));
  const origin = join(root, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const a = join(root, "a");
  execFileSync("git", ["clone", "-q", origin, a], { stdio: "ignore" });
  sh(a, "config", "user.email", "a@example.com");
  sh(a, "config", "user.name", "A");
  sh(a, "switch", "-q", "-c", "main");
  writeFileSync(join(a, "x.txt"), "1\n");
  sh(a, "add", ".");
  sh(a, "commit", "-qm", "one");
  sh(a, "push", "-q", "origin", "main");
  return { root, origin, a };
}

const servers = [];
after(() => {
  for (const s of servers) s.close();
});

// A stand-in for the Strata API: answers every handoff route with `handoff`, and records what it was sent.
async function fake(handoff) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null,
      });
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/resume"))
        res.end(JSON.stringify({ handoff, memories: [], excluded: [], context: "<strata-handoff>…</strata-handoff>" }));
      else res.end(JSON.stringify({ handoff }));
    });
  });
  servers.push(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

const deps = (url, cwd) => ({ apiUrl: url, token: "am_test", cwd, project: "p", sessionID: null });

describe("repoState", () => {
  it("reads branch, commit, pushed and uncommitted files from git", () => {
    const { a } = repos();
    const pushed = repoState(a);
    assert.equal(pushed.branch, "main");
    assert.equal(pushed.pushed, true);
    assert.deepEqual(pushed.uncommitted, []);
    assert.match(pushed.commit, /^[a-f0-9]{40}$/);
    writeFileSync(join(a, "x.txt"), "2\n");
    sh(a, "commit", "-qam", "two");
    writeFileSync(join(a, "wip.txt"), "draft\n");
    const local = repoState(a);
    assert.equal(local.pushed, false);
    assert.deepEqual(local.uncommitted, ["wip.txt"]);
  });
});

describe("checkRepo", () => {
  it("passes on a clone that has the commit, and names a missing one as a blocker", () => {
    const { root, origin, a } = repos();
    const b = join(root, "b");
    execFileSync("git", ["clone", "-q", origin, b], { stdio: "ignore" });
    assert.equal(checkRepo(b, { repo: repoState(a) }).ok, true);
    // A's next commit, never pushed: B can't have it.
    writeFileSync(join(a, "x.txt"), "3\n");
    sh(a, "commit", "-qam", "unpushed");
    const result = checkRepo(b, { repo: repoState(a) });
    assert.equal(result.ok, false);
    assert.match(result.blockers.join(" "), /isn't in this checkout.*NOT pushed/);
  });

  it("refuses a different repository", () => {
    const one = repos();
    const two = repos();
    const result = checkRepo(two.a, { repo: { ...repoState(one.a), url: "git@github.com:acme/other.git" } });
    assert.equal(result.ok, false);
    assert.match(result.blockers[0], /Wrong repository/);
  });
});

describe("runCommand", () => {
  it("captures the exit code and redacts the output", async () => {
    const { a } = repos();
    assert.equal((await runCommand(a, "echo hi")).exitCode, 0);
    const bad = await runCommand(a, "echo token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 && exit 3");
    assert.equal(bad.exitCode, 3);
    assert.ok(!bad.output.includes("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
  });
});

describe("the Relay tools", () => {
  it("verify only the handoff's own test commands, and record the run as verified", async () => {
    const { a } = repos();
    const api = await fake({ _id: "a".repeat(24), testCommands: ["exit 1"], repo: repoState(a) });
    const refused = await callRelayTool(
      "strata_handoff_verify",
      { handoffId: "a".repeat(24), command: "rm -rf /" },
      deps(api.url, a),
    );
    assert.equal(refused.isError, true);
    assert.equal(api.seen.filter((s) => s.method === "POST").length, 0);
    const ran = await callRelayTool(
      "strata_handoff_verify",
      { handoffId: "a".repeat(24), command: "exit 1" },
      deps(api.url, a),
    );
    assert.match(ran.text, /^FAIL `exit 1` \(exit 1/);
    const post = api.seen.find((s) => s.method === "POST");
    assert.equal(post.url, `/api/handoffs/${"a".repeat(24)}/tests`);
    assert.equal(post.auth, "Bearer am_test");
    assert.deepEqual(
      {
        command: post.body.command,
        status: post.body.status,
        exitCode: post.body.exitCode,
        verified: post.body.verified,
      },
      { command: "exit 1", status: "fail", exitCode: 1, verified: true },
    );
  });

  it("won't claim when the repository check fails", async () => {
    const { a } = repos();
    const api = await fake({
      _id: "b".repeat(24),
      testCommands: [],
      repo: { ...repoState(a), commit: "f".repeat(40) },
    });
    const answer = await callRelayTool("strata_handoff_claim", { handoffId: "b".repeat(24) }, deps(api.url, a));
    assert.equal(answer.isError, true);
    assert.ok(!api.seen.some((s) => s.url.endsWith("/claim")));
  });

  it("say how to sign in when it isn't", async () => {
    const answer = await callRelayTool(
      "strata_handoff_get",
      { handoffId: "c".repeat(24) },
      { apiUrl: "http://localhost:1", token: null, cwd: ".", project: "p", sessionID: null },
    );
    assert.equal(answer.isError, true);
    assert.match(answer.text, /strata:login/);
  });

  it("refuse to send the token over plain http to another host", async () => {
    const answer = await callRelayTool(
      "strata_handoff_get",
      { handoffId: "d".repeat(24) },
      deps("http://hub.example.com", "."),
    ).catch((err) => ({ thrown: err.message }));
    assert.match(answer.thrown ?? "", /plain http/);
  });

  it("take the app's origin from STRATA_URL, with or without /api", () => {
    assert.equal(appOrigin("https://strata.example.com"), "https://strata.example.com");
    assert.equal(appOrigin("https://strata.example.com/api/"), "https://strata.example.com");
  });
});

// The plugin's real MCP server, over stdio, as Claude Code starts it.
function mcp(env) {
  const child = spawn(process.execPath, [MCP], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  const waiting = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const msg = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      waiting.get(msg.id)?.(msg);
      nl = buffer.indexOf("\n");
    }
  });
  let next = 0;
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = ++next;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return { request, close: () => child.kill() };
}

describe("the plugin's MCP server", () => {
  it("lists main's tools and all five Relay tools", async () => {
    const home = mkdtempSync(join(tmpdir(), "strata-home-"));
    const server = mcp({ STRATA_HOME: home });
    try {
      await server.request("initialize", { protocolVersion: "2025-06-18" });
      const { result } = await server.request("tools/list");
      const names = result.tools.map((t) => t.name);
      for (const name of ["strata_record", "strata_search", ...RELAY_TOOLS.map((t) => t.name)])
        assert.ok(names.includes(name), `missing ${name}`);
      assert.equal(names.length, 7);
    } finally {
      server.close();
    }
  });

  it("calls the Relay API with the signed-in token from STRATA_HOME and the server from STRATA_URL", async () => {
    const { a } = repos();
    const api = await fake({ _id: "e".repeat(24), testCommands: [], repo: repoState(a) });
    const home = mkdtempSync(join(tmpdir(), "strata-home-"));
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "auth.json"), JSON.stringify({ token: "am_from_login", serverUrl: api.url }));
    const server = mcp({ STRATA_HOME: home, STRATA_URL: api.url, CLAUDE_PROJECT_DIR: a });
    try {
      await server.request("initialize", { protocolVersion: "2025-06-18" });
      const { result } = await server.request("tools/call", {
        name: "strata_handoff_get",
        arguments: { handoffId: "e".repeat(24) },
      });
      assert.ok(!result.isError, result.content[0].text);
      assert.match(result.content[0].text, /strata-repository-check ok="true"/);
      const get = api.seen.find((s) => s.url === `/api/handoffs/${"e".repeat(24)}/resume`);
      assert.equal(get?.auth, "Bearer am_from_login");
    } finally {
      server.close();
    }
  });

  it("answers a Relay call without sign-in with how to sign in, not a crash", async () => {
    const home = mkdtempSync(join(tmpdir(), "strata-home-"));
    const server = mcp({ STRATA_HOME: home, STRATA_URL: "http://localhost:1" });
    try {
      await server.request("initialize", { protocolVersion: "2025-06-18" });
      const { result } = await server.request("tools/call", {
        name: "strata_handoff_claim",
        arguments: { handoffId: "f".repeat(24) },
      });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /strata:login/);
    } finally {
      server.close();
    }
  });
});
