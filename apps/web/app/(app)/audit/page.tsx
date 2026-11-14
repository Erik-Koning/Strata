import { Archive, KeyRound, ScrollText, Sparkles, Trash2, Wand2 } from "lucide-react";
import type { Metadata } from "next";
import { Ago } from "../../../components/time.tsx";
import type { AuditDoc } from "../../../server/collections.ts";
import { auditTrail } from "../../../server/stats.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Audit log" };

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function describe(entry: AuditDoc): { icon: typeof Trash2; text: string; tone: string } {
  const d = entry.detail as Record<string, unknown>;
  switch (entry.action) {
    case "memory.forget":
      return {
        icon: Trash2,
        tone: "text-danger",
        text: `Forgot ${n(entry.targetIds.length, "memory", "memories")}, with ${n(Number(d.summaries ?? 0), "summary", "summaries")} and ${n(Number(d.events ?? 0), "event")}`,
      };
    case "memory.save":
      return {
        icon: Sparkles,
        tone: "text-accent-text",
        text: `Saved a ${String(d.kind ?? "memory")} (${d.source === "manual" ? "added here" : "by a tool"})`,
      };
    case "memory.compress":
      return {
        icon: Wand2,
        tone: "text-ink-2",
        text: `Summarized a session at compaction (${Number(d.messages ?? 0)} messages)`,
      };
    case "memory.promote":
      return { icon: Archive, tone: "text-ink-2", text: "Changed a memory's status" };
    case "key.create":
      return { icon: KeyRound, tone: "text-accent-text", text: `Made the API key “${String(d.name ?? "")}”` };
    case "key.revoke":
      return { icon: KeyRound, tone: "text-danger", text: "Revoked an API key" };
    default:
      return { icon: ScrollText, tone: "text-ink-2", text: entry.action };
  }
}

export default async function AuditPage() {
  const viewer = await requireViewer();
  const entries = await auditTrail(viewer.userId);
  return (
    <>
      <PageHeader
        eyebrow="Audit log"
        title="What changed, and who did it"
        lede="Every memory saved or forgotten, every summary made at a compaction, every key made or revoked."
      />
      {entries.length ? (
        <ol className="card divide-y divide-line">
          {entries.map((e) => {
            const { icon: Icon, text, tone } = describe(e);
            return (
              <li key={e._id?.toHexString()} className="flex gap-4 px-5 py-4">
                <span className={`mt-0.5 grid size-8 flex-none place-items-center rounded-[9px] bg-surface-2 ${tone}`}>
                  <Icon size={15} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px]">{text}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">
                    by{" "}
                    {e.actor.kind === "user"
                      ? "you"
                      : e.actor.kind === "key"
                        ? `key “${e.actor.label}”`
                        : e.actor.label}
                    {e.scope && "project" in e.scope && e.scope.project ? ` · ${e.scope.project}` : ""}
                  </p>
                </div>
                <Ago at={e.ts.toISOString()} className="flex-none text-[12.5px] text-ink-3" />
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="card px-6 py-12 text-center">
          <p className="font-semibold text-[16px]">Nothing recorded yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
            Saving, forgetting and key changes appear here as they happen.
          </p>
        </div>
      )}
    </>
  );
}
