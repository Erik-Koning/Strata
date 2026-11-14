// Product history: a product's commits and the diff between any two of them, read from a local clone that the
// operator named in STRATA_LOCAL_REPOS. Read-only by construction:
//   - the clone comes from that setting only, never from a request, a database row or a client;
//   - commits are accepted only when they're in the history this module listed, so no ref, range or option a person
//     types reaches git;
//   - git runs with an argument array (no shell), no pager, no external diff or textconv drivers, no fsmonitor hook and
//     no prompts, with a timeout and a cap on what it may print.
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

export const MAX_COMMITS = 200;
// What one comparison may show: past these the rest is counted but not rendered.
export const MAX_DIFF_BYTES = 2_000_000;
export const MAX_FILES = 150;
export const MAX_LINES_PER_FILE = 1_200;
const GIT_TIMEOUT_MS = 10_000;
// git's empty tree: what a repository's first commit is compared against.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SHA = /^[0-9a-f]{7,40}$/;

export interface Commit {
  sha: string;
  short: string;
  parents: string[];
  author: { name: string; email: string };
  at: string;
  subject: string;
  // Branch and tag names pointing at it, as git decorates them.
  refs: string[];
  // From --shortstat; null for a merge (git shows no stat for one).
  files: number | null;
  added: number | null;
  removed: number | null;
}

export type LineKind = "add" | "del" | "ctx" | "note";
export interface DiffLine {
  kind: LineKind;
  old: number | null;
  new: number | null;
  text: string;
}
export interface Hunk {
  header: string;
  // The function or section git names after the @@, if any.
  section: string;
  lines: DiffLine[];
}
export type FileStatus = "added" | "deleted" | "modified" | "renamed" | "copied" | "mode";
export interface FileDiff {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  added: number;
  removed: number;
  hunks: Hunk[];
  // Lines past MAX_LINES_PER_FILE were counted, not kept.
  truncated: boolean;
  mode: { old: string | null; new: string | null };
  similarity: number | null;
}
export interface Diff {
  files: FileDiff[];
  added: number;
  removed: number;
  // git printed more than MAX_DIFF_BYTES, or there were more than MAX_FILES files: what's here is the start of it.
  truncated: boolean;
  omittedFiles: number;
}

export class GitUnavailable extends Error {}

// The local clone for a repository, if the operator configured one and it's a directory. Never derived from input.
export function cloneFor(repos: Record<string, string>, repo: string): string | null {
  const dir = Object.hasOwn(repos, repo) ? repos[repo] : undefined;
  if (!dir || !isAbsolute(dir)) return null;
  try {
    return statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

interface GitResult {
  stdout: string;
  truncated: boolean;
}

async function git(dir: string, args: string[], maxBytes = 4_000_000): Promise<GitResult> {
  const full = [
    "-C",
    dir,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.quotepath=false",
    "-c",
    "diff.mnemonicPrefix=false",
    "-c",
    "diff.noprefix=false",
    "-c",
    "log.showSignature=false",
    "--no-pager",
    ...args,
  ];
  // Only what git needs: no inherited GIT_* that could point it elsewhere (GIT_DIR, GIT_EXTERNAL_DIFF, ...).
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
  } as unknown as NodeJS.ProcessEnv;
  return new Promise((resolve, reject) => {
    const child = spawn("git", full, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;
      if (size + chunk.length > maxBytes) {
        chunks.push(chunk.subarray(0, maxBytes - size));
        size = maxBytes;
        truncated = true;
        child.kill("SIGTERM");
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => reject(new GitUnavailable(`git couldn't run: ${error.message}`)));
    child.on("close", (code) => {
      const stdout = Buffer.concat(chunks).toString("utf8");
      if (truncated || code === 0) resolve({ stdout, truncated });
      else reject(new GitUnavailable(stderr.trim().split("\n").at(-1) || `git exited ${code}`));
    });
  });
}

const RS = "\x1e";
const US = "\x1f";

// Every commit on every branch and tag of the clone, newest first (by commit date), up to MAX_COMMITS.
export async function listCommits(dir: string): Promise<Commit[]> {
  const { stdout } = await git(dir, [
    "log",
    "--exclude=refs/stash",
    "--all",
    "--date-order",
    `--max-count=${MAX_COMMITS}`,
    "--no-color",
    "--decorate=short",
    `--format=${RS}%H${US}%P${US}%an${US}%ae${US}%aI${US}%D${US}%s`,
    "--shortstat",
  ]);
  return parseLog(stdout);
}

export function parseLog(stdout: string): Commit[] {
  const commits: Commit[] = [];
  for (const block of stdout.split(RS)) {
    if (!block.trim()) continue;
    const [head = "", ...rest] = block.split("\n");
    const [sha = "", parents = "", name = "", email = "", at = "", decorations = "", subject = ""] = head.split(US);
    if (!/^[0-9a-f]{40,64}$/.test(sha)) continue;
    const stat = rest.join("\n");
    const files = /(\d+) files? changed/.exec(stat);
    const added = /(\d+) insertions?\(\+\)/.exec(stat);
    const removed = /(\d+) deletions?\(-\)/.exec(stat);
    const parentList = parents.split(" ").filter(Boolean);
    const isMerge = parentList.length > 1;
    commits.push({
      sha,
      short: sha.slice(0, 7),
      parents: parentList,
      author: { name, email },
      at,
      subject,
      refs: decorations
        .split(",")
        .map((d) => d.trim().replace(/^HEAD -> /, ""))
        .filter((d) => d && d !== "HEAD" && !d.endsWith("/HEAD")),
      files: isMerge && !files ? null : Number(files?.[1] ?? 0),
      added: isMerge && !files ? null : Number(added?.[1] ?? 0),
      removed: isMerge && !files ? null : Number(removed?.[1] ?? 0),
    });
  }
  return commits;
}

// A commit the history lists, from what a URL says: a hex prefix matching exactly one listed commit, or null.
export function pickCommit(commits: Commit[], value: string | null | undefined): Commit | null {
  const v = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!SHA.test(v)) return null;
  const matches = commits.filter((c) => c.sha.startsWith(v));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

// The commits `after` has that `before` doesn't (what the comparison brings in), newest first, from the listed ones.
export async function commitsBetween(dir: string, before: Commit | null, after: Commit): Promise<string[]> {
  const args = ["rev-list", `--max-count=${MAX_COMMITS}`, after.sha];
  if (before) args.push("--not", before.sha);
  const { stdout } = await git(dir, args);
  return stdout.split("\n").filter((l) => /^[0-9a-f]{40,64}$/.test(l));
}

// The diff from `before` (null: the empty tree) to `after`, both commits this module listed.
export async function diffCommits(dir: string, before: Commit | null, after: Commit): Promise<Diff> {
  const { stdout, truncated } = await git(
    dir,
    [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--find-renames",
      "--unified=3",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      before?.sha ?? EMPTY_TREE,
      after.sha,
      "--",
    ],
    MAX_DIFF_BYTES,
  );
  return parseDiff(stdout, truncated);
}

// "a/x b/x" when both sides are the same path; git quotes a path with unusual characters.
function unquote(path: string): string {
  if (!path.startsWith('"')) return path;
  try {
    return JSON.parse(
      path.replace(/\\([0-7]{3})/g, (_, o) => `\\u00${Number.parseInt(o, 8).toString(16).padStart(2, "0")}`),
    );
  } catch {
    return path.slice(1, -1);
  }
}

function headerPaths(rest: string): { a: string; b: string } {
  const quoted = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(rest);
  if (rest.startsWith('"') && quoted) return { a: unquote(quoted[1] ?? ""), b: unquote(quoted[2] ?? "") };
  // Unquoted, with spaces allowed: the two halves are the same length when the path didn't change.
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === " " && rest.slice(2, half) === rest.slice(half + 3))
    return { a: rest.slice(0, half), b: rest.slice(half + 1) };
  return { a: quoted?.[1] ?? rest, b: quoted?.[2] ?? rest };
}

const strip = (p: string, prefix: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : p);

export function parseDiff(stdout: string, truncatedOutput = false): Diff {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let kept = 0;
  const lines = stdout.split("\n");
  // A cut-off last line is incomplete: leave it out.
  if (truncatedOutput) lines.pop();
  else if (lines.at(-1) === "") lines.pop();

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const { a, b } = headerPaths(line.slice("diff --git ".length));
      file = {
        path: strip(b, "b/"),
        oldPath: null,
        status: "modified",
        binary: false,
        added: 0,
        removed: 0,
        hunks: [],
        truncated: false,
        mode: { old: null, new: null },
        similarity: null,
      };
      const from = strip(a, "a/");
      if (from !== file.path) file.oldPath = from;
      files.push(file);
      hunk = null;
      kept = 0;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith("new file mode ")) {
        file.status = "added";
        file.mode.new = line.slice(14);
      } else if (line.startsWith("deleted file mode ")) {
        file.status = "deleted";
        file.mode.old = line.slice(18);
      } else if (line.startsWith("old mode ")) file.mode.old = line.slice(9);
      else if (line.startsWith("new mode ")) file.mode.new = line.slice(9);
      else if (line.startsWith("rename from ")) {
        file.oldPath = unquote(line.slice(12));
        file.status = "renamed";
      } else if (line.startsWith("rename to ")) file.path = unquote(line.slice(10));
      else if (line.startsWith("copy from ")) {
        file.oldPath = unquote(line.slice(10));
        file.status = "copied";
      } else if (line.startsWith("copy to ")) file.path = unquote(line.slice(8));
      else if (line.startsWith("similarity index ")) file.similarity = Number.parseInt(line.slice(17), 10);
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
      else if (line.startsWith("--- ")) {
        const p = unquote(line.slice(4).replace(/\t$/, ""));
        if (p !== "/dev/null" && file.status !== "renamed")
          file.oldPath = strip(p, "a/") === file.path ? null : strip(p, "a/");
      } else if (line.startsWith("+++ ")) {
        const p = unquote(line.slice(4).replace(/\t$/, ""));
        if (p !== "/dev/null") file.path = strip(p, "b/");
      }
      if (file.status === "modified" && file.mode.old && file.mode.new && !file.hunks.length) file.status = "mode";
    }
    const at = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
    if (at) {
      if (file.status === "mode") file.status = "modified";
      oldNo = Number(at[1]);
      newNo = Number(at[2]);
      hunk = { header: line.slice(0, line.indexOf("@@", 2) + 2), section: at[3] ?? "", lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const mark = line[0];
    let entry: DiffLine | null = null;
    if (mark === "+") {
      file.added++;
      entry = { kind: "add", old: null, new: newNo++, text: line.slice(1) };
    } else if (mark === "-") {
      file.removed++;
      entry = { kind: "del", old: oldNo++, new: null, text: line.slice(1) };
    } else if (mark === " " || line === "") {
      entry = { kind: "ctx", old: oldNo++, new: newNo++, text: line.slice(1) };
    } else if (mark === "\\") {
      entry = { kind: "note", old: null, new: null, text: line.slice(2) };
    }
    if (!entry) continue;
    if (kept < MAX_LINES_PER_FILE) {
      hunk.lines.push(entry);
      kept++;
    } else file.truncated = true;
  }
  for (const f of files) if (f.status === "modified" && f.mode.old && f.mode.new && !f.hunks.length) f.status = "mode";

  const shown = files.slice(0, MAX_FILES);
  return {
    files: shown,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
    truncated: truncatedOutput || files.length > MAX_FILES,
    omittedFiles: Math.max(0, files.length - MAX_FILES),
  };
}
