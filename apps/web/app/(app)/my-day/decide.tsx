"use client";
// Deciding about one draft or one suggested memory. Every decision goes through a server action that acts only on the
// caller's own.
import { Check, LoaderCircle, Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { ConfirmButton } from "../../../components/confirm-button.tsx";
import { approve, decideCandidate, discard, type Result, save } from "./actions.ts";

function Problem({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[13.5px] text-danger">
      {error}
    </p>
  );
}

export function Draft({ id, text, label }: { id: string; text: string; label: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const run = (work: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      const result = await work();
      setError(result.error);
      if (!result.error) after?.();
    });

  return (
    <div className="flex flex-col gap-3">
      {editing ? (
        <>
          <label className="sr-only" htmlFor={`draft-${id}`}>
            Edit the {label.toLowerCase()}
          </label>
          <textarea
            id={`draft-${id}`}
            className="input text-[14.5px] leading-relaxed"
            rows={Math.min(14, Math.max(4, Math.ceil(value.length / 80)))}
            maxLength={4000}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
          />
          <p className="text-[12.5px] text-ink-3">{value.length.toLocaleString()} of 4,000 characters</p>
        </>
      ) : (
        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">{value}</p>
      )}
      <Problem error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm min-h-11 sm:min-h-9"
          disabled={pending}
          onClick={() => run(() => approve(id, editing && value !== text ? value : undefined))}
        >
          {pending ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <Check size={14} aria-hidden />}
          Approve and share
        </button>
        {editing ? (
          <>
            <button
              type="button"
              className="btn btn-sm min-h-11 sm:min-h-9"
              disabled={pending}
              onClick={() =>
                run(
                  () => save(id, value),
                  () => setSaved(true),
                )
              }
            >
              Save draft
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm min-h-11 sm:min-h-9"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setValue(text);
                setError(null);
              }}
            >
              Cancel
            </button>
            {saved ? (
              <span className="text-[12.5px] text-ink-3" aria-live="polite">
                Saved. Still only yours.
              </span>
            ) : null}
          </>
        ) : (
          <button type="button" className="btn btn-sm min-h-11 sm:min-h-9" onClick={() => setEditing(true)}>
            <Pencil size={14} aria-hidden /> Edit
          </button>
        )}
        <span className="ml-auto">
          <ConfirmButton label="Discard" confirm="Discard draft" danger action={() => discard(id)} />
        </span>
      </div>
    </div>
  );
}

export function Candidate({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (keep: boolean) =>
    start(async () => {
      setError((await decideCandidate(id, keep)).error);
    });
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm min-h-11 sm:min-h-9"
          disabled={pending}
          onClick={() => decide(true)}
        >
          Keep
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm min-h-11 sm:min-h-9"
          disabled={pending}
          onClick={() => decide(false)}
        >
          Not now
        </button>
      </div>
      {error ? (
        <span role="alert" className="text-[12.5px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
