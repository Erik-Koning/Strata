import type { Metadata } from "next";
import { AskChat } from "../../../components/ask/ask-chat.tsx";
import { provider } from "../../../server/ai/provider.ts";
import { QUESTION_MAX } from "../../../server/hub/ask.ts";
import { getProduct, listProducts } from "../../../server/hub/products.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";
import { answer, findSources } from "./actions.ts";

export const metadata: Metadata = { title: "Ask" };

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

// Ask Strata: questions answered only from approved work the asker may see, each claim linked to its source. The
// conversation is the page's own state for this visit; nothing asked is saved here.
export default async function AskPage({ searchParams }: PageProps<"/ask">) {
  const viewer = await requireViewer();
  const wanted = one((await searchParams).product) ?? "";
  const [products, chosen] = await Promise.all([
    listProducts(viewer),
    /^[a-z0-9][a-z0-9-]{0,119}$/.test(wanted) ? getProduct(wanted, viewer) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Ask"
        title="Ask Strata"
        lede="Ask about your team's work. Answers come only from approved work you can see, and every claim links to the record it came from. A question nothing answers becomes a gap for the team."
      />
      <AskChat
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        initialProductId={chosen?.id ?? null}
        excerpts={provider().name === "stub"}
        questionMax={QUESTION_MAX}
        findSources={findSources}
        answer={answer}
      />
    </>
  );
}
