// In progress on a product's page: work shared in the last two weeks, grouped by ticket, else pull request, else
// session, newest first, with the questions its sessions left open.
import { CircleDot, CircleHelp } from "lucide-react";
import type { WorkView } from "../../server/hub/product-page.ts";
import { InlineMarkdown } from "../markdown.tsx";
import { Ago } from "../time.tsx";
import { names, RefChips, SessionLink } from "./refs.tsx";

export function InProgress({ work, moreWork }: { work: WorkView[]; moreWork: number }) {
  return (
    <section className="card" aria-labelledby="in-progress-title">
      <header className="flex flex-wrap items-center justify-between gap-2 border-line border-b px-5 py-3.5">
        <h2 id="in-progress-title" className="font-semibold text-[15px]">
          In progress
        </h2>
        <span className="text-[12.5px] text-ink-3">Shared in the last two weeks</span>
      </header>
      {work.length ? (
        <ul className="divide-y divide-line">
          {work.map((item) => (
            <li key={item.key} className="px-5 py-4">
              <p className="font-medium text-[15px] leading-snug">{item.title}</p>
              {item.people.length ? <p className="mt-1 text-[13px] text-ink-3">With {names(item.people)}</p> : null}
              {item.open.length ? (
                <ul className="mt-3 flex flex-col gap-2" aria-label="Left open">
                  {item.open.map((question) => (
                    <li key={question.id} className="flex items-start gap-2 text-[13.5px] text-ink-2">
                      <CircleHelp size={15} aria-hidden className="mt-[3px] flex-none text-amber" />
                      <span className="min-w-0 flex-1 break-words">
                        <span className="sr-only">Open question: </span>
                        <InlineMarkdown>{question.text}</InlineMarkdown>
                      </span>
                    </li>
                  ))}
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
          {moreWork ? (
            <li className="px-5 py-3 text-[13px] text-ink-3">
              {moreWork} older pieces of work aren't shown. Ask about this product to dig into them.
            </li>
          ) : null}
        </ul>
      ) : (
        <div className="px-6 py-12 text-center">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
            <CircleDot size={17} aria-hidden />
          </span>
          <p className="mt-4 font-semibold text-[15px]">Nothing in progress</p>
          <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
            Work shows up here for two weeks after a session in this product is approved, grouped by its ticket or pull
            request, with any questions it left open.
          </p>
        </div>
      )}
    </section>
  );
}
