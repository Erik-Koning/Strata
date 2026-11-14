// A session's links: the tickets, pull requests and commits its work names, each linked when there's somewhere safe to
// go. Server-rendered; everything it's given is plain data.
import type { Ref } from "@strata/contracts";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { commitUrl, safeUrl } from "./format.ts";

export interface SessionPr {
  id: string;
  url: string | null;
  title: string | null;
}

const LINK_CHIP =
  "chip chip-mono min-h-11 text-accent-text underline-offset-4 hover:underline sm:min-h-6 [&>svg]:flex-none";

function Chip({ label, href, title }: { label: string; href: string | null; title?: string }) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={LINK_CHIP} title={title}>
      {label}
      <ExternalLink size={15} aria-hidden className="opacity-70" />
    </a>
  ) : (
    <span className="chip chip-mono" title={title}>
      {label}
    </span>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="mb-1.5 text-[12.5px] text-ink-3">{label}</dt>
      <dd className="flex flex-wrap gap-1.5">{children}</dd>
    </div>
  );
}

const prLabel = (id: string) => (/^\d+$/.test(id) ? `#${id}` : id.replace(/^https?:\/\//, ""));

export function SessionLinks({ refs, pr, repo }: { refs: Ref[]; pr: SessionPr | null; repo: string }) {
  const tickets = refs.filter((r) => r.type === "ticket" || r.type === "issue");
  const prs = refs.filter((r) => r.type === "pr");
  const commits = refs.filter((r) => r.type === "commit");
  const other = refs.filter((r) => !["ticket", "issue", "pr", "commit"].includes(r.type));
  const pulls: SessionPr[] = prs.map((r) => ({
    id: r.id,
    url: safeUrl(r.url),
    title: pr && (pr.id === r.id || pr.url === r.url) ? pr.title : typeof r.title === "string" ? r.title : null,
  }));
  if (pr && !pulls.length) pulls.push({ ...pr, url: safeUrl(pr.url) });

  if (!tickets.length && !pulls.length && !commits.length && !other.length)
    return (
      <p className="px-5 py-4 text-[14px] text-ink-3">No ticket, pull request or commit was linked to this session.</p>
    );

  return (
    <dl className="flex flex-col gap-4 px-5 py-4">
      {tickets.length ? (
        <Group label={tickets.length === 1 ? "Ticket" : "Tickets"}>
          {tickets.map((t) => (
            <Chip key={`${t.type}:${t.id}`} label={t.id} href={safeUrl(t.url)} title={t.system} />
          ))}
        </Group>
      ) : null}
      {pulls.length ? (
        <div>
          <dt className="mb-1.5 text-[12.5px] text-ink-3">{pulls.length === 1 ? "Pull request" : "Pull requests"}</dt>
          {pulls.map((p) => (
            <dd key={p.id} className="text-[14px]">
              {p.url ? (
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center gap-1.5 text-accent-text underline-offset-4 hover:underline sm:min-h-0"
                >
                  <span className="font-mono text-[13px]">{prLabel(p.id)}</span>
                  {p.title ? <span>{p.title}</span> : null}
                  <ExternalLink size={15} aria-hidden className="flex-none opacity-70" />
                </a>
              ) : (
                <span>
                  <span className="font-mono text-[13px]">{prLabel(p.id)}</span>
                  {p.title ? ` ${p.title}` : null}
                </span>
              )}
            </dd>
          ))}
        </div>
      ) : null}
      {commits.length ? (
        <Group label={commits.length === 1 ? "Commit" : "Commits"}>
          {commits.map((c) => (
            <Chip key={c.id} label={c.id.slice(0, 8)} href={safeUrl(c.url) ?? commitUrl(repo, c.id)} title={c.id} />
          ))}
        </Group>
      ) : null}
      {other.length ? (
        <Group label="Also linked">
          {other.map((r) => (
            <Chip key={`${r.type}:${r.id}`} label={r.id} href={safeUrl(r.url)} title={r.type} />
          ))}
        </Group>
      ) : null}
    </dl>
  );
}
