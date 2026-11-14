#!/usr/bin/env node
// The Relay demo, end to end, with nothing faked:
//
//   1. setup.sh builds an origin and two clones: Alice's has a pushed WIP branch whose test fails.
//   2. Three real accounts (Alice, Bob, Mallory), each with their own API key.
//   3. ALICE: a real, headless Claude Code session in her clone runs /strata:handoff. The plugin reads git, runs the
//      failing test and records it as verified evidence. The handoff is a draft that only Alice can see.
//   4. Bob and Mallory try to read the draft: 404.
//   5. Alice approves it for Bob, sharing exactly one memory (the app's Relay page does this; here it's the same API).
//   6. Mallory still gets 404. Bob's resume carries the shared memory and never Alice's private one.
//   7. BOB: a fresh, headless Claude Code session in his own clone, with his own key, runs /strata:resume <id>.
//      It checks the repository, claims the handoff, finishes the feature, runs the tests through Strata, and completes.
//   8. The demo checks the result itself: npm test in Bob's clone, and the handoff's recorded state.
//   9. Revocation: a second handoff is approved for Bob, read by him, revoked by Alice, and then 404 for Bob.
//
// Usage: node demo/relay/run.mjs [--api http://localhost:9316] [--dir DIR] [--project NAME] [--skip-claude]
//   Needs the web app running against MongoDB, and `claude` on PATH, signed in.
//   Each person's Claude Code session gets the plugin's own settings: STRATA_URL, a STRATA_HOME of their own with the
//   auth.json /strata:login would write (their API key), and STRATA_PROJECT.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const API = (arg("--api", process.env.MEMORY_API_URL) ?? "http://localhost:9316").replace(/\/+$/, "");
const DIR = resolve(arg("--dir", join(here, ".demo-run")));
const SKIP_CLAUDE = process.argv.includes("--skip-claude");
// A repository-shaped name (host/path) makes the demo a product on the team pages: --project relay-demo.local/durations
const PROJECT = arg("--project", "relay-demo/durations");
const LOG = join(DIR, "..", ".demo-logs");
mkdirSync(LOG, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const step = (s) => console.log(`\n== ${s}`);

// The dev server may be recompiling (or restarting) for a moment: a dropped connection is retried, an HTTP answer isn't.
async function fetchRetry(url, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (attempt >= 8) throw error;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function api(key, method, path, body) {
  const res = await fetchRetry(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "x-memory-client": "relay-demo/1",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

// A real Claude Code session, headless, with the plugin loaded from this repository and the person's own key.
function claude(who, key, cwd, prompt) {
  // Signed in as this person, as /strata:login leaves it: a token (an API key the server made for them) in auth.json.
  const home = join(DIR, `.strata-${who}`);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(join(home, "auth.json"), JSON.stringify({ token: key, serverUrl: API }), { mode: 0o600 });
  const env = {
    ...process.env,
    STRATA_URL: API,
    STRATA_HOME: home,
    STRATA_PROJECT: PROJECT,
  };
  const args = [
    "-p",
    prompt,
    "--plugin-dir",
    join(root, "clients/claude-code"),
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    "mcp__plugin_strata_strata__strata_handoff_create",
    "mcp__plugin_strata_strata__strata_handoff_get",
    "mcp__plugin_strata_strata__strata_handoff_claim",
    "mcp__plugin_strata_strata__strata_handoff_verify",
    "mcp__plugin_strata_strata__strata_handoff_complete",
    "Bash(git:*)",
    "Bash(npm test:*)",
    "Bash(node --test:*)",
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
  ];
  console.log(`   $ (cd ${cwd} && claude -p ${JSON.stringify(prompt)} --plugin-dir clients/claude-code …)  as ${who}`);
  const started = Date.now();
  const run = spawnSync("claude", args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60_000,
  });
  const transcript = join(LOG, `${who}-session.jsonl`);
  writeFileSync(transcript, run.stdout ?? "");
  const events = (run.stdout ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const toolUses = events
    .filter((e) => e.type === "assistant")
    .flatMap((e) => e.message?.content ?? [])
    .filter((c) => c.type === "tool_use")
    .map((c) => c.name);
  const final = events.find((e) => e.type === "result");
  // What Claude Code itself reports at startup: the plugin's MCP server and the tools it exposed.
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const server = (init?.mcp_servers ?? []).find((s) => /strata/.test(s.name));
  const relayTools = (init?.tools ?? []).filter((t) => /strata_handoff_/.test(t));
  check(
    `${who}'s Claude Code loaded the plugin's MCP server with all five Relay tools`,
    server?.status === "connected" && relayTools.length === 5,
    `${server?.name ?? "no strata server"}: ${server?.status ?? "-"}, ${relayTools.length} handoff tools`,
  );
  console.log(
    `   session ${final?.session_id ?? "?"}: ${toolUses.length} tool calls in ${Math.round((Date.now() - started) / 1000)} s; transcript ${transcript}`,
  );
  console.log(`   tools: ${toolUses.join(", ")}`);
  if (run.status !== 0) console.log(`   claude exited ${run.status}: ${(run.stderr ?? "").slice(-800)}`);
  return { toolUses, final, events };
}

step("1. Repositories");
execFileSync(join(here, "setup.sh"), [DIR], { stdio: "inherit" });

step("2. Accounts (invite + sign-up, a key each)");
const accountsFile = join(DIR, "accounts.json");
execFileSync("pnpm", ["--filter", "@strata/web", "run", "relay:demo-accounts", accountsFile, PROJECT], {
  cwd: root,
  stdio: "inherit",
});
const accounts = JSON.parse(readFileSync(accountsFile, "utf8"));
const { alice, bob, mallory } = accounts.people;
const health = await fetchRetry(`${API}/api/health`).then((r) => r.json());
console.log(`   api ${API}: ${JSON.stringify(health)}`);

step("3. Alice drafts the handoff in her own Claude Code session");
let handoffId;
if (SKIP_CLAUDE) {
  const repo = {
    url: execFileSync("git", ["-C", join(DIR, "alice"), "config", "--get", "remote.origin.url"], {
      encoding: "utf8",
    }).trim(),
    branch: "feat/compound-durations",
    commit: execFileSync("git", ["-C", join(DIR, "alice"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    pushed: true,
    uncommitted: [],
  };
  const made = await api(alice.key, "POST", "/api/handoffs", {
    project: PROJECT,
    title: "Compound durations (1h30m)",
    summary: "parseDuration handles single units; compound tests are written and failing.",
    remaining: ["Parse compound durations", "Reject garbage between parts"],
    nextAction: "Loop over unit matches; require them to cover the whole string.",
    testCommands: ["npm test"],
    repo,
  });
  handoffId = made.json?.handoff?._id;
} else {
  claude(
    "alice",
    alice.key,
    join(DIR, "alice"),
    "/strata:handoff for Bob Baker. Context from my session: the compound-duration tests in test/compound.test.js are written and committed, and they fail. I tried String.split on the unit letters, but 'ms' vs 'm' made that ambiguous, so I abandoned it. Decision: durations are integer milliseconds, rounded once at the end. The next step is a global regex over (number)(unit) parts that must cover the whole string, spaces allowed between parts. The test command is `npm test`. Everything is committed and pushed. Create the handoff now; don't ask me anything.",
  );
  const outbox = await api(alice.key, "GET", "/api/handoffs?box=outbox");
  handoffId = outbox.json?.handoffs?.find((h) => h.status === "draft")?._id;
}
check("Alice's session created a draft handoff", Boolean(handoffId), handoffId);
if (!handoffId) process.exit(1);
const draft = (await api(alice.key, "GET", `/api/handoffs/${handoffId}`)).json?.handoff;
check(
  "the draft carries git state read by the plugin",
  draft?.repo?.branch === "feat/compound-durations" && /^[a-f0-9]{40}$/.test(draft?.repo?.commit ?? ""),
  `${draft?.repo?.branch} @ ${draft?.repo?.commit?.slice(0, 7)} pushed=${draft?.repo?.pushed}`,
);
const senderRun = draft?.tests?.find((t) => t.by === "sender");
if (!SKIP_CLAUDE)
  check(
    "the failing test was run and recorded as verified evidence",
    senderRun?.verified === true && senderRun?.status === "fail",
    senderRun ? `${senderRun.command}: ${senderRun.status}, exit ${senderRun.exitCode}` : "no run",
  );

step("4. Before approval, nobody else can read it");
check("Bob: draft is 404", (await api(bob.key, "GET", `/api/handoffs/${handoffId}`)).status === 404);
check("Bob: resume of a draft is 404", (await api(bob.key, "GET", `/api/handoffs/${handoffId}/resume`)).status === 404);
check("Mallory: draft is 404", (await api(mallory.key, "GET", `/api/handoffs/${handoffId}`)).status === 404);
check(
  "Bob can't approve Alice's draft",
  (await api(bob.key, "POST", `/api/handoffs/${handoffId}/approve`, { recipientId: bob.id })).status >= 400,
);

step("5. Alice approves it for Bob, sharing exactly one memory");
const approved = await api(alice.key, "POST", `/api/handoffs/${handoffId}/approve`, {
  recipientEmail: bob.email,
  memoryIds: [accounts.memories.shared],
});
check("approved", approved.status === 200 && approved.json?.handoff?.status === "approved", `HTTP ${approved.status}`);

step("6. Only Bob can read it, and only what was shared");
check(
  "Mallory: approved handoff is still 404",
  (await api(mallory.key, "GET", `/api/handoffs/${handoffId}`)).status === 404,
);
check("Mallory: resume is 404", (await api(mallory.key, "GET", `/api/handoffs/${handoffId}/resume`)).status === 404);
const resume = await api(bob.key, "GET", `/api/handoffs/${handoffId}/resume`);
const ids = (resume.json?.memories ?? []).map((m) => m._id);
check("Bob: resume is 200", resume.status === 200);
check("Bob gets the shared memory", ids.includes(accounts.memories.shared));
check(
  "Bob never gets Alice's private memory",
  !ids.includes(accounts.memories.private) && !(resume.json?.context ?? "").includes("interviewing"),
);
check("the context is framed as untrusted", /untrusted/i.test(resume.json?.context ?? ""));
const inboxM = await api(mallory.key, "GET", "/api/handoffs?box=inbox");
check("Mallory's inbox doesn't list it", !(inboxM.json?.handoffs ?? []).some((h) => h._id === handoffId));

step("7. Bob resumes in a fresh Claude Code session, in his own clone, with his own key");
if (!SKIP_CLAUDE) {
  const session = claude("bob", bob.key, join(DIR, "bob"), `/strata:resume ${handoffId}`);
  check(
    "Bob's session used the Relay tools",
    ["get", "claim", "verify", "complete"].every((t) =>
      session.toolUses.some((u) => u.endsWith(`strata_handoff_${t}`)),
    ),
  );
}

step("8. Check the continuation ourselves");
const bobDir = join(DIR, "bob");
const branch = execFileSync("git", ["-C", bobDir, "branch", "--show-current"], { encoding: "utf8" }).trim();
const ownTest = spawnSync("npm", ["test"], { cwd: bobDir, encoding: "utf8" });
if (!SKIP_CLAUDE) {
  check("Bob's clone is on the handoff's branch", branch === "feat/compound-durations", branch);
  check(
    "npm test passes in Bob's clone (run by this script, not the agent)",
    ownTest.status === 0,
    `exit ${ownTest.status}`,
  );
}
const final = (await api(alice.key, "GET", `/api/handoffs/${handoffId}`)).json?.handoff;
if (!SKIP_CLAUDE) {
  check("the handoff is completed", final?.status === "completed", final?.status);
  check("the continuation is verified by recorded test runs", final?.continuation?.verified === true);
  const head = execFileSync("git", ["-C", bobDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  check("the recorded final commit is Bob's HEAD", final?.continuation?.repo?.commit === head, head.slice(0, 7));
}

step("9. Revocation");
const second = await api(alice.key, "POST", "/api/handoffs", {
  project: PROJECT,
  title: "Document compound durations in the README",
  summary: "A follow-up, to show revocation.",
  nextAction: "Add examples to README.md",
  repo: draft?.repo,
});
const secondId = second.json?.handoff?._id;
await api(alice.key, "POST", `/api/handoffs/${secondId}/approve`, { recipientId: bob.id, memoryIds: [] });
check(
  "Bob can read the second handoff once approved",
  (await api(bob.key, "GET", `/api/handoffs/${secondId}`)).status === 200,
);
const revoked = await api(alice.key, "POST", `/api/handoffs/${secondId}/revoke`, { reason: "demo: changed plans" });
check("Alice revokes it", revoked.json?.handoff?.status === "revoked");
check("Bob: revoked handoff is 404", (await api(bob.key, "GET", `/api/handoffs/${secondId}`)).status === 404);
check("Bob: revoked resume is 404", (await api(bob.key, "GET", `/api/handoffs/${secondId}/resume`)).status === 404);
check("a made-up token is 401", (await api("am_".padEnd(30, "x"), "GET", "/api/handoffs")).status === 401);

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed. Handoff: ${API}/relay?id=${handoffId}`,
);
writeFileSync(join(LOG, "result.json"), `${JSON.stringify({ handoffId, secondId, results }, null, 2)}\n`);
process.exit(failed.length ? 1 : 0);
