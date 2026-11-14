// A product's slice of the knowledge graph, on its page: the product, its code areas and, around them, its newest
// insights and workflow findings, tickets, pull requests and gaps, each a link (graph.ts lays it out, graph-svg.tsx
// draws it). Under it, its insights and workflow findings, with those later work may have overtaken marked "may be
// stale". Server-rendered in its own Suspense boundary, so the page never waits for it.
import { Network } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { GRAPH_DAYS, type GraphFinding, type ProductGraph, productGraph } from "../../server/hub/graph.ts";
import { InlineMarkdown } from "../markdown.tsx";
import { Ago } from "../time.tsx";
import { GraphLegend, GraphSvg } from "./graph-svg.tsx";

const HEADER = "flex flex-wrap items-center justify-between gap-2 border-line border-b px-5 py-3.5";
const MONTHS = Math.round(GRAPH_DAYS / 30);

export function ProductGraphPanel({ productId, viewerId }: { productId: string; viewerId: string }) {
  return (
    <Suspense fallback={<GraphSkeleton />}>
      <GraphCard productId={productId} viewerId={viewerId} />
    </Suspense>
  );
}

function Header() {
  return (
    <header className={HEADER}>
      <h2 id="graph-title" className="flex items-center gap-2 font-semibold text-[15px]">
        <Network size={16} aria-hidden className="text-ink-3" /> How it links up
      </h2>
      <span className="text-[12.5px] text-ink-3">Approved work, last {MONTHS} months</span>
    </header>
  );
}

function GraphSkeleton() {
  return (
    <section className="card" aria-labelledby="graph-title" aria-busy="true">
      <Header />
      <div className="px-5 py-4">
        <div className="mx-auto aspect-[4/3] w-full max-w-[640px] animate-pulse rounded-[14px] bg-surface-2" />
      </div>
    </section>
  );
}

async function GraphCard({ productId, viewerId }: { productId: string; viewerId: string }) {
  // v1 and untested: a failure here is only logged, and the panel stays away, so it never breaks the page around it.
  let graph: ProductGraph | null;
  try {
    graph = await productGraph(productId, viewerId);
  } catch (error) {
    console.error("graph: the product's graph couldn't be read", error);
    return null;
  }
  if (!graph) return null;
  const drawable = graph.nodes.length > 1;
  return (
    <section className="card" aria-labelledby="graph-title">
      <Header />
      {drawable ? (
        <>
          <p className="px-5 pt-3.5 text-[13px] text-ink-3">
            Its code areas, and the insights, tickets, pull requests and gaps about each. Every box opens what it stands
            for.
          </p>
          <GraphLegend graph={graph} />
          <div className="px-2 pb-3 sm:px-4">
            <GraphSvg graph={graph} titleId="graph-title" />
          </div>
        </>
      ) : (
        <p className="px-5 py-4 text-[13px] text-ink-3">
          Nothing to draw yet. Once approved session summaries name the code areas they touched, link tickets and pull
          requests, or share insights, they're drawn here around the product.
        </p>
      )}
      <Findings graph={graph} />
    </section>
  );
}

function Findings({ graph }: { graph: ProductGraph }) {
  const { findings, staleCount, findingCount } = graph;
  return (
    <section aria-labelledby="graph-findings-title" className="border-line border-t">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-5 pt-3.5 pb-1">
        <h3 id="graph-findings-title" className="font-medium text-[14px]">
          Insights and workflow findings
        </h3>
        <span className="text-[12.5px] text-ink-3">
          {staleCount
            ? `${staleCount} of ${findingCount} may be stale`
            : findingCount
              ? "None look stale"
              : `None in the last ${MONTHS} months`}
        </span>
      </header>
      {findings.length ? (
        <ul className="divide-y divide-line">
          {findings.map((f) => (
            <FindingRow key={f.id} finding={f} />
          ))}
        </ul>
      ) : (
        <p className="px-5 pt-1 pb-4 text-[13px] text-ink-3">
          Insights and workflow findings people approve show here. One is marked “may be stale” when a later session
          works in the code area it's about.
        </p>
      )}
      {findingCount > findings.length ? (
        <p className="border-line border-t px-5 py-3 text-[12.5px] text-ink-3">
          Showing {findings.length} of {findingCount}; the rest are in What's new and on each session's page.
        </p>
      ) : null}
    </section>
  );
}

function FindingRow({ finding }: { finding: GraphFinding }) {
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
        <span className="chip">{finding.kindLabel}</span>
        {finding.stale ? <span className="chip status-candidate">May be stale</span> : null}
        <span className="ml-auto flex-none">
          Shared <Ago at={finding.at} />
        </span>
      </div>
      <Link
        href={finding.href}
        className="mt-1 flex min-h-11 items-center break-words text-[14px] leading-snug underline-offset-4 hover:underline sm:min-h-0"
      >
        <InlineMarkdown links={false}>{finding.text}</InlineMarkdown>
      </Link>
      {finding.stale ? (
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          Later work changed <span className="font-mono text-[12px]">{finding.stale.place}</span>:{" "}
          <Link href={finding.stale.later.href} className="text-accent-text underline-offset-4 hover:underline">
            {finding.stale.later.title}
          </Link>
          , <Ago at={finding.stale.later.at} />
          {finding.stale.sessions > 1
            ? ` (and ${finding.stale.sessions - 1} more ${finding.stale.sessions === 2 ? "session" : "sessions"})`
            : ""}
          .
        </p>
      ) : null}
    </li>
  );
}
