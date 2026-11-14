import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "../../server/viewer.ts";
import { decideDevice } from "./actions.ts";

export const metadata: Metadata = { title: "Approve sign-in" };

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string; done?: string; error?: string }>;
}) {
  const { user_code, done, error } = await searchParams;
  const code = typeof user_code === "string" ? user_code : "";
  const next = `/activate${code ? `?user_code=${encodeURIComponent(code)}` : ""}`;
  const viewer = await getViewer();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center px-4 py-12">
      <div className="card p-6 sm:p-8">
        <p className="text-[12px] font-medium tracking-[0.14em] text-ink-3 uppercase">Strata</p>
        <h1 className="mt-2 font-semibold text-[26px] tracking-[-0.02em]">Approve this sign-in</h1>

        {done === "approved" ? (
          <p className="mt-4 rounded-[10px] bg-success-soft px-3 py-2.5 text-[14px] text-success">
            Approved. Claude Code can finish signing in; you can close this tab.
          </p>
        ) : done === "denied" ? (
          <p className="mt-4 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[14px] text-ink-2">
            Denied. Nothing was connected.
          </p>
        ) : (
          <>
            <p className="mt-2 text-[14px] text-ink-3">
              Claude Code is asking to connect to this Strata account. Approve only if you just ran{" "}
              <span className="kbd">/strata:login</span>.
            </p>
            {error ? (
              <p role="alert" className="mt-4 rounded-[10px] bg-danger-soft px-3 py-2.5 text-[14px] text-danger">
                {error}
              </p>
            ) : null}
            {!viewer ? (
              <p className="mt-6 text-[14px] text-ink-2">
                <Link
                  className="font-medium text-accent-text underline-offset-4 hover:underline"
                  href={`/sign-in?next=${encodeURIComponent(next)}`}
                >
                  Sign in
                </Link>{" "}
                to approve this sign-in.
              </p>
            ) : !code ? (
              <p className="mt-6 text-[14px] text-ink-2">
                Open the link Claude Code printed, or run <span className="kbd">/strata:login</span> again.
              </p>
            ) : (
              <form action={decideDevice} className="mt-6 grid gap-3">
                <input type="hidden" name="user_code" value={code} />
                <div className="rounded-[10px] bg-surface-2 px-4 py-3 text-center font-mono text-[20px] tracking-[0.18em]">
                  {code}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary min-h-11" name="decision" value="approve" type="submit">
                    Approve
                  </button>
                  <button className="btn btn-quiet min-h-11" name="decision" value="deny" type="submit">
                    Deny
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
