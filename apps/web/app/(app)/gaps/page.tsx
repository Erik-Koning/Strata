import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { GapActions } from "../../../components/gaps/gap-actions.tsx";
import { Answer, Owner, SeenChips, SeenWhen } from "../../../components/gaps/gap-parts.tsx";
import { InlineMarkdown } from "../../../components/markdown.tsx";
import { type Gap, listGaps } from "../../../server/hub/gaps.ts";
import { listProducts } from "../../../server/hub/products.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";
import { reopenGap, resolveGap, takeGap } from "./actions.ts";

export const metadata: Metadata = { title: "Gaps" };

const SOURCES = [
  { value: "", label: "From agents and people" },
  { value: "agents", label: "From agents" },
  { value: "people", label: "From people" },
] as const;

// A list this long is already more than anyone reads; filters narrow it.
const SHOWN = 200;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function GapsPage({ searchParams }: PageProps<"/gaps">) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const status = one(params.status) === "resolved" ? "resolved" : "open";
  const sourceParam = one(params.source);
  const source = sourceParam === "agents" || sourceParam === "people" ? sourceParam : undefined;
  const productId = one(params.product)?.trim().slice(0, 120) || undefined;
  const filtered = Boolean(source || productId);

  const [all, products] = await Promise.all([listGaps({}, viewer), listProducts(viewer)]);
  const matching = filtered ? await listGaps({ productId, source }, viewer) : all;
  const open = matching.filter((g) => g.status === "open");
  const resolved = matching.filter((g) => g.status === "resolved");
  const list = status === "open" ? open : resolved;

  const names = new Map(products.map((p) => [p.id, p.name]));
  const withGaps = new Set(all.flatMap((g) => (g.productId ? [g.productId] : [])));
  const productOptions = products.filter((p) => withGaps.has(p.id) || p.id === productId);

  const href = (change: { status?: string; product?: string; source?: string }) => {
    const next = new URLSearchParams();
    const values = { status, product: productId ?? "", source: source ?? "", ...change };
    if (values.status === "resolved") next.set("status", "resolved");
    if (values.product) next.set("product", values.product);
    if (values.source) next.set("source", values.source);
    const query = next.toString();
    return query ? `/gaps?${query}` : "/gaps";
  };
  const tab = (active: boolean) =>
    `flex min-h-11 items-center gap-2 rounded-[9px] px-3 font-medium text-[14px] sm:min-h-9 ${
      active ? "bg-surface text-ink shadow-[var(--shadow)]" : "text-ink-2 hover:text-ink"
    }`;

  return (
    <>
      <PageHeader
        eyebrow="Gaps"
        title="Context gaps"
        lede="A context gap is something an agent or a person needed to know and couldn't find. The ones that keep coming back are the docs worth writing first."
      />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Open or resolved" className="flex gap-1 self-start rounded-[11px] bg-surface-2 p-1">
          <Link
            href={href({ status: "open" })}
            className={tab(status === "open")}
            aria-current={status === "open" ? "page" : undefined}
          >
            Open <span className="font-normal text-ink-3">{open.length.toLocaleString()}</span>
          </Link>
          <Link
            href={href({ status: "resolved" })}
            className={tab(status === "resolved")}
            aria-current={status === "resolved" ? "page" : undefined}
          >
            Resolved <span className="font-normal text-ink-3">{resolved.length.toLocaleString()}</span>
          </Link>
        </nav>

        <Form
          action="/gaps"
          aria-label="Filter gaps"
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:w-[560px]"
        >
          {status === "resolved" ? <input type="hidden" name="status" value="resolved" /> : null}
          <label>
            <span className="sr-only">Product</span>
            <select name="product" defaultValue={productId ?? ""} className="input min-h-11 text-[14px]">
              <option value="">Every product</option>
              {productOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Where it came from</span>
            <select name="source" defaultValue={source ?? ""} className="input min-h-11 text-[14px]">
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn min-h-11">
            Apply
          </button>
        </Form>
      </div>

      {list.length ? (
        <section className="card" aria-labelledby="gaps-title">
          <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-line border-b px-5 py-3.5">
            <h2 id="gaps-title" className="font-semibold text-[15px]">
              {status === "open" ? "Open gaps" : "Resolved gaps"}
            </h2>
            <p className="text-[13px] text-ink-3">
              {status === "open"
                ? "The ones that come back most first: sessions plus questions."
                : "Most recently resolved first."}
            </p>
          </header>
          <ol className="divide-y divide-line">
            {list.slice(0, SHOWN).map((gap) => (
              <GapRow
                key={gap.id}
                gap={gap}
                product={gap.productId ? names.get(gap.productId) : undefined}
                viewerId={viewer.userId}
              />
            ))}
          </ol>
          {list.length > SHOWN ? (
            <p className="border-line border-t px-5 py-3.5 text-[13px] text-ink-3">
              Showing the first {SHOWN} of {list.length.toLocaleString()}. Filter by product or source to see the rest.
            </p>
          ) : null}
        </section>
      ) : (
        <Empty status={status} filtered={filtered} anyGaps={all.length > 0} />
      )}
    </>
  );
}

function GapRow({ gap, product, viewerId }: { gap: Gap; product: string | undefined; viewerId: string }) {
  const owner = gap.owner ? { name: gap.owner.name, mine: gap.owner.id === viewerId } : null;
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-1 basis-72">
        <Link
          href={`/gaps/${gap.id}`}
          className="break-words font-medium text-[14px] leading-snug underline-offset-4 hover:underline"
        >
          <InlineMarkdown links={false}>{gap.text}</InlineMarkdown>
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-ink-3">
          <span className="chip">{product ?? "No product"}</span>
          <SeenChips sessions={gap.sessions} questions={gap.fromPeople} />
          <SeenWhen first={gap.firstSeen.toISOString()} last={gap.lastSeen.toISOString()} />
        </div>
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          <Owner owner={owner} />
        </p>
        {gap.resolution ? (
          <Answer
            resolution={{ ...gap.resolution, at: gap.resolution.at.toISOString() }}
            seenSince={gap.seenSinceResolved}
          />
        ) : null}
      </div>
      <GapActions
        status={gap.status}
        owner={owner}
        take={takeGap.bind(null, gap.id)}
        resolve={resolveGap.bind(null, gap.id)}
        reopen={reopenGap.bind(null, gap.id)}
      />
    </li>
  );
}

function Empty({ status, filtered, anyGaps }: { status: "open" | "resolved"; filtered: boolean; anyGaps: boolean }) {
  const [title, body] = filtered
    ? [
        "Nothing matches these filters",
        status === "open"
          ? "No open gap came from this product or source. Try another, or clear the filters to see every gap."
          : "No resolved gap came from this product or source. Try another, or clear the filters.",
      ]
    : !anyGaps
      ? [
          "No context gaps yet",
          "Gaps come from approved sessions' findings and from questions Ask Strata couldn't answer. When an agent logs one in a session someone approves, or a question goes unanswered, it shows up here.",
        ]
      : status === "open"
        ? [
            "No open gaps",
            "Every gap so far has been answered. New ones come from approved sessions' findings and from questions Ask Strata couldn't answer.",
          ]
        : [
            "Nothing resolved yet",
            "When someone resolves a gap with the doc, ADR or comment that answers it, it moves here, with the link and the note.",
          ];
  return (
    <div className="card px-6 py-12 text-center">
      <p className="font-semibold text-[15px]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">{body}</p>
      {filtered ? (
        <Link
          href={status === "resolved" ? "/gaps?status=resolved" : "/gaps"}
          className="btn btn-sm mt-4 min-h-11 sm:min-h-8"
        >
          Clear filters
        </Link>
      ) : null}
    </div>
  );
}
