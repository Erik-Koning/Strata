#!/usr/bin/env node
// Minimal MCP server over stdio (newline-delimited JSON-RPC). Two tools:
//   strata_record  log an insight, workflow finding, pain point or context gap into this session's draft summary
//   strata_search  search teammates' approved summaries (when signed in) and the ones on this machine
// Nothing here sends anything: a record joins the draft summary and still needs the engineer's approval.
import readline from "node:readline";
import { sessionForNote } from "./lib/active.mjs";
import { addFinding, listSessions } from "./lib/records.mjs";
import { FINDING_KINDS } from "./lib/schema.mjs";
import { describeTeamResult, searchTeam } from "./lib/team.mjs";

const cwd = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();

const TOOLS = [
  {
    name: "strata_record",
    description:
      'Log something a teammate or a later session would want to know, as it comes up. kind: "insight" (a system fact the code does not make obvious), "workflow" (how work actually gets done here), "pain-point" (what slowed the work and what would have helped), "gap" (information you needed and could not find). One plain sentence, no code, no secrets, nothing about people. It joins the session draft; the engineer reviews it before anything is shared.',
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: Object.keys(FINDING_KINDS) },
        text: { type: "string", maxLength: 400 },
      },
      required: ["kind", "text"],
    },
  },
  {
    name: "strata_search",
    description:
      "Search approved session summaries from teammates (when signed in) and the ones kept on this machine: insights, workflow findings, pain points, gaps, what was built. Use it before re-deriving something a teammate may already have found.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
];

function search(query) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const s of listSessions()) {
    if (!s.summary) continue;
    const parts = [
      ["built", [s.summary.built]],
      ...Object.keys(FINDING_KINDS).map((k) => [k, s.summary[FINDING_KINDS[k]]]),
      ["decision", s.summary.decisions],
    ];
    for (const [label, items] of parts) {
      for (const item of items ?? []) {
        if (item && words.every((w) => `${item} ${s.summary.title}`.toLowerCase().includes(w)))
          hits.push(`[${label}] ${item} (${s.summary.title}, ${s.updatedAt.slice(0, 10)})`);
      }
    }
  }
  return hits.slice(0, 10).join("\n") || "No matches in the summaries on this machine.";
}

async function call(name, args = {}) {
  if (name === "strata_record") {
    const sid = sessionForNote(cwd());
    if (!sid) throw new Error("no active Claude Code session found for this directory");
    const res = addFinding(sid, args.kind, args.text);
    return res.added
      ? `Recorded as a ${args.kind} in the session draft. The engineer reviews it before it is shared.`
      : "Already recorded.";
  }
  if (name === "strata_search") {
    const team = (await searchTeam(args.query, cwd())).map(describeTeamResult);
    const local = search(args.query);
    return (
      [
        team.length ? `From the team:\n${team.join("\n")}` : "",
        local.startsWith("No matches") ? "" : `On this machine:\n${local}`,
      ]
        .filter(Boolean)
        .join("\n\n") || "No matches from the team or on this machine."
    );
  }
  throw Object.assign(new Error(`unknown tool ${name}`), { rpc: -32601 });
}

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications need no answer
  if (method === "initialize") {
    return send({
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "strata", version: "0.3.0" },
      },
    });
  }
  if (method === "ping") return send({ id, result: {} });
  if (method === "tools/list") return send({ id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    try {
      return send({ id, result: { content: [{ type: "text", text: await call(params?.name, params?.arguments) }] } });
    } catch (err) {
      return send({ id, result: { isError: true, content: [{ type: "text", text: String(err.message) }] } });
    }
  }
  send({ id, error: { code: -32601, message: `method not found: ${method}` } });
});
