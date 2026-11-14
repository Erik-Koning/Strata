import { ArrowRight, Cable } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KindChip, StatusChip } from "../../components/chips.tsx";
import { FrozenPreview } from "../../components/frozen.tsx";
import { StatusText } from "../../components/relay/status.tsx";
import { Ago } from "../../components/time.tsx";
import { DEFAULT_ORG } from "../../server/api-auth.ts";
import { listHandoffs } from "../../server/handoffs/service.ts";
import { frozen } from "../../server/memory/frozen.ts";
import { overview, recentMemories, recentSessions } from "../../server/stats.ts";
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
  // Handed to me first, then mine, newest first within each: the four that most want a look.
  const handoffs = [
    ...inbox.map((h) => ({ ...h, box: "inbox" as const })),
    ...sent.map((h) => ({ ...h, box: "sent" as const })),
  ].slice(0, 4);
  const project = stats.projects[0] ?? null;
  const block = project ? await frozen({ org: DEFAULT_ORG, user: viewer.userId, project }) : [];
  const live = stats.lastSeen ? Date.now() - stats.lastSeen.at.getTime() < LIVE_MS : false;
  const first = viewer.name.split(/\s+/)[0] ?? viewer.name;

  const all = [...inbox, ...sent];
  const moving = all.filter((h) => h.status === "approved" || h.status === "claimed").length;
  const finished = all.filter((h) => h.status === "completed").length;
  // The product's story in four plain numbers, each a door to where you act on it.
  const tiles = [
    { label: "Handoffs in motion", value: moving, hint: "handed on, not finished yet", href: "/relay" },
    {
      label: "Waiting for your review",
      value: stats.candidates,
      hint: "things your agent learned",
      href: "/memories?status=candidate",
    },
    { label: "Finished handoffs", value: finished, hint: "picked up and completed", href: "/relay" },
    { label: "Remembered", value: stats.active, hint: "given to every new session", href: "/memories" },
  ];

  return (
    <>
      <PageHeader
        title={`${first}'s work, remembered`}
        lede="What's being handed on, what your agents learned, and what they'll know next session."
      />

      {stats.keys === 0 ? (
        <Link
          href="/connect"
          className="card mb-6 flex flex-wrap items-center gap-4 border-accent/30 bg-accent-soft p-5 transition-transform hover:-translate-y-px"
        >
          <span className="grid size-11 place-items-center rounded-[12px] bg-accent text-accent-ink">
            <Cable size={20} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-[16px]">Connect Claude Code</span>
            <span className="block text-[14px] text-ink-2">
              Make an API key, install the plugin, and your next session starts remembering.
            </span>
          </span>
          <ArrowRight size={18} aria-hidden className="text-accent-text" />
        </Link>
      ) : null}

      <section aria-label="At a glance" className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(({ label, value, hint, href }) => {
          const body = (
            <>
              <span className="block font-semibold text-[34px] text-ink tabular-nums leading-none tracking-[-0.04em]">
                {value.toLocaleString()}
              </span>
              <span className="mt-3 block font-medium text-[14px] text-ink">{label}</span>
              <span className="mt-0.5 block text-[12.5px] text-ink-3">{hint}</span>
            </>
          );
          const cls = "block rounded-[14px] bg-surface px-5 py-5 shadow-[var(--shadow)]";
          return href ? (
            <Link key={label} href={href} className={`${cls} transition-shadow hover:shadow-[var(--shadow-lift)]`}>
              {body}
            </Link>
          ) : (
            <div key={label} className={cls}>
              {body}
            </div>
          );
        })}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {project ? (
            <FrozenPreview memories={block} project={project} />
          ) : (
            <section className="card p-6">
              <h2 className="font-semibold text-[15px]">What Claude sees at the start of a session</h2>
              <p className="mt-1.5 text-[14px] text-ink-3">
                Nothing yet. Once a connected session tells Claude something worth keeping (“we always use pnpm here”),
                it's remembered and shown here exactly as the next session receives it.
              </p>
            </section>
          )}

          <section className="card" aria-labelledby="recent-title">
            <header className="flex items-center justify-between border-line border-b px-5 py-3.5">
              <h2 id="recent-title" className="font-semibold text-[15px]">
                Recently learned
              </h2>
              <Link href="/memories" className="btn btn-quiet btn-sm">
                All memories <ArrowRight size={14} aria-hidden />
              </Link>
            </header>
            {memories.length ? (
              <ul className="divide-y divide-line">
                {memories.map((m) => (
                  <li key={m._id.toHexString()} className="px-5 py-3.5">
                    <p className="text-[14.5px]">{m.text}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusChip status={m.status} />
                      <KindChip kind={m.kind} />
                      <span className="chip chip-mono">{m.scope.project}</span>
                      <Ago at={m.createdAt.toISOString()} className="ml-auto text-[12.5px] text-ink-3" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-[14px] text-ink-3">
                No memories yet. They appear as your sessions tell Claude what to keep, or when you add one.
              </p>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section className="card" aria-labelledby="relay-title">
            <header className="flex items-center justify-between border-line border-b px-5 py-3.5">
              <h2 id="relay-title" className="font-semibold text-[15px]">
                Handoffs
              </h2>
              <Link href="/relay" className="btn btn-quiet btn-sm">
                Relay <ArrowRight size={14} aria-hidden />
              </Link>
            </header>
            {handoffs.length ? (
              <ul className="divide-y divide-line">
                {handoffs.map((h) => (
                  <li key={h._id}>
                    <Link href={`/relay?id=${h._id}`} className="block px-5 py-3 transition-colors hover:bg-surface-2">
                      <span className="block truncate font-medium text-[14px]">{h.title}</span>
                      <span className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                        <StatusText status={h.status} />
                        <span className="min-w-0 truncate">
                          {h.box === "inbox"
                            ? `from ${h.sender.name}`
                            : h.recipient
                              ? `to ${h.recipient.name}`
                              : "not sent"}
                        </span>
                        <Ago at={h.updatedAt} className="ml-auto flex-none" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-[14px] text-ink-3">
                Nothing handed on yet. <code className="kbd">/strata:handoff</code> drafts one from a session.
              </p>
            )}
          </section>

          <section className="card p-5" aria-labelledby="conn-title">
            <div className="flex items-center justify-between">
              <h2 id="conn-title" className="font-semibold text-[15px]">
                Claude Code
              </h2>
              <span className={`chip ${live ? "status-active" : stats.lastSeen ? "" : "status-candidate"}`}>
                <span className={`dot ${live ? "" : "dot-hollow"}`} aria-hidden />
                {live ? "Connected" : stats.lastSeen ? "Idle" : "Not connected yet"}
              </span>
            </div>
            {stats.lastSeen ? (
              <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px]">
                <dt className="text-ink-3">Last seen</dt>
                <dd>
                  <Ago at={stats.lastSeen.at.toISOString()} />
                </dd>
                <dt className="text-ink-3">Key</dt>
                <dd className="truncate">{stats.lastSeen.key}</dd>
                <dt className="text-ink-3">Client</dt>
                <dd className="truncate font-mono text-[13px]">{stats.lastSeen.client ?? "unknown"}</dd>
              </dl>
            ) : (
              <p className="mt-3 text-[14px] text-ink-3">
                {stats.keys
                  ? "You have a key; start a Claude Code session and it shows up here."
                  : "No client has connected yet."}
              </p>
            )}
            <Link href="/connect" className="btn btn-sm mt-4">
              {stats.keys ? "Manage keys" : "Connect Claude Code"}
            </Link>
          </section>

          <section className="card" aria-labelledby="sessions-title">
            <header className="border-line border-b px-5 py-3.5">
              <h2 id="sessions-title" className="font-semibold text-[15px]">
                Recent sessions
              </h2>
            </header>
            {sessions.length ? (
              <ul className="divide-y divide-line">
                {sessions.map((s) => (
                  <li key={s.sessionID} className="flex items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[14px]">{s.project}</span>
                      <span className="block truncate font-mono text-[12px] text-ink-3">
                        {s.sessionID.slice(0, 8)} · {s.prompts} prompts · {s.events} events
                      </span>
                    </span>
                    <Ago at={new Date(s.last).toISOString()} className="text-[12.5px] text-ink-3" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-[14px] text-ink-3">
                Sessions appear here once a connected client sends its first event.
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
