import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ago } from "../../../../components/time.tsx";
import { getProduct } from "../../../../server/hub/products.ts";
import { sessionDetail } from "../../../../server/hub/team-records.ts";
import { requireViewer } from "../../../../server/viewer.ts";
import { duration, RecordRow, Section, shortRepo } from "../../hub-ui.tsx";
import { PageHeader } from "../../page-header.tsx";

export const metadata: Metadata = { title: "Session" };
export const dynamic = "force-dynamic";

const List = ({ title, items }: { title: string; items: string[] }) =>
  items.length ? (
    <div>
      <h3 className="eyebrow mb-1.5">{title}</h3>
      <ul className="list-disc pl-5 text-[14px] text-ink-2">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  ) : null;

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeURIComponent((await params).id);
  const viewer = await requireViewer();
  const s = await sessionDetail(id, viewer);
  if (!s) notFound();
  const product = s.productId ? await getProduct(s.productId, viewer) : null;

  return (
    <>
      <PageHeader
        eyebrow={`Session ${s.sessionId.slice(0, 8)}`}
        title={s.title ?? "Untitled session"}
        lede={
          <>
            {s.author ? `${s.author.name} · ` : ""}
            <Ago at={s.at.toISOString()} />
            {s.branch ? ` · ${s.branch}` : ""}
          </>
        }
        actions={
          product ? (
            <Link href={`/products/${encodeURIComponent(product.id)}`} className="btn btn-quiet btn-sm">
              {product.name}
            </Link>
          ) : s.mine ? (
            <Link href="/my-day" className="btn btn-quiet btn-sm">
              My Day
            </Link>
          ) : null
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {s.repo ? <span className="chip chip-mono">{shortRepo(s.repo)}</span> : null}
        {s.tickets.map((t) => (
          <span key={t} className="chip chip-mono">
            {t}
          </span>
        ))}
        {s.pr ? (
          s.pr.url ? (
            <a href={s.pr.url} className="chip chip-mono hover:underline" rel="noreferrer" target="_blank">
              PR {s.pr.id}
            </a>
          ) : (
            <span className="chip chip-mono">PR {s.pr.id}</span>
          )
        ) : null}
      </div>

      {s.summary ? (
        <Section title="What happened">
          <div className="card flex flex-col gap-4 p-5">
            <p className="text-[15px]">{s.summary.built}</p>
            {s.summary.why ? <p className="text-[14px] text-ink-2">Why: {s.summary.why}</p> : null}
            <List title="Decisions" items={s.summary.decisions} />
            <List title="Open" items={s.summary.open} />
            <List title="Code areas" items={s.summary.areas} />
          </div>
        </Section>
      ) : null}

      <Section title="Records" hint={`${s.records.length} from this session`}>
        <ul className="card divide-y divide-line">
          {s.records.map((r) => (
            <RecordRow key={r.id} record={r} showSession={false} />
          ))}
        </ul>
      </Section>

      {s.files.length ? (
        <Section title="Files touched" hint={`${s.files.length}`}>
          <ul className="card divide-y divide-line font-mono text-[12.5px]">
            {s.files.slice(0, 50).map((f) => (
              <li key={f} className="px-5 py-2 text-ink-2">
                {f}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {s.tools?.length ? (
        <Section title="Shell time" hint="only you can see this">
          <ul className="card divide-y divide-line text-[14px]">
            {s.tools.map((t) => (
              <li key={t.class} className="flex gap-3 px-5 py-3">
                <span className="font-mono text-[13px]">{t.class}</span>
                <span className="text-ink-3">
                  {t.runs} run{t.runs === 1 ? "" : "s"}
                  {t.failures ? `, ${t.failures} failed` : ""}
                </span>
                <span className="ml-auto font-mono text-[13px] tabular-nums">{duration(t.totalMs)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
