import type { Metadata } from "next";
import Link from "next/link";
import { KindChip } from "../../../components/chips.tsx";
import { Ago } from "../../../components/time.tsx";
import type { RecordDoc } from "../../../server/collections.ts";
import { listApprovedSince, listDrafts, recordLabel } from "../../../server/records.ts";
import { listCandidates } from "../../../server/stats.ts";
import { requirePluginUser } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";
import { Candidate, Draft } from "./decide.tsx";

export const metadata: Metadata = { title: "My Day" };

const DAY = 24 * 60 * 60 * 1000;
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// A session's drafts together: its summary first, then what the agent logged along the way.
function bySession(drafts: RecordDoc[]) {
  const sessions = new Map<string, RecordDoc[]>();
  for (const d of drafts) sessions.set(d.sessionID, [...(sessions.get(d.sessionID) ?? []), d]);
  return [...sessions.entries()]
    .map(([sessionID, items]) => ({
      sessionID,
      project: items[0]?.scope.project ?? "",
      latest: new Date(Math.max(...items.map((i) => i.createdAt.getTime()))),
      items: items.sort((a, b) => (a.kind === "summary" ? -1 : b.kind === "summary" ? 1 : 0)),
      refs: [...new Map(items.flatMap((i) => i.refs).map((r) => [`${r.type}:${r.id}`, r])).values()],
    }))
    .sort((a, b) => b.latest.getTime() - a.latest.getTime());
}

export default async function MyDayPage() {
  const viewer = await requirePluginUser();
  const [drafts, candidates, shared] = await Promise.all([
    listDrafts(viewer.userId),
    listCandidates(viewer.userId),
    listApprovedSince(viewer.userId, new Date(Date.now() - DAY)),
  ]);
  const sessions = bySession(drafts);

  return (
    <>
      <PageHeader
        eyebrow="My Day"
        title={drafts.length || candidates.length ? "What's waiting for you" : "You're all caught up"}
        lede="What your sessions drafted. Nobody else can see a draft: approving one shares it with everyone in your organisation, and discarding it sets it aside in your audit log."
      />

      <section aria-labelledby="drafts-title" className="mb-8">
        <h2 id="drafts-title" className="mb-3 font-semibold text-[16px]">
          Drafts to approve <span className="font-normal text-ink-3">· {drafts.length}</span>
        </h2>
        {sessions.length ? (
          <ol className="flex flex-col gap-4">
            {sessions.map((s) => (
              <li key={s.sessionID} className="card">
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-line border-b px-5 py-3">
                  <span className="font-medium text-[14px]">Session</span>
                  <span className="chip chip-mono" title={s.sessionID}>
                    {s.sessionID.slice(0, 8)}
                  </span>
                  {s.project ? <span className="chip chip-mono">{s.project}</span> : null}
                  {s.refs.map((r) => (
                    <span key={`${r.type}:${r.id}`} className="chip chip-mono" title={r.type}>
                      {r.id}
                    </span>
                  ))}
                  <Ago at={s.latest.toISOString()} className="ml-auto text-[12.5px] text-ink-3" />
                </header>
                <ul className="divide-y divide-line">
                  {s.items.map((d) => (
                    <li key={d._id.toHexString()} className="px-5 py-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`chip ${d.kind === "summary" ? "status-active" : ""}`}>
                          {recordLabel(d.kind)}
                        </span>
                        {d.edited ? <span className="text-[12.5px] text-ink-3">edited by you</span> : null}
                      </div>
                      <Draft id={d._id.toHexString()} text={d.text} label={recordLabel(d.kind)} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ) : (
          <div className="card px-6 py-10 text-center">
            <p className="font-semibold text-[15px]">No drafts waiting</p>
            <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
              When a session ends, its summary lands here, with any insight, workflow finding, pain point or context gap
              the agent logged along the way.
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="candidates-title" className="mb-8">
        <h2 id="candidates-title" className="font-semibold text-[16px]">
          Memories to keep <span className="font-normal text-ink-3">· {candidates.length}</span>
        </h2>
        <p className="mt-0.5 mb-3 text-[13.5px] text-ink-3">
          Things your sessions suggested remembering. Kept ones go to your agents; they stay yours alone. To forget one
          entirely, use{" "}
          <Link href="/memories" className="text-accent-text underline-offset-4 hover:underline">
            Memories
          </Link>
          .
        </p>
        {candidates.length ? (
          <ul className="card divide-y divide-line">
            {candidates.map((m) => (
              <li key={m._id.toHexString()} className="flex flex-wrap items-start gap-3 px-5 py-4">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="whitespace-pre-wrap break-words text-[14.5px]">{m.text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                    <KindChip kind={m.kind} />
                    <span className="chip chip-mono">
                      {m.scope.project === "*" ? "every project" : m.scope.project}
                    </span>
                    <span>from the {m.provenance.source === "assistant" ? "agent's reply" : m.provenance.source}</span>
                    <span aria-hidden>·</span>
                    <Ago at={m.createdAt.toISOString()} />
                  </div>
                </div>
                <Candidate id={m._id.toHexString()} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="card px-5 py-4 text-[14px] text-ink-3">None waiting.</p>
        )}
      </section>

      {shared.length ? (
        <section aria-labelledby="shared-title">
          <h2 id="shared-title" className="mb-3 font-semibold text-[16px]">
            You shared in the last day <span className="font-normal text-ink-3">· {n(shared.length, "record")}</span>
          </h2>
          <ul className="card divide-y divide-line">
            {shared.map((r) => (
              <li key={r._id.toHexString()} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                <span className="chip flex-none">{recordLabel(r.kind)}</span>
                <p className="line-clamp-2 min-w-0 flex-1 basis-64 break-words text-[14px] text-ink-2">{r.text}</p>
                {r.approvedAt ? (
                  <Ago at={r.approvedAt.toISOString()} className="flex-none text-[12.5px] text-ink-3" />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
