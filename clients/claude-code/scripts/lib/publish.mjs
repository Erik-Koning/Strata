// Turns a session's finished local summary into events for the server. The summary is written on this machine; the
// server drafts it as it is (a "summary" finding, plus one finding per insight, workflow note, pain point and gap),
// and the engineer approves it on My Day. Then the session's end event goes out, which is what makes the server draft.
import { enqueueEvent, flushEvents } from "./events.mjs";
import { projectOf } from "./git.mjs";
import { readSummary } from "./records.mjs";

const FINDINGS = [
  ["insights", "insight"],
  ["workflow", "workflow"],
  ["painPoints", "pain_point"],
  ["gaps", "context_gap"],
];

const section = (label, items) => (items?.length ? `${label}: ${items.join("; ")}.` : "");

export function summaryText(summary) {
  return [
    summary.built,
    summary.why ? `Why: ${summary.why}` : "",
    section("Decisions", summary.decisions),
    section("Open", summary.open),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Queue the summary's events, then the session end, and send them. Safe to run again: the server dedupes by text. */
export async function publishSession(sid, cwd) {
  const project = projectOf(cwd);
  const summary = readSummary(sid)?.summary;
  if (summary?.title || summary?.built) {
    enqueueEvent({
      sessionID: sid,
      project,
      kind: "finding",
      payload: { type: "summary", title: summary.title || undefined, text: summaryText(summary) || summary.title },
    });
    for (const [field, type] of FINDINGS)
      for (const text of summary[field] ?? [])
        enqueueEvent({ sessionID: sid, project, kind: "finding", payload: { type, text } });
  }
  enqueueEvent({ sessionID: sid, project, kind: "session", payload: { event: "end", reason: "summarized" } });
  return flushEvents({ force: true });
}
