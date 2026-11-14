// The settings a developer keeps in .env.local, so `pnpm dev`, the scripts and the database tests all reach the same
// MongoDB (the team's Atlas cluster) with nothing to start first. Next.js reads only apps/web/.env.local; this also
// reads the repository root's, and in a git worktree, the main checkout's, so a new worktree runs without copying a
// secret into it. The first file to name a setting wins: apps/web, then the root, then the main checkout.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseEnv } from "node:util";

export function localEnv(from = process.cwd()): Record<string, string> {
  const root = repositoryRoot(from);
  if (!root) return {};
  const roots = [root, mainCheckout(root)].filter((r): r is string => r !== null);
  const files = [...new Set(roots.flatMap((r) => [join(r, "apps/web/.env.local"), join(r, ".env.local")]))];
  const merged: Record<string, string> = {};
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8"))))
      if (value !== undefined) merged[key] ??= value;
  }
  return merged;
}

// The nearest directory up from `from` with the workspace file in it.
function repositoryRoot(from: string): string | null {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

// A linked worktree's .git is a file naming its git directory; that directory's commondir leads to the main
// checkout's .git. Null in the main checkout itself, or outside git.
function mainCheckout(root: string): string | null {
  try {
    const dotGit = join(root, ".git");
    if (!statSync(dotGit).isFile()) return null;
    const gitDir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
    if (!gitDir) return null;
    const own = resolve(root, gitDir);
    return dirname(resolve(own, readFileSync(join(own, "commondir"), "utf8").trim()));
  } catch {
    return null;
  }
}
