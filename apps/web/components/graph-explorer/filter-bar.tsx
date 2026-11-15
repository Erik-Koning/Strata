"use client";
// The graph's filters, all in the address so a view can be linked to: scope, product, kinds, range, minimum connections
// and, for memories, status. Every choice is a link, or a select that goes to one; without script the selects submit
// as a GET form.
import Form from "next/form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import {
  GRAPH_RANGES,
  type GraphFilters,
  type GraphNodeKind,
  type GraphScope,
  graphHref,
  KIND_COLOR,
  KIND_LABEL,
  kindsOf,
  MEMORY_STATUS_FILTERS,
  MIN_DEGREES,
  RANGE_LABEL,
} from "../../server/hub/graph-model.ts";

const SCOPES: { scope: GraphScope; label: string }[] = [
  { scope: "org", label: "Organisation" },
  { scope: "product", label: "Product" },
  { scope: "mine", label: "My memories" },
];

const STATUS_LABEL = { all: "Both", active: "Remembered", candidate: "Needs review" } as const;

export function FilterBar({
  filters,
  products,
  extra,
}: {
  filters: GraphFilters;
  products: { id: string; name: string }[];
  // The explorer's own state to keep in every link (the list view).
  extra: Record<string, string | null>;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const href = (change: Partial<GraphFilters>) => graphHref({ ...filters, ...change }, extra);
  const all = kindsOf(filters.scope);
  const toggle = (kind: GraphNodeKind) =>
    href({
      kinds: filters.kinds.includes(kind) ? filters.kinds.filter((k) => k !== kind) : [...filters.kinds, kind],
    });
  const go = (change: Partial<GraphFilters>) => router.push(href(change), { scroll: false });

  const segment = (current: boolean) =>
    `flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-[9px] px-3 font-medium text-[14px] sm:min-h-9 sm:flex-none ${
      current ? "bg-surface text-ink shadow-[var(--shadow)]" : "text-ink-2 hover:text-ink"
    }`;
  const chip = (current: boolean) =>
    `chip min-h-11 px-3 text-[13px] sm:min-h-8 ${current ? "bg-ink text-bg" : "hover:bg-surface-3"}`;

  return (
    <div className="mb-5 flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Scope" className="flex gap-1 rounded-[11px] bg-surface-2 p-1 lg:self-start">
          {SCOPES.map(({ scope, label }) => (
            <Link
              key={scope}
              href={graphHref(
                {
                  ...filters,
                  scope,
                  kinds: [...kindsOf(scope)],
                  productId: scope === "product" ? (filters.productId ?? null) : null,
                  status: "all",
                },
                extra,
              )}
              aria-current={filters.scope === scope ? "page" : undefined}
              className={segment(filters.scope === scope)}
              scroll={false}
            >
              {label}
            </Link>
          ))}
        </nav>

        <Form
          ref={form}
          action="/graph"
          aria-label="Narrow the graph"
          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
        >
          {filters.scope !== "org" ? <input type="hidden" name="scope" value={filters.scope} /> : null}
          {filters.kinds.length !== all.length ? (
            <input type="hidden" name="kinds" value={filters.kinds.length ? filters.kinds.join(",") : "none"} />
          ) : null}
          {filters.range !== "all" ? <input type="hidden" name="range" value={filters.range} /> : null}
          {filters.status !== "all" ? <input type="hidden" name="status" value={filters.status} /> : null}
          {filters.size !== "degree" ? <input type="hidden" name="size" value={filters.size} /> : null}
          {extra.view ? <input type="hidden" name="view" value={extra.view} /> : null}
          {filters.scope === "product" ? (
            <label className="flex min-w-0 items-center gap-2 sm:w-64">
              <span className="sr-only">Product</span>
              <select
                key={filters.productId ?? ""}
                name="product"
                defaultValue={filters.productId ?? ""}
                onChange={(e) => go({ productId: e.target.value || null })}
                className="input min-h-11 text-[14px] sm:min-h-9"
              >
                {products.some((p) => p.id === filters.productId) ? null : <option value="">Choose a product</option>}
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap text-[13px] text-ink-2">At least</span>
            <select
              key={filters.minDegree}
              name="min"
              defaultValue={String(filters.minDegree)}
              onChange={(e) => go({ minDegree: Number(e.target.value) })}
              className="input min-h-11 w-auto text-[14px] sm:min-h-9"
            >
              {MIN_DEGREES.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "any" : n} {n === 1 ? "connection" : "connections"}
                </option>
              ))}
            </select>
          </label>
          <noscript>
            <button type="submit" className="btn min-h-11">
              Apply
            </button>
          </noscript>
        </Form>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <fieldset className="min-w-0">
          <legend className="eyebrow mb-1.5">Kinds shown</legend>
          <ul className="flex flex-wrap gap-1.5">
            {all.map((kind) => {
              const on = filters.kinds.includes(kind);
              return (
                <li key={kind}>
                  <Link
                    href={toggle(kind)}
                    scroll={false}
                    className={`chip min-h-11 px-2.5 text-[13px] sm:min-h-8 ${
                      on
                        ? "bg-surface text-ink shadow-[var(--shadow)]"
                        : "bg-transparent text-ink-3 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:text-ink-2"
                    }`}
                  >
                    <span className={`dot ${on ? "" : "dot-hollow"}`} style={{ color: KIND_COLOR[kind] }} aria-hidden />
                    {KIND_LABEL[kind].many}
                    <span className="sr-only">{on ? ", shown: hide them" : ", hidden: show them"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end xl:flex-none">
          <nav aria-label="Range" className="min-w-0">
            <p className="eyebrow mb-1.5">Range</p>
            <ul className="flex flex-wrap gap-1.5">
              {GRAPH_RANGES.map((range) => (
                <li key={range}>
                  <Link
                    href={href({ range })}
                    scroll={false}
                    aria-current={filters.range === range ? "page" : undefined}
                    className={chip(filters.range === range)}
                  >
                    {range === "all" ? "All time" : RANGE_LABEL[range]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {filters.scope === "mine" ? (
            <nav aria-label="Status" className="min-w-0">
              <p className="eyebrow mb-1.5">Status</p>
              <ul className="flex flex-wrap gap-1.5">
                {MEMORY_STATUS_FILTERS.map((status) => (
                  <li key={status}>
                    <Link
                      href={href({ status })}
                      scroll={false}
                      aria-current={filters.status === status ? "page" : undefined}
                      className={chip(filters.status === status)}
                    >
                      {STATUS_LABEL[status]}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
