import {
  Archive,
  CircleCheck,
  KeyRound,
  MailPlus,
  MailX,
  Puzzle,
  RotateCcw,
  ScrollText,
  Sparkles,
  Trash2,
  UserCheck,
  UserCog,
  Users,
  UserX,
  Wand2,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Ago } from "../../../components/time.tsx";
import { isRole, ROLE_LABELS } from "../../../server/access.ts";
import type { AuditDoc } from "../../../server/collections.ts";
import { namesFor } from "../../../server/people.ts";
import { auditTrail, orgAuditTrail } from "../../../server/stats.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Audit log" };

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const role = (r: unknown) => (isRole(r) ? ROLE_LABELS[r] : String(r));
// A gap's text as the audit entry kept it: its first 120 characters.
const gapText = (t: unknown) => {
  const text = String(t ?? "").trim();
  return text.length >= 120 ? `${text}…` : text;
};

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
    case "summary.receive":
      return {
        icon: Sparkles,
        tone: "text-accent-text",
        text: `Received an approved session summary (revision ${Number(d.revision ?? 1)})`,
      };
    case "summary.retract":
      return {
        icon: Trash2,
        tone: "text-danger",
        text: `Retracted a session summary (${n(Number(d.revisions ?? 1), "revision")})`,
      };
    case "record.draft":
      return { icon: Sparkles, tone: "text-ink-2", text: `Drafted ${n(Number(d.records ?? 0), "record")} for review` };
    case "record.edit":
      return { icon: Archive, tone: "text-ink-2", text: "Edited a drafted record" };
    case "record.approve":
      return {
        icon: UserCheck,
        tone: "text-accent-text",
        text: `Approved a ${String(d.kind ?? "record")}${d.memoryId ? ", and added it to memory" : ""}`,
      };
    case "record.discard":
      return { icon: Trash2, tone: "text-danger", text: `Discarded a ${String(d.kind ?? "record")}` };
    case "invite.create":
      return { icon: MailPlus, tone: "text-accent-text", text: `Invited ${String(d.email)} as ${role(d.role)}` };
    case "invite.revoke":
      return { icon: MailX, tone: "text-danger", text: `Revoked the invite for ${String(d.email)}` };
    case "invite.accept":
      return { icon: UserCheck, tone: "text-accent-text", text: `Joined as ${role(d.role)}` };
    case "member.role":
      return {
        icon: UserCog,
        tone: "text-ink-2",
        text: `Changed ${String(d.name)}'s role from ${role(d.from)} to ${role(d.to)}`,
      };
    case "member.suspend":
      return {
        icon: UserX,
        tone: "text-danger",
        text: `Suspended ${String(d.name)}, and revoked ${n(Number(d.keysRevoked ?? 0), "API key")}`,
      };
    case "member.restore":
      return { icon: UserCheck, tone: "text-ink-2", text: `Restored ${String(d.name)}'s access` };
    case "team.create":
      return { icon: Users, tone: "text-accent-text", text: `Made the team “${String(d.name)}”` };
    case "team.delete":
      return { icon: Users, tone: "text-danger", text: `Deleted the team “${String(d.name)}”` };
    case "team.member":
      return {
        icon: Users,
        tone: "text-ink-2",
        text:
          d.as === null
            ? `Took ${String(d.name)} out of ${String(d.team)}`
            : `Put ${String(d.name)} in ${String(d.team)} as ${d.as === "manager" ? "a manager" : "a member"}`,
      };
    case "gap.take":
      return { icon: Puzzle, tone: "text-ink-2", text: `Took on the context gap “${gapText(d.text)}”` };
    case "gap.resolve":
      return { icon: CircleCheck, tone: "text-accent-text", text: `Resolved the context gap “${gapText(d.text)}”` };
    case "gap.reopen":
      return { icon: RotateCcw, tone: "text-ink-2", text: `Reopened the context gap “${gapText(d.text)}”` };
    default:
      return { icon: ScrollText, tone: "text-ink-2", text: entry.action };
  }
}

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const viewer = await requireViewer();
  const { who } = await searchParams;
  const everyone = viewer.role === "admin" && who === "everyone";
  const entries = everyone ? await orgAuditTrail() : await auditTrail(viewer.userId);
  const names = await namesFor([...new Set(entries.map((e) => e.actor.id))]);
  const by = (e: AuditDoc) => {
    if (e.actor.id === viewer.userId) return "you";
    if (e.actor.kind === "user") return names.get(e.actor.id) ?? e.actor.label;
    if (e.actor.kind === "key") {
      const owner = names.get(e.actor.id);
      return `key “${e.actor.label}”${everyone && owner ? ` (${owner})` : ""}`;
    }
    return e.actor.label;
  };
  const tab = (active: boolean) =>
    `flex min-h-11 items-center rounded-[9px] px-3 text-[14px] font-medium sm:min-h-9 ${
      active ? "bg-surface text-ink shadow-[var(--shadow)]" : "text-ink-2 hover:text-ink"
    }`;
  return (
    <>
      <PageHeader
        eyebrow="Audit log"
        title="What changed, and who did it"
        lede={
          everyone
            ? "Every change to who has access: invitations, roles, suspensions and teams. What people save, forget or connect in their own memory is theirs, and isn't shown here."
            : "Every record drafted, approved or discarded, every memory saved or forgotten, every summary made at a compaction, every key made or revoked, and any change an admin made to your access."
        }
        actions={
          viewer.role === "admin" ? (
            <nav aria-label="Whose changes" className="flex gap-1 rounded-[11px] bg-surface-2 p-1">
              <Link href="/audit" className={tab(!everyone)} aria-current={everyone ? undefined : "page"}>
                Mine
              </Link>
              <Link href="/audit?who=everyone" className={tab(everyone)} aria-current={everyone ? "page" : undefined}>
                Everyone
              </Link>
            </nav>
          ) : null
        }
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
                    by {by(e)}
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
