// In progress across every product: work shared in the last two weeks, grouped by ticket, else pull request, else
// session, newest first, with its product, who worked on it (by name) and the questions it left open.
import { CircleDot, CircleHelp } from "lucide-react";
import Link from "next/link";
import type { WorkItem } from "../../server/hub/overview.ts";
import { InlineMarkdown } from "../markdown.tsx";
import { names, RefChips, SessionLink } from "../products/refs.tsx";
import { Ago } from "../time.tsx";
import { BigEmpty, CardHeader, FootLink } from "./parts.tsx";

export function WorkList({ work, more }: { work: WorkItem[]; more: number }) {
  return (
    <section className="card" aria-labelledby="work-title">
      <CardHeader id="work-title" icon={CircleDot} title="In progress" note="Shared in the last two weeks" />
      {work.length ? (
        <ul className="divide-y divide-line">
          {work.map((item) => (
            <li key={item.key} className="px-5 py-4">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                <p className="min-w-0 flex-1 basis-64 break-words font-medium text-[15px] leading-snug">{item.title}</p>
                {item.productId ? (
                  <Link
                    href={`/products/${encodeURIComponent(item.productId)}`}
                    className="chip max-md:min-h-11 hover:bg-sunk hover:text-ink"
                  >
                    {item.productName ?? item.productId}
                  </Link>
                ) : null}
              </div>
              {item.people.length ? <p className="mt-1 text-[13px] text-ink-3">With {names(item.people)}</p> : null}
              {item.open.length ? (
                <ul className="mt-2.5 flex flex-col gap-1.5" aria-label="Left open">
                  {item.open.map((question) => (
                    <li key={question.id} className="flex items-start gap-2 text-[13.5px] text-ink-2">
                      <CircleHelp size={15} aria-hidden className="mt-[3px] flex-none text-amber" />
                      <span className="line-clamp-2 min-w-0 flex-1 break-words">
                        <span className="sr-only">Open question: </span>
                        <InlineMarkdown>{question.text}</InlineMarkdown>
                      </span>
                    </li>
                  ))}
                  {item.moreOpen ? (
                    <li className="pl-[23px] text-[12.5px] text-ink-3">
                      {item.moreOpen === 1 ? "One more open question" : `${item.moreOpen} more open questions`}
                    </li>
                  ) : null}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <RefChips refs={item.refs} />
                {item.sessionIds.map((id) => (
                  <SessionLink key={id} sessionId={id} />
                ))}
                {item.moreSessions ? (
                  <span className="text-[12.5px] text-ink-3">and {item.moreSessions} more sessions</span>
                ) : null}
                <Ago at={item.lastAt} className="ml-auto text-[12.5px] text-ink-3" />
              </div>
            </li>
          ))}
          {more ? (
            <li className="px-5 py-3 text-[13px] text-ink-3">
              {more === 1 ? "One more piece" : `${more} more pieces`} of work in progress. Each product's page lists its
              own.
            </li>
          ) : null}
        </ul>
      ) : (
        <BigEmpty icon={CircleDot} title="Nothing in progress">
          Work shows here for two weeks after a session is approved, grouped by its ticket or pull request, with any
          questions it left open.
        </BigEmpty>
      )}
      <FootLink href="/products">Every product's work</FootLink>
    </section>
  );
}
