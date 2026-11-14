// The pieces of a gap both the list and a gap's own page show: how often it came up, who owns it, and what answered
// it. Server components: dates arrive as ISO strings for <Ago>.
import { Link2, UserRound } from "lucide-react";
import { Markdown } from "../markdown.tsx";
import { Ago } from "../time.tsx";

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

// "N sessions" (agents ran into it) and "N questions" (people asked Ask Strata and got no answer), each only when there
// are some.
export function SeenChips({ sessions, questions }: { sessions: number; questions: number }) {
  return (
    <>
      {sessions > 0 ? (
        <span className="chip" title="Approved coding sessions whose agent ran into it">
          {plural(sessions, "session")}
        </span>
      ) : null}
      {questions > 0 ? (
        <span className="chip" title="Questions people asked Ask Strata that it couldn't answer">
          {plural(questions, "question")}
        </span>
      ) : null}
    </>
  );
}

export function SeenWhen({ first, last }: { first: string; last: string }) {
  return (
    <span>
      First seen <Ago at={first} />
      <span aria-hidden> · </span>
      last seen <Ago at={last} />
    </span>
  );
}

export function Owner({ owner }: { owner: { name: string; mine: boolean } | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <UserRound size={15} aria-hidden className="flex-none" />
      {owner ? (
        <span>
          <span className="sr-only">Owner: </span>
          <span className="text-ink-2">{owner.name}</span>
          {owner.mine ? " (you)" : null}
        </span>
      ) : (
        "No owner"
      )}
    </span>
  );
}

// Only web addresses become links; anything else is shown as text.
const webLink = (url: string | null): string | null => (url && /^https?:\/\/\S+$/i.test(url) ? url : null);
const shortUrl = (url: string): string => {
  const bare = url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return bare.length > 72 ? `${bare.slice(0, 71)}…` : bare;
};

// What answered a resolved gap: its note, its link, and when.
export function Answer({
  resolution,
  seenSince,
}: {
  resolution: { url: string | null; note: string; at: string };
  seenSince: boolean;
}) {
  const link = webLink(resolution.url);
  return (
    <div className="mt-3 rounded-[10px] border border-line bg-surface-2 px-3.5 py-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
        <span>
          Resolved <Ago at={resolution.at} />
        </span>
        {seenSince ? <span className="chip status-candidate">Came up again since</span> : null}
      </p>
      {resolution.note ? (
        <Markdown className="mt-1.5 break-words text-[14px] text-ink-2">{resolution.note}</Markdown>
      ) : null}
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex min-h-11 max-w-full items-center gap-1.5 text-[13px] text-accent-text underline-offset-4 hover:underline sm:min-h-0"
        >
          <Link2 size={15} aria-hidden className="flex-none" />
          <span className="truncate">{shortUrl(link)}</span>
        </a>
      ) : resolution.url ? (
        <p className="mt-1.5 break-all text-[13px] text-ink-3">{resolution.url}</p>
      ) : null}
    </div>
  );
}
