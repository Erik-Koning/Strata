// A handoff as one sentence you can see: who started the work, what Strata shared, who continued it, and what was
// verified. One sheet, one line running through it: solid violet where context actually moved, dashed where it hasn't
// yet. Everything technical (commits, paths, logs, provenance) lives in the evidence inspector, not here.
import type { Handoff, SharedMemory } from "@strata/contracts";
import { Check, Circle, CircleDashed, Hourglass, Lock, ShieldCheck, ShieldX, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Mark } from "../logo.tsx";
import { InlineMarkdown } from "../markdown.tsx";
import { Ago } from "../time.tsx";
import { Avatar, latestRuns } from "./flow.tsx";

export const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

// The first sentence of the summary, as the handoff's one-line explanation.
export function lead(text: string): string {
  const t = text.trim();
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : t).trim();
  return s.length > 220 ? `${s.slice(0, 217).trimEnd()}…` : s;
}

type Seg = "on" | "off" | "cut";

function Items({ items, tone, limit = 3 }: { items: string[]; tone: "open" | "done" | "blocked"; limit?: number }) {
  if (!items.length) return null;
  const shown = items.slice(0, limit);
  return (
    <ul className="grid gap-2">
      {shown.map((t, i) => (
        <li key={i} className="flex gap-2.5 text-[14px] text-ink-2 leading-snug">
          <span className="mt-[3px] grid size-[14px] flex-none place-items-center">
            {tone === "done" ? (
              <Check size={14} strokeWidth={2.4} className="text-verified" aria-hidden />
            ) : tone === "blocked" ? (
              <TriangleAlert size={13} className="text-amber" aria-hidden />
            ) : (
              <Circle size={10} strokeWidth={2.2} className="text-ink-3" aria-hidden />
            )}
          </span>
          <span className="line-clamp-2 min-w-0">{t}</span>
        </li>
      ))}
      {items.length > shown.length ? (
        <li className="pl-6 text-[13px] text-ink-3">and {items.length - shown.length} more in the evidence</li>
      ) : null}
    </ul>
  );
}

function Step({
  node,
  title,
  when,
  into,
  out,
  muted = false,
  children,
}: {
  node: ReactNode;
  title: string;
  when: ReactNode;
  into?: Seg;
  out?: Seg;
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="seq-step" data-muted={muted ? "true" : "false"}>
      <div className="seq-head" aria-hidden>
        {into ? <span className="seq-seg seq-into" data-seg={into} /> : null}
        <span className="seq-node">{node}</span>
        {out ? <span className="seq-seg seq-out" data-seg={out} /> : null}
      </div>
      <div className="seq-body">
        <h3 className="font-semibold text-[18px] text-ink leading-tight tracking-[-0.02em]">{title}</h3>
        <p className="mt-1 text-[13px] text-ink-3">{when}</p>
        <div className="mt-5 grid gap-4">{children}</div>
      </div>
    </li>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 font-medium text-[12.5px] text-ink-3">{children}</p>;
}

export function TransferSequence({
  handoff,
  memories,
  viewerId,
  children,
}: {
  handoff: Handoff;
  memories: SharedMemory[] | null;
  viewerId: string;
  children?: ReactNode;
}) {
  const h = handoff;
  const sender = firstName(h.sender.name);
  const recipient = h.recipient ? firstName(h.recipient.name) : null;
  const revoked = h.status === "revoked";
  const approved = Boolean(h.approvedAt);
  const claimed = Boolean(h.claimedAt);
  const you = (id: string | undefined) => (id === viewerId ? " (you)" : "");
  const shown = memories ?? [];

  return (
    <section aria-label="How the work moved" className="seq-sheet">
      <ol className="seq">
        <Step
          node={<Avatar person={h.sender} side="sender" size={36} />}
          title={`Started by ${sender}${you(h.sender.id)}`}
          when={
            <>
              Checkpointed <Ago at={h.createdAt} />
            </>
          }
          out={approved ? "on" : revoked ? "cut" : "off"}
        >
          {h.remaining.length || h.blockers.length ? (
            <div>
              <Label>Left unfinished</Label>
              <Items items={h.remaining} tone="open" limit={2} />
              {h.blockers.length ? (
                <div className="mt-2">
                  <Items items={h.blockers} tone="blocked" limit={1} />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-[14px] text-ink-3">No open tasks were written down.</p>
          )}
        </Step>

        <Step
          node={
            <span className="grid size-9 place-items-center rounded-full bg-accent-soft">
              <Mark size={20} />
            </span>
          }
          title="What Strata shared"
          when={
            approved ? (
              <>
                Approved by {sender} <Ago at={h.approvedAt as string} />
              </>
            ) : revoked ? (
              "Revoked before anything was shared"
            ) : (
              `Nothing leaves until ${sender} approves`
            )
          }
          into={approved ? "on" : revoked ? "cut" : "off"}
          out={claimed ? "on" : revoked ? "cut" : "off"}
          muted={!approved}
        >
          {approved && !revoked ? (
            <>
              {shown.length ? (
                <div>
                  <Label>{shown.length === 1 ? "An approved memory" : `${shown.length} approved memories`}</Label>
                  <ul className="grid gap-2">
                    {shown.slice(0, 2).map((m) => (
                      <li key={m._id} className="border-accent border-l-2 pl-3 text-[14px] text-ink leading-snug">
                        <InlineMarkdown className="line-clamp-3">{m.text}</InlineMarkdown>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[14px] text-ink-2">
                  {h.memoryIds.length
                    ? `${h.memoryIds.length} approved ${h.memoryIds.length === 1 ? "memory" : "memories"}`
                    : "No memories, only the checkpoint"}
                </p>
              )}
              {h.nextAction ? (
                <div>
                  <Label>The next step</Label>
                  <p className="line-clamp-3 text-[14px] text-ink-2 leading-snug">{h.nextAction}</p>
                </div>
              ) : null}
            </>
          ) : revoked && approved ? (
            <p className="text-[14px] text-ink-2">
              It was shared, then revoked. {recipient ?? "No one"} can no longer read any of it.
            </p>
          ) : (
            <p className="flex items-start gap-2 text-[14px] text-ink-3">
              <Lock size={14} className="mt-[3px] flex-none" aria-hidden />
              {revoked
                ? "Nothing was shared."
                : `The checkpoint and any memories ${sender} picks stay private until approval.`}
            </p>
          )}
        </Step>

        <Step
          node={<Avatar person={h.recipient} side="recipient" size={36} />}
          title={
            recipient
              ? claimed
                ? `Continued by ${recipient}${you(h.recipient?.id)}`
                : `Handed to ${recipient}${you(h.recipient?.id)}`
              : "No one yet"
          }
          when={
            h.completedAt ? (
              <>
                Finished <Ago at={h.completedAt} />
              </>
            ) : claimed ? (
              <>
                Resumed <Ago at={h.claimedAt as string} />
              </>
            ) : revoked ? (
              "Never resumed"
            ) : approved ? (
              "Hasn't picked it up yet"
            ) : (
              "Chosen when it's approved"
            )
          }
          into={claimed ? "on" : revoked ? "cut" : "off"}
          muted={!claimed}
        >
          {h.continuation?.completed.length ? (
            <div>
              <Label>Done in their session</Label>
              <Items items={h.continuation.completed} tone="done" limit={3} />
            </div>
          ) : claimed ? (
            <p className="text-[14px] text-ink-2">Working on it in a fresh session, with the shared context.</p>
          ) : null}
        </Step>
      </ol>
      {children}
    </section>
  );
}

// The result, as the sheet's last line: proven, reported, in progress, waiting, a draft, or revoked. Never "done"
// unless it is.
export function Result({ handoff }: { handoff: Handoff }) {
  const h = handoff;
  const recipient = h.recipient ? firstName(h.recipient.name) : "The recipient";
  const tests = latestRuns(h);
  const c = h.continuation;

  let tone: "verified" | "warn" | "danger" | "accent" | "neutral";
  let icon: ReactNode;
  let label: string;
  let title: string;
  let body: string | null = null;

  if (h.status === "completed" && c?.verified) {
    tone = "verified";
    icon = <ShieldCheck size={20} aria-hidden />;
    label = "Verified result";
    title = `${tests.passing} of ${tests.named} test ${tests.named === 1 ? "command passes" : "commands pass"} after ${recipient}'s changes`;
    body = c.summary;
  } else if (h.status === "completed") {
    tone = "warn";
    icon = <TriangleAlert size={20} aria-hidden />;
    label = "Reported, not verified";
    title = tests.named
      ? `${recipient} reported it done; ${tests.passing} of ${tests.named} test commands pass`
      : `${recipient} reported it done; no tests were named`;
    body = c?.summary ?? null;
  } else if (h.status === "revoked") {
    tone = "danger";
    icon = <ShieldX size={20} aria-hidden />;
    label = "Revoked";
    title = "This work was never completed through Strata";
    body = h.revokeReason ? `Reason: ${h.revokeReason}` : null;
  } else if (h.status === "claimed") {
    tone = "warn";
    icon = <Hourglass size={20} aria-hidden />;
    label = "In progress";
    title = `${recipient} is working on it. The result appears here when their tests run.`;
  } else if (h.status === "approved") {
    tone = "accent";
    icon = <CircleDashed size={20} aria-hidden />;
    label = "Not started";
    title = `Waiting for ${recipient} to pick it up`;
  } else {
    tone = "neutral";
    icon = <Lock size={18} aria-hidden />;
    label = "Draft";
    title = "Only you can see this. Review it below, then approve it for a teammate.";
  }

  return (
    <div className="seq-result" data-tone={tone}>
      <span className="seq-result-icon">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="seq-result-label">{label}</p>
        <p className="mt-0.5 font-semibold text-[17px] text-ink leading-snug tracking-[-0.015em]">{title}</p>
        {body ? <p className="mt-1.5 max-w-[72ch] text-[14px] text-ink-2 leading-relaxed">{body}</p> : null}
      </div>
    </div>
  );
}
