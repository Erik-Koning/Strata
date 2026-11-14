// Relay: the handoffs given to me and the ones I sent, and the selected one's checkpoint. The sender reviews and
// approves a draft here; the recipient copies the command that resumes it in Claude Code. Claiming, test runs and
// completing happen in Claude Code, and show up here.
import type { Handoff, HandoffListItem, Person, SharedMemory } from "@strata/contracts";
import { ChevronLeft, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckpointBody, Continuation, NextAction } from "../../../components/relay/checkpoint.tsx";
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
      <p role="note" className="rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-[13.5px] text-danger">
        Revoked {handoff.revokedAt ? <Ago at={handoff.revokedAt} /> : null}
        {handoff.recipient ? `. ${handoff.recipient.name} can no longer read it.` : "."}
        {handoff.revokeReason ? <span className="mt-0.5 block text-ink-2">Reason: {handoff.revokeReason}</span> : null}
      </p>
    );
  if (handoff.status === "approved")
    return (
      <p className="text-[13.5px] text-ink-2">
        {party === "recipient"
          ? "Handed to you. Resume it in a fresh Claude Code session; claiming it there tells the sender you've started."
          : `Waiting for ${recipient} to resume it.`}
      </p>
    );
  if (handoff.status === "claimed")
    return (
      <p className="rounded-[10px] bg-amber-soft px-3.5 py-2.5 text-[13.5px] text-amber">
        Claimed by {recipient} {handoff.claimedAt ? <Ago at={handoff.claimedAt} /> : null}. Work continues in their
        Claude Code session; tests and completion appear here.
      </p>
    );
  return null;
}

function Checkpoint({ detail, viewerId }: { detail: Extract<Detail, { kind: "ok" }>; viewerId: string }) {
  const { handoff, party } = detail;
  const draft = handoff.status === "draft";
  const canRevoke = party === "sender" && ["draft", "approved", "claimed"].includes(handoff.status);
  const showResume = handoff.status === "approved" || handoff.status === "claimed";
  return (
    <article className="card grid gap-6 p-5 sm:p-6" aria-labelledby="handoff-title">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={handoff.status} />
            <span className="font-mono text-[12px] text-ink-3">{handoff.project}</span>
          </div>
          <h2 id="handoff-title" className="mt-2 font-semibold text-[22px] leading-tight tracking-[-0.02em]">
            {handoff.title}
          </h2>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            <span className="font-medium text-ink">{nameOf(handoff.sender, viewerId)}</span>
            <span aria-hidden className="mx-1.5 text-ink-3">
              →
            </span>
            <span className="sr-only">to</span>
            <span className={handoff.recipient ? "font-medium text-ink" : "text-ink-3"}>
              {nameOf(handoff.recipient, viewerId)}
            </span>
            <span className="text-ink-3">
              {" "}
              · drafted <Ago at={handoff.createdAt} />
            </span>
          </p>
        </div>
        {canRevoke ? (
          <RevokeControl
            key={handoff._id}
            id={handoff._id}
            status={handoff.status}
            recipient={handoff.recipient?.name ?? null}
          />
        ) : null}
      </header>

      <StatusNote handoff={handoff} party={party} viewerId={viewerId} />
      {handoff.continuation ? <Continuation handoff={handoff} /> : null}
      {showResume ? <NextAction text={handoff.nextAction} /> : null}
      {showResume ? <ResumeBlock handoff={handoff} forRecipient={party === "recipient"} /> : null}

      <section aria-labelledby="repo-title">
        <h3 id="repo-title" className="eyebrow">
          Repository at handoff
        </h3>
        <div className="mt-2">
          <RepoLine repo={handoff.repo} />
          <RepoWarning repo={handoff.repo} />
        </div>
      </section>

      {draft ? (
        <DraftEditor key={handoff._id} handoff={handoff} recipients={detail.recipients} shareable={detail.shareable} />
      ) : (
        <CheckpointBody handoff={handoff} />
      )}
      <Tests handoff={handoff} />
    </article>
  );
}

function Context({ detail, viewerId }: { detail: Extract<Detail, { kind: "ok" }>; viewerId: string }) {
  const { handoff } = detail;
  const shared = handoff.memoryIds.length;
  return (
    <>
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
      <ChangedFiles files={handoff.changedFiles} />
      {handoff.continuation?.changedFiles.length ? (
        <ChangedFiles title="Changed in the continuation" files={handoff.continuation.changedFiles} />
      ) : null}
      <Timeline handoff={handoff} viewerId={viewerId} />
    </>
  );
}

export default async function RelayPage({ searchParams }: PageProps<"/relay">) {
  const caller = await requireCaller();
  const params = await searchParams;
  const creating = one(params.new) === "1";
  const id = creating ? null : (one(params.id) ?? null);
  const [inbox, sent, detail, projects]: [HandoffListItem[], HandoffListItem[], Detail | null, string[]] =
    await Promise.all([
      listHandoffs(caller, "inbox"),
      listHandoffs(caller, "outbox"),
      id ? load(caller, id) : Promise.resolve(null),
      creating ? overview(caller.userId).then((o) => o.projects) : Promise.resolve([]),
    ]);
  const open = Boolean(id || creating);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <p className="eyebrow">Relay</p>
          <h1 className="mt-1.5 font-semibold text-[30px] leading-tight tracking-[-0.025em]">Handoffs</h1>
          <p className="mt-2 text-[15px] text-ink-2">
            Unfinished work, handed on as a checkpoint someone can verify: what's done and left, the commit it stands
            on, test evidence, and only the memories you choose to share.
          </p>
        </div>
        <Link href="/relay?new=1" className="btn" aria-current={creating ? "page" : undefined}>
          <Plus size={15} aria-hidden /> New handoff
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] min-[1380px]:grid-cols-[256px_minmax(0,1fr)_288px]">
        <nav
          aria-label="Handoffs"
          className={`lg:sticky lg:top-6 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:-mx-3 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto ${open ? "max-lg:hidden" : ""}`}
        >
          <Inbox inbox={inbox} sent={sent} selected={id} />
        </nav>

        {open ? (
          <div className="min-w-0 lg:col-start-2 lg:row-start-1">
            <Link href="/relay" className="btn btn-quiet btn-sm -ml-2.5 mb-2 min-h-11 lg:hidden">
              <ChevronLeft size={15} aria-hidden /> All handoffs
            </Link>
            {creating ? (
              <div className="card p-5 sm:p-6">
                <NewHandoff projects={projects} />
              </div>
            ) : detail?.kind === "ok" ? (
              <Checkpoint detail={detail} viewerId={caller.userId} />
            ) : (
              <div className="card px-6 py-10">
                <p className="font-semibold text-[16px]">Not available</p>
                <p className="mt-1.5 max-w-md text-[14px] text-ink-3">{detail?.message}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="max-lg:hidden lg:col-start-2 lg:row-start-1 min-[1380px]:col-span-2">
            <div className="rounded-[14px] border border-line border-dashed px-6 py-10">
              <p className="font-medium text-[15px]">Select a handoff to see its checkpoint.</p>
              <p className="mt-1.5 max-w-lg text-[14px] text-ink-3">
                Run <code className="kbd">/strata:handoff</code> in Claude Code to draft one from your session, review
                it here and approve it for a teammate, who picks it up with <code className="kbd">/strata:resume</code>.
              </p>
            </div>
          </div>
        )}

        {detail?.kind === "ok" ? (
          <aside
            aria-label="Shared context"
            className="grid min-w-0 content-start gap-6 lg:col-start-2 lg:row-start-2 min-[1380px]:col-start-3 min-[1380px]:row-start-1"
          >
            <Context detail={detail} viewerId={caller.userId} />
          </aside>
        ) : null}
      </div>
    </>
  );
}
