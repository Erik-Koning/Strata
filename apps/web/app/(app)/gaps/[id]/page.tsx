import { ArrowLeft, Bot, CircleCheck, MessageCircleQuestion, RotateCcw, UserCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GapActions } from "../../../../components/gaps/gap-actions.tsx";
import { Answer, Owner, plural, SeenChips } from "../../../../components/gaps/gap-parts.tsx";
import { Ago } from "../../../../components/time.tsx";
import { getGap } from "../../../../server/hub/gaps.ts";
import { listProducts } from "../../../../server/hub/products.ts";
import { requireViewer } from "../../../../server/viewer.ts";
import { PageHeader } from "../../page-header.tsx";
import { reopenGap, resolveGap, takeGap } from "../actions.ts";
import { type GapEvent, gapHistory, gapSources } from "../detail.ts";

export const metadata: Metadata = { title: "Context gap" };

const SOURCES_SHOWN = 20;
const HISTORY_SHOWN = 50;

const webLink = (url: string | null): string | null => (url && /^https?:\/\/\S+$/i.test(url) ? url : null);

// "Came up in 3 sessions, and was asked twice in Ask Strata without an answer. "
function seenLine(sessions: number, questions: number): string {
  const asked = `asked ${questions === 1 ? "once" : questions === 2 ? "twice" : `${questions.toLocaleString()} times`} in Ask Strata without an answer`;
  if (sessions && questions) return `Came up in ${plural(sessions, "session")}, and was ${asked}. `;
  if (sessions) return `Came up in ${plural(sessions, "session")}. `;
  if (questions) return `Was ${asked}. `;
  return "";
}

export default async function GapPage({ params }: PageProps<"/gaps/[id]">) {
  const viewer = await requireViewer();
  const { id } = await params;
  const gap = await getGap(id, viewer);
  if (!gap) notFound();
  const [sources, history, products] = await Promise.all([
    gapSources(gap, viewer, SOURCES_SHOWN),
    gapHistory(gap.id, viewer, HISTORY_SHOWN),
    listProducts(viewer),
  ]);
  const names = new Map(products.map((p) => [p.id, p.name]));
  const productName = gap.productId ? names.get(gap.productId) : undefined;
  const owner = gap.owner ? { name: gap.owner.name, mine: gap.owner.id === viewer.userId } : null;
  const questions = history.filter((e) => e.kind === "question");
  const lastQuestion = questions[0]?.at;
  const moreSessions = gap.sessionIds.length - sources.length;

  return (
    <>
      <Link
        href="/gaps"
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink sm:min-h-8"
      >
        <ArrowLeft size={15} aria-hidden />
        Context gaps
      </Link>
      <PageHeader
        eyebrow={gap.status === "open" ? "Open context gap" : "Resolved context gap"}
        title={gap.text}
        lede={
          <>
            {seenLine(gap.sessions, gap.fromPeople)}
            First seen <Ago at={gap.firstSeen.toISOString()} />, last seen <Ago at={gap.lastSeen.toISOString()} />.
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <section className="card" aria-labelledby="owner-title">
          <header className="border-line border-b px-5 py-3.5">
            <h2 id="owner-title" className="font-semibold text-[15px]">
              Owner and answer
            </h2>
          </header>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
            <div className="min-w-0 flex-1 basis-72">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-ink-3">
                {productName && gap.productId ? (
                  <Link href={`/products/${gap.productId}`} className="chip hover:bg-sunk">
                    {productName}
                  </Link>
                ) : (
                  <span className="chip">No product</span>
                )}
                <SeenChips sessions={gap.sessions} questions={gap.fromPeople} />
                <Owner owner={owner} />
              </div>
              {gap.resolution ? (
                <Answer
                  resolution={{ ...gap.resolution, at: gap.resolution.at.toISOString() }}
                  seenSince={gap.seenSinceResolved}
                />
              ) : (
                <p className="mt-3 text-[13px] text-ink-3">
                  Not answered yet. Whoever writes the doc, ADR or comment that answers it resolves it here with the
                  link, so the next person and the next agent can find it.
                </p>
              )}
            </div>
            <GapActions
              status={gap.status}
              owner={owner}
              take={takeGap.bind(null, gap.id)}
              resolve={resolveGap.bind(null, gap.id)}
              reopen={reopenGap.bind(null, gap.id)}
            />
          </div>
        </section>

        <section className="card" aria-labelledby="sources-title">
          <header className="border-line border-b px-5 py-3.5">
            <h2 id="sources-title" className="font-semibold text-[15px]">
              Where it came from
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-3">
              The approved sessions it came up in, newest first, and the questions Ask Strata couldn't answer.
            </p>
          </header>
          {sources.length || gap.fromPeople ? (
            <ul className="divide-y divide-line">
              {sources.map((s) => {
                const sessionProduct = s.productId ? names.get(s.productId) : undefined;
                return (
                  <li key={s.sessionId} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <Link
                        href={`/sessions/${encodeURIComponent(s.sessionId)}`}
                        className="min-w-0 break-words font-medium text-[14px] underline-offset-4 hover:underline"
                      >
                        {s.title || `Session ${s.sessionId.slice(0, 8)}`}
                      </Link>
                      <Ago at={s.at.toISOString()} className="flex-none text-[12.5px] text-ink-3" />
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
                      {s.author ? <span>{s.author.name}</span> : null}
                      {s.author && (sessionProduct || s.repo) ? <span aria-hidden>·</span> : null}
                      {sessionProduct && s.productId ? (
                        <Link
                          href={`/products/${s.productId}`}
                          className="text-accent-text underline-offset-4 hover:underline"
                        >
                          {sessionProduct}
                        </Link>
                      ) : s.repo ? (
                        <span className="chip chip-mono">{s.repo}</span>
                      ) : null}
                    </p>
                    {s.lines.length ? (
                      <ul className="mt-2.5 flex flex-col gap-2">
                        {s.lines.map((line) => (
                          <li key={line.id} className="flex flex-wrap items-start gap-2">
                            <span className="chip flex-none">
                              {line.source === "record" ? "Finding" : "In the summary"}
                            </span>
                            <p className="min-w-0 flex-1 basis-56 break-words text-[14px] text-ink-2">{line.text}</p>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
              {gap.fromPeople ? (
                <li className="flex flex-wrap items-start gap-3 px-5 py-4">
                  <span className="grid size-8 flex-none place-items-center rounded-[9px] bg-surface-2 text-ink-2">
                    <MessageCircleQuestion size={15} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-[14px]">
                      Asked in Ask Strata {plural(gap.fromPeople, "time")}, and it couldn't answer
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-3">
                      Who asked isn't kept, only that the question went unanswered.
                      {lastQuestion ? (
                        <>
                          {" "}
                          Last asked <Ago at={lastQuestion.toISOString()} />.
                        </>
                      ) : null}
                    </p>
                  </div>
                </li>
              ) : null}
              {moreSessions > 0 ? (
                <li className="px-5 py-3.5 text-[13px] text-ink-3">
                  And {plural(moreSessions, "earlier session")} not shown here.
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="px-5 py-6 text-[14px] text-ink-3">
              No approved work names this gap now: the sessions behind it were discarded or edited. It's kept because
              someone owns it or resolved it.
            </p>
          )}
        </section>

        <section className="card" aria-labelledby="history-title">
          <header className="border-line border-b px-5 py-3.5">
            <h2 id="history-title" className="font-semibold text-[15px]">
              History
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-3">
              Each time it came up, and each time someone took it on, resolved or reopened it. Newest first.
            </p>
          </header>
          {history.length ? (
            <ol className="divide-y divide-line">
              {history.map((event, i) => (
                <HistoryItem key={`${event.kind}-${event.at.getTime()}-${i}`} event={event} />
              ))}
              {history.length >= HISTORY_SHOWN ? (
                <li className="px-5 py-3.5 text-[13px] text-ink-3">Showing the latest {HISTORY_SHOWN}.</li>
              ) : null}
            </ol>
          ) : (
            <p className="px-5 py-6 text-[14px] text-ink-3">Nothing recorded yet.</p>
          )}
        </section>
      </div>
    </>
  );
}

const EVENT_ICONS = {
  session: Bot,
  question: MessageCircleQuestion,
  take: UserCheck,
  resolve: CircleCheck,
  reopen: RotateCcw,
} as const;

function HistoryItem({ event }: { event: GapEvent }) {
  const Icon = EVENT_ICONS[event.kind];
  const link = "url" in event ? webLink(event.url) : null;
  return (
    <li className="flex gap-4 px-5 py-3.5">
      <span
        className={`mt-0.5 grid size-8 flex-none place-items-center rounded-[9px] bg-surface-2 ${
          event.kind === "resolve" ? "text-accent-text" : "text-ink-2"
        }`}
      >
        <Icon size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-[14px]">
          {event.kind === "session" ? (
            <>
              Came up in{" "}
              <Link
                href={`/sessions/${encodeURIComponent(event.sessionId)}`}
                className="text-accent-text underline-offset-4 hover:underline"
              >
                a session
              </Link>
            </>
          ) : event.kind === "question" ? (
            "Asked in Ask Strata, without an answer"
          ) : (
            `${event.kind === "take" ? "Taken on" : event.kind === "resolve" ? "Resolved" : "Reopened"} by ${event.by}`
          )}
        </p>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block truncate text-[12.5px] text-accent-text underline-offset-4 hover:underline"
          >
            {link.replace(/^https?:\/\//i, "")}
          </a>
        ) : null}
      </div>
      <Ago at={event.at.toISOString()} className="flex-none text-[12.5px] text-ink-3" />
    </li>
  );
}
