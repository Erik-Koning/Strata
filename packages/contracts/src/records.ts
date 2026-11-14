// A reviewed record: what the server drafts from a session's versioned events, and only its author sees until they
// approve or discard it. Approved insights and workflow findings are copied into memories for later recall.
import { z } from "zod";
import type { Ref } from "./schemas.ts";

export const RECORD_KINDS = ["summary", "insight", "workflow", "pain_point", "context_gap"] as const;
export const RECORD_STATUSES = ["draft", "approved", "discarded"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export interface RecordView {
  _id: string;
  kind: RecordKind;
  status: RecordStatus;
  title: string | null;
  text: string;
  refs: Ref[];
  sessionID: string;
  project: string;
  edited: boolean;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
}

export const RecordUpdate = z
  .object({
    title: z.string().max(200).optional(),
    text: z.string().min(1).max(4000).optional(),
  })
  .refine((body) => body.title !== undefined || body.text !== undefined, { message: "title or text, one of them" });
export type RecordUpdate = z.infer<typeof RecordUpdate>;

export const RecordQuery = z.object({
  status: z.enum(RECORD_STATUSES).optional(),
  kind: z.enum(RECORD_KINDS).optional(),
  sessionID: z.string().max(200).optional(),
  project: z.string().max(200).optional(),
});
export type RecordQuery = z.infer<typeof RecordQuery>;

// What the model (or the stub) produces before the server stores it.
export interface DraftRecord {
  kind: RecordKind;
  title?: string;
  text: string;
  refs?: Ref[];
}
