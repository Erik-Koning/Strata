// What a gap's own page shows beyond the gap itself: the sessions it came from, as each put it, and its history (each
// time it came up, and each time someone took it on, resolved or reopened it). Reads only for a viewer who may read
// approved work (server/hub/reader.ts); the sessions are read through the team read model, so its rules hold.
import { ObjectId } from "mongodb";
import { audits, gaps } from "../../../server/collections.ts";
import type { GapDetail } from "../../../server/hub/gaps.ts";
import { reader, type ViewerRef } from "../../../server/hub/reader.ts";
import { namesOf, type Person, sessionDetail } from "../../../server/hub/team-records.ts";
import { normalizeText } from "../../../server/hub/text.ts";

export interface GapSource {
  sessionId: string;
  // The session's summary title, when it has one.
  title: string | null;
  author: Person | null;
  productId: string | null;
  repo: string;
  // The session's latest approval.
  at: Date;
  // How the session put the gap: the finding the agent logged, or the line in the session's summary. Empty when the
  // session worded it differently from the gap's text.
  lines: { id: string; text: string; source: "record" | "summary"; at: Date }[];
}

// The sessions a gap came up in, newest first, up to `limit`.
export async function gapSources(gap: GapDetail, viewer: ViewerRef, limit = 20): Promise<GapSource[]> {
  const key = normalizeText(gap.text);
  const details = await Promise.all(gap.sessionIds.slice(0, limit).map((id) => sessionDetail(id, viewer)));
  return details.flatMap((session) =>
    session
      ? [
          {
            sessionId: session.sessionId,
            title: session.title,
            author: session.author,
            productId: session.productId,
            repo: session.repo,
            at: session.at,
            lines: session.records
              .filter((r) => r.status === "approved" && r.kind === "context_gap" && normalizeText(r.text) === key)
              .map((r) => ({ id: r.id, text: r.text, source: r.source, at: r.at })),
          },
        ]
      : [],
  );
}

export type GapEvent =
  | { kind: "session"; at: Date; sessionId: string }
  | { kind: "question"; at: Date }
  | { kind: "take" | "resolve" | "reopen"; at: Date; by: string; url: string | null };

const CHANGES = { "gap.take": "take", "gap.resolve": "resolve", "gap.reopen": "reopen" } as const;

// Each time the gap came up and each change made to it, newest first, up to `limit`. Who asked a question isn't kept,
// so a question has no name; a change carries the name of the person who made it.
export async function gapHistory(id: string, viewer: ViewerRef, limit = 50): Promise<GapEvent[]> {
  if (!/^[a-f0-9]{24}$/i.test(id) || !(await reader(viewer))) return [];
  const [doc, changes] = await Promise.all([
    gaps().findOne({ _id: new ObjectId(id) }, { projection: { occurrences: 1 } }),
    audits()
      .find({ targetIds: id, action: { $in: Object.keys(CHANGES) as (keyof typeof CHANGES)[] } })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray(),
  ]);
  if (!doc) return [];
  const names = await namesOf(changes.map((c) => c.actor.id));
  const seen: GapEvent[] = (doc.occurrences ?? []).map((o) =>
    o.sessionId
      ? { kind: "session", at: new Date(o.at), sessionId: o.sessionId }
      : { kind: "question", at: new Date(o.at) },
  );
  const made: GapEvent[] = changes.flatMap((c) => {
    const kind = CHANGES[c.action as keyof typeof CHANGES];
    if (!kind) return [];
    const url = typeof c.detail.url === "string" ? c.detail.url : null;
    return [{ kind, at: c.ts, by: names.get(c.actor.id) ?? c.actor.label, url }];
  });
  return [...seen, ...made].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
