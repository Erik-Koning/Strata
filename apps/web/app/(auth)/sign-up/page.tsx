import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "../../../server/viewer.ts";
import { AuthForm } from "../auth-form.tsx";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage() {
  if (await getViewer()) redirect("/");
  return (
    <>
      <h1 className="font-semibold text-[28px] tracking-[-0.02em]">Create your account</h1>
      <p className="mt-1.5 mb-7 text-ink-3">Then connect Claude Code with an API key. It takes a minute.</p>
      <AuthForm mode="sign-up" />
    </>
  );
}
