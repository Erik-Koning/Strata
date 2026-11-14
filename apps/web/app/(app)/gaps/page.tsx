import { Puzzle } from "lucide-react";
import type { Metadata } from "next";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Gaps" };

// A placeholder until the context gaps page lands (phase 2, P3).
export default async function GapsPage() {
  await requireViewer();
  return (
    <>
      <PageHeader
        eyebrow="Gaps"
        title="Context gaps"
        lede="What people and agents couldn't find out, ranked by how often it comes back, until someone answers it."
      />
      <section className="card px-6 py-14 text-center" aria-labelledby="being-built">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
          <Puzzle size={17} aria-hidden />
        </span>
        <h2 id="being-built" className="mt-4 font-semibold text-[16px]">
          Being built
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
          Gaps will be listed here once approved work names them, each with an owner and a link to what answers it.
        </p>
      </section>
    </>
  );
}
