"use client";
import { KeyRound, ShieldAlert } from "lucide-react";
import { useActionState } from "react";
import { CopyButton } from "../../../components/copy.tsx";
import { type KeyState, makeKey } from "./actions.ts";

export function KeyMaker({ origin }: { origin: string }) {
  const [state, action, pending] = useActionState<KeyState, FormData>(makeKey, { key: null, name: "", error: null });
  // A key is a bearer token for scripts; the Claude Code plugin signs in with /strata:login instead.
  const check = state.key ? `curl -H "Authorization: Bearer ${state.key}" ${origin}/v1/me` : null;
  return (
    <div className="grid gap-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="key-name">
            Name it after the machine or the client
          </label>
          <input id="key-name" name="name" className="input" placeholder="MacBook · Claude Code" maxLength={60} />
        </div>
        <button type="submit" className="btn btn-primary min-h-[42px]" disabled={pending}>
          <KeyRound size={16} aria-hidden /> {pending ? "Making…" : "Make a key"}
        </button>
      </form>
      {state.key && check ? (
        <div className="rounded-[12px] border border-accent/35 bg-accent-soft p-4">
          <p className="flex items-center gap-2 font-medium text-[14px] text-accent-text">
            <ShieldAlert size={16} aria-hidden /> Copy it now: “{state.name}” is shown only this once.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-line bg-surface py-1.5 pr-1.5 pl-3">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px]">{state.key}</code>
            <CopyButton text={state.key} label="Copy key" />
          </div>
          <p className="mt-4 mb-2 text-[14px] text-ink-2">
            Send it as a bearer token. This checks it works, and answers with who the key belongs to:
          </p>
          <div className="relative">
            <pre className="ledger overflow-x-auto rounded-[10px] px-4 py-3 pr-24">{check}</pre>
            <div className="absolute top-2 right-2">
              <CopyButton text={check} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
