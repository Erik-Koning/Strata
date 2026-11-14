// The digest's parts: each product's week (What's new and In progress), the week's time lost on tools, and the gaps
// opened and resolved in it. Server components, given the digest's plain data; days are written as the week's, in UTC.
import { ArrowRight, ArrowUpRight, CircleHelp, Newspaper, Puzzle, Timer } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { type DigestGap, type DigestProduct, type DigestTimeItem, dayLabel } from "../../server/hub/digest.ts";
import { durationLabel } from "../../server/hub/product-page.ts";
import { names, RefChips, SessionLink } from "../products/refs.tsx";

const HEADER = "flex flex-wrap items-center justify-between gap-2 border-line border-b px-5 py-3.5";
const SUBHEAD = "eyebrow border-line border-b bg-surface-2 px-5 py-2 [section+section>&]:border-t";
const FOOT_LINK = "btn btn-quiet btn-sm max-md:min-h-11";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

function Day({ at, className }: { at: string; className?: string }) {
  return (
    <time dateTime={at} className={className}>
      {dayLabel(at)}
    </time>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-5 py-5 text-[13px] text-ink-3">{children}</p>;
}

export function ProductWeek({ product }: { product: DigestProduct }) {
  const titleId = `digest-${product.id}`;
  const sessions = product.sessions.length + product.moreSessions;
  const productHref = `/products/${encodeURIComponent(product.id)}`;
  return (
    <section className="card" aria-labelledby={titleId}>
      <header className={HEADER}>
        <h2 id={titleId} className="min-w-0 font-semibold text-[16px]">
          <Link href={productHref} className="underline-offset-4 hover:underline">
            {product.name}
          </Link>
        </h2>
        <span className="text-[12.5px] text-ink-3">
          {sessions ? `${plural(sessions, "session")} shared` : "Open questions only"}
        </span>
      </header>

      {product.sessions.length ? (
        <section aria-labelledby={`${titleId}-new`}>
          <h3 id={`${titleId}-new`} className={SUBHEAD}>
            What's new
          </h3>
          <ul className="divide-y divide-line">
            {product.sessions.map((session) => (
              <li key={session.sessionId} className="px-5 py-4">
                {session.summary ? (
                  <>
                    {session.summary.title ? (
                      <p className="font-medium text-[15px] leading-snug">{session.summary.title}</p>
                    ) : null}
                    <p className="mt-1 line-clamp-6 whitespace-pre-wrap break-words text-[14px] text-ink-2">
                      {session.summary.text}
                    </p>
                  </>
                ) : (
                  <p className="text-[13px] text-ink-3">Findings from this session</p>
                )}
                {session.findings.length ? (
                  <ul className="mt-3 flex flex-col gap-2" aria-label="Shared with it">
                    {session.findings.map((finding) => (
                      <li key={finding.id} className="flex flex-wrap items-start gap-x-2 gap-y-1">
                        <span className="chip flex-none">{finding.kindLabel}</span>
                        <span className="min-w-0 flex-1 basis-56 break-words text-[13.5px] text-ink-2 leading-6">
                          {finding.text}
                        </span>
                      </li>
                    ))}
                    {session.moreFindings ? (
                      <li className="text-[13px] text-ink-3">{session.moreFindings} more on the session's page.</li>
                    ) : null}
                  </ul>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <RefChips refs={session.refs} />
                  <SessionLink sessionId={session.sessionId} />
                  <Day at={session.at} className="ml-auto text-[12.5px] text-ink-3" />
                </div>
              </li>
            ))}
            {product.moreSessions ? (
              <li className="px-5 py-3 text-[13px] text-ink-3">
                {plural(product.moreSessions, "more session")} on{" "}
                <Link href={productHref} className="text-accent-text underline-offset-4 hover:underline">
                  {product.name}'s page
                </Link>
                .
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {product.work.length ? (
        <section aria-labelledby={`${titleId}-progress`}>
          <h3 id={`${titleId}-progress`} className={SUBHEAD}>
            In progress
          </h3>
          <ul className="divide-y divide-line">
            {product.work.map((item) => (
              <li key={item.key} className="px-5 py-4">
                <p className="font-medium text-[15px] leading-snug">{item.title}</p>
                {item.people.length ? <p className="mt-1 text-[13px] text-ink-3">With {names(item.people)}</p> : null}
                {item.open.length ? (
                  <ul className="mt-3 flex flex-col gap-2" aria-label="Left open">
                    {item.open.map((question) => (
                      <li key={question.id} className="flex items-start gap-2 text-[13.5px] text-ink-2">
                        <CircleHelp size={15} aria-hidden className="mt-[3px] flex-none text-amber" />
                        <span className="min-w-0 flex-1 break-words">
                          <span className="sr-only">Open question: </span>
                          {question.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <RefChips refs={item.refs} />
                  {item.sessionIds.map((id) => (
                    <SessionLink key={id} sessionId={id} />
                  ))}
                  {item.moreSessions ? (
                    <span className="text-[12.5px] text-ink-3">and {plural(item.moreSessions, "more session")}</span>
                  ) : null}
                  {item.lastAt ? <Day at={item.lastAt} className="ml-auto text-[12.5px] text-ink-3" /> : null}
                </div>
              </li>
            ))}
            {product.moreWork ? (
              <li className="px-5 py-3 text-[13px] text-ink-3">
                {plural(product.moreWork, "more piece")} of work on{" "}
                <Link href={productHref} className="text-accent-text underline-offset-4 hover:underline">
                  {product.name}'s page
                </Link>
                .
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

// No product had approved work in the week (or in the products picked).
export function NothingShared({
  current,
  scope,
  previousHref,
  everyHref,
}: {
  current: boolean;
  // " in billing and shop", or "" for every product.
  scope: string;
  previousHref: string;
  // The same week for every product, when products are picked.
  everyHref: string | null;
}) {
  return (
    <section className="card px-6 py-12 text-center" aria-labelledby="digest-empty">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
        <Newspaper size={17} aria-hidden />
      </span>
      <h2 id="digest-empty" className="mt-4 font-semibold text-[16px]">
        {current ? `Nothing approved${scope} this week yet` : `Nothing approved${scope} that week`}
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
        Session summaries and findings land in the week their authors approve them, under their product. Drafts stay
        with the person who wrote them, so they're never in a digest.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href={previousHref} className="btn btn-sm max-md:min-h-11">
          The week before
        </Link>
        {everyHref ? (
          <Link href={everyHref} className="btn btn-sm max-md:min-h-11">
            Every product
          </Link>
        ) : null}
      </div>
    </section>
  );
}

const lostParts = (item: DigestTimeItem): string =>
  [
    item.failedMs ? `failed ${durationLabel(item.failedMs)}` : null,
    item.rerunMs ? `re-runs ${durationLabel(item.rerunMs)}` : null,
    item.slowMs ? `slow ${durationLabel(item.slowMs)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

export function WeekTime({
  top,
  totalMs,
  commands,
  current,
}: {
  top: DigestTimeItem[];
  totalMs: number;
  commands: number;
  current: boolean;
}) {
  return (
    <section className="card" aria-labelledby="digest-time">
      <header className={HEADER}>
        <h2 id="digest-time" className="flex items-center gap-2 font-semibold text-[15px]">
          <Timer size={16} aria-hidden className="text-ink-3" /> Time lost on tools
        </h2>
        <span className="text-[12.5px] text-ink-3">{current ? "This week so far" : "That week"}</span>
      </header>
      {top.length ? (
        <>
          <p className="px-5 pt-3.5 text-[13px] text-ink-3">
            <span className="font-semibold text-[15px] text-ink tabular-nums">{durationLabel(totalMs)}</span> lost to
            failed runs, re-runs and slow runs
            {commands > top.length ? `, across ${plural(commands, "command")}. The biggest:` : ":"}
          </p>
          <ol className="divide-y divide-line">
            {top.map((item) => (
              <li key={`${item.key}:${item.productId ?? ""}`} className="px-5 py-3">
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
                  {[item.productName, lostParts(item)].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <Quiet>
          No time lost on tools {current ? "so far this week" : "that week"}. Failed runs, re-runs and unusually slow
          runs of shell commands show up here, measured on the tools, never on people.
        </Quiet>
      )}
      <div className="border-line border-t px-3 py-2">
        <Link href="/time" className={FOOT_LINK}>
          Where the time goes <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function GapItem({ gap, resolved }: { gap: DigestGap; resolved: boolean }) {
  const about = [
    gap.productName,
    gap.sessions ? `came up in ${plural(gap.sessions, "session")}` : null,
    gap.asked ? `asked ${gap.asked === 1 ? "once" : `${gap.asked} times`}` : null,
    gap.owner ? `${gap.owner} is on it` : null,
  ].filter(Boolean);
  const answer = gap.resolution?.url ?? null;
  return (
    <li className="px-5 py-3">
      <Link
        href={`/gaps/${encodeURIComponent(gap.id)}`}
        className="line-clamp-3 break-words text-[14px] underline-offset-4 hover:underline"
      >
        {gap.text}
      </Link>
      {about.length ? <p className="mt-1 text-[12.5px] text-ink-3">{about.join(" · ")}</p> : null}
      {resolved && answer ? (
        <a
          href={answer}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex min-h-11 max-w-full items-center gap-1 text-[12.5px] text-accent-text underline-offset-4 hover:underline md:min-h-0"
        >
          <span className="truncate">Answered by {answer.replace(/^https?:\/\//, "")}</span>
          <ArrowUpRight size={12} aria-hidden className="flex-none" />
        </a>
      ) : resolved && gap.resolution?.note ? (
        <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">Answer: {gap.resolution.note}</p>
      ) : null}
    </li>
  );
}

export function WeekGaps({
  opened,
  resolved,
  moreOpened,
  moreResolved,
  current,
}: {
  opened: DigestGap[];
  resolved: DigestGap[];
  moreOpened: number;
  moreResolved: number;
  current: boolean;
}) {
  const more = (n: number) => (n ? <li className="px-5 py-3 text-[13px] text-ink-3">And {n} more.</li> : null);
  return (
    <section className="card" aria-labelledby="digest-gaps">
      <header className={HEADER}>
        <h2 id="digest-gaps" className="flex items-center gap-2 font-semibold text-[15px]">
          <Puzzle size={16} aria-hidden className="text-ink-3" /> Context gaps
        </h2>
        <span className="text-[12.5px] text-ink-3">Opened and resolved</span>
      </header>
      {opened.length ? (
        <section aria-labelledby="digest-gaps-opened">
          <h3 id="digest-gaps-opened" className={SUBHEAD}>
            Opened
          </h3>
          <ol className="divide-y divide-line">
            {opened.map((gap) => (
              <GapItem key={gap.id} gap={gap} resolved={false} />
            ))}
            {more(moreOpened)}
          </ol>
        </section>
      ) : null}
      {resolved.length ? (
        <section aria-labelledby="digest-gaps-resolved">
          <h3 id="digest-gaps-resolved" className={SUBHEAD}>
            Resolved
          </h3>
          <ol className="divide-y divide-line">
            {resolved.map((gap) => (
              <GapItem key={gap.id} gap={gap} resolved />
            ))}
            {more(moreResolved)}
          </ol>
        </section>
      ) : null}
      {!opened.length && !resolved.length ? (
        <Quiet>
          No gap opened or resolved {current ? "so far this week" : "that week"}. A gap opens when an agent or a person
          can't find something they need, and closes when someone links what answers it.
        </Quiet>
      ) : null}
      <div className="border-line border-t px-3 py-2">
        <Link href="/gaps" className={FOOT_LINK}>
          Every open gap <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
