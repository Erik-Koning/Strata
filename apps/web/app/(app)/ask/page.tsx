import type { Metadata } from "next";
import { pulse } from "../../../server/intelligence/pulse.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { AskStrata } from "../intelligence/ask-strata.tsx";
import { EvidenceProvider } from "../intelligence/evidence.tsx";
import { PageHeader } from "../page-header.tsx";

export const metadata: Metadata = { title: "Ask" };
export const dynamic = "force-dynamic";

export default async function AskPage() {
  const viewer = await requireViewer();
  const p = await pulse(viewer.userId);
  const f = p.totals.findings;
  const records = p.totals.activeMemories + p.totals.summaries + f.insight + f.workflow + f.pain_point + f.context_gap;
  const top = p.projects[0]?.project.split("/").pop();
  const suggestions = [
    "What changed recently?",
    "What did I discover this week?",
    "What work is still unfinished?",
    "Why did we choose this approach?",
    top ? `How do I get ${top} running?` : "How do I get this service running?",
  ];
  return (
    <EvidenceProvider>
      <PageHeader
        eyebrow="Ask"
        title="Ask Strata"
        lede="Ask about the work in plain words. Answers are made only from your own records, and each point cites the record it came from."
      />
      <AskStrata suggestions={suggestions} records={records} />
    </EvidenceProvider>
  );
}
