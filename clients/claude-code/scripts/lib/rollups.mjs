import { listSessions } from "./records.mjs";

// Sessions grouped by the work item they belong to: the Jira ticket, else the PR, else "no ticket".
// Built from the summaries on this machine, the local counterpart of Strata's ticket layer.
const LISTS = ["decisions", "open", "insights", "workflow", "painPoints", "gaps"];

function groupOf(s) {
  if (s.links.jira.length) return { key: s.links.jira[0], kind: "ticket" };
  if (s.links.pr?.url) return { key: s.links.pr.url, kind: "pr" };
  return { key: s.links.noTicket ? "(no ticket)" : "(not linked yet)", kind: "none" };
}

export function rollups({ repoKey = null } = {}) {
  const groups = new Map();
  for (const s of listSessions()) {
    if (!s.summary || (repoKey && s.repoKey !== repoKey)) continue;
    const { key, kind } = groupOf(s);
    const id = `${s.repoKey}\0${key}`;
    if (!groups.has(id))
      groups.set(id, {
        key,
        kind,
        repoKey: s.repoKey,
        remote: s.remote ?? "",
        pr: null,
        sessions: [],
        files: new Set(),
        updatedAt: "",
        ...Object.fromEntries(LISTS.map((l) => [l, new Set()])),
      });
    const g = groups.get(id);
    g.pr = g.pr ?? s.links.pr?.url ?? null;
    g.sessions.push({
      sessionId: s.sessionId,
      title: s.title,
      built: s.summary.built,
      status: s.status,
      updatedAt: s.updatedAt,
    });
    for (const f of s.files) g.files.add(f);
    for (const l of LISTS) for (const item of s.summary[l] ?? []) g[l].add(item);
    if (s.updatedAt > g.updatedAt) g.updatedAt = s.updatedAt;
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      files: g.files.size,
      ...Object.fromEntries(LISTS.map((l) => [l, [...g[l]]])),
      sessions: g.sessions.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function renderRollup(g) {
  const lines = [
    `## ${g.key}${g.kind === "ticket" && g.pr ? `  (${g.pr})` : ""}  [${g.sessions.length} session${g.sessions.length === 1 ? "" : "s"}, ${g.files} files]`,
  ];
  for (const s of g.sessions) lines.push(`- ${s.title}: ${s.built || "(no description yet)"} [${s.status}]`);
  for (const [label, key] of [
    ["Decisions", "decisions"],
    ["Open", "open"],
    ["Insights", "insights"],
    ["Workflow", "workflow"],
    ["Pain points", "painPoints"],
    ["Gaps", "gaps"],
  ]) {
    if (g[key].length) lines.push(`${label}:`, ...g[key].map((x) => `  - ${x}`));
  }
  return lines.join("\n");
}
