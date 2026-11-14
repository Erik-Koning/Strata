import { MessageCircleQuestionMark } from "lucide-react";
import type { Metadata } from "next";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Ask" };

// A placeholder until Ask Strata lands (phase 2, P4).
export default async function AskPage() {
  await requireViewer();
  return (
    <>
      <PageHeader
        eyebrow="Ask"
        title="Ask Strata"
        lede="Questions answered from your team's approved work, with every claim linked to where it came from."
      />
      <section className="card px-6 py-14 text-center" aria-labelledby="being-built">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent-text">
          <MessageCircleQuestionMark size={17} aria-hidden />
        </span>
        <h2 id="being-built" className="mt-4 font-semibold text-[16px]">
          Being built
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-[14px] text-ink-3">
          Answers will come only from approved work you can see, and every sentence will cite its source.
        </p>
      </section>
    </>
  );
}
