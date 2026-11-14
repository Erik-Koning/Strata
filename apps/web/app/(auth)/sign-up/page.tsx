import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ROLE_LABELS } from "../../../server/access.ts";
import { findOpenInvite } from "../../../server/invites.ts";
import { getViewer } from "../../../server/viewer.ts";
import { AuthForm } from "../auth-form.tsx";

export const metadata: Metadata = { title: "Create an account" };

// Accounts are by invitation: this page works only from an invite link (/sign-up?invite=inv_…).
export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  if (await getViewer()) redirect("/");
  const { invite: raw } = await searchParams;
  const token = typeof raw === "string" ? raw : "";
  const invite = token ? await findOpenInvite(token) : null;

  if (!invite)
    return (
      <>
        <h1 className="font-semibold text-[28px] tracking-[-0.02em]">
          {token ? "This invite link doesn't work" : "Accounts are by invitation"}
        </h1>
        <p className="mt-1.5 mb-7 text-ink-3">
          {token
            ? "It has expired, was revoked, or was already used. Ask an admin for a new one."
            : "Ask an admin for an invite link. It makes your account with the right access."}
        </p>
        <Link className="btn min-h-11" href="/sign-in">
          Go to sign in
        </Link>
      </>
    );

  return (
    <>
      <h1 className="font-semibold text-[28px] tracking-[-0.02em]">Create your account</h1>
      <p className="mt-1.5 mb-7 text-ink-3">
        You're invited as {/^[aeiou]/i.test(ROLE_LABELS[invite.role]) ? "an" : "a"}{" "}
        <span className="font-medium text-ink">{ROLE_LABELS[invite.role]}</span>. Then connect Claude Code with an API
        key. It takes a minute.
      </p>
      <AuthForm mode="sign-up" invite={{ token, email: invite.email }} />
    </>
  );
}
