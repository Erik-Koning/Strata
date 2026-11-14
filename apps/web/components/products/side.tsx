// The side column of a product's page: where its tool time is lost, its open gaps, its code areas and who has worked
// on each (by name, never how much), its tickets and pull requests, and a way to ask about it.
import { ArrowRight, FolderCode, MessageCircleQuestionMark, Puzzle, Timer } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { durationLabel, type GapLine, type RefLink, type TimeSink } from "../../server/hub/product-page.ts";
import { InlineMarkdown } from "../markdown.tsx";
import { Ago } from "../time.tsx";
import { names, RefChips } from "./refs.tsx";

const HEADER = "flex flex-wrap items-center justify-between gap-2 border-line border-b px-5 py-3.5";
const FOOT_LINK = "btn btn-quiet btn-sm max-md:min-h-11";
const AREAS_SHOWN = 8;

const times = (count: number, one: string, many: string) => (count === 1 ? one : `${count} ${many}`);

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-5 text-[13px] text-ink-3">{children}</p>;
}

export function TimeSinks({
  productId,
  top,
  totalMs,
  days,
}: {
  productId: string;
  top: TimeSink[];
  totalMs: number;
  days: number;
}) {
  return (
    <section className="card" aria-labelledby="time-title">
      <header className={HEADER}>
        <h2 id="time-title" className="flex items-center gap-2 font-semibold text-[15px]">
          <Timer size={16} aria-hidden className="text-ink-3" /> Time lost on tools
        </h2>
        <span className="text-[12.5px] text-ink-3">Last {days} days</span>
      </header>
      {top.length ? (
        <>
          <p className="px-5 pt-3.5 text-[13px] text-ink-3">
            <span className="font-semibold text-[15px] text-ink tabular-nums">{durationLabel(totalMs)}</span> lost to
            failed runs, re-runs and slow runs. The biggest:
          </p>
          <ol className="divide-y divide-line">
            {top.map((item) => (
              <li key={item.key} className="px-5 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-[14px]">
                    {item.class}{" "}
                    <span className="font-mono font-normal text-[12px] text-ink-3" title={`Fingerprint ${item.fp}`}>
                      {item.fp.slice(0, 8)}
                    </span>
                  </span>
                  <span className="flex-none font-semibold text-[14px] tabular-nums">{durationLabel(item.lostMs)}</span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-ink-3">
                  {[
                    item.failedMs ? `failed ${durationLabel(item.failedMs)}` : null,
                    item.rerunMs ? `re-runs ${durationLabel(item.rerunMs)}` : null,
                    item.slowMs ? `slow ${durationLabel(item.slowMs)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <Empty>
          No time lost in the last {days} days. Sessions here report how long their shell commands take, never the
          commands themselves; failures, re-runs and unusually slow runs show up here.
        </Empty>
      )}
      <div className="border-line border-t px-3 py-2">
        <Link href={`/time?product=${encodeURIComponent(productId)}`} className={FOOT_LINK}>
          Where the time goes <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

export function OpenGaps({ productId, top, open }: { productId: string; top: GapLine[]; open: number }) {
  return (
    <section className="card" aria-labelledby="gaps-title">
      <header className={HEADER}>
        <h2 id="gaps-title" className="flex items-center gap-2 font-semibold text-[15px]">
          <Puzzle size={16} aria-hidden className="text-ink-3" /> Open gaps
        </h2>
        <span className="text-[12.5px] text-ink-3">{open ? `${open} open` : "None open"}</span>
      </header>
      {top.length ? (
        <ol className="divide-y divide-line">
          {top.map((gap) => (
            <li key={gap.id} className="px-5 py-3">
              <InlineMarkdown className="line-clamp-3 break-words text-[14px]">{gap.text}</InlineMarkdown>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-3">
                {[
                  gap.sessions ? (
                    <span key="s">came up in {times(gap.sessions, "one session", "sessions")}</span>
                  ) : null,
                  gap.asked ? <span key="a">asked {times(gap.asked, "once", "times")}</span> : null,
                  gap.owner ? <span key="o">{gap.owner} is on it</span> : null,
                  gap.lastSeen ? (
                    <span key="l">
                      seen <Ago at={gap.lastSeen} />
                    </span>
                  ) : null,
                ]
                  .filter(Boolean)
                  .flatMap((part, i) =>
                    i
                      ? [
                          <span key={`dot${i}`} aria-hidden>
                            ·
                          </span>,
                          part,
                        ]
                      : [part],
                  )}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>
          No open gaps. When an agent or a person can't find something they need about this product, it lands here until
          someone answers it.
        </Empty>
      )}
      <div className="border-line border-t px-3 py-2">
        <Link href={`/gaps?product=${encodeURIComponent(productId)}`} className={FOOT_LINK}>
          {open > top.length ? `All ${open} open gaps` : "Go to gaps"} <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

export function Areas({ areas, people }: { areas: { area: string; people: string[] }[]; people: string[] }) {
  const shown = areas.slice(0, AREAS_SHOWN);
  const rest = areas.slice(AREAS_SHOWN);
  const row = (a: { area: string; people: string[] }) => (
    <li key={a.area} className="px-5 py-3">
      <p className="break-words font-mono text-[13px]">{a.area}</p>
      {a.people.length ? <p className="mt-0.5 text-[12.5px] text-ink-3">{names(a.people)}</p> : null}
    </li>
  );
  return (
    <section className="card" aria-labelledby="areas-title">
      <header className={HEADER}>
        <h2 id="areas-title" className="flex items-center gap-2 font-semibold text-[15px]">
          <FolderCode size={16} aria-hidden className="text-ink-3" /> Code areas
        </h2>
        <span className="text-[12.5px] text-ink-3">Who has worked on each lately</span>
      </header>
      {shown.length ? (
        <>
          <ul className="divide-y divide-line">{shown.map(row)}</ul>
          {rest.length ? (
            <details className="group border-line border-t">
              <summary className="flex min-h-11 cursor-pointer items-center px-5 text-[13px] text-ink-2 hover:text-ink md:min-h-9">
                <span className="group-open:hidden">Show {rest.length} more areas</span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <ul className="divide-y divide-line border-line border-t">{rest.map(row)}</ul>
            </details>
          ) : null}
        </>
      ) : people.length ? (
        <Empty>No session summary has named a code area yet. Worked on lately by {names(people)}.</Empty>
      ) : (
        <Empty>Areas appear when approved session summaries name the parts of the code they touched.</Empty>
      )}
    </section>
  );
}

export function Tickets({ refs }: { refs: RefLink[] }) {
  return (
    <section className="card" aria-labelledby="tickets-title">
      <header className={HEADER}>
        <h2 id="tickets-title" className="font-semibold text-[15px]">
          Tickets and pull requests
        </h2>
      </header>
      {refs.length ? (
        <div className="flex flex-wrap gap-1.5 px-5 py-4">
          <RefChips refs={refs} />
        </div>
      ) : (
        <Empty>None linked in the last six weeks. Sessions link the Jira keys and pull requests they worked on.</Empty>
      )}
    </section>
  );
}

export function AskLink({ productId, name }: { productId: string; name: string }) {
  return (
    <Link
      href={`/ask?product=${encodeURIComponent(productId)}`}
      className="card flex min-h-11 items-center gap-3 p-4 transition-colors hover:border-line-strong"
    >
      <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-accent-soft text-accent-text">
        <MessageCircleQuestionMark size={17} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[14px]">Ask about this product</span>
        <span className="block text-[13px] text-ink-3">Questions about {name}, answered from its approved work.</span>
      </span>
      <ArrowRight size={16} aria-hidden className="flex-none text-accent-text" />
    </Link>
  );
}
