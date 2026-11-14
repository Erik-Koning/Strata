"use client";
import type { MemoryStatus } from "@strata/contracts";
// The memories, with what each one is and where it came from in view, and forgetting done deliberately: what goes
// (the memories, the summaries made from them, the events they came from) is counted and shown before anything is
// removed, and the person confirms once.
import { Archive, CheckCircle2, LoaderCircle, Trash2, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { KindChip, StatusChip } from "../../../components/chips.tsx";
import { Markdown } from "../../../components/markdown.tsx";
import { Ago } from "../../../components/time.tsx";
import { changeStatus, confirmForget, previewForget } from "./actions.ts";

export interface MemoryRow {
  id: string;
  text: string;
  kind: string;
  status: MemoryStatus;
  trust: string;
  confidence: number;
  project: string;
  source: string;
  sessionID: string | null;
  createdAt: string;
}

type Counts = { memories: number; summaries: number; events: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function MemoryList({ rows }: { rows: MemoryRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targets, setTargets] = useState<string[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [done, setDone] = useState<Counts | null>(null);
  const [pending, start] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const askForget = (ids: string[]) => {
    setTargets(ids);
    setCounts(null);
    dialog.current?.showModal();
    keep.current?.focus();
    start(async () => setCounts(await previewForget(ids)));
  };

  const doForget = () =>
    start(async () => {
      const result = await confirmForget(targets);
      dialog.current?.close();
      setSelected(new Set());
      setDone(result);
    });

  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <>
      {done ? (
        <div
          role="status"
          className="mb-4 flex items-center gap-3 rounded-[12px] bg-accent-soft px-4 py-3 text-[14px] text-accent-text"
        >
          <CheckCircle2 size={17} aria-hidden />
          <span className="flex-1">
            Forgot {plural(done.memories, "memory", "memories")}, {plural(done.summaries, "summary", "summaries")} and{" "}
            {plural(done.events, "captured event")}. It's in the audit log.
          </span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDone(null)} aria-label="Dismiss">
            <X size={15} aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="flex min-h-12 items-center gap-3 border-line border-b bg-surface-2/60 px-4 py-2">
          <label className="flex min-h-11 items-center gap-2.5 text-[13.5px] text-ink-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={all}
              onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))}
            />
            {selected.size ? `${selected.size} selected` : "Select all on this page"}
          </label>
          {selected.size ? (
            <button type="button" className="btn btn-sm ml-auto text-danger" onClick={() => askForget([...selected])}>
              <Trash2 size={14} aria-hidden /> Forget {selected.size}…
            </button>
          ) : null}
        </div>
        <ul className="divide-y divide-line">
          {rows.map((m) => (
            <li
              key={m.id}
              className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] ${m.status === "candidate" ? "bg-amber-soft/40" : ""}`}
            >
              <input
                type="checkbox"
                className="mt-1 size-4 flex-none accent-[var(--accent)]"
                checked={selected.has(m.id)}
                onChange={() => toggle(m.id)}
                aria-label={`Select: ${m.text.slice(0, 60)}`}
              />
              <div className="min-w-0 flex-1">
                <Markdown className="break-words text-[15px] leading-relaxed">{m.text}</Markdown>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <StatusChip status={m.status} />
                  <KindChip kind={m.kind} />
                  <span className="chip" title="How far it's trusted, by where it came from">
                    {m.trust} · {Math.round(m.confidence * 100)}%
                  </span>
                  <span className="chip chip-mono" title="Project">
                    {m.project === "*" ? "all projects" : m.project}
                  </span>
                  <span className="chip chip-mono" title="Where it came from">
                    {m.source}
                    {m.sessionID ? ` · ${m.sessionID.slice(0, 8)}` : ""}
                  </span>
                  <Ago at={m.createdAt} className="text-[12.5px] text-ink-3 sm:ml-auto" />
                </div>
              </div>
              <div className="col-start-2 flex flex-wrap gap-1 sm:col-start-auto sm:flex-nowrap sm:items-start">
                {m.status === "candidate" ? (
                  <button
                    type="button"
                    className="btn btn-sm min-h-11 sm:min-h-8"
                    disabled={pending}
                    onClick={() => start(async () => void (await changeStatus(m.id, "active")))}
                  >
                    <CheckCircle2 size={14} aria-hidden /> Keep
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm min-h-11 sm:min-h-8"
                    disabled={pending}
                    onClick={() => start(async () => void (await changeStatus(m.id, "archived")))}
                  >
                    <Archive size={14} aria-hidden /> Archive
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-quiet btn-sm min-h-11 text-danger sm:min-h-8"
                  onClick={() => askForget([m.id])}
                >
                  <Trash2 size={14} aria-hidden /> Forget
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <dialog
        ref={dialog}
        aria-labelledby="forget-title"
        className="m-auto w-[min(460px,calc(100vw-32px))] rounded-[16px] border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40"
      >
        <div className="p-6">
          <h2 id="forget-title" className="font-semibold text-[18px]">
            Forget {targets.length === 1 ? "this memory" : `${targets.length} memories`}?
          </h2>
          {counts ? (
            <>
              <p className="mt-2 text-[14.5px] text-ink-2">This removes, for good:</p>
              <ul className="mt-3 grid gap-1.5 text-[14.5px]">
                <li className="flex justify-between rounded-[8px] bg-surface-2 px-3 py-2">
                  <span>Memories</span> <span className="font-mono tabular-nums">{counts.memories}</span>
                </li>
                <li className="flex justify-between rounded-[8px] bg-surface-2 px-3 py-2">
                  <span>Summaries made from them</span>{" "}
                  <span className="font-mono tabular-nums">{counts.summaries}</span>
                </li>
                <li className="flex justify-between rounded-[8px] bg-surface-2 px-3 py-2">
                  <span>Captured events they came from</span>{" "}
                  <span className="font-mono tabular-nums">{counts.events}</span>
                </li>
              </ul>
              <p className="mt-3 text-[13.5px] text-ink-3">
                Sessions already running keep their frozen block until they compact. The audit log records this.
              </p>
            </>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-[14px] text-ink-3">
              <LoaderCircle size={15} className="animate-spin" aria-hidden /> Counting what would go…
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button ref={keep} type="button" className="btn" onClick={() => dialog.current?.close()}>
              Keep them
            </button>
            <button type="button" className="btn btn-danger" disabled={!counts || pending} onClick={doForget}>
              {pending && counts ? (
                <LoaderCircle size={15} className="animate-spin" aria-hidden />
              ) : (
                <Trash2 size={15} aria-hidden />
              )}
              Forget
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
