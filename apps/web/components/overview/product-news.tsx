// Products with what's new in them this week: an engineer's own products, or every product with something shipped
// for the rest. Each session shows its summary, a finding or two shared alongside it, its tickets and pull requests,
// and a link to its page.
import { Boxes, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ProductNews } from "../../server/hub/overview.ts";
import type { SessionWork } from "../../server/hub/product-page.ts";
import { RefChips, SessionLink } from "../products/refs.tsx";
import { Ago } from "../time.tsx";
import { BigEmpty, CardHeader, FootLink } from "./parts.tsx";

const FINDINGS_SHOWN = 2;

function NewsSession({ session }: { session: SessionWork }) {
  const { summary } = session;
  const findings = session.findings.slice(0, FINDINGS_SHOWN);
  const more = session.findings.length - findings.length + session.moreFindings;
  return (
    <li className="border-line border-l-2 pl-3.5">
      {summary ? (
        <>
          {summary.title ? <p className="font-medium text-[14.5px] leading-snug">{summary.title}</p> : null}
          {summary.text && summary.text !== summary.title ? (
            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-[13.5px] text-ink-2">
              {summary.text}
            </p>
          ) : null}
        </>
      ) : null}
      {findings.length ? (
        <ul className={`flex flex-col gap-1.5 ${summary ? "mt-2" : ""}`} aria-label="Shared with it">
          {findings.map((finding) => (
            <li key={finding.id} className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <span className="chip flex-none">{finding.kindLabel}</span>
              <span className="line-clamp-2 min-w-0 flex-1 basis-48 break-words text-[13.5px] text-ink-2 leading-6">
                {finding.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <RefChips refs={session.refs} />
        <SessionLink sessionId={session.sessionId} />
        {more > 0 ? <span className="text-[12.5px] text-ink-3">{more} more on its page</span> : null}
        <Ago at={session.at} className="ml-auto text-[12.5px] text-ink-3" />
      </div>
    </li>
  );
}

function ProductBlock({ product }: { product: ProductNews }) {
  return (
    <li className="px-5 py-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 flex-none place-items-center rounded-[8px] bg-accent-soft text-accent-text">
          <Boxes size={14} aria-hidden />
        </span>
        {product.id ? (
          <Link
            href={`/products/${encodeURIComponent(product.id)}`}
            className="flex min-w-0 items-center font-semibold text-[15px] underline-offset-4 hover:underline max-md:min-h-11"
          >
            <span className="truncate">{product.name}</span>
          </Link>
        ) : (
          <span className="min-w-0 truncate font-semibold text-[15px]">{product.name}</span>
        )}
      </div>
      {product.repos.length ? (
        <p className="mt-1 truncate font-mono text-[12px] text-ink-3">{product.repos.join(", ")}</p>
      ) : null}
      {product.sessions.length ? (
        <ul className="mt-3 flex flex-col gap-4">
          {product.sessions.map((session) => (
            <NewsSession key={session.sessionId} session={session} />
          ))}
          {product.moreSessions ? (
            <li className="text-[13px] text-ink-3">
              {product.moreSessions === 1 ? "One more session" : `${product.moreSessions} more sessions`} this week
              {product.id ? " on its page" : ""}.
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-ink-3">Nothing shared here in the last seven days.</p>
      )}
    </li>
  );
}

export function ProductNewsList({
  id,
  title,
  note,
  products,
  more,
  empty,
}: {
  id: string;
  title: string;
  note: string;
  products: ProductNews[];
  more: number;
  empty: { icon: LucideIcon; title: string; body: string };
}) {
  return (
    <section className="card" aria-labelledby={id}>
      <CardHeader id={id} icon={Boxes} title={title} note={note} />
      {products.length ? (
        <ul className="divide-y divide-line">
          {products.map((product) => (
            <ProductBlock key={product.id ?? "none"} product={product} />
          ))}
        </ul>
      ) : (
        <BigEmpty icon={empty.icon} title={empty.title}>
          {empty.body}
        </BigEmpty>
      )}
      <FootLink href="/products">{more ? `All products, ${more} more not shown here` : "All products"}</FootLink>
    </section>
  );
}
