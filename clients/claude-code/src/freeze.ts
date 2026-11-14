// Each session's frozen block: long-term memory, fetched once when the session starts and then the same bytes for the
// rest of it, because the provider caches the conversation's prefix and one changed byte throws the cache away. It's
// kept in "fz:<sessionID>" so a resumed session, a restarted Claude Code or a second hook process gets exactly what was
// sent before.
//
//   startup  the first time: fetch (800 ms), render, keep, send. A failed fetch freezes it empty.
//   resume   what was kept, with no network. A session that has history but nothing kept freezes empty: adding a
//   fork     block now would put new bytes in front of a conversation already under way.
//   clear    the conversation starts again, so the cache does too: fetch afresh (empty on failure).
//   compact  compaction rebuilds the cache anyway, so this is the one place the block is refreshed. A failed fetch
//            keeps the block it had.
import { renderFrozen } from "@strata/contracts/render";
import type { Api } from "./api.ts";
import type { Store } from "./store.ts";

export const FROZEN_MS = 800;
export type StartSource = "startup" | "resume" | "clear" | "compact" | "fork";

const key = (sessionID: string): string => `fz:${sessionID}`;

// The kept block, or null when this session has none yet. No network.
export function frozenBlock(store: Store, sessionID: string): string | null {
  const raw = store.get(key(sessionID));
  if (raw === null) return null;
  try {
    const { block } = JSON.parse(raw) as { block?: unknown };
    return typeof block === "string" ? block : null;
  } catch {
    return null;
  }
}

async function fetchBlock(api: Api, sessionID: string, project: string): Promise<string | null> {
  try {
    const { memories } = await api.frozen({ sessionID, project }, FROZEN_MS);
    return renderFrozen(Array.isArray(memories) ? memories : []);
  } catch {
    return null;
  }
}

const keep = (store: Store, sessionID: string, block: string): string => {
  store.set(key(sessionID), JSON.stringify({ block }));
  return block;
};

export async function ensureFrozen(
  store: Store,
  api: Api,
  sessionID: string,
  project: string,
  source: StartSource,
): Promise<string> {
  const kept = frozenBlock(store, sessionID);
  if (source === "compact") {
    const fresh = await fetchBlock(api, sessionID, project);
    return fresh === null ? (kept ?? keep(store, sessionID, "")) : keep(store, sessionID, fresh);
  }
  if (source === "clear") return keep(store, sessionID, (await fetchBlock(api, sessionID, project)) ?? "");
  if (kept !== null) return kept;
  if (source === "resume" || source === "fork") return keep(store, sessionID, "");
  return keep(store, sessionID, (await fetchBlock(api, sessionID, project)) ?? "");
}
