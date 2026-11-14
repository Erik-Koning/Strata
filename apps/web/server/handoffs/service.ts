// Strata Relay's handoffs: the only code that reads or changes them. The HTTP routes (routes.ts) and the app's pages
// both come through here, so the rules hold whichever way a person asks:
//
//   - A draft is its sender's alone. Approving names one recipient, who can read it from then until it's revoked.
//   - Anyone else, an id that doesn't exist, and a recipient asking for a draft or a revoked handoff all get the same
//     404: nothing says whether the handoff exists. Each such attempt is in the audit log as "handoff.denied".
//   - A party who can read it, asking for something only the other party may do, gets 403; a step the handoff's status
//     doesn't allow gets 409. Every transition is one findOneAndUpdate that names the status it expects, so two requests
//     racing can't both move it.
//   - Memories shared with a handoff are the sender's own, checked when approved and again on every resume.
//   - Free text is redacted before it's stored. Every change is on the handoff's timeline and in the audit log.
import {
  ApproveHandoffRequest,
  ClaimHandoffRequest,
  CompleteHandoffRequest,
  CreateHandoffRequest,
  type Handoff,
  type HandoffFields,
  type HandoffListItem,
  type Person,
  RecordTestRequest,
  type RepoState,
  type ResumeResponse,
  RevokeHandoffRequest,
  redact,
  renderResume,
  type SharedMemory,
  type TimelineAction,
  UpdateHandoffRequest,
} from "@strata/contracts";
import { type Filter, ObjectId, type UpdateFilter } from "mongodb";
import { actorOf, DEFAULT_ORG, type Principal } from "../api-auth.ts";
import { audit } from "../audit.ts";
import { auth } from "../auth.ts";
import { type AuditDoc, type HandoffDoc, handoffs, type MemoryDoc, members, memories } from "../collections.ts";
import { ApiError, check } from "../http.ts";
import { accessFor } from "../people.ts";
import {
  type Action,
  canRead,
  canResume,
  exclusionFor,
  isVerified,
  type Party,
  partyOf,
  RECIPIENT_VISIBLE,
  RULES,
  testerFor,
} from "./lifecycle.ts";
import { toHandoff, toListItem, toSharedMemory } from "./serialize.ts";

// The person acting, with the audit actor their request is logged as (their API key, or their session on the app).
export interface Caller {
  userId: string;
  name: string;
  email: string | null;
  actor: AuditDoc["actor"];
}

const adapter = async () => (await auth().$context).internalAdapter;

export async function callerFromPrincipal(p: Principal): Promise<Caller> {
  if (p.kind !== "key")
    throw new ApiError(403, "forbidden", "Handoffs need a person's API key: the service token acts for no one.");
  const user = await (await adapter()).findUserById(p.userId).catch(() => null);
  if (!user) throw new ApiError(401, "unauthorized", "That API key's account doesn't exist any more.");
  if ((await accessFor(user.id)).suspended) throw new ApiError(403, "suspended", "This account is suspended.");
  return { userId: user.id, name: user.name, email: user.email ?? null, actor: actorOf(p) };
}

const personOf = (c: Caller): Person => ({ id: c.userId, name: c.name, email: c.email });

const notFound = () => new ApiError(404, "not_found", "There's no handoff with that id that you can see.");
const HEX_ID = /^[a-f0-9]{24}$/;

type Entry = HandoffDoc["timeline"][number];
const entry = (c: Caller, action: TimelineAction, detail: Record<string, unknown>, at: Date): Entry => ({
  at,
  actor: personOf(c),
  action,
  detail,
});

async function record(c: Caller, action: AuditDoc["action"], doc: HandoffDoc, detail: Record<string, unknown> = {}) {
  await audit({
    actor: c.actor,
    action,
    targetIds: [doc._id.toHexString()],
    scope: { org: doc.org, project: doc.project },
    detail: { by: c.userId, title: doc.title, ...detail },
  });
}

// The handoff, if this person may see it; otherwise the one 404, and a "handoff.denied" entry in the audit log.
async function readable(c: Caller, id: string): Promise<{ doc: HandoffDoc; party: Party }> {
  const doc = HEX_ID.test(id) ? await handoffs().findOne({ _id: new ObjectId(id), org: DEFAULT_ORG }) : null;
  const party = doc ? partyOf(doc, c.userId) : null;
  if (!doc || !party || !canRead(doc, c.userId)) {
    await audit({
      actor: c.actor,
      action: "handoff.denied",
      targetIds: [id.slice(0, 64)],
      scope: null,
      detail: {
        by: c.userId,
        why: !doc ? "no such handoff" : party ? `recipient, while ${doc.status}` : "not a party",
      },
    });
    throw notFound();
  }
  return { doc, party };
}

const DONE: Record<Action, string> = {
  edit: "edited",
  approve: "approved",
  claim: "claimed",
  complete: "completed",
  revoke: "revoked",
};

function mustBe(doc: HandoffDoc, party: Party, action: Action): void {
  const rule = RULES[action];
  if (rule.party !== party) throw new ApiError(403, "forbidden", `Only the handoff's ${rule.party} can ${action} it.`);
  if (!rule.from.includes(doc.status))
    throw new ApiError(409, "conflict", `This handoff is ${doc.status}: it can't be ${DONE[action]} now.`);
}

// One transition: applied only if the handoff is still in the status it was read in (and matches `also`).
async function apply(
  doc: HandoffDoc,
  e: Entry,
  update: { set?: Partial<HandoffDoc>; push?: Record<string, unknown>; addToSet?: Record<string, unknown> },
  also: Filter<HandoffDoc> = {},
): Promise<HandoffDoc> {
  const change = {
    $set: { ...update.set, updatedAt: e.at },
    $push: { ...update.push, timeline: e },
    ...(update.addToSet ? { $addToSet: update.addToSet } : {}),
  } as UpdateFilter<HandoffDoc>;
  const after = await handoffs().findOneAndUpdate({ _id: doc._id, status: doc.status, ...also }, change, {
    returnDocument: "after",
  });
  if (!after) throw new ApiError(409, "conflict", "This handoff changed while you were acting on it. Load it again.");
  return after;
}

// Redaction, before anything is stored.
const lines = (xs: string[]): string[] => xs.map((x) => redact(x));
const unique = (xs: string[]): string[] => [...new Set(xs)];
const cleanRepo = (r: RepoState): RepoState => ({ ...r, url: r.url === null ? null : redact(r.url) });

type Fields = Omit<HandoffFields, "project">;
function cleanFields(f: Partial<Fields>): Partial<HandoffDoc> {
  const out: Partial<HandoffDoc> = {};
  if (f.title !== undefined) out.title = redact(f.title);
  if (f.summary !== undefined) out.summary = redact(f.summary);
  if (f.nextAction !== undefined) out.nextAction = redact(f.nextAction);
  for (const key of ["completed", "remaining", "blockers", "failedApproaches", "decisions", "changedFiles"] as const)
    if (f[key] !== undefined) out[key] = lines(f[key]);
  if (f.testCommands !== undefined) out.testCommands = unique(lines(f.testCommands));
  if (f.repo !== undefined) out.repo = cleanRepo(f.repo);
  if (f.sourceSessionID !== undefined) out.sourceSessionID = f.sourceSessionID;
  return out;
}

// Creating and editing a draft

export async function createHandoff(c: Caller, input: CreateHandoffRequest): Promise<Handoff> {
  const f = check(CreateHandoffRequest, input);
  const now = new Date();
  const doc: HandoffDoc = {
    _id: new ObjectId(),
    org: DEFAULT_ORG,
    project: f.project,
    title: "",
    summary: "",
    completed: [],
    remaining: [],
    blockers: [],
    failedApproaches: [],
    decisions: [],
    changedFiles: [],
    nextAction: "",
    testCommands: [],
    ...cleanFields(f),
    repo: f.repo ? cleanRepo(f.repo) : null,
    sourceSessionID: f.sourceSessionID,
    status: "draft",
    sender: personOf(c),
    recipient: null,
    memoryIds: [],
    tests: [],
    continuation: null,
    timeline: [entry(c, "created", {}, now)],
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    claimedAt: null,
    completedAt: null,
    revokedAt: null,
    revokeReason: null,
  };
  await handoffs().insertOne(doc);
  await record(c, "handoff.create", doc);
  return toHandoff(doc);
}

export async function updateHandoff(c: Caller, id: string, patch: UpdateHandoffRequest): Promise<Handoff> {
  const { doc, party } = await readable(c, id);
  mustBe(doc, party, "edit");
  const parsed = check(UpdateHandoffRequest, patch);
  // The contract fills defaults in for fields a patch leaves out: only the ones it names change.
  const named = new Set(Object.keys(patch ?? {}));
  const given = Object.fromEntries(Object.entries(parsed).filter(([k]) => named.has(k))) as Partial<Fields>;
  const set = cleanFields(given);
  const fields = Object.keys(set);
  if (!fields.length) throw new ApiError(400, "invalid", "Name at least one field to change.");
  const after = await apply(doc, entry(c, "edited", { fields }, new Date()), { set });
  await record(c, "handoff.edit", after, { fields });
  return toHandoff(after);
}

// Approving: one recipient, and the sender's own memories to share

async function findRecipient(c: Caller, body: { recipientId?: string; recipientEmail?: string }): Promise<Person> {
  const a = await adapter();
  const user = body.recipientId
    ? await a.findUserById(body.recipientId).catch(() => null)
    : ((await a.findUserByEmail((body.recipientEmail ?? "").trim().toLowerCase()).catch(() => null))?.user ?? null);
  if (!user) throw new ApiError(400, "bad_recipient", "There's no account for that recipient.");
  if (user.id === c.userId) throw new ApiError(400, "bad_recipient", "You can't hand work off to yourself.");
  if ((await accessFor(user.id)).suspended)
    throw new ApiError(400, "bad_recipient", `${user.name}'s account is suspended: pick someone else.`);
  return { id: user.id, name: user.name, email: user.email ?? null };
}

const live = (now: Date) => ({ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });

export async function approveHandoff(c: Caller, id: string, body: ApproveHandoffRequest): Promise<Handoff> {
  const { doc, party } = await readable(c, id);
  mustBe(doc, party, "approve");
  const b = check(ApproveHandoffRequest, body);
  const recipient = await findRecipient(c, b);
  const ids = unique(b.memoryIds);
  const now = new Date();
  const found = ids.length
    ? await memories()
        .find(
          {
            _id: { $in: ids.map((m) => new ObjectId(m)) },
            "scope.org": doc.org,
            "scope.user": c.userId,
            "scope.project": { $in: [doc.project, "*"] },
            status: "active",
            ...live(now),
          },
          { projection: { _id: 1 } },
        )
        .toArray()
    : [];
  const ok = new Set(found.map((m) => m._id.toHexString()));
  const bad = ids.find((m) => !ok.has(m));
  // The same answer whether the memory is someone else's, gone, or not active: nothing about others' memory leaks.
  if (bad)
    throw new ApiError(
      400,
      "bad_memory",
      `Memory ${bad} isn't one of your active memories in ${doc.project}, so it can't be shared.`,
    );
  const after = await apply(doc, entry(c, "approved", { recipient: recipient.id, memories: ids.length }, now), {
    set: { status: "approved", recipient, memoryIds: ids.map((m) => new ObjectId(m)), approvedAt: now },
  });
  await record(c, "handoff.approve", after, { recipient: recipient.id, memoryIds: ids });
  return toHandoff(after);
}

// Reading

export async function listHandoffs(c: Caller, box: "inbox" | "outbox" | "all"): Promise<HandoffListItem[]> {
  const outbox: Filter<HandoffDoc> = { "sender.id": c.userId };
  const inbox: Filter<HandoffDoc> = { "recipient.id": c.userId, status: { $in: [...RECIPIENT_VISIBLE] } };
  const filter: Filter<HandoffDoc> = {
    org: DEFAULT_ORG,
    ...(box === "outbox" ? outbox : box === "inbox" ? inbox : { $or: [outbox, inbox] }),
  };
  const docs = await handoffs().find(filter).sort({ updatedAt: -1 }).limit(200).toArray();
  return docs.map(toListItem);
}

export async function getHandoff(c: Caller, id: string): Promise<Handoff> {
  return toHandoff((await readable(c, id)).doc);
}

// The memories shared with a handoff, as they stand now. A correction stands in for the memory it superseded.
async function sharedNow(
  doc: HandoffDoc,
): Promise<{ memories: SharedMemory[]; excluded: { _id: string; reason: string }[] }> {
  const owner = { org: doc.org, user: doc.sender.id };
  const now = new Date();
  const docs = doc.memoryIds.length
    ? await memories()
        .find({ _id: { $in: doc.memoryIds } }, { projection: { embedding: 0 } })
        .toArray()
    : [];
  const byId = new Map(docs.map((m) => [m._id.toHexString(), m]));
  const out: SharedMemory[] = [];
  const excluded: { _id: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const oid of doc.memoryIds) {
    const id = oid.toHexString();
    const m = byId.get(id) ?? null;
    let reason: string | null = exclusionFor(m, owner, now);
    let use: MemoryDoc | null = reason === null ? m : null;
    if (m && reason === "superseded") {
      use = await activeReplacement(m, owner, now);
      if (use) reason = null;
    }
    if (!use || reason) {
      excluded.push({ _id: id, reason: reason ?? "forgotten" });
      continue;
    }
    const key = use._id.toHexString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toSharedMemory(use, key === id ? null : id));
  }
  return { memories: out, excluded };
}

// Follows a chain of corrections (each new memory names the one it supersedes) to the one that's active now.
async function activeReplacement(
  m: MemoryDoc,
  owner: { org: string; user: string },
  now: Date,
): Promise<MemoryDoc | null> {
  let current = m;
  for (let hop = 0; hop < 10; hop++) {
    const next = await memories().findOne(
      { supersedes: current._id, "scope.org": owner.org, "scope.user": owner.user },
      { projection: { embedding: 0 }, sort: { createdAt: -1 } },
    );
    if (!next) return null;
    const reason = exclusionFor(next, owner, now);
    if (reason === null) return next;
    if (reason !== "superseded") return null;
    current = next;
  }
  return null;
}

export async function resumeHandoff(c: Caller, id: string): Promise<ResumeResponse> {
  const { doc, party } = await readable(c, id);
  if (!canResume(doc.status, party))
    throw new ApiError(409, "conflict", `This handoff is ${doc.status}: there's nothing to resume.`);
  const shared = await sharedNow(doc);
  // Each shared memory that has dropped out goes on the timeline once, so the sender sees what the recipient didn't get.
  const noted = new Set(
    doc.timeline.filter((e) => e.action === "memory_excluded").map((e) => String(e.detail.memoryId)),
  );
  const fresh = shared.excluded.filter((e) => !noted.has(e._id));
  let current = doc;
  if (fresh.length) {
    const now = new Date();
    current =
      (await handoffs().findOneAndUpdate(
        {
          _id: doc._id,
          timeline: {
            $not: {
              $elemMatch: { action: "memory_excluded", "detail.memoryId": { $in: fresh.map((e) => e._id) } },
            },
          },
        },
        {
          $push: {
            timeline: {
              $each: fresh.map((e) => entry(c, "memory_excluded", { memoryId: e._id, reason: e.reason }, now)),
            },
          },
        },
        { returnDocument: "after" },
      )) ??
      (await handoffs().findOne({ _id: doc._id })) ??
      doc;
  }
  const handoff = toHandoff(current);
  await record(c, "handoff.read", current, {
    party,
    memories: shared.memories.map((m) => m._id),
    excluded: shared.excluded,
  });
  return {
    handoff,
    memories: shared.memories,
    excluded: shared.excluded,
    context: renderResume(handoff, shared.memories),
  };
}

// The recipient's side

export async function claimHandoff(c: Caller, id: string, body: ClaimHandoffRequest): Promise<Handoff> {
  const { doc, party } = await readable(c, id);
  if (party === "recipient" && doc.status === "claimed") return toHandoff(doc);
  mustBe(doc, party, "claim");
  const b = check(ClaimHandoffRequest, body);
  const now = new Date();
  const claimRepo = cleanRepo(b.repo);
  const after = await apply(
    doc,
    entry(c, "claimed", { sessionID: b.sessionID, branch: claimRepo.branch, commit: claimRepo.commit }, now),
    {
      set: {
        status: "claimed",
        claimedAt: now,
        continuation: {
          sessionID: b.sessionID,
          summary: "",
          completed: [],
          changedFiles: [],
          claimRepo,
          repo: null,
          verified: false,
        },
      },
    },
  );
  await record(c, "handoff.claim", after, { sessionID: b.sessionID });
  return toHandoff(after);
}

export async function recordTest(c: Caller, id: string, body: RecordTestRequest): Promise<Handoff> {
  const { doc, party } = await readable(c, id);
  const by = testerFor(doc.status, party);
  if (!by)
    throw new ApiError(
      409,
      "conflict",
      party === "sender"
        ? `The sender records tests while the handoff is a draft; this one is ${doc.status}.`
        : `The recipient records tests once they've claimed the handoff; this one is ${doc.status}.`,
    );
  const t = check(RecordTestRequest, body);
  const command = redact(t.command);
  const known = doc.testCommands.includes(command);
  if (by === "recipient" && !known)
    throw new ApiError(400, "unknown_command", `\`${command}\` isn't one of this handoff's test commands.`);
  if (by === "sender" && !known && doc.testCommands.length >= 10)
    throw new ApiError(400, "invalid", "A handoff has at most 10 test commands.");
  const now = new Date();
  const run: HandoffDoc["tests"][number] = {
    command,
    status: t.status,
    exitCode: t.exitCode,
    output: redact(t.output),
    durationMs: t.durationMs,
    commit: t.commit,
    verified: t.verified,
    by,
    at: now,
  };
  const after = await apply(
    doc,
    entry(c, "test", { command, status: t.status, verified: t.verified, by }, now),
    { push: { tests: run }, ...(by === "sender" ? { addToSet: { testCommands: command } } : {}) },
    by === "recipient" ? { testCommands: command } : {},
  );
  await record(c, "handoff.test", after, { command, status: t.status, verified: t.verified, as: by });
  return toHandoff(after);
}

export async function completeHandoff(c: Caller, id: string, body: CompleteHandoffRequest): Promise<Handoff> {
  let { doc, party } = await readable(c, id);
  mustBe(doc, party, "complete");
  const b = check(CompleteHandoffRequest, body);
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date();
    const verified = isVerified(doc.testCommands, doc.tests, doc.claimedAt);
    const continuation: NonNullable<HandoffDoc["continuation"]> = {
      sessionID: b.sessionID ?? doc.continuation?.sessionID ?? null,
      summary: redact(b.summary),
      completed: lines(b.completed),
      changedFiles: lines(b.changedFiles),
      claimRepo: doc.continuation?.claimRepo ?? null,
      repo: cleanRepo(b.repo),
      verified,
    };
    try {
      // Verified against exactly the runs read: a test recorded meanwhile sends it round again.
      const after = await apply(
        doc,
        entry(c, "completed", { verified }, now),
        { set: { status: "completed", completedAt: now, continuation } },
        { tests: { $size: doc.tests.length } },
      );
      await record(c, "handoff.complete", after, { verified });
      return toHandoff(after);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      ({ doc, party } = await readable(c, id));
      mustBe(doc, party, "complete");
    }
  }
  throw new ApiError(409, "conflict", "This handoff kept changing while you completed it. Try again.");
}

// The sender's way out: cuts the recipient off at once.

export async function revokeHandoff(c: Caller, id: string, body: RevokeHandoffRequest): Promise<Handoff> {
  const { doc, party } = await readable(c, id);
  if (party === "sender" && doc.status === "revoked") return toHandoff(doc);
  mustBe(doc, party, "revoke");
  const b = check(RevokeHandoffRequest, body);
  const reason = redact(b.reason);
  const now = new Date();
  const after = await apply(doc, entry(c, "revoked", { reason, from: doc.status }, now), {
    set: { status: "revoked", revokedAt: now, revokeReason: reason || null },
  });
  await record(c, "handoff.revoke", after, { reason, from: doc.status });
  return toHandoff(after);
}

// For the approve form

export async function listRecipients(c: Caller): Promise<Person[]> {
  const [users, suspended] = await Promise.all([
    (await adapter()).listUsers(1000, 0),
    members()
      .find({ suspendedAt: { $ne: null } }, { projection: { _id: 1 } })
      .toArray(),
  ]);
  const out = new Set(suspended.map((m) => m._id));
  return users
    .filter((u) => u.id !== c.userId && !out.has(u.id))
    .map((u) => ({ id: u.id, name: u.name, email: u.email ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listShareableMemories(c: Caller, project: string): Promise<SharedMemory[]> {
  const p = project.trim();
  if (!p || p.length > 200) throw new ApiError(400, "invalid", "Name the project.");
  const docs = await memories()
    .find(
      {
        "scope.org": DEFAULT_ORG,
        "scope.user": c.userId,
        "scope.project": { $in: [p, "*"] },
        status: "active",
        ...live(new Date()),
      },
      { projection: { embedding: 0 } },
    )
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
  return docs.map((m) => toSharedMemory(m));
}
