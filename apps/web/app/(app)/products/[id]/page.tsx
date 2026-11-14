import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Ago } from "../../../../components/time.tsx";
import { listGaps } from "../../../../server/hub/gaps.ts";
import { getProduct } from "../../../../server/hub/products.ts";
import { timeLost } from "../../../../server/hub/signals.ts";
import { contributorsFor, inProgress, whatsNew } from "../../../../server/hub/team-records.ts";
import { requireViewer } from "../../../../server/viewer.ts";
import { refreshHub } from "../../hub-refresh.ts";
import { Empty, hours, People, RecordRow, Section, shortRepo } from "../../hub-ui.tsx";
import { PageHeader } from "../../page-header.tsx";

export const metadata: Metadata = { title: "Product" };
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const viewer = await requireViewer();
  await refreshHub();
  const product = await getProduct(id, viewer);
  if (!product) notFound();
  if (product.id !== id) redirect(`/products/${encodeURIComponent(product.id)}`);

  const now = new Date();
  const [weeks, progress, gaps, people, lost] = await Promise.all([
    whatsNew({ productId: id, since: new Date(now.getTime() - 30 * DAY) }, viewer),
    inProgress({ productId: id }, viewer),
    listGaps({ productId: id, status: "open" }, viewer),
    contributorsFor(id, viewer),
    timeLost({ productId: id, since: new Date(now.getTime() - 30 * DAY), until: now }, viewer),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Product"
        title={product.name}
        lede={product.repos.map((r) => shortRepo(r.repo) + (r.path ? `/${r.path}` : "")).join(" · ")}
        actions={
          <Link href="/products" className="btn btn-quiet btn-sm">
            All products
          </Link>
        }
      />

      <Section title="In progress" hint="work shared in the last 14 days, by ticket, pull request or session">
        {progress.work.length ? (
          <ul className="card divide-y divide-line">
            {progress.work.map((w) => (
              <li key={`${w.kind}:${w.key}`} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[15px]">{w.title}</span>
                  {w.tickets.map((t) => (
                    <span key={t} className="chip chip-mono">
                      {t}
                    </span>
                  ))}
                  {w.pr ? (
                    w.pr.url ? (
                      <a href={w.pr.url} className="chip chip-mono hover:underline" rel="noreferrer" target="_blank">
                        PR {w.pr.id}
                      </a>
                    ) : (
                      <span className="chip chip-mono">PR {w.pr.id}</span>
                    )
                  ) : null}
                  <span className="ml-auto text-[12.5px] text-ink-3">
                    <People people={w.people} /> · <Ago at={w.lastAt.toISOString()} />
                  </span>
                </div>
                {w.open.length ? (
                  <ul className="mt-2 list-disc pl-5 text-[13.5px] text-ink-2">
                    {w.open.map((o) => (
                      <li key={o.id}>{o.text}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-1.5 flex flex-wrap gap-3 text-[12.5px]">
                  {w.sessionIds.map((s) => (
                    <Link
                      key={s}
                      href={`/sessions/${encodeURIComponent(s)}`}
                      className="text-accent-text hover:underline"
                    >
                      Session {s.slice(0, 8)}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Nothing in progress">No approved work from the last two weeks.</Empty>
        )}
      </Section>

      <Section title="What's new" hint="approved work, by the week it was shared">
        {weeks.length ? (
          weeks.map((w) => (
            <div key={w.weekStart.toISOString()} className="mb-4">
              <h3 className="mb-2 font-mono text-[12px] text-ink-3 uppercase">
                Week of {w.weekStart.toISOString().slice(0, 10)}
              </h3>
              <ul className="card divide-y divide-line">
                {[...w.summaries, ...w.findings].map((r) => (
                  <RecordRow key={r.id} record={r} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <Empty title="Nothing shared in 30 days" />
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Open gaps" hint={`${gaps.length} open`}>
          {gaps.length ? (
            <ul className="card divide-y divide-line">
              {gaps.slice(0, 8).map((g) => (
                <li key={g.id} className="px-5 py-3">
                  <Link href={`/gaps/${g.id}`} className="text-[14px] hover:underline">
                    {g.text}
                  </Link>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">
                    {g.sessions} session{g.sessions === 1 ? "" : "s"}
                    {g.fromPeople ? ` · asked ${g.fromPeople}×` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No open gaps" />
          )}
        </Section>

        <Section title="Who's worked here" hint="by name, last 90 days">
          <div className="card p-5 text-[14px]">
            <p className="text-ink-2">
              <People people={people.people} />
            </p>
            {people.areas.length ? (
              <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
                {people.areas.slice(0, 8).map((a) => (
                  <li key={a.area} className="flex gap-2">
                    <span className="chip chip-mono">{a.area}</span>
                    <span className="text-ink-3">
                      <People people={a.people} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Section>
      </div>

      {lost.items.length ? (
        <Section title="Time lost" hint={`${hours(lost.totalHours)} in 30 days`}>
          <ul className="card divide-y divide-line">
            {lost.items.slice(0, 5).map((i) => (
              <li key={i.key} className="flex items-center gap-3 px-5 py-3 text-[14px]">
                <Link href={`/time/${encodeURIComponent(i.key)}`} className="font-mono text-[13px] hover:underline">
                  {i.class} · {i.fp.slice(0, 8)}
                </Link>
                <span className="ml-auto font-mono text-[13px] tabular-nums">{hours(i.hours)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
