import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GraphExplorer } from "../../../components/graph-explorer/graph-explorer.tsx";
import { graphHref, parseGraphFilters, RANGE_DAYS } from "../../../server/hub/graph-model.ts";
import { graphFor } from "../../../server/hub/graph-view.ts";
import { getProduct, listProducts } from "../../../server/hub/products.ts";
import { DAY_MS } from "../../../server/hub/text.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Graph" };

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

// The knowledge graph: how approved work connects across the organisation or in one product, or how the viewer's own
// memories do. Read through graphFor as the viewer (server/hub/graph-view.ts), so it shows approved work only, and in
// My memories only the viewer's own. The filters are the address: every view is a link.
export default async function GraphPage({ searchParams }: PageProps<"/graph">) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const filters = parseGraphFilters(params);
  const mode = one(params.view) === "list" ? "list" : "graph";
  const node = one(params.node)?.slice(0, 400) ?? null;
  const keep = { view: mode === "list" ? "list" : null, node };

  const products = filters.scope === "product" ? await listProducts(viewer) : [];
  if (filters.scope === "product") {
    // Product scope opens on the first product; a merged product's old link goes to the one it's part of now.
    const first = products[0];
    if (!filters.productId && first) redirect(graphHref({ ...filters, productId: first.id }, keep));
    const product = filters.productId ? await getProduct(filters.productId, viewer) : null;
    if (product && product.id !== filters.productId) redirect(graphHref({ ...filters, productId: product.id }, keep));
  }

  const days = RANGE_DAYS[filters.range];
  const graph = await graphFor(
    {
      scope: filters.scope,
      productId: filters.productId,
      kinds: filters.kinds,
      since: days ? new Date(Date.now() - days * DAY_MS) : undefined,
      minDegree: filters.minDegree,
      status: filters.status === "all" ? undefined : filters.status,
    },
    viewer,
  );

  return (
    <>
      <PageHeader
        eyebrow="Graph"
        title="How the work connects"
        lede="Products, code areas, tickets, sessions and what they found, linked by what they share. Approved work only, never drafts; My memories shows only your own."
      />
      <GraphExplorer
        // A new set of filters is a new graph: laid out and fitted afresh.
        key={graphHref({ ...filters, size: "degree" })}
        graph={graph}
        filters={filters}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        initialMode={mode}
        initialNode={node}
      />
    </>
  );
}
