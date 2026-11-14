// opencode adapter: maps opencode session events onto the same hook entrypoint Claude Code uses, so
// capture, redaction, summarizing, review and sync are shared. UNVERIFIED against a live opencode:
// the event names below (session.created, message.updated, session.idle, session.compacted,
// session.deleted) are the open question in the design, so they are all in EVENT_MAP to adjust.
//
// Install: copy this file to .opencode/plugin/strata.js (or ~/.config/opencode/plugin/) and set
// STRATA_ROOT to this plugin's folder.
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = process.env.STRATA_ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const HOOK = path.join(ROOT, "scripts/hook.mjs");

// opencode event type -> hook name (see hooks/hooks.json for what each does)
const EVENT_MAP = {
  "session.created": "session-start",
  "session.idle": "stop",
  "session.compacted": "pre-compact",
  "session.deleted": "session-end",
};

const run = (hook, input) => {
  try {
    spawnSync(process.execPath, [HOOK, hook], { input: JSON.stringify(input), encoding: "utf8", timeout: 60_000 });
  } catch {
    // fail open, like the Claude Code hooks: a broken Strata never breaks the session
  }
};

export const Strata = async ({ directory }) => {
  const prompts = new Map(); // sessionID -> last user text
  const replies = new Map(); // sessionID -> last assistant text
  const textOf = (parts = []) =>
    parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");

  return {
    event: async ({ event }) => {
      const props = event.properties ?? {};
      const sid = props.sessionID ?? props.info?.sessionID ?? props.info?.id;
      if (!sid) return;

      if (event.type === "message.updated" || event.type === "message.part.updated") {
        const info = props.info ?? {};
        const text = props.part?.type === "text" ? props.part.text : textOf(props.parts);
        if (text) (info.role === "user" ? prompts : replies).set(sid, text);
        return;
      }

      const hook = EVENT_MAP[event.type];
      if (!hook) return;
      if (hook === "stop") {
        run("prompt", { session_id: sid, cwd: directory, prompt: prompts.get(sid) ?? "" });
        run("stop", { session_id: sid, cwd: directory, last_assistant_message: replies.get(sid) ?? "" });
        return;
      }
      run(hook, { session_id: sid, cwd: directory });
    },
  };
};
