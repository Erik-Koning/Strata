// The right of a product's history page: what Strata knows about the change being compared, and where each piece
// comes from. Only what product-history.ts tied to these exact commits, as the viewer may read it.
import { ArrowUpRight, CircleCheck, CircleX } from "lucide-react";
import Link from "next/link";
import type { Commit } from "../../server/hub/git-history.ts";
import type { HandoffContext, SessionContext } from "../../server/hub/product-history.ts";
import { Ago } from "../time.tsx";

const STATUS_LABEL: Record<HandoffContext["status"], string> = {
  draft: "Draft",
  approved: "Approved",
  claimed: "Claimed",
  completed: "Completed",
  revoked: "Revoked",
};

function Sha({ sha, before, after }: { sha: string | null; before: Commit | null; after: Commit }) {
  if (!sha) return <span className="text-ink-3">not recorded</span>;
  const end = after.sha.startsWith(sha) ? "After" : before?.sha.startsWith(sha) ? "Before" : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="chip chip-mono" title={sha}>
        {sha.slice(0, 7)}
      </code>
      {end ? <span className="text-[12px] text-accent-text">{end}</span> : null}
    </span>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h4 className="font-medium text-[13px] text-ink-2">{title}</h4>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function HandoffWhy({ h, before, after }: { h: HandoffContext; before: Commit | null; after: Commit }) {
  return (
    <article className="px-5 py-4 [&+&]:border-line [&+&]:border-t">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="chip bg-[var(--relay-blue-soft)] text-[var(--relay-blue)]">Handoff</span>
        <span className="chip">{STATUS_LABEL[h.status]}</span>
      </div>
      <h3 className="mt-2 font-semibold text-[15px] leading-snug">
        <Link href={`/relay?id=${h.id}`} className="hover:text-accent-text">
          {h.title}
        </Link>
      </h3>
      <p className="mt-1 text-[13.5px] text-ink-2">
        {h.recipient ? `${h.sender} handed it to ${h.recipient}.` : `Written by ${h.sender}.`}
      </p>

      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-ink-3">Handed off at</dt>
        <dd>
          <Sha sha={h.startCommit} before={before} after={after} />
        </dd>
        {h.claimCommit ? (
          <>
            <dt className="text-ink-3">Picked up at</dt>
            <dd>
              <Sha sha={h.claimCommit} before={before} after={after} />
            </dd>
          </>
        ) : null}
        {h.finishCommit ? (
          <>
            <dt className="text-ink-3">Finished at</dt>
            <dd className="flex flex-wrap items-center gap-x-2">
              <Sha sha={h.finishCommit} before={before} after={after} />
              {h.finishPushed === false ? <span className="text-[12px] text-ink-3">not pushed</span> : null}
            </dd>
          </>
        ) : null}
      </dl>

      {h.decisions.length ? (
        <Block title="Decisions">
          <ul className="flex flex-col gap-1.5 text-[13.5px] text-ink leading-relaxed">
            {h.decisions.map((d) => (
              <li key={d} className="border-accent border-l-2 pl-3">
                {d}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {h.failedApproaches.length ? (
        <Block title="Tried and dropped">
          <ul className="flex flex-col gap-1.5 text-[13.5px] text-ink-2 leading-relaxed">
            {h.failedApproaches.map((d) => (
              <li key={d} className="border-line-strong border-l-2 pl-3">
                {d}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {h.memories.length ? (
        <Block title={h.memories.length === 1 ? "Memory shared with it" : "Memories shared with it"}>
          <ul className="flex flex-col gap-2">
            {h.memories.map((m) => (
              <li key={m.id} className="rounded-[var(--radius-sm)] bg-sunk px-3 py-2.5 shadow-[var(--shadow)]">
                <p className="text-[13.5px] leading-relaxed">{m.text}</p>
                <p className="mt-1 text-[12px] text-ink-3">
                  {h.sender}'s {m.kind}, shared when {h.sender} approved the handoff
                  {m.source === "seed" ? ". A seed script wrote it, not a session." : ""}
                </p>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}
      {h.memoriesWithdrawn ? (
        <p className="mt-2 text-[12.5px] text-ink-3">
          {h.memoriesWithdrawn} shared {h.memoriesWithdrawn === 1 ? "memory has" : "memories have"} since been withdrawn
          and {h.memoriesWithdrawn === 1 ? "isn't" : "aren't"} shown.
        </p>
      ) : null}

      {h.outcome ? (
        <details className="group mt-4">
          <summary className="cursor-pointer font-medium text-[13px] text-ink-2 hover:text-ink">
            {h.recipient ?? "The recipient"}'s account of the work
          </summary>
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-ink-2 leading-relaxed">{h.outcome}</p>
        </details>
      ) : null}
    </article>
  );
}

function SessionWhy({ s }: { s: SessionContext }) {
  return (
    <article className="border-line border-t px-5 py-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="chip status-active">Session</span>
        <span className="text-[12.5px] text-ink-3">{s.link}</span>
      </div>
      <h3 className="mt-2 font-medium text-[14px] leading-snug">
        <Link href={`/sessions/${encodeURIComponent(s.id)}`} className="hover:text-accent-text">
          {s.title ?? `Session ${s.id.slice(0, 8)}`}
        </Link>
      </h3>
      {s.author ? <p className="mt-0.5 text-[12.5px] text-ink-3">{s.author}'s Strata session</p> : null}
      {s.findings.length ? (
        <ul className="mt-2.5 flex flex-col gap-2">
          {s.findings.map((f) => (
            <li key={f.id} className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <span className="chip flex-none">{f.label}</span>
              <span className="min-w-0 flex-1 basis-40 text-[13.5px] text-ink-2 leading-6">{f.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[13px] text-ink-3">Nothing from it has been approved yet.</p>
      )}
    </article>
  );
}

function Evidence({ handoffs, before, after }: { handoffs: HandoffContext[]; before: Commit | null; after: Commit }) {
  const withTests = handoffs.filter((h) => h.tests.length || h.testCommands.length);
  if (!withTests.length) return null;
  return (
    <section className="card" aria-labelledby="evidence-title">
      <header className="border-line border-b px-5 py-3.5">
        <h2 id="evidence-title" className="font-semibold text-[15px]">
          Test evidence
        </h2>
      </header>
      {withTests.map((h) => (
        <div key={h.id} className="px-5 py-4 [&+&]:border-line [&+&]:border-t">
          {h.verified ? (
            <p className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-verified-soft px-3 py-2.5 text-[13.5px] text-verified-text">
              <CircleCheck size={16} aria-hidden className="mt-0.5 flex-none" />
              <span>
                <span className="font-semibold">Verified.</span> Every test command passed in {h.recipient}'s own runs
                after they claimed it.
              </span>
            </p>
          ) : (
            <p className="rounded-[var(--radius-sm)] bg-surface-2 px-3 py-2.5 text-[13.5px] text-ink-2">
              <span className="font-semibold">Not verified.</span>{" "}
              {h.status === "completed"
                ? "Not every test command has a passing run by the recipient after the claim."
                : "Verified only when the recipient's own runs pass after they claim it."}
            </p>
          )}
          {handoffs.length > 1 ? <p className="mt-3 text-[12.5px] text-ink-3">{h.title}</p> : null}
          {h.tests.length ? (
            <ol className="mt-3 flex flex-col" aria-label="Test runs, oldest first">
              {h.tests.map((t, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2 border-[var(--rule)] border-t py-2 first:border-t-0"
                >
                  {t.status === "pass" ? (
                    <CircleCheck size={15} aria-label="Passed" className="mt-0.5 text-verified" />
                  ) : (
                    <CircleX size={15} aria-label="Failed" className="mt-0.5 text-danger" />
                  )}
                  <div className="min-w-0">
                    <code className="break-all font-mono text-[12.5px] text-ink">{t.command}</code>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
                      <span>exit {t.exitCode ?? "unknown"}</span>
                      <span>{t.by}</span>
                      <span className={t.verified ? "text-verified-text" : "text-amber"}>
                        {t.verified ? "run by Strata" : "typed in, not run"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        at <Sha sha={t.commit} before={before} after={after} />
                      </span>
                      <Ago at={t.at} />
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-[13px] text-ink-3">No runs recorded yet.</p>
          )}
          <p className="mt-2 text-[12px] text-ink-3">Each run shows the commit HEAD was on when it ran.</p>
        </div>
      ))}
    </section>
  );
}

function People({
  gitAuthors,
  handoffs,
  sessions,
}: {
  gitAuthors: { name: string; email: string; commits: number }[];
  handoffs: HandoffContext[];
  sessions: SessionContext[];
}) {
  const strata = new Map<string, string[]>();
  const add = (name: string | null, what: string) => {
    if (!name) return;
    strata.set(name, [...new Set([...(strata.get(name) ?? []), what])]);
  };
  for (const h of handoffs) {
    if (h.status === "revoked") continue;
    add(h.sender, "handed the work off");
    add(h.recipient, h.status === "completed" ? "picked it up and completed it" : "received the handoff");
  }
  for (const s of sessions) add(s.author, "worked on it in a Strata session");
  return (
    <section className="card" aria-labelledby="people-title">
      <header className="border-line border-b px-5 py-3.5">
        <h2 id="people-title" className="font-semibold text-[15px]">
          People
        </h2>
      </header>
      <div className="px-5 py-4">
        <h3 className="font-medium text-[13px] text-ink-2">Git commit authors</h3>
        {gitAuthors.length ? (
          <ul className="mt-1.5 flex flex-col gap-1">
            {gitAuthors.map((a) => (
              <li key={`${a.name}-${a.email}`} className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
                <span className="font-medium">{a.name}</span>
                <span className="font-mono text-[12px] text-ink-3">{a.email}</span>
                <span className="text-[12.5px] text-ink-3">
                  {a.commits} {a.commits === 1 ? "commit" : "commits"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[13px] text-ink-3">No commits between Before and After.</p>
        )}
        <h3 className="mt-4 font-medium text-[13px] text-ink-2">In Strata</h3>
        {strata.size ? (
          <ul className="mt-1.5 flex flex-col gap-1">
            {[...strata].map(([name, what]) => (
              <li key={name} className="text-[13.5px]">
                <span className="font-medium">{name}</span> <span className="text-ink-2">{what.join(", ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[13px] text-ink-3">No Strata account is tied to these commits.</p>
        )}
        <p className="mt-3 text-[12px] text-ink-3">
          Git authors are whatever each commit says. Strata people come from handoffs and sessions. The two aren't
          matched to each other.
        </p>
      </div>
    </section>
  );
}

export function ContextColumn({
  handoffs,
  sessions,
  gitAuthors,
  before,
  after,
}: {
  handoffs: HandoffContext[];
  sessions: SessionContext[];
  gitAuthors: { name: string; email: string; commits: number }[];
  before: Commit | null;
  after: Commit;
}) {
  const none = !handoffs.length && !sessions.length;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="card" aria-labelledby="why-title">
        <header className="border-line border-b px-5 py-3.5">
          <h2 id="why-title" className="font-semibold text-[15px]">
            Why it changed
          </h2>
        </header>
        {none ? (
          <div className="px-5 py-6">
            <p className="font-medium text-[14px]">No Strata context linked to this change.</p>
            <p className="mt-1 text-[13px] text-ink-3">
              Strata links a handoff or session here only when it recorded one of the commits you're comparing.
            </p>
          </div>
        ) : (
          <>
            {handoffs.map((h) => (
              <HandoffWhy key={h.id} h={h} before={before} after={after} />
            ))}
            {sessions.map((s) => (
              <SessionWhy key={s.id} s={s} />
            ))}
          </>
        )}
      </section>
      <Evidence handoffs={handoffs} before={before} after={after} />
      <People gitAuthors={gitAuthors} handoffs={handoffs} sessions={sessions} />
      {none ? null : (
        <section className="card" aria-labelledby="sources-title">
          <header className="border-line border-b px-5 py-3.5">
            <h2 id="sources-title" className="font-semibold text-[15px]">
              Sources
            </h2>
          </header>
          <ul className="py-1">
            {handoffs.map((h) => (
              <li key={h.id}>
                <Link
                  href={`/relay?id=${h.id}`}
                  className="flex items-center gap-2 px-5 py-2 text-[13.5px] hover:bg-sunk max-md:min-h-11"
                >
                  <span className="min-w-0 flex-1 truncate">Handoff: {h.title}</span>
                  <ArrowUpRight size={14} aria-hidden className="flex-none text-ink-3" />
                </Link>
              </li>
            ))}
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sessions/${encodeURIComponent(s.id)}`}
                  className="flex items-center gap-2 px-5 py-2 text-[13.5px] hover:bg-sunk max-md:min-h-11"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {s.author ? `${s.author}'s session` : "Session"} {s.id.slice(0, 8)}
                  </span>
                  <ArrowUpRight size={14} aria-hidden className="flex-none text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
