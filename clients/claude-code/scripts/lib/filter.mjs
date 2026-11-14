import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { p, settings } from "./store.mjs";

// Glob support for config.json `excludedPaths`: `*`, `**`, `?`, and a leading `~`.
function globToRegex(pattern) {
  let expanded = pattern.replace(/\\/g, "/");
  if (expanded === "~" || expanded.startsWith("~/")) expanded = os.homedir().replace(/\\/g, "/") + expanded.slice(1);
  const source = expanded
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/(^|\/)\*\*(?=\/)/g, "$1<<DIR>>")
    .replace(/\*\*/g, "<<ALL>>")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/<<ALL>>/g, ".*")
    .replace(/<<DIR>>\//g, "(?:.*/)?");
  return new RegExp(`^${source}$`, "s");
}

export function isExcluded(cwd) {
  // The summarizer's own working directory. Its calls set STRATA_INTERNAL, but a host that runs inside a
  // long-lived server (OpenCode) cannot pass that to its plugin, so the path is excluded as well.
  if (path.resolve(cwd) === path.resolve(p("summarizer"))) return true;
  const patterns = settings().excludedPaths;
  if (!Array.isArray(patterns)) return false;
  const normalized = cwd.replace(/\\/g, "/");
  const base = path.basename(normalized);
  return patterns.some((raw) => {
    if (typeof raw !== "string" || !raw.trim()) return false;
    const pattern = raw.trim();
    const regex = globToRegex(pattern);
    if (regex.test(normalized) || regex.test(base)) return true;
    // `dir/**` should cover `dir` itself too
    return pattern.endsWith("/**") && globToRegex(pattern.slice(0, -3)).test(normalized.replace(/\/+$/, ""));
  });
}

// The directory a hook runs in must be a real absolute directory. Hosts occasionally
// send an empty, relative or stale cwd.
export function resolveCwd(input) {
  for (const candidate of [input.cwd, process.env.CLAUDE_PROJECT_DIR]) {
    if (typeof candidate !== "string" || !path.isAbsolute(candidate)) continue;
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export function validSessionId(id) {
  return typeof id === "string" && /^[\w.-]{1,128}$/.test(id) ? id : null;
}
