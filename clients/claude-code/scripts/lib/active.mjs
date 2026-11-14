import crypto from "node:crypto";
import fs from "node:fs";
import { gitContext } from "./git.mjs";
import { ensureSession } from "./records.mjs";
import { p, readJson, writeJson } from "./store.mjs";

// The MCP server and /note are not told which session they run in, so the hooks leave a pointer:
// the newest session per working directory. Written at SessionStart and on every prompt.
const ACTIVE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
// Resolved, so a symlinked path (macOS /var vs /private/var) is the same directory for the hook and the CLI.
const real = (cwd) => {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return String(cwd);
  }
};
const key = (cwd) => crypto.createHash("sha1").update(real(cwd)).digest("hex").slice(0, 12);

export const markActive = (sessionId, cwd) =>
  writeJson(p("active", `${key(cwd)}.json`), { sessionId, cwd, at: Date.now() });

export function activeSession(cwd) {
  const hit = readJson(p("active", `${key(cwd)}.json`), null);
  if (!hit || Date.now() - hit.at > ACTIVE_TTL_MS) return null;
  return hit.sessionId;
}

/** The session a live note belongs to; created on first use so a note before the first reply is not lost. */
export function sessionForNote(cwd) {
  const sid = activeSession(cwd);
  if (!sid) return null;
  const git = gitContext(cwd);
  ensureSession(sid, { repoKey: git.repoKey, remote: git.remote });
  return sid;
}
