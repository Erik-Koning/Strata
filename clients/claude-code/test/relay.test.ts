import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callRelayTool, checkRepo, type RelayDeps, repoState, runCommand } from "../src/relay.ts";

const sh = (cwd: string, ...args: string[]) =>
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

describe("repoState", () => {
  it("reads branch, commit, pushed and uncommitted files from git", () => {
    const { a } = repos();
    const pushed = repoState(a);
    expect(pushed).toMatchObject({ branch: "main", pushed: true, uncommitted: [] });
    expect(pushed.commit).toMatch(/^[a-f0-9]{40}$/);
    writeFileSync(join(a, "x.txt"), "2\n");
    sh(a, "commit", "-qam", "two");
    writeFileSync(join(a, "wip.txt"), "draft\n");
    const local = repoState(a);
    expect(local.pushed).toBe(false);
    expect(local.uncommitted).toEqual(["wip.txt"]);
  });
});

describe("checkRepo", () => {
  it("passes on a clone that has the commit, and names a missing one as a blocker", () => {
    const { root, origin, a } = repos();
    const b = join(root, "b");
    execFileSync("git", ["clone", "-q", origin, b], { stdio: "ignore" });
    expect(checkRepo(b, { repo: repoState(a) }).ok).toBe(true);
    // A's next commit, never pushed: B can't have it.
    writeFileSync(join(a, "x.txt"), "3\n");
    sh(a, "commit", "-qam", "unpushed");
    const result = checkRepo(b, { repo: repoState(a) });
    expect(result.ok).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/isn't in this checkout.*NOT pushed/);
  });

  it("refuses a different repository", () => {
    const one = repos();
    const two = repos();
    const result = checkRepo(two.a, { repo: { ...repoState(one.a), url: "git@github.com:acme/other.git" } });
    expect(result.ok).toBe(false);
    expect(result.blockers[0]).toMatch(/Wrong repository/);
  });
});

describe("runCommand", () => {
  it("captures the exit code and redacts the output", async () => {
    const { a } = repos();
    const ok = await runCommand(a, "echo hi");
    expect(ok).toMatchObject({ exitCode: 0 });
    const bad = await runCommand(a, "echo token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 && exit 3");
    expect(bad.exitCode).toBe(3);
    expect(bad.output).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });
});

describe("the Relay tools", () => {
  let server: Server | null = null;
  afterEach(() => server?.close());

  async function fake(handoff: Record<string, unknown>) {
    const seen: { method: string; url: string; body: unknown }[] = [];
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        seen.push({ method: req.method ?? "", url: req.url ?? "", body: raw ? JSON.parse(raw) : null });
        res.setHeader("content-type", "application/json");
        if (req.url?.endsWith("/resume"))
          res.end(
            JSON.stringify({ handoff, memories: [], excluded: [], context: "<strata-handoff>…</strata-handoff>" }),
          );
        else res.end(JSON.stringify({ handoff }));
      });
    });
    await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { url: `http://127.0.0.1:${port}`, seen };
  }

  const deps = (url: string, cwd: string): RelayDeps => ({
    apiUrl: url,
    token: "am_test",
    cwd,
    project: "p",
    sessionID: null,
  });

  it("verifies only the handoff's own test commands, and records the run as verified", async () => {
    const { a } = repos();
    const api = await fake({ _id: "a".repeat(24), testCommands: ["exit 1"], repo: repoState(a) });
    const refused = await callRelayTool(
      "strata_handoff_verify",
      { handoffId: "a".repeat(24), command: "rm -rf /" },
      deps(api.url, a),
    );
    expect(refused.isError).toBe(true);
    expect(api.seen.filter((s) => s.method === "POST")).toHaveLength(0);
    const ran = await callRelayTool(
      "strata_handoff_verify",
      { handoffId: "a".repeat(24), command: "exit 1" },
      deps(api.url, a),
    );
    expect(ran.text).toMatch(/^FAIL `exit 1` \(exit 1/);
    const post = api.seen.find((s) => s.method === "POST");
    expect(post?.url).toBe(`/api/handoffs/${"a".repeat(24)}/tests`);
    expect(post?.body).toMatchObject({ command: "exit 1", status: "fail", exitCode: 1, verified: true });
  });

  it("won't claim when the repository check fails", async () => {
    const { a } = repos();
    const api = await fake({
      _id: "b".repeat(24),
      testCommands: [],
      repo: { ...repoState(a), commit: "f".repeat(40) },
    });
    const answer = await callRelayTool("strata_handoff_claim", { handoffId: "b".repeat(24) }, deps(api.url, a));
    expect(answer.isError).toBe(true);
    expect(api.seen.some((s) => s.url.endsWith("/claim"))).toBe(false);
  });

  it("says how to connect when it isn't", async () => {
    const answer = await callRelayTool(
      "strata_handoff_get",
      { handoffId: "c".repeat(24) },
      {
        apiUrl: null,
        token: null,
        cwd: ".",
        project: "p",
        sessionID: null,
      },
    );
    expect(answer.isError).toBe(true);
  });
});
