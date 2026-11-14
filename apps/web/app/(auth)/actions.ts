"use server";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../server/auth.ts";

export interface AuthState {
  error: string | null;
  email: string;
  name: string;
}

// Only a path on this site: a next that names another host goes home instead.
const safeNext = (value: FormDataEntryValue | null): string => {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
};

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const email = field(form, "email").toLowerCase();
  const password = typeof form.get("password") === "string" ? (form.get("password") as string) : "";
  if (!email || !password) return { error: "Enter your email and your password.", email, name: "" };
  try {
    await auth().api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (error) {
    if (error instanceof APIError) return { error: "That email and password don't match an account.", email, name: "" };
    return { error: "Couldn't sign you in just now. Try again in a moment.", email, name: "" };
  }
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const name = field(form, "name");
  const email = field(form, "email").toLowerCase();
  const password = typeof form.get("password") === "string" ? (form.get("password") as string) : "";
  if (!name || !email) return { error: "Enter your name and your email.", email, name };
  if (password.length < 10) return { error: "Use a password of 10 characters or more.", email, name };
  try {
    await auth().api.signUpEmail({ body: { name, email, password }, headers: await headers() });
  } catch (error) {
    if (error instanceof APIError) {
      const exists = /exist/i.test(error.message);
      return {
        error: exists
          ? "There's already an account for that email. Sign in instead."
          : error.message || "Couldn't create the account.",
        email,
        name,
      };
    }
    return { error: "Couldn't create the account just now. Try again in a moment.", email, name };
  }
  redirect("/connect");
}

export async function signOut(): Promise<void> {
  await auth()
    .api.signOut({ headers: await headers() })
    .catch(() => undefined);
  redirect("/sign-in");
}
