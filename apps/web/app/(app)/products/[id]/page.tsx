import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { ProductGraphPanel } from "../../../../components/graph/product-graph.tsx";
import { RelatedPanel } from "../../../../components/graph/related.tsx";
import { InProgress } from "../../../../components/products/in-progress.tsx";
import { RepoChips } from "../../../../components/products/refs.tsx";
import { Areas, AskLink, OpenGaps, Tickets, TimeSinks } from "../../../../components/products/side.tsx";
import { WhatsNew } from "../../../../components/products/whats-new.tsx";
import { productPage, TIME_DAYS, WHATS_NEW_WEEKS } from "../../../../server/hub/product-page.ts";
import { getProduct } from "../../../../server/hub/products.ts";
import { getViewer, requireViewer } from "../../../../server/viewer.ts";
import { PageHeader } from "../../page-header.tsx";

const productName = cache(async (id: string, userId: string) => (await getProduct(id, userId))?.name ?? null);

export async function generateMetadata({ params }: PageProps<"/products/[id]">): Promise<Metadata> {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  const name = viewer ? await productName(id, viewer.userId) : null;
  return { title: name ?? "Product" };
}

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const viewer = await requireViewer();
  const { id } = await params;
  const result = await productPage(id, viewer);
  if (result.status === "missing") notFound();
  // A product merged into another: its old links lead to the one it's part of now.
  if (result.status === "moved") redirect(`/products/${encodeURIComponent(result.id)}`);
  const { product, weeks, work, moreWork, time, gaps, areas, people, refs } = result.page;

  return (
    <>
      <Link href="/products" className="btn btn-quiet btn-sm mb-3 -ml-2.5 max-md:min-h-11">
        <ArrowLeft size={15} aria-hidden /> Products
      </Link>
      <PageHeader eyebrow="Product" title={product.name} />
      <div className="-mt-5 mb-8 flex flex-wrap gap-1.5">
        <span className="sr-only">Repositories:</span>
        <RepoChips repos={product.repos} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <WhatsNew weeks={weeks} sinceWeeks={WHATS_NEW_WEEKS} />
          <InProgress work={work} moreWork={moreWork} />
          <ProductGraphPanel productId={product.id} viewerId={viewer.userId} />
        </div>
        <aside className="flex min-w-0 flex-col gap-6" aria-label="About this product">
          <AskLink productId={product.id} name={product.name} />
          <TimeSinks productId={product.id} top={time.top} totalMs={time.totalMs} days={TIME_DAYS} />
          <OpenGaps productId={product.id} top={gaps.top} open={gaps.open} />
          <Areas areas={areas} people={people} />
          <Tickets refs={refs} />
          <RelatedPanel subject={{ productId: product.id }} viewerId={viewer.userId} />
        </aside>
      </div>
    </>
  );
}
