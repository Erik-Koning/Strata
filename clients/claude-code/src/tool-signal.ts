// A tool call as Strata records it: its name, how it ended and how long it ran, never what went in or came out. A shell
// command adds what kind of command it was and a fingerprint (a hash of the command, redacted and normalized), so the
// hub can say "the integration suite ran 212 times" without the command ever leaving the machine.
import { createHash } from "node:crypto";
import type { PayloadOf } from "@strata/contracts";
import { classifyCommand, commandKey } from "@strata/contracts/signals";

export interface ToolHookInput {
  tool_name?: string;
  tool_input?: unknown;
  tool_use_id?: string;
  duration_ms?: number;
  error?: string;
  is_interrupt?: boolean;
}

// A failed command's exit code, from the first line of Claude Code's error ("Exit code 1").
function exitOf(error: string | undefined): number | undefined {
  const code = /^Exit code (\d{1,3})\b/m.exec(error ?? "")?.[1];
  const n = code === undefined ? Number.NaN : Number(code);
  return Number.isInteger(n) && n >= 0 && n <= 255 ? n : undefined;
}

export function toolSignal(input: ToolHookInput, failed: boolean): PayloadOf<"tool"> {
  const status = input.is_interrupt ? "interrupted" : failed ? "error" : "ok";
  const args = (input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {}) as Record<
    string,
    unknown
  >;
  let command: PayloadOf<"tool">["command"];
  if (input.tool_name === "Bash" && typeof args.command === "string") {
    const kind = classifyCommand(args.command);
    const background = args.run_in_background === true;
    const exit = failed && !background ? exitOf(input.error) : undefined;
    command = {
      class: kind,
      ...(exit === undefined ? {} : { exit }),
      ...(kind === "other"
        ? {}
        : { fp: createHash("sha256").update(commandKey(args.command)).digest("hex").slice(0, 16) }),
      ...(background ? { background } : {}),
    };
  }
  const ms = typeof input.duration_ms === "number" && input.duration_ms >= 0 ? Math.round(input.duration_ms) : null;
  return {
    tool: input.tool_name || "unknown",
    status,
    ...(ms === null ? {} : { ms }),
    ...(input.tool_use_id ? { toolUseID: input.tool_use_id.slice(0, 200) } : {}),
    ...(command ? { command } : {}),
  };
}
