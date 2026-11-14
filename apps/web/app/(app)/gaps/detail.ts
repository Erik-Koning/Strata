// What a gap's own page shows beyond the gap itself: the sessions it came from, as each put it, and its history (each
// time it came up, and each time someone took it on, resolved or reopened it). Nothing here reads the database: the
// sessions come through the team read model and the history from the gaps module (server/hub/gaps.ts), both as the
// viewer, so their rules hold.
import type { GapDetail } from "../../../server/hub/gaps.ts";
import type { ViewerRef } from "../../../server/hub/reader.ts";
import { type Person, sessionDetail } from "../../../server/hub/team-records.ts";
import { normalizeText } from "../../../server/hub/text.ts";

export { type GapEvent, gapHistory } from "../../../server/hub/gaps.ts";

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
