"use client";
// Ask Strata's conversation, for this visit only: it lives in this component's state and is never saved. Each question
// takes two steps, so the page can say what it's reading while the answer is written: find the sources, then answer.
import {
  ArrowUp,
  BookOpen,
  CircleAlert,
  CircleHelp,
  Clock,
  Compass,
  History,
  LoaderCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { AskMode, AskPreview, AskResult, AskSource } from "../../server/hub/ask.ts";
import { AnswerText, SourceGrid } from "./answer.tsx";

type Outcome<T> = { ok: T; error: null } | { ok: null; error: string };
interface AskOptions {
  productId: string | null;
  mode: AskMode | null;
}
interface Product {
  id: string;
  name: string;
}

interface Turn {
  key: string;
  question: string;
  options: AskOptions;
  productName: string | null;
  phase: "finding" | "reading" | "done";
  preview: AskPreview | null;
  result: AskResult | null;
  error: string | null;
  // The page stopped waiting before the server answered.
  late: boolean;
}

// The server stops waiting for the model at 33 s; past this the page stops too.
const PAGE_WAIT_MS = 38_000;
const WHY = "Why is … the way it is?";

function within<T>(work: Promise<T>, ms: number): Promise<T | "late"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function AskChat({
  products,
  initialProductId,
  excerpts,
  questionMax,
  findSources,
  answer,
}: {
  products: Product[];
  initialProductId: string | null;
  excerpts: boolean;
  questionMax: number;
  findSources: (question: string, options: AskOptions) => Promise<Outcome<AskPreview>>;
  answer: (question: string, options: AskOptions) => Promise<Outcome<AskResult>>;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [productId, setProductId] = useState<string | null>(initialProductId);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const counter = useRef(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const last = useRef<HTMLLIElement>(null);
  const selectWhy = useRef(false);

  const nameOf = (id: string | null) => products.find((p) => p.id === id)?.name ?? null;
  const starterProduct = products.find((p) => p.id === productId) ?? null;
  const newcomerProduct = starterProduct ?? products[0] ?? null;

  useEffect(() => {
    if (!turns.length) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    last.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [turns.length]);

  useEffect(() => {
    if (!selectWhy.current || draft !== WHY) return;
    selectWhy.current = false;
    const at = WHY.indexOf("…");
    box.current?.focus();
    box.current?.setSelectionRange(at, at + 1);
  }, [draft]);

  function pickProduct(id: string | null) {
    setProductId(id);
    window.history.replaceState(null, "", id ? `/ask?product=${encodeURIComponent(id)}` : "/ask");
  }

  async function ask(text: string, mode: AskMode | null = null, scope: string | null = productId) {
    const question = text.replace(/\s+/g, " ").trim();
    if (busy || !question) return;
    if (question.length > questionMax) {
      setProblem(`Keep the question to ${questionMax} characters; this one has ${question.length}.`);
      return;
    }
    if (question.includes("Why is …")) {
      setProblem("Replace the … with what you want to know about.");
      box.current?.focus();
      return;
    }
    setProblem(null);
    const key = `turn-${++counter.current}`;
    const options: AskOptions = { productId: scope, mode };
    const update = (patch: Partial<Turn>) =>
      setTurns((all) => all.map((t) => (t.key === key ? { ...t, ...patch } : t)));
    setTurns((all) => [
      ...all,
      {
        key,
        question,
        options,
        productName: nameOf(scope),
        phase: "finding",
        preview: null,
        result: null,
        error: null,
        late: false,
      },
    ]);
    setDraft("");
    setBusy(true);
    try {
      const found = await findSources(question, options);
      if (found.error !== null) {
        // Refused before anything was read: give the question back to fix.
        setDraft((now) => now || question);
        return update({ phase: "done", error: found.error });
      }
      update({ phase: "reading", preview: found.ok });
      const reply = await within(answer(question, options), PAGE_WAIT_MS);
      if (reply === "late") return update({ phase: "done", late: true });
      if (reply.error !== null) return update({ phase: "done", error: reply.error });
      update({ phase: "done", result: reply.ok });
    } catch {
      update({ phase: "done", error: "Couldn't reach Strata. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(draft);
    }
  }

  const composer = (
    <div>
      <form onSubmit={submit} className="card p-3 sm:p-4" aria-label="Ask a question">
        <label htmlFor="ask-question" className="sr-only">
          Your question
        </label>
        <textarea
          id="ask-question"
          ref={box}
          rows={2}
          maxLength={questionMax}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="Ask about your team's work: why something is the way it is, how to run it, what changed"
          className="input min-h-[72px] resize-none text-[14.5px] leading-relaxed"
          aria-describedby="ask-help"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {products.length ? (
            <label className="flex min-w-0 items-center gap-2 text-[13px] text-ink-3">
              <span className="max-sm:sr-only">From</span>
              <select
                value={productId ?? ""}
                onChange={(e) => pickProduct(e.target.value || null)}
                className="input h-11 min-h-11 w-auto max-w-[60vw] py-0 text-[13.5px] sm:h-9 sm:min-h-9"
                aria-label="Which product to ask about"
              >
                <option value="">Every product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {draft.length > questionMax * 0.8 ? (
            <span className="text-[12.5px] text-ink-3" aria-live="polite">
              {draft.length} of {questionMax}
            </span>
          ) : null}
          <button
            type="submit"
            className="btn btn-primary ml-auto min-h-11 sm:min-h-10"
            disabled={busy || !draft.trim()}
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <ArrowUp size={15} aria-hidden />}
            Ask
          </button>
        </div>
        {problem ? (
          <p role="alert" className="mt-2 rounded-[10px] bg-danger-soft px-3 py-2 text-[13.5px] text-danger">
            {problem}
          </p>
        ) : null}
      </form>
      <p id="ask-help" className="mt-2 px-1 text-[13px] text-ink-3">
        Answers come only from approved work and cite every source. Each question is answered on its own and isn't
        saved; one nothing answers is added to Gaps for the team, without your name.
      </p>
    </div>
  );

  if (!turns.length)
    return (
      <div className="flex flex-col gap-6">
        {composer}
        <section className="card p-5" aria-labelledby="ask-starters">
          <h2 id="ask-starters" className="font-semibold text-[15px]">
            Try asking
          </h2>
          {products.length ? null : (
            <p className="mt-1 text-[13px] text-ink-3">
              Nothing has been approved yet, so there's little to answer from. Answers start once your team approves
              session summaries and findings.
            </p>
          )}
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            <li>
              <Starter
                icon={<History size={16} aria-hidden />}
                text={starterProduct ? `What changed in ${starterProduct.name} this week?` : "What changed this week?"}
                help="Summaries and decisions approved in the last 7 days"
                onClick={() =>
                  ask(
                    starterProduct ? `What changed in ${starterProduct.name} this week?` : "What changed this week?",
                    "recent",
                  )
                }
                disabled={busy}
              />
            </li>
            <li>
              <Starter
                icon={<Compass size={16} aria-hidden />}
                text={WHY}
                help="Fill in a part of the code, a rule or a choice"
                onClick={() => {
                  selectWhy.current = true;
                  setDraft(WHY);
                }}
                disabled={busy}
              />
            </li>
            {newcomerProduct ? (
              <li>
                <Starter
                  icon={<BookOpen size={16} aria-hidden />}
                  text={`I'm new to ${newcomerProduct.name}: where do I start?`}
                  help="A first week: setup, the main areas, what catches people out, whom to ask"
                  onClick={() => {
                    if (newcomerProduct.id !== productId) pickProduct(newcomerProduct.id);
                    void ask(`I'm new to ${newcomerProduct.name}: where do I start?`, "onboarding", newcomerProduct.id);
                  }}
                  disabled={busy}
                />
              </li>
            ) : null}
          </ul>
        </section>
      </div>
    );

  return (
    <div className="flex flex-col gap-8">
      <ol className="flex flex-col gap-10" aria-label="This visit's questions">
        {turns.map((turn, i) => (
          <li key={turn.key} ref={i === turns.length - 1 ? last : undefined} className="scroll-mt-20">
            <TurnView
              turn={turn}
              excerpts={excerpts}
              busy={busy}
              onRetry={() => ask(turn.question, turn.options.mode, turn.options.productId)}
            />
          </li>
        ))}
      </ol>
      {composer}
    </div>
  );
}

function Starter({
  icon,
  text,
  help,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  text: string;
  help: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-full min-h-11 w-full flex-col items-start gap-1 rounded-[12px] border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-55"
    >
      <span className="flex items-center gap-2 font-medium text-[14px] text-ink">
        <span className="text-accent-text">{icon}</span>
        {text}
      </span>
      <span className="text-[12.5px] text-ink-3">{help}</span>
    </button>
  );
}

function TurnView({
  turn,
  excerpts,
  busy,
  onRetry,
}: {
  turn: Turn;
  excerpts: boolean;
  busy: boolean;
  onRetry: () => void;
}) {
  const result = turn.result;
  const scope = result?.product?.name ?? turn.preview?.product?.name ?? turn.productName;
  return (
    <article aria-label={`Question: ${turn.question}`} className="flex flex-col gap-3">
      <div className="flex flex-col items-end gap-1">
        <p className="max-w-[min(100%,42rem)] whitespace-pre-wrap break-words rounded-[14px] rounded-br-[4px] bg-accent-soft px-4 py-2.5 text-[14.5px] text-ink">
          {turn.question}
        </p>
        <span className="px-1 text-[12.5px] text-ink-3">{scope ? `About ${scope}` : "Across every product"}</span>
      </div>

      {turn.phase !== "done" ? (
        <>
          <Pending phase={turn.phase} count={turn.preview?.sources.length ?? 0} />
          {turn.preview?.sources.length ? <SourceGrid sources={turn.preview.sources} turn={turn.key} faded /> : null}
        </>
      ) : turn.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[12px] bg-danger-soft px-4 py-3 text-[14px] text-danger"
        >
          <CircleAlert size={16} className="mt-0.5 flex-none" aria-hidden />
          {turn.error}
        </p>
      ) : turn.late || result?.status === "slow" ? (
        <Slow onRetry={onRetry} busy={busy} sources={result?.sources ?? turn.preview?.sources ?? []} turn={turn.key} />
      ) : result?.status === "answered" && result.answer ? (
        <Answered result={result} turn={turn.key} excerpts={excerpts} />
      ) : result?.status === "quiet" ? (
        <Notice
          icon={<Clock size={17} aria-hidden />}
          title={`Nothing was approved${scope ? ` in ${scope}` : ""} ${result.since ? `since ${shortDate(result.since)}` : "lately"}`}
        >
          <p>
            What's new shows once work is approved. Try a longer window ("this month"), or ask about something specific.
          </p>
          {result.product ? (
            <Link
              href={`/products/${encodeURIComponent(result.product.id)}`}
              className="btn btn-sm mt-3 min-h-11 sm:min-h-9"
            >
              Open {result.product.name}
            </Link>
          ) : null}
        </Notice>
      ) : result ? (
        <Unanswered result={result} turn={turn.key} />
      ) : null}
    </article>
  );
}

function Pending({ phase, count }: { phase: Turn["phase"]; count: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const text =
    phase === "finding"
      ? "Looking through approved work…"
      : count
        ? `Reading ${plural(count, "record")}…`
        : "Nothing close so far. Checking once more…";
  return (
    <div role="status" className="card flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4 text-[14px] text-ink-2">
      <LoaderCircle size={16} className="flex-none animate-spin text-accent-text" aria-hidden />
      <span>{text}</span>
      {seconds >= 8 ? <span className="text-[12.5px] text-ink-3">An answer can take up to half a minute.</span> : null}
    </div>
  );
}

function Answered({ result, turn, excerpts }: { result: AskResult; turn: string; excerpts: boolean }) {
  const cited = result.sources.filter((s) => s.cited);
  const others = result.sources.filter((s) => !s.cited);
  const lead =
    result.mode === "onboarding"
      ? "A first week, from approved work"
      : result.mode === "recent" && result.since
        ? `Approved since ${shortDate(result.since)}`
        : "From approved work";
  return (
    <>
      <section className="card p-5" aria-label="Answer">
        <p className="mb-3 flex items-center gap-2 text-[12.5px] text-ink-3">
          <Sparkles size={15} className="text-accent-text" aria-hidden />
          {lead}
          {excerpts ? <span>· quoted from the closest records</span> : null}
        </p>
        <AnswerText text={result.answer?.text ?? ""} turn={turn} sources={result.sources} />
      </section>
      {cited.length ? (
        <section aria-label="Sources">
          <h3 className="mb-2 font-semibold text-[14px]">Sources</h3>
          <SourceGrid sources={cited} turn={turn} />
        </section>
      ) : null}
      {others.length ? (
        <AlsoRead sources={others} turn={turn} label={`Also read, not cited (${others.length})`} />
      ) : null}
    </>
  );
}

function Unanswered({ result, turn }: { result: AskResult; turn: string }) {
  return (
    <>
      <Notice
        icon={<CircleHelp size={17} aria-hidden />}
        title="Nothing in approved work answers this yet"
        tone="amber"
      >
        <p>
          {result.gap
            ? "It's been added to Gaps, without your name, so whoever knows the answer can write it down."
            : "Nobody has shared anything that answers it."}
        </p>
        {result.gap ? (
          <Link href="/gaps" className="btn btn-sm mt-3 min-h-11 sm:min-h-9">
            See Gaps
          </Link>
        ) : null}
      </Notice>
      {result.sources.length ? (
        <AlsoRead sources={result.sources} turn={turn} label={`What Strata read (${result.sources.length})`} />
      ) : null}
    </>
  );
}

function Slow({
  onRetry,
  busy,
  sources,
  turn,
}: {
  onRetry: () => void;
  busy: boolean;
  sources: AskSource[];
  turn: string;
}) {
  return (
    <>
      <Notice icon={<Clock size={17} aria-hidden />} title="This took too long, so Strata stopped waiting">
        <p>Try again, or pick one product to narrow it down. The records it was reading are below.</p>
        <button type="button" className="btn btn-sm mt-3 min-h-11 sm:min-h-9" onClick={onRetry} disabled={busy}>
          <RotateCcw size={14} aria-hidden /> Try again
        </button>
      </Notice>
      {sources.length ? (
        <AlsoRead sources={sources} turn={turn} label={`What Strata was reading (${sources.length})`} />
      ) : null}
    </>
  );
}

function Notice({
  icon,
  title,
  tone,
  children,
}: {
  icon: ReactNode;
  title: string;
  tone?: "amber";
  children: ReactNode;
}) {
  return (
    <section className="card flex items-start gap-3.5 p-5" aria-label={title}>
      <span
        className={`grid size-9 flex-none place-items-center rounded-full ${tone === "amber" ? "bg-amber-soft text-amber" : "bg-surface-2 text-ink-2"}`}
      >
        {icon}
      </span>
      <div className="min-w-0 text-[14px] text-ink-2">
        <h3 className="mb-1 font-semibold text-[15px] text-ink">{title}</h3>
        {children}
      </div>
    </section>
  );
}

function AlsoRead({ sources, turn, label }: { sources: AskSource[]; turn: string; label: string }) {
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer items-center text-[13px] text-ink-3 hover:text-ink sm:min-h-8">
        {label}
      </summary>
      <div className="mt-2">
        <SourceGrid sources={sources} turn={turn} />
      </div>
    </details>
  );
}
