// Tickets, pull requests and repositories as chips. A chip with a web address opens it in a new tab; one without is
// plain text (a Jira key, say, until there's a tracker to link to).
import { ArrowUpRight, GitPullRequest, Ticket } from "lucide-react";
import Link from "next/link";
import type { RefLink, RepoView } from "../../server/hub/product-page.ts";

const LINK_CHIP = "chip chip-mono max-md:min-h-11 hover:bg-sunk hover:text-ink";

export function RefChips({ refs }: { refs: RefLink[] }) {
  if (!refs.length) return null;
  return (
    <>
      {refs.map((ref) => {
        const Icon = ref.kind === "pr" ? GitPullRequest : Ticket;
        const body = (
          <>
            <Icon size={13} aria-hidden className="flex-none" />
            <span className="sr-only">{ref.kind === "pr" ? "Pull request" : "Ticket"} </span>
            {ref.label}
          </>
        );
        return ref.url ? (
          <a key={ref.key} href={ref.url} target="_blank" rel="noopener noreferrer" className={LINK_CHIP}>
            {body}
            <ArrowUpRight size={12} aria-hidden className="flex-none" />
          </a>
        ) : (
          <span key={ref.key} className="chip chip-mono">
            {body}
          </span>
        );
      })}
    </>
  );
}

export function RepoChips({ repos }: { repos: RepoView[] }) {
  return (
    <>
      {repos.map((r) => {
        const label = r.path ? `${r.repo} / ${r.path}` : r.repo;
        return r.url ? (
          <a
            key={`${r.repo}#${r.path}`}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${LINK_CHIP} max-w-full`}
          >
            <span className="truncate">{label}</span>
            <ArrowUpRight size={12} aria-hidden className="flex-none" />
          </a>
        ) : (
          <span key={`${r.repo}#${r.path}`} className="chip chip-mono max-w-full">
            <span className="truncate">{label}</span>
          </span>
        );
      })}
    </>
  );
}

// A session's page.
export function SessionLink({ sessionId, label = "Session" }: { sessionId: string; label?: string }) {
  return (
    <Link
      href={`/sessions/${encodeURIComponent(sessionId)}`}
      className="chip chip-mono max-md:min-h-11 hover:bg-sunk hover:text-ink"
      title={`Session ${sessionId}`}
    >
      {label} {sessionId.slice(0, 8)}
    </Link>
  );
}

// "Ada Lovelace, Bo Diddley and Cy Twombly".
export const names = (people: string[]): string =>
  new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" }).format(people);
