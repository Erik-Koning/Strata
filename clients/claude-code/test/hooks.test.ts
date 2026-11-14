import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type MemoryEvent, parseEvent } from "@strata/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { handle } from "../src/hooks.ts";
import { OUTBOX } from "../src/outbox.ts";
import type { Store } from "../src/store.ts";
import { type FakeApi, startFakeApi } from "./fake-api.ts";
import { apiFor, setup, tempHome } from "./helpers.ts";

let api: FakeApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

const queued = (store: Store): MemoryEvent[] =>
  store.keys(OUTBOX).map((k) => JSON.parse(store.get(k) ?? "{}") as MemoryEvent);

async function harness() {
  api = await startFakeApi();
  api.frozen = [{ _id: "6750a0000000000000000001", kind: "preference", text: "Prefers pnpm over npm." }];
  api.recalled = [{ _id: "6750a0000000000000000009", kind: "decision", text: "The API answers in one envelope." }];
  const { store, config } = setup(api.url);
  let kicks = 0;
  const deps = { config, store, api: apiFor(config), kick: () => void kicks++ };
  return { store, deps, kicks: () => kicks };
}

describe("the hooks", () => {
  it("send the frozen block at session start, and only recall with each prompt", async () => {
    const { deps } = await harness();
    const start = JSON.parse(
      await handle({ session_id: "s1", hook_event_name: "SessionStart", source: "startup" }, deps),
    );
    expect(start.hookSpecificOutput).toMatchObject({ hookEventName: "SessionStart" });
    expect(start.hookSpecificOutput.additionalContext).toContain("<memory-frozen>");

    const turn = JSON.parse(
      await handle(
        { session_id: "s1", hook_event_name: "UserPromptSubmit", prompt: "How should the API answer?" },
        deps,
      ),
    );
    expect(turn.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(turn.hookSpecificOutput.additionalContext).toBe(
      "<memory>\nRecalled for this message:\n- [decision] The API answers in one envelope.\n</memory>",
    );
    expect(turn.hookSpecificOutput.additionalContext).not.toContain("memory-frozen");
  });

  it("capture the prompt as the user's, redacted, and send a redacted query", async () => {
    const { store, deps } = await harness();
    await handle(
      {
        session_id: "s1",
        hook_event_name: "UserPromptSubmit",
        prompt: "deploy with GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      },
      deps,
    );
    const [prompt] = queued(store);
    expect(prompt).toMatchObject({ kind: "prompt", sessionID: "s1", scope: { project: "github.com/acme/app" } });
    expect(prompt?.payload).toEqual({ role: "user", text: "deploy with GITHUB_TOKEN=[REDACTED:github-token]" });
    const recall = api!.requests.find((r) => r.path === "/api/memory/recall");
    expect(JSON.stringify(recall?.body)).not.toContain("ghp_");
    expect(recall?.client).toMatch(/^claude-code\//);
  });

  it("record a tool's name and outcome, and nothing of what went in or came out", async () => {
    const { store, deps } = await harness();
    const input = {
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "cat .env" },
      tool_response: { stdout: "SECRET=1" },
    };
    expect(await handle({ ...input, hook_event_name: "PostToolUse" }, deps)).toBe("");
    expect(await handle({ ...input, hook_event_name: "PostToolUseFailure" }, deps)).toBe("");
    expect(queued(store).map((e) => e.payload)).toEqual([
      { tool: "Bash", status: "ok", command: { class: "other" } },
      { tool: "Bash", status: "error", command: { class: "other" } },
    ]);
    const written = JSON.stringify(queued(store));
    for (const leak of ["cat", ".env", "SECRET"]) expect(written).not.toContain(leak);
    expect(api!.requests).toHaveLength(0);
  });

  it("record a shell command as its kind, how long it ran and how it exited, never the command", async () => {
    const { store, deps } = await harness();
    await handle(
      {
        session_id: "s1",
        prompt_id: "p-1",
        hook_event_name: "PostToolUseFailure",
        tool_name: "Bash",
        tool_input: { command: "cd services/invoices && pnpm test --run" },
        tool_use_id: "toolu_01ABC",
        error: "Exit code 1\nFAIL src/retry.test.ts",
        duration_ms: 4187.4,
      },
      deps,
    );
    await handle(
      { session_id: "s1", hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: {}, duration_ms: 12 },
      deps,
    );
    const [bash, edit] = queued(store);
    expect(bash).toMatchObject({ kind: "tool", promptID: "p-1" });
    expect(bash?.payload).toEqual({
      tool: "Bash",
      status: "error",
      ms: 4187,
      toolUseID: "toolu_01ABC",
      command: { class: "test", exit: 1, fp: expect.stringMatching(/^[0-9a-f]{16}$/) },
    });
    expect(JSON.stringify(bash)).not.toContain("pnpm");
    expect(edit?.payload).toEqual({ tool: "Edit", status: "ok", ms: 12 });
  });

  it("send where the work is when a session starts, and again only when the branch or commit changes", async () => {
    const { store, deps } = await harness();
    const repo = tempHome();
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
        stdio: "pipe",
      });
    git("init", "-q", "-b", "feat/PAY-412-invoice-retry");
    git("remote", "add", "origin", "git@github.com:acme/billing.git");
    git("commit", "-q", "--allow-empty", "-m", "first");
    mkdirSync(join(repo, "services", "invoices"), { recursive: true });
    const cwd = join(repo, "services", "invoices");

    await handle({ session_id: "s1", hook_event_name: "SessionStart", source: "startup", cwd }, deps);
    const [start] = queued(store);
    expect(start?.payload).toEqual({
      event: "start",
      source: "startup",
      git: {
        remote: "github.com/acme/billing",
        branch: "feat/PAY-412-invoice-retry",
        head: expect.stringMatching(/^[0-9a-f]{40}$/),
        path: "services/invoices",
      },
      refs: [{ type: "ticket", id: "PAY-412" }],
    });

    await handle({ session_id: "s1", hook_event_name: "Stop", cwd }, deps);
    expect(queued(store)).toHaveLength(1);

    git("commit", "-q", "--allow-empty", "-m", "second");
    await handle({ session_id: "s1", hook_event_name: "Stop", cwd }, deps);
    const head = (event: MemoryEvent | undefined) =>
      (event?.payload as { git?: { head?: string } } | undefined)?.git?.head;
    const context = queued(store)[1];
    expect(context?.payload).toMatchObject({ event: "context", git: { branch: "feat/PAY-412-invoice-retry" } });
    expect(head(context)).toMatch(/^[0-9a-f]{40}$/);
    expect(head(context)).not.toBe(head(start));
  });

  it("queue only events the contract knows, each one valid, through a whole session", async () => {
    const { store, deps } = await harness();
    const transcript = join(tempHome(), "t.jsonl");
    writeFileSync(transcript, JSON.stringify({ type: "user", uuid: "u1", message: { role: "user", content: "Hi." } }));
    const turn = { session_id: "s1", prompt_id: "p-1" };
    await handle({ ...turn, hook_event_name: "SessionStart", source: "startup" }, deps);
    await handle({ ...turn, hook_event_name: "UserPromptSubmit", prompt: "Run the tests." }, deps);
    await handle(
      {
        ...turn,
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
        duration_ms: 9,
      },
      deps,
    );
    await handle({ ...turn, hook_event_name: "PreCompact", trigger: "auto", transcript_path: transcript }, deps);
    await handle({ ...turn, hook_event_name: "PostCompact", trigger: "auto", compact_summary: "Tests ran." }, deps);
    await handle({ ...turn, hook_event_name: "Stop", last_assistant_message: "They pass." }, deps);
    await handle({ ...turn, hook_event_name: "SessionEnd", reason: "other" }, deps);
    const events = queued(store);
    expect(new Set(events.map((e) => e.kind))).toEqual(
      new Set(["session", "prompt", "tool", "transcript", "event", "assistant"]),
    );
    for (const event of events) expect(parseEvent(event)).toMatchObject({ ok: true, known: true });
  });

  it("before compaction, capture the transcript and ask for a summary, printing nothing", async () => {
    const { store, deps } = await harness();
    const transcript = join(tempHome(), "t.jsonl");
    writeFileSync(
      transcript,
      [
        { type: "user", uuid: "u1", message: { role: "user", content: "Use pnpm." } },
        {
          type: "assistant",
          uuid: "a1",
          message: { role: "assistant", content: [{ type: "text", text: "Will do." }] },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n"),
    );
    expect(
      await handle(
        { session_id: "s1", hook_event_name: "PreCompact", trigger: "auto", transcript_path: transcript },
        deps,
      ),
    ).toBe("");
    expect(queued(store)[0]).toMatchObject({ kind: "transcript" });
    const compress = api!.requests.find((r) => r.path === "/api/memory/compress");
    expect((compress?.body as { messages: unknown[] } | undefined)?.messages).toHaveLength(2);
  });

  it("on Stop, capture Claude's last message as the assistant's and start the flusher", async () => {
    const { store, deps, kicks } = await harness();
    await handle({ session_id: "s1", hook_event_name: "Stop", last_assistant_message: "Done." }, deps);
    expect(queued(store)[0]?.payload).toEqual({ role: "assistant", text: "Done." });
    expect(kicks()).toBe(1);
  });

  it("fail open: a prompt goes ahead with nothing added when the API is down", async () => {
    const { deps } = await harness();
    await api!.close();
    api = null;
    expect(await handle({ session_id: "s1", hook_event_name: "UserPromptSubmit", prompt: "hello" }, deps)).toBe("");
  });

  it("do nothing without a session id", async () => {
    const { store, deps } = await harness();
    expect(await handle({ hook_event_name: "UserPromptSubmit", prompt: "hi" }, deps)).toBe("");
    expect(queued(store)).toHaveLength(0);
  });
});
