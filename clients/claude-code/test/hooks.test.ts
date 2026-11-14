import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryEvent } from "@strata/contracts";
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
      { tool: "Bash", status: "ok" },
      { tool: "Bash", status: "error" },
    ]);
    expect(api!.requests).toHaveLength(0);
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
