// Relay: the handoffs given to me and the ones I sent, and the selected one's checkpoint. The sender reviews and
// approves a draft here; the recipient copies the command that resumes it in Claude Code. Claiming, test runs and
// completing happen in Claude Code, and show up here.
import type { Handoff, HandoffListItem, Person, SharedMemory } from "@strata/contracts";
import { ArrowRight, ChevronLeft, Library, PanelRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckpointBody, Continuation, NextAction } from "../../../components/relay/checkpoint.tsx";
import { DrawerProvider, DrawerTrigger } from "../../../components/relay/drawer.tsx";
import { Avatar, ContinuityTrack, JourneyStep, latestRuns, named, stagesOf } from "../../../components/relay/flow.tsx";
import { Inbox } from "../../../components/relay/inbox.tsx";
import { ChangedFiles, ExcludedMemories, SharedMemories } from "../../../components/relay/memories.tsx";
import { RepoLine, RepoWarning } from "../../../components/relay/repo.tsx";
import { ResumeBlock } from "../../../components/relay/resume.tsx";
import { nameOf, StatusPill } from "../../../components/relay/status.tsx";
import { Tests } from "../../../components/relay/tests.tsx";
import { Timeline } from "../../../components/relay/timeline.tsx";
import { Ago } from "../../../components/time.tsx";
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

function StatusNote({
  handoff,
  party,
  viewerId,
}: {
  handoff: Handoff;
  party: "sender" | "recipient";
  viewerId: string;
}) {
  const recipient = nameOf(handoff.recipient, viewerId);
  if (handoff.status === "revoked")
    return (
      <p role="note" className="rounded-[var(--radius)] bg-danger-soft px-4 py-3 text-[13.5px] text-danger">
        Revoked {handoff.revokedAt ? <Ago at={handoff.revokedAt} /> : null}
        {handoff.recipient ? `. ${handoff.recipient.name} can no longer read it.` : "."}
        {handoff.revokeReason ? <span className="mt-0.5 block text-ink-2">Reason: {handoff.revokeReason}</span> : null}
      </p>
    );
  if (handoff.status === "approved")
    return (
      <p className="text-[13px] text-ink-2">
        {party === "recipient"
          ? "Handed to you. Resume it in a fresh Claude Code session; claiming it there tells the sender you've started."
          : `Waiting for ${recipient} to resume it.`}
      </p>
    );
  if (handoff.status === "claimed")
    return (
      <p className="text-[13px] text-amber">
        Claimed by {recipient} {handoff.claimedAt ? <Ago at={handoff.claimedAt} /> : null}. Work continues in their
        Claude Code session; tests and completion appear here.
      </p>
    );
  return null;
}

// Sender → recipient, as people: who handed it on, and who it's for.
function People({ handoff, viewerId }: { handoff: Handoff; viewerId: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
      <span className="inline-flex items-center gap-2">
        <Avatar person={handoff.sender} side="sender" />
        <span className="font-medium text-ink">{named(handoff.sender, viewerId)}</span>
      </span>
      <ArrowRight size={14} className="mx-0.5 text-ink-3" aria-label="to" />
      <span className="inline-flex items-center gap-2">
        <Avatar person={handoff.recipient} side="recipient" />
        <span className={handoff.recipient ? "font-medium text-ink" : "text-ink-3"}>
          {handoff.recipient ? named(handoff.recipient, viewerId) : "No recipient yet"}
        </span>
      </span>
      <span className="text-ink-3">
        <span aria-hidden className="mx-1">
          ·
        </span>
        updated <Ago at={handoff.updatedAt} />
      </span>
    </p>
  );
}

// The memories released at approval, inline: the words themselves, with provenance one click away in the inspector.
function Released({ detail }: { detail: Extract<Detail, { kind: "ok" }> }) {
  const { handoff, memories, excluded } = detail;
  if (!handoff.approvedAt) return null;
  if (!memories)
    return (
      <p className="text-[13px] text-ink-3">
        {handoff.memoryIds.length
          ? `${handoff.memoryIds.length} shared. They're readable while the handoff is open.`
          : "None were shared with this handoff."}
      </p>
    );
  if (!memories.length && !excluded.length) return <p className="text-[13px] text-ink-3">None were shared.</p>;
  return (
    <div className="grid gap-2">
      {memories.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius)] border border-line bg-surface">
          {memories.map((m) => (
            <li key={m._id} className="flex items-start gap-3 px-4 py-3">
              <Library size={14} className="mt-[3px] flex-none text-accent-text" aria-hidden />
              <p className="min-w-0 flex-1 text-[13.5px] text-ink leading-snug">{m.text}</p>
              <span className="flex-none text-[11.5px] text-ink-3 capitalize">{m.kind}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-3 text-[12.5px] text-ink-3">
        <span>Re-checked each time it's read, so an archived or edited memory never travels.</span>
        {excluded.length ? <span className="text-amber">{excluded.length} left out since approval</span> : null}
        <DrawerTrigger target="evidence-memories" className="text-accent-text underline-offset-4 hover:underline">
          Provenance →
        </DrawerTrigger>
      </p>
    </div>
  );
}

function Journey({
  detail,
  viewerId,
  showResume,
}: {
  detail: Extract<Detail, { kind: "ok" }>;
  viewerId: string;
  showResume: boolean;
}) {
  const { handoff } = detail;
  const stages = stagesOf(handoff, viewerId);
  const sender = named(handoff.sender, viewerId);
  const recipient = handoff.recipient ? named(handoff.recipient, viewerId) : "the recipient";
  const verified = handoff.continuation?.verified === true;
  const revoked = handoff.status === "revoked";
  const claim = handoff.continuation?.claimRepo ?? null;
  const shared = handoff.memoryIds.length;
  const tests = latestRuns(handoff);
  const files = new Set([...handoff.changedFiles, ...(handoff.continuation?.changedFiles ?? [])]).size;
  return (
    <ol aria-label="Journey" className="grid">
      <JourneyStep
        stage={stages.checkpoint}
        index={0}
        headline={`${sender} checkpointed unfinished work`}
        aside={
          files ? (
            <DrawerTrigger target="evidence-files" className="hover:text-ink">
              {files} {files === 1 ? "file" : "files"}
            </DrawerTrigger>
          ) : null
        }
      >
        <CheckpointBody handoff={handoff} />
        {handoff.nextAction && !showResume ? (
          <div className="rounded-[var(--radius)] border border-line bg-surface px-4 py-3.5">
            <NextAction text={handoff.nextAction} label="Next action, as handed off" />
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <p className="text-[12px] text-ink-3">Repository at handoff</p>
          <RepoLine repo={handoff.repo} />
          <RepoWarning repo={handoff.repo} past={Boolean(handoff.claimedAt)} />
        </div>
      </JourneyStep>

      <JourneyStep
        stage={stages.memory}
        index={1}
        headline={
          handoff.approvedAt
            ? `${handoff.sender.id === viewerId ? "You" : handoff.sender.name} released ${shared} ${shared === 1 ? "memory" : "memories"} to ${recipient}`
            : revoked
              ? "Revoked before approval"
              : "Nothing is shared until the sender approves"
        }
      >
        {handoff.approvedAt ? <Released detail={detail} /> : null}
      </JourneyStep>

      <JourneyStep
        stage={stages.resume}
        index={2}
        headline={
          handoff.claimedAt
            ? `${recipient} resumed in a fresh session`
            : revoked
              ? handoff.approvedAt
                ? "Revoked before anyone resumed it"
                : "Never handed on"
              : handoff.status === "approved"
                ? `Waiting for ${recipient} to resume it`
                : "Not resumed yet"
        }
      >
        {claim ? (
          <div className="grid gap-1.5">
            <p className="text-[12px] text-ink-3">Repository at claim</p>
            <RepoLine repo={claim} />
          </div>
        ) : null}
      </JourneyStep>

      <JourneyStep
        stage={stages.complete}
        index={3}
        last
        headline={
          handoff.completedAt
            ? verified
              ? `${recipient} completed it, tests verified`
              : `${recipient} reported it complete`
            : revoked
              ? "Stopped when it was revoked"
              : handoff.status === "claimed"
                ? "In progress in Claude Code"
                : "Not complete"
        }
        aside={tests.named ? `${tests.passing}/${tests.named} passing` : null}
      >
        {handoff.continuation ? <Continuation handoff={handoff} /> : null}
        {revoked && !handoff.tests.length ? null : <Tests handoff={handoff} />}
      </JourneyStep>
    </ol>
  );
}

function Checkpoint({ detail, viewerId }: { detail: Extract<Detail, { kind: "ok" }>; viewerId: string }) {
  const { handoff, party } = detail;
  const draft = handoff.status === "draft";
  const canRevoke = party === "sender" && ["draft", "approved", "claimed"].includes(handoff.status);
  const showResume = handoff.status === "approved" || handoff.status === "claimed";
  const evidence = handoff.memoryIds.length + handoff.changedFiles.length + handoff.timeline.length;
  return (
    <DrawerProvider title={handoff.title} panel={<Context detail={detail} viewerId={viewerId} />}>
      <article className="grid min-w-0 gap-8" aria-labelledby="handoff-title">
        <header className="grid gap-5">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={handoff.status} />
                <span className="font-mono text-[12px] text-ink-3">{handoff.project}</span>
              </div>
              <h2
                id="handoff-title"
                className="mt-2.5 max-w-[52ch] font-semibold text-[23px] leading-[1.2] tracking-[-0.022em] sm:text-[25px]"
              >
                {handoff.title}
              </h2>
              <div className="mt-3">
                <People handoff={handoff} viewerId={viewerId} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DrawerTrigger className="btn btn-sm">
                <PanelRight size={14} aria-hidden /> Evidence
                {evidence ? <span className="count">{evidence}</span> : null}
              </DrawerTrigger>
              {canRevoke ? (
                <RevokeControl
                  key={handoff._id}
                  id={handoff._id}
                  status={handoff.status}
                  recipient={handoff.recipient?.name ?? null}
                />
              ) : null}
            </div>
          </div>
          <div className="rounded-[var(--radius)] border border-line bg-surface px-5 pt-4 pb-3">
            <ContinuityTrack handoff={handoff} viewerId={viewerId} />
          </div>
          <StatusNote handoff={handoff} party={party} viewerId={viewerId} />
        </header>

        {showResume ? (
          <section
            aria-label="Pick it up"
            className="grid gap-px overflow-hidden rounded-[var(--radius)] border border-accent/25 bg-accent/15 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
          >
            <div className="bg-surface p-5">
              <NextAction text={handoff.nextAction} />
            </div>
            <div className="min-w-0 bg-surface p-5">
              <ResumeBlock handoff={handoff} forRecipient={party === "recipient"} />
            </div>
          </section>
        ) : null}

        {draft ? (
          <div className="panel grid gap-7 p-5 sm:p-6">
            <DraftEditor
              key={handoff._id}
              handoff={handoff}
              recipients={detail.recipients}
              shareable={detail.shareable}
            />
            <section aria-labelledby="repo-title" className="border-line border-t pt-6">
              <h3 id="repo-title" className="eyebrow">
                Repository at handoff
              </h3>
              <div className="mt-2">
                <RepoLine repo={handoff.repo} />
                <RepoWarning repo={handoff.repo} />
              </div>
            </section>
          </div>
        ) : (
          <Journey detail={detail} viewerId={viewerId} showResume={showResume} />
        )}
      </article>
    </DrawerProvider>
  );
}

function Context({ detail, viewerId }: { detail: Extract<Detail, { kind: "ok" }>; viewerId: string }) {
  const { handoff } = detail;
  const shared = handoff.memoryIds.length;
  return (
    <>
      <div id="evidence-memories" className="grid gap-5">
        {handoff.status === "draft" ? (
          <section>
            <h3 className="eyebrow">Shared memories</h3>
            <p className="mt-2 text-[13px] text-ink-3">
              None until you approve. Tick the ones to send in the draft; each is re-checked whenever it's read.
            </p>
          </section>
        ) : detail.memories ? (
          <>
            <SharedMemories memories={detail.memories} />
            <ExcludedMemories excluded={detail.excluded} />
          </>
        ) : (
          <SharedMemories
            memories={[]}
            note={
              shared
                ? `${shared} shared. They're readable while the handoff is open.`
                : "None were shared with this handoff."
            }
          />
        )}
      </div>
      <div id="evidence-files" className="grid gap-5">
        <ChangedFiles files={handoff.changedFiles} />
        {handoff.continuation?.changedFiles.length ? (
          <ChangedFiles title="Changed in the continuation" files={handoff.continuation.changedFiles} />
        ) : null}
      </div>
      <div id="evidence-activity">
        <Timeline handoff={handoff} viewerId={viewerId} />
      </div>
    </>
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
        eyebrow="Relay"
        title="Engineering context, handed on intact"
        lede="A checkpoint a teammate can verify: what's done and left, the commit, test evidence, and only the memories you approve."
        actions={
          <Link href="/relay?new=1" className="btn btn-primary btn-sm" aria-current={creating ? "page" : undefined}>
            <Plus size={14} aria-hidden /> New handoff
          </Link>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[272px_minmax(0,1fr)] xl:gap-10">
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
