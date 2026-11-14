// The one shape an approved session summary crosses the wire in. The Claude Code plugin's
// schema.mjs sanitizes the same fields before sending; this is the server's independent check,
// so neither side trusts the other.
import { z } from "zod";

export const SUMMARY_LIMITS = {
  title: 100,
  built: 500,
  why: 300,
  decisions: { count: 5, max: 160 },
  areas: { count: 8, max: 80 },
  open: { count: 5, max: 160 },
  insights: { count: 5, max: 200 },
  workflow: { count: 5, max: 200 },
  painPoints: { count: 5, max: 200 },
  gaps: { count: 5, max: 200 },
} as const;

export const JIRA_KEY = /^[A-Z][A-Z0-9]{1,9}-[1-9]\d{0,6}$/;
// Things shaped like a Jira key that are not: UTF-8, SHA-256, ISO-8601, CVE-2024-1234 ...
export const NOT_JIRA = new Set([
  "UTF",
  "SHA",
  "ISO",
  "CVE",
  "RFC",
  "HTTP",
  "TCP",
  "UDP",
  "TLS",
  "SSL",
  "AES",
  "RSA",
  "MD",
  "IPV",
  "WCAG",
  "GPT",
  "LTS",
  "PNG",
  "JPEG",
  "CSS",
  "ES",
  "EC",
  "HS",
  "RS",
  "X",
]);
export const JiraKey = z
  .string()
  .regex(JIRA_KEY)
  .refine((key) => !NOT_JIRA.has(key.slice(0, key.indexOf("-"))), { message: "not a Jira key" });
const PR_URL = /^https:\/\/[^\s]+$/;

const strings = (count: number, max: number) => z.array(z.string().max(max)).max(count);

export const SummarySummary = z
  .object({
    title: z.string().max(SUMMARY_LIMITS.title),
    built: z.string().max(SUMMARY_LIMITS.built),
    why: z.string().max(SUMMARY_LIMITS.why),
    decisions: strings(SUMMARY_LIMITS.decisions.count, SUMMARY_LIMITS.decisions.max),
    areas: strings(SUMMARY_LIMITS.areas.count, SUMMARY_LIMITS.areas.max),
    open: strings(SUMMARY_LIMITS.open.count, SUMMARY_LIMITS.open.max),
    insights: strings(SUMMARY_LIMITS.insights.count, SUMMARY_LIMITS.insights.max),
    workflow: strings(SUMMARY_LIMITS.workflow.count, SUMMARY_LIMITS.workflow.max),
    painPoints: strings(SUMMARY_LIMITS.painPoints.count, SUMMARY_LIMITS.painPoints.max),
    gaps: strings(SUMMARY_LIMITS.gaps.count, SUMMARY_LIMITS.gaps.max),
  })
  .strict();
export type SummarySummary = z.infer<typeof SummarySummary>;

export const SummaryPr = z
  .object({
    number: z.number().int().positive().optional(),
    url: z.string().max(500).regex(PR_URL),
    title: z.string().max(200).optional(),
  })
  .strict();
export type SummaryPr = z.infer<typeof SummaryPr>;

export const SummaryLinks = z
  .object({
    jira: z.array(JiraKey).max(20),
    pr: SummaryPr.nullable(),
    noTicket: z.boolean().default(false),
  })
  .strict();
export type SummaryLinks = z.infer<typeof SummaryLinks>;

export const SummaryRepo = z
  .object({
    remote: z.string().max(500).default(""),
    branch: z.string().max(300).default(""),
    head: z.string().max(100).default(""),
  })
  .strict();
export type SummaryRepo = z.infer<typeof SummaryRepo>;

export const SummaryReview = z
  .object({
    approved: z.literal(true),
    approvedAt: z.string().datetime({ offset: true }),
    edited: z.boolean().default(false),
  })
  .strict();
export type SummaryReview = z.infer<typeof SummaryReview>;

// POST /v1/events. Strict: anything the contract doesn't name (a prompt, a reply, a turn) is refused.
export const SessionSummaryEvent = z
  .object({
    idempotencyKey: z.string().min(1).max(300),
    type: z.literal("session_summary"),
    sessionId: z.string().min(1).max(200),
    revision: z.number().int().positive(),
    projectId: z.string().min(1).max(100),
    updatedAt: z.string().datetime({ offset: true }),
    client: z
      .object({ plugin: z.string().max(40), platform: z.string().max(40) })
      .strict()
      .optional(),
    repo: SummaryRepo,
    links: SummaryLinks,
    summary: SummarySummary,
    files: z.array(z.string().max(500)).max(200).default([]),
    review: SummaryReview,
  })
  .strict();
export type SessionSummaryEvent = z.infer<typeof SessionSummaryEvent>;

export interface SearchResult {
  kind: "built" | "insight" | "workflow" | "pain-point" | "gap" | "decision";
  text: string;
  title: string;
  projectId: string;
  jira: string[];
  pr: string | null;
  sessionId: string;
  author: string | null;
  updatedAt: string;
}

export interface Rollup {
  key: string;
  kind: "ticket" | "pr" | "none";
  authors: string[];
  sessions: { sessionId: string; title: string; built: string; updatedAt: string }[];
  decisions: string[];
  insights: string[];
  workflow: string[];
  painPoints: string[];
  gaps: string[];
}
