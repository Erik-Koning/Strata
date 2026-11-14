// What's waiting for the person's own review, first on everyone's overview: their drafts (on My Day, for people who use
// the plugin) and the memories their sessions suggested (on Memories). Nobody else sees either.
import { ArrowRight, CircleDashed, Inbox, type LucideIcon, NotebookPen } from "lucide-react";
import Link from "next/link";
import type { Waiting } from "../../server/hub/overview.ts";
import { CardHeader } from "./parts.tsx";

function Tile({
  href,
  icon: Icon,
  label,
  count,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  count: number;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-11 items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2/60"
    >
      <span
        className={`grid size-10 flex-none place-items-center rounded-[11px] ${
          count ? "bg-accent-soft text-accent-text" : "bg-surface-2 text-ink-3"
        }`}
      >
        <Icon size={18} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-[14.5px]">{label}</span>
        <span className="block text-[13px] text-ink-3">{count ? hint : "None waiting"}</span>
      </span>
      <span
        className={`flex-none font-semibold text-[26px] tabular-nums leading-none tracking-[-0.03em] ${
          count ? "" : "text-ink-3"
        }`}
      >
        {count.toLocaleString("en-GB")}
      </span>
      <ArrowRight
        size={16}
        aria-hidden
        className="flex-none text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text"
      />
    </Link>
  );
}

export function WaitingForYou({ waiting }: { waiting: Waiting }) {
  const { drafts, candidates } = waiting;
  const total = (drafts ?? 0) + candidates;
  const tiles = [
    ...(drafts === null
      ? []
      : [
          {
            href: "/my-day",
            icon: NotebookPen,
            label: "Drafts to approve",
            count: drafts,
            hint: "From your sessions. Approving one shares it with everyone.",
          },
        ]),
    {
      href: "/memories?status=candidate",
      icon: CircleDashed,
      label: "Memories to keep",
      count: candidates,
      hint: "Your sessions suggested these. Kept ones go to your agents.",
    },
  ];

  return (
    <section className="card mb-6" aria-labelledby="waiting-title">
      <CardHeader id="waiting-title" icon={Inbox} title="Waiting for your review" note="Only you can see these" />
      {total ? (
        <ul
          className={`grid divide-y divide-line ${tiles.length > 1 ? "sm:grid-cols-2 sm:divide-x sm:divide-y-0" : ""}`}
        >
          {tiles.map((tile) => (
            <li key={tile.href} className="min-w-0">
              <Tile {...tile} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
          <p className="min-w-0 flex-1 basis-72 text-[14px] text-ink-3">
            <span className="font-medium text-ink-2">Nothing waiting for you.</span>{" "}
            {drafts === null
              ? "Drafts and suggested memories come from your own Claude Code sessions. Once one is connected, what it drafts waits here for your yes before anyone else sees it."
              : "When one of your sessions ends, its drafts wait in My Day and the memories it suggests wait in Memories, both here first, until you decide."}
          </p>
          {drafts === null ? null : (
            <Link href="/my-day" className="btn btn-sm max-md:min-h-11">
              My Day
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
