import { ArrowRight, Cable, ChevronDown, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { StatusChip } from "../../components/chips.tsx";
import { FrozenPreview } from "../../components/frozen.tsx";
import { StatusText } from "../../components/relay/status.tsx";
import { Ago } from "../../components/time.tsx";
import { DEFAULT_ORG } from "../../server/api-auth.ts";
import { listHandoffs } from "../../server/handoffs/service.ts";
import { frozen } from "../../server/memory/frozen.ts";
import { overview, recentMemories, recentSessions, waitingOn } from "../../server/stats.ts";
import { requireViewer } from "../../server/viewer.ts";
import { PageHeader } from "./page-header.tsx";
import { requireCaller } from "./relay/caller.ts";

export const metadata: Metadata = { title: "Home" };

const LIVE_MS = 5 * 60 * 1000;

export default async function OverviewPage() {
  const viewer = await requireViewer();
  const caller = await requireCaller();
  const [stats, memories, sessions, inbox, sent] = await Promise.all([
    overview(viewer.userId),
    recentMemories(viewer.userId),
    recentSessions(viewer.userId),
    listHandoffs(caller, "inbox"),
    listHandoffs(caller, "outbox"),
  ]);
  const project = stats.projects[0] ?? null;
  const block = project ? await frozen({ org: DEFAULT_ORG, user: viewer.userId, project }) : [];
  const live = stats.lastSeen ? Date.now() - stats.lastSeen.at.getTime() < LIVE_MS : false;
  const first = viewer.name.split(/\s+/)[0] ?? viewer.name;

  const all = [...inbox, ...sent];
  const waiting = await waitingOn(viewer.userId);
  const sessionDrafts = Math.max(0, waiting - stats.candidates);
  const finished = all.filter((h) => h.status === "completed").slice(0, 4);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // What wants a person, in the order it's blocking someone: work handed to me, my drafts, then review.
  const attention: { key: string; href: string; title: string; hint: string }[] = [
    ...inbox
      .filter((h) => h.status === "approved")
      .map((h) => ({
        key: h._id,
        href: `/relay?id=${h._id}`,
        title: `Pick up “${h.title}”`,
        hint: `Handed to you by ${h.sender.name}`,
      })),
    ...sent
      .filter((h) => h.status === "draft")
      .map((h) => ({
        key: h._id,
        href: `/relay?id=${h._id}`,
        title: `Review and approve “${h.title}”`,
        hint: "A handoff your session drafted. Only you can see it.",
      })),
    ...(stats.candidates
      ? [
          {
            key: "candidates",
            href: "/memories?status=candidate",
            title: `${plural(stats.candidates, "thing")} your agent learned ${stats.candidates === 1 ? "needs" : "need"} review`,
            hint: "Keep it for future sessions, or forget it.",
          },
        ]
      : []),
    ...(sessionDrafts
      ? [
          {
            key: "drafts",
            href: "/my-day",
            title: `${plural(sessionDrafts, "session summary", "session summaries")} to approve`,
            hint: "Drafted when your sessions ended.",
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={`${first}'s workspace`}
        lede={
          <>
            {plural(stats.sessions7d, "session")} this week, {plural(stats.events24h, "event")} captured today, and{" "}
            {plural(stats.active, "memory", "memories")} given to every new session.
          </>
        }
        actions={
          <Link href="/relay" className="btn btn-sm">
            Open handoffs
          </Link>
        }
      />

      {stats.keys === 0 ? (
        <Link
          href="/connect"
          className="panel mb-8 flex flex-wrap items-center gap-4 p-5 transition-shadow hover:shadow-[var(--shadow-lift)]"
        >
          <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent">
            <Cable size={18} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-[15px]">Connect Claude Code</span>
            <span className="block text-[14px] text-ink-2">
              Make an API key, install the plugin, and your next session starts remembering.
            </span>
          </span>
          <ArrowRight size={18} aria-hidden className="text-accent" />
        </Link>
      ) : null}

      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-10">
          <Block title="Needs your attention">
            {attention.length ? (
              <ul className="panel divide-y divide-line overflow-hidden">
                {attention.map((a) => (
                  <li key={a.key}>
                    <Link
                      href={a.href}
                      className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-sunk"
                    >
                      <span className="size-2 flex-none rounded-full bg-accent" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-[15px] text-ink leading-snug">{a.title}</span>
                        <span className="mt-0.5 block text-[13px] text-ink-3">{a.hint}</span>
                      </span>
                      <ArrowRight
                        size={16}
                        aria-hidden
                        className="flex-none text-ink-3 transition-transform group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-3 text-[15px] text-ink-2">
                <CircleCheck size={18} className="flex-none text-verified" aria-hidden />
                Nothing needs you right now.
              </p>
            )}
          </Block>

          <Block title="Recent handoffs" href="/relay" more="All handoffs">
            {all.length ? (
              <ul className="panel divide-y divide-line overflow-hidden">
                {[
                  ...inbox.map((h) => ({ ...h, box: "inbox" as const })),
                  ...sent.map((h) => ({ ...h, box: "sent" as const })),
                ]
                  .slice(0, 4)
                  .map((h) => (
                    <li key={h._id}>
                      <Link href={`/relay?id=${h._id}`} className="block px-5 py-3.5 transition-colors hover:bg-sunk">
                        <span className="block truncate font-medium text-[15px] text-ink">{h.title}</span>
                        <span className="mt-1 flex items-center gap-3 text-[13px] text-ink-3">
                          <StatusText status={h.status} />
                          <span className="min-w-0 truncate">
                            {h.box === "inbox"
                              ? `From ${h.sender.name}`
                              : h.recipient
                                ? `To ${h.recipient.name}`
                                : "Not sent"}
                          </span>
                          <Ago at={h.updatedAt} className="ml-auto flex-none" />
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-[14px] text-ink-3">
                Nothing handed on yet. Run <code className="kbd">/strata:handoff</code> in Claude Code to draft one.
              </p>
            )}
          </Block>

          <Block title="New knowledge" href="/memories" more="Open knowledge">
            {memories.length ? (
              <ul className="grid gap-5">
                {memories.map((m) => (
                  <li key={m._id.toHexString()} className="border-line border-l-2 pl-4">
                    <p className="text-[15px] text-ink leading-relaxed">{m.text}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
                      <StatusChip status={m.status} />
                      <span className="capitalize">{m.kind}</span>
                      <span>{m.scope.project === "*" ? "Every project" : m.scope.project}</span>
                      <Ago at={m.createdAt.toISOString()} />
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-ink-3">
                Nothing learned yet. Memories appear as your sessions tell Claude what to keep.
              </p>
            )}
          </Block>
        </div>

        <div className="flex min-w-0 flex-col gap-10">
          <Block title="Recently finished">
            {finished.length ? (
              <ul className="grid gap-4">
                {finished.map((h) => (
                  <li key={h._id}>
                    <Link href={`/relay?id=${h._id}`} className="group block">
                      <span className="flex items-start gap-2.5">
                        <CircleCheck size={16} className="mt-[3px] flex-none text-verified" aria-hidden />
                        <span className="min-w-0">
                          <span className="block font-medium text-[15px] text-ink leading-snug group-hover:text-accent-text">
                            {h.title}
                          </span>
                          <span className="mt-0.5 block text-[13px] text-ink-3">
                            {h.sender.name} to {h.recipient?.name ?? "no one"}, <Ago at={h.updatedAt} />
                          </span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-ink-3">No handoff has been finished yet.</p>
            )}
          </Block>

          <Block title="Your agent">
            <div className="panel p-5">
              <p className="flex items-center gap-2.5 text-[15px]">
                <span
                  className={`size-2 rounded-full ${live ? "bg-verified" : stats.lastSeen ? "bg-ink-3" : "bg-amber"}`}
                  aria-hidden
                />
                <span className="font-medium text-ink">
                  {live ? "Claude Code is connected" : stats.lastSeen ? "Claude Code is idle" : "Not connected yet"}
                </span>
              </p>
              <p className="mt-1 text-[13px] text-ink-3">
                {stats.lastSeen ? (
                  <>
                    Last seen <Ago at={stats.lastSeen.at.toISOString()} /> with the key “{stats.lastSeen.key}”
                  </>
                ) : stats.keys ? (
                  "You have a key; start a Claude Code session and it shows up here."
                ) : (
                  "No client has connected yet."
                )}
              </p>
              {sessions.length ? (
                <ul className="mt-4 grid gap-2 border-line border-t pt-4">
                  {sessions.slice(0, 3).map((s) => (
                    <li key={s.sessionID} className="flex items-center gap-3 text-[13.5px]">
                      <span className="min-w-0 flex-1 truncate text-ink-2">
                        {s.project}, {plural(s.prompts, "prompt")}
                      </span>
                      <Ago at={new Date(s.last).toISOString()} className="flex-none text-[12.5px] text-ink-3" />
                    </li>
                  ))}
                </ul>
              ) : null}
              <Link href="/connect" className="btn btn-sm mt-4">
                {stats.keys ? "Manage keys" : "Connect Claude Code"}
              </Link>
            </div>
          </Block>

          {project ? (
            <details className="group panel overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-[14.5px] text-ink">What Claude sees at session start</span>
                  <span className="block text-[13px] text-ink-3">The exact memory block for {project}</span>
                </span>
                <ChevronDown
                  size={16}
                  aria-hidden
                  className="flex-none text-ink-3 transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="border-line border-t">
                <FrozenPreview memories={block} project={project} />
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Block({ title, href, more, children }: { title: string; href?: string; more?: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-[17px] text-ink tracking-[-0.02em]">{title}</h2>
        {href ? (
          <Link href={href} className="text-[13px] text-ink-3 underline-offset-4 hover:text-ink hover:underline">
            {more}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}
