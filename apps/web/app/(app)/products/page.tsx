import type { Metadata } from "next";
import Link from "next/link";
import { Ago } from "../../../components/time.tsx";
import { listGaps } from "../../../server/hub/gaps.ts";
import { listProducts } from "../../../server/hub/products.ts";
import { recordsFor, type TeamRecord } from "../../../server/hub/team-records.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { refreshHub } from "../hub-refresh.ts";
import { Empty, shortRepo } from "../hub-ui.tsx";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

const WEEK = 7 * 24 * 60 * 60 * 1000;

export default async function ProductsPage() {
  const viewer = await requireViewer();
  await refreshHub();
  const [products, records, gaps] = await Promise.all([
    listProducts(viewer),
    recordsFor({ limit: 1000 }, viewer),
    listGaps({ status: "open" }, viewer),
  ]);
  const byProduct = new Map<string, TeamRecord[]>();
  for (const r of records) if (r.productId) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
  const openGaps = new Map<string, number>();
  for (const g of gaps) if (g.productId) openGaps.set(g.productId, (openGaps.get(g.productId) ?? 0) + 1);

  return (
    <>
      <PageHeader
        eyebrow="Products"
        title="What's being built"
        lede="Each product your team works on: what changed this week, what's in progress, and its open gaps. A product is made from the repositories your sessions run in, and it shows once some of its work is approved."
      />
      {products.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {products.map((p) => {
            const items = byProduct.get(p.id) ?? [];
            const latest = items.find((r) => r.kind === "summary") ?? items[0];
            const thisWeek = items.filter((r) => Date.now() - r.at.getTime() < WEEK).length;
            const sessions = new Set(items.map((r) => r.sessionId)).size;
            return (
              <li key={p.id}>
                <Link
                  href={`/products/${encodeURIComponent(p.id)}`}
                  className="card block p-5 hover:border-line-strong"
                >
                  <h2 className="font-semibold text-[17px]">{p.name}</h2>
                  <p className="mt-0.5 font-mono text-[12px] text-ink-3">
                    {p.repos.map((r) => shortRepo(r.repo)).join(" · ")}
                  </p>
                  {latest ? (
                    <p className="mt-3 line-clamp-2 text-[14px] text-ink-2">{latest.title ?? latest.text}</p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                    <span className="chip">{thisWeek} this week</span>
                    <span className="chip">
                      {sessions} session{sessions === 1 ? "" : "s"}
                    </span>
                    {openGaps.get(p.id) ? (
                      <span className="chip">
                        {openGaps.get(p.id)} open gap{openGaps.get(p.id) === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {latest ? (
                      <span className="ml-auto">
                        last shared <Ago at={latest.at.toISOString()} />
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty title="No products yet">
          A product appears once a session's work in a repository is approved. Approve a draft on My Day and it will
          show here.
        </Empty>
      )}
    </>
  );
}
