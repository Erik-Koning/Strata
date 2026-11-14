// Pieces the team pages share: how a record, a person and a stretch of time are shown.
import Link from "next/link";
import type { ReactNode } from "react";
import { Ago } from "../../components/time.tsx";
import type { Person, TeamRecord, TeamRecordKind } from "../../server/hub/team-records.ts";

export const KIND_LABEL: Record<TeamRecordKind, string> = {
  summary: "Summary",
  decision: "Decision",
  insight: "Insight",
  workflow: "Workflow note",
  pain_point: "Pain point",
  context_gap: "Context gap",
  open: "Open question",
};

export const hours = (h: number): string => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h`);

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = s / 60;
  return m < 60 ? `${Math.round(m)} min` : hours(m / 60);
}

export const shortRepo = (repo: string): string => repo.split("/").slice(-2).join("/") || repo;

export function People({ people }: { people: Person[] }) {
  if (!people.length) return <span className="text-ink-3">someone</span>;
  return <>{people.map((p) => p.name).join(", ")}</>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card px-6 py-10 text-center">
      <h3 className="font-semibold text-[15px]">{title}</h3>
      {children ? <p className="mx-auto mt-1.5 max-w-md text-[13.5px] text-ink-3">{children}</p> : null}
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-[16px]">{title}</h2>
        {hint ? <span className="text-[12.5px] text-ink-3">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

// One approved record: its kind, its words, who shared it and when. The session it came from is a click away.
export function RecordRow({ record, showSession = true }: { record: TeamRecord; showSession?: boolean }) {
  return (
    <li className="px-5 py-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className={`chip ${record.kind === "summary" ? "status-active" : ""}`}>{KIND_LABEL[record.kind]}</span>
        {record.status === "draft" ? <span className="chip">Your draft</span> : null}
        {record.refs.map((r) => (
          <span key={`${r.type}:${r.id}`} className="chip chip-mono">
            {r.id}
          </span>
        ))}
        <span className="ml-auto text-[12.5px] text-ink-3">
          {record.author ? `${record.author.name} · ` : ""}
          <Ago at={record.at.toISOString()} />
        </span>
      </div>
      {record.title ? <p className="font-medium text-[15px]">{record.title}</p> : null}
      <p className="text-[14px] text-ink-2">{record.text}</p>
      {showSession ? (
        <Link
          href={`/sessions/${encodeURIComponent(record.sessionId)}`}
          className="mt-1.5 inline-block text-[12.5px] text-accent-text hover:underline"
        >
          Open session {record.sessionId.slice(0, 8)}
        </Link>
      ) : null}
    </li>
  );
}
