import { FolderGit2, GitBranch, Lightbulb, Lock, Terminal, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Ago } from "../../../components/time.tsx";
import { pulse } from "../../../server/intelligence/pulse.ts";
import type { Pulse, SourceCard } from "../../../server/intelligence/types.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";
import { AskStrata } from "./ask-strata.tsx";
import { EvidenceProvider, RecordButton } from "./evidence.tsx";
import { CategoryTag, shortRef } from "./labels.tsx";

export const metadata: Metadata = { title: "Intelligence" };
export const dynamic = "force-dynamic";

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : null);

// Questions to start from, named after what's actually in the person's records.
function suggestionsFor(p: Pulse): string[] {
  const name = (project: string) => project.split("/").pop() ?? project;
  const friction = p.projects.find((r) => r.openFriction > 0);
  const top = p.projects[0];
  const out = [
    friction ? `What's blocking ${name(friction.project)}?` : "What's blocking us?",
    "What did I discover this week?",
    "What changed recently?",
    "Why did we choose this approach?",
    "What work is still unfinished?",
    top ? `How do I get ${name(top.project)} running?` : "How do I get this service running?",
  ];
  return [...new Set(out)];
}

export default async function IntelligencePage() {
  const viewer = await requireViewer();
  const p = await pulse(viewer.userId);
  const f = p.totals.findings;
  const records = p.totals.activeMemories + p.totals.summaries + f.insight + f.workflow + f.pain_point + f.context_gap;
  const coverage = pct(p.coverage.withEither, p.coverage.sessions);
  const maxDay = Math.max(1, ...p.days.map((d) => d.events));
  const totalKinds = p.kinds.reduce((n, k) => n + k.count, 0);

  return (
    <EvidenceProvider>
      <PageHeader
        eyebrow="Intelligence"
        title="Product pulse"
        lede="What's happening across your engineering work, counted from what Strata has stored and answered from its records. Every number and every answer traces back to a source."
        actions={
          <span className="chip chip-mono" title="Counted when this page loaded">
            <span className="size-1.5 flex-none rounded-full bg-accent" aria-hidden /> live from MongoDB ·{" "}
            <Ago at={p.generatedAt} />
          </span>
        }
      />

      <section
        aria-label="Pulse metrics"
        className="card mb-4 grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x [&>*]:border-line max-lg:[&>*]:border-b"
      >
        <Metric
          label="Active memories"
          value={p.totals.activeMemories}
          hint={`${p.totals.candidates} awaiting review`}
          href="/memories"
        />
        <Metric label="Sessions" value={p.totals.sessions7d} hint={`last 7 days · ${p.totals.sessions30d} in 30`} />
        <Metric
          label="Knowledge coverage"
          value={coverage === null ? "—" : `${coverage}%`}
          hint={
            p.coverage.sessions
              ? `${p.coverage.withEither} of ${p.coverage.sessions} sessions left a record`
              : "no sessions in 30 days"
          }
        />
        <Metric
          label="Open friction"
          value={f.pain_point + f.context_gap}
          hint={`${f.pain_point} pain · ${f.context_gap} gaps · drafts`}
          tone={f.pain_point + f.context_gap ? "warn" : undefined}
        />
        <Metric
          label="Discoveries"
          value={f.insight + f.workflow}
          hint={`${f.insight} insights · ${f.workflow} workflow`}
        />
        <Metric label="Summaries" value={p.totals.summaries} hint={`${p.totals.projects} projects tracked`} />
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="card p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold text-[14px]">Engineering activity</h2>
            <span className="text-[12px] text-ink-3">captured events per day · 14 days · UTC</span>
          </div>
          <div
            className="mt-4 flex h-24 items-end gap-[3px]"
            role="img"
            aria-label={`Events per day for 14 days: ${p.days.map((d) => `${d.day} ${d.events}`).join(", ")}`}
          >
            {p.days.map((d) => (
              <div
                key={d.day}
                className="group relative flex h-full flex-1 flex-col justify-end"
                title={`${d.day}: ${d.events} events, ${d.memories} memories, ${d.findings} findings`}
              >
                <div
                  className={`w-full rounded-t-[3px] ${d.events ? "bg-accent/70 group-hover:bg-accent" : "bg-line"}`}
                  style={{ height: `${d.events ? Math.max(6, (d.events / maxDay) * 100) : 3}%` }}
                />
                {d.memories || d.findings ? (
                  <span
                    className="absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-amber"
                    aria-hidden
                  />
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10.5px] text-ink-3">
            <span>{p.days[0]?.day.slice(5)}</span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-amber" aria-hidden /> a memory or finding was recorded
            </span>
            <span>{p.days.at(-1)?.day.slice(5)}</span>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold text-[14px]">Knowledge mix</h2>
            <span className="text-[12px] text-ink-3">active memories by kind</span>
          </div>
          {totalKinds ? (
            <>
              <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                {p.kinds.map((k, i) => (
                  <div
                    key={k.kind}
                    className="h-full"
                    style={{
                      width: `${(k.count / totalKinds) * 100}%`,
                      background: `color-mix(in srgb, var(--accent) ${100 - i * 17}%, var(--surface-2))`,
                    }}
                  />
                ))}
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                {p.kinds.map((k, i) => (
                  <li key={k.kind} className="flex items-center gap-2">
                    <span
                      className="size-2 rounded-[2px]"
                      style={{ background: `color-mix(in srgb, var(--accent) ${100 - i * 17}%, var(--surface-2))` }}
                      aria-hidden
                    />
                    <span className="capitalize text-ink-2">{k.kind}</span>
                    <span className="ml-auto font-mono text-[12px] tabular-nums">{k.count}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-[13px] text-ink-3">No active memories yet.</p>
          )}
        </div>
      </section>

      <div className="mb-6">
        <AskStrata suggestions={suggestionsFor(p)} records={records} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <RecordList
          title="Blockers and context gaps"
          icon={<TriangleAlert size={15} aria-hidden className="text-danger" />}
          note="Logged by your agent as pain points or context gaps. Shell failures are never counted as blockers."
          cards={p.friction}
          empty="No pain points or context gaps logged. They appear when an agent records one with record_finding."
        />
        <RecordList
          title="Recent discoveries"
          icon={<Lightbulb size={15} aria-hidden className="text-accent" />}
          note="Insights and workflow notes your agent logged while it worked."
          cards={p.discoveries}
          empty="No insights or workflow notes logged yet."
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <RecordList
          title="Recently updated context"
          note="Active memories and session summaries, newest first."
          cards={p.recent}
          empty="Nothing remembered yet."
          showDate
        />
        <div className="flex min-w-0 flex-col gap-4">
          <section className="card" aria-labelledby="signals-title">
            <header className="flex items-center gap-2 border-line border-b px-5 py-3">
              <Terminal size={15} aria-hidden className="text-ink-3" />
              <h2 id="signals-title" className="font-semibold text-[14px]">
                Command signals
              </h2>
              <span className="ml-auto text-[12px] text-ink-3">7 days</span>
            </header>
            {p.signals.length ? (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11.5px] text-ink-3">
                    <th className="px-5 pt-2.5 pb-1 font-medium">Class</th>
                    <th className="px-2 pt-2.5 pb-1 text-right font-medium">Runs</th>
                    <th className="px-5 pt-2.5 pb-1 text-right font-medium">Non-zero exit</th>
                  </tr>
                </thead>
                <tbody>
                  {p.signals.map((s) => (
                    <tr key={s.class} className="border-line border-t">
                      <td className="px-5 py-1.5 font-mono text-[12px]">{s.class}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.runs}</td>
                      <td className="px-5 py-1.5 text-right tabular-nums text-ink-2">{s.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-5 py-4 text-[13px] text-ink-3">No shell commands captured in the last 7 days.</p>
            )}
            <p className="border-line border-t px-5 py-2.5 text-[12px] text-ink-3">
              Signals only: kind and exit code, never the command. A failed run isn't a blocker.
            </p>
          </section>
          <section className="card" aria-labelledby="unknown-title">
            <header className="flex items-center gap-2 border-line border-b px-5 py-3">
              <Lock size={14} aria-hidden className="text-ink-3" />
              <h2 id="unknown-title" className="font-semibold text-[14px]">
                Not available
              </h2>
            </header>
            <ul className="divide-y divide-line">
              {p.unavailable.map((u) => (
                <li key={u.what} className="px-5 py-2.5">
                  <p className="font-medium text-[13px]">{u.what}</p>
                  <p className="text-[12.5px] text-ink-3">{u.why}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <section className="card overflow-hidden" aria-labelledby="projects-title">
        <header className="flex flex-wrap items-baseline gap-2 border-line border-b px-5 py-3">
          <h2 id="projects-title" className="font-semibold text-[14px]">
            Projects
          </h2>
          <span className="text-[12px] text-ink-3">
            sessions in the last 30 days · repository and branch as last reported
          </span>
        </header>
        {p.projects.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] text-ink-3">
                  <th className="px-5 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Where</th>
                  <th className="px-3 py-2 text-right font-medium">Memories</th>
                  <th className="px-3 py-2 text-right font-medium">Findings</th>
                  <th className="px-3 py-2 text-right font-medium">Friction</th>
                  <th className="px-3 py-2 text-right font-medium">Sessions</th>
                  <th className="px-5 py-2 text-right font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {p.projects.map((r) => (
                  <tr key={r.project} className="border-line border-t align-top">
                    <td className="px-5 py-2.5">
                      <Link
                        href={`/memories?project=${encodeURIComponent(r.project)}`}
                        className="font-medium font-mono text-[12.5px] hover:text-accent-text"
                      >
                        {r.project}
                      </Link>
                      {r.refs.length ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {r.refs.map((t) => (
                            <span key={t} className="chip chip-mono min-h-5 px-1.5 text-[10.5px]">
                              {t}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-ink-2">
                      {r.repo ? (
                        <span className="flex items-center gap-1.5 font-mono text-[11.5px]">
                          <FolderGit2 size={12} aria-hidden className="text-ink-3" /> {r.repo}
                        </span>
                      ) : (
                        <span className="text-ink-3">unknown</span>
                      )}
                      {r.branch ? (
                        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[11.5px] text-ink-3">
                          <GitBranch size={12} aria-hidden /> {r.branch}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.memories}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.findings}</td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${r.openFriction ? "text-danger" : "text-ink-3"}`}
                    >
                      {r.openFriction}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.sessions}</td>
                    <td className="px-5 py-2.5 text-right text-ink-3">
                      {r.lastActivity ? <Ago at={r.lastActivity} /> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-6 text-[13px] text-ink-3">
            No projects yet. A project appears once a connected session captures its first event.{" "}
            <Link href="/connect" className="text-accent-text underline-offset-2 hover:underline">
              Connect Claude Code
            </Link>
          </p>
        )}
      </section>
    </EvidenceProvider>
  );
}

function Metric({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: number | string;
  hint: string;
  href?: string;
  tone?: "warn";
}) {
  const body = (
    <>
      <span className="block font-medium text-[12px] text-ink-3">{label}</span>
      <span
        className={`mt-1.5 block font-semibold text-[26px] tabular-nums leading-none tracking-[-0.03em] ${tone === "warn" ? "text-danger" : ""}`}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="mt-1.5 block truncate text-[11.5px] text-ink-3">{hint}</span>
    </>
  );
  return href ? (
    <Link href={href} className="min-w-0 px-4 py-3.5 transition-colors hover:bg-surface-2/60">
      {body}
    </Link>
  ) : (
    <div className="min-w-0 px-4 py-3.5">{body}</div>
  );
}

function RecordList({
  title,
  icon,
  note,
  cards,
  empty,
  showDate = false,
}: {
  title: string;
  icon?: ReactNode;
  note: string;
  cards: SourceCard[];
  empty: string;
  showDate?: boolean;
}) {
  return (
    <section className="card flex min-w-0 flex-col overflow-hidden" aria-label={title}>
      <header className="border-line border-b px-5 py-3">
        <h2 className="flex items-center gap-2 font-semibold text-[14px]">
          {icon}
          {title}
          <span className="ml-auto font-mono font-normal text-[11.5px] text-ink-3">{cards.length || ""}</span>
        </h2>
        <p className="text-[12px] text-ink-3">{note}</p>
      </header>
      {cards.length ? (
        <ul className="divide-y divide-line">
          {cards.map((c) => (
            <li key={c.ref}>
              <RecordButton card={c} className="px-5 py-3">
                <span className="line-clamp-2 block text-[13.5px] leading-snug">{c.text}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <CategoryTag card={c} small />
                  <span className="chip chip-mono min-h-5 px-1.5 text-[10.5px]">
                    {c.project === "*" ? "every project" : c.project}
                  </span>
                  <span className="ml-auto flex items-center gap-2 text-[11.5px] text-ink-3">
                    {showDate ? <Ago at={c.updatedAt} /> : <Ago at={c.createdAt} />}
                    <span className="font-mono opacity-0 transition-opacity group-hover:opacity-100">
                      {shortRef(c.ref)}
                    </span>
                  </span>
                </span>
              </RecordButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-[13px] text-ink-3">{empty}</p>
      )}
    </section>
  );
}
