// How the explorer writes a node's measures, and how big it draws each node for the measure chosen. Pure.
import type { GraphNode, SizeMetric } from "../../server/hub/graph-model.ts";

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

// Hours lost, as people read them: 12.4 h, 42 min, under 1 min, none.
export function hoursText(hours: number | null): string {
  if (hours === null) return "Not measured";
  if (hours >= 1) return `${hours >= 100 ? Math.round(hours).toLocaleString("en-GB") : hours.toFixed(1)} h`;
  const minutes = Math.round(hours * 60);
  if (minutes >= 1) return `${minutes} min`;
  return hours > 0 ? "under 1 min" : "none";
}

// What a node's occurrences count, by kind: sessions for most things; nothing to say for a single memory.
export function occurrencesText(node: GraphNode, mine: boolean): string | null {
  const n = node.metrics.occurrences;
  if (node.kind === "session") return mine ? plural(n, "memory", "memories") : plural(n, "finding");
  if (node.kind === "project") return plural(n, "memory", "memories");
  if (mine) return null;
  // A question Ask Strata couldn't answer that no session ran into.
  if (node.id.startsWith("gap:")) return `Asked ${plural(n, "time")}`;
  return `In ${plural(n, "session")}`;
}

export function recurrenceText(n: number | null): string {
  return n === null ? "Not a gap" : `${plural(n, "time")} (sessions and questions)`;
}

// The value a node is sized by, or null where the measure doesn't apply to it.
export function metricOf(node: GraphNode, metric: SizeMetric): number | null {
  switch (metric) {
    case "degree":
      return node.metrics.degree;
    case "recency":
      return node.metrics.lastSeen ? new Date(node.metrics.lastSeen).getTime() : null;
    case "hours":
      return node.metrics.hoursLost;
    case "recurrence":
      return node.metrics.recurrence;
  }
}

export const MIN_RADIUS = 4.5;
export const MAX_RADIUS = 17;

// Each node's radius: by the square root of its share of the largest value, so area tracks the measure. Recency is
// measured from the oldest node in view. A node the measure doesn't apply to is drawn at the smallest size.
export function radii(nodes: readonly GraphNode[], metric: SizeMetric): Map<string, number> {
  const values = nodes.map((n) => metricOf(n, metric));
  const present = values.filter((v): v is number => v !== null);
  const floor = metric === "recency" && present.length ? Math.min(...present) : 0;
  const top = present.length ? Math.max(...present) - floor : 0;
  return new Map(
    nodes.map((n, i) => {
      const v = values[i] ?? null;
      const share = v === null || top <= 0 ? 0 : Math.max(0, (v - floor) / top);
      return [n.id, MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(share)];
    }),
  );
}

// The link a node opens, and what the button says.
export function openLabel(node: GraphNode): string {
  switch (node.kind) {
    case "product":
      return "Open product";
    case "area":
      return "Open its product";
    case "session":
      return "Open session";
    case "context_gap":
      return node.href?.startsWith("/gaps/") ? "Open gap" : "Open session";
    case "project":
    case "preference":
    case "fact":
    case "convention":
      return "Open in Knowledge";
    case "decision":
    case "summary":
      return node.href?.startsWith("/memories") ? "Open in Knowledge" : "Open session";
    default:
      return "Open session";
  }
}

export const externalLabel = (node: GraphNode): string =>
  node.kind === "pr" ? "Open pull request" : node.kind === "ticket" ? "Open ticket" : "Open link";
