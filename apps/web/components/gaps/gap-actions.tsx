"use client";
// What someone can do with a gap: take it on, resolve it with what answers it, or reopen it. The actions come from the
// page, bound to the gap; each is a server action that checks the caller again and returns an error to show.
import { Check, LoaderCircle } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { ConfirmButton } from "../confirm-button.tsx";

export interface GapActionResult {
  error: string | null;
}

function Problem({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] text-danger">
      {error}
    </p>
  );
}

// Laid out for a flex-wrap row: the buttons sit at its end, and the resolve form opens below on a line of its own.
export function GapActions({
  status,
  owner,
  take,
  resolve,
  reopen,
}: {
  status: "open" | "resolved";
  owner: { name: string; mine: boolean } | null;
  take: () => Promise<GapActionResult>;
  resolve: (input: { url: string; note: string }) => Promise<GapActionResult>;
  reopen: () => Promise<GapActionResult>;
}) {
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (status === "resolved")
    return (
      <div className="flex flex-none items-start sm:justify-end">
        <ConfirmButton label="Reopen" confirm="Reopen it" danger action={reopen} />
      </div>
    );

  return (
    <>
      <div className="flex flex-none flex-col gap-1.5 sm:items-end">
        <div className="flex flex-wrap items-start gap-2">
          {owner?.mine ? null : owner ? (
            <ConfirmButton label="Take it" confirm={`Take it from ${owner.name}`} action={take} />
          ) : (
            <button
              type="button"
              className="btn btn-sm min-h-11 sm:min-h-8"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError((await take()).error);
                })
              }
            >
              {pending ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : null}
              Take it
            </button>
          )}
          {resolving ? null : (
            <button
              type="button"
              className="btn btn-sm min-h-11 sm:min-h-8"
              onClick={() => {
                setError(null);
                setResolving(true);
              }}
            >
              <Check size={15} aria-hidden />
              Resolve
            </button>
          )}
        </div>
        {error && !resolving ? (
          <span role="alert" className="max-w-[260px] text-[12.5px] text-danger sm:text-right">
            {error}
          </span>
        ) : null}
      </div>
      {resolving ? <ResolveForm resolve={resolve} onClose={() => setResolving(false)} /> : null}
    </>
  );
}

function ResolveForm({
  resolve,
  onClose,
}: {
  resolve: (input: { url: string; note: string }) => Promise<GapActionResult>;
  onClose: () => void;
}) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      noValidate
      aria-label="Resolve this gap"
      className="flex w-full basis-full flex-col gap-3 rounded-[12px] border border-line bg-surface-2 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await resolve({ url, note });
          setError(result.error);
          if (!result.error) onClose();
        });
      }}
    >
      <div>
        <label className="label" htmlFor={`${id}-url`}>
          Link <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          autoComplete="off"
          className="input text-[14px]"
          placeholder="https://… the doc, ADR or comment that answers it"
          maxLength={2000}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor={`${id}-note`}>
          Note
        </label>
        <textarea
          id={`${id}-note`}
          required
          aria-describedby={`${id}-help`}
          className="input text-[14px] leading-relaxed"
          rows={3}
          maxLength={1000}
          placeholder="What answers it, or where it's written down now."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <p id={`${id}-help`} className="mt-1.5 text-[13px] text-ink-3">
          Everyone sees the link and the note. If the gap comes up again, it's marked as seen since.
        </p>
      </div>
      <Problem error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary btn-sm min-h-11 sm:min-h-9" disabled={pending}>
          {pending ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}
          Mark resolved
        </button>
        <button type="button" className="btn btn-quiet btn-sm min-h-11 sm:min-h-9" disabled={pending} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
