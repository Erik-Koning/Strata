import { Timer } from "lucide-react";
import type { Metadata } from "next";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Time" };

// A placeholder until the time page lands (phase 2, P2).
export default async function TimePage() {
  await requireViewer();
  return (
    <>
      <PageHeader
        eyebrow="Time"
        title="Where engineering time goes"
        lede="Time lost to re-runs, failures and slow tool runs, by command and product. Measured on tools, never on people."
      />
      <section className="card px-6 py-14 text-center" aria-labelledby="being-built">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
          <Timer size={17} aria-hidden />
        </span>
        <h2 id="being-built" className="mt-4 font-semibold text-[16px]">
          Being built
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
          The figures will come from the tool timings each session sends, ranked, with the sessions behind each one.
        </p>
      </section>
    </>
  );
}
