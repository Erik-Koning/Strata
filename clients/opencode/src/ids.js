// The core's session-id filter accepts /^[\w.-]{1,128}$/ because the id becomes a filename. OpenCode ids
// happen to satisfy it today, but the plugin must not depend on that: an id that fails the filter would
// silently drop every event for the session. Map it deterministically instead, and keep the mapping so the
// same OpenCode session always resolves to the same Strata session across restarts.
import crypto from "node:crypto";
import { p, readJson, writeJson } from "../../claude-code/scripts/lib/store.mjs";

const VALID = /^[\w.-]{1,128}$/;
const MAX_PROMPT_ID = 200;

export const isValidSessionId = (id) => typeof id === "string" && VALID.test(id);

/**
 * The Strata session id for an OpenCode session. Valid ids are used as-is; anything else is mapped once to
 * a stable `oc_<hash>` and remembered under ~/.strata/opencode/sessions.json.
 */
export function sessionIdFor(raw) {
  const id = typeof raw === "string" ? raw : "";
  if (!id) return null;
  if (isValidSessionId(id)) return id;
  const known = readJson(p("opencode", "sessions.json"), {});
  const existing = known[id];
  if (isValidSessionId(existing)) return existing;
  const mapped = `oc_${crypto.createHash("sha1").update(id).digest("hex").slice(0, 32)}`;
  // Keep the store bounded: OpenCode ids are long, and this file otherwise grows forever.
  const trimmed = Object.fromEntries(Object.entries(known).slice(-500));
  writeJson(p("opencode", "sessions.json"), { ...trimmed, [id]: mapped });
  return mapped;
}

/** A prompt id the contract accepts (1-200 chars), or null when the host gave nothing usable. */
export function promptIdFor(raw) {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return id ? id.slice(0, MAX_PROMPT_ID) : null;
}
