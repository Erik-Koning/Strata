// A handoff, told in three parts: who started the work, what Strata carried across (only what the sender approved),
// and who finished it. The outcome sits directly underneath, and everything technical (checkpoint fields, test logs,
// provenance, commits, the audit trail) waits in disclosures below. Every word here is read from the handoff itself.
import type { Handoff, SharedMemory } from "@strata/contracts";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  GitBranch,
  Hourglass,
  Library,
  ListChecks,
  Lock,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { Ago } from "../time.tsx";
import { Avatar, latestRuns } from "./flow.tsx";
import { shortSha } from "./status.tsx";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

// The first sentence of the summary, as the handoff's one-line explanation.
export function lead(text: string): string {
  const t = text.trim();
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : t).trim();
  return s.length > 220 ? `${s.slice(0, 217).trimEnd()}…` : s;
}

// A few of the real items, so a card shows what was actually done rather than only counting it.
function Done({ items, more }: { items: string[]; more?: string }) {
  if (!items.length) return null;
  const shown = items.slice(0, 3);
  return (
    <ul className="mt-1 grid gap-1.5 border-line border-t pt-3">
      {shown.map((t, i) => (
        <li key={i} className="flex gap-2 text-[13px] text-ink-2 leading-snug">
          <Check size={13} strokeWidth={2.5} className="mt-[3px] flex-none text-verified" aria-hidden />
          <span className="line-clamp-2 min-w-0">{t}</span>
        </li>
      ))}
      {items.length > shown.length ? (
        <li className="pl-5 text-[12.5px] text-ink-3">
          and {items.length - shown.length} more{more ? ` ${more}` : ""}
        </li>
      ) : null}
    </ul>
  );
}

function PersonCard({
  label,
  person,
  side,
  viewerId,
  children,
  muted = false,
}: {
  label: string;
  person: Handoff["sender"] | null;
  side: "sender" | "recipient";
  viewerId: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={`relay-person flex min-w-0 flex-col rounded-[14px] bg-surface p-5 shadow-[var(--shadow-lift)] ${muted ? "opacity-70" : ""}`}
    >
      <p className="text-[12.5px] text-ink-3">{label}</p>
      <div className="mt-3 flex items-center gap-3">
        <Avatar person={person} side={side} size={40} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-[18px] text-ink leading-tight tracking-[-0.015em]">
            {person ? person.name : "No one yet"}
          </p>
          {person?.id === viewerId ? <p className="text-[12.5px] text-ink-3">That's you</p> : null}
        </div>
      </div>
      <div className="mt-4 grid gap-1.5 text-[13.5px] text-ink-2 leading-snug">{children}</div>
    </div>
  );
}

// The link between two parts: solid violet once that step happened, dashed while it hasn't, and a single pulse
// travelling along it on load to show which way the work moved.
function Connector({ live, stopped = false, delay }: { live: boolean; stopped?: boolean; delay: string }) {
  return (
    <div
      aria-hidden
      className="relay-link"
      data-live={live ? "true" : "false"}
      data-stopped={stopped ? "true" : "false"}
      style={{ ["--delay" as string]: delay }}
    >
      <span className="relay-link-line" />
      {live ? <span className="relay-spark" /> : null}
      <ChevronRight size={16} strokeWidth={2.25} className="relay-link-head" />
    </div>
  );
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-[2px] flex-none text-accent-text">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

export function HandoffStory({
  handoff,
  memories,
  viewerId,
}: {
  handoff: Handoff;
  memories: SharedMemory[] | null;
  viewerId: string;
}) {
  const h = handoff;
  const sender = firstName(h.sender.name);
  const revoked = h.status === "revoked";
  const approved = Boolean(h.approvedAt);
  const claimed = Boolean(h.claimedAt);
  const shared = h.memoryIds.length;
  const firstMemory = memories?.[0]?.text ?? null;
  const repo = h.repo;

  return (
    <section aria-label="How the work moved" className="relay-story">
      <PersonCard label="Started the work" person={h.sender} side="sender" viewerId={viewerId}>
        <p>
          {h.completed.length + h.remaining.length
            ? `Finished ${plural(h.completed.length, "task")}, left ${plural(h.remaining.length, "task")} open${h.blockers.length ? ` and ${plural(h.blockers.length, "blocker")}` : ""}.`
            : "Wrote a checkpoint without a task list."}
        </p>
        <p className="text-[12.5px] text-ink-3">
          Checkpointed <Ago at={h.createdAt} />
        </p>
        <Done items={h.completed} />
      </PersonCard>

      <Connector live={approved} stopped={revoked && !approved} delay="150ms" />

      <div className="chrome relay-transfer flex min-w-0 flex-col rounded-[14px] p-5 shadow-[var(--shadow-pop)]">
        <p className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <span className="relay-mark" aria-hidden /> Strata carried across
        </p>
        <p className="mt-3 font-semibold text-[18px] text-ink leading-tight tracking-[-0.015em]">
          {revoked
            ? approved
              ? "Access revoked"
              : "Nothing was shared"
            : approved
              ? `Only what ${sender} approved`
              : "Waiting for approval"}
        </p>
        {approved || !revoked ? (
          <ul className="mt-4 grid gap-3 text-[13.5px] text-ink-2 leading-snug">
            <Fact icon={<Library size={15} aria-hidden />}>
              {approved ? (
                <>
                  <span className="text-ink">{plural(shared, "approved memory", "approved memories")}</span>
                  {firstMemory ? <span className="mt-1 line-clamp-2 block text-ink-3">“{firstMemory}”</span> : null}
                </>
              ) : (
                `No memories leave until ${sender} approves`
              )}
            </Fact>
            <Fact icon={<ListChecks size={15} aria-hidden />}>
              The checkpoint: {h.completed.length} done, {h.remaining.length} to do
              {h.blockers.length ? `, ${plural(h.blockers.length, "blocker")}` : ""}
            </Fact>
            {repo?.commit ? (
              <Fact icon={<GitBranch size={15} aria-hidden />}>
                <span className="font-mono text-[12.5px]">
                  {repo.branch ?? "detached"} at {shortSha(repo.commit)}
                </span>
              </Fact>
            ) : null}
          </ul>
        ) : null}
        <span aria-hidden className="min-h-5 flex-1" />
        <p className="flex items-start gap-2 border-line border-t pt-3 text-[12px] text-ink-3">
          <Lock size={13} className="mt-[1px] flex-none" aria-hidden />
          {revoked
            ? h.recipient
              ? `${firstName(h.recipient.name)} can no longer read any of it.`
              : "No one can read it."
            : "Re-checked on every read. Private memories never travel."}
        </p>
      </div>

      <Connector live={claimed} stopped={revoked} delay="900ms" />

      <PersonCard
        label={h.completedAt ? "Finished the work" : claimed ? "Working on it" : "Handed to"}
        person={h.recipient}
        side="recipient"
        viewerId={viewerId}
        muted={revoked || (!claimed && !approved)}
      >
        {claimed ? (
          <>
            <p>Resumed in a fresh Claude Code session with the approved context.</p>
            <p className="text-[12.5px] text-ink-3">
              {h.completedAt ? (
                <>
                  Completed <Ago at={h.completedAt} />
                </>
              ) : (
                <>
                  Resumed <Ago at={h.claimedAt as string} />
                </>
              )}
            </p>
            <Done items={h.continuation?.completed ?? []} />
          </>
        ) : revoked ? (
          <p>Never resumed. The handoff was revoked first.</p>
        ) : approved ? (
          <p>Hasn't picked it up yet.</p>
        ) : (
          <p>{h.recipient ? "Gets it once it's approved." : "Choose a teammate when you approve it."}</p>
        )}
      </PersonCard>
    </section>
  );
}

// The result, right under the story: proven, reported, in progress, waiting, a draft, or revoked. Never "done" unless
// it is.
export function Outcome({ handoff, children }: { handoff: Handoff; children?: ReactNode }) {
  const h = handoff;
  const recipient = h.recipient ? firstName(h.recipient.name) : "The recipient";
  const tests = latestRuns(h);
  const c = h.continuation;

  let tone: "verified" | "warn" | "danger" | "accent" | "neutral";
  let icon: ReactNode;
  let title: string;
  let body: ReactNode = null;

  if (h.status === "completed" && c?.verified) {
    tone = "verified";
    icon = <ShieldCheck size={22} aria-hidden />;
    title = `${recipient} finished it, and the tests prove it`;
    body = (
      <>
        <p>{c.summary}</p>
        <p className="relay-outcome-meta">
          {tests.passing} of {tests.named} test commands passed in a run Strata recorded after the handoff was resumed
          {c.repo?.commit ? (
            <>
              {" "}
              on <span className="font-mono">{shortSha(c.repo.commit)}</span>
            </>
          ) : null}
          .
        </p>
      </>
    );
  } else if (h.status === "completed") {
    tone = "warn";
    icon = <TriangleAlert size={22} aria-hidden />;
    title = `${recipient} reported it complete, but the tests don't prove it yet`;
    body = (
      <>
        {c?.summary ? <p>{c.summary}</p> : null}
        <p className="relay-outcome-meta">
          {tests.named
            ? `${tests.passing} of ${tests.named} test commands passing in the latest runs.`
            : "No test commands were named."}{" "}
          Treat it as reported, not proven.
        </p>
      </>
    );
  } else if (h.status === "revoked") {
    tone = "danger";
    icon = <ShieldX size={22} aria-hidden />;
    title = "Revoked. This work was never completed through Strata.";
    body = (
      <p>
        {h.revokedAt ? (
          <>
            Revoked <Ago at={h.revokedAt} />.{" "}
          </>
        ) : null}
        {h.revokeReason ? `Reason: ${h.revokeReason}` : "No reason given."}
      </p>
    );
  } else if (h.status === "claimed") {
    tone = "warn";
    icon = <Hourglass size={22} aria-hidden />;
    title = `${recipient} is working on it now`;
    body = <p>Test runs and the finished result appear here as soon as their session records them.</p>;
  } else if (h.status === "approved") {
    tone = "accent";
    icon = <CircleDashed size={22} aria-hidden />;
    title = `Waiting for ${recipient} to pick it up`;
  } else {
    tone = "neutral";
    icon = <Lock size={20} aria-hidden />;
    title = "Draft. Only you can see it.";
    body = <p>Check what your session wrote, choose who gets it and which memories travel, then approve it.</p>;
  }

  return (
    <section aria-label="Outcome" className="relay-outcome" data-tone={tone}>
      <span className="relay-outcome-icon">{icon}</span>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-[17px] leading-snug tracking-[-0.012em]">{title}</h3>
        {body ? <div className="mt-1.5 grid max-w-[68ch] gap-1.5 text-[14px] leading-relaxed">{body}</div> : null}
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </section>
  );
}

// One expandable part of the record. The summary line says what's inside before you open it.
export function Disclosure({
  title,
  hint,
  open = false,
  id,
  children,
}: {
  title: string;
  hint?: ReactNode;
  open?: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <details className="relay-disclosure group" open={open} id={id}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 font-medium text-[14.5px] text-ink">{title}</span>
        {hint ? <span className="flex-none text-[12.5px] text-ink-3">{hint}</span> : null}
        <ChevronDown
          size={16}
          aria-hidden
          className="flex-none text-ink-3 transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="grid gap-6 px-5 pt-1 pb-6">{children}</div>
    </details>
  );
}
