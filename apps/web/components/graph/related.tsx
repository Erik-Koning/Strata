// "Related": the approved work a session, a gap or a product shares links with (graph.ts), each with what links them,
// the closest first. On a session's page, its own insights that later work may have overtaken come first. Server-rendered
// in its own Suspense boundary, so the page around it never waits for it.
import { Waypoints } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { type Related, type RelatedItem, type RelatedSubject, relatedTo } from "../../server/hub/graph.ts";
import { Ago } from "../time.tsx";

const HEADER = "flex flex-wrap items-center gap-x-2 gap-y-1 border-line border-b px-5 py-3.5";
const REASONS_SHOWN = 3;

type Subject = "session" | "gap" | "product" | "record";

const subjectOf = (subject: RelatedSubject): Subject =>
  "sessionId" in subject ? "session" : "gapId" in subject ? "gap" : "productId" in subject ? "product" : "record";

const LEDE: Record<Subject, string> = {
  session: "Approved work that shares a ticket, pull request, code area or context gap with this session.",
  record: "Approved work that shares a ticket, pull request, code area or context gap with this finding.",
  gap: "Work on the same tickets and code areas as the sessions this gap came up in, and gaps that came up alongside it.",
  product: "Other products whose work shares tickets, pull requests or context gaps with this one.",
};

const EMPTY: Record<Subject, string> = {
  session:
    "Nothing linked yet. Other sessions show here once they share a ticket, a pull request, a code area or a context gap with this one.",
  record:
    "Nothing linked yet. Other work shows here once it shares a ticket, a pull request, a code area or a context gap with this finding.",
  gap: "Nothing linked yet. When other sessions work on the same tickets or code areas as the ones this gap came up in, they show here.",
  product: "No other product shares a ticket, a pull request or a context gap with this one yet.",
};

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function RelatedPanel({ subject, viewerId }: { subject: RelatedSubject; viewerId: string }) {
  return (
    <Suspense fallback={<RelatedSkeleton />}>
      <RelatedCard subject={subject} viewerId={viewerId} />
    </Suspense>
  );
}

function Header() {
  return (
    <header className={HEADER}>
      <Waypoints size={16} aria-hidden className="flex-none text-ink-3" />
      <h2 id="related-title" className="font-semibold text-[15px]">
        Related
      </h2>
    </header>
  );
}

function RelatedSkeleton() {
  return (
    <section className="card" aria-labelledby="related-title" aria-busy="true">
      <Header />
      <div className="flex flex-col gap-3 px-5 py-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <span className="block h-3 w-1/3 animate-pulse rounded-full bg-surface-2" />
            <span className="block h-3.5 w-5/6 animate-pulse rounded-full bg-surface-2" />
          </div>
        ))}
      </div>
    </section>
  );
}

async function RelatedCard({ subject, viewerId }: { subject: RelatedSubject; viewerId: string }) {
  const kind = subjectOf(subject);
  // v1 and untested: a failure here is only logged, and the panel stays away, so it never breaks the page around it.
  let related: Related;
  try {
    related = await relatedTo(subject, viewerId);
  } catch (error) {
    console.error("graph: related work couldn't be read", error);
    return null;
  }
  return (
    <section className="card" aria-labelledby="related-title">
      <Header />
      {related.stale.length ? <StaleList stale={related.stale} /> : null}
      {related.items.length ? (
        <>
          <p className="px-5 pt-3.5 text-[13px] text-ink-3">{LEDE[kind]} The closest first.</p>
          <ul className="divide-y divide-line">
            {related.items.map((item) => (
              <Item key={item.key} item={item} />
            ))}
          </ul>
          {related.more ? (
            <p className="border-line border-t px-5 py-3 text-[12.5px] text-ink-3">
              And {related.more === 1 ? "one more, less closely linked" : `${related.more} more, less closely linked`}.
            </p>
          ) : null}
        </>
      ) : (
        <p className="px-5 py-4 text-[13px] text-ink-3">{EMPTY[kind]}</p>
      )}
    </section>
  );
}

function Item({ item }: { item: RelatedItem }) {
  const shown = item.reasons.slice(0, REASONS_SHOWN);
  const rest = item.reasons.length - shown.length;
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
        <span className={`chip ${item.kind === "gap" && !item.resolved ? "status-candidate" : ""}`}>{item.label}</span>
        {item.product ? <span className="min-w-0 truncate">{item.product.name}</span> : null}
        {item.at ? <Ago at={item.at} className="ml-auto flex-none" /> : null}
      </div>
      <Link
        href={item.href}
        className="mt-1 flex min-h-11 items-center break-words font-medium text-[14px] leading-snug underline-offset-4 hover:underline sm:min-h-0"
      >
        {item.title}
      </Link>
      <p className="mt-0.5 text-[12.5px] text-ink-3">
        {sentence(shown.map((r) => r.text).join(" · "))}
        {rest > 0 ? ` · ${rest === 1 ? "one more link" : `${rest} more links`}` : ""}
      </p>
    </li>
  );
}

function StaleList({ stale }: { stale: Related["stale"] }) {
  return (
    <div className="border-line border-b px-5 py-3.5">
      <h3 className="flex flex-wrap items-center gap-2 font-medium text-[13.5px]">
        <span className="chip status-candidate">May be stale</span>
        {stale.length === 1 ? "A finding here may be out of date" : "Findings here may be out of date"}
      </h3>
      <ul className="mt-2.5 flex flex-col gap-3">
        {stale.map((s) => (
          <li key={s.recordId} className="text-[13.5px]">
            <p className="break-words">
              <span className="text-ink-3">{s.kindLabel}: </span>
              {s.text}
            </p>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              Later work changed <span className="font-mono text-[12px]">{s.place}</span>:{" "}
              <Link href={s.later.href} className="text-accent-text underline-offset-4 hover:underline">
                {s.later.title}
              </Link>
              , <Ago at={s.later.at} />
              {s.sessions > 1 ? ` (and ${s.sessions - 1} more ${s.sessions === 2 ? "session" : "sessions"})` : ""}.
              Check it still holds.
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
