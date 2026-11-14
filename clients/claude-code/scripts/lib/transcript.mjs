import fs from "node:fs";

const TAIL_BYTES = 512 * 1024;

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

/**
 * The conversation before a compaction: the user and assistant text, no tool output. Reads the last 512 KB,
 * so a long session stays cheap; malformed lines are skipped.
 */
export function readTranscript(file, limit = 200) {
  if (typeof file !== "string" || !file.endsWith(".jsonl")) return [];
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString("utf8").split("\n");
    if (size > length) lines.shift();
    const messages = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const role = entry?.type;
      if (role !== "user" && role !== "assistant") continue;
      const text = textOf(entry.message?.content);
      if (text.trim()) messages.push({ role, text });
    }
    return messages.slice(-limit);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Claude Code sends `last_assistant_message: ""` when a turn ends mid tool call.
 * An empty value is no message at all, so fall back to the transcript's tail
 * (claude-mem does the same instead of dropping the turn).
 */
export function lastAssistantFromTranscript(file) {
  if (typeof file !== "string" || !file.endsWith(".jsonl")) return "";
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString("utf8").split("\n");
    if (size > length) lines.shift(); // first line is likely cut in half
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i].trim()) continue;
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (entry?.type !== "assistant") continue;
      const text = textOf(entry.message?.content);
      if (text.trim()) return text;
    }
  } catch {
    // unreadable transcript: no message
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return "";
}
