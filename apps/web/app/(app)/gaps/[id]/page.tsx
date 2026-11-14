import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ago } from "../../../../components/time.tsx";
import { getGap } from "../../../../server/hub/gaps.ts";
import { getProduct } from "../../../../server/hub/products.ts";
import { requireViewer } from "../../../../server/viewer.ts";
import { Section } from "../../hub-ui.tsx";
import { PageHeader } from "../../page-header.tsx";
import { GapActions } from "../gap-actions.tsx";

export const metadata: Metadata = { title: "Gap" };
export const dynamic = "force-dynamic";

export default async function GapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer();
  const gap = await getGap(id, viewer);
  if (!gap) notFound();
  const product = gap.productId ? await getProduct(gap.productId, viewer) : null;

  return (
    <>
      <PageHeader
        eyebrow={gap.status === "open" ? "Open gap" : "Resolved gap"}
        title={gap.text}
        lede={
          <>
            First seen <Ago at={gap.firstSeen.toISOString()} /> · last seen <Ago at={gap.lastSeen.toISOString()} />
          </>
        }
        actions={
          <Link href="/gaps" className="btn btn-quiet btn-sm">
            All gaps
          </Link>
        }
      />
      <div className="mb-6 flex flex-wrap gap-2 text-[13px]">
        {product ? (
          <Link href={`/products/${encodeURIComponent(product.id)}`} className="chip hover:underline">
            {product.name}
          </Link>
        ) : null}
        <span className="chip">
          {gap.sessions} session{gap.sessions === 1 ? "" : "s"}
        </span>
        {gap.fromAgents ? <span className="chip">agents hit it {gap.fromAgents}×</span> : null}
        {gap.fromPeople ? <span className="chip">people asked {gap.fromPeople}×</span> : null}
        {gap.owner ? <span className="chip">{gap.owner.name} has it</span> : null}
        {gap.seenSinceResolved ? <span className="chip status-candidate">came back after it was resolved</span> : null}
      </div>

      {gap.resolution ? (
        <Section title="How it was answered" hint={gap.resolution.at.toISOString().slice(0, 10)}>
          <div className="card p-5 text-[14px]">
            {gap.resolution.url ? (
              <a
                href={gap.resolution.url}
                className="text-accent-text hover:underline"
                rel="noreferrer"
                target="_blank"
              >
                {gap.resolution.url}
              </a>
            ) : null}
            {gap.resolution.note ? <p className="mt-1 text-ink-2">{gap.resolution.note}</p> : null}
          </div>
        </Section>
      ) : null}

      <Section title={gap.status === "open" ? "Do something about it" : "Reopen"}>
        <div className="card p-5">
          <GapActions id={gap.id} status={gap.status} mine={gap.owner?.id === viewer.userId} />
        </div>
      </Section>

      <Section
        title="Where it came up"
        hint={`${gap.sessionIds.length} session${gap.sessionIds.length === 1 ? "" : "s"}`}
      >
        {gap.sessionIds.length ? (
          <ul className="card divide-y divide-line">
            {gap.sessionIds.map((s) => (
              <li key={s}>
                <Link
                  href={`/sessions/${encodeURIComponent(s)}`}
                  className="block px-5 py-3 text-[14px] hover:bg-surface-2"
                >
                  Session <span className="font-mono">{s.slice(0, 8)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-ink-3">Only people asking Strata, no coding session.</p>
        )}
      </Section>
    </>
  );
}
