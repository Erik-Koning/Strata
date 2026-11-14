// The commit rail on a product's history page: every commit the clone has, newest first, on one spine. The stretch of
// spine the comparison covers is drawn in violet, from Before (a ring) to After (a filled node). Each commit's title
// opens it against its parent; Before and After set that end of the comparison and keep the other.
import Link from "next/link";
import type { HistoryCommit } from "../../server/hub/product-history.ts";
import { Ago } from "../time.tsx";

export function historyHref(productId: string, before: string | null, after: string | null): string {
  const q = new URLSearchParams();
  if (before) q.set("before", before);
  if (after) q.set("after", after);
  const s = q.toString();
  return `/products/${encodeURIComponent(productId)}/history${s ? `?${s}` : ""}`;
}

export function Changes({
  files,
  added,
  removed,
}: {
  files: number | null;
  added: number | null;
  removed: number | null;
}) {
  if (files === null) return <span className="text-ink-3">Merge</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5 tabular-nums">
      <span className="text-ink-3">
        {files} {files === 1 ? "file" : "files"}
      </span>
      <span className="n-add">+{added ?? 0}</span>
      <span className="n-del">−{removed ?? 0}</span>
    </span>
  );
}

export function Timeline({
  productId,
  commits,
  before,
  after,
  range,
}: {
  productId: string;
  commits: HistoryCommit[];
  before: string | null;
  after: string;
  range: string[];
}) {
  const inRange = new Set(range);
  const ai = commits.findIndex((c) => c.sha === after);
  const bi = before ? commits.findIndex((c) => c.sha === before) : -1;
  const top = bi === -1 ? ai : Math.min(ai, bi);
  const bottom = bi === -1 ? ai : Math.max(ai, bi);

  return (
    <nav className="card min-w-0 overflow-hidden" aria-labelledby="commits-title">
      <header className="flex items-baseline justify-between gap-2 border-line border-b px-4 py-3">
        <h2 id="commits-title" className="font-semibold text-[15px]">
          Commits
        </h2>
        <span className="text-[12.5px] text-ink-3">
          {commits.length} on every branch{commits.length >= 200 ? ", newest 200" : ""}
        </span>
      </header>
      <ol className="rail py-1">
        {commits.map((c, i) => {
          const role = c.sha === after ? "after" : c.sha === before ? "before" : null;
          const covered = i >= top && i <= bottom && (role !== null || inRange.has(c.sha));
          const bar = top === bottom || !covered ? null : i === top ? "top" : i === bottom ? "bottom" : "mid";
          const parent = c.parents[0] ?? null;
          return (
            <li
              key={c.sha}
              className="rail-item"
              data-bar={bar ?? undefined}
              data-role={role ?? undefined}
              data-covered={covered || undefined}
            >
              <span className="rail-node" aria-hidden />
              <div className="min-w-0 py-3 pr-4">
                <Link
                  href={historyHref(productId, parent ?? "root", c.sha)}
                  className="block break-words font-medium text-[13.5px] text-ink leading-snug hover:text-accent-text"
                  title="Show this commit's own changes"
                >
                  {c.subject || "(no message)"}
                </Link>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-ink-3">
                  <span className="text-ink-2" title={c.author.email}>
                    {c.author.name}
                  </span>
                  <Ago at={c.at} />
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                  <code className="chip chip-mono" title={c.sha}>
                    {c.short}
                  </code>
                  <Changes files={c.files} added={c.added} removed={c.removed} />
                  {c.linked ? (
                    <span
                      className="chip bg-[var(--relay-blue-soft)] text-[var(--relay-blue)]"
                      title="A handoff you can open recorded this exact commit"
                    >
                      Handoff
                    </span>
                  ) : null}
                </div>
                {c.refs.length ? (
                  <p className="mt-1 truncate font-mono text-[11px] text-ink-3" title={c.refs.join(", ")}>
                    {c.refs.slice(0, 2).join("  ")}
                  </p>
                ) : null}
                <div className="mt-2 flex gap-1.5">
                  <Link
                    href={historyHref(productId, c.sha, after)}
                    className="rail-pick inline-flex items-center max-md:min-h-9"
                    aria-current={role === "before" ? "true" : undefined}
                  >
                    Before<span className="sr-only"> is {c.short}</span>
                  </Link>
                  <Link
                    href={historyHref(productId, before ?? "root", c.sha)}
                    className="rail-pick inline-flex items-center max-md:min-h-9"
                    aria-current={role === "after" ? "true" : undefined}
                  >
                    After<span className="sr-only"> is {c.short}</span>
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
