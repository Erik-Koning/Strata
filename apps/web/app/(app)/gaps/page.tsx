import type { Metadata } from "next";
import Link from "next/link";
import { Ago } from "../../../components/time.tsx";
import { listGaps } from "../../../server/hub/gaps.ts";
import { listProducts } from "../../../server/hub/products.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { refreshHub } from "../hub-refresh.ts";
import { Empty } from "../hub-ui.tsx";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Gaps" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
] as const;

export default async function GapsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: raw } = await searchParams;
  const status = raw === "resolved" ? "resolved" : "open";
  const viewer = await requireViewer();
  await refreshHub();
  const [gaps, products] = await Promise.all([listGaps({ status }, viewer), listProducts(viewer)]);
  const name = new Map(products.map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader
        eyebrow="Gaps"
        title="What nobody wrote down"
        lede="Questions agents ran into and couldn't answer, and questions people asked Strata with no answer. The ones that come back most are first."
      />
      <nav className="mb-4 flex gap-2" aria-label="Gap status">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "open" ? "/gaps" : `/gaps?status=${t.key}`}
            className={`btn btn-sm ${status === t.key ? "btn-primary" : "btn-quiet"}`}
            aria-current={status === t.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {gaps.length ? (
        <ul className="card divide-y divide-line">
          {gaps.map((g) => (
            <li key={g.id}>
              <Link href={`/gaps/${g.id}`} className="block px-5 py-4 hover:bg-surface-2">
                <p className="text-[15px]">{g.text}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                  {g.productId && name.get(g.productId) ? <span className="chip">{name.get(g.productId)}</span> : null}
                  <span>
                    {g.sessions} session{g.sessions === 1 ? "" : "s"}
                  </span>
                  {g.fromPeople ? <span>asked {g.fromPeople}×</span> : null}
                  {g.owner ? <span>· {g.owner.name} has it</span> : null}
                  {g.seenSinceResolved ? <span className="chip status-candidate">came back</span> : null}
                  <span className="ml-auto">
                    last seen <Ago at={g.lastSeen.toISOString()} />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title={status === "open" ? "No open gaps" : "Nothing resolved yet"}>
          {status === "open"
            ? "Gaps appear when an approved session logs a context gap, or someone asks Ask Strata something it can't answer."
            : "Resolve a gap with a link or a note and it moves here."}
        </Empty>
      )}
    </>
  );
}
