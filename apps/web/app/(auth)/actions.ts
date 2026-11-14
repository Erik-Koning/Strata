"use server";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../server/auth.ts";
import { signUpWithInvite } from "../../server/invites.ts";
import { isSuspendedEmail, Refusal } from "../../server/people.ts";

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
    if (error instanceof APIError) {
      // Better Auth gets this far only with the right password: the session hook refused a suspended person.
      if (error.body?.code === "FAILED_TO_CREATE_SESSION" && (await isSuspendedEmail(email)))
        return { error: "An admin has suspended your access. Ask them to restore it.", email, name: "" };
      return { error: "That email and password don't match an account.", email, name: "" };
    }
    return { error: "Couldn't sign you in just now. Try again in a moment.", email, name: "" };
  }
  redirect(safeNext(form.get("next")));
}

// Sign-up is by invitation: the account is made for the invite's email, with the invite's role and teams.
export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const name = field(form, "name");
  const email = field(form, "email").toLowerCase();
  const token = field(form, "invite");
  const password = typeof form.get("password") === "string" ? (form.get("password") as string) : "";
  if (!token) return { error: "You need an invite link to make an account. Ask an admin for one.", email, name };
  if (!name) return { error: "Enter your name.", email, name };
  if (password.length < 10) return { error: "Use a password of 10 characters or more.", email, name };
  try {
    await signUpWithInvite({ token, name, password, headers: await headers() });
  } catch (error) {
    if (error instanceof Refusal) return { error: error.message, email, name };
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

export interface ResetRequestState {
  // The address the page says a link went to. It says so whether or not there's an account for it.
  sent: string | null;
  error: string | null;
}

// "Forgot your password?": the same answer whether or not the email has an account (server/password-reset.ts).
export async function requestReset(_: ResetRequestState, form: FormData): Promise<ResetRequestState> {
  const email = field(form, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254)
    return { sent: null, error: "Enter the email you sign in with." };
  try {
    await auth().api.requestPasswordReset({ body: { email }, headers: await headers() });
  } catch {
    return { sent: null, error: "Couldn't send the link just now. Try again in a moment." };
  }
  return { sent: email, error: null };
}

export interface ResetState {
  error: string | null;
  // The link can't be used any more: the page offers a new one rather than another try.
  expired: boolean;
}

// The page the emailed link opens: a new password, typed twice. Every session the old password opened ends.
export async function resetPassword(_: ResetState, form: FormData): Promise<ResetState> {
  const token = field(form, "token");
  const password = typeof form.get("password") === "string" ? (form.get("password") as string) : "";
  const confirm = typeof form.get("confirm") === "string" ? (form.get("confirm") as string) : "";
  if (!token) return { error: "This link is missing its code. Ask for a new one.", expired: true };
  if (password.length < 10) return { error: "Use a password of 10 characters or more.", expired: false };
  if (password.length > 128) return { error: "Keep the password to 128 characters or fewer.", expired: false };
  if (password !== confirm) return { error: "The two passwords don't match. Type the same one twice.", expired: false };
  try {
    await auth().api.resetPassword({ body: { newPassword: password, token }, headers: await headers() });
  } catch (error) {
    const code = error instanceof APIError ? error.body?.code : undefined;
    if (code === "INVALID_TOKEN" || code === "USER_NOT_FOUND")
      return { error: "This link has expired or was already used. Ask for a new one.", expired: true };
    return { error: "Couldn't change the password just now. Try again in a moment.", expired: false };
  }
  redirect("/sign-in?reset=1");
}
