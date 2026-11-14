// How a record is named on the page: its kind and category as a tag, and its id shortened for a citation.
import type { SourceCard } from "../../../server/intelligence/types.ts";

const NAMES: Record<string, string> = {
  pain_point: "Pain point",
  context_gap: "Context gap",
  insight: "Insight",
  workflow: "Workflow note",
  decision: "Decision",
  convention: "Convention",
  preference: "Preference",
  fact: "Fact",
  summary: "Session summary",
};

// Restrained: one hue per meaning. Red only for what hurts, amber for what's missing, jade for what was learned.
const TONES: Record<string, string> = {
  pain_point: "bg-danger-soft text-danger",
  context_gap: "status-candidate",
  insight: "status-active",
  workflow: "status-active",
  decision: "bg-ink/[0.07] text-ink",
};

export const categoryName = (category: string) => NAMES[category] ?? category.replace(/_/g, " ");

export function kindLabel(card: Pick<SourceCard, "kind" | "category">): string {
  if (card.kind === "summary") return "Session summary";
  return `${card.kind === "memory" ? "Memory" : "Finding"} · ${categoryName(card.category).toLowerCase()}`;
}

// mem:65f1c2…a3 > M·a3f9c1: the kind's letter and the id's last six characters.
export function shortRef(ref: string): string {
  const [prefix, ...rest] = ref.split(":");
  const id = rest.join(":");
  const letter = prefix === "mem" ? "M" : prefix === "sum" ? "S" : "F";
  return `${letter}·${id.slice(-6)}`;
}

export function CategoryTag({
  card,
  small = false,
}: {
  card: Pick<SourceCard, "kind" | "category" | "status">;
  small?: boolean;
}) {
  const tone = TONES[card.category] ?? "";
  return (
    <span className={`chip ${tone} ${small ? "min-h-5 px-1.5 text-[11px]" : ""}`}>
      {categoryName(card.category)}
      {card.kind === "finding" ? <span className="font-normal opacity-75">· draft</span> : null}
    </span>
  );
}
