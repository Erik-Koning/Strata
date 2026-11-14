// What's new on a product's page: the last weeks' approved sessions, newest first, each with its summary, the
// findings shared alongside it, its tickets and pull requests, and a link to the session.
import { Sparkles } from "lucide-react";
import type { WeekView } from "../../server/hub/product-page.ts";
import { Ago } from "../time.tsx";
import { RefChips, SessionLink } from "./refs.tsx";

export function WhatsNew({ weeks, sinceWeeks }: { weeks: WeekView[]; sinceWeeks: number }) {
  return (
    <section className="card" aria-labelledby="whats-new-title">
      <header className="flex flex-wrap items-center justify-between gap-2 border-line border-b px-5 py-3.5">
        <h2 id="whats-new-title" className="font-semibold text-[15px]">
          What's new
        </h2>
        <span className="text-[12.5px] text-ink-3">Approved work, last {sinceWeeks} weeks</span>
      </header>
      {weeks.length ? (
        weeks.map((week) => (
          <section key={week.weekStart} aria-labelledby={`week-${week.weekStart.slice(0, 10)}`}>
            <h3
              id={`week-${week.weekStart.slice(0, 10)}`}
              className="eyebrow border-line border-b bg-surface-2 px-5 py-2 [section+section>&]:border-t"
            >
              {week.label}
            </h3>
            <ul className="divide-y divide-line">
              {week.sessions.map((session) => (
                <li key={session.sessionId} className="px-5 py-4">
                  {session.summary ? (
                    <>
                      {session.summary.title ? (
                        <p className="font-medium text-[15px] leading-snug">{session.summary.title}</p>
                      ) : null}
                      <p className="mt-1 whitespace-pre-wrap break-words text-[14px] text-ink-2">
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
                    <Ago at={session.at} className="ml-auto text-[12.5px] text-ink-3" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <div className="px-6 py-12 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
            <Sparkles size={17} aria-hidden />
          </span>
          <p className="mt-4 font-semibold text-[15px]">Nothing shared in the last {sinceWeeks} weeks</p>
          <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
            When someone approves a session summary or a finding from this product's repositories, it shows up here,
            under the week it was shared.
          </p>
        </div>
      )}
    </section>
  );
}
