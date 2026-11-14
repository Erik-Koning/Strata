"use client";
// Drafting a handoff by hand, for when there's no session to draft it from. It starts as a draft, like one from
// /strata:handoff, and is reviewed and approved the same way.
import Link from "next/link";
import { startTransition, useActionState } from "react";
import { createDraft, type FormState } from "./actions.ts";

export function NewHandoff({ projects }: { projects: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createDraft, { error: null, saved: 0 });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="grid gap-4"
      aria-labelledby="new-title"
    >
      <div>
        <p className="eyebrow">New handoff</p>
        <h2 id="new-title" className="mt-1 font-semibold text-[20px] tracking-[-0.015em]">
          Draft a checkpoint by hand
        </h2>
        <p className="mt-1 text-[13.5px] text-ink-3">
          Usually <code className="kbd">/strata:handoff</code> drafts this from your session, with the repository state
          and test runs. A draft made here has neither, and only you see it until you approve it.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <label className="label" htmlFor="new-title-field">
            Title
          </label>
          <input
            id="new-title-field"
            name="title"
            required
            maxLength={200}
            className="input"
            placeholder="Finish the invoice export"
          />
        </div>
        <div>
          <label className="label" htmlFor="new-project">
            Project
          </label>
          <input
            id="new-project"
            name="project"
            required
            maxLength={200}
            className="input font-mono text-[14px]"
            list="relay-projects"
            placeholder="acme/billing"
          />
          <datalist id="relay-projects">
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="new-summary">
          Summary
        </label>
        <textarea id="new-summary" name="summary" rows={4} className="input min-h-0 text-[14px]" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="new-remaining">
            Remaining <span className="font-normal text-ink-3">(one per line)</span>
          </label>
          <textarea id="new-remaining" name="remaining" rows={3} className="input min-h-0 text-[14px]" />
        </div>
        <div>
          <label className="label" htmlFor="new-blockers">
            Blockers <span className="font-normal text-ink-3">(one per line)</span>
          </label>
          <textarea id="new-blockers" name="blockers" rows={3} className="input min-h-0 text-[14px]" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="new-next">
          Next recommended action
        </label>
        <input id="new-next" name="nextAction" maxLength={2000} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="new-tests">
          Test commands <span className="font-normal text-ink-3">(one per line)</span>
        </label>
        <textarea
          id="new-tests"
          name="testCommands"
          rows={2}
          className="input min-h-0 font-mono text-[13px]"
          placeholder="pnpm test"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save draft"}
        </button>
        <Link href="/relay" className="btn btn-quiet">
          Cancel
        </Link>
      </div>
      {state.error ? (
        <p role="alert" className="text-[14px] text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
