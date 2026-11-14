import type { Metadata } from "next";
import { ProductPicker, WeekNav } from "../../../components/digest/controls.tsx";
import { EmailPreview } from "../../../components/digest/email-preview.tsx";
import { NothingShared, ProductWeek, WeekGaps, WeekTime } from "../../../components/digest/sections.tsx";
import { names } from "../../../components/products/refs.tsx";
import { config } from "../../../server/config.ts";
import {
  buildDigest,
  digestHref,
  digestSummary,
  parseProducts,
  parseWeek,
  renderDigestEmail,
} from "../../../server/hub/digest.ts";
import { listProducts } from "../../../server/hub/products.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { DigestHeader } from "./header.tsx";

export const metadata: Metadata = { title: "Digest" };

// The weekly digest: one week's approved work, product by product, with the time lost to tools and the gaps opened
// and resolved that week; ?week= pages back, ?product= (repeatable) narrows it. Read through the hub's read models as
// the viewer (server/hub/digest.ts), and shown as the email it would be.
export default async function DigestPage({ searchParams }: PageProps<"/digest">) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const now = new Date();
  const weekStart = parseWeek(params.week, now);
  const productIds = parseProducts(params.product);
  const [digest, products] = await Promise.all([
    buildDigest({ weekStart, productIds }, viewer, now),
    listProducts(viewer),
  ]);
  const email = renderDigestEmail(digest, { baseUrl: config().baseURL });

  const { week, picked, unknown } = digest;
  const pickedIds = picked.map((p) => p.id);
  const weekParam = week.current ? null : week.key;
  const scope = picked.length ? ` in ${names(picked.map((p) => p.name))}` : "";

  return (
    <>
      <DigestHeader />
      <WeekNav week={week} productIds={pickedIds} summary={digestSummary(digest)} />
      {products.length ? <ProductPicker products={products} picked={pickedIds} week={weekParam} /> : null}

      {unknown.length ? (
        <p role="status" className="card mb-6 px-5 py-3.5 text-[13px] text-ink-2">
          {unknown.length === 1 ? "One product asked for isn't listed" : "Some products asked for aren't listed"}:
          there's no such product, or it has no approved work yet.{" "}
          {picked.length ? `Showing ${names(picked.map((p) => p.name))}.` : "Showing every product."}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {digest.products.length ? (
            digest.products.map((product) => <ProductWeek key={product.id} product={product} />)
          ) : (
            <NothingShared
              current={week.current}
              scope={scope}
              previousHref={digestHref({ week: week.previous, productIds: pickedIds })}
              everyHref={picked.length ? digestHref({ week: weekParam }) : null}
            />
          )}
        </div>
        <aside className="flex min-w-0 flex-col gap-6" aria-label="Across the week">
          <WeekTime
            top={digest.time.top}
            totalMs={digest.time.totalMs}
            commands={digest.time.commands}
            current={week.current}
          />
          <WeekGaps {...digest.gaps} current={week.current} />
          <EmailPreview subject={email.subject} text={email.text} />
        </aside>
      </div>
    </>
  );
}
