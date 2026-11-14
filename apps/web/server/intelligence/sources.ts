// The records Intelligence may read for one person, and nothing else. Every query here filters on the person's own
// organisation and account (docs/about.html, "Private stays private": a person's memories, events, summaries and
// drafts are theirs alone, whatever their role). Approved team records would widen this; they don't exist yet.
//
// What's read: active memories (kept by the person, or said by them), the summaries of their sessions, and the
// findings their agent logged. Candidates aren't evidence: nobody has said yes to them. Prompt, reply and transcript
// text is never read here.
import type { FINDING_TYPES } from "@strata/contracts";
import type { Filter } from "mongodb";
import { ObjectId } from "mongodb";
import { provider } from "../ai/provider.ts";
import { DEFAULT_ORG } from "../api-auth.ts";
import {
  type EventDoc,
  events,
  type MemoryDoc,
  memories,
  type SummaryDoc,
  summaries,
  VECTOR_INDEX,
} from "../collections.ts";
import type { SourceCard, SourceKind } from "./types.ts";

// How much of a person's history one question reads. Enough for months of sessions; the newest first.
export const LIMITS = { memories: 2000, summaries: 500, findings: 1000 } as const;

export const own = (userId: string) => ({ "scope.org": DEFAULT_ORG, "scope.user": userId });

const EVENT_ID = /^[A-Za-z0-9_:.-]{1,80}$/;
const HEX = /^[a-f0-9]{24}$/;

export function parseRef(ref: string): { kind: SourceKind; id: string } | null {
  const [prefix, ...rest] = ref.split(":");
  const id = rest.join(":");
  if (prefix === "mem" && HEX.test(id)) return { kind: "memory", id };
  if (prefix === "sum" && HEX.test(id)) return { kind: "summary", id };
  if (prefix === "fnd" && EVENT_ID.test(id)) return { kind: "finding", id };
  return null;
}

export const memoryCard = (m: Omit<MemoryDoc, "embedding">): SourceCard => ({
  ref: `mem:${m._id.toHexString()}`,
  kind: "memory",
  category: m.kind,
  text: m.text,
  project: m.scope.project,
  sessionID: m.provenance?.sessionID ?? null,
  status: m.status,
  createdAt: m.createdAt.toISOString(),
  updatedAt: (m.updatedAt ?? m.createdAt).toISOString(),
});

export const summaryCard = (s: SummaryDoc): SourceCard => ({
  ref: `sum:${s._id.toHexString()}`,
  kind: "summary",
  category: "summary",
  text: s.summary,
  project: s.scope.project,
  sessionID: s.sessionID,
  status: "generated",
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.createdAt.toISOString(),
});

export function findingCard(e: EventDoc): SourceCard | null {
  const type = typeof e.payload.type === "string" ? e.payload.type : null;
  const text = typeof e.payload.text === "string" ? e.payload.text.trim() : "";
  if (!type || !text) return null;
  return {
    ref: `fnd:${e.id}`,
    kind: "finding",
    category: type,
    text,
    project: e.scope.project,
    sessionID: e.sessionID,
    status: "draft",
    createdAt: e.ts.toISOString(),
    updatedAt: e.ts.toISOString(),
  };
}

export const findingFilter = (userId: string): Filter<EventDoc> => ({
  ...own(userId),
  kind: "finding",
  known: { $ne: false },
});

export interface Corpus {
  cards: SourceCard[];
  counts: { memories: number; summaries: number; findings: number; candidates: number };
}

export async function loadCorpus(userId: string): Promise<Corpus> {
  const [mems, sums, finds, candidates] = await Promise.all([
    memories()
      .find({ ...own(userId), status: "active" }, { projection: { embedding: 0 } })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(LIMITS.memories)
      .toArray(),
    summaries().find(own(userId)).sort({ createdAt: -1 }).limit(LIMITS.summaries).toArray(),
    events().find(findingFilter(userId)).sort({ ts: -1 }).limit(LIMITS.findings).toArray(),
    memories().countDocuments({ ...own(userId), status: "candidate" }),
  ]);
  const findings = finds.map(findingCard).filter((c): c is SourceCard => c !== null);
  return {
    cards: [...mems.map(memoryCard), ...sums.map(summaryCard), ...findings],
    counts: { memories: mems.length, summaries: sums.length, findings: findings.length, candidates },
  };
}

// Atlas reports cosine similarity as (1 + cos) / 2: 0.7 is a cosine of 0.4, close enough to stand without a keyword.
export const MIN_VECTOR_SCORE = 0.7;

// The person's active memories nearest the question, through the vector index recall uses, when it's there.
export async function vectorHits(
  userId: string,
  question: string,
  k = 12,
): Promise<{ scores: Map<string, number>; available: boolean }> {
  const scores = new Map<string, number>();
  try {
    const [vector] = await provider().embed([question]);
    const near = await memories()
      .aggregate<{ _id: ObjectId; score: number }>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: "embedding",
            queryVector: vector,
            numCandidates: k * 20,
            limit: k,
            filter: { ...own(userId), status: "active" },
          },
        },
        { $project: { _id: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();
    for (const m of near) if (m.score >= MIN_VECTOR_SCORE) scores.set(`mem:${m._id.toHexString()}`, m.score);
    return { scores, available: true };
  } catch {
    return { scores, available: false };
  }
}

// One source, if it's the person's. Anyone else's, or one that isn't there, is the same answer: null.
export async function loadSource(
  userId: string,
  ref: string,
): Promise<
  | { kind: "memory"; doc: Omit<MemoryDoc, "embedding">; card: SourceCard }
  | { kind: "summary"; doc: SummaryDoc; card: SourceCard }
  | { kind: "finding"; doc: EventDoc; card: SourceCard }
  | null
> {
  const parsed = parseRef(ref);
  if (!parsed) return null;
  if (parsed.kind === "memory") {
    const doc = await memories().findOne(
      { _id: new ObjectId(parsed.id), ...own(userId) },
      { projection: { embedding: 0 } },
    );
    return doc ? { kind: "memory", doc, card: memoryCard(doc) } : null;
  }
  if (parsed.kind === "summary") {
    const doc = await summaries().findOne({ _id: new ObjectId(parsed.id), ...own(userId) });
    return doc ? { kind: "summary", doc, card: summaryCard(doc) } : null;
  }
  const doc = await events().findOne({ ...findingFilter(userId), id: parsed.id });
  const card = doc ? findingCard(doc) : null;
  return doc && card ? { kind: "finding", doc, card } : null;
}

export const FINDING_LABELS: Record<(typeof FINDING_TYPES)[number], string> = {
  insight: "Insight",
  workflow: "Workflow note",
  pain_point: "Pain point",
  context_gap: "Context gap",
};
