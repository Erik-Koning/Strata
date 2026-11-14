// Strata for Claude Code. Built from src/ by build.ts: edit those, not this.

// src/mcp.ts
import { createInterface } from "node:readline";

// src/config.ts
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";
var VERSION = true ? "0.1.0" : "dev";
var CLIENT = `claude-code/${VERSION}`;
function setting(env, ...names) {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value && !value.startsWith("${")) return value;
  }
  return null;
}
function memoryHome(env = process.env) {
  return setting(env, "MEMORY_HOME", "CLAUDE_PLUGIN_DATA") ?? join(homedir(), ".claude", "strata");
}
function loadConfig(env = process.env, cwd) {
  const apiUrl = setting(env, "MEMORY_API_URL", "CLAUDE_PLUGIN_OPTION_API_URL", "STRATA_API_URL");
  const token = setting(env, "MEMORY_API_TOKEN", "CLAUDE_PLUGIN_OPTION_API_TOKEN", "STRATA_API_TOKEN");
  if (!apiUrl || !token) return null;
  const where = setting(env, "CLAUDE_PROJECT_DIR") ?? cwd ?? process.cwd();
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    token,
    home: memoryHome(env),
    project: setting(env, "MEMORY_PROJECT") ?? projectOf(where)
  };
}
function normalizeRemote(remote) {
  const url = remote.trim();
  if (!url) return null;
  const scp = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(url);
  let host;
  let path;
  if (scp) {
    host = scp[1] ?? "";
    path = scp[2] ?? "";
  } else {
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
  if (!host || !path) return null;
  return `${host.toLowerCase()}/${path}`;
}
function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500
    }).trim() || null;
  } catch {
    return null;
  }
}
function projectOf(cwd) {
  const remote = git(cwd, ["config", "--get", "remote.origin.url"]);
  const normalized = remote ? normalizeRemote(remote) : null;
  if (normalized) return normalized;
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  return basename(top ?? cwd) || "default";
}

// src/api.ts
var ApiError = class extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function makeApi(config2) {
  async function call(method, path, body, ms) {
    const response = await fetch(`${config2.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config2.token}`,
        "x-memory-client": CLIENT,
        ...body === void 0 ? {} : { "content-type": "application/json" }
      },
      ...body === void 0 ? {} : { body: JSON.stringify(body) },
      signal: AbortSignal.timeout(ms)
    });
    const text2 = await response.text();
    let parsed = null;
    try {
      parsed = text2 ? JSON.parse(text2) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const message = parsed?.error?.message;
      throw new ApiError(response.status, typeof message === "string" ? message : `HTTP ${response.status}`);
    }
    return parsed;
  }
  return {
    events: (batch, ms) => call("POST", "/api/memory/events", { batch }, ms),
    recall: (body, ms) => call("POST", "/api/memory/recall", body, ms),
    frozen: ({ sessionID, project }, ms) => call("GET", `/api/memory/frozen?${new URLSearchParams({ sessionID, project }).toString()}`, void 0, ms),
    compress: (body, ms) => call("POST", "/api/memory/compress", body, ms),
    forget: (body, ms) => call("POST", "/api/memory/forget", body, ms),
    save: (body, ms) => call("POST", "/api/memory/save", body, ms)
  };
}

// src/mcp-server.ts
var KINDS = ["preference", "fact", "decision", "convention", "summary"];
var PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
var CALL_MS = 5e3;
var TOOLS = [
  {
    name: "memory_search",
    description: "Search the user's long-term memory (their preferences, conventions, decisions and facts from earlier sessions) for anything relevant to a question. Returns each memory with its id.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in plain words." },
        k: { type: "integer", minimum: 1, maximum: 20, description: "How many memories at most (default 6)." }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "memory_save",
    description: "Save something to the user's long-term memory when they ask you to remember it. Keep their meaning and their words; one fact, preference, convention or decision per call.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "What to remember, as one self-contained sentence." },
        kind: { type: "string", enum: [...KINDS], description: "What sort of memory it is (default fact)." }
      },
      required: ["text"],
      additionalProperties: false
    }
  },
  {
    name: "memory_forget",
    description: "Forget memories when the user asks you to. Give the ids memory_search returned, or a query. Run it with dryRun first and tell the user what would be removed, including the summaries made from them, before removing anything.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "The memories' ids." },
        query: { type: "string", description: "Forget everything matching this, in place of ids." },
        dryRun: { type: "boolean", description: "Say what would be removed, and remove nothing." }
      },
      additionalProperties: false
    }
  }
];
var text = (body, isError = false) => ({
  content: [{ type: "text", text: body }],
  ...isError ? { isError: true } : {}
});
var list = (memories) => memories.map((m) => `- ${m._id} [${m.kind}] ${m.text}`).join("\n");
async function callTool(name, args, deps2) {
  const { api, project, sessionID } = deps2;
  if (!api)
    return text(
      "Strata isn't connected. Set MEMORY_API_URL and MEMORY_API_TOKEN (an API key from the app's Connect page), then restart Claude Code.",
      true
    );
  const scope = { project };
  switch (name) {
    case "memory_search": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) return text("Give a query to search for.", true);
      const k = typeof args.k === "number" ? Math.min(20, Math.max(1, Math.round(args.k))) : 6;
      const { memories } = await api.recall({ sessionID, scope, query, k }, CALL_MS);
      return text(memories.length ? `${memories.length} found:
${list(memories)}` : "Nothing in memory matches that.");
    }
    case "memory_save": {
      const body = typeof args.text === "string" ? args.text.trim() : "";
      if (!body) return text("Give the text to remember.", true);
      const kind = KINDS.includes(args.kind) ? args.kind : "fact";
      const { memory } = await api.save({ sessionID, scope, text: body, kind }, CALL_MS);
      return text(`Saved ${memory._id} [${memory.kind}] ${memory.text}`);
    }
    case "memory_forget": {
      const ids = Array.isArray(args.ids) ? args.ids.filter((id) => typeof id === "string") : [];
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!ids.length && !query) return text("Give the ids to forget, or a query.", true);
      const dryRun = args.dryRun === true;
      const result = await api.forget({ scope, ...ids.length ? { ids } : { query }, dryRun }, CALL_MS);
      const what = `${result.memories} memories, ${result.summaries} summaries made from them, and ${result.events} captured events`;
      return text(dryRun ? `Would forget ${what}. Ids: ${result.ids.join(", ") || "none"}` : `Forgot ${what}.`);
    }
    default:
      return text(`No tool named ${name}.`, true);
  }
}
async function respond(message, deps2) {
  const { id, method, params = {} } = message;
  if (id === void 0 || id === null) return null;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, msg) => ({ jsonrpc: "2.0", id, error: { code, message: msg } });
  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "strata", version: VERSION },
        instructions: "The user's long-term memory. Search it when their earlier preferences or decisions would help; save to it only when they ask you to remember something; forget only when they ask, after a dry run."
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      try {
        return ok(await callTool(name, args, deps2));
      } catch (error) {
        return ok(text(`Strata didn't answer: ${error instanceof Error ? error.message : String(error)}`, true));
      }
    }
    default:
      return fail(-32601, `Method not found: ${method ?? ""}`);
  }
}

// src/mcp.ts
var config = loadConfig();
var deps = {
  api: config ? makeApi(config) : null,
  project: config?.project ?? projectOf(process.env.CLAUDE_PROJECT_DIR ?? process.cwd()),
  sessionID: "mcp"
};
var inFlight = /* @__PURE__ */ new Set();
var lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}
`
    );
    return;
  }
  const answering = respond(message, deps).then((answer) => {
    if (answer) process.stdout.write(`${JSON.stringify(answer)}
`);
  });
  inFlight.add(answering);
  void answering.finally(() => inFlight.delete(answering));
});
lines.on("close", () => {
  void Promise.allSettled([...inFlight]).then(() => process.exit(0));
});
