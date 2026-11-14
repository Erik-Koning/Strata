"use client";
import { ArrowRight, LoaderCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { type ResetRequestState, requestReset } from "../actions.ts";

const back = (
  <Link className="font-medium text-accent-text underline-offset-4 hover:underline" href="/sign-in">
    Back to sign in
  </Link>
);

export function ForgotForm() {
  const [state, action, pending] = useActionState<ResetRequestState, FormData>(requestReset, {
    sent: null,
    error: null,
  });
  if (state.sent)
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="flex gap-3 rounded-[10px] bg-accent-soft px-3.5 py-3 text-[14px] text-ink">
          <MailCheck size={18} className="mt-0.5 shrink-0 text-accent-text" aria-hidden />
          <span>
            If there's an account for <strong className="font-medium">{state.sent}</strong>, a link to choose a new
            password is on its way. It works once, for an hour.
          </span>
        </p>
        <p className="text-[14px] text-ink-3">
          Nothing after a few minutes? Check your spam folder, or ask an admin to confirm the email on your account.
        </p>
        <p className="text-center text-[14px] text-ink-3">{back}</p>
      </div>
    );
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state.error ? (
        <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2.5 text-[14px] text-danger">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary mt-1 min-h-11" disabled={pending}>
        {pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : null}
        Send the link
        {pending ? null : <ArrowRight size={16} aria-hidden />}
      </button>
      <p className="text-center text-[14px] text-ink-3">{back}</p>
    </form>
  );
}
