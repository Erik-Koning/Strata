// The evidence behind one citation: the record as stored, where it came from, the session it belongs to (its links
// and how much it captured, never what was said), and the records related to it. Only for the record's owner; anyone
// else gets null, the same as for a record that isn't there.
import { DEFAULT_ORG } from "../api-auth.ts";
import { events, summaries } from "../collections.ts";
import { CATEGORY_LABELS } from "./answer.ts";
import { loadCorpus, loadSource, own } from "./sources.ts";
import { rank, tokens } from "./text.ts";
import type { Evidence, SessionContext, SourceCard } from "./types.ts";

const SOURCE_LABELS: Record<string, string> = {
  prompt: "Your own words, in a prompt",
  assistant: "Said by the agent (kept by you)",
  tool: "A tool",
  compaction: "A compaction",
  manual: "Added by you on the Memories page",
  seed: "Seeded data",
};

export async function sessionContext(userId: string, sessionID: string): Promise<SessionContext | null> {
  const filter = { ...own(userId), sessionID };
  const [kinds, starts] = await Promise.all([
    events()
      .aggregate<{ _id: string; count: number; first: Date; last: Date; project: string; client: string | null }>([
        { $match: filter },
        {
          $group: {
            _id: "$kind",
            count: { $sum: 1 },
            first: { $min: "$ts" },
            last: { $max: "$ts" },
            project: { $first: "$scope.project" },
            client: { $first: "$client" },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray(),
    events()
      .find({ ...filter, kind: "session" }, { projection: { payload: 1, ts: 1 } })
      .sort({ ts: -1 })
      .limit(20)
      .toArray(),
  ]);
  if (!kinds.length) return null;
  // The latest git context and links the session reported.
  const git = starts.map((e) => e.payload.git as Record<string, unknown> | undefined).find(Boolean) ?? {};
  const refs = new Map<string, SessionContext["refs"][number]>();
  for (const e of starts)
    for (const r of (Array.isArray(e.payload.refs) ? e.payload.refs : []) as Record<string, unknown>[])
      if (typeof r?.id === "string" && typeof r?.type === "string")
        refs.set(`${r.type}:${r.id}`, {
          type: r.type,
          id: r.id,
          ...(typeof r.system === "string" ? { system: r.system } : {}),
          ...(typeof r.url === "string" && /^https?:\/\//.test(r.url) ? { url: r.url } : {}),
        });
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    sessionID,
    project: kinds[0]!.project,
    repo: str(git.remote),
    branch: str(git.branch),
    head: str(git.head),
    refs: [...refs.values()],
    first: new Date(Math.min(...kinds.map((k) => k.first.getTime()))).toISOString(),
    last: new Date(Math.max(...kinds.map((k) => k.last.getTime()))).toISOString(),
    captured: kinds.map((k) => ({ kind: k._id, count: k.count })),
    client: kinds.find((k) => k.client)?.client ?? null,
  };
}

export async function evidenceFor(userId: string, ref: string, cited = true): Promise<Evidence | null> {
  const found = await loadSource(userId, ref);
  if (!found) return null;
  const { card } = found;
  const provenance: Evidence["provenance"] = [
    { label: "Source id", value: card.ref, mono: true },
    { label: "Record", value: kindLabel(card) },
    { label: "Project", value: card.project === "*" ? "Every project" : card.project, mono: card.project !== "*" },
  ];
  const timestamps: Evidence["timestamps"] = [];
  const notes: string[] = [];

  if (found.kind === "memory") {
    const m = found.doc;
    provenance.push(
      { label: "Status", value: m.status },
      { label: "Trust", value: m.trust },
      { label: "Confidence", value: `${Math.round(m.confidence * 100)}%` },
      { label: "Came from", value: SOURCE_LABELS[m.provenance?.source] ?? m.provenance?.source ?? "unknown" },
    );
    if (m.provenance?.eventId) provenance.push({ label: "Event", value: m.provenance.eventId, mono: true });
    if (m.provenance?.messageID) provenance.push({ label: "Message", value: m.provenance.messageID, mono: true });
    if (m.supersedes) provenance.push({ label: "Supersedes", value: `mem:${m.supersedes.toHexString()}`, mono: true });
    timestamps.push({ label: "Remembered", at: m.createdAt.toISOString() });
    if (m.updatedAt && m.updatedAt.getTime() !== m.createdAt.getTime())
      timestamps.push({ label: "Last changed", at: m.updatedAt.toISOString() });
    if (m.expiresAt) timestamps.push({ label: "Expires", at: m.expiresAt.toISOString() });
    const used = await summaries().countDocuments({
      ...own(userId),
      sourceIds: { $in: [m._id.toHexString(), ...(m.provenance?.eventId ? [m.provenance.eventId] : [])] },
    });
    if (used) notes.push(`Part of ${used} session ${used === 1 ? "summary" : "summaries"}.`);
  } else if (found.kind === "summary") {
    const s = found.doc;
    provenance.push({ label: "Made from", value: `${s.sourceIds.length.toLocaleString()} captured events` });
    timestamps.push({ label: "Summarized", at: s.createdAt.toISOString() });
    const still = await events().countDocuments({ ...own(userId), id: { $in: s.sourceIds.slice(0, 5000) } });
    notes.push(
      still === s.sourceIds.length
        ? "Every event it was made from is still stored."
        : `${still.toLocaleString()} of the ${s.sourceIds.length.toLocaleString()} events it was made from are still stored; the rest expired or were forgotten.`,
    );
  } else {
    const e = found.doc;
    provenance.push({ label: "Event", value: e.id, mono: true });
    if (e.client) provenance.push({ label: "Client", value: e.client, mono: true });
    provenance.push({ label: "Contract", value: `v${e.v ?? 1}` });
    timestamps.push({ label: "Logged", at: e.ts.toISOString() });
    timestamps.push({ label: "Received", at: e.receivedAt.toISOString() });
    const links = (Array.isArray(e.payload.refs) ? e.payload.refs : []) as Record<string, unknown>[];
    for (const r of links)
      if (typeof r?.id === "string")
        provenance.push({ label: `Link (${String(r.type ?? "ref")})`, value: r.id, mono: true });
  }

  const session = card.sessionID ? await sessionContext(userId, card.sessionID) : null;
  if (card.sessionID && !session)
    notes.push("Its session's captured events have expired or were forgotten; only the session id is left.");

  return {
    source: card,
    provenance,
    timestamps,
    session,
    related: await related(userId, card),
    authorization: {
      owner: "You",
      visibility:
        card.kind === "finding"
          ? "Draft: only you"
          : card.status === "candidate"
            ? "Candidate: only you"
            : "Private to you",
      basis: `Shown because it's in your own scope (organisation “${DEFAULT_ORG}”, your account). Nobody else, admins included, can open it here.`,
      cited,
    },
    notes,
  };
}

// The same session's other records first, then the records nearest in wording.
async function related(userId: string, card: SourceCard): Promise<SourceCard[]> {
  const { cards } = await loadCorpus(userId);
  const others = cards.filter((c) => c.ref !== card.ref);
  const sameSession = card.sessionID ? others.filter((c) => c.sessionID === card.sessionID) : [];
  const terms = [...new Set(tokens(card.text))].slice(0, 24);
  const near = rank(
    others.map((c) => ({ id: c.ref, text: c.text, extra: c.project })),
    terms,
    { minCoverage: 0.2 },
  );
  const byRef = new Map(others.map((c) => [c.ref, c]));
  const out = new Map<string, SourceCard>();
  for (const c of sameSession.slice(0, 3)) out.set(c.ref, c);
  for (const s of near) if (out.size < 5) out.set(s.id, byRef.get(s.id)!);
  return [...out.values()];
}

export function kindLabel(card: SourceCard): string {
  const what = CATEGORY_LABELS[card.category]?.one ?? card.category.replace(/_/g, " ");
  if (card.kind === "memory") return `Memory · ${what}`;
  if (card.kind === "finding") return `Finding · ${what}`;
  return "Session summary";
}
