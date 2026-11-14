// The continuity track: how engineering context moves from one person to the next. Four stages, each read straight
// from the handoff's own timestamps and test runs: the sender's checkpoint, the approval that releases the memories
// they chose, the recipient's claim in a fresh session, and a completion the tests either prove or don't.
//
// Two views of the same four stages: a slim track at the top of a handoff that says where it stands at a glance (each
// stop links down to its stage), and the journey below it, where each stage carries its own evidence in the order it
// happened.
import type { Handoff, Person } from "@strata/contracts";
import { Check, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Ago } from "../time.tsx";

export type State = "done" | "current" | "pending" | "stopped" | "warn";

export type StageKey = "checkpoint" | "memory" | "resume" | "complete";

type Stage = {
  key: StageKey;
  label: string;
  summary: string;
  at: string | null;
  state: State;
};

// For each named test command, its latest run: what a reader would call "passing now".
export function latestRuns(handoff: Handoff) {
  const latest = new Map<string, Handoff["tests"][number]>();
  for (const t of handoff.tests) latest.set(t.command, t);
  const named = handoff.testCommands.length ? handoff.testCommands : [...latest.keys()];
  const runs = named.map((c) => latest.get(c)).filter((t): t is Handoff["tests"][number] => Boolean(t));
  return { named: named.length, passing: runs.filter((t) => t.status === "pass").length, ran: runs.length };
}

// Full names tell the story better than "you": Alice → Bob, with the viewer marked.
export const named = (p: Person | null, viewerId: string): string =>
  p ? `${p.name}${p.id === viewerId ? " (you)" : ""}` : "Unassigned";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

// A person, as initials in a ring. The sender is drawn in ink, the recipient in the handed-on blue.
export function Avatar({
  person,
  side,
  size = 22,
}: {
  person: Person | null;
  side: "sender" | "recipient";
  size?: number;
}) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={`grid flex-none place-items-center rounded-full font-semibold tracking-[0.02em] ${
        person
          ? side === "sender"
            ? "bg-surface-3 text-ink-2 ring-1 ring-line-strong"
            : "bg-[var(--relay-blue-soft)] text-[var(--relay-blue)] ring-1 ring-[color-mix(in_srgb,var(--relay-blue)_35%,transparent)]"
          : "text-ink-3 ring-1 ring-line-strong ring-dashed"
      }`}
    >
      {person ? initials(person.name) : "?"}
    </span>
  );
}

export function stagesOf(h: Handoff, viewerId: string): Record<StageKey, Stage> {
  const order = ["draft", "approved", "claimed", "completed"] as const;
  const reached = h.status === "revoked" ? -1 : order.indexOf(h.status as (typeof order)[number]);
  // Where a revoked handoff stopped: the first stage it never reached.
  const stoppedAt = h.status === "revoked" ? (h.claimedAt ? 3 : h.approvedAt ? 2 : 1) : -1;
  // The stage someone is working on now: the sender's review while it's a draft, then the step after the last reached.
  const current = reached === 0 ? 0 : reached + 1;
  const state = (i: number, doneWhen: boolean): State => {
    if (stoppedAt >= 0) return i < stoppedAt ? "done" : i === stoppedAt ? "stopped" : "pending";
    if (doneWhen) return "done";
    return i === current ? "current" : "pending";
  };
  const tests = latestRuns(h);
  const shared = h.memoryIds.length;
  const recipient = h.recipient ? named(h.recipient, viewerId) : "the recipient";
  const verified = h.continuation?.verified === true;

  return {
    checkpoint: {
      key: "checkpoint",
      label: "Checkpoint",
      summary: h.status === "draft" ? "In review" : named(h.sender, viewerId),
      at: h.createdAt,
      state: h.status === "draft" ? "current" : "done",
    },
    memory: {
      key: "memory",
      label: "Approved",
      summary: h.approvedAt
        ? `${shared} ${shared === 1 ? "memory" : "memories"} released`
        : h.status === "revoked"
          ? "Never approved"
          : "Nothing shared yet",
      at: h.approvedAt,
      state: state(1, Boolean(h.approvedAt)),
    },
    resume: {
      key: "resume",
      label: "Resumed",
      summary: h.claimedAt ? recipient : h.recipient ? `Waiting on ${recipient}` : "No recipient yet",
      at: h.claimedAt,
      state: state(2, Boolean(h.claimedAt)),
    },
    complete: {
      key: "complete",
      label: h.completedAt && !verified ? "Completed" : "Verified",
      summary: h.completedAt
        ? verified
          ? `${tests.passing}/${tests.named} tests passing`
          : "Reported, not proven"
        : h.status === "revoked"
          ? "Stopped"
          : tests.named
            ? `${tests.passing}/${tests.named} tests passing`
            : "No tests named",
      at: h.completedAt,
      state: h.completedAt ? (verified ? "done" : "warn") : state(3, false),
    },
  };
}

export const STAGE_ORDER: StageKey[] = ["checkpoint", "memory", "resume", "complete"];

export function Node({ state, index, size = 22 }: { state: State; index: number; size?: number }) {
  return (
    <span
      className="flow-node"
      data-state={state}
      style={{ width: size, height: size, fontSize: size > 22 ? 11 : 10.5 }}
      aria-hidden
    >
      {state === "done" ? (
        <Check size={size > 22 ? 13 : 12} strokeWidth={2.75} />
      ) : state === "stopped" ? (
        <X size={12} strokeWidth={2.75} />
      ) : state === "warn" ? (
        <Minus size={12} strokeWidth={2.75} />
      ) : (
        index + 1
      )}
    </span>
  );
}

export const STATE_LABEL: Record<State, string> = {
  done: "done",
  current: "in progress",
  pending: "not reached",
  stopped: "stopped: revoked",
  warn: "completed without verified tests",
};

// The glanceable track: four stops on one rail. The rail fills up to the last stage reached.
export function ContinuityTrack({ handoff, viewerId }: { handoff: Handoff; viewerId: string }) {
  const stages = stagesOf(handoff, viewerId);
  const list = STAGE_ORDER.map((k) => stages[k]);
  return (
    <nav aria-label="Continuity" className="relative">
      <ol className="grid grid-cols-2 gap-y-4 sm:grid-cols-4">
        {list.map((s, i) => {
          const next = list[i + 1];
          const filled = (s.state === "done" || s.state === "warn") && next && next.state !== "pending";
          return (
            <li key={s.key} className="relative min-w-0">
              {next ? (
                <span
                  className="flow-rail top-[10.5px] right-0 left-[30px] max-sm:hidden"
                  data-filled={filled ? "true" : "false"}
                  aria-hidden
                />
              ) : null}
              <a
                href={`#stage-${s.key}`}
                className={`group relative flex min-w-0 flex-col gap-2 rounded-[6px] pr-3 outline-offset-4 ${
                  s.state === "pending" ? "text-ink-3" : ""
                }`}
              >
                <Node state={s.state} index={i} />
                <span className="min-w-0">
                  <span className="block text-[11.5px] text-ink-3">
                    {s.label}
                    <span className="sr-only">, {STATE_LABEL[s.state]}</span>
                  </span>
                  <span
                    className={`mt-0.5 block truncate font-medium text-[13px] group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4 ${
                      s.state === "stopped"
                        ? "text-danger"
                        : s.state === "warn"
                          ? "text-amber"
                          : s.state === "pending"
                            ? "text-ink-3"
                            : "text-ink"
                    }`}
                  >
                    {s.state === "stopped" ? "Revoked" : s.summary}
                  </span>
                  <span className="mt-0.5 block h-4 font-mono text-[11px] text-ink-3">
                    {s.at ? <Ago at={s.at} /> : null}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// One stage of the journey: a node on the vertical rail, a one-line headline of what happened, and its evidence.
export function JourneyStep({
  stage,
  index,
  last = false,
  headline,
  aside,
  children,
}: {
  stage: Stage;
  index: number;
  last?: boolean;
  headline: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const quiet = stage.state === "pending";
  return (
    <li
      id={`stage-${stage.key}`}
      aria-labelledby={`stage-${stage.key}-title`}
      className="relative grid scroll-mt-6 grid-cols-[24px_minmax(0,1fr)] gap-x-4"
    >
      {last ? null : (
        <span
          aria-hidden
          className={`absolute top-7 bottom-0 left-[11.5px] w-px ${
            stage.state === "done" || stage.state === "warn" ? "bg-accent/45" : "bg-line-strong"
          }`}
        />
      )}
      <div className="pt-px">
        <Node state={stage.state} index={index} size={24} />
      </div>
      <div className={`min-w-0 ${last ? "" : "pb-9"}`}>
        <header className="flex min-h-6 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id={`stage-${stage.key}-title`} className="min-w-0 text-[14px] leading-6">
            <span className="mr-2 text-ink-3">{stage.label}</span>
            <span className="sr-only">({STATE_LABEL[stage.state]}) </span>
            <span className={`font-medium ${quiet ? "text-ink-3" : "text-ink"}`}>{headline}</span>
          </h3>
          <span className="flex flex-none items-center gap-3 text-[12px] text-ink-3">
            {aside}
            {stage.at ? <Ago at={stage.at} className="font-mono text-[11.5px]" /> : null}
          </span>
        </header>
        {children ? <div className="mt-3.5 grid gap-4">{children}</div> : null}
      </div>
    </li>
  );
}
