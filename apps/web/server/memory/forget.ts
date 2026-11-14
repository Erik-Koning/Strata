// Forgetting: the memories named (or every one a query matches), the events they came from, and every summary made from
// either. A dry run counts what would go and removes nothing, so a person sees it before they confirm. What went is in
// the audit log.
import type { ForgetResponse, Scope } from "@strata/contracts";
import { ObjectId } from "mongodb";
import { audit } from "../audit.ts";
import { type AuditDoc, events, memories, records, summaries } from "../collections.ts";

export interface ForgetInput {
  actor: AuditDoc["actor"];
  // Whose memory: always the person; the project only narrows a query.
  owner: Pick<Scope, "org" | "user"> & { project?: string };
  ids?: string[];
  query?: string;
  dryRun: boolean;
}

export async function forget(input: ForgetInput): Promise<ForgetResponse> {
  const own = { "scope.org": input.owner.org, "scope.user": input.owner.user };
  const filter = input.ids?.length
    ? { ...own, _id: { $in: input.ids.map((id) => new ObjectId(id)) } }
    : {
        ...own,
        ...(input.owner.project ? { "scope.project": input.owner.project } : {}),
        $text: { $search: input.query ?? "" },
      };
  const targets = await memories()
    .find(filter, { projection: { _id: 1, "provenance.eventId": 1 } })
    .limit(500)
    .toArray();
  const ids = targets.map((m) => m._id.toHexString());
  const eventIds = targets.map((m) => m.provenance?.eventId).filter((id): id is string => Boolean(id));
  const summaryFilter = { "scope.user": input.owner.user, sourceIds: { $in: [...ids, ...eventIds] } };
  if (input.dryRun) {
    const [summaryCount, eventCount] = ids.length
      ? await Promise.all([
          summaries().countDocuments(summaryFilter),
          events().countDocuments({ id: { $in: eventIds }, "scope.user": input.owner.user }),
        ])
      : [0, 0];
    return { dryRun: true, ids, memories: ids.length, summaries: summaryCount, events: eventCount };
  }
  if (!ids.length) return { dryRun: false, ids, memories: 0, summaries: 0, events: 0 };
  const [m, s, e] = await Promise.all([
    memories().deleteMany({ ...own, _id: { $in: targets.map((t) => t._id) } }),
    summaries().deleteMany(summaryFilter),
    events().deleteMany({ id: { $in: eventIds }, "scope.user": input.owner.user }),
  ]);
  // An approved record whose memory is forgotten would still show the same words to everyone (records/routes.ts):
  // it's withdrawn too, as discarding it would, and stays visible to its author only.
  const now = new Date();
  const withdrawn = await records().updateMany(
    {
      "scope.org": input.owner.org,
      "scope.user": input.owner.user,
      memoryId: { $in: targets.map((t) => t._id) },
      status: "approved",
    },
    { $set: { status: "discarded", approvedAt: null, updatedAt: now } },
  );
  const result = { dryRun: false, ids, memories: m.deletedCount, summaries: s.deletedCount, events: e.deletedCount };
  await audit({
    actor: input.actor,
    action: "memory.forget",
    targetIds: ids,
    scope: input.owner,
    detail: {
      by: input.ids?.length ? "ids" : "query",
      summaries: result.summaries,
      events: result.events,
      recordsWithdrawn: withdrawn.modifiedCount,
    },
  });
  return result;
}
