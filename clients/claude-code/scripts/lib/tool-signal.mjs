// A tool call as Strata records it: its name, how it ended and how long it ran, never what went in or came out.
// A shell command adds its class and a fingerprint of the redacted command, so re-runs can be counted without
// the command leaving the machine.
import crypto from "node:crypto";
import { classifyCommand, commandKey } from "./signals.mjs";

function exitOf(error) {
  const code = /^Exit code (\d{1,3})\b/m.exec(error ?? "")?.[1];
  const n = code === undefined ? Number.NaN : Number(code);
  return Number.isInteger(n) && n >= 0 && n <= 255 ? n : undefined;
}

export function toolSignal(input, failed) {
  const status = input.is_interrupt ? "interrupted" : failed ? "error" : "ok";
  const args = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  let command;
  if (input.tool_name === "Bash" && typeof args.command === "string") {
    const kind = classifyCommand(args.command);
    const background = args.run_in_background === true;
    const exit = failed && !background ? exitOf(input.error) : undefined;
    command = {
      class: kind,
      ...(exit === undefined ? {} : { exit }),
      ...(kind === "other"
        ? {}
        : { fp: crypto.createHash("sha256").update(commandKey(args.command)).digest("hex").slice(0, 16) }),
      ...(background ? { background } : {}),
    };
  }
  const ms =
    typeof input.duration_ms === "number" && input.duration_ms >= 0 ? Math.round(input.duration_ms) : undefined;
  return {
    tool: input.tool_name || "unknown",
    status,
    ...(ms === undefined ? {} : { ms }),
    ...(input.tool_use_id ? { toolUseID: input.tool_use_id.slice(0, 200) } : {}),
    ...(command ? { command } : {}),
  };
}
