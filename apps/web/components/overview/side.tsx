// The overview's side column: open gaps, time lost on tools, the person's own recent sessions, and for an admin, the
// way to people and invitations. Each row leads to the page with the whole of it.
import { ArrowRight, MessagesSquare, Puzzle, ShieldCheck, Timer } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { GapItem, OwnSession, TimeLine } from "../../server/hub/overview.ts";
import { formatLost } from "../../server/hub/time-page.ts";
import { InlineMarkdown } from "../markdown.tsx";
import { sessionHref } from "../sessions/format.ts";
import { Ago } from "../time.tsx";
import { CardHeader, FootLink, plural, ROW_LINK, SideEmpty, times } from "./parts.tsx";

// "a · b · c", for the small print under a row.
function Dotted({ parts }: { parts: ReactNode[] }) {
  const shown = parts.filter(Boolean);
  return (
    <>
      {shown.flatMap((part, i) =>
        i
          ? [
              <span key={`dot${i}`} aria-hidden>
                ·
              </span>,
              part,
            ]
          : [part],
      )}
    </>
  );
}

export function GapList({
  id,
  title,
  gaps,
  open,
  href,
  empty,
}: {
  id: string;
  title: string;
  gaps: GapItem[];
  open: number;
  href: string;
  empty: string;
}) {
  return (
    <section className="card" aria-labelledby={id}>
      <CardHeader
        id={id}
        icon={Puzzle}
        title={title}
        note={open ? `${open.toLocaleString("en-GB")} open` : "None open"}
      />
      {gaps.length ? (
        <>
          <p className="px-5 pt-3 text-[12.5px] text-ink-3">The ones that come back most first.</p>
          <ol className="divide-y divide-line">
            {gaps.map((gap) => (
              <li key={gap.id}>
                <Link href={`/gaps/${gap.id}`} className={ROW_LINK}>
                  <InlineMarkdown links={false} className="line-clamp-3 break-words text-[14px]">
                    {gap.text}
                  </InlineMarkdown>
                  <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-ink-3">
                    <Dotted
                      parts={[
                        gap.productName ? (
                          <span key="p" className="chip">
                            {gap.productName}
                          </span>
                        ) : null,
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
                      ]}
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <SideEmpty>{empty}</SideEmpty>
      )}
      <FootLink href={href}>
        {open > gaps.length ? `All ${open.toLocaleString("en-GB")} open gaps` : "Go to gaps"}
      </FootLink>
    </section>
  );
}

export function TimeCard({
  totalMs,
  commands,
  top,
  days,
}: {
  totalMs: number;
  commands: number;
  top: TimeLine[];
  days: number;
}) {
  return (
    <section className="card" aria-labelledby="time-title">
      <CardHeader id="time-title" icon={Timer} title="Time lost on tools" note={`Last ${days} days`} />
      {top.length ? (
        <>
          <p className="px-5 pt-3.5 text-[13px] text-ink-3">
            <span className="font-semibold text-[22px] text-ink tabular-nums tracking-[-0.02em]">
              {formatLost(totalMs)}
            </span>{" "}
            lost to failed runs, re-runs and slow runs, across {plural(commands, "command")}. The biggest:
          </p>
          <ol className="mt-1 divide-y divide-line">
            {top.map((item) => (
              <li key={item.anchor}>
                <Link href={`/time#${item.anchor}`} className={ROW_LINK}>
                  <span className="flex items-baseline gap-2">
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="chip chip-mono">{item.class}</span>
                      <span className="truncate font-medium text-[14px]">{item.productName ?? "No product"}</span>
                    </span>
                    <span className="flex-none font-semibold text-[14px] tabular-nums">
                      {formatLost(item.lostMs)}
                      <span className="sr-only"> lost</span>
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">
                    <span className="font-mono" title={`Fingerprint ${item.fp}`}>
                      {item.fp.slice(0, 8)}
                    </span>{" "}
                    in <span className="font-mono">{item.repo}</span> · {plural(item.runs, "run")}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <SideEmpty>
          No time lost in the last {days} days. Connected sessions report how long their tests, builds and other
          commands take, never the commands themselves; failed runs, re-runs and unusually slow runs add up here.
        </SideEmpty>
      )}
      <FootLink href="/time">Where the time goes</FootLink>
    </section>
  );
}

export function OwnSessions({ sessions }: { sessions: OwnSession[] }) {
  return (
    <section className="card" aria-labelledby="own-sessions-title">
      <CardHeader
        id="own-sessions-title"
        icon={MessagesSquare}
        title="Your recent sessions"
        note="Only you see this list"
      />
      {sessions.length ? (
        <ul className="divide-y divide-line">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link href={sessionHref(s.id)} className={`${ROW_LINK} flex items-center gap-3`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[14px]">{s.project}</span>
                  <span className="block truncate font-mono text-[12px] text-ink-3">
                    {s.id.slice(0, 8)} · {plural(s.prompts, "prompt")}
                  </span>
                </span>
                {s.shared ? <span className="chip status-active flex-none">Shared</span> : null}
                <Ago at={s.last} className="flex-none text-[12.5px] text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <SideEmpty>
          Your Claude Code sessions show here once a connected one sends its first event, each linked to its page with
          its summary and findings.
        </SideEmpty>
      )}
    </section>
  );
}

export function AdminCard() {
  return (
    <Link
      href="/admin"
      className="card flex min-h-11 items-center gap-3 p-4 transition-colors hover:border-line-strong"
    >
      <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-accent-soft text-accent-text">
        <ShieldCheck size={17} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[14px]">People and invitations</span>
        <span className="block text-[13px] text-ink-3">Invite people, set roles and teams, suspend access.</span>
      </span>
      <ArrowRight size={16} aria-hidden className="flex-none text-accent-text" />
    </Link>
  );
}
