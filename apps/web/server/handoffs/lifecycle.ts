// The handoff lifecycle's rules, as pure functions (packages/contracts/src/handoff.ts draws it). The service applies
// them; nothing here touches the database.
//
//   draft ──approve──▶ approved ──claim──▶ claimed ──complete──▶ completed
//     └──────────────── revoke (sender) ─────┴──▶ revoked
import type { HandoffStatus } from "@strata/contracts";

export type Party = "sender" | "recipient";

// Who a person is to a handoff: its sender, its recipient, or nobody.
export function partyOf(h: { sender: { id: string }; recipient: { id: string } | null }, userId: string): Party | null {
  if (h.sender.id === userId) return "sender";
  if (h.recipient?.id === userId) return "recipient";
  return null;
}

// What a recipient may read: from approval until it's revoked. Never a draft.
export const RECIPIENT_VISIBLE: readonly HandoffStatus[] = ["approved", "claimed", "completed"];

// Whether a person can see a handoff at all. Everyone else gets the same 404 an id that doesn't exist gets.
export function canRead(
  h: { status: HandoffStatus; sender: { id: string }; recipient: { id: string } | null },
  userId: string,
): boolean {
  const party = partyOf(h, userId);
  if (party === "sender") return true;
  if (party === "recipient") return RECIPIENT_VISIBLE.includes(h.status);
  return false;
}

export type Action = "edit" | "approve" | "claim" | "complete" | "revoke";

// Who may do what, from which statuses.
export const RULES: Record<Action, { party: Party; from: readonly HandoffStatus[] }> = {
  edit: { party: "sender", from: ["draft"] },
  approve: { party: "sender", from: ["draft"] },
  claim: { party: "recipient", from: ["approved"] },
  complete: { party: "recipient", from: ["claimed"] },
  revoke: { party: "sender", from: ["draft", "approved", "claimed"] },
};

// Resuming: the sender may preview it at any point; the recipient while it's theirs to work on.
export function canResume(status: HandoffStatus, party: Party): boolean {
  return party === "sender" || status === "approved" || status === "claimed";
}

// Who may record a test, and when: the sender while drafting it, the recipient once they've claimed it.
export function testerFor(status: HandoffStatus, party: Party): Party | null {
  if (party === "sender" && status === "draft") return "sender";
  if (party === "recipient" && status === "claimed") return "recipient";
  return null;
}

interface Run {
  command: string;
  status: "pass" | "fail";
  verified: boolean;
  by: Party;
  at: Date;
}

// A continuation is verified when every test command's latest verified run by the recipient, since they claimed it,
// passed. A handoff with no test commands has nothing to verify against, so it is never verified. Claims (runs no
// Strata client captured) don't count either way.
export function isVerified(testCommands: string[], tests: Run[], claimedAt: Date | null): boolean {
  if (!testCommands.length || !claimedAt) return false;
  return testCommands.every((command) => {
    let latest: Run | null = null;
    for (const t of tests) {
      if (t.command !== command || t.by !== "recipient" || !t.verified || t.at < claimedAt) continue;
      if (!latest || t.at >= latest.at) latest = t;
    }
    return latest?.status === "pass";
  });
}

// Why a memory shared with a handoff isn't returned now, or null when it still is.
export type ExclusionReason = "forgotten" | "archived" | "expired" | "superseded" | "not_active" | "not_owned";

export function exclusionFor(
  m: { status: string; expiresAt: Date | null; scope: { org: string; user: string } } | null,
  owner: { org: string; user: string },
  now: Date,
): ExclusionReason | null {
  if (!m) return "forgotten";
  if (m.scope.user !== owner.user || m.scope.org !== owner.org) return "not_owned";
  if (m.status === "archived") return "archived";
  if (m.status === "superseded") return "superseded";
  if (m.status !== "active") return "not_active";
  if (m.expiresAt && m.expiresAt.getTime() <= now.getTime()) return "expired";
  return null;
}
