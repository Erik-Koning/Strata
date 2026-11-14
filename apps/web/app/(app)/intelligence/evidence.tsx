"use client";
// The evidence drawer: any citation or record on the page opens it, and it shows the record as stored, where it came
// from, its session's links and what the session captured (counts, never content), related records, and why the
// viewer is allowed to see it.
import {
  FileText,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  Lock,
  ShieldCheck,
  Ticket,
  X,
} from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Ago } from "../../../components/time.tsx";
import type { Evidence, SourceCard } from "../../../server/intelligence/types.ts";
import { openEvidence } from "./actions.ts";
import { CategoryTag, kindLabel, shortRef } from "./labels.tsx";

interface Opened {
  ref: string;
  cited: boolean;
}

const Ctx = createContext<{ open: (ref: string, cited?: boolean) => void; current: string | null }>({
  open: () => undefined,
  current: null,
});

export const useEvidence = () => useContext(Ctx);

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const open = useCallback((ref: string, cited = false) => setOpened({ ref, cited }), []);
  return (
    <Ctx.Provider value={{ open, current: opened?.ref ?? null }}>
      {children}
      <EvidencePanel opened={opened} onClose={() => setOpened(null)} onOpen={open} />
    </Ctx.Provider>
  );
}

// A record in a list, as a button that opens its evidence.
export function RecordButton({
  card,
  children,
  className = "",
}: {
  card: SourceCard;
  children: ReactNode;
  className?: string;
}) {
  const { open, current } = useEvidence();
  return (
    <button
      type="button"
      onClick={() => open(card.ref)}
      aria-label={`Open evidence for ${kindLabel(card)} ${shortRef(card.ref)}`}
      aria-pressed={current === card.ref}
      className={`group block w-full text-left transition-colors hover:bg-surface-2/70 aria-pressed:bg-accent-soft/50 ${className}`}
    >
      {children}
    </button>
  );
}

type State = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; evidence: Evidence };

function EvidencePanel({
  opened,
  onClose,
  onOpen,
}: {
  opened: Opened | null;
  onClose: () => void;
  onOpen: (ref: string, cited?: boolean) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const closeRef = useRef<HTMLButtonElement>(null);
  const ref = opened?.ref ?? null;
  const cited = opened?.cited ?? false;

  useEffect(() => {
    if (!ref) return;
    let live = true;
    setState({ status: "loading" });
    openEvidence(ref, cited).then((r) => {
      if (live) setState(r.ok ? { status: "ready", evidence: r.value } : { status: "error", error: r.error });
    });
    closeRef.current?.focus();
    return () => {
      live = false;
    };
  }, [ref, cited]);

  useEffect(() => {
    if (!ref) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref, onClose]);

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-ink/20 backdrop-blur-[1px] transition-opacity duration-200 lg:bg-transparent lg:backdrop-blur-none ${
          ref ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-label="Evidence"
        aria-hidden={!ref}
        inert={!ref}
        className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-line border-l bg-surface shadow-[var(--shadow)] transition-transform duration-200 ease-out ${
          ref ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center gap-3 border-line border-b px-5 py-3.5">
          <span className="grid size-8 place-items-center rounded-[9px] bg-accent-soft text-accent-text">
            <FileText size={16} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Evidence</p>
            <p className="truncate font-mono text-[12.5px] text-ink-2">{ref ?? ""}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={onClose}
            aria-label="Close evidence"
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {state.status === "loading" ? (
            <div className="space-y-3" role="status" aria-label="Loading evidence">
              <div className="h-4 w-28 animate-pulse rounded bg-surface-2" />
              <div className="h-24 animate-pulse rounded-[10px] bg-surface-2" />
              <div className="h-4 w-40 animate-pulse rounded bg-surface-2" />
              <div className="h-32 animate-pulse rounded-[10px] bg-surface-2" />
              <span className="sr-only">
                <LoaderCircle aria-hidden /> Loading
              </span>
            </div>
          ) : state.status === "error" ? (
            <div className="rounded-[12px] border border-line p-4 text-[14px]">
              <p className="font-medium">Can't show this record</p>
              <p className="mt-1 text-ink-3">{state.error}</p>
            </div>
          ) : (
            <EvidenceBody evidence={state.evidence} onOpen={onOpen} />
          )}
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="eyebrow mb-2">{title}</h3>
      {children}
    </section>
  );
}

function EvidenceBody({ evidence, onOpen }: { evidence: Evidence; onOpen: (ref: string) => void }) {
  const { source, provenance, timestamps, session, related, authorization, notes } = evidence;
  return (
    <>
      <Section title="Record">
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryTag card={source} />
          <span className="chip chip-mono">{source.project === "*" ? "every project" : source.project}</span>
        </div>
        <blockquote className="ledger mt-3 rounded-[10px] px-4 py-2.5 text-[13px]">{source.text}</blockquote>
        {notes.length ? (
          <ul className="mt-2 space-y-1 text-[13px] text-ink-3">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Authorization">
        <div className="rounded-[12px] border border-accent/25 bg-accent-soft/40 p-3.5">
          <p className="flex items-center gap-2 font-medium text-[13.5px] text-accent-text">
            <ShieldCheck size={15} aria-hidden /> {authorization.visibility} · owner: {authorization.owner}
          </p>
          <p className="mt-1.5 text-[13px] text-ink-2">{authorization.basis}</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-3">
            <Lock size={12} aria-hidden /> Prompt, reply and transcript text is never shown here.
          </p>
        </div>
      </Section>

      <Section title="Provenance">
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
          {provenance.map((p) => (
            <div key={`${p.label}:${p.value}`} className="contents">
              <dt className="text-ink-3">{p.label}</dt>
              <dd className={`${p.mono ? "font-mono text-[12px]" : ""} min-w-0 break-all text-ink`}>{p.value}</dd>
            </div>
          ))}
          {timestamps.map((t) => (
            <div key={t.label} className="contents">
              <dt className="text-ink-3">{t.label}</dt>
              <dd>
                <Ago at={t.at} />
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Session">
        {session ? (
          <div className="rounded-[12px] border border-line p-3.5 text-[13px]">
            <p className="font-mono text-[12px] text-ink-2">{session.sessionID}</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {session.repo ? (
                <span className="flex items-center gap-2">
                  <FolderGit2 size={14} aria-hidden className="text-ink-3" />
                  <span className="font-mono text-[12px]">{session.repo}</span>
                </span>
              ) : null}
              {session.branch ? (
                <span className="flex items-center gap-2">
                  <GitBranch size={14} aria-hidden className="text-ink-3" />
                  <span className="font-mono text-[12px]">{session.branch}</span>
                </span>
              ) : null}
              {session.head ? (
                <span className="flex items-center gap-2">
                  <GitCommitHorizontal size={14} aria-hidden className="text-ink-3" />
                  <span className="font-mono text-[12px]">{session.head.slice(0, 12)}</span>
                </span>
              ) : null}
              {session.refs.length ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Ticket size={14} aria-hidden className="text-ink-3" />
                  {session.refs.map((r) =>
                    r.url ? (
                      <a
                        key={`${r.type}:${r.id}`}
                        href={r.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="chip chip-mono hover:bg-sunk"
                      >
                        {r.id}
                      </a>
                    ) : (
                      <span key={`${r.type}:${r.id}`} className="chip chip-mono">
                        {r.id}
                      </span>
                    ),
                  )}
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-ink-3">
              <Ago at={session.first} /> → <Ago at={session.last} />
              {session.client ? <> · {session.client}</> : null}
            </p>
            <p className="mt-2 flex flex-wrap gap-1.5">
              {session.captured.map((c) => (
                <span key={c.kind} className="chip chip-mono">
                  {c.count} {c.kind}
                </span>
              ))}
            </p>
            <p className="mt-2 text-[12px] text-ink-3">
              Counts of what the session captured. Their content stays private.
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">
            {source.sessionID
              ? "Session events are no longer stored."
              : "Not tied to a session (added by hand, or for every session)."}
          </p>
        )}
      </Section>

      <Section title="Related">
        {related.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-[12px] border border-line">
            {related.map((r) => (
              <li key={r.ref}>
                <button
                  type="button"
                  onClick={() => onOpen(r.ref)}
                  className="block w-full px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="flex items-center gap-1.5">
                    <CategoryTag card={r} small />
                    <span className="ml-auto font-mono text-[11px] text-ink-3">{shortRef(r.ref)}</span>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-[13px] text-ink-2">{r.text}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">No other record shares its session or its wording.</p>
        )}
      </Section>
    </>
  );
}
