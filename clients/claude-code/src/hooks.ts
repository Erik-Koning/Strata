// What each Claude Code hook does. Everything already sent in a session stays as it was sent:
//
//   SessionStart       the session's frozen block, once, as context at the start (freeze.ts says when it's fetched);
//                      captures where the work is: repository, branch, commit and folder (context.ts).
//   UserPromptSubmit   captures the prompt; recalls memories for it (800 ms, or nothing) and adds them with this
//                      message only. The frozen block is never sent again here.
//   PostToolUse(Failure) the tool's name, how it ended and how long it ran; for a shell command, what kind of command
//                      it was and a fingerprint of it (tool-signal.ts). Never its input or output.
//   PreCompact         captures the transcript and asks the API to compress it (5 s). Prints nothing, since a
//                      PreCompact hook's output becomes instructions for Claude Code's own summary.
//   PostCompact        captures the summary Claude Code made.
//   Stop               captures Claude's last message, and the branch or commit if either changed since the last turn;
//                      then starts the flusher in the background.
//   SessionEnd         starts the flusher and goes.
//
// Every event carries the turn it belongs to (Claude Code's prompt_id), so a turn's prompt, tools and reply group.
// Capture never waits on the network: events go to the outbox, and the background flusher sends them.
import type { EventKind, PayloadOf } from "@strata/contracts";
import { redact } from "@strata/contracts/redact";
import { renderRecall } from "@strata/contracts/render";
import type { Api } from "./api.ts";
import type { Config } from "./config.ts";
import { changed, forgetContext, gitContext, refsOf } from "./context.ts";
import { ensureFrozen, type StartSource } from "./freeze.ts";
import { enqueue, type NewEvent } from "./outbox.ts";
import type { Store } from "./store.ts";
import { type ToolHookInput, toolSignal } from "./tool-signal.ts";
import { readTranscript } from "./transcript.ts";

export const RECALL_MS = 800;
export const COMPRESS_MS = 5000;
const RECALL_K = 6;

export interface HookInput extends ToolHookInput {
  session_id?: string;
  prompt_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: string;
  prompt?: string;
  trigger?: string;
  last_assistant_message?: string;
  compact_summary?: string;
  reason?: string;
}

export interface Deps {
  config: Config;
  store: Store;
  api: Api;
  // Starts the flusher in the background, and returns at once.
  kick: () => void;
}

const SOURCES = new Set<StartSource>(["startup", "resume", "clear", "compact", "fork"]);

const context = (event: string, text: string): string =>
  text ? JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }) : "";

// Returns what the hook prints: the hook JSON, or nothing.
export async function handle(input: HookInput, deps: Deps): Promise<string> {
  const { config, store, api, kick } = deps;
  const sessionID = input.session_id;
  const event = input.hook_event_name ?? "";
  if (!sessionID) return "";
  const promptID = input.prompt_id?.slice(0, 200) || undefined;
  const capture = <K extends EventKind>(kind: K, payload: PayloadOf<K>): string =>
    enqueue(store, { sessionID, project: config.project, kind, payload, promptID } as NewEvent);
  const cwd = input.cwd || process.cwd();

  switch (event) {
    case "SessionStart": {
      const source = SOURCES.has(input.source as StartSource) ? (input.source as StartSource) : "startup";
      const block = await ensureFrozen(store, api, sessionID, config.project, source);
      const git = gitContext(cwd);
      const refs = refsOf(git);
      changed(store, sessionID, git);
      capture("session", { event: "start", source, ...(git ? { git } : {}), ...(refs.length ? { refs } : {}) });
      kick();
      return context("SessionStart", block);
    }
    case "UserPromptSubmit": {
      const prompt = input.prompt ?? "";
      if (!prompt.trim()) return "";
      capture("prompt", { role: "user", text: prompt });
      let recalled = "";
      try {
        const { memories } = await api.recall(
          { sessionID, scope: { project: config.project }, query: redact(prompt).slice(0, 8000), k: RECALL_K },
          RECALL_MS,
        );
        recalled = renderRecall(Array.isArray(memories) ? memories : []);
      } catch {
        // Fail open: the prompt goes as it is.
      }
      kick();
      return context("UserPromptSubmit", recalled);
    }
    case "PostToolUse":
    case "PostToolUseFailure":
      capture("tool", toolSignal(input, event === "PostToolUseFailure"));
      return "";
    case "PreCompact": {
      const messages = readTranscript(input.transcript_path);
      if (messages.length) {
        capture("transcript", { trigger: input.trigger ?? null, messages });
        try {
          await api.compress(
            {
              sessionID,
              scope: { project: config.project },
              messages: messages.map((m) => ({ ...m, text: redact(m.text) })),
            },
            COMPRESS_MS,
          );
        } catch {
          // The transcript is in the outbox; Claude Code's own compaction goes ahead either way.
        }
      }
      kick();
      return "";
    }
    case "PostCompact":
      if (input.compact_summary)
        capture("event", { type: "compact_summary", trigger: input.trigger ?? null, text: input.compact_summary });
      return "";
    case "Stop": {
      if (input.last_assistant_message) capture("assistant", { role: "assistant", text: input.last_assistant_message });
      // A new branch or a new commit since the last turn: the session now points at it too.
      const git = gitContext(cwd);
      if (git && changed(store, sessionID, git)) {
        const refs = refsOf(git);
        capture("session", { event: "context", git, ...(refs.length ? { refs } : {}) });
      }
      kick();
      return "";
    }
    case "SessionEnd":
      capture("session", { event: "end", reason: input.reason ?? null });
      forgetContext(store, sessionID);
      kick();
      return "";
    default:
      return "";
  }
}
