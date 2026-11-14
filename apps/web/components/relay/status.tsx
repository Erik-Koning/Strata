import type { HandoffStatus, Person } from "@strata/contracts";

const STATUS_LABEL: Record<HandoffStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  claimed: "Claimed",
  completed: "Completed",
  revoked: "Revoked",
};

export function StatusPill({ status }: { status: HandoffStatus }) {
  return (
    <span className={`chip pill-${status}`}>
      <span className={`dot ${status === "draft" || status === "revoked" ? "dot-hollow" : ""}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

// The same status as a quiet legend, for dense lists: a pip and a word in the status colour, no fill.
const STATUS_TEXT: Record<HandoffStatus, string> = {
  draft: "text-ink-3",
  approved: "text-[var(--relay-blue)]",
  claimed: "text-amber",
  completed: "text-verified-text",
  revoked: "text-danger",
};

export function StatusText({ status }: { status: HandoffStatus }) {
  return (
    <span className={`inline-flex flex-none items-center gap-1.5 font-medium ${STATUS_TEXT[status]}`}>
      <span className={`dot ${status === "draft" || status === "revoked" ? "dot-hollow" : ""}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

// Evidence vs claim: verified only when Strata's own client ran the command and captured its exit code.
export function EvidenceBadge({ verified }: { verified: boolean }) {
  return (
    <span
      className={`chip min-h-5 px-1.5 ${verified ? "badge-verified" : "badge-claimed"}`}
      title={
        verified
          ? "Strata's client ran this command and captured its exit code."
          : "Someone reported this result. Strata didn't run it."
      }
    >
      {verified ? "VERIFIED" : "CLAIMED"}
    </span>
  );
}

export const nameOf = (p: Person | null, viewerId: string): string =>
  p ? (p.id === viewerId ? "you" : p.name) : "no one yet";

export const shortSha = (sha: string | null | undefined): string | null => (sha ? sha.slice(0, 7) : null);
