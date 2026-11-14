import { Boxes } from "lucide-react";
import type { Metadata } from "next";
import { ProductCard } from "../../../components/products/product-card.tsx";
import { productCards, TIME_DAYS } from "../../../server/hub/product-page.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage() {
  const viewer = await requireViewer();
  const products = await productCards(viewer);

  return (
    <>
      <PageHeader
        eyebrow="Products"
        title="What's being built"
        lede="Each product your team works on, made from the repositories its sessions run in: the latest approved work, open gaps, and time lost on tools."
      />
      {products.length ? (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Products">
          {products.map((product) => (
            <li key={product.id} className="flex min-w-0">
              <ProductCard product={product} days={TIME_DAYS} />
            </li>
          ))}
        </ul>
      ) : (
        <section className="card px-6 py-12 text-center" aria-labelledby="no-products">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
            <Boxes size={17} aria-hidden />
          </span>
          <h2 id="no-products" className="mt-4 font-semibold text-[16px]">
            No products yet
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
            A repository becomes a product here once someone approves work from it: a session summary from the plugin,
            or a record from My Day. Until then, what happens in it stays with the person who did it.
          </p>
        </section>
      )}
    </>
  );
}
