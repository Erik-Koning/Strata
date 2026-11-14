// From the sender to the recipient, in order: who did what to the handoff, and when.
import type { Handoff, TimelineEntry } from "@strata/contracts";
import { Ago } from "../time.tsx";
import { nameOf } from "./status.tsx";

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function describe(e: TimelineEntry, recipient: string | null): { text: string; note: string | null; tone: string } {
  const d = e.detail ?? {};
  switch (e.action) {
    case "created":
      return { text: "Drafted the checkpoint", note: str(d.source), tone: "bg-ink-3" };
    case "edited":
      return { text: "Edited the draft", note: null, tone: "bg-ink-3" };
    case "approved": {
      const n = Array.isArray(d.memoryIds) ? d.memoryIds.length : typeof d.memories === "number" ? d.memories : null;
      return {
        text: `Approved it${recipient ? ` for ${recipient}` : ""}`,
        note: n === null ? null : `${n} ${n === 1 ? "memory" : "memories"} shared`,
        tone: "bg-[var(--relay-blue)]",
      };
    }
    case "claimed":
      return {
        text: "Claimed it in a new session",
        note: [str(d.branch), str(d.commit)?.slice(0, 7)].filter(Boolean).join(" @ ") || str(d.sessionID),
        tone: "bg-amber",
      };
    case "test": {
      const status = str(d.status);
      const verified = d.verified === true ? "verified" : d.verified === false ? "claimed" : null;
      return {
        text: `Recorded a test${status ? `: ${status}` : ""}`,
        note: [str(d.command), verified].filter(Boolean).join(" · ") || null,
        tone: status === "fail" ? "bg-danger" : "bg-ink-3",
      };
    }
    case "completed":
      return {
        text: "Completed it",
        note: d.verified === true ? "tests verified" : d.verified === false ? "unverified" : null,
        tone: "bg-accent",
      };
    case "revoked":
      return { text: "Revoked it", note: str(d.reason), tone: "bg-danger" };
    case "memory_excluded":
      return { text: "A shared memory was left out", note: str(d.reason), tone: "bg-ink-3" };
    default:
      return { text: e.action, note: null, tone: "bg-ink-3" };
  }
}

export function Timeline({ handoff, viewerId }: { handoff: Handoff; viewerId: string }) {
  const entries = handoff.timeline;
  if (!entries.length) return null;
  return (
    <section aria-labelledby="timeline-title">
      <h3 id="timeline-title" className="eyebrow">
        Timeline
      </h3>
      <ol className="relative mt-3 grid gap-3 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-line-strong">
        {entries.map((e, i) => {
          const { text, note, tone } = describe(e, handoff.recipient?.name ?? null);
          const side =
            e.actor.id === handoff.sender.id ? "sender" : e.actor.id === handoff.recipient?.id ? "recipient" : null;
          return (
            <li key={`${e.at}-${i}`} className="relative grid grid-cols-[7px_minmax(0,1fr)] gap-3">
              <span className={`relative mt-[7px] size-[7px] rounded-full ring-2 ring-bg ${tone}`} aria-hidden />
              <div className="min-w-0 text-[13px]">
                <p className="text-ink">{text}</p>
                {note ? <p className="truncate font-mono text-[11.5px] text-ink-3">{note}</p> : null}
                <p className="text-[12px] text-ink-3">
                  {nameOf(e.actor, viewerId)}
                  {side ? ` · ${side}` : ""} · <Ago at={e.at} />
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
