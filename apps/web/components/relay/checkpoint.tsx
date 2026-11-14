// The checkpoint, read-only: what was done, what's left, what failed and why, and the one thing to do next.
import type { Handoff, RepoState } from "@strata/contracts";
import { ArrowRight, Check, Circle, CircleSlash, ShieldCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Ago } from "../time.tsx";
import { RepoLine } from "./repo.tsx";

type Tone = "done" | "open" | "danger" | "muted";

const MARK = {
  done: <Check size={13} strokeWidth={2.5} className="text-accent" aria-hidden />,
  open: <Circle size={11} strokeWidth={2} className="text-ink-3" aria-hidden />,
  danger: <TriangleAlert size={13} className="text-danger" aria-hidden />,
  muted: <CircleSlash size={12} className="text-ink-3" aria-hidden />,
} satisfies Record<Tone, ReactNode>;

export function ItemList({
  title,
  items,
  tone = "open",
  className = "",
}: {
  title: string;
  items: string[];
  tone?: Tone | "neutral";
  className?: string;
}) {
  const mark = tone === "neutral" ? null : MARK[tone];
  return (
    <section className={`min-w-0 ${className}`}>
      <h3
        className={`flex items-center gap-2 font-semibold text-[12.5px] ${tone === "danger" && items.length ? "text-danger" : "text-ink"}`}
      >
        {title}
        <span className="count">{items.length || ""}</span>
      </h3>
      {items.length ? (
        <ul className="mt-2.5 grid gap-2 text-[13.5px] leading-snug">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-[3px] grid size-[14px] flex-none place-items-center">
                {mark ?? <span className="size-1 rounded-full bg-ink-3" aria-hidden />}
              </span>
              <span className="min-w-0 text-ink-2">{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 text-[12.5px] text-ink-3">None</p>
      )}
    </section>
  );
}

export function NextAction({ text, label = "Next action" }: { text: string; label?: string }) {
  return (
    <section aria-labelledby="next-title" className="min-w-0">
      <h3 id="next-title" className="eyebrow flex items-center gap-1.5 text-accent-text">
        <ArrowRight size={12} aria-hidden /> {label}
      </h3>
      <p className={`mt-2 font-medium text-[17px] leading-snug tracking-[-0.01em] ${text ? "text-ink" : "text-ink-3"}`}>
        {text || "None given. Read Remaining and Blockers first."}
      </p>
    </section>
  );
}

export function CheckpointBody({ handoff }: { handoff: Handoff }) {
  return (
    <>
      <section>
        <h3 className="eyebrow">Summary</h3>
        <p
          className={`mt-2 max-w-[72ch] whitespace-pre-wrap text-[14.5px] leading-relaxed ${handoff.summary ? "text-ink" : "text-ink-3"}`}
        >
          {handoff.summary || "No summary."}
        </p>
      </section>
      <div className="grid gap-px overflow-hidden rounded-[var(--radius)] border border-line bg-line xl:grid-cols-3">
        <ItemList title="Completed" items={handoff.completed} tone="done" className="bg-surface p-4" />
        <ItemList title="Remaining" items={handoff.remaining} tone="open" className="bg-surface p-4" />
        <ItemList title="Blockers" items={handoff.blockers} tone="danger" className="bg-surface p-4" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <ItemList title="Tried & failed" items={handoff.failedApproaches} tone="muted" />
        <ItemList title="Decisions" items={handoff.decisions} tone="neutral" />
      </div>
    </>
  );
}

// What the recipient did with it, and whether the tests prove it: verified only when every test command passed in a
// run Strata's client made after the claim.
export function Continuation({ handoff }: { handoff: Handoff }) {
  const c = handoff.continuation;
  if (!c) return null;
  return (
    <section
      aria-labelledby="cont-title"
      className={`rounded-[var(--radius)] border px-5 py-4 ${c.verified ? "border-accent/30 bg-accent-soft/40" : "border-amber/30 bg-amber-soft/40"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="cont-title" className="font-semibold text-[13px]">
          Completed{handoff.recipient ? ` by ${handoff.recipient.name}` : ""}
        </h3>
        <span className="flex items-center gap-2 text-[12px] text-ink-3">
          {c.verified ? (
            <span className="chip badge-verified">
              <ShieldCheck size={12} aria-hidden /> TESTS VERIFIED
            </span>
          ) : (
            <span className="chip badge-claimed">
              <TriangleAlert size={12} aria-hidden /> UNVERIFIED
            </span>
          )}
          {handoff.completedAt ? <Ago at={handoff.completedAt} /> : null}
        </span>
      </div>
      <p className="mt-2 max-w-[72ch] whitespace-pre-wrap text-[14px] text-ink leading-relaxed">{c.summary}</p>
      {!c.verified ? (
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          Not every test command passed in a verified run after the claim. Treat it as reported, not proven.
        </p>
      ) : null}
      {c.completed.length ? (
        <div className="mt-4">
          <ItemList title="Done in this session" items={c.completed} tone="done" />
        </div>
      ) : null}
      <dl className="mt-4 grid gap-1.5 border-line border-t pt-3 text-[12.5px]">
        {(
          [
            ["At handoff", handoff.repo],
            ["At claim", c.claimRepo],
            ["Final", c.repo],
          ] satisfies [string, RepoState | null][]
        ).map(([label, repo]) => (
          <div key={label} className="grid gap-0.5 sm:grid-cols-[84px_minmax(0,1fr)] sm:gap-3">
            <dt className="text-ink-3">{label}</dt>
            <dd className="min-w-0">
              <RepoLine repo={repo} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
