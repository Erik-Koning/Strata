import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form.tsx";

export const metadata: Metadata = { title: "Forgot your password?" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="font-semibold text-[28px] tracking-[-0.02em]">Forgot your password?</h1>
      <p className="mt-1.5 mb-7 text-ink-3">
        Enter the email you sign in with, and we'll send a link to choose a new one.
      </p>
      <ForgotForm />
    </>
  );
}
