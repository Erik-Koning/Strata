// The digest's controls: the week, paged back and forth by link, and the products it covers, picked in a GET form, so
// both work without script and every view has an address to bookmark.
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { type DigestWeek, digestHref } from "../../server/hub/digest.ts";

const NAV_BUTTON = "btn btn-sm max-md:min-h-11";

export function WeekNav({ week, productIds, summary }: { week: DigestWeek; productIds: string[]; summary: string }) {
  return (
    <nav aria-label="Weeks" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-3">
      <div className="min-w-0 max-sm:order-first max-sm:basis-full sm:flex-1">
        <p className="font-semibold text-[17px] leading-snug">
          {week.label}
          {week.current ? <span className="font-normal text-ink-3">, so far</span> : null}
        </p>
        <p className="mt-0.5 text-[13px] text-ink-3">
          {week.range} <span aria-hidden>·</span> <span className="tabular-nums">{week.isoWeek}</span> (UTC)
        </p>
        <p className="mt-1.5 text-[14px] text-ink-2">{summary}.</p>
      </div>
      <Link href={digestHref({ week: week.previous, productIds })} className={NAV_BUTTON}>
        <ChevronLeft size={15} aria-hidden /> Previous week
      </Link>
      {week.next ? (
        <Link href={digestHref({ week: week.weeksAgo === 1 ? null : week.next, productIds })} className={NAV_BUTTON}>
          Next week <ChevronRight size={15} aria-hidden />
        </Link>
      ) : null}
      {week.weeksAgo > 1 ? (
        <Link href={digestHref({ productIds })} className="btn btn-quiet btn-sm max-md:min-h-11">
          This week
        </Link>
      ) : null}
    </nav>
  );
}

export function ProductPicker({
  products,
  picked,
  week,
}: {
  products: { id: string; name: string }[];
  picked: string[];
  // The week's key, kept when the form is sent; null for this week.
  week: string | null;
}) {
  const chosen = new Set(picked);
  return (
    <form action="/digest" key={picked.join(" ")} className="card mb-6 p-4 sm:p-5" aria-labelledby="digest-products">
      <fieldset>
        <legend id="digest-products" className="label">
          Products
        </legend>
        <div className="flex flex-wrap gap-2">
          {products.map((product) => (
            <label
              key={product.id}
              className="flex min-h-11 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-[10px] border border-line-strong px-3 text-[14px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-text sm:min-h-9"
            >
              <input
                type="checkbox"
                name="product"
                value={product.id}
                defaultChecked={chosen.has(product.id)}
                className="size-4 flex-none accent-[var(--accent)]"
              />
              <span className="truncate">{product.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {week ? <input type="hidden" name="week" value={week} /> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-sm max-md:min-h-11">
          Show these products
        </button>
        {picked.length ? (
          <Link href={digestHref({ week })} className="btn btn-quiet btn-sm max-md:min-h-11">
            Every product
          </Link>
        ) : null}
      </div>
      <p className="mt-3 text-[13px] text-ink-3">
        Following products, so the digest keeps your picks and arrives by email each week, comes later. For now, pick
        them here and bookmark the page.
      </p>
    </form>
  );
}
