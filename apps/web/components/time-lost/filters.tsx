// The time page's filters: the range as links, the product as a GET form, so both work without script.
import Form from "next/form";
import Link from "next/link";
import { DEFAULT_RANGE, RANGES, type TimeFilters, timeHref } from "../../server/hub/time-page.ts";

export function TimeFilterBar({
  filters,
  products,
}: {
  filters: TimeFilters;
  products: { id: string; name: string }[];
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <nav aria-label="Range" className="flex gap-1.5">
        {RANGES.map((days) => {
          const current = filters.days === days;
          return (
            <Link
              key={days}
              href={timeHref({ ...filters, days })}
              aria-current={current ? "page" : undefined}
              className={`chip min-h-9 px-3 text-[13px] tabular-nums max-md:min-h-11 ${current ? "bg-ink text-bg" : "hover:bg-sunk"}`}
            >
              {days} days
            </Link>
          );
        })}
      </nav>
      <Form action="/time" aria-label="Filter by product" className="flex min-w-0 flex-1 gap-2 sm:max-w-md">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Product</span>
          <select
            key={filters.productId ?? ""}
            name="product"
            defaultValue={filters.productId ?? ""}
            className="input max-md:min-h-11"
          >
            <option value="">Every product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {filters.days !== DEFAULT_RANGE ? <input type="hidden" name="range" value={filters.days} /> : null}
        <button type="submit" className="btn min-h-[42px] max-md:min-h-11">
          Apply
        </button>
      </Form>
    </div>
  );
}
