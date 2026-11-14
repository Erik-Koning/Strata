// Where the work is happening: the repository, the branch, the commit, and the folder inside the repository. Sent when a
// session starts, and again whenever the branch or the commit changes, so a session links to its ticket, its commits
// and, through the branch, its pull request. Read with git, locally; nothing here touches the network.
import type { GitContext, Ref } from "@strata/contracts";
import { ticketRefs } from "@strata/contracts/signals";
import { git, normalizeRemote } from "./config.ts";
import type { Store } from "./store.ts";

export function gitContext(cwd: string): GitContext | null {
  // "<commit>\n<prefix>" (the prefix is empty at the repository's root); nothing outside a repository or before its
  // first commit.
  const [head, path] = (git(cwd, ["rev-parse", "HEAD", "--show-prefix"]) ?? "").split("\n");
  const branch = git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const origin = git(cwd, ["config", "--get", "remote.origin.url"]);
  const remote = origin ? normalizeRemote(origin) : null;
  const context: GitContext = {
    ...(remote ? { remote } : {}),
    ...(branch ? { branch } : {}),
    ...(head && /^[0-9a-f]{7,64}$/.test(head) ? { head, path: (path ?? "").replace(/\/$/, "") } : {}),
  };
  return Object.keys(context).length ? context : null;
}

export const refsOf = (context: GitContext | null): Ref[] => (context?.branch ? ticketRefs(context.branch) : []);

// The context last sent for a session, so a change is sent once.
const key = (sessionID: string): string => `cx:${sessionID}`;
const fingerprint = (context: GitContext | null): string => `${context?.branch ?? ""} ${context?.head ?? ""}`;

// Remembers the context, and says whether it differs from what was sent before.
export function changed(store: Store, sessionID: string, context: GitContext | null): boolean {
  const now = fingerprint(context);
  if (store.get(key(sessionID)) === now) return false;
  store.set(key(sessionID), now);
  return true;
}

export const forgetContext = (store: Store, sessionID: string): void => store.delete(key(sessionID));
