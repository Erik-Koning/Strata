import { ArrowRight, Boxes, Info, PackageCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { YourAgent } from "../../components/overview/agent.tsx";
import { ProductNewsList } from "../../components/overview/product-news.tsx";
import { AdminCard, GapList, OwnSessions, TimeCard } from "../../components/overview/side.tsx";
import { WaitingForYou } from "../../components/overview/waiting.tsx";
import { WorkList } from "../../components/overview/work.tsx";
import { StatusText } from "../../components/relay/status.tsx";
import { Ago } from "../../components/time.tsx";
import { DEFAULT_ORG } from "../../server/api-auth.ts";
import { listHandoffs } from "../../server/handoffs/service.ts";
import { homeFor, NEWS_DAYS, TIME_DAYS } from "../../server/hub/overview.ts";
import { frozen } from "../../server/memory/frozen.ts";
import { requireViewer } from "../../server/viewer.ts";
import { PageHeader } from "./page-header.tsx";
import { requireCaller } from "./relay/caller.ts";

export const metadata: Metadata = { title: "Overview" };

const GRID = "grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]";

// The overview, by role (server/hub/overview.ts): what's waiting for the person's own review first, then their
// products (an engineer) or every product (a manager, an executive, an admin), then their own agent.
export default async function OverviewPage() {
  const viewer = await requireViewer();
  const home = await homeFor(viewer);
  if (!home) redirect("/sign-in");
  const caller = await requireCaller();
  const [inbox, sent] = await Promise.all([listHandoffs(caller, "inbox"), listHandoffs(caller, "outbox")]);
  // Handed to me first, then mine, newest first within each: the four that most want a look.
  const handoffs = [
    ...inbox.map((h) => ({ ...h, box: "inbox" as const })),
    ...sent.map((h) => ({ ...h, box: "sent" as const })),
  ].slice(0, 4);
  const { layout, waiting, engineer, lead, agent } = home;
  const block = agent.project ? await frozen({ org: DEFAULT_ORG, user: viewer.userId, project: agent.project }) : null;

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={engineer ? "Your products this week" : "Across the products this week"}
        lede={
          engineer
            ? "What's waiting for your review, what changed in the products you work on, and the gaps that keep coming back there."
            : "What's waiting for your review, then what shipped, where tool time went, the gaps that keep coming back, and what's in progress."
        }
      />

      <WaitingForYou waiting={waiting} />

      <section className="card mb-6" aria-labelledby="relay-title">
        <header className="flex items-center justify-between border-line border-b px-5 py-3.5">
          <h2 id="relay-title" className="font-semibold text-[15px]">
            Handoffs
          </h2>
          <Link href="/relay" className="btn btn-quiet btn-sm">
            All handoffs <ArrowRight size={14} aria-hidden />
          </Link>
        </header>
        {handoffs.length ? (
          <ul className="divide-y divide-line">
            {handoffs.map((h) => (
              <li key={h._id}>
                <Link href={`/relay?id=${h._id}`} className="block px-5 py-3 transition-colors hover:bg-surface-2">
                  <span className="block truncate font-medium text-[14px]">{h.title}</span>
                  <span className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                    <StatusText status={h.status} />
                    <span className="min-w-0 truncate">
                      {h.box === "inbox"
                        ? `from ${h.sender.name}`
                        : h.recipient
                          ? `to ${h.recipient.name}`
                          : "not sent"}
                    </span>
                    <Ago at={h.updatedAt} className="ml-auto flex-none" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-[14px] text-ink-3">
            Nothing handed on yet. Run <code className="kbd">/strata:handoff</code> in Claude Code to draft one.
          </p>
        )}
      </section>

      {engineer ? (
        <div className={GRID}>
          <div className="flex min-w-0 flex-col gap-6">
            <ProductNewsList
              id="your-products-title"
              title="Your products"
              note={engineer.mine ? `What's new, last ${NEWS_DAYS} days` : `Every product, until you share work in one`}
              products={engineer.products}
              more={engineer.moreProducts}
              empty={{
                icon: Boxes,
                title: "No products yet",
                body: "A repository becomes a product once someone approves work from it: a session summary from the plugin, or a record from My Day. The ones you work on show here, each with what changed this week.",
              }}
            />
          </div>
          <aside className="flex min-w-0 flex-col gap-6" aria-label="Gaps and your sessions">
            <GapList
              id="gaps-title"
              title={engineer.mine ? "Open gaps in your products" : "Open gaps"}
              gaps={engineer.gaps}
              open={engineer.openGaps}
              href={
                engineer.products.length === 1 && engineer.products[0]?.id && !engineer.moreProducts
                  ? `/gaps?product=${encodeURIComponent(engineer.products[0].id)}`
                  : "/gaps"
              }
              empty="No open gaps here. When an agent or a person can't find something they need about these products, it shows here until someone answers it."
            />
            <OwnSessions sessions={engineer.sessions} />
          </aside>
        </div>
      ) : null}

      {lead ? (
        <>
          {layout.teamsHint ? (
            <p
              role="note"
              className="mb-6 flex items-start gap-2.5 rounded-[12px] border border-line bg-surface-2 px-4 py-3 text-[13.5px] text-ink-2"
            >
              <Info size={16} aria-hidden className="mt-0.5 flex-none text-ink-3" />
              <span>
                This shows every product. It can't narrow to your teams yet: Strata doesn't know which products each
                team works on.
              </span>
            </p>
          ) : null}
          <div className={GRID}>
            <div className="flex min-w-0 flex-col gap-6">
              <ProductNewsList
                id="shipped-title"
                title="Shipped this week"
                note={`Approved work, last ${NEWS_DAYS} days`}
                products={lead.shipped}
                more={lead.moreShipped}
                empty={{
                  icon: PackageCheck,
                  title: "Nothing shipped this week",
                  body: "When someone approves a session summary or a finding, it shows here under its product for a week. Each product's page keeps the weeks before.",
                }}
              />
              <WorkList work={lead.work} more={lead.moreWork} />
            </div>
            <aside className="flex min-w-0 flex-col gap-6" aria-label="Across the products">
              {layout.admin ? <AdminCard /> : null}
              <TimeCard
                totalMs={lead.time.totalMs}
                commands={lead.time.commands}
                top={lead.time.top}
                days={TIME_DAYS}
              />
              <GapList
                id="gaps-title"
                title="Gaps that keep coming back"
                gaps={lead.gaps}
                open={lead.openGaps}
                href="/gaps"
                empty="No open gaps. When an agent or a person can't find something they need, it lands here, the ones that come back most first, until someone answers it."
              />
            </aside>
          </div>
        </>
      ) : null}

      <YourAgent agent={agent} block={block} />
    </>
  );
}
