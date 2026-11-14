"use client";
// Ask Strata: a question in, an answer out that's made only of the asker's own records, each point cited. Clicking a
// citation opens the record's evidence. When nothing matches, the answer says so and says what was searched.
import { ArrowUp, CircleAlert, CornerDownLeft, Info, Quote, SearchX, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import type { Answer } from "../../../server/intelligence/types.ts";
import { askStrata } from "./actions.ts";
import { useEvidence } from "./evidence.tsx";
import { CategoryTag, shortRef } from "./labels.tsx";

type Turn = { id: number; question: string } & (
  | { status: "pending" }
  | { status: "error"; error: string }
  | { status: "done"; answer: Answer }
);

export function AskStrata({ suggestions, records }: { suggestions: string[]; records: number }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const next = useRef(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (turns.length) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns]);

  const submit = (question: string) => {
    const q = question.trim();
    if (q.length < 2 || pending) return;
    const id = next.current++;
    setValue("");
    setTurns((prev) => [...prev.slice(-5), { id, question: q, status: "pending" }]);
    start(async () => {
      const result = await askStrata(q);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? result.ok
              ? { id, question: q, status: "done", answer: result.value }
              : { id, question: q, status: "error", error: result.error }
            : t,
        ),
      );
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(value);
  };

  return (
    <section aria-labelledby="ask-title" className="card relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(60%_100%_at_50%_0%,var(--accent-soft),transparent)] opacity-70"
      />
      <header className="relative flex flex-wrap items-center gap-3 px-5 pt-5 sm:px-6">
        <span className="grid size-9 place-items-center rounded-[10px] bg-accent text-accent-ink shadow-[var(--shadow)]">
          <Sparkles size={17} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="ask-title" className="font-semibold text-[17px] tracking-[-0.01em]">
            Ask Strata
          </h2>
          <p className="text-[13px] text-ink-3">
            Answers come from your {records.toLocaleString()} records, quoted and cited. Nothing is made up.
          </p>
        </div>
        <span
          className="chip chip-mono"
          title="No AI model is configured (MEMORY_AI_PROVIDER=stub), so answers are assembled from the records' own words, never generated."
        >
          extractive · no model
        </span>
      </header>

      {turns.length ? (
        <div
          className="relative mt-4 max-h-[640px] space-y-5 overflow-y-auto border-line border-t px-5 py-5 sm:px-6"
          aria-live="polite"
        >
          {turns.map((t) => (
            <article key={t.id} className="space-y-3">
              <p className="ml-auto w-fit max-w-[85%] rounded-[12px] rounded-br-[4px] bg-ink px-3.5 py-2 text-[14px] text-bg">
                {t.question}
              </p>
              {t.status === "pending" ? (
                <div role="status" className="space-y-2.5 rounded-[12px] border border-line p-4">
                  <p className="flex items-center gap-2 text-[13px] text-ink-3">
                    <span className="dot animate-pulse text-accent" aria-hidden /> Searching your records…
                  </p>
                  <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-2" />
                  <div className="h-3.5 w-full animate-pulse rounded bg-surface-2" />
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-surface-2" />
                </div>
              ) : t.status === "error" ? (
                <p
                  className="flex items-center gap-2 rounded-[12px] bg-danger-soft px-4 py-3 text-[14px] text-danger"
                  role="alert"
                >
                  <CircleAlert size={16} aria-hidden /> {t.error}
                </p>
              ) : (
                <AnswerView answer={t.answer} />
              )}
            </article>
          ))}
          <div ref={end} />
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="relative px-5 pt-4 pb-5 sm:px-6" aria-label="Ask a question">
        <label className="group relative flex items-center rounded-[12px] border border-line-strong bg-surface shadow-[var(--shadow)] transition-colors focus-within:border-accent">
          <span className="sr-only">Question</span>
          <input
            ref={input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={500}
            placeholder="What's blocking billing? Why did we choose this approach?"
            className="h-12 min-w-0 flex-1 bg-transparent pr-2 pl-4 text-[15px] outline-none placeholder:text-ink-3 focus-visible:outline-none"
            autoComplete="off"
          />
          <span className="hidden pr-2 text-ink-3 sm:inline">
            <span className="kbd">⌘K</span>
          </span>
          <button
            type="submit"
            disabled={pending || value.trim().length < 2}
            className="btn btn-primary btn-sm mr-1.5 size-9 p-0"
            aria-label="Ask"
          >
            <ArrowUp size={16} aria-hidden />
          </button>
        </label>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              disabled={pending}
              onClick={() => submit(s)}
              className="chip min-h-8 border border-line bg-transparent px-2.5 text-[12.5px] transition-colors hover:border-line-strong hover:bg-surface-2"
            >
              <CornerDownLeft size={12} aria-hidden className="text-ink-3" /> {s}
            </button>
          ))}
        </div>
      </form>
    </section>
  );
}

function AnswerView({ answer }: { answer: Answer }) {
  const { open } = useEvidence();
  const number = new Map(answer.sources.map((s, i) => [s.ref, i + 1]));
  const nothing = !answer.sources.length;
  const searched = answer.searched.memories + answer.searched.summaries + answer.searched.findings;
  return (
    <div className="rounded-[12px] border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        {answer.reading.intentLabel ? <span className="chip">{answer.reading.intentLabel}</span> : null}
        {answer.reading.terms.map((t) => (
          <span key={t} className="chip chip-mono">
            {t}
          </span>
        ))}
        {answer.reading.window ? <span className="chip">{answer.reading.window}</span> : null}
      </div>

      <p className={`mt-3 flex items-start gap-2 font-medium text-[15px] ${nothing ? "text-ink-2" : ""}`}>
        {nothing ? <SearchX size={17} aria-hidden className="mt-0.5 flex-none text-ink-3" /> : null}
        {answer.lead}
      </p>

      {answer.sections.map((section) => (
        <div key={section.heading} className="mt-4">
          <h3 className="eyebrow mb-1.5">{section.heading}</h3>
          <ul className="space-y-2">
            {section.points.map((p) => (
              <li key={p.refs.join()} className="flex gap-2.5 border-line border-l-2 pl-3 text-[14px] leading-relaxed">
                <span className="min-w-0 flex-1">
                  {p.text}
                  {p.refs.map((ref) => (
                    <button
                      key={ref}
                      type="button"
                      onClick={() => open(ref, true)}
                      className="ml-1 inline-flex h-[18px] min-w-[18px] translate-y-[-1px] items-center justify-center rounded-[5px] bg-accent-soft px-1 align-middle font-mono font-medium text-[10.5px] text-accent-text transition-colors hover:bg-accent hover:text-accent-ink"
                      aria-label={`Source ${number.get(ref)}: ${ref}`}
                      title={ref}
                    >
                      {number.get(ref)}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {answer.sources.length ? (
        <div className="mt-4">
          <h3 className="eyebrow mb-1.5 flex items-center gap-1.5">
            <Quote size={11} aria-hidden /> Sources
          </h3>
          <ol className="flex flex-wrap gap-1.5">
            {answer.sources.map((s, i) => (
              <li key={s.ref}>
                <button
                  type="button"
                  onClick={() => open(s.ref, true)}
                  className="flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1 text-left transition-colors hover:border-line-strong hover:bg-surface-2"
                >
                  <span className="font-mono font-medium text-[11px] text-accent-text">{i + 1}</span>
                  <CategoryTag card={s} small />
                  <span className="font-mono text-[11px] text-ink-3">{shortRef(s.ref)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {answer.gaps.length ? (
        <div className="mt-4 rounded-[10px] bg-surface-2/70 px-3.5 py-3">
          <p className="flex items-center gap-1.5 font-medium text-[12.5px] text-ink-2">
            <Info size={13} aria-hidden /> What the records don't say
          </p>
          <ul className="mt-1.5 space-y-1 text-[13px] text-ink-3">
            {answer.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 font-mono text-[11px] text-ink-3">
        searched {searched.toLocaleString()} records · {answer.searched.projects} projects · {answer.retrieval}{" "}
        retrieval · your scope only
      </p>
    </div>
  );
}
