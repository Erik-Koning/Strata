// Relay: the handoffs given to me and the ones I sent, and the selected one's checkpoint. The sender reviews and
// approves a draft here; the recipient copies the command that resumes it in Claude Code. Claiming, test runs and
// completing happen in Claude Code, and show up here.
import type { Handoff, HandoffListItem, Person, SharedMemory } from "@strata/contracts";
import { ChevronLeft, FileCode2, FlaskConical, History, Library, PanelRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckpointBody, Continuation, NextAction } from "../../../components/relay/checkpoint.tsx";
import { DrawerProvider, DrawerTrigger } from "../../../components/relay/drawer.tsx";
import { ContinuityFlow, latestRuns } from "../../../components/relay/flow.tsx";
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

// What travels with the handoff, as counts that open the inspector at the matching section.
function EvidenceStrip({ handoff }: { handoff: Handoff }) {
  const files = new Set([...handoff.changedFiles, ...(handoff.continuation?.changedFiles ?? [])]).size;
  const tests = latestRuns(handoff);
  const items = [
    { icon: Library, label: "Shared memories", value: handoff.memoryIds.length, target: "evidence-memories" },
    { icon: FileCode2, label: "Changed files", value: files, target: "evidence-files" },
    {
      icon: FlaskConical,
      label: "Test runs",
      value: handoff.tests.length,
      target: undefined,
      href: "#tests-title",
    },
    { icon: History, label: "Activity", value: handoff.timeline.length, target: "evidence-activity" },
  ];
  return (
    <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] border border-line bg-line xl:grid-cols-4">
      {items.map(({ icon: Icon, label, value, target, href }) => {
        const inner = (
          <>
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <Icon size={13} aria-hidden /> {label}
            </span>
            <span className="mt-1 block font-semibold text-[18px] tabular-nums tracking-[-0.02em]">
              {value}
              {label === "Test runs" && tests.named ? (
                <span className="ml-1.5 font-normal text-[12px] text-ink-3">
                  {tests.passing}/{tests.named} passing
                </span>
              ) : null}
            </span>
          </>
        );
        const cls = "block h-full w-full bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2";
        return (
          <li key={label} className="min-w-0">
            {href ? (
              <a href={href} className={cls}>
                {inner}
              </a>
            ) : (
              <DrawerTrigger target={target} className={cls}>
                {inner}
              </DrawerTrigger>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Checkpoint({ detail, viewerId }: { detail: Extract<Detail, { kind: "ok" }>; viewerId: string }) {
  const { handoff, party } = detail;
  const draft = handoff.status === "draft";
  const canRevoke = party === "sender" && ["draft", "approved", "claimed"].includes(handoff.status);
  const showResume = handoff.status === "approved" || handoff.status === "claimed";
  return (
    <DrawerProvider title={handoff.title} panel={<Context detail={detail} viewerId={viewerId} />}>
      <article className="grid min-w-0 gap-6" aria-labelledby="handoff-title">
        <header className="grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={handoff.status} />
                <span className="font-mono text-[12px] text-ink-3">{handoff.project}</span>
              </div>
              <h2
                id="handoff-title"
                className="mt-2.5 font-semibold text-[24px] leading-[1.2] tracking-[-0.025em] sm:text-[26px]"
              >
                {handoff.title}
              </h2>
              <p className="mt-1.5 text-[13px] text-ink-3">
                <span className="font-medium text-ink-2">{nameOf(handoff.sender, viewerId)}</span>
                <span aria-hidden className="mx-1.5">
                  →
                </span>
                <span className="sr-only">to</span>
                <span className={handoff.recipient ? "font-medium text-ink-2" : ""}>
                  {nameOf(handoff.recipient, viewerId)}
                </span>
                <span>
                  {" "}
                  · drafted <Ago at={handoff.createdAt} /> · updated <Ago at={handoff.updatedAt} />
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DrawerTrigger className="btn btn-sm">
                <PanelRight size={14} aria-hidden /> Evidence
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
          <ContinuityFlow handoff={handoff} viewerId={viewerId} />
          <StatusNote handoff={handoff} party={party} viewerId={viewerId} />
        </header>

        {handoff.continuation ? <Continuation handoff={handoff} /> : null}

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
        ) : handoff.nextAction && !draft ? (
          <div className="rounded-[var(--radius)] border border-line bg-surface p-5">
            <NextAction
              text={handoff.nextAction}
              label={handoff.status === "completed" ? "Next action, as handed off" : "Next action"}
            />
          </div>
        ) : null}

        {draft ? null : <EvidenceStrip handoff={handoff} />}

        <div className="panel grid gap-7 p-5 sm:p-6">
          {draft ? (
            <DraftEditor
              key={handoff._id}
              handoff={handoff}
              recipients={detail.recipients}
              shareable={detail.shareable}
            />
          ) : (
            <CheckpointBody handoff={handoff} />
          )}
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

        <div className="panel p-5 sm:p-6">
          <Tests handoff={handoff} />
        </div>
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
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-line border-b pb-5">
        <div className="min-w-0 max-w-2xl">
          <p className="eyebrow">Relay</p>
          <h1 className="mt-2 font-semibold text-[22px] leading-tight tracking-[-0.02em]">
            Engineering context, handed on intact
          </h1>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            A checkpoint someone can verify: what's done and left, the commit it stands on, test evidence, and only the
            memories you approve.
          </p>
        </div>
        <Link href="/relay?new=1" className="btn btn-primary btn-sm" aria-current={creating ? "page" : undefined}>
          <Plus size={14} aria-hidden /> New handoff
        </Link>
      </header>

      <div className="grid gap-8 lg:grid-cols-[264px_minmax(0,1fr)]">
        <nav
          aria-label="Handoffs"
          className={`min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto ${open ? "max-lg:hidden" : ""}`}
        >
          <Inbox inbox={inbox} sent={sent} selected={id} />
        </nav>

        {open ? (
          <div className="min-w-0">
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
            <div className="rounded-[var(--radius)] border border-line border-dashed px-8 py-12">
              <p className="eyebrow">Engineer A → Approved memory → Engineer B → Verified completion</p>
              <p className="mt-3 font-semibold text-[16px]">Select a handoff to see how its context moved.</p>
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
