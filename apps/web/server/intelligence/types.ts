// The shapes Strata Intelligence hands the page: plain data (ISO strings, no ObjectIds), so they cross from a server
// action to the browser as they are. Nothing here reads the database.

// Where a source came from. Every one of them belongs to the person asking: Intelligence reads nothing else yet.
//   memory:  an active memory (kept by the person, or said by them in their own words)
//   summary: a compaction summary of one of their sessions
//   finding: what their agent logged with record_finding (a draft: only its author sees it until records review exists)
export type SourceKind = "memory" | "summary" | "finding";

// A source's id as the page cites it: "mem:<hex>", "sum:<hex>", "fnd:<event id>".
export type SourceRef = string;

export interface SourceCard {
  ref: SourceRef;
  kind: SourceKind;
  // A memory's kind (decision, fact…), "summary", or a finding's type (pain_point, insight…).
  category: string;
  text: string;
  project: string;
  sessionID: string | null;
  // A memory's status, "draft" for a finding, "generated" for a summary.
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnswerPoint {
  // A record's own words, shortened at a sentence or word boundary. Never rewritten.
  text: string;
  refs: SourceRef[];
}

export interface AnswerSection {
  heading: string;
  points: AnswerPoint[];
}

export interface Answer {
  question: string;
  // extractive: assembled from the records' own words, no model. Nothing else exists yet (the AI provider is a stub).
  mode: "extractive";
  // What the question was read as, shown so the person can see why these records came back.
  reading: { intent: IntentName | null; intentLabel: string | null; terms: string[]; window: string | null };
  // One factual line about what was found, made from counts and categories only.
  lead: string;
  sections: AnswerSection[];
  // What the records can't say, said plainly.
  gaps: string[];
  sources: SourceCard[];
  searched: { memories: number; summaries: number; findings: number; projects: number };
  retrieval: "vector+text" | "text";
}

export type IntentName = "blockers" | "changes" | "why" | "discoveries" | "unfinished" | "setup";

export interface SessionContext {
  sessionID: string;
  project: string;
  repo: string | null;
  branch: string | null;
  head: string | null;
  refs: { type: string; id: string; system?: string; url?: string }[];
  first: string;
  last: string;
  // How much the session captured, by kind. Counts only: no prompt, reply or transcript text is ever shown.
  captured: { kind: string; count: number }[];
  client: string | null;
}

export interface Evidence {
  source: SourceCard;
  // Where it came from, as stored.
  provenance: { label: string; value: string; mono?: boolean }[];
  timestamps: { label: string; at: string }[];
  session: SessionContext | null;
  related: SourceCard[];
  authorization: { owner: string; visibility: string; basis: string; cited: boolean };
  // Summaries this memory went into, and for a summary, how many of its sources still exist.
  notes: string[];
}

export interface PulseDay {
  day: string;
  events: number;
  memories: number;
  findings: number;
}

export interface PulseProject {
  project: string;
  memories: number;
  findings: number;
  sessions: number;
  openFriction: number;
  lastActivity: string | null;
  repo: string | null;
  branch: string | null;
  refs: string[];
}

export interface Pulse {
  generatedAt: string;
  totals: {
    activeMemories: number;
    candidates: number;
    summaries: number;
    sessions7d: number;
    sessions30d: number;
    projects: number;
    findings: Record<"insight" | "workflow" | "pain_point" | "context_gap", number>;
  };
  // Of the sessions in the last 30 days, how many left something behind: a memory or a summary.
  coverage: { sessions: number; withMemory: number; withSummary: number; withEither: number };
  kinds: { kind: string; count: number }[];
  days: PulseDay[];
  friction: SourceCard[];
  discoveries: SourceCard[];
  recent: SourceCard[];
  projects: PulseProject[];
  // Shell commands the plugin saw in the last 7 days, by class. Signals only: a failed test run is not a blocker.
  signals: { class: string; runs: number; failed: number }[];
  unavailable: { what: string; why: string }[];
}
