// Handoff and memory documents as the API answers them: plain JSON, ids as hex strings, dates as ISO strings.
import type { Handoff, HandoffListItem, SharedMemory } from "@strata/contracts";
import type { HandoffDoc, MemoryDoc } from "../collections.ts";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toHandoff(doc: HandoffDoc): Handoff {
  return {
    _id: doc._id.toHexString(),
    project: doc.project,
    title: doc.title,
    summary: doc.summary,
    completed: doc.completed,
    remaining: doc.remaining,
    blockers: doc.blockers,
    failedApproaches: doc.failedApproaches,
    decisions: doc.decisions,
    changedFiles: doc.changedFiles,
    nextAction: doc.nextAction,
    testCommands: doc.testCommands,
    repo: doc.repo ?? null,
    sourceSessionID: doc.sourceSessionID ?? null,
    status: doc.status,
    sender: doc.sender,
    recipient: doc.recipient ?? null,
    memoryIds: doc.memoryIds.map((id) => id.toHexString()),
    tests: doc.tests.map((t) => ({ ...t, at: t.at.toISOString() })),
    continuation: doc.continuation ?? null,
    timeline: doc.timeline.map((e) => ({ ...e, at: e.at.toISOString() })),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    approvedAt: iso(doc.approvedAt),
    claimedAt: iso(doc.claimedAt),
    completedAt: iso(doc.completedAt),
    revokedAt: iso(doc.revokedAt),
    revokeReason: doc.revokeReason ?? null,
  };
}

export function toListItem(doc: HandoffDoc): HandoffListItem {
  return {
    _id: doc._id.toHexString(),
    project: doc.project,
    title: doc.title,
    status: doc.status,
    sender: doc.sender,
    recipient: doc.recipient ?? null,
    nextAction: doc.nextAction,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toSharedMemory(m: MemoryDoc, correctionOf: string | null = null): SharedMemory {
  return {
    _id: m._id.toHexString(),
    kind: m.kind,
    text: m.text,
    ownerId: m.scope.user,
    project: m.scope.project,
    trust: m.trust,
    createdAt: m.createdAt.toISOString(),
    provenance: {
      sessionID: m.provenance?.sessionID ?? null,
      source: m.provenance?.source ?? "unknown",
      eventId: m.provenance?.eventId ?? null,
      recordId: m.provenance?.recordId ?? null,
    },
    correctionOf,
  };
}
