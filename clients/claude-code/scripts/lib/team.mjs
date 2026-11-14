import { api } from "./api.mjs";
import { gitContext } from "./git.mjs";
import { getAuth, getBinding } from "./store.mjs";

// Read side of Strata: what teammates' approved summaries say. Always optional: signed out,
// no project, or an older server without these routes all just mean "no team results".
const project = (cwd) => getBinding(gitContext(cwd).repoKey)?.projectId ?? null;

export async function searchTeam(query, cwd) {
  const auth = getAuth();
  if (!auth?.token) return [];
  try {
    const projectId = project(cwd);
    const route = `/v1/search?q=${encodeURIComponent(query)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`;
    return (await api("GET", route, undefined, { token: auth.token, timeoutMs: 4000 })).results ?? [];
  } catch {
    return [];
  }
}

export async function teamRollups(cwd) {
  const auth = getAuth();
  if (!auth?.token) throw new Error("sign in to see the team roll-up (/strata:login)");
  const projectId = project(cwd);
  if (!projectId) throw new Error("pick a project for this repo first (/strata:project)");
  return (
    (await api("GET", `/v1/rollups?projectId=${encodeURIComponent(projectId)}`, undefined, { token: auth.token }))
      .rollups ?? []
  );
}

export const describeTeamResult = (r) =>
  `[${r.kind}] ${r.text} (${r.title}${r.jira?.length ? `, ${r.jira[0]}` : ""}${r.author ? `, ${r.author}` : ""})`;
