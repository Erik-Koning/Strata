import { Sunrise } from "lucide-react";
import type { Metadata } from "next";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "My Day" };

// A placeholder until the review queue lands (phase 2, P5).
export default async function MyDayPage() {
  await requireViewer();
  return (
    <>
      <PageHeader
        eyebrow="My Day"
        title="Waiting for you"
        lede="The drafts from your sessions, to approve, edit or discard. Nobody else sees them until you approve."
      />
      <section className="card px-6 py-14 text-center" aria-labelledby="being-built">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
          <Sunrise size={17} aria-hidden />
        </span>
        <h2 id="being-built" className="mt-4 font-semibold text-[16px]">
          Being built
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
          Your drafts will be grouped here by session, ready to review in one place.
        </p>
      </section>
    </>
  );
}
