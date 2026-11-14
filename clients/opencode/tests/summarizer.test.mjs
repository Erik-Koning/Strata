import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// The summarizer backend: the OpenCode client must be able to write summaries through `opencode run`, with no
// Claude Code binary on the machine. Exercised through the core's real hook and worker entrypoints.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.resolve(ROOT, "../claude-code");
const HOOK = path.join(CORE, "scripts/hook.mjs");
const FAKE_OPENCODE = path.join(ROOT, "tests/fake-opencode-bin.mjs");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "strata-opencode-model-"));
const HOME = path.join(tmp, "home");
const REPO = path.join(tmp, "repo");
const LOG = path.join(tmp, "opencode-calls.log");

const env = {
  ...process.env,
  STRATA_HOME: HOME,
  STRATA_INLINE_WORKER: "1",
  STRATA_SUMMARIZER_BACKEND: "opencode",
  STRATA_OPENCODE_BIN: FAKE_OPENCODE,
  // Deliberately absent: the point is that the opencode backend needs no Claude Code install.
  STRATA_CLAUDE_BIN: path.join(tmp, "no-such-claude"),
  FAKE_OPENCODE_LOG: LOG,
};
delete env.STRATA_DISABLED;
delete env.STRATA_INTERNAL;

let saved;

before(() => {
  saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  fs.mkdirSync(REPO, { recursive: true });
  spawnSync("git", ["init", "-q", "-b", "feat/OC-1-summarizer"], { cwd: REPO });
});

after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const hook = (name, input) =>
  spawnSync(process.execPath, [HOOK, name], { input: JSON.stringify(input), env, encoding: "utf8" });

const REPLY =
  "Added the opencode summarizer backend and wired it through the shared model dispatcher so both clients use exactly one worker path, verified against the fake opencode binary with the claude binary absent from the machine entirely. Extra detail to pass the reply threshold.";

test("the opencode backend writes a summary with no claude CLI installed", () => {
  hook("prompt", { session_id: "s_open", cwd: REPO, prompt: "wire the backend", prompt_id: "p_open" });
  const stopped = hook("stop", { session_id: "s_open", cwd: REPO, last_assistant_message: REPLY });
  assert.equal(stopped.status, 0);

  const summaryFile = path.join(HOME, "store", "sessions", "s_open", "summary.json");
  assert.ok(fs.existsSync(summaryFile), "a summary must be written through the opencode backend");
  const summary = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
  assert.ok(summary.summary?.title, "the summary must carry a title");
  assert.equal(summary.revision, 1);

  const health = JSON.parse(fs.readFileSync(path.join(HOME, "health.json"), "utf8"));
  assert.equal(health.summarizerError, null, "no summarizer error may be recorded");

  assert.ok(fs.existsSync(LOG), "the opencode CLI must have been called");
  const calls = fs
    .readFileSync(LOG, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    calls.some((call) => call.args[0] === "run"),
    "the summarizer must invoke `opencode run`",
  );
});

test("the summarizer's own directory is never captured", async () => {
  const { isExcluded } = await import(path.join(CORE, "scripts/lib/filter.mjs"));
  const summarizerDir = path.join(HOME, "summarizer");
  fs.mkdirSync(summarizerDir, { recursive: true });
  assert.equal(isExcluded(summarizerDir), true, "the summarizer sandbox must be excluded");
  assert.equal(isExcluded(REPO), false, "an ordinary repo must not be excluded");
});

test("the default backend is still claude, so Claude Code users are unaffected", async () => {
  const { summarizerBackend } = await import(path.join(CORE, "scripts/lib/model.mjs"));
  const previous = process.env.STRATA_SUMMARIZER_BACKEND;
  delete process.env.STRATA_SUMMARIZER_BACKEND;
  try {
    assert.equal(summarizerBackend(), "claude");
  } finally {
    if (previous !== undefined) process.env.STRATA_SUMMARIZER_BACKEND = previous;
  }
});
