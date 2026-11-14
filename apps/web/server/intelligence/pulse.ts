// Product Pulse: the state of the asking person's engineering record, counted straight from what's stored. Every number
// is a count of documents in their own scope; nothing is estimated. What Strata doesn't hold (ticket status, team-wide
// records) is listed as unavailable rather than guessed.
import { FINDING_TYPES } from "@strata/contracts";
import { events, memories, summaries } from "../collections.ts";
import { liveFilter } from "../memory/store.ts";
import { findingCard, findingFilter, memoryCard, own, summaryCard } from "./sources.ts";
import type { Pulse, PulseDay, PulseProject, SourceCard } from "./types.ts";

const DAY = 24 * 60 * 60 * 1000;
const DAYS = 14;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function pulse(userId: string, now = new Date()): Promise<Pulse> {
  const mine = own(userId);
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const sinceDays = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (DAYS - 1) * DAY);
  const perDay = (field: string) => ({ $dateToString: { format: "%Y-%m-%d", date: `$${field}`, timezone: "UTC" } });

  const [
    activeMemories,
    candidates,
    summaryCount,
    findingTypes,
    sessions7,
    sessions30,
    kinds,
    eventDays,
    memoryDays,
    friction,
    discoveries,
    recentMemories,
    recentSummaries,
    signals,
  ] = await Promise.all([
    memories().countDocuments({ ...mine, ...liveFilter() }),
    memories().countDocuments({ ...mine, status: "candidate" }),
    summaries().countDocuments(mine),
    events()
      .aggregate<{ _id: string; count: number }>([
        { $match: findingFilter(userId) },
        { $group: { _id: "$payload.type", count: { $sum: 1 } } },
      ])
      .toArray(),
    events().distinct("sessionID", { ...mine, ts: { $gte: since7 } }),
    events().distinct("sessionID", { ...mine, ts: { $gte: since30 } }),
    memories()
      .aggregate<{ _id: string; count: number }>([
        { $match: { ...mine, ...liveFilter() } },
        { $group: { _id: "$kind", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ])
      .toArray(),
    events()
      .aggregate<{ _id: { day: string; finding: boolean }; count: number }>([
        { $match: { ...mine, ts: { $gte: sinceDays } } },
        { $group: { _id: { day: perDay("ts"), finding: { $eq: ["$kind", "finding"] } }, count: { $sum: 1 } } },
      ])
      .toArray(),
    memories()
      .aggregate<{ _id: string; count: number }>([
        { $match: { ...mine, status: { $in: ["active", "candidate"] }, createdAt: { $gte: sinceDays } } },
        { $group: { _id: perDay("createdAt"), count: { $sum: 1 } } },
      ])
      .toArray(),
    events()
      .find({ ...findingFilter(userId), "payload.type": { $in: ["pain_point", "context_gap"] } })
      .sort({ ts: -1 })
      .limit(6)
      .toArray(),
    events()
      .find({ ...findingFilter(userId), "payload.type": { $in: ["insight", "workflow"] } })
      .sort({ ts: -1 })
      .limit(6)
      .toArray(),
    memories()
      .find({ ...mine, ...liveFilter() }, { projection: { embedding: 0 } })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(8)
      .toArray(),
    summaries().find(mine).sort({ createdAt: -1 }).limit(4).toArray(),
    events()
      .aggregate<{ _id: string; runs: number; failed: number }>([
        { $match: { ...mine, kind: "tool", ts: { $gte: since7 }, "payload.command.class": { $exists: true } } },
        {
          $group: {
            _id: "$payload.command.class",
            runs: { $sum: 1 },
            failed: {
              $sum: {
                $cond: [{ $or: [{ $eq: ["$payload.status", "error"] }, { $gt: ["$payload.command.exit", 0] }] }, 1, 0],
              },
            },
          },
        },
        { $sort: { runs: -1, _id: 1 } },
      ])
      .toArray(),
  ]);

  const findings = Object.fromEntries(FINDING_TYPES.map((t) => [t, 0])) as Pulse["totals"]["findings"];
  for (const f of findingTypes) if (f._id in findings) findings[f._id as keyof typeof findings] = f.count;

  // Coverage: which of the last 30 days' sessions left a memory or a summary behind.
  const recentSessions = sessions30 as string[];
  const [withMemory, withSummary] = await Promise.all([
    memories().distinct("provenance.sessionID", { ...mine, "provenance.sessionID": { $in: recentSessions } }),
    summaries().distinct("sessionID", { ...mine, sessionID: { $in: recentSessions } }),
  ]);
  const either = new Set([...withMemory.map(String), ...withSummary.map(String)]);

  const days: PulseDay[] = [];
  for (let i = 0; i < DAYS; i++) {
    const day = dayKey(new Date(sinceDays.getTime() + i * DAY));
    days.push({
      day,
      events: eventDays.filter((d) => d._id.day === day).reduce((n, d) => n + d.count, 0),
      findings: eventDays.find((d) => d._id.day === day && d._id.finding)?.count ?? 0,
      memories: memoryDays.find((d) => d._id === day)?.count ?? 0,
    });
  }

  const recent: SourceCard[] = [...recentMemories.map(memoryCard), ...recentSummaries.map(summaryCard)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  const cards = (docs: typeof friction) => docs.map(findingCard).filter((c): c is SourceCard => c !== null);
  const projects = await projectRows(userId, since30);

  return {
    generatedAt: now.toISOString(),
    totals: {
      activeMemories,
      candidates,
      summaries: summaryCount,
      sessions7d: sessions7.length,
      sessions30d: sessions30.length,
      projects: projects.length,
      findings,
    },
    coverage: {
      sessions: recentSessions.length,
      withMemory: withMemory.length,
      withSummary: withSummary.length,
      withEither: either.size,
    },
    kinds: kinds.map((k) => ({ kind: k._id, count: k.count })),
    days,
    friction: cards(friction),
    discoveries: cards(discoveries),
    recent,
    projects,
    signals: signals.map((s) => ({ class: s._id, runs: s.runs, failed: s.failed })),
    unavailable: [
      {
        what: "Team-wide records",
        why: "Only your own records are read. Records shared on approval (the records collection) aren't built yet.",
      },
      {
        what: "Ticket and PR status",
        why: "No tracker or GitHub lookup is connected. Ticket keys come from branch names only.",
      },
      {
        what: "AI-written answers",
        why: "The AI provider is the offline stub, so answers are assembled from your records' own words.",
      },
    ],
  };
}

async function projectRows(userId: string, since30: Date): Promise<PulseProject[]> {
  const mine = own(userId);
  const [mems, finds, evs, git] = await Promise.all([
    memories()
      .aggregate<{ _id: string; count: number; last: Date }>([
        { $match: { ...mine, ...liveFilter() } },
        { $group: { _id: "$scope.project", count: { $sum: 1 }, last: { $max: "$updatedAt" } } },
      ])
      .toArray(),
    events()
      .aggregate<{ _id: string; count: number; friction: number }>([
        { $match: findingFilter(userId) },
        {
          $group: {
            _id: "$scope.project",
            count: { $sum: 1 },
            friction: { $sum: { $cond: [{ $in: ["$payload.type", ["pain_point", "context_gap"]] }, 1, 0] } },
          },
        },
      ])
      .toArray(),
    events()
      .aggregate<{ _id: string; sessions: string[]; last: Date }>([
        { $match: { ...mine, ts: { $gte: since30 } } },
        { $group: { _id: "$scope.project", sessions: { $addToSet: "$sessionID" }, last: { $max: "$ts" } } },
      ])
      .toArray(),
    events()
      .aggregate<{ _id: string; git: Record<string, unknown> | null; refs: unknown[] }>([
        { $match: { ...mine, kind: "session", "payload.git": { $exists: true } } },
        { $sort: { ts: -1 } },
        { $group: { _id: "$scope.project", git: { $first: "$payload.git" }, refs: { $push: "$payload.refs" } } },
      ])
      .toArray(),
  ]);
  const names = new Set([...mems, ...finds, ...evs].map((r) => r._id).filter((p) => p && p !== "*"));
  const rows: PulseProject[] = [...names].map((project) => {
    const m = mems.find((r) => r._id === project);
    const f = finds.find((r) => r._id === project);
    const e = evs.find((r) => r._id === project);
    const g = git.find((r) => r._id === project);
    const lasts = [m?.last, e?.last].filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
    const tickets = new Set<string>();
    for (const list of g?.refs ?? [])
      for (const r of (Array.isArray(list) ? list : []) as Record<string, unknown>[])
        if (r?.type === "ticket" && typeof r.id === "string") tickets.add(r.id);
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      project,
      memories: m?.count ?? 0,
      findings: f?.count ?? 0,
      openFriction: f?.friction ?? 0,
      sessions: e?.sessions.length ?? 0,
      lastActivity: lasts.length ? new Date(Math.max(...lasts)).toISOString() : null,
      repo: str(g?.git?.remote),
      branch: str(g?.git?.branch),
      refs: [...tickets].slice(0, 4),
    };
  });
  return rows.sort(
    (a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") || a.project.localeCompare(b.project),
  );
}
