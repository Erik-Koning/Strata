import {
  Boxes,
  CircleHelp,
  FileCode2,
  GitBranch,
  Lightbulb,
  Link2,
  NotebookPen,
  SearchX,
  TerminalSquare,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { RelatedPanel } from "../../../../components/graph/related.tsx";
import { FindingGroup, type FindingItem } from "../../../../components/sessions/findings.tsx";
import { repoUrl, sessionIdFrom } from "../../../../components/sessions/format.ts";
import { SessionLinks } from "../../../../components/sessions/session-links.tsx";
import { ToolTime } from "../../../../components/sessions/tool-time.tsx";
import { Ago } from "../../../../components/time.tsx";
import { getProduct } from "../../../../server/hub/products.ts";
import { sessionDetail, type TeamRecord, type TeamRecordKind } from "../../../../server/hub/team-records.ts";
import { recordLabel } from "../../../../server/records/routes.ts";
import { requireViewer } from "../../../../server/viewer.ts";
import { PageHeader } from "../../page-header.tsx";

// One session, as everyone in the organisation sees it once its author approved its work: the summary, what it found,
// what it linked, where it worked. Its author also sees their drafts and the session's tool time; nobody else does
// (sessionDetail returns them only to the author).

const load = cache(async (rawId: string, viewerId: string) => sessionDetail(sessionIdFrom(rawId), viewerId));

export async function generateMetadata({ params }: PageProps<"/sessions/[id]">): Promise<Metadata> {
  const viewer = await requireViewer();
  const detail = await load((await params).id, viewer.userId);
  return { title: detail?.title ?? "Session" };
}

// The findings a session can share, in the order the page shows them. Summaries and decisions go in the summary.
const GROUPS: { kind: TeamRecordKind; title: string; icon: typeof Lightbulb }[] = [
  { kind: "insight", title: "Insights", icon: Lightbulb },
  { kind: "workflow", title: "Workflow findings", icon: Workflow },
  { kind: "pain_point", title: "Pain points", icon: TriangleAlert },
  { kind: "context_gap", title: "Context gaps", icon: SearchX },
  { kind: "open", title: "Open questions", icon: CircleHelp },
];

const item = (r: TeamRecord): FindingItem => ({
  id: r.id,
  title: r.title,
  text: r.text,
  at: r.at.toISOString(),
  source: r.source,
});

const draftLabel = (kind: TeamRecordKind) =>
  kind === "open" ? "Open question" : kind === "decision" ? "Decision" : recordLabel(kind);

const FILES_SHOWN = 12;

// Each line once, trimmed, blanks dropped.
const distinct = (lines: string[]): string[] => [...new Set(lines.map((l) => l.trim()).filter(Boolean))];

export default async function SessionPage({ params }: PageProps<"/sessions/[id]">) {
  const viewer = await requireViewer();
  const detail = await load((await params).id, viewer.userId);
  if (!detail) notFound();

  const product = detail.productId ? await getProduct(detail.productId, viewer.userId) : null;
  const approved = detail.records.filter((r) => r.status === "approved");
  // Only the author's own view carries drafts; checked again here so nobody else could ever be shown one.
  const drafts = detail.mine ? detail.records.filter((r) => r.status === "draft") : [];
  const tools = detail.mine ? detail.tools : null;
  // When it was last shared: the newest approval, never a draft's last change.
  const sharedAt = approved.length ? new Date(Math.max(...approved.map((r) => r.at.getTime()))) : null;

  // What was built: the summary's own words, then any other summary the session shared (a server-drafted one).
  const built = [detail.summary?.built.trim() ?? ""].filter(Boolean);
  for (const r of approved)
    if (r.kind === "summary" && !built.some((b) => b.toLowerCase() === r.text.trim().toLowerCase()))
      built.push(r.text.trim());
  const why = detail.summary?.why.trim() ?? "";
  const decisions = distinct(
    detail.summary ? detail.summary.decisions : approved.filter((r) => r.kind === "decision").map((r) => r.text),
  );
  const areas = distinct([...(detail.summary?.areas ?? []), ...approved.flatMap((r) => r.areas)]);
  const files = distinct(detail.files);
  const groups = GROUPS.map((g) => ({ ...g, items: approved.filter((r) => r.kind === g.kind).map(item) })).filter(
    (g) => g.items.length,
  );
  const shortId = detail.sessionId.length > 12 ? detail.sessionId.slice(0, 8) : detail.sessionId;
  const repoHref = detail.repo ? repoUrl(detail.repo) : null;
  const where = product?.name ?? detail.repo;

  return (
    <>
      <PageHeader
        eyebrow="Session"
        title={detail.title ?? `Session ${shortId}`}
        lede={
          <>
            {detail.mine ? "Your session" : detail.author ? `${detail.author.name}'s session` : "A session"}
            {where ? ` in ${where}` : ""}
            {sharedAt ? (
              <>
                , shared <Ago at={sharedAt.toISOString()} />.
              </>
            ) : (
              ". Nothing from it is shared yet."
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {drafts.length ? (
            <section className="card" aria-labelledby="drafts-title">
              <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-line border-b px-5 py-3.5">
                <NotebookPen size={16} aria-hidden className="flex-none text-ink-3" />
                <h2 id="drafts-title" className="font-semibold text-[15px]">
                  Your drafts
                </h2>
                <span className="chip status-candidate">Only you can see these</span>
                <Link href="/my-day" className="btn btn-sm min-h-11 sm:ml-auto sm:min-h-8">
                  Review in My Day
                </Link>
              </header>
              <p className="border-line border-b px-5 py-3 text-[13px] text-ink-3">
                Approve them in My Day to share them with everyone in your organisation. Discarded ones stay private.
              </p>
              <ul className="divide-y divide-line">
                {drafts.map((d) => (
                  <li key={d.id} className="px-5 py-3.5">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="chip">{draftLabel(d.kind)}</span>
                      <span className="text-[12.5px] text-ink-3">
                        Changed <Ago at={d.at.toISOString()} />
                      </span>
                    </div>
                    {d.title ? <p className="mb-0.5 font-medium text-[14px]">{d.title}</p> : null}
                    <p className="whitespace-pre-wrap break-words text-[14px] text-ink-2">{d.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="card" aria-labelledby="summary-title">
            <header className="border-line border-b px-5 py-3.5">
              <h2 id="summary-title" className="font-semibold text-[15px]">
                What was built
              </h2>
            </header>
            {built.length || why || decisions.length ? (
              <div className="flex flex-col gap-4 px-5 py-4">
                {built.map((text) => (
                  <p key={text} className="whitespace-pre-wrap break-words text-[14px]">
                    {text}
                  </p>
                ))}
                {why ? (
                  <div>
                    <h3 className="mb-1 font-medium text-[13px] text-ink-3">Why</h3>
                    <p className="whitespace-pre-wrap break-words text-[14px]">{why}</p>
                  </div>
                ) : null}
                {decisions.length ? (
                  <div>
                    <h3 className="mb-1 font-medium text-[13px] text-ink-3">Decisions</h3>
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] marker:text-ink-3">
                      {decisions.map((d) => (
                        <li key={d} className="break-words">
                          {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="px-5 py-4 text-[14px] text-ink-3">
                {approved.length
                  ? "This session shared no summary, only the findings below."
                  : "Nothing from this session is shared yet. Once its author approves its summary, it shows here for everyone in the organisation."}
              </p>
            )}
          </section>

          {groups.length ? (
            groups.map((g) => (
              <FindingGroup key={g.kind} id={`group-${g.kind}`} title={g.title} icon={g.icon} items={g.items} />
            ))
          ) : (
            <section className="card px-5 py-6" aria-label="Findings">
              <p className="font-medium text-[14px]">No findings shared</p>
              <p className="mt-1 text-[13px] text-ink-3">
                Insights, workflow findings, pain points, context gaps and open questions this session shares show here.
              </p>
            </section>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section className="card" aria-labelledby="details-title">
            <header className="border-line border-b px-5 py-3.5">
              <h2 id="details-title" className="font-semibold text-[15px]">
                Details
              </h2>
            </header>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 px-5 py-4 text-[14px]">
              <dt className="text-ink-3">Product</dt>
              <dd className="min-w-0">
                {product ? (
                  <Link
                    href={`/products/${encodeURIComponent(product.id)}`}
                    className="inline-flex min-h-11 items-center gap-1.5 text-accent-text underline-offset-4 hover:underline sm:min-h-0"
                  >
                    <Boxes size={15} aria-hidden className="flex-none" />
                    {product.name}
                  </Link>
                ) : (
                  <span className="text-ink-3">Not in a product yet</span>
                )}
              </dd>
              <dt className="text-ink-3">Repository</dt>
              <dd className="min-w-0 break-words font-mono text-[13px]">
                {detail.repo ? (
                  repoHref ? (
                    <a
                      href={repoHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center text-accent-text underline-offset-4 hover:underline sm:min-h-0"
                    >
                      {detail.repo}
                    </a>
                  ) : (
                    detail.repo
                  )
                ) : (
                  <span className="font-sans text-[14px] text-ink-3">Not known</span>
                )}
              </dd>
              {detail.branch ? (
                <>
                  <dt className="text-ink-3">Branch</dt>
                  <dd className="flex min-w-0 items-center gap-1.5 break-words font-mono text-[13px]">
                    <GitBranch size={15} aria-hidden className="flex-none text-ink-3" />
                    {detail.branch}
                  </dd>
                </>
              ) : null}
              {detail.author ? (
                <>
                  <dt className="text-ink-3">By</dt>
                  <dd className="min-w-0">{detail.mine ? `${detail.author.name} (you)` : detail.author.name}</dd>
                </>
              ) : null}
              <dt className="text-ink-3">Session</dt>
              <dd className="min-w-0 break-all font-mono text-[12.5px] text-ink-2">{detail.sessionId}</dd>
            </dl>
          </section>

          <section className="card" aria-labelledby="links-title">
            <header className="flex items-center gap-2 border-line border-b px-5 py-3.5">
              <Link2 size={16} aria-hidden className="flex-none text-ink-3" />
              <h2 id="links-title" className="font-semibold text-[15px]">
                Links
              </h2>
            </header>
            <SessionLinks refs={detail.refs} pr={detail.pr} repo={detail.repo} />
          </section>

          <section className="card" aria-labelledby="areas-title">
            <header className="flex items-center gap-2 border-line border-b px-5 py-3.5">
              <FileCode2 size={16} aria-hidden className="flex-none text-ink-3" />
              <h2 id="areas-title" className="font-semibold text-[15px]">
                Areas and files
              </h2>
            </header>
            {areas.length || files.length ? (
              <div className="flex flex-col gap-4 px-5 py-4">
                {areas.length ? (
                  <div>
                    <h3 className="mb-1.5 text-[12.5px] text-ink-3">Code areas</h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {areas.map((a) => (
                        <li key={a} className="chip">
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {files.length ? (
                  <div>
                    <h3 className="mb-1.5 text-[12.5px] text-ink-3">
                      {files.length === 1 ? "File" : "Files"} it changed
                    </h3>
                    <FileList files={files} />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="px-5 py-4 text-[14px] text-ink-3">
                No code areas or files named. A summary from the plugin lists them when it's approved.
              </p>
            )}
          </section>

          <RelatedPanel subject={{ sessionId: detail.sessionId }} viewerId={viewer.userId} />

          {tools ? (
            <section className="card" aria-labelledby="tools-title">
              <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-line border-b px-5 py-3.5">
                <TerminalSquare size={16} aria-hidden className="flex-none text-ink-3" />
                <h2 id="tools-title" className="font-semibold text-[15px]">
                  Tool time
                </h2>
                <span className="chip status-candidate ml-auto">Only you can see this</span>
              </header>
              <ToolTime rows={tools} />
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function FileList({ files }: { files: string[] }) {
  const list = (items: string[]) => (
    <ul className="flex flex-col gap-1 font-mono text-[12.5px] text-ink-2">
      {items.map((f) => (
        <li key={f} className="break-all">
          {f}
        </li>
      ))}
    </ul>
  );
  if (files.length <= FILES_SHOWN) return list(files);
  return (
    <>
      {list(files.slice(0, FILES_SHOWN))}
      <details className="mt-1">
        <summary className="flex min-h-11 cursor-pointer items-center text-[13px] text-accent-text sm:min-h-8">
          {files.length - FILES_SHOWN} more
        </summary>
        {list(files.slice(FILES_SHOWN))}
      </details>
    </>
  );
}
