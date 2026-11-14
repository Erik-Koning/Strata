// Product impact: the change in plain words, for someone who won't read the diff. Every line is quoted from the
// handoff Strata recorded for these commits (who wrote it is named), and the test line comes from Strata's own runs.
// Nothing here is generated or inferred; with no completed handoff tied to the comparison, the section isn't shown.
import { CircleCheck, CircleX } from "lucide-react";
import Link from "next/link";
import type { HandoffContext } from "../../server/hub/product-history.ts";

// The first sentence of a paragraph someone wrote.
const firstSentence = (text: string): string => text.trim().split(/(?<=[.!?])\s+(?=[A-Z"'(])/)[0] ?? text;

function Row({ label, source, children }: { label: string; source: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-5 gap-y-1 border-[var(--rule)] border-t px-5 py-3.5 first:border-t-0 md:grid-cols-[148px_minmax(0,1fr)]">
      <div>
        <h3 className="font-medium text-[13.5px] text-ink">{label}</h3>
        <p className="text-[12px] text-ink-3">{source}</p>
      </div>
      <div className="min-w-0 text-[14px] text-ink-2 leading-relaxed">{children}</div>
    </div>
  );
}

// Shown only for a completed handoff whose finishing commit this comparison brings in: its account is of this work.
export function ProductImpact({
  handoffs,
  range,
  commits,
}: {
  handoffs: HandoffContext[];
  range: string[];
  commits: { sha: string; short: string; subject: string; author: { name: string } }[];
}) {
  const h = handoffs.find((x) => {
    const finish = x.finishCommit;
    return x.status === "completed" && finish !== null && range.some((sha) => sha.startsWith(finish));
  });
  if (!h) {
    // No handoff describes this work: the commits' own messages are the only account there is.
    const brought = range.map((sha) => commits.find((c) => c.sha === sha)).filter((c) => c !== undefined);
    return (
      <section className="card min-w-0" aria-labelledby="impact-title">
        <header className="border-line border-b px-5 py-3.5">
          <h2 id="impact-title" className="font-semibold text-[15px]">
            Feature changes
          </h2>
        </header>
        <Row label="What changed" source="Commit messages, as written">
          {brought.length ? (
            <ul className="flex flex-col gap-1">
              {brought.map((c) => (
                <li key={c.sha}>
                  {c.subject} <span className="text-[12.5px] text-ink-3">{c.author.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No commits between these two.</p>
          )}
          <p className="mt-2 text-[12.5px] text-ink-3">No Strata handoff describes this change in product terms.</p>
        </Row>
      </section>
    );
  }
  // The latest run of each test command by the recipient, after the work.
  const latest = new Map<string, HandoffContext["tests"][number]>();
  for (const t of h.tests) if (t.role === "recipient") latest.set(t.command, t);
  const runs = [...latest.values()];
  return (
    <section className="card min-w-0" aria-labelledby="impact-title">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-line border-b px-5 py-3.5">
        <h2 id="impact-title" className="font-semibold text-[15px]">
          Feature changes
        </h2>
        <Link href={`/relay?id=${h.id}`} className="text-[12.5px] text-ink-3 hover:text-accent-text">
          From the handoff "{h.title}"
        </Link>
      </header>
      {h.summary ? (
        <Row label="The problem" source={`${h.sender}, handing off`}>
          <p>{firstSentence(h.summary)}</p>
        </Row>
      ) : null}
      {h.reported.length ? (
        <Row label="What changed" source={`${h.recipient ?? "Recipient"}, on completing it`}>
          <ul className="flex flex-col gap-1">
            {h.reported.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-[9px] size-1.5 flex-none rounded-full bg-ink-3" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Row>
      ) : null}
      {h.decisions.length ? (
        <Row label="What was decided" source={`${h.sender}, in the handoff`}>
          <ul className="flex flex-col gap-1">
            {h.decisions.map((d) => (
              <li key={d} className="border-accent border-l-2 pl-3">
                {firstSentence(d)}
              </li>
            ))}
          </ul>
        </Row>
      ) : null}
      {h.testCommands.length ? (
        <Row label="Tests" source="Run by Strata's client">
          <p className={h.verified ? "font-medium text-verified-text" : "font-medium text-ink"}>
            {h.verified
              ? `Verified: every test command passed in ${h.recipient}'s runs after the claim.`
              : "Not verified."}
          </p>
          {runs.length ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {runs.map((t) => (
                <li key={t.command} className="flex items-center gap-2">
                  {t.status === "pass" ? (
                    <CircleCheck size={15} aria-label="Passed" className="flex-none text-verified" />
                  ) : (
                    <CircleX size={15} aria-label="Failed" className="flex-none text-danger" />
                  )}
                  <code className="font-mono text-[12.5px] text-ink">{t.command}</code>
                  <span className="text-[12.5px] text-ink-3">exit {t.exitCode ?? "unknown"}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Row>
      ) : null}
    </section>
  );
}
