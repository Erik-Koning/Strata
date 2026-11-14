// The server's own pass over a summary before it is stored. The plugin sanitizes before sending;
// this repeats the work so a compromised or older client cannot get code, secrets or unlimited
// text into the hub. The field limits mirror packages/contracts/src/summary.ts and the plugin's
// scripts/lib/schema.mjs.
import { JIRA_KEY, NOT_JIRA, redact, SUMMARY_LIMITS, type SummaryLinks, type SummarySummary } from "@strata/contracts";

const TAG_BLOCK =
  /<(private|system-reminder|system_instruction|system-instruction|persisted-output|claude-mem-context|strata-context)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const CODE_FENCE = /```[\s\S]*?(?:```|$)/g;
const LONG_INLINE_CODE = /`[^`\n]{30,}`/g;

function scrub(value: unknown): string {
  return String(value ?? "")
    .replace(TAG_BLOCK, " ")
    .replace(CODE_FENCE, " ")
    .replace(LONG_INLINE_CODE, " ");
}

function text(value: unknown, max: number): string {
  return redact(scrub(value)).replace(/\s+/g, " ").trim().slice(0, max);
}

function list(value: unknown, count: number, max: number): string[] {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => text(item, max))
    .filter(Boolean)
    .slice(0, count);
}

export function sanitizeSummary(input: SummarySummary): SummarySummary {
  return {
    title: text(input.title, SUMMARY_LIMITS.title),
    built: text(input.built, SUMMARY_LIMITS.built),
    why: text(input.why, SUMMARY_LIMITS.why),
    decisions: list(input.decisions, SUMMARY_LIMITS.decisions.count, SUMMARY_LIMITS.decisions.max),
    areas: list(input.areas, SUMMARY_LIMITS.areas.count, SUMMARY_LIMITS.areas.max),
    open: list(input.open, SUMMARY_LIMITS.open.count, SUMMARY_LIMITS.open.max),
    insights: list(input.insights, SUMMARY_LIMITS.insights.count, SUMMARY_LIMITS.insights.max),
    workflow: list(input.workflow, SUMMARY_LIMITS.workflow.count, SUMMARY_LIMITS.workflow.max),
    painPoints: list(input.painPoints, SUMMARY_LIMITS.painPoints.count, SUMMARY_LIMITS.painPoints.max),
    gaps: list(input.gaps, SUMMARY_LIMITS.gaps.count, SUMMARY_LIMITS.gaps.max),
  };
}

export function sanitizeLinks(input: SummaryLinks): SummaryLinks {
  const jira = [
    ...new Set(
      (Array.isArray(input.jira) ? input.jira : [])
        .map((key) => text(key, 20).toUpperCase())
        .filter((key) => JIRA_KEY.test(key) && !NOT_JIRA.has(key.slice(0, key.indexOf("-")))),
    ),
  ].slice(0, 20);
  const url = input.pr?.url ? text(input.pr.url, 500) : "";
  const pr = /^https:\/\/[^\s]+$/.test(url)
    ? {
        url,
        ...(typeof input.pr?.number === "number" && input.pr.number > 0 ? { number: input.pr.number } : {}),
        ...(input.pr?.title ? { title: text(input.pr.title, 200) } : {}),
      }
    : null;
  return { jira, pr, noTicket: Boolean(input.noTicket) };
}

const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|[\\/])/;

export function sanitizeFiles(files: string[]): string[] {
  return [
    ...new Set(
      files
        .filter((file) => typeof file === "string")
        .map((file) => file.replace(/\\/g, "/").trim())
        .filter(
          (file) =>
            file.length > 0 && file.length <= 500 && !ABSOLUTE_PATH.test(file) && !file.split("/").includes(".."),
        ),
    ),
  ].slice(0, 200);
}

export const isEmptySummary = (summary: SummarySummary): boolean => !summary.title && !summary.built;
