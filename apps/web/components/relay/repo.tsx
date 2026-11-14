// Where the work stands in git. Work that isn't pushed, and files that weren't committed, stay on the sender's machine:
// the warning says so plainly, because a recipient resuming without them would be working from the wrong tree.
import type { RepoState } from "@strata/contracts";
import { GitBranch, GitCommitHorizontal, TriangleAlert } from "lucide-react";
import { shortSha } from "./status.tsx";

const shortUrl = (url: string): string =>
  url
    .replace(/^https?:\/\//, "")
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/\.git$/, "");

export function RepoLine({ repo }: { repo: RepoState | null | undefined }) {
  if (!repo || (!repo.url && !repo.branch && !repo.commit))
    return <p className="text-[13.5px] text-ink-3">No repository state recorded.</p>;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12.5px] text-ink-2">
      {repo.url ? <span className="min-w-0 truncate text-ink">{shortUrl(repo.url)}</span> : null}
      {repo.branch ? (
        <span className="inline-flex items-center gap-1">
          <GitBranch size={13} aria-hidden className="text-ink-3" />
          <span className="sr-only">branch</span>
          {repo.branch}
        </span>
      ) : null}
      {repo.commit ? (
        <span className="inline-flex items-center gap-1" title={repo.commit}>
          <GitCommitHorizontal size={13} aria-hidden className="text-ink-3" />
          <span className="sr-only">commit</span>
          {shortSha(repo.commit)}
        </span>
      ) : null}
      {repo.pushed === true ? <span className="text-accent-text">pushed</span> : null}
    </p>
  );
}

export function RepoWarning({ repo }: { repo: RepoState | null | undefined }) {
  if (!repo) return null;
  const unpushed = repo.pushed === false;
  const uncommitted = repo.uncommitted ?? [];
  if (!unpushed && !uncommitted.length) return null;
  return (
    <div role="note" className="mt-3 rounded-[10px] bg-danger-soft px-3.5 py-3 text-[13.5px] text-danger">
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlert size={15} aria-hidden /> These changes did not travel
      </p>
      <ul className="mt-1.5 grid gap-1 text-ink-2">
        {unpushed ? (
          <li>
            Commit <span className="font-mono">{shortSha(repo.commit) ?? "(unknown)"}</span> isn't on a remote branch.
            Push it before anyone resumes.
          </li>
        ) : null}
        {uncommitted.length ? (
          <li>
            {uncommitted.length} uncommitted {uncommitted.length === 1 ? "file stays" : "files stay"} on the sender's
            machine:
            <ul className="mt-1 grid gap-0.5 font-mono text-[12px]">
              {uncommitted.slice(0, 12).map((f) => (
                <li key={f} className="truncate">
                  {f}
                </li>
              ))}
              {uncommitted.length > 12 ? <li className="text-ink-3">and {uncommitted.length - 12} more</li> : null}
            </ul>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
