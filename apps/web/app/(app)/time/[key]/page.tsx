import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { timeLost, timeTrend } from "../../../../server/hub/signals.ts";
import { requireViewer } from "../../../../server/viewer.ts";
import { duration, hours, Section, shortRepo } from "../../hub-ui.tsx";
import { PageHeader } from "../../page-header.tsx";

export const metadata: Metadata = { title: "Time lost" };
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function TimeItemPage({ params }: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await params).key);
  const viewer = await requireViewer();
  const now = new Date();
  const since = new Date(now.getTime() - 84 * DAY);
  const [weeks, all] = await Promise.all([
    timeTrend(key, { since, until: now }, viewer),
    timeLost({ since, until: now }, viewer),
  ]);
  const item = all.items.find((i) => i.key === key);
  if (!weeks.length || !item) notFound();
  const max = Math.max(1, ...weeks.map((w) => w.lost.totalMs));

  return (
    <>
      <PageHeader
        eyebrow="Time lost"
        title={`${item.class} ${item.fp.slice(0, 8)}`}
        lede={`${shortRepo(item.repo)} · ${item.runs} runs, ${item.failures} failed, ${item.reruns} re-run in 12 weeks · typical ${duration(item.medianMs)}`}
        actions={
          <Link href="/time" className="btn btn-quiet btn-sm">
            All time
          </Link>
        }
      />
      <Section title="Week by week" hint={`${hours(item.hours)} lost in all`}>
        <div className="card p-5">
          <div className="flex h-40 items-end gap-2" role="img" aria-label="Hours lost per week">
            {weeks.map((w) => (
              <div
                key={w.weekStart.toISOString()}
                className="flex h-full flex-1 flex-col justify-end"
                title={`${w.weekStart.toISOString().slice(0, 10)}: ${hours(w.hours)} · ${w.runs} runs, ${w.failures} failed`}
              >
                <div
                  className="w-full overflow-hidden rounded-t-[3px] bg-line"
                  style={{ height: `${Math.max(2, (w.lost.totalMs / max) * 100)}%` }}
                >
                  <div className="h-full w-full bg-accent/70" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10.5px] text-ink-3">
            <span>{weeks[0]?.weekStart.toISOString().slice(5, 10)}</span>
            <span>{weeks.at(-1)?.weekStart.toISOString().slice(5, 10)}</span>
          </div>
        </div>
      </Section>
      <Section title="Weeks">
        <ul className="card divide-y divide-line text-[14px]">
          {[...weeks].reverse().map((w) => (
            <li key={w.weekStart.toISOString()} className="flex flex-wrap gap-x-4 px-5 py-3">
              <span className="font-mono text-[13px]">{w.weekStart.toISOString().slice(0, 10)}</span>
              <span className="text-ink-3">
                {w.runs} runs · {w.failures} failed · {w.reruns} re-run
              </span>
              <span className="ml-auto font-mono tabular-nums">{hours(w.hours)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
