import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "../../../server/viewer.ts";
import { AuthForm } from "../auth-form.tsx";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  if (await getViewer()) redirect("/");
  const { next, reset } = await searchParams;
  return (
    <>
      <h1 className="font-semibold text-[28px] tracking-[-0.02em]">Sign in</h1>
      <p className="mt-1.5 mb-7 text-ink-3">See what your agents remember, and decide what they keep.</p>
      {reset ? (
        <p role="status" className="mb-5 rounded-[10px] bg-accent-soft px-3 py-2.5 text-[14px] text-ink">
          Your password is changed. Sign in with the new one.
        </p>
      ) : null}
      <AuthForm mode="sign-in" next={typeof next === "string" ? next : undefined} />
    </>
  );
}
