// The checkpoint, read-only: what was done, what's left, what failed and why, and the one thing to do next.
import type { Handoff } from "@strata/contracts";
import { ArrowRight, Check, Circle, CircleSlash, ShieldCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
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
      <p
        className={`max-w-[72ch] whitespace-pre-wrap text-[14.5px] leading-relaxed ${handoff.summary ? "text-ink" : "text-ink-3"}`}
      >
        {handoff.summary || "No summary."}
      </p>
      {handoff.completed.length || handoff.remaining.length || handoff.blockers.length ? (
        <div className="grid gap-px overflow-hidden rounded-[var(--radius)] border border-line bg-line lg:grid-cols-3">
          <ItemList title="Completed" items={handoff.completed} tone="done" className="bg-surface p-4" />
          <ItemList title="Remaining" items={handoff.remaining} tone="open" className="bg-surface p-4" />
          <ItemList title="Blockers" items={handoff.blockers} tone="danger" className="bg-surface p-4" />
        </div>
      ) : null}
      {handoff.failedApproaches.length || handoff.decisions.length ? (
        <div className="grid gap-6 pt-1 lg:grid-cols-2">
          <ItemList title="Tried & failed" items={handoff.failedApproaches} tone="muted" />
          <ItemList title="Decisions" items={handoff.decisions} tone="neutral" />
        </div>
      ) : null}
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
      aria-label="Result"
      className={`overflow-hidden rounded-[var(--radius)] border bg-surface ${c.verified ? "border-verified/35" : "border-amber/35"}`}
    >
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 text-[12.5px] ${
          c.verified
            ? "border-verified/20 bg-verified-soft text-verified-text"
            : "border-amber/20 bg-amber-soft/60 text-amber"
        }`}
      >
        {c.verified ? <ShieldCheck size={14} aria-hidden /> : <TriangleAlert size={14} aria-hidden />}
        <span className="font-medium">
          {c.verified
            ? "Verified: every test command passed in a run Strata made after the claim"
            : "Unverified: treat it as reported, not proven"}
        </span>
      </div>
      <div className="grid gap-4 px-4 py-4">
        <p className="max-w-[72ch] whitespace-pre-wrap text-[14.5px] text-ink leading-relaxed">{c.summary}</p>
        {c.completed.length ? <ItemList title="Done in this session" items={c.completed} tone="done" /> : null}
        {c.repo ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-line border-t pt-3">
            <span className="text-[12px] text-ink-3">Final</span>
            <RepoLine repo={c.repo} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
