#!/usr/bin/env node
import { spawn } from "node:child_process";
// Hook entrypoint. Fail-open by design: whatever goes wrong, exit 0 with valid (or no)
// output, so the hub can never block or break an engineer's session. Exiting 2 from
// UserPromptSubmit would drop prompts; from Stop it would re-wake the agent in a loop.
//
// What the hooks do: remember the prompt (UserPromptSubmit), and after each turn (Stop) queue the
// redacted turn text for a background worker that writes the session summary on this machine. Raw events go to the
// Strata server as they happen; when the session ends the summary follows as a draft, approved on the web (My Day).
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { markActive } from "./lib/active.mjs";
import { enqueueEvent, flushEvents } from "./lib/events.mjs";
import { isExcluded, resolveCwd, validSessionId } from "./lib/filter.mjs";
import { gitContext, lookupPr, projectOf } from "./lib/git.mjs";
import { log } from "./lib/log.mjs";
import { buildOverview } from "./lib/overview.mjs";
import { publishSession } from "./lib/publish.mjs";
import { enqueueItem, ensureSession, listQueue, pruneStore, sessionIds } from "./lib/records.mjs";
import { redact } from "./lib/redact.mjs";
import { ticketRefs } from "./lib/signals.mjs";
import {
  getAuth,
  getBinding,
  getHealth,
  getSession,
  noticeDue,
  p,
  pruneDir,
  readJson,
  serverUrl,
  setSession,
  signedInElsewhere,
  writeJson,
} from "./lib/store.mjs";
import { summarizeSession } from "./lib/summarize.mjs";
import { isInternalProtocolPayload, isPrivatePrompt, stripTags } from "./lib/tags.mjs";
import { toolSignal } from "./lib/tool-signal.mjs";
import { lastAssistantFromTranscript, readTranscript } from "./lib/transcript.mjs";

const STRATA_CLI = fileURLToPath(new URL("./strata.mjs", import.meta.url));
const STDIN_TIMEOUT_MS = 8000;
const PR_CACHE_MS = 10 * 60 * 1000;
const SESSION_STATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PROMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

// The prompt waits here between UserPromptSubmit and Stop, then the Stop hook deletes it. One file per
// turn, so the async Stop hook and the next prompt never write the same file.
const promptFile = (sid, turn) => p("prompts", `${sid.replace(/[^\w.-]/g, "_")}-${turn}.json`);
const FAILURE_NOTICE_THRESHOLD = 3;
// A turn that changed no files and got a one-line answer is not worth a model call.
const MIN_REPLY_CHARS = 160;

// A hung or closed stdin must not hang the hook: read until the JSON parses, EOF, or the timeout.
function readInput() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve({});
    let raw = "";
    const done = (value) => {
      clearTimeout(timer);
      resolve(value && typeof value === "object" ? value : {});
    };
    const tryParse = () => {
      try {
        return { ok: true, value: JSON.parse(raw) };
      } catch {
        return { ok: false };
      }
    };
    const timer = setTimeout(() => done(tryParse().value), STDIN_TIMEOUT_MS);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
      const parsed = tryParse();
      if (parsed.ok) done(parsed.value);
    });
    process.stdin.on("end", () => done(tryParse().value));
    process.stdin.on("error", () => done({}));
  });
}

// process.exit right after a piped write can cut the output off; wait for the write to land.
process.stdout.on("error", () => {});
const emit = (payload) => new Promise((resolve) => process.stdout.write(JSON.stringify(payload), () => resolve()));

const detached = (...args) => {
  try {
    spawn(process.execPath, [STRATA_CLI, ...args], { detached: true, stdio: "ignore", windowsHide: true })
      .on("error", () => {})
      .unref();
  } catch {
    // the next hook will try again
  }
};

// The summarizer takes seconds to a minute, so it runs detached; the Stop hook returns at once.
// Tests set STRATA_INLINE_WORKER=1 to run it inline and deterministically.
const startWorker = (sid) =>
  process.env.STRATA_INLINE_WORKER === "1" ? summarizeSession(sid) : detached("summarize", sid);

const flushEventsLater = () => detached("flush-events");

// Where the work is, in the form the contract's session event takes.
const gitPayload = (git) => ({
  remote: git.project,
  branch: git.branch,
  head: git.head,
  path: git.path,
});

const contextFingerprint = (git) => `${git.branch}\0${git.head}`;

// Queue one versioned event for this session. The outbox never blocks the hook.
function captureEvent(ctx, kind, payload, promptID) {
  const git = gitContext(ctx.cwd);
  enqueueEvent({
    sessionID: ctx.sessionId,
    project: projectOf(ctx.cwd),
    kind,
    payload,
    promptID,
  });
  return git;
}

// Common gate for every capturing hook.
function captureContext(input) {
  // The summarizer is itself a Claude session; it must never be captured and summarized in turn.
  if (process.env.STRATA_INTERNAL === "1" || process.env.STRATA_DISABLED === "1") return null;
  const sessionId = validSessionId(input.session_id);
  const cwd = resolveCwd(input);
  if (!sessionId || !cwd) return null;
  // Subagents run inside the parent's turn; their own hooks would double-record it.
  if (input.agent_id) return null;
  if (isExcluded(cwd)) return null;
  return { sessionId, cwd };
}

// The PR cache is its own file: the Stop hook is async and must not rewrite the session
// state the next UserPromptSubmit is writing at the same moment.
function cachedPr(git) {
  if (!git.isGit || !git.branch) return null;
  const key = `${git.repoKey}#${git.branch}`;
  const cache = readJson(p("pr-cache.json"), {});
  const hit = cache[key];
  if (hit && Date.now() - hit.at < PR_CACHE_MS) return hit.value;
  const value = lookupPr(git.root);
  writeJson(p("pr-cache.json"), {
    ...Object.fromEntries(Object.entries(cache).slice(-50)),
    [key]: { at: Date.now(), value },
  });
  return value;
}

const handlers = {
  // Tell Claude only when the engineer must act, and not more than once a day per kind.
  "session-start": async (input) => {
    if (process.env.STRATA_INTERNAL === "1" || process.env.STRATA_DISABLED === "1") return;
    const cwd = resolveCwd(input);
    if (!cwd || isExcluded(cwd)) return;
    pruneDir(p("sessions"), SESSION_STATE_RETENTION_MS);
    pruneDir(p("prompts"), PROMPT_RETENTION_MS); // backstop for a prompt whose Stop never fired
    pruneStore();

    const sid = validSessionId(input.session_id);
    if (sid) markActive(sid, cwd);

    const git = gitContext(cwd);
    if (sid) {
      enqueueEvent({
        sessionID: sid,
        project: git.project,
        kind: "session",
        payload: {
          event: "start",
          source: typeof input.source === "string" ? input.source : "startup",
          git: gitPayload(git),
          ...(ticketRefs(git.branch).length ? { refs: ticketRefs(git.branch) } : {}),
        },
      });
      setSession(sid, { ...getSession(sid), context: contextFingerprint(git) });
      flushEventsLater();
    }

    const auth = getAuth();
    const health = getHealth();
    const guidance = [];
    const overview = buildOverview(git.repoKey);
    if (overview) guidance.push(overview);
    const messages = [];

    if (!auth?.token) {
      const elsewhere = signedInElsewhere();
      if (noticeDue("login")) {
        guidance.push(
          elsewhere
            ? `Strata is signed in to ${elsewhere}, but now points at ${serverUrl()}, so nothing is sent: a sign-in only ever goes to the server that issued it. Mention once that they can run /strata:login to sign in to ${serverUrl()}.`
            : "Strata is installed but the user is not signed in, so nothing is sent. Mention once that they can run /strata:login.",
        );
      }
    } else if (health.authExpired) {
      if (noticeDue("reauth"))
        guidance.push(
          "Strata: the sign-in has expired, so nothing can be sent. Mention once that they can run /strata:login.",
        );
    } else {
      if ((health.failures ?? 0) >= FAILURE_NOTICE_THRESHOLD && noticeDue("failures", 6 * 60 * 60 * 1000)) {
        messages.push(
          `Strata: the last ${health.failures} uploads failed (${health.lastError}). Events are kept and will retry. Run /strata:status for details.`,
        );
      }
      flushEventsLater();
    }
    if (health.summarizerError && noticeDue("summarizer", 24 * 60 * 60 * 1000)) {
      messages.push(
        `Strata: summaries could not be written (${health.summarizerError}). The queued turns are kept for a few days and retried.`,
      );
    }

    // Turns that were queued while the summarizer was failing get another go.
    for (const sid of sessionIds()) if (listQueue(sid).length) detached("summarize", sid);

    if (guidance.length || messages.length) {
      await emit({
        ...(messages.length ? { systemMessage: messages.join("\n") } : {}),
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: guidance.join("\n") },
      });
    }
  },

  prompt: async (input) => {
    const ctx = captureContext(input);
    if (!ctx) return;
    const raw = typeof input.prompt === "string" ? input.prompt : "";
    // Background-task completions come through here too; they are not something the engineer typed.
    if (isInternalProtocolPayload(raw)) return;

    markActive(ctx.sessionId, ctx.cwd);
    const state = getSession(ctx.sessionId);
    const isPrivate = isPrivatePrompt(raw);
    // An empty prompt is a real image-only submission, not a missing one.
    const prompt = isPrivate ? "" : redact(stripTags(raw), 2000) || "[media prompt]";
    const promptID =
      typeof input.prompt_id === "string" && input.prompt_id.trim().length
        ? input.prompt_id.slice(0, 200)
        : crypto.randomUUID();
    setSession(ctx.sessionId, { turn: state.turn + 1, private: isPrivate, promptID, context: state.context });
    if (!isPrivate) {
      writeJson(promptFile(ctx.sessionId, state.turn + 1), { prompt });
      captureEvent(ctx, "prompt", { role: "user", text: prompt }, promptID);
      flushEventsLater();
    }
  },

  stop: async (input) => {
    const ctx = captureContext(input);
    if (!ctx) return;
    // Snapshot first: this hook is async, and the next prompt can land while git runs.
    const state = getSession(ctx.sessionId);
    if (!state.turn || state.private) return;
    const prompt = readJson(promptFile(ctx.sessionId, state.turn), { prompt: "" }).prompt;
    fs.rmSync(promptFile(ctx.sessionId, state.turn), { force: true });

    let message = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
    if (!message.trim()) message = lastAssistantFromTranscript(input.transcript_path);
    message = redact(stripTags(message), 6000);
    if (!message.trim()) return;

    const git = gitContext(ctx.cwd);
    if (message.length < MIN_REPLY_CHARS && git.files.length === 0) return;

    enqueueEvent({
      sessionID: ctx.sessionId,
      project: git.project,
      kind: "assistant",
      payload: { role: "assistant", text: message },
      promptID: state.promptID,
    });
    if (state.context !== contextFingerprint(git)) {
      enqueueEvent({
        sessionID: ctx.sessionId,
        project: git.project,
        kind: "session",
        payload: {
          event: "context",
          git: gitPayload(git),
          ...(ticketRefs(git.branch).length ? { refs: ticketRefs(git.branch) } : {}),
        },
      });
      setSession(ctx.sessionId, { ...state, context: contextFingerprint(git) });
    }
    flushEventsLater();

    // The same turn can Stop more than once (another Stop hook kept Claude working); the same reply is one item.
    // The key leaves the prompt out: the first Stop already consumed (and deleted) it.
    const key = crypto.createHash("sha1").update(`${state.turn}\0${message}`).digest("hex").slice(0, 10);
    // No prompt-derived title is stored: once a turn is summarized, nothing of the raw prompt remains on disk.
    ensureSession(ctx.sessionId, { repoKey: git.repoKey, remote: git.remote });
    const queued = enqueueItem(ctx.sessionId, key, {
      at: new Date().toISOString(),
      prompt,
      reply: message,
      files: git.files,
      branch: git.branch,
      head: git.head,
      remote: git.remote,
      jira: git.jira,
      pr: cachedPr(git),
    });
    if (queued) await startWorker(ctx.sessionId);
  },

  // A tool call's name, outcome, duration and, for a shell command, its class and fingerprint. Never its content.
  "post-tool": async (input) => {
    const ctx = captureContext(input);
    if (!ctx) return;
    enqueueEvent({
      sessionID: ctx.sessionId,
      project: projectOf(ctx.cwd),
      kind: "tool",
      payload: toolSignal(input, input.hook_event_name === "PostToolUseFailure"),
      promptID: getSession(ctx.sessionId).promptID,
    });
    flushEventsLater();
  },

  "post-compact": async (input) => {
    const ctx = captureContext(input);
    if (!ctx || typeof input.compact_summary !== "string" || !input.compact_summary.trim()) return;
    enqueueEvent({
      sessionID: ctx.sessionId,
      project: projectOf(ctx.cwd),
      kind: "event",
      payload: {
        type: "compact_summary",
        trigger: typeof input.trigger === "string" ? input.trigger : null,
        text: redact(stripTags(input.compact_summary), 20_000),
      },
    });
    flushEventsLater();
  },

  // Compaction drops the conversation: keep its text as a transcript, and summarize what is queued before it is gone.
  "pre-compact": async (input) => {
    const ctx = captureContext(input);
    if (!ctx) return;
    const messages = readTranscript(input.transcript_path)
      .map((message) => ({ role: message.role, text: redact(stripTags(message.text), 20_000) }))
      .filter((message) => message.text.trim());
    if (messages.length)
      enqueueEvent({
        sessionID: ctx.sessionId,
        project: projectOf(ctx.cwd),
        kind: "transcript",
        payload: { trigger: typeof input.trigger === "string" ? input.trigger : null, messages },
      });
    flushEventsLater();
    if (listQueue(ctx.sessionId).length) await startWorker(ctx.sessionId);
  },

  "session-end": async (input) => {
    const ctx = captureContext(input);
    if (ctx) {
      if (listQueue(ctx.sessionId).length) {
        // The end event is what makes the server draft, so it waits for the summary: the worker sends both.
        if (process.env.STRATA_INLINE_WORKER === "1") {
          await summarizeSession(ctx.sessionId);
          await publishSession(ctx.sessionId, ctx.cwd);
        } else detached("summarize", ctx.sessionId, "--final", ctx.cwd);
        return;
      }
      enqueueEvent({
        sessionID: ctx.sessionId,
        project: projectOf(ctx.cwd),
        kind: "session",
        payload: { event: "end", reason: typeof input.reason === "string" ? input.reason.slice(0, 200) : null },
      });
    }
    if (getAuth()?.token) await flushEvents({ force: true });
  },
};

try {
  const handler = handlers[process.argv[2]];
  if (handler) await handler(await readInput());
} catch (err) {
  log("error", "hook failed", { event: process.argv[2], error: String(err?.message ?? err) });
}
process.exit(0);
