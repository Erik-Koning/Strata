import { MEMORY_KINDS, type MemoryKind, type MemoryStatus } from "@strata/contracts";
import { Forward, Lock, Search, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { listMemories, overview } from "../../../server/stats.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";
import { AddMemory } from "./add-memory.tsx";
import { MemoryList, type MemoryRow } from "./memory-list.tsx";

export const metadata: Metadata = { title: "Knowledge" };

const STATUSES: { value: MemoryStatus | "all"; label: string }[] = [
  { value: "candidate", label: "Needs review" },
  { value: "active", label: "Remembered" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All open" },
];

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function MemoriesPage({ searchParams }: PageProps<"/memories">) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const q = one(params.q) ?? "";
  const status = (one(params.status) ?? "all") as MemoryStatus | "all";
  const kind = (one(params.kind) ?? "all") as MemoryKind | "all";
  const project = one(params.project) ?? "";
  const page = Number(one(params.page) ?? 1) || 1;
  const [{ rows, total, pages, page: current }, stats] = await Promise.all([
    listMemories(viewer.userId, { q, status, kind, project: project || undefined, page }),
    overview(viewer.userId),
  ]);
  const href = (change: Record<string, string | number>) => {
    const next = new URLSearchParams({
      q,
      status,
      kind,
      project,
      page: String(current),
      ...Object.fromEntries(Object.entries(change).map(([k, v]) => [k, String(v)])),
    });
    for (const [k, v] of [...next.entries()]) if (!v || v === "all" || (k === "page" && v === "1")) next.delete(k);
    const s = next.toString();
    return s ? `/memories?${s}` : "/memories";
  };
  const memoryRows: MemoryRow[] = rows.map((m) => ({
    id: m._id.toHexString(),
    text: m.text,
    kind: m.kind,
    status: m.status,
    trust: m.trust,
    confidence: m.confidence,
    project: m.scope.project,
    source: m.provenance?.source ?? "unknown",
    sessionID: m.provenance?.sessionID ?? null,
    createdAt: m.createdAt.toISOString(),
  }));
  const filtered = Boolean(q || project || kind !== "all" || status !== "all");

  return (
    <>
      <PageHeader
        title="Knowledge"
        lede="What your agents learned. You decide what they keep."
        actions={<AddMemory projects={stats.projects} />}
      />

      <ul
        aria-label="How knowledge is shared"
        className="mb-8 grid gap-px overflow-hidden rounded-[12px] bg-line sm:grid-cols-3"
      >
        <li className="bg-surface px-5 py-4">
          <p className="flex items-center gap-2 font-medium text-[14px] text-ink">
            <Lock size={14} className="text-ink-3" aria-hidden /> Private to you
          </p>
          <p className="mt-1 text-[13px] text-ink-3 leading-snug">Everything here is yours. No teammate can read it.</p>
        </li>
        <li className="bg-surface px-5 py-4">
          <p className="flex items-center gap-2 font-medium text-[14px] text-ink">
            <Forward size={14} className="text-accent" aria-hidden /> Shared only by you
          </p>
          <p className="mt-1 text-[13px] text-ink-3 leading-snug">
            A memory reaches a teammate only when you tick it in a handoff you approve.
          </p>
        </li>
        <li className="bg-surface px-5 py-4">
          <p className="flex items-center gap-2 font-medium text-[14px] text-ink">
            <Undo2 size={14} className="text-ink-3" aria-hidden /> Yours to change
          </p>
          <p className="mt-1 text-[13px] text-ink-3 leading-snug">
            Keep, archive or forget any item. Revoking a handoff takes back what it shared.
          </p>
        </li>
      </ul>

      <form
        action="/memories"
        className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_200px_auto]"
        aria-label="Search and filter memories"
      >
        <label className="relative">
          <span className="sr-only">Search memories</span>
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3"
          />
          <input name="q" defaultValue={q} className="input pl-9" placeholder="Search what's remembered" />
        </label>
        <label>
          <span className="sr-only">Kind</span>
          <select name="kind" defaultValue={kind} className="input">
            <option value="all">Every kind</option>
            {MEMORY_KINDS.map((k) => (
              <option key={k} value={k}>
                {k[0]?.toUpperCase()}
                {k.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Project</span>
          <select name="project" defaultValue={project} className="input">
            <option value="">Every project</option>
            {stats.projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        <button type="submit" className="btn min-h-[42px]">
          Apply
        </button>
      </form>

      <nav aria-label="Status" className="mb-4 flex flex-wrap items-center gap-3">
        <span className="inline-flex flex-wrap gap-0.5 rounded-[9px] border border-line bg-sunk p-0.5">
          {STATUSES.map((s) => (
            <Link
              key={s.value}
              href={href({ status: s.value, page: 1 })}
              aria-current={status === s.value ? "page" : undefined}
              className={`inline-flex min-h-8 items-center rounded-[7px] px-3 font-medium text-[13px] transition-colors max-sm:min-h-11 ${
                status === s.value
                  ? "bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--line-strong)]"
                  : "text-ink-3 hover:text-ink"
              }`}
            >
              {s.label}
            </Link>
          ))}
        </span>
        <span className="ml-auto text-[12.5px] text-ink-3 tabular-nums">{total.toLocaleString()} found</span>
      </nav>

      {memoryRows.length ? (
        <MemoryList rows={memoryRows} />
      ) : (
        <div className="card px-6 py-12 text-center">
          <p className="font-semibold text-[16px]">
            {filtered ? "Nothing matches these filters" : "Nothing remembered yet"}
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
            {filtered
              ? "Try another search, or clear the filters to see everything."
              : "Memories appear as your sessions tell Claude what to keep (“we always use pnpm here”), or when you add one above."}
          </p>
          {filtered ? (
            <Link href="/memories" className="btn btn-sm mt-4">
              Clear filters
            </Link>
          ) : null}
        </div>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="mt-5 flex items-center justify-between gap-3">
          {current > 1 ? (
            <Link className="btn btn-sm min-h-11" href={href({ page: current - 1 })}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[13px] text-ink-3">
            Page {current} of {pages}
          </span>
          {current < pages ? (
            <Link className="btn btn-sm min-h-11" href={href({ page: current + 1 })}>
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
