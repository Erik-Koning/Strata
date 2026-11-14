// Relay: the handoffs given to me and the ones I sent, and the selected one's checkpoint. The sender reviews and
// approves a draft here; the recipient copies the command that resumes it in Claude Code. Claiming, test runs and
// completing happen in Claude Code, and show up here.
import type { Handoff, HandoffListItem, Person, SharedMemory } from "@strata/contracts";
import { ChevronLeft, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckpointBody, Continuation, NextAction } from "../../../components/relay/checkpoint.tsx";
import { latestRuns, named } from "../../../components/relay/flow.tsx";
import { Inbox } from "../../../components/relay/inbox.tsx";
import { ChangedFiles, ExcludedMemories, SharedMemories } from "../../../components/relay/memories.tsx";
import { RepoLine, RepoWarning } from "../../../components/relay/repo.tsx";
import { ResumeBlock } from "../../../components/relay/resume.tsx";
import { StatusPill } from "../../../components/relay/status.tsx";
import { Disclosure, HandoffStory, lead, Outcome } from "../../../components/relay/story.tsx";
import { Tests } from "../../../components/relay/tests.tsx";
import { Timeline } from "../../../components/relay/timeline.tsx";
import {
  type Caller,
  getHandoff,
  listHandoffs,
  listRecipients,
  listShareableMemories,
  resumeHandoff,
} from "../../../server/handoffs/service.ts";
import { ApiError } from "../../../server/http.ts";
import { overview } from "../../../server/stats.ts";
import { PageHeader } from "../page-header.tsx";
import { requireCaller } from "./caller.ts";
import { DraftEditor } from "./draft-editor.tsx";
import { NewHandoff } from "./new-handoff.tsx";
import { RevokeControl } from "./revoke-control.tsx";

export const metadata: Metadata = { title: "Relay" };

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

type Detail =
  | { kind: "error"; message: string }
  | {
      kind: "ok";
      handoff: Handoff;
      party: "sender" | "recipient";
      memories: SharedMemory[] | null;
      excluded: { _id: string; reason: string }[];
      recipients: Person[];
      shareable: SharedMemory[];
    };

async function load(caller: Caller, id: string): Promise<Detail> {
  let handoff: Handoff;
  try {
    handoff = await getHandoff(caller, id);
  } catch (error) {
    if (error instanceof ApiError)
      return {
        kind: "error",
        message:
          error.status === 404
            ? "This handoff isn't available to you. It may have been revoked, or it was never shared with you."
            : error.message,
      };
    throw error;
  }
  const party = handoff.sender.id === caller.userId ? "sender" : "recipient";
  if (handoff.status === "draft") {
    const [recipients, shareable] = await Promise.all([
      listRecipients(caller),
      listShareableMemories(caller, handoff.project).catch(() => []),
    ]);
    return { kind: "ok", handoff, party, memories: null, excluded: [], recipients, shareable };
  }
  // The shared memories as they stand now, re-checked: the same read a resuming session makes. A recipient can only
  // make it while the handoff is theirs to work on.
  try {
    const resume = await resumeHandoff(caller, id);
    return {
      kind: "ok",
      handoff: resume.handoff,
      party,
      memories: resume.memories,
      excluded: resume.excluded,
      recipients: [],
      shareable: [],
    };
  } catch {
    return { kind: "ok", handoff, party, memories: null, excluded: [], recipients: [], shareable: [] };
  }
}

function Checkpoint({ detail, viewerId }: { detail: Extract<Detail, { kind: "ok" }>; viewerId: string }) {
  const { handoff, party } = detail;
  const draft = handoff.status === "draft";
  const canRevoke = party === "sender" && ["draft", "approved", "claimed"].includes(handoff.status);
  const showResume = handoff.status === "approved" || handoff.status === "claimed";
  const sender = handoff.sender.name.split(/\s+/)[0];
  const recipient = handoff.recipient?.name.split(/\s+/)[0] ?? "the recipient";
  const tests = latestRuns(handoff);
  const files = new Set([...handoff.changedFiles, ...(handoff.continuation?.changedFiles ?? [])]).size;
  const explanation = handoff.summary ? lead(handoff.summary) : null;
  const left = handoff.remaining.length;
  return (
    <article className="grid min-w-0 gap-6" aria-labelledby="handoff-title">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-ink-3">
            <StatusPill status={handoff.status} />
            <span className="font-mono text-[12.5px]">{handoff.project}</span>
            <span>
              From {named(handoff.sender, viewerId)} to{" "}
              {handoff.recipient ? named(handoff.recipient, viewerId) : "no one yet"}
            </span>
          </div>
          {canRevoke ? (
            <RevokeControl
              key={handoff._id}
              id={handoff._id}
              status={handoff.status}
              recipient={handoff.recipient?.name ?? null}
            />
          ) : null}
        </div>
        <h2
          id="handoff-title"
          className="max-w-[40ch] font-semibold text-[28px] text-ink leading-[1.12] tracking-[-0.03em] sm:text-[32px]"
        >
          {handoff.title}
        </h2>
        {explanation ? <p className="max-w-[68ch] text-[15.5px] text-ink-2 leading-relaxed">{explanation}</p> : null}
      </header>

      <HandoffStory handoff={handoff} memories={detail.memories} viewerId={viewerId} />

      <Outcome handoff={handoff}>
        {showResume ? (
          <div className="grid gap-5 rounded-[12px] bg-surface p-5 shadow-[var(--shadow)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <NextAction text={handoff.nextAction} />
            <div className="min-w-0">
              <ResumeBlock handoff={handoff} forRecipient={party === "recipient"} />
            </div>
          </div>
        ) : null}
      </Outcome>

      <div className="relay-details">
        {draft ? (
          <Disclosure title="Review and approve the draft" open hint="Only you can see this">
            <DraftEditor
              key={handoff._id}
              handoff={handoff}
              recipients={detail.recipients}
              shareable={detail.shareable}
            />
          </Disclosure>
        ) : null}
        {draft ? null : (
          <Disclosure
            title={`What ${sender} handed over`}
            hint={`${handoff.completed.length} done, ${left} to do${handoff.blockers.length ? `, ${handoff.blockers.length} blocked` : ""}`}
          >
            <CheckpointBody handoff={handoff} />
            {handoff.nextAction && !showResume ? (
              <NextAction text={handoff.nextAction} label="Next step, as handed over" />
            ) : null}
          </Disclosure>
        )}
        {draft || (handoff.status === "revoked" && !handoff.tests.length) ? null : (
          <Disclosure
            title="Test evidence"
            hint={
              handoff.tests.length
                ? `${handoff.tests.length} ${handoff.tests.length === 1 ? "run" : "runs"}${tests.named ? `, ${tests.passing} of ${tests.named} passing` : ""}`
                : "No runs yet"
            }
          >
            <Tests handoff={handoff} />
          </Disclosure>
        )}
        {handoff.continuation ? (
          <Disclosure title={`${recipient}'s session`} hint="Summary and commits">
            <Continuation handoff={handoff} />
          </Disclosure>
        ) : null}
        <Disclosure
          title="Approved memory and where it came from"
          hint={draft ? "Chosen when you approve" : `${handoff.memoryIds.length} shared`}
          id="evidence-memories"
        >
          <MemoryEvidence detail={detail} />
        </Disclosure>
        <Disclosure
          title="Repository and changed files"
          hint={files ? `${files} ${files === 1 ? "file" : "files"}` : "None listed"}
        >
          <div className="grid gap-1.5">
            <p className="text-[12.5px] text-ink-3">Repository at handoff</p>
            <RepoLine repo={handoff.repo} />
            <RepoWarning repo={handoff.repo} past={Boolean(handoff.claimedAt)} />
          </div>
          <ChangedFiles files={handoff.changedFiles} />
          {handoff.continuation?.changedFiles.length ? (
            <ChangedFiles title={`Changed in ${recipient}'s session`} files={handoff.continuation.changedFiles} />
          ) : null}
        </Disclosure>
        <Disclosure title="Activity log" hint={`${handoff.timeline.length} events`}>
          <Timeline handoff={handoff} viewerId={viewerId} />
        </Disclosure>
      </div>
    </article>
  );
}

function MemoryEvidence({ detail }: { detail: Extract<Detail, { kind: "ok" }> }) {
  const { handoff } = detail;
  const shared = handoff.memoryIds.length;
  if (handoff.status === "draft")
    return (
      <p className="text-[13.5px] text-ink-3">
        None until you approve. Tick the ones to send in the draft; each is re-checked whenever it's read.
      </p>
    );
  if (detail.memories)
    return (
      <>
        <SharedMemories memories={detail.memories} />
        <ExcludedMemories excluded={detail.excluded} />
      </>
    );
  return (
    <SharedMemories
      memories={[]}
      note={
        shared ? `${shared} shared. They're readable while the handoff is open.` : "None were shared with this handoff."
      }
    />
  );
}

// With nothing chosen, open the handoff that most wants attention: one handed to you that's waiting or underway, then
// one of yours in flight, then the latest finished one, then a draft to review. Lists arrive newest first.
function pick(inbox: HandoffListItem[], sent: HandoffListItem[]): string | null {
  const first = (items: HandoffListItem[], statuses: HandoffListItem["status"][]) =>
    items.find((h) => statuses.includes(h.status));
  return (
    (
      first(inbox, ["approved", "claimed"]) ??
      first(sent, ["claimed", "approved"]) ??
      first([...inbox, ...sent], ["completed"]) ??
      first(sent, ["draft"]) ??
      inbox[0] ??
      sent[0] ??
      null
    )?._id ?? null
  );
}

export default async function RelayPage({ searchParams }: PageProps<"/relay">) {
  const caller = await requireCaller();
  const params = await searchParams;
  const creating = one(params.new) === "1";
  const chosen = creating ? null : (one(params.id) ?? null);
  const [inbox, sent, projects]: [HandoffListItem[], HandoffListItem[], string[]] = await Promise.all([
    listHandoffs(caller, "inbox"),
    listHandoffs(caller, "outbox"),
    creating ? overview(caller.userId).then((o) => o.projects) : Promise.resolve([]),
  ]);
  // An automatic pick shows on wide screens only: on a phone the list comes first until you choose.
  const id = creating ? null : (chosen ?? pick(inbox, sent));
  const detail = id ? await load(caller, id) : null;
  const open = Boolean(chosen || creating);

  return (
    <>
      <PageHeader
        title="Handoffs"
        lede="Your teammate started it. Strata remembers it. Your agent finishes it."
        actions={
          <Link href="/relay?new=1" className="btn btn-primary btn-sm" aria-current={creating ? "page" : undefined}>
            <Plus size={14} aria-hidden /> New handoff
          </Link>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[248px_minmax(0,1fr)] xl:gap-12">
        <nav
          aria-label="Handoffs"
          className={`min-w-0 lg:sticky lg:top-6 lg:-ml-3 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto ${open ? "max-lg:hidden" : ""}`}
        >
          <Inbox inbox={inbox} sent={sent} selected={id} />
        </nav>

        {creating || detail ? (
          <div className={`min-w-0 ${open ? "" : "max-lg:hidden"}`}>
            <Link href="/relay" className="btn btn-quiet btn-sm -ml-2.5 mb-3 min-h-11 lg:hidden">
              <ChevronLeft size={15} aria-hidden /> All handoffs
            </Link>
            {creating ? (
              <div className="panel p-5 sm:p-6">
                <NewHandoff projects={projects} />
              </div>
            ) : detail?.kind === "ok" ? (
              <Checkpoint detail={detail} viewerId={caller.userId} />
            ) : (
              <div className="panel px-6 py-10">
                <p className="font-semibold text-[15px]">Not available</p>
                <p className="mt-1.5 max-w-md text-[13.5px] text-ink-3">{detail?.message}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="max-lg:hidden">
            <div className="panel px-8 py-10">
              <p className="text-[12px] text-ink-3">Checkpoint → Approved memory → Resumed → Verified completion</p>
              <p className="mt-2.5 font-semibold text-[16px]">No handoffs yet</p>
              <p className="mt-1.5 max-w-lg text-[13.5px] text-ink-3">
                Run <code className="kbd">/strata:handoff</code> in Claude Code to draft one from your session, review
                it here and approve it for a teammate, who picks it up with <code className="kbd">/strata:resume</code>.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
