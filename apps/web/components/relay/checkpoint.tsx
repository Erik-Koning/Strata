// The checkpoint, read-only: what was done, what's left, what failed and why, and the one thing to do next.
import type { Handoff } from "@strata/contracts";
import { ArrowRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { Ago } from "../time.tsx";
import { RepoLine } from "./repo.tsx";

export function ItemList({ title, items, tone }: { title: string; items: string[]; tone?: "danger" }) {
  return (
    <section>
      <h3 className={`eyebrow ${tone === "danger" && items.length ? "text-danger" : ""}`}>
        {title}
        {items.length ? <span className="ml-1.5 text-ink-3">{items.length}</span> : null}
      </h3>
      {items.length ? (
        <ul className="mt-2 grid gap-1.5 text-[14px]">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-[9px] size-1 flex-none rounded-full bg-ink-3" aria-hidden />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-ink-3">None</p>
      )}
    </section>
  );
}

export function NextAction({ text }: { text: string }) {
  return (
    <section
      aria-labelledby="next-title"
      className="rounded-[12px] border border-accent/25 bg-accent-soft px-4 py-3.5 text-accent-text"
    >
      <h3 id="next-title" className="eyebrow flex items-center gap-1.5 text-accent-text">
        <ArrowRight size={13} aria-hidden /> Next recommended action
      </h3>
      <p className={`mt-1.5 font-medium text-[15.5px] ${text ? "text-ink" : "text-ink-3"}`}>
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
        <p className={`mt-2 whitespace-pre-wrap text-[14.5px] ${handoff.summary ? "" : "text-ink-3"}`}>
          {handoff.summary || "No summary."}
        </p>
      </section>
      <div className="grid gap-5 sm:grid-cols-2">
        <ItemList title="Completed" items={handoff.completed} />
        <ItemList title="Remaining" items={handoff.remaining} />
        <ItemList title="Blockers" items={handoff.blockers} tone="danger" />
        <ItemList title="Tried & failed" items={handoff.failedApproaches} />
      </div>
      <ItemList title="Decisions" items={handoff.decisions} />
    </>
  );
}

// What the recipient did with it, and whether the tests prove it: verified only when every test command passed in a
// run Strata's client made after the claim.
export function Continuation({ handoff }: { handoff: Handoff }) {
  const c = handoff.continuation;
  if (!c) return null;
  return (
    <section aria-labelledby="cont-title" className="rounded-[12px] border border-line bg-surface-2/60 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="cont-title" className="eyebrow">
          Continuation{handoff.recipient ? ` by ${handoff.recipient.name}` : ""}
        </h3>
        <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
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
      <p className="mt-2 whitespace-pre-wrap text-[14.5px]">{c.summary}</p>
      {!c.verified ? (
        <p className="mt-1.5 text-[12.5px] text-ink-3">
          Not every test command passed in a verified run after the claim. Treat it as reported, not proven.
        </p>
      ) : null}
      {c.completed.length ? (
        <div className="mt-3">
          <ItemList title="Done in this session" items={c.completed} />
        </div>
      ) : null}
      <dl className="mt-3 grid gap-2 border-line border-t pt-3 text-[13px]">
        <div className="grid gap-0.5 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-3">
          <dt className="text-ink-3">At handoff</dt>
          <dd>
            <RepoLine repo={handoff.repo} />
          </dd>
        </div>
        <div className="grid gap-0.5 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-3">
          <dt className="text-ink-3">At claim</dt>
          <dd>
            <RepoLine repo={c.claimRepo} />
          </dd>
        </div>
        <div className="grid gap-0.5 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-3">
          <dt className="text-ink-3">Final</dt>
          <dd>
            <RepoLine repo={c.repo} />
          </dd>
        </div>
      </dl>
    </section>
  );
}
