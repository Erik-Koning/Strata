import { Boxes } from "lucide-react";
import type { Metadata } from "next";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Products" };

// A placeholder until the products pages land (phase 2, P1).
export default async function ProductsPage() {
  await requireViewer();
  return (
    <>
      <PageHeader
        eyebrow="Products"
        title="What's being built"
        lede="Each product your team works on: what changed this week, what's in progress, and its open gaps."
      />
      <section className="card px-6 py-14 text-center" aria-labelledby="being-built">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
          <Boxes size={17} aria-hidden />
        </span>
        <h2 id="being-built" className="mt-4 font-semibold text-[16px]">
          Being built
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
          Products are made from the repositories your sessions run in, and this page will list each one with its latest
          approved work.
        </p>
      </section>
    </>
  );
}
