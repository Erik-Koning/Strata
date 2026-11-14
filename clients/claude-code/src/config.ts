// Where the plugin talks to, as whom, about which project, and where it keeps its state.
//
// The address and the token come from the environment: MEMORY_API_URL and MEMORY_API_TOKEN (the shell, or "env" in
// ~/.claude/settings.json), else the values Claude Code asked for when the plugin was enabled (its userConfig: hooks see
// them as CLAUDE_PLUGIN_OPTION_*, the MCP server as STRATA_*). Without both, the plugin does nothing at all.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";

declare const __VERSION__: string | undefined;
export const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";
export const CLIENT = `claude-code/${VERSION}`;

export interface Config {
  apiUrl: string;
  token: string;
  // The plugin's own folder: the outbox, each session's frozen block, the flusher's lock.
  home: string;
  // The project every request names; the API adds the org and the user from the token.
  project: string;
}

type Env = Record<string, string | undefined>;

// A value Claude Code didn't fill in (an unset userConfig option can arrive as its own placeholder) counts as unset.
function setting(env: Env, ...names: string[]): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value && !value.startsWith("${")) return value;
  }
  return null;
}

export function memoryHome(env: Env = process.env): string {
  return setting(env, "MEMORY_HOME", "CLAUDE_PLUGIN_DATA") ?? join(homedir(), ".claude", "strata");
}

export function loadConfig(env: Env = process.env, cwd?: string): Config | null {
  const apiUrl = setting(env, "MEMORY_API_URL", "CLAUDE_PLUGIN_OPTION_API_URL", "STRATA_API_URL");
  const token = setting(env, "MEMORY_API_TOKEN", "CLAUDE_PLUGIN_OPTION_API_TOKEN", "STRATA_API_TOKEN");
  if (!apiUrl || !token) return null;
  const where = setting(env, "CLAUDE_PROJECT_DIR") ?? cwd ?? process.cwd();
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    token,
    home: memoryHome(env),
    project: setting(env, "MEMORY_PROJECT") ?? projectOf(where),
  };
}

// git@github.com:acme/app.git, https://user@github.com/acme/app.git and ssh://git@github.com/acme/app all give
// github.com/acme/app.
export function normalizeRemote(remote: string): string | null {
  const url = remote.trim();
  if (!url) return null;
  const scp = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(url);
  let host: string;
  let path: string;
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
  if (!host || !path) return null;
  return `${host.toLowerCase()}/${path}`;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return (
      execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1500,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

// The git origin, else the repository's folder name, else the working folder's name.
export function projectOf(cwd: string): string {
  const remote = git(cwd, ["config", "--get", "remote.origin.url"]);
  const normalized = remote ? normalizeRemote(remote) : null;
  if (normalized) return normalized;
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  return basename(top ?? cwd) || "default";
}
