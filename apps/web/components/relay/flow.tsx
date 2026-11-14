// The continuity track: how engineering context moves from one person to the next. Four stages, each read straight
// from the handoff's own timestamps and test runs: the sender's checkpoint, the approval that releases the memories
// they chose, the recipient's claim in a fresh session, and a completion the tests either prove or don't.
import type { Handoff } from "@strata/contracts";
import { Check, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Ago } from "../time.tsx";
import { DrawerTrigger } from "./drawer.tsx";
import { nameOf, shortSha } from "./status.tsx";

type State = "done" | "current" | "pending" | "stopped" | "warn";

type Stage = {
  key: string;
  label: string;
  who: string;
  caption: string;
  at: string | null;
  meta: ReactNode;
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
const named = (p: Handoff["sender"] | null, viewerId: string): string =>
  p ? `${p.name}${p.id === viewerId ? " (you)" : ""}` : "Unassigned";

function stagesOf(h: Handoff, viewerId: string): Stage[] {
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
  const claim = h.continuation?.claimRepo ?? null;
  const shared = h.memoryIds.length;
  const recipient = named(h.recipient, viewerId);
  const verified = h.continuation?.verified === true;

  const completion: Stage = {
    key: "complete",
    label: "Verified completion",
    who: h.completedAt ? (verified ? "Tests verified" : "Reported, not proven") : "Not complete",
    caption: h.completedAt
      ? verified
        ? "Every test command passed after the claim"
        : "Not every test passed in a verified run"
      : h.status === "revoked"
        ? "Stopped when it was revoked"
        : h.status === "claimed"
          ? "Work in progress in Claude Code"
          : "Waiting on the recipient",
    at: h.completedAt,
    meta: tests.named ? `${tests.passing}/${tests.named} test commands passing` : "No test commands named",
    state: h.completedAt ? (verified ? "done" : "warn") : state(3, false),
  };

  return [
    {
      key: "sender",
      label: "Engineer A",
      who: named(h.sender, viewerId),
      caption: h.status === "draft" ? "Reviewing the drafted checkpoint" : "Checkpointed unfinished work",
      at: h.createdAt,
      meta: `${h.completed.length} done · ${h.remaining.length} left · ${h.blockers.length} blocked`,
      state: h.status === "draft" ? "current" : "done",
    },
    {
      key: "memory",
      label: "Approved memory",
      who: h.approvedAt ? `${shared} ${shared === 1 ? "memory" : "memories"} released` : "Not approved",
      caption: h.approvedAt
        ? `Approved by ${nameOf(h.sender, viewerId)}`
        : h.status === "draft"
          ? "Nothing is shared until approval"
          : "Never approved",
      at: h.approvedAt,
      meta: (
        <DrawerTrigger target="evidence-memories" className="text-accent-text hover:underline underline-offset-2">
          Inspect memory →
        </DrawerTrigger>
      ),
      state: state(1, Boolean(h.approvedAt)),
    },
    {
      key: "recipient",
      label: "Engineer B",
      who: recipient,
      caption: h.claimedAt ? "Resumed in a fresh session" : h.recipient ? "Hasn't resumed yet" : "No recipient chosen",
      at: h.claimedAt,
      meta: claim?.commit ? (
        <span className="font-mono">
          {claim.branch ?? "detached"} @ {shortSha(claim.commit)}
        </span>
      ) : (
        "No claim recorded"
      ),
      state: state(2, Boolean(h.claimedAt)),
    },
    completion,
  ];
}

function Node({ state, index }: { state: State; index: number }) {
  return (
    <span className="flow-node" data-state={state === "warn" ? "current" : state} aria-hidden>
      {state === "done" ? (
        <Check size={14} strokeWidth={2.5} />
      ) : state === "stopped" ? (
        <X size={13} strokeWidth={2.5} />
      ) : state === "warn" ? (
        <Minus size={13} strokeWidth={2.5} className="text-amber" />
      ) : (
        index + 1
      )}
    </span>
  );
}

const STATE_LABEL: Record<State, string> = {
  done: "done",
  current: "in progress",
  pending: "not reached",
  stopped: "stopped: revoked",
  warn: "completed without verified tests",
};

export function ContinuityFlow({ handoff, viewerId }: { handoff: Handoff; viewerId: string }) {
  const stages = stagesOf(handoff, viewerId);
  return (
    <section aria-labelledby="flow-title" className="rounded-[var(--radius)] border border-line bg-sunk">
      <h3 id="flow-title" className="sr-only">
        Continuity
      </h3>
      <ol className="grid sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((s, i) => {
          const next = stages[i + 1];
          const filled = s.state === "done" && next ? next.state !== "pending" : false;
          return (
            <li
              key={s.key}
              className={`flex min-w-0 gap-3 border-line px-4 py-4 max-sm:[&:not(:last-child)]:border-b sm:max-xl:[&:nth-child(-n+2)]:border-b sm:max-xl:[&:nth-child(odd)]:border-r xl:flex-col xl:gap-3 xl:px-5 xl:py-5 ${
                s.state === "pending" ? "opacity-60" : ""
              }`}
            >
              <div className="flex flex-none items-center self-start xl:-mr-5 xl:self-stretch">
                <Node state={s.state} index={i} />
                {next ? (
                  <span
                    className="flow-rail relative ml-3 hidden flex-1 xl:block"
                    data-filled={filled ? "true" : "false"}
                    aria-hidden
                  />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="eyebrow">
                  {s.label}
                  <span className="sr-only">, {STATE_LABEL[s.state]}</span>
                </p>
                <p
                  className={`mt-1 truncate font-semibold text-[15px] tracking-[-0.01em] ${
                    s.state === "warn" ? "text-amber" : s.state === "stopped" ? "text-danger" : "text-ink"
                  }`}
                >
                  {s.state === "stopped" ? "Revoked" : s.who}
                </p>
                <p className="mt-0.5 text-[12.5px] text-ink-2 leading-snug">{s.caption}</p>
                <p className="mt-2.5 grid gap-0.5 text-[11.5px] text-ink-3">
                  <span className="min-w-0">{s.meta}</span>
                  {s.at ? (
                    <span className="font-mono text-[11px]">
                      <Ago at={s.at} />
                    </span>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
