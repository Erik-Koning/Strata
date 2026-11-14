// One product on the products list: its repositories, its two latest session summaries, and how many gaps it has open
// and how much time was lost on its tools lately. The whole card leads to the product's page.
import { ArrowRight, Boxes, Puzzle, Timer } from "lucide-react";
import Link from "next/link";
import { type ProductCard as Card, durationLabel } from "../../server/hub/product-page.ts";
import { Ago } from "../time.tsx";

export function ProductCard({ product, days }: { product: Card; days: number }) {
  return (
    <Link
      href={`/products/${encodeURIComponent(product.id)}`}
      className="card group flex min-w-0 flex-1 flex-col transition-colors hover:border-line-strong"
    >
      <div className="flex-1 px-5 pt-4 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 flex-none place-items-center rounded-[9px] bg-accent-soft text-accent-text">
            <Boxes size={16} aria-hidden />
          </span>
          <h2 className="min-w-0 flex-1 truncate font-semibold text-[16px]">{product.name}</h2>
          <ArrowRight
            size={16}
            aria-hidden
            className="flex-none text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text"
          />
        </div>
        <p className="mt-1.5 truncate font-mono text-[12px] text-ink-3">
          {product.repos.map((r) => (r.path ? `${r.repo} / ${r.path}` : r.repo)).join(", ")}
        </p>
        <div className="mt-4">
          <p className="eyebrow">Latest</p>
          {product.latest.length ? (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {product.latest.map((item) => (
                <li key={item.sessionId} className="flex items-baseline gap-3">
                  <span className="line-clamp-1 min-w-0 flex-1 break-words text-[14px] text-ink-2">{item.title}</span>
                  <Ago at={item.at} className="flex-none text-[12.5px] text-ink-3" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[13px] text-ink-3">No session summaries yet, only findings.</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-line border-t px-5 py-2.5 text-[12.5px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <Puzzle size={15} aria-hidden />
          {product.openGaps === 1 ? "1 open gap" : product.openGaps ? `${product.openGaps} open gaps` : "No open gaps"}
        </span>
        <span className="flex items-center gap-1.5">
          <Timer size={15} aria-hidden />
          {product.lostMs ? `${durationLabel(product.lostMs)} lost on tools` : "No time lost"}, last {days} days
        </span>
      </div>
    </Link>
  );
}
