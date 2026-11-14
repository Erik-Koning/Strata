// One answer and what it was drawn from: the answer's [n] markers link to the numbered source cards below it, and each
// card links its product and its session.
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AskSource } from "../../server/hub/ask.ts";
import { Ago } from "../time.tsx";

export const sourceAnchor = (turn: string, n: number) => `${turn}-source-${n}`;

// The answer's text, its citations as links. Bold markers are dropped; paragraphs and line breaks are kept.
export function AnswerText({ text, turn, sources }: { text: string; turn: string; sources: AskSource[] }) {
  const numbers = new Set(sources.map((s) => s.n));
  const clean = text.replace(/\*\*/g, "").trim();
  const paragraphs: { at: number; text: string }[] = [];
  let at = 0;
  for (const part of clean.split(/(\n{2,})/)) {
    if (part.trim() && !/^\n+$/.test(part)) paragraphs.push({ at, text: part });
    at += part.length;
  }
  return (
    <div className="flex flex-col gap-3 text-[14.5px] leading-relaxed">
      {paragraphs.map((p) => (
        <p key={p.at} className="whitespace-pre-line break-words">
          {cited(p.text, turn, numbers)}
        </p>
      ))}
    </div>
  );
}

function cited(text: string, turn: string, numbers: Set<number>): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    const index = match.index ?? 0;
    out.push(text.slice(last, index));
    out.push(
      numbers.has(n) ? (
        <a
          key={index}
          href={`#${sourceAnchor(turn, n)}`}
          aria-label={`Source ${n}`}
          className="mx-px inline-flex h-[1.4em] min-w-[1.4em] items-center justify-center rounded-[5px] bg-accent-soft px-1 align-[0.12em] font-mono text-[11px] text-accent-text leading-none no-underline hover:bg-accent hover:text-accent-ink"
        >
          {n}
        </a>
      ) : (
        match[0]
      ),
    );
    last = index + match[0].length;
  }
  out.push(text.slice(last));
  return out;
}

const metaLink =
  "inline-flex min-h-11 items-center gap-1 text-accent-text underline-offset-4 hover:underline sm:min-h-0";

export function SourceCard({ source, turn, faded = false }: { source: AskSource; turn: string; faded?: boolean }) {
  const people = source.kind === "people";
  return (
    <article
      id={sourceAnchor(turn, source.n)}
      aria-label={`Source ${source.n}`}
      className={`card flex scroll-mt-24 flex-col p-4 target:ring-2 target:ring-accent ${faded ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-6 flex-none place-items-center rounded-[6px] bg-surface-2 font-mono text-[12px] text-ink-2">
          {source.n}
        </span>
        <span className="chip">{source.label}</span>
        {source.cited ? <span className="chip status-active">Cited</span> : null}
        {source.at ? <Ago at={source.at} className="ml-auto text-[12.5px] text-ink-3" /> : null}
      </div>
      {source.title && !people ? <h4 className="mt-2.5 font-medium text-[14px] leading-snug">{source.title}</h4> : null}
      <p
        className={`mt-1.5 whitespace-pre-line break-words text-[13.5px] text-ink-2 ${people ? "line-clamp-[8]" : "line-clamp-5"}`}
      >
        {source.text}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 pt-2 text-[12.5px] text-ink-3">
        {source.product ? (
          <Link href={`/products/${encodeURIComponent(source.product.id)}`} className={metaLink}>
            {source.product.name}
          </Link>
        ) : null}
        {source.sessionId ? (
          <Link href={`/sessions/${encodeURIComponent(source.sessionId)}`} className={metaLink}>
            Session <span className="font-mono text-[11.5px]">{source.sessionId.slice(0, 8)}</span>
          </Link>
        ) : null}
        {source.author ? <span>{source.author}</span> : null}
        {source.refs.map((ref) =>
          ref.url ? (
            <a
              key={`${ref.type}:${ref.id}`}
              href={ref.url}
              target="_blank"
              rel="noreferrer"
              className={`${metaLink} font-mono text-[11.5px]`}
            >
              {ref.type === "pr" ? `PR ${ref.id.length > 12 ? "" : ref.id}`.trim() : ref.id}
              <ExternalLink size={12} aria-hidden />
            </a>
          ) : (
            <span key={`${ref.type}:${ref.id}`} className="chip chip-mono">
              {ref.id}
            </span>
          ),
        )}
      </div>
    </article>
  );
}

export function SourceGrid({ sources, turn, faded }: { sources: AskSource[]; turn: string; faded?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sources.map((s) => (
        <SourceCard key={s.id} source={s} turn={turn} faded={faded} />
      ))}
    </div>
  );
}
