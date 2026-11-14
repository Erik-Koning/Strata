"use client";
// The sender's review of a draft: every field editable, then who it goes to and which of their memories go with it.
// Nothing is ticked to begin with: sharing a memory is a choice made here, one memory at a time.
import type { Handoff, Person, SharedMemory } from "@strata/contracts";
import { EyeOff, Send } from "lucide-react";
import { startTransition, useActionState, useState } from "react";
import { KindChip } from "../../../components/chips.tsx";
import { type FormState, saveOrApprove } from "./actions.ts";

const joined = (items: string[]) => items.join("\n");

function Field({
  name,
  label,
  hint,
  defaultValue,
  rows = 3,
  mono = false,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue: string;
  rows?: number;
  mono?: boolean;
}) {
  const id = `draft-${name}`;
  return (
    <div>
      <label className="label flex items-baseline justify-between gap-2" htmlFor={id}>
        {label}
        {hint ? <span className="font-normal text-[12px] text-ink-3">{hint}</span> : null}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className={`input min-h-16 max-h-80 field-sizing-content text-[14px] ${mono ? "font-mono text-[13px]" : ""}`}
      />
    </div>
  );
}

export function DraftEditor({
  handoff,
  recipients,
  shareable,
}: {
  handoff: Handoff;
  recipients: Person[];
  shareable: SharedMemory[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveOrApprove, { error: null, saved: 0 });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const perLine = "one per line";

  return (
    <form
      // Submitted by hand so the form isn't reset afterwards: the recipient and the ticks survive a failed approve.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => action(data));
      }}
      className="grid gap-5"
      aria-label="Review the draft"
    >
      <input type="hidden" name="id" value={handoff._id} />
      <p className="flex items-start gap-2 rounded-[10px] bg-surface-2 px-3.5 py-2.5 text-[13.5px] text-ink-2">
        <EyeOff size={15} aria-hidden className="mt-0.5 flex-none text-ink-3" />
        <span>
          <span className="font-medium text-ink">Draft. Only you can see it.</span> Check what your session wrote, fix
          anything that's wrong, then approve it for one person. Nothing is shared before that.
        </span>
      </p>

      <div>
        <label className="label" htmlFor="draft-title">
          Title
        </label>
        <input
          id="draft-title"
          name="title"
          required
          maxLength={200}
          defaultValue={handoff.title}
          className="input font-medium"
        />
      </div>
      <Field name="summary" label="Summary" defaultValue={handoff.summary} rows={4} />
      <Field name="nextAction" label="Next recommended action" defaultValue={handoff.nextAction} rows={2} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="completed" label="Completed" hint={perLine} defaultValue={joined(handoff.completed)} />
        <Field name="remaining" label="Remaining" hint={perLine} defaultValue={joined(handoff.remaining)} />
        <Field name="blockers" label="Blockers" hint={perLine} defaultValue={joined(handoff.blockers)} />
        <Field
          name="failedApproaches"
          label="Tried & failed"
          hint={perLine}
          defaultValue={joined(handoff.failedApproaches)}
        />
      </div>
      <Field name="decisions" label="Decisions" hint={perLine} defaultValue={joined(handoff.decisions)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="testCommands"
          label="Test commands"
          hint="the only ones a recipient may run"
          defaultValue={joined(handoff.testCommands)}
          rows={2}
          mono
        />
        <Field
          name="changedFiles"
          label="Changed files"
          hint={perLine}
          defaultValue={joined(handoff.changedFiles)}
          rows={2}
          mono
        />
      </div>

      <fieldset className="grid gap-4 rounded-[12px] border border-line px-4 pt-3 pb-4">
        <legend className="eyebrow px-1">Share</legend>
        <div>
          <label className="label" htmlFor="draft-recipient">
            Hand it to
          </label>
          <select id="draft-recipient" name="recipientId" required defaultValue="" className="input">
            <option value="" disabled>
              Choose a person
            </option>
            {recipients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.email ? ` (${p.email})` : ""}
              </option>
            ))}
          </select>
          {recipients.length ? null : (
            <p className="mt-1.5 text-[12.5px] text-ink-3">No one else has an account yet. Invite them first.</p>
          )}
        </div>
        <div>
          <p className="label flex items-baseline justify-between gap-2">
            Memories to share with it
            <span className="font-normal text-[12px] text-ink-3">
              {ticked.size} of {shareable.length} ticked
            </span>
          </p>
          {shareable.length ? (
            <ul className="grid max-h-80 gap-1 overflow-auto rounded-[10px] border border-line p-1">
              {shareable.map((m) => (
                <li key={m._id}>
                  <label
                    className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[8px] px-2.5 py-2 hover:bg-surface-2 ${ticked.has(m._id) ? "bg-accent-soft/60" : ""}`}
                  >
                    <input
                      type="checkbox"
                      name="memoryIds"
                      value={m._id}
                      checked={ticked.has(m._id)}
                      onChange={() => toggle(m._id)}
                      className="mt-1 size-4 flex-none accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] leading-snug">{m.text}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <KindChip kind={m.kind} />
                        <span className="text-[12px] text-ink-3">
                          {m.trust} · {m.provenance.source}
                        </span>
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">
              You have no active memories in <span className="font-mono">{handoff.project}</span> to share. The
              checkpoint travels on its own.
            </p>
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" name="intent" value="approve" className="btn btn-primary" disabled={pending}>
          <Send size={15} aria-hidden />
          {pending
            ? "Working…"
            : `Approve & share${ticked.size ? ` with ${ticked.size} ${ticked.size === 1 ? "memory" : "memories"}` : ""}`}
        </button>
        <button type="submit" name="intent" value="save" formNoValidate className="btn" disabled={pending}>
          Save draft
        </button>
        <span className="text-[12.5px] text-ink-3" role="status">
          {!pending && state.saved && !state.error ? "Saved." : ""}
        </span>
      </div>
      {state.error ? (
        <p role="alert" className="text-[14px] text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
