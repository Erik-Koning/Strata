import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { settings } from "./store.mjs";

// Not a trim(): whitespace before the final newline belongs to a path.
function run(cwd, cmd, args, timeout = 3000) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      timeout,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }).replace(/\n$/, "");
  } catch {
    return "";
  }
}

// Strip credentials from a remote URL (https://user:token@host/...) before it is sent.
const cleanRemote = (url) => url.replace(/\/\/[^@/]+@/, "//");

// git@github.com:acme/app.git, https://user@github.com/acme/app.git and ssh://git@github.com/acme/app all
// become github.com/acme/app, the project's name on the server.
export function normalizeRemote(remote) {
  const url = cleanRemote(String(remote ?? "").trim());
  if (!url) return null;
  const scp = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(url);
  let host;
  let path;
  if (scp) {
    host = scp[1] ?? "";
    path = scp[2] ?? "";
  } else {
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return null;
    }
  }
  path = path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  return host && path ? `${host.toLowerCase()}/${path}` : null;
}

export function projectOf(cwd) {
  const remote = run(cwd, "git", ["config", "--get", "remote.origin.url"]);
  const normalized = normalizeRemote(remote);
  if (normalized) return normalized;
  const top = run(cwd, "git", ["rev-parse", "--show-toplevel"]);
  return basename(top || cwd) || "default";
}

const JIRA_KEY = /\b[A-Z][A-Z0-9]{1,9}-[1-9]\d{0,6}\b/g;
// Things shaped like a Jira key that are not: UTF-8, SHA-256, ISO-8601, CVE-2024-1234 ...
const NOT_JIRA = new Set([
  "UTF",
  "SHA",
  "ISO",
  "CVE",
  "RFC",
  "HTTP",
  "TCP",
  "UDP",
  "TLS",
  "SSL",
  "AES",
  "RSA",
  "MD",
  "IPV",
  "WCAG",
  "GPT",
  "LTS",
  "PNG",
  "JPEG",
  "CSS",
  "ES",
  "EC",
  "HS",
  "RS",
  "X",
]);

export function extractJiraKeys(...texts) {
  const allow = Array.isArray(settings().jiraKeys) ? new Set(settings().jiraKeys.map(String)) : null;
  const keys = [];
  for (const text of texts) {
    for (const key of text.match(JIRA_KEY) ?? []) {
      const prefix = key.slice(0, key.indexOf("-"));
      if (NOT_JIRA.has(prefix)) continue;
      if (allow?.size && !allow.has(prefix)) continue;
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

// File names that hold secrets are never reported, not even as a path.
const SENSITIVE_PATH =
  /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|dsa|ecdsa|ed25519)|\.npmrc|\.netrc|\.pgpass|credentials(\.json)?|secrets?\.(json|ya?ml))$/i;

// `-z` output is NUL-separated and unquoted, so paths with spaces, quotes or unicode
// survive. Rename/copy entries are followed by their original path, which is skipped.
export function parseStatusZ(raw) {
  const parts = raw.split("\0");
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) i += 1;
  }
  return files;
}

// The contract takes a commit id or nothing: `head` and `path` are left out, not sent empty, when there is no commit
// (a new repository) or no repository at all.
const COMMIT = /^[0-9a-f]{7,64}$/;

export function gitContext(cwd) {
  const root = run(cwd, "git", ["rev-parse", "--show-toplevel"]);
  if (!root)
    return {
      root: cwd,
      repoKey: cwd,
      remote: "",
      project: basename(cwd) || "default",
      branch: "",
      files: [],
      jira: [],
      isGit: false,
    };

  // The shared git dir is the same for every worktree, so one repo has one identity.
  const repoKey = run(root, "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"]) || root;
  // `branch --show-current` also works on an unborn branch (no commits yet) and is empty when detached.
  const branch = run(root, "git", ["branch", "--show-current"]);
  // `--verify` prints nothing on an unborn branch, where a bare `rev-parse HEAD` echoes "HEAD" back.
  const commit = run(root, "git", ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const head = COMMIT.test(commit) ? commit : undefined;
  const remote = cleanRemote(run(root, "git", ["remote", "get-url", "origin"]));
  const path = run(root, "git", ["rev-parse", "--show-prefix"]).replace(/\/$/, "");
  const subjects = run(root, "git", ["log", "-10", "--format=%s"]);

  // Repo-relative paths only: no local usernames or directories leave the machine.
  const files = parseStatusZ(run(root, "git", ["status", "--porcelain=v1", "-z"]))
    .filter((file) => !SENSITIVE_PATH.test(file))
    .slice(0, 200);

  // Branch keys first: they say what this work is for. Commit subjects may mention other tickets.
  return {
    root,
    repoKey,
    remote,
    project: normalizeRemote(remote) ?? basename(root) ?? "default",
    branch,
    ...(head ? { head, path } : {}),
    files,
    jira: extractJiraKeys(branch, subjects),
    isGit: true,
  };
}

// `gh pr view` is slow and rate-limited, so callers cache the result per branch.
export function lookupPr(root) {
  const raw = run(root, "gh", ["pr", "view", "--json", "number,url,title"], 5000);
  if (!raw) return null;
  try {
    const { number, url, title } = JSON.parse(raw);
    return { number, url, title };
  } catch {
    return null;
  }
}
