import crypto from "node:crypto";
import { listSessions } from "./records.mjs";
import { p, readJson, writeJson } from "./store.mjs";

// What this repo's earlier sessions learned, rebuilt from the summaries on this machine. No model
// call: it is a digest of text the engineer already reviewed or can review, so it is cheap, instant
// and never says more than the summaries do.
const DAYS = 60;
const SIMILAR = 0.5;
const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "for",
  "and",
  "or",
  "is",
  "are",
  "was",
  "were",
  "it",
  "that",
  "this",
  "with",
  "no",
  "not",
  "by",
  "at",
  "as",
  "be",
]);
const words = (text) =>
  new Set(
    String(text)
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((w) => !STOP.has(w)) ?? [],
  );
const fingerprint = (text) =>
  crypto
    .createHash("sha1")
    .update([...words(text)].sort().join(" "))
    .digest("hex")
    .slice(0, 10);
const similar = (a, b) => {
  const [wa, wb] = [words(a), words(b)];
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / Math.max(1, Math.min(wa.size, wb.size)) >= SIMILAR && shared >= 2;
};

// Gaps the engineer has answered. Keyed by repo, matched by wording so a rephrased repeat stays resolved.
const resolvedFile = () => p("resolved-gaps.json");
const resolved = (repoKey) => readJson(resolvedFile(), {})[repoKey] ?? [];
export function resolveGap(repoKey, text) {
  const all = readJson(resolvedFile(), {});
  all[repoKey] = [...new Set([...(all[repoKey] ?? []), fingerprint(text)])];
  writeJson(resolvedFile(), all);
}
const isResolved = (repoKey, text) => resolved(repoKey).includes(fingerprint(text));

function repoSessions(repoKey) {
  const cutoff = Date.now() - DAYS * 86_400_000;
  return listSessions().filter((s) => s.repoKey === repoKey && s.summary && new Date(s.updatedAt).getTime() >= cutoff);
}

/** Items of one kind with the number of different sessions that raised something similar. */
function collect(sessions, list) {
  const groups = [];
  for (const s of sessions) {
    for (const text of s.summary[list] ?? []) {
      const group = groups.find((g) => similar(g.text, text));
      if (!group) groups.push({ text, sessions: new Set([s.sessionId]) });
      else group.sessions.add(s.sessionId);
    }
  }
  return groups.map((g) => ({ text: g.text, count: g.sessions.size }));
}

export function openGaps(repoKey, { limit = 5 } = {}) {
  return collect(repoSessions(repoKey), "gaps")
    .filter((g) => !isResolved(repoKey, g.text))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Pain points and gaps raised in two or more sessions: the ones worth fixing or documenting. */
export function recurring(repoKey) {
  const sessions = repoSessions(repoKey);
  return [
    ...collect(sessions, "painPoints").map((g) => ({ ...g, kind: "pain-point" })),
    ...collect(sessions, "gaps")
      .filter((g) => !isResolved(repoKey, g.text))
      .map((g) => ({ ...g, kind: "gap" })),
  ]
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count);
}

/** The text SessionStart hands to Claude. Empty when there is nothing worth saying. */
export function buildOverview(repoKey, { insights = 5, workflow = 4 } = {}) {
  const sessions = repoSessions(repoKey);
  if (!sessions.length) return "";
  const top = (list, n) =>
    collect(sessions, list)
      .sort((a, b) => b.count - a.count)
      .slice(0, n)
      .map((g) => `- ${g.text}`);
  const gaps = openGaps(repoKey);
  const repeated = recurring(repoKey).slice(0, 4);
  const sections = [
    ["What earlier sessions in this repo learned", top("insights", insights)],
    ["How work gets done here", top("workflow", workflow)],
    ["Keeps slowing work down (raised in several sessions)", repeated.map((g) => `- ${g.text} (${g.count} sessions)`)],
    [
      "Information earlier sessions could not find",
      gaps.map((g) => `- ${g.text}${g.count > 1 ? ` (${g.count} sessions)` : ""}`),
    ],
  ].filter(([, lines]) => lines.length);
  if (!sections.length) return "";
  return [
    'Strata notes from earlier sessions in this repo (summaries, possibly out of date; verify before relying on them). If your work answers one of the missing items, tell the user; if one is still missing, log it with strata_record kind "gap".',
    ...sections.map(([title, lines]) => `${title}:\n${lines.join("\n")}`),
  ].join("\n\n");
}
