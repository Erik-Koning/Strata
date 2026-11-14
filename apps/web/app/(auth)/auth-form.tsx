"use client";
import { ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { type AuthState, signIn, signUp } from "./actions.ts";

export function AuthForm({ mode, next }: { mode: "sign-in" | "sign-up"; next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "sign-in" ? signIn : signUp, {
    error: null,
    email: "",
    name: "",
  });
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {mode === "sign-up" ? (
        <div>
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input className="input" id="name" name="name" autoComplete="name" defaultValue={state.name} required />
        </div>
      ) : null}
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          className="input"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          minLength={mode === "sign-up" ? 10 : undefined}
          aria-describedby={mode === "sign-up" ? "password-hint" : undefined}
          required
        />
        {mode === "sign-up" ? (
          <p id="password-hint" className="mt-1.5 text-[13px] text-ink-3">
            10 characters or more.
          </p>
        ) : null}
      </div>
      {state.error ? (
        <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2.5 text-[14px] text-danger">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary mt-1 min-h-11" disabled={pending}>
        {pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : null}
        {mode === "sign-in" ? "Sign in" : "Create account"}
        {pending ? null : <ArrowRight size={16} aria-hidden />}
      </button>
      <p className="text-center text-[14px] text-ink-3">
        {mode === "sign-in" ? (
          <>
            New here?{" "}
            <Link className="font-medium text-accent-text underline-offset-4 hover:underline" href="/sign-up">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Have an account?{" "}
            <Link className="font-medium text-accent-text underline-offset-4 hover:underline" href="/sign-in">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
