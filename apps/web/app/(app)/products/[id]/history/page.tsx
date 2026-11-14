import { ArrowLeft, ArrowLeftRight, MoveRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ContextColumn } from "../../../../../components/history/context.tsx";
import { DiffView } from "../../../../../components/history/diff-view.tsx";
import { ProductImpact } from "../../../../../components/history/impact.tsx";
import { Changes, historyHref, Timeline } from "../../../../../components/history/timeline.tsx";
import type { Commit } from "../../../../../server/hub/git-history.ts";
import { productHistory } from "../../../../../server/hub/product-history.ts";
import { getProduct } from "../../../../../server/hub/products.ts";
import { getViewer, requireViewer } from "../../../../../server/viewer.ts";

export async function generateMetadata({ params }: PageProps<"/products/[id]/history">): Promise<Metadata> {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  const product = viewer ? await getProduct(id, viewer.userId) : null;
  return { title: product ? `${product.name} history` : "History" };
}

const one = (v: string | string[] | undefined): string | null =>
  typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;

function Back({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/products/${encodeURIComponent(id)}`} className="btn btn-quiet btn-sm mb-3 -ml-2.5 max-md:min-h-11">
      <ArrowLeft size={15} aria-hidden /> {name}
    </Link>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card px-6 py-14 text-center">
      <p className="font-semibold text-[15px]">{title}</p>
      <div className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">{children}</div>
    </div>
  );
}

const option = (c: Commit) => `${c.short}  ${c.subject.length > 64 ? `${c.subject.slice(0, 63)}…` : c.subject}`;

export default async function ProductHistoryPage({ params, searchParams }: PageProps<"/products/[id]/history">) {
  const viewer = await requireViewer();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const result = await productHistory(id, viewer, { before: one(query.before), after: one(query.after) });
  if (result.status === "missing") notFound();
  if (result.status === "moved") redirect(`/products/${encodeURIComponent(result.id)}/history`);

  if (result.status !== "ok") {
    const { product } = result;
    return (
      <>
        <Back id={product.id} name={product.name} />
        <h1 className="mb-6 font-semibold text-[30px] leading-[1.1] tracking-[-0.03em]">History</h1>
        {result.status === "no-clone" ? (
          <Notice title="This product's code history isn't available here">
            <p>
              Strata reads history only from a local clone an operator has named for one of its repositories, in{" "}
              <code className="font-mono text-[13px]">STRATA_LOCAL_REPOS</code>.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {product.repos.map((r) => (
                <span key={`${r.repo}#${r.path}`} className="chip chip-mono">
                  {r.path ? `${r.repo}/${r.path}` : r.repo}
                </span>
              ))}
            </div>
          </Notice>
        ) : result.status === "empty" ? (
          <Notice title="No commits yet">
            <p>The clone for {result.repo} has no commits on any branch.</p>
          </Notice>
        ) : (
          <Notice title="Git couldn't read this product's clone">
            <p>{result.message}</p>
          </Notice>
        )}
      </>
    );
  }

  const { page } = result;
  const { product, before, after, commits, diff, range, context } = page;
  const same = before?.sha === after.sha;

  return (
    <>
      <Back id={product.id} name={product.name} />
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-semibold text-[30px] text-ink leading-[1.1] tracking-[-0.03em]">History</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-ink-2">
            How {product.name} changed, why, and what proves it.
          </p>
        </div>
        <span className="chip chip-mono" title="The repository this history is read from">
          {page.repo}
        </span>
      </header>

      {/* The comparison itself: Before and After, always visible, and the form that changes them without the rail. */}
      <form
        key={`${before?.sha ?? "root"}..${after.sha}`}
        autoComplete="off"
        method="get"
        action={`/products/${encodeURIComponent(product.id)}/history`}
        className="card mb-5 grid items-end gap-3 px-4 py-3.5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]"
        aria-label="Compare two commits"
      >
        <label className="min-w-0">
          <span className="mb-1 flex items-center gap-2 font-medium text-[12.5px] text-ink-2">
            <span
              className="inline-block size-[11px] rounded-full shadow-[inset_0_0_0_2.5px_var(--accent)]"
              aria-hidden
            />
            Before
          </span>
          <select name="before" defaultValue={before?.sha ?? "root"} className="input w-full font-mono text-[12.5px]">
            {commits.map((c) => (
              <option key={c.sha} value={c.sha}>
                {option(c)}
              </option>
            ))}
            <option value="root">Nothing (the first commit's own changes)</option>
          </select>
        </label>
        <Link
          href={historyHref(product.id, after.sha, before?.sha ?? null)}
          className="btn btn-quiet btn-sm mb-0.5 justify-self-center max-md:min-h-11"
          aria-label="Swap Before and After"
          title="Swap Before and After"
        >
          <ArrowLeftRight size={15} aria-hidden className="max-lg:rotate-90" />
        </Link>
        <label className="min-w-0">
          <span className="mb-1 flex items-center gap-2 font-medium text-[12.5px] text-ink-2">
            <span className="inline-block size-[11px] rounded-full bg-accent" aria-hidden />
            After
          </span>
          <select name="after" defaultValue={after.sha} className="input w-full font-mono text-[12.5px]">
            {commits.map((c) => (
              <option key={c.sha} value={c.sha}>
                {option(c)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary max-md:min-h-11">
          Compare
        </button>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3 lg:col-span-4">
          <code className="font-mono">{before?.short ?? "empty tree"}</code>
          <MoveRight size={13} aria-label="to" />
          <code className="font-mono">{after.short}</code>
          <span>
            {range.length} {range.length === 1 ? "commit" : "commits"} brought in
          </span>
          {range.length === 1 && after.files !== null ? (
            <Changes files={after.files} added={after.added} removed={after.removed} />
          ) : null}
          {page.ignored.length ? (
            <span className="text-amber">
              The link named {page.ignored.join(" and ")} commits this history doesn't have, so the newest change is
              shown instead.
            </span>
          ) : null}
        </p>
      </form>

      <div className="grid items-start gap-4 lg:grid-cols-[228px_minmax(0,1fr)] xl:grid-cols-[228px_minmax(0,1fr)_296px]">
        <div className="max-lg:order-3 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:rounded-[var(--radius)]">
          <Timeline
            productId={product.id}
            commits={commits}
            before={before?.sha ?? null}
            after={after.sha}
            range={range}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4 max-lg:order-1">
          <ProductImpact handoffs={context.handoffs} range={range} commits={commits} />
          <DiffView diff={diff} same={same} />
        </div>
        <aside
          className="min-w-0 max-lg:order-2 lg:col-start-2 xl:col-start-3 xl:row-start-1"
          aria-label="What Strata knows about this change"
        >
          <ContextColumn
            handoffs={context.handoffs}
            sessions={context.sessions}
            gitAuthors={page.gitAuthors}
            before={before}
            after={after}
          />
        </aside>
      </div>
    </>
  );
}
