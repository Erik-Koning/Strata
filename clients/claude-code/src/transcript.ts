// Claude Code's transcript (one JSON object a line) as the plain messages the compress route takes: what the user typed
// and what Claude wrote. Tool calls and their results are left out, so a tool's output never passes for something the
// user said (a tool result arrives in a line of type "user").
import { readFileSync } from "node:fs";
import type { TranscriptMessage } from "@strata/contracts";

const MAX_MESSAGES = 400;
const MAX_CHARS = 8000;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function parseTranscript(jsonl: string): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: { type?: unknown; isMeta?: unknown; uuid?: unknown; message?: { role?: unknown; content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.isMeta === true || (entry.type !== "user" && entry.type !== "assistant")) continue;
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textOf(entry.message?.content).trim();
    if (!text) continue;
    messages.push({
      role,
      text: text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text,
      ...(typeof entry.uuid === "string" ? { id: entry.uuid } : {}),
    });
  }
  return messages.slice(-MAX_MESSAGES);
}

export function readTranscript(path: string | undefined): TranscriptMessage[] {
  if (!path) return [];
  try {
    return parseTranscript(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}
