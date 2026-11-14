// The event outbox against a server that refuses some events: what it refuses is set aside with the reason, the rest
// is sent. And git context with no commit leaves `head` out instead of sending "".
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "strata-events-"));
const HOME = path.join(tmp, "home");
// The store reads STRATA_HOME when it is first imported, so the modules are imported after this.
process.env.STRATA_HOME = HOME;

const COMMIT = /^[0-9a-f]{7,64}$/;
const batches = [];
let server;
let lib;

before(async () => {
  // Answers like the real API: one 202 for the batch, listing by index each event whose git head isn't a commit id.
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { batch } = JSON.parse(body);
    batches.push(batch);
    const rejected = batch.flatMap((event, index) => {
      const head = event.payload?.git?.head;
      return head !== undefined && !COMMIT.test(head)
        ? [{ index, id: event.id, code: "invalid", message: "payload.git.head: Invalid string" }]
        : [];
    });
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ accepted: batch.length - rejected.length, duplicates: 0, rejected }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.STRATA_URL = `http://127.0.0.1:${server.address().port}`;
  const store = await import(path.join(ROOT, "scripts/lib/store.mjs"));
  store.setAuth({ token: "test-token" });
  lib = {
    events: await import(path.join(ROOT, "scripts/lib/events.mjs")),
    git: await import(path.join(ROOT, "scripts/lib/git.mjs")),
  };
});

after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("git: no commit, no head; no repository, no head or path", () => {
  const fresh = path.join(tmp, "fresh");
  fs.mkdirSync(fresh, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: fresh });
  const unborn = lib.git.gitContext(fresh);
  assert.equal(unborn.isGit, true);
  assert.equal(unborn.branch, "main");
  assert.equal("head" in unborn, false);
  assert.equal("path" in unborn, false);

  const who = {
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "first"], {
    cwd: fresh,
    env: { ...process.env, ...who },
  });
  const committed = lib.git.gitContext(fresh);
  assert.match(committed.head, COMMIT);
  assert.equal(committed.path, "");

  const outside = path.join(tmp, "not-a-repo");
  fs.mkdirSync(outside, { recursive: true });
  const none = lib.git.gitContext(outside);
  if (!none.isGit) {
    assert.equal("head" in none, false);
    assert.equal("path" in none, false);
  }
});

test("events the server lists in rejected[] are set aside with the reason; the rest are sent", async () => {
  const good = lib.events.enqueueEvent({
    sessionID: "s-1",
    project: "github.com/acme/shop",
    kind: "session",
    payload: { event: "context", git: { branch: "main", head: "3f9c2e1a7b4d" } },
  });
  const bad = lib.events.enqueueEvent({
    sessionID: "s-1",
    project: "github.com/acme/shop",
    kind: "session",
    payload: { event: "context", git: { branch: "main", head: "" } },
  });
  const also = lib.events.enqueueEvent({
    sessionID: "s-1",
    project: "github.com/acme/shop",
    kind: "prompt",
    payload: { role: "user", text: "Fix the retry" },
  });

  const result = await lib.events.flushEvents({ force: true });
  assert.deepEqual(result, { sent: 2, dead: 1, left: 0 });
  // Files sort by time then id, so events from the same millisecond come in any order.
  assert.deepEqual(
    batches
      .at(-1)
      .map((event) => event.id)
      .sort(),
    [good, bad, also].sort(),
  );

  const dead = fs.readdirSync(path.join(HOME, "events", "dead"));
  assert.equal(dead.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(HOME, "events", "dead", dead[0]), "utf8")).id, bad);

  const logged = fs
    .readFileSync(path.join(HOME, "strata.log"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const entry = logged.find((line) => line.message === "event rejected");
  assert.equal(entry.id, bad);
  assert.equal(entry.code, "invalid");
  assert.match(entry.reason, /git\.head/);

  // A second flush has nothing to send: the refused event never goes again.
  const sentBefore = batches.length;
  assert.deepEqual(await lib.events.flushEvents({ force: true }), { sent: 0, dead: 0, left: 0 });
  assert.equal(batches.length, sentBefore);
});
