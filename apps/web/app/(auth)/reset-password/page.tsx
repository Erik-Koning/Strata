import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "./reset-form.tsx";

export const metadata: Metadata = { title: "Choose a new password" };

// The page the emailed link opens (server/password-reset.ts). The token is checked when the form is sent.
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="font-semibold text-[28px] tracking-[-0.02em]">Choose a new password</h1>
      {typeof token === "string" && token ? (
        <>
          <p className="mt-1.5 mb-7 text-ink-3">
            Once it's changed, every session signed in with the old password ends, the Claude Code plugin's included.
          </p>
          <ResetForm token={token} />
        </>
      ) : (
        <p className="mt-1.5 text-ink-3">
          This link is missing its code. Open the link from the email again, or{" "}
          <Link className="font-medium text-accent-text underline-offset-4 hover:underline" href="/forgot-password">
            ask for a new one
          </Link>
          .
        </p>
      )}
    </>
  );
}
