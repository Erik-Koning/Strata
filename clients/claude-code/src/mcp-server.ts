// The memory tools, as an MCP server: memory_search, memory_save and memory_forget, over newline-delimited JSON-RPC 2.0
// on stdio. Written by hand (initialize, tools/list, tools/call, ping) so the plugin has no runtime dependencies. The
// tool list is the same from the first request to the last, whatever happens, so it never changes the session's
// prompt prefix.
import type { MemoryHit, MemoryKind } from "@strata/contracts";
import type { Api } from "./api.ts";
import { VERSION } from "./config.ts";

const KINDS = ["preference", "fact", "decision", "convention", "summary"] as const satisfies readonly MemoryKind[];
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const CALL_MS = 5000;

export const TOOLS = [
  {
    name: "memory_search",
    description:
      "Search the user's long-term memory (their preferences, conventions, decisions and facts from earlier sessions) for anything relevant to a question. Returns each memory with its id.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in plain words." },
        k: { type: "integer", minimum: 1, maximum: 20, description: "How many memories at most (default 6)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_save",
    description:
      "Save something to the user's long-term memory when they ask you to remember it. Keep their meaning and their words; one fact, preference, convention or decision per call.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "What to remember, as one self-contained sentence." },
        kind: { type: "string", enum: [...KINDS], description: "What sort of memory it is (default fact)." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_forget",
    description:
      "Forget memories when the user asks you to. Give the ids memory_search returned, or a query. Run it with dryRun first and tell the user what would be removed, including the summaries made from them, before removing anything.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "The memories' ids." },
        query: { type: "string", description: "Forget everything matching this, in place of ids." },
        dryRun: { type: "boolean", description: "Say what would be removed, and remove nothing." },
      },
      additionalProperties: false,
    },
  },
] as const;

interface Request {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface ToolDeps {
  // null when the plugin has no address or token: the tools are listed all the same, and each says how to connect.
  api: Api | null;
  project: string;
  sessionID: string;
}

const text = (body: string, isError = false) => ({
  content: [{ type: "text", text: body }],
  ...(isError ? { isError: true } : {}),
});
const list = (memories: MemoryHit[]): string => memories.map((m) => `- ${m._id} [${m.kind}] ${m.text}`).join("\n");

async function callTool(name: string, args: Record<string, unknown>, deps: ToolDeps) {
  const { api, project, sessionID } = deps;
  if (!api)
    return text(
      "Strata isn't connected. Set MEMORY_API_URL and MEMORY_API_TOKEN (an API key from the app's Connect page), then restart Claude Code.",
      true,
    );
  const scope = { project };
  switch (name) {
    case "memory_search": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) return text("Give a query to search for.", true);
      const k = typeof args.k === "number" ? Math.min(20, Math.max(1, Math.round(args.k))) : 6;
      const { memories } = await api.recall({ sessionID, scope, query, k }, CALL_MS);
      return text(memories.length ? `${memories.length} found:\n${list(memories)}` : "Nothing in memory matches that.");
    }
    case "memory_save": {
      const body = typeof args.text === "string" ? args.text.trim() : "";
      if (!body) return text("Give the text to remember.", true);
      const kind = KINDS.includes(args.kind as MemoryKind) ? (args.kind as MemoryKind) : "fact";
      const { memory } = await api.save({ sessionID, scope, text: body, kind }, CALL_MS);
      return text(`Saved ${memory._id} [${memory.kind}] ${memory.text}`);
    }
    case "memory_forget": {
      const ids = Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === "string") : [];
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!ids.length && !query) return text("Give the ids to forget, or a query.", true);
      const dryRun = args.dryRun === true;
      const result = await api.forget({ scope, ...(ids.length ? { ids } : { query }), dryRun }, CALL_MS);
      const what = `${result.memories} memories, ${result.summaries} summaries made from them, and ${result.events} captured events`;
      return text(dryRun ? `Would forget ${what}. Ids: ${result.ids.join(", ") || "none"}` : `Forgot ${what}.`);
    }
    default:
      return text(`No tool named ${name}.`, true);
  }
}

// Answers one message, or returns null for a notification (which gets no answer).
export async function respond(message: Request, deps: ToolDeps): Promise<object | null> {
  const { id, method, params = {} } = message;
  if (id === undefined || id === null) return null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, msg: string) => ({ jsonrpc: "2.0", id, error: { code, message: msg } });
  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "strata", version: VERSION },
        instructions:
          "The user's long-term memory. Search it when their earlier preferences or decisions would help; save to it only when they ask you to remember something; forget only when they ask, after a dry run.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<
        string,
        unknown
      >;
      try {
        return ok(await callTool(name, args, deps));
      } catch (error) {
        return ok(text(`Strata didn't answer: ${error instanceof Error ? error.message : String(error)}`, true));
      }
    }
    default:
      return fail(-32601, `Method not found: ${method ?? ""}`);
  }
}
