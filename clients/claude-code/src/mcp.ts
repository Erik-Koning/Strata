// The MCP server's entry (dist/mcp.mjs): one JSON-RPC message a line on stdin, one answer a line on stdout. Nothing
// else is ever written to stdout.
import { createInterface } from "node:readline";
import { makeApi } from "./api.ts";
import { loadConfig, projectOf } from "./config.ts";
import { respond } from "./mcp-server.ts";

const config = loadConfig();
const deps = {
  api: config ? makeApi(config) : null,
  project: config?.project ?? projectOf(process.env.CLAUDE_PROJECT_DIR ?? process.cwd()),
  sessionID: "mcp",
  relay: {
    apiUrl: config?.apiUrl ?? null,
    token: config?.token ?? null,
    cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    project: config?.project ?? projectOf(process.env.CLAUDE_PROJECT_DIR ?? process.cwd()),
    sessionID: process.env.CLAUDE_SESSION_ID ?? null,
  },
};

// Answers still on their way when stdin closes are sent before the server goes.
const inFlight = new Set<Promise<void>>();
const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
    );
    return;
  }
  const answering = respond(message as Parameters<typeof respond>[0], deps).then((answer) => {
    if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`);
  });
  inFlight.add(answering);
  void answering.finally(() => inFlight.delete(answering));
});
lines.on("close", () => {
  void Promise.allSettled([...inFlight]).then(() => process.exit(0));
});
