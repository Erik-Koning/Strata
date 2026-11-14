import { afterEach, describe, expect, it } from "vitest";
import { respond, TOOLS } from "../src/mcp-server.ts";
import { type FakeApi, startFakeApi } from "./fake-api.ts";
import { apiFor, setup } from "./helpers.ts";

let api: FakeApi | null = null;
afterEach(async () => {
  await api?.close();
  api = null;
});

const call = (id: number, name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

async function connected() {
  api = await startFakeApi();
  const { config } = setup(api.url);
  return { api: apiFor(config), project: config.project, sessionID: "mcp" };
}

describe("the MCP server", () => {
  it("initializes with the protocol version the client asked for", async () => {
    const answer = await respond(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      await connected(),
    );
    expect(answer).toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "strata" } },
    });
  });

  it("lists the memory and Relay tools, the same whether or not it's connected", async () => {
    const live = await respond({ jsonrpc: "2.0", id: 2, method: "tools/list" }, await connected());
    const offline = await respond(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { api: null, project: "p", sessionID: "mcp" },
    );
    expect(live).toEqual(offline);
    expect(TOOLS.map((t) => t.name)).toEqual([
      "memory_search",
      "memory_save",
      "memory_forget",
      "strata_handoff_create",
      "strata_handoff_get",
      "strata_handoff_claim",
      "strata_handoff_verify",
      "strata_handoff_complete",
    ]);
  });

  it("searches, saves and forgets through the API", async () => {
    const deps = await connected();
    api!.recalled = [{ _id: "6750a0000000000000000009", kind: "decision", text: "One envelope." }];
    const search = (await respond(call(3, "memory_search", { query: "envelope" }), deps)) as {
      result: { content: { text: string }[] };
    };
    expect(search.result.content[0]?.text).toContain("- 6750a0000000000000000009 [decision] One envelope.");

    const save = (await respond(call(4, "memory_save", { text: "Prefers tabs.", kind: "preference" }), deps)) as {
      result: { content: { text: string }[] };
    };
    expect(save.result.content[0]?.text).toContain("[preference] Prefers tabs.");
    const saved = api!.requests.find((r) => r.path === "/api/memory/save");
    expect(saved?.body).toMatchObject({
      text: "Prefers tabs.",
      kind: "preference",
      scope: { project: "github.com/acme/app" },
    });

    const dry = (await respond(
      call(5, "memory_forget", { ids: ["6750a0000000000000000009"], dryRun: true }),
      deps,
    )) as {
      result: { content: { text: string }[] };
    };
    expect(dry.result.content[0]?.text).toMatch(/^Would forget 1 memories, 2 summaries/);
  });

  it("says how to connect when it has no address or key", async () => {
    const answer = (await respond(call(6, "memory_search", { query: "x" }), {
      api: null,
      project: "p",
      sessionID: "mcp",
    })) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(answer.result.isError).toBe(true);
    expect(answer.result.content[0]?.text).toContain("MEMORY_API_TOKEN");
  });

  it("answers no notification, and an unknown method with an error", async () => {
    const deps = await connected();
    expect(await respond({ jsonrpc: "2.0", method: "notifications/initialized" }, deps)).toBeNull();
    expect(await respond({ jsonrpc: "2.0", id: 7, method: "resources/list" }, deps)).toMatchObject({
      error: { code: -32601 },
    });
  });
});
