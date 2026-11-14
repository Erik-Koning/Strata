// Maps OpenCode's session/tool/event surface onto the Strata core's hook contract. Every handler is
// fail-open: an error is logged and the session carries on.
import fs from "node:fs";
import path from "node:path";
import { p } from "../../claude-code/scripts/lib/store.mjs";
import { captureDisabled, log, runHookSync, spawnHook } from "./hook.js";
import { promptIdFor, sessionIdFor } from "./ids.js";
import { canonicalToolName } from "./tools.js";

const MAX_TRANSCRIPT_MESSAGES = 200;

/** Text of an assistant message's content parts. */
function assistantText(message) {
  if (message?.type !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/** The newest assistant text in a session's active context. OpenCode's `stop` equivalent needs it. */
export async function lastAssistantText(ctx, sessionID) {
  try {
    const messages = await ctx.session.context({ sessionID });
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = assistantText(messages[i]);
      if (text.trim()) return text;
    }
  } catch (error) {
    log("warn", "opencode: could not read session context", { error: String(error?.message ?? error) });
  }
  return "";
}

/**
 * The compaction hook gives the messages being summarized, not a file. Write them as a Claude-shaped
 * transcript so the core's pre-compact path can replay it unchanged.
 */
function writeTranscript(sessionID, messages) {
  const dir = p("opencode", "transcripts");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${sessionID}.jsonl`);
  const lines = [];
  for (const message of (messages ?? []).slice(-MAX_TRANSCRIPT_MESSAGES)) {
    const role = message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .filter((part) => part?.type === "text" && typeof part.text === "string")
              .map((part) => part.text)
              .join("\n")
          : "";
    if (!text.trim()) continue;
    lines.push(JSON.stringify({ type: role, message: { content: [{ type: "text", text }] } }));
  }
  try {
    fs.writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
    return file;
  } catch (error) {
    log("warn", "opencode: could not write transcript", { error: String(error?.message ?? error) });
    return null;
  }
}

export async function createPlugin(ctx) {
  const directory = ctx.location?.directory;
  const started = new Set();
  const prompts = new Map(); // sessionID -> { promptID, prompt }
  const abort = new AbortController();

  /**
   * Run session-start once per session, and give the agent the overview it returns. The two ids differ when
   * OpenCode's session id needed mapping: the core takes the Strata id, the host API takes the real one.
   */
  async function ensureStarted(rawSessionID, strataSessionID, cwd) {
    if (started.has(strataSessionID)) return;
    started.add(strataSessionID);
    const output = runHookSync("session-start", { session_id: strataSessionID, cwd, source: "startup" });
    const context = output?.hookSpecificOutput?.additionalContext;
    if (typeof context === "string" && context.trim()) {
      try {
        await ctx.session.instructions.entry.put({ sessionID: rawSessionID, key: "strata-overview", value: context });
      } catch (error) {
        log("warn", "opencode: could not attach the Strata overview", { error: String(error?.message ?? error) });
      }
    }
  }

  async function registerHooks() {
    // The user's turn: remember it, then queue the prompt event. `prompt` is synchronous in the Claude
    // client because the next Stop depends on the turn counter; a tool can run immediately after, so we
    // wait here too.
    await ctx.session.hook("prompt", async (event) => {
      if (captureDisabled()) return;
      const sessionID = sessionIdFor(event.sessionID);
      if (!sessionID) return;
      const promptID = promptIdFor(event.messageID);
      const text = typeof event.prompt?.text === "string" ? event.prompt.text : "";
      prompts.set(event.sessionID, { promptID, prompt: text });
      await ensureStarted(event.sessionID, sessionID, directory);
      runHookSync("prompt", {
        session_id: sessionID,
        cwd: directory,
        prompt: text,
        ...(promptID ? { prompt_id: promptID } : {}),
      });
    });

    // Tool calls: name, outcome and, for a shell command, its classification. Never the tool's output.
    await ctx.tool.hook("execute.after", (event) => {
      if (captureDisabled()) return;
      const sessionID = sessionIdFor(event.sessionID);
      if (!sessionID) return;
      const failed = event.status === "error";
      const message = failed ? String(event.error?.message ?? "") : "";
      spawnHook("post-tool", {
        session_id: sessionID,
        cwd: directory,
        tool_name: canonicalToolName(event.tool),
        tool_input: event.input,
        tool_use_id: event.id,
        hook_event_name: failed ? "PostToolUseFailure" : "PostToolUse",
        ...(message ? { error: message } : {}),
      });
    });

    // A turn ended: the reply is what the summarizer and the server's drafting both need.
    await ctx.session.hook("experimental.idle", (event) => {
      if (captureDisabled()) return;
      const sessionID = sessionIdFor(event.sessionID);
      if (!sessionID) return;
      lastAssistantText(ctx, event.sessionID).then((text) => {
        spawnHook("stop", {
          session_id: sessionID,
          cwd: directory,
          last_assistant_message: text,
          ...(prompts.get(event.sessionID)?.promptID ? { prompt_id: prompts.get(event.sessionID).promptID } : {}),
        });
      });
    });

    // Before a compaction the conversation is about to be dropped: keep it, and summarize what is queued.
    await ctx.session.hook("compaction", (event) => {
      if (captureDisabled()) return;
      const sessionID = sessionIdFor(event.sessionID);
      if (!sessionID) return;
      const file = writeTranscript(sessionID, event.messages);
      if (!file) return;
      spawnHook("pre-compact", {
        session_id: sessionID,
        cwd: directory,
        transcript_path: file,
        trigger: "auto",
      });
    });
  }

  /** The compaction summary itself only exists once the compaction ends. */
  function watchCompaction() {
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: ["session.compaction.ended"],
          signal: abort.signal,
        })) {
          if (captureDisabled()) continue;
          const sessionID = sessionIdFor(event.data?.sessionID);
          if (!sessionID) continue;
          const text = event.data?.text;
          if (typeof text !== "string" || !text.trim()) continue;
          spawnHook("post-compact", {
            session_id: sessionID,
            cwd: directory,
            compact_summary: text,
            trigger: event.data?.reason ?? "auto",
          });
        }
      } catch (error) {
        if (!abort.signal.aborted)
          log("warn", "opencode: compaction watch stopped", { error: String(error?.message ?? error) });
      }
    })();
  }

  /** Session start/end. Start is normally covered by the first prompt; created covers empty sessions. */
  function watchSessions() {
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: ["session.created", "session.deleted"],
          signal: abort.signal,
        })) {
          if (captureDisabled()) continue;
          const rawSessionID = event.data?.sessionID;
          const sessionID = sessionIdFor(rawSessionID);
          if (!sessionID) continue;
          if (event.type === "session.created") {
            await ensureStarted(rawSessionID, sessionID, event.data?.location?.directory ?? directory);
          } else {
            spawnHook("session-end", {
              session_id: sessionID,
              cwd: event.data?.location?.directory ?? directory,
              reason: "session deleted",
            });
            started.delete(sessionID);
            prompts.delete(rawSessionID);
          }
        }
      } catch (error) {
        if (!abort.signal.aborted)
          log("warn", "opencode: session watch stopped", { error: String(error?.message ?? error) });
      }
    })();
  }

  // Register the hooks now; the returned cleanup stops the two event subscriptions.
  await registerHooks();
  watchCompaction();
  watchSessions();
  return () => abort.abort();
}
