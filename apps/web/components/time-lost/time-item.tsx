// One command on the time page: its class, product and repository, its runs, and the time it lost as a bar drawn to
// scale against the command that lost the most. Opening it shows where the time went, the weekly trend, what
// sessions said about its product, and the ticket to copy. A <details>, so it opens without script.
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { classNoun, formatDay, formatDuration, formatLost, type TimeRow } from "../../server/hub/time-page.ts";
import { CopyButton } from "../copy.tsx";
import { Ago } from "../time.tsx";
import { Sparkline } from "./sparkline.tsx";

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

export function TimeItem({ row, topMs }: { row: TimeRow; topMs: number }) {
  const share = topMs > 0 ? Math.min(100, (row.lost.totalMs / topMs) * 100) : 0;
  const product = row.productName ?? "No product";
  return (
    <li>
      <details id={`item-${row.id}`} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none flex-col gap-2.5 px-5 py-4 transition-colors hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
          <span className="flex items-start gap-3">
            <ChevronRight
              size={16}
              aria-hidden
              className="mt-0.5 flex-none text-ink-3 transition-transform group-open:rotate-90"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="chip chip-mono">{row.class}</span>
                <span className="font-medium text-[14px]">{product}</span>
                <span className="min-w-0 truncate font-mono text-[12.5px] text-ink-3">{row.repo}</span>
              </span>
              <span className="mt-1 block text-[12.5px] text-ink-3 tabular-nums">
                {count(row.runs, "run")} · {row.failures.toLocaleString("en-GB")} failed · {count(row.reruns, "re-run")}
              </span>
            </span>
            <span className="flex-none text-right font-semibold text-[15px] tabular-nums">
              {formatLost(row.lost.totalMs)}
              <span className="sr-only"> lost</span>
            </span>
          </span>
          <span className="ml-7 block h-2 rounded-r-[4px] bg-accent-soft" aria-hidden>
            <span
              className="block h-full rounded-r-[4px] bg-accent"
              style={{ width: share > 0 ? `max(2px, ${share.toFixed(2)}%)` : 0 }}
            />
          </span>
        </summary>

        <div className="grid gap-6 border-line border-t px-5 py-5 md:grid-cols-2 md:pl-12">
          <div className="min-w-0">
            <h3 className="font-semibold text-[14px]">Where the time went</h3>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 text-[13px]">
              <dt className="text-ink-3">Failed runs</dt>
              <dd className="tabular-nums">{formatLost(row.lost.failedMs)}</dd>
              <dt className="text-ink-3">Re-runs</dt>
              <dd className="tabular-nums">{formatLost(row.lost.rerunMs)}</dd>
              <dt className="text-ink-3">Slow first runs</dt>
              <dd className="tabular-nums">{formatLost(row.lost.slowMs)}</dd>
              <dt className="text-ink-3">Typical run</dt>
              <dd className="tabular-nums">{formatDuration(row.medianMs)}</dd>
              <dt className="text-ink-3">Seen</dt>
              <dd className="tabular-nums">
                {row.firstDay === row.lastDay
                  ? formatDay(row.firstDay)
                  : `${formatDay(row.firstDay)} to ${formatDay(row.lastDay)}`}
              </dd>
              <dt className="text-ink-3">Fingerprint</dt>
              <dd
                className="font-mono text-[12.5px]"
                title="A hash of the command, made on the machine: the command itself is never sent"
              >
                {row.fp.slice(0, 12)}
              </dd>
            </dl>
            <div className="mt-5">
              <Sparkline weeks={row.trend} caption="Time lost per week" />
            </div>
          </div>

          <div className="min-w-0">
            <h3 className="font-semibold text-[14px]">What sessions said about {product}</h3>
            {row.painPoints.length ? (
              <ul className="mt-2 divide-y divide-line">
                {row.painPoints.map((point) => (
                  <li key={point.id} className="py-2.5 first:pt-0">
                    <p className="whitespace-pre-wrap break-words text-[14px]">{point.text}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
                      {point.mentions ? <span className="chip">about {classNoun(row.class)}</span> : null}
                      <Ago at={point.at} />
                      <span aria-hidden>·</span>
                      <Link
                        href={`/sessions/${encodeURIComponent(point.sessionId)}`}
                        className="inline-flex items-center text-accent-text underline-offset-4 hover:underline max-md:min-h-11"
                      >
                        Open the session
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-ink-3">
                No pain points shared for {product} yet. When an approved session names one, it shows here, those about{" "}
                {classNoun(row.class)} first.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 md:col-span-2 max-md:[&_.btn]:min-h-11">
            <CopyButton text={row.ticket} label="Copy as a ticket" />
            {row.productId ? (
              <Link href={`/products/${encodeURIComponent(row.productId)}`} className="btn btn-quiet btn-sm">
                {product}'s page
              </Link>
            ) : null}
            <span className="text-[12.5px] text-ink-3">
              Markdown, with the figures, the trend and these pain points.
            </span>
          </div>
        </div>
      </details>
    </li>
  );
}
