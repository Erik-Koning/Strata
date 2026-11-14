import type { Metadata } from "next";
import Link from "next/link";
import { listProducts } from "../../../server/hub/products.ts";
import { timeLost } from "../../../server/hub/signals.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { refreshHub } from "../hub-refresh.ts";
import { duration, Empty, hours, shortRepo } from "../hub-ui.tsx";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Time" };
export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90];
const DAY = 24 * 60 * 60 * 1000;

export default async function TimePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams;
  const days = RANGES.includes(Number(raw)) ? Number(raw) : 30;
  const viewer = await requireViewer();
  await refreshHub();
  const now = new Date();
  const [lost, products] = await Promise.all([
    timeLost({ since: new Date(now.getTime() - days * DAY), until: now }, viewer),
    listProducts(viewer),
  ]);
  const name = new Map(products.map((p) => [p.id, p.name]));
  const max = Math.max(1, ...lost.items.map((i) => i.lost.totalMs));

  return (
    <>
      <PageHeader
        eyebrow="Time"
        title="Where the time goes"
        lede="Shell commands your team's agents ran that failed, were run again, or ran slower than usual. Only the kind of command and a fingerprint are kept, never the command itself."
      />
      <nav className="mb-4 flex items-center gap-2" aria-label="Range">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={r === 30 ? "/time" : `/time?days=${r}`}
            className={`btn btn-sm ${days === r ? "btn-primary" : "btn-quiet"}`}
            aria-current={days === r ? "page" : undefined}
          >
            {r} days
          </Link>
        ))}
        <span className="ml-auto text-[13px] text-ink-3">
          <span className="font-semibold text-ink tabular-nums">{hours(lost.totalHours)}</span> lost in {days} days
        </span>
      </nav>
      {lost.items.length ? (
        <ul className="card divide-y divide-line">
          {lost.items.map((i) => (
            <li key={`${i.key}:${i.productId}`}>
              <Link href={`/time/${encodeURIComponent(i.key)}`} className="block px-5 py-4 hover:bg-surface-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-[14px]">
                    {i.class} <span className="text-ink-3">{i.fp.slice(0, 8)}</span>
                  </span>
                  <span className="text-[12.5px] text-ink-3">
                    {i.productId ? (name.get(i.productId) ?? shortRepo(i.repo)) : shortRepo(i.repo)}
                  </span>
                  <span className="ml-auto font-mono text-[14px] tabular-nums">{hours(i.hours)}</span>
                </div>
                <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <div className="bg-danger" style={{ width: `${(i.lost.failedMs / max) * 100}%` }} />
                  <div className="bg-amber" style={{ width: `${(i.lost.rerunMs / max) * 100}%` }} />
                  <div className="bg-accent" style={{ width: `${(i.lost.slowMs / max) * 100}%` }} />
                </div>
                <p className="mt-1.5 text-[12.5px] text-ink-3">
                  {i.runs} runs · {i.failures} failed · {i.reruns} re-run · typical {duration(i.medianMs)} · failed{" "}
                  {duration(i.lost.failedMs)}, re-run {duration(i.lost.rerunMs)}, slow {duration(i.lost.slowMs)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No time lost in this range">
          Tool time is counted from captured sessions in repositories with approved work. Nothing failed, re-ran or ran
          slow here yet.
        </Empty>
      )}
    </>
  );
}
