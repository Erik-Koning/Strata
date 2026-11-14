import { Timer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TimeFilterBar } from "../../../components/time-lost/filters.tsx";
import { HowWeCount } from "../../../components/time-lost/how-we-count.tsx";
import { TimeItem } from "../../../components/time-lost/time-item.tsx";
import { formatDay, formatLost, parseTimeFilters, timeHref, timePage } from "../../../server/hub/time-page.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { TimeHeader } from "./header.tsx";

export const metadata: Metadata = { title: "Time" };

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

// Where engineering time goes: the hours commands lost in a range, the most first, each with its trend, what
// sessions said about it and a ticket to copy. Read through the hub's read models as the viewer (server/hub/time-page.ts).
export default async function TimePage({ searchParams }: PageProps<"/time">) {
  const viewer = await requireViewer();
  const filters = parseTimeFilters(await searchParams);
  const data = await timePage(viewer, filters);
  if (data.movedTo) redirect(timeHref({ days: filters.days, productId: data.movedTo }));

  const top = data.rows[0]?.lost.totalMs ?? 0;
  const scope = data.product ? ` in ${data.product.name}` : "";
  const filtered = Boolean(data.product) || data.filters.days !== 90;
  const range = `${formatDay(data.since)} to ${formatDay(data.until, true)}`;

  return (
    <>
      <TimeHeader />
      <TimeFilterBar filters={data.filters} products={data.products} />

      {data.missingProduct ? (
        <p role="status" className="card mb-6 px-5 py-3.5 text-[13px] text-ink-2">
          That product isn't listed: there's no such product, or it has no approved work yet. Showing every product.
        </p>
      ) : null}

      {data.rows.length ? (
        <>
          <section className="card mb-6 p-5 sm:p-6" aria-labelledby="lost-title">
            <h2 id="lost-title" className="font-medium text-[13px] text-ink-2">
              Time lost in the last {data.filters.days} days{scope}
            </h2>
            <p className="mt-2 font-semibold text-[48px] leading-none tracking-[-0.03em] tabular-nums">
              {formatLost(data.lost.totalMs)}
            </p>
            <p className="mt-3 max-w-2xl text-[14px] text-ink-2">
              Lost means time in failed runs, in successful re-runs of a command already run in the same session, and in
              first runs beyond the command's typical (median) time.
            </p>
            <dl className="mt-5 grid grid-cols-3 gap-3 border-line border-t pt-4">
              {(
                [
                  ["Failed runs", data.lost.failedMs],
                  ["Re-runs", data.lost.rerunMs],
                  ["Slow first runs", data.lost.slowMs],
                ] as const
              ).map(([label, ms]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[12.5px] text-ink-3">{label}</dt>
                  <dd className="mt-0.5 font-semibold text-[15px] tabular-nums">{formatLost(ms)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[12.5px] text-ink-3 tabular-nums">
              {count(data.commands, "command")} in {count(data.repos, "repository", "repositories")}, {range} (UTC
              days).
            </p>
          </section>

          <HowWeCount />

          <section className="card" aria-labelledby="ranked-title">
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-line border-b px-5 py-3.5">
              <h2 id="ranked-title" className="font-semibold text-[15px]">
                Commands that lost the most time
              </h2>
              <p className="text-[12.5px] text-ink-3">Bars to scale against the top command. Open one for more.</p>
            </header>
            <ol className="divide-y divide-line">
              {data.rows.map((row) => (
                <TimeItem key={row.id} row={row} topMs={top} />
              ))}
            </ol>
            {data.commands > data.rows.length ? (
              <p className="border-line border-t px-5 py-3 text-[12.5px] text-ink-3 tabular-nums">
                Showing the {data.rows.length} commands that lost the most, of {data.commands}. The total above counts
                them all.
              </p>
            ) : null}
          </section>
        </>
      ) : (
        <>
          <section className="card mb-6 px-6 py-12 text-center" aria-labelledby="empty-title">
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
              <Timer size={17} aria-hidden />
            </span>
            <h2 id="empty-title" className="mt-4 font-semibold text-[16px]">
              {filtered ? `No time lost${scope} in the last ${data.filters.days} days` : "No tool time to show yet"}
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
              Time comes from the plugin's tool timings: how long each test, build, lint or other command took in a
              connected session, and whether it failed. It shows here for repositories that have approved work, once a
              command loses time to a failure, a re-run or a slow run.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2 max-md:[&_.btn]:min-h-11">
              {filtered ? (
                <Link href={timeHref({ days: 90, productId: null })} className="btn btn-sm">
                  Every product, last 90 days
                </Link>
              ) : null}
              <Link href="/connect" className="btn btn-sm">
                Connect Claude Code
              </Link>
            </div>
          </section>
          <HowWeCount />
        </>
      )}
    </>
  );
}
