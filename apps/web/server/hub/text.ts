// The small, pure rules the hub's read models share: what counts as a repository and how its name is written, when two
// findings say the same thing, and how time is cut into days and weeks. No database here, so the tests can pin each
// rule down on its own.
import { createHash } from "node:crypto";

// A repository as the server names it: the origin, normalized the way the plugin normalizes it (git.mjs), so
// git@github.com:acme/app.git, https://user@github.com/acme/app.git, ssh://git@github.com/acme/app and the already
// normalized github.com/acme/app are all github.com/acme/app. Anything that isn't a host and a path (a folder's name,
// "default", "*") is not a repository, and gets null.
export function normalizeRepo(value: string | null | undefined): string | null {
  const url = String(value ?? "")
    .trim()
    .replace(/\/\/[^@/]+@/, "//");
  if (!url) return null;
  let host = "";
  let path = "";
  const scp = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(url);
  if (scp) {
    host = scp[1] ?? "";
    path = scp[2] ?? "";
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  } else {
    const bare = /^([^/\s]+)\/(.+)$/.exec(url);
    host = bare?.[1] ?? "";
    path = bare?.[2] ?? "";
  }
  host = host.toLowerCase();
  path = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(host) || !path || /[\s#?]/.test(path)) return null;
  return `${host}/${path}`;
}

// A folder inside a repository, as the plugin sends it (git.path): no leading or trailing slash, "" at the root.
export const normalizePath = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

// Whether a folder is inside another: the same folder, or below it. "" holds everything.
export const pathWithin = (path: string, prefix: string): boolean =>
  prefix === "" || path === prefix || path.startsWith(`${prefix}/`);

// What a product's id starts as: the repository's last name (billing), then owner and name (acme-billing) when that's
// taken, then numbered. Lower case, letters, digits and dashes, so it sits in a URL as it is.
export function slugCandidates(repo: string): string[] {
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "");
  const parts = repo.split("/").slice(1).filter(Boolean);
  const name = slug(parts.at(-1) ?? "") || "product";
  const owned = slug(parts.slice(-2).join("-")) || name;
  const out = [name, owned];
  for (let n = 2; n <= 20; n++) out.push(`${owned}-${n}`);
  out.push(`${name}-${createHash("sha1").update(repo).digest("hex").slice(0, 8)}`);
  return [...new Set(out)];
}

// The words of a finding, for telling two of them apart: lower case, punctuation and spacing gone. "No docs for the
// retry-budget." and "no docs for the retry budget" are the same gap.
export const normalizeText = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const textKey = (...parts: string[]): string => createHash("sha1").update(parts.join("\u001f")).digest("hex");

// Keeps the first of each item whose text says the same thing within one session. Callers put the item they'd rather
// keep first (a server record before the same line from a summary).
export function dedupeWithinSession<T extends { sessionId: string; text: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.sessionId}\u001f${normalizeText(item.text)}`;
    if (!normalizeText(item.text) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

// The UTC day a moment falls on, as 2026-11-14: how signal_daily cuts time.
export const dayKey = (at: Date): string => at.toISOString().slice(0, 10);

// The Monday (UTC, midnight) a moment's week starts on.
export function weekStart(at: Date): Date {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY_MS);
}
