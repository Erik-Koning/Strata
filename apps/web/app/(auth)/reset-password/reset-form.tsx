"use client";
import { ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { type ResetState, resetPassword } from "../actions.ts";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPassword, {
    error: null,
    expired: false,
  });
  if (state.expired)
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2.5 text-[14px] text-danger">
          {state.error}
        </p>
        <Link className="btn btn-primary min-h-11" href="/forgot-password">
          Send a new link <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    );
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="password">
          New password
        </label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          aria-describedby="password-hint"
          required
        />
        <p id="password-hint" className="mt-1.5 text-[13px] text-ink-3">
          10 characters or more.
        </p>
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          The same password again
        </label>
        <input
          className="input"
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </div>
      {state.error ? (
        <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2.5 text-[14px] text-danger">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary mt-1 min-h-11" disabled={pending}>
        {pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : null}
        Change the password
        {pending ? null : <ArrowRight size={16} aria-hidden />}
      </button>
    </form>
  );
}
