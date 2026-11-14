"use client";
import { useState, useTransition } from "react";
import { reopen, resolve, take } from "./actions.ts";

export function GapActions({ id, status, mine }: { id: string; status: "open" | "resolved"; mine: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const run = (work: () => Promise<{ error: string | null }>) => start(async () => setError((await work()).error));

  if (status === "resolved")
    return (
      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-quiet btn-sm" disabled={pending} onClick={() => run(() => reopen(id))}>
          Open again
        </button>
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {mine ? null : (
        <div>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => take(id))}>
            Take this on
          </button>
        </div>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => resolve(id, url, note));
        }}
      >
        <label className="label" htmlFor="gap-url">
          What answers it (a link)
        </label>
        <input
          id="gap-url"
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />
        <label className="label" htmlFor="gap-note">
          Or a note
        </label>
        <input id="gap-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        <div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending || (!url.trim() && !note.trim())}>
            Mark resolved
          </button>
        </div>
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </form>
    </div>
  );
}
