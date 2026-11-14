// Small rules a session's page shows things by: its address, how long something took, and where a repository's own
// pages are. Pure, so the unit tests pin them down.

// A session's page. Session ids come from clients, so the id is encoded.
export const sessionHref = (sessionId: string): string => `/sessions/${encodeURIComponent(sessionId)}`;

// The id in a session page's address, as the session knows it. An id that isn't valid encoding stays as it came.
export function sessionIdFrom(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

// A time as people say it: 840 ms, 4.2 s, 38 s, 2 min 5 s, 1 h 4 min.
export function duration(ms: number): string {
  const total = Math.max(0, ms);
  if (total < 1000) return `${Math.round(total)} ms`;
  const seconds = total / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)} s`;
  if (seconds < 59.5) return `${Math.round(seconds)} s`;
  const wholeSeconds = Math.round(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  if (minutes < 60) {
    const rest = wholeSeconds % 60;
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// A link people may follow: only http and https, whatever a client sent.
export const safeUrl = (url: unknown): string | null =>
  typeof url === "string" && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;

const HOSTS = /^(github\.com|gitlab\.com|bitbucket\.org)\/[^/\s]+\/[^\s]+$/;

// The web page of a repository on a host whose address is the repository's name (github.com/acme/billing), else null.
export const repoUrl = (repo: string): string | null => (HOSTS.test(repo) ? `https://${repo}` : null);

// A commit's page on GitHub or GitLab, else null.
export function commitUrl(repo: string, sha: string): string | null {
  const base = repoUrl(repo);
  if (!base || !/^[0-9a-f]{7,40}$/i.test(sha)) return null;
  if (repo.startsWith("github.com/")) return `${base}/commit/${sha}`;
  if (repo.startsWith("gitlab.com/")) return `${base}/-/commit/${sha}`;
  return null;
}
