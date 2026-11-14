// People and teams: who has an account, their role, the teams they're in, and an admin's changes to any of it. Every
// change goes in the audit log. Nothing here reads anyone's memory, events or summaries.
import { MongoServerError, ObjectId } from "mongodb";
import { type Access, isRole, ROLE_LABELS, type Role } from "./access.ts";
import { audit } from "./audit.ts";
import { auth } from "./auth.ts";
import { type AuditDoc, apiKeys, members, type TeamDoc, teams } from "./collections.ts";

export type Actor = AuditDoc["actor"];

// A refusal the page shows as it is: the person asked for something the rules don't allow.
export class Refusal extends Error {}

const adapter = async () => (await auth().$context).internalAdapter;

export async function accessFor(userId: string): Promise<Access> {
  const [member, managed] = await Promise.all([
    members().findOne({ _id: userId }),
    teams()
      .find({ managerIds: userId }, { projection: { _id: 1 } })
      .toArray(),
  ]);
  return {
    userId,
    role: member?.role ?? "engineer",
    suspended: Boolean(member?.suspendedAt),
    manages: managed.map((t) => t._id.toHexString()),
  };
}

// Whether the account for an email is suspended. The sign-in form asks only once the password has been checked.
export async function isSuspendedEmail(email: string): Promise<boolean> {
  const found = await (await adapter()).findUserByEmail(email.trim().toLowerCase()).catch(() => null);
  return found ? (await accessFor(found.user.id)).suspended : false;
}

// Sets the role a new account starts with (the invite's).
export async function startMember(userId: string, role: Role): Promise<void> {
  const now = new Date();
  await members().updateOne(
    { _id: userId },
    { $set: { role, updatedAt: now }, $setOnInsert: { suspendedAt: null, createdAt: now } },
    { upsert: true },
  );
}

async function mustExist(userId: string): Promise<{ id: string; name: string; email: string }> {
  const user = await (await adapter()).findUserById(userId).catch(() => null);
  if (!user) throw new Refusal("There's no account with that id.");
  return user;
}

// An install always keeps one admin who can act: the last one can't be demoted or suspended.
async function isLastAdmin(userId: string): Promise<boolean> {
  const access = await accessFor(userId);
  if (access.role !== "admin" || access.suspended) return false;
  return (await members().countDocuments({ role: "admin", suspendedAt: null, _id: { $ne: userId } })) === 0;
}

const LAST_ADMIN = "There has to be at least one admin. Make someone else an admin first.";

export async function setRole(actor: Actor, userId: string, role: string): Promise<void> {
  if (!isRole(role)) throw new Refusal("That isn't a role.");
  const user = await mustExist(userId);
  const before = (await accessFor(userId)).role;
  if (before === role) return;
  if (await isLastAdmin(userId)) throw new Refusal(LAST_ADMIN);
  const now = new Date();
  await members().updateOne(
    { _id: userId },
    { $set: { role, updatedAt: now }, $setOnInsert: { suspendedAt: null, createdAt: now } },
    { upsert: true },
  );
  // Only managers manage teams: someone who stops being one stays in those teams as a member.
  let stoppedManaging = 0;
  if (role !== "manager") {
    const managed = await teams().find({ managerIds: userId }).toArray();
    stoppedManaging = managed.length;
    if (managed.length)
      await teams().updateMany(
        { managerIds: userId },
        { $pull: { managerIds: userId }, $addToSet: { memberIds: userId } },
      );
  }
  await audit({
    actor,
    action: "member.role",
    targetIds: [userId],
    scope: null,
    detail: { name: user.name, from: before, to: role, stoppedManaging },
  });
}

// Cuts someone off at once: their sessions end, their API keys are revoked, and they can't sign in again until an
// admin restores them. Restoring doesn't bring the keys back; they make new ones.
export async function suspend(actor: Actor, userId: string): Promise<void> {
  if (actor.id === userId) throw new Refusal("You can't suspend yourself.");
  const user = await mustExist(userId);
  if ((await accessFor(userId)).suspended) return;
  if (await isLastAdmin(userId)) throw new Refusal(LAST_ADMIN);
  const now = new Date();
  await members().updateOne(
    { _id: userId },
    { $set: { suspendedAt: now, updatedAt: now }, $setOnInsert: { role: "engineer", createdAt: now } },
    { upsert: true },
  );
  const [keys] = await Promise.all([
    apiKeys().updateMany({ userId, revokedAt: null }, { $set: { revokedAt: now } }),
    (await adapter()).deleteUserSessions(userId),
  ]);
  await audit({
    actor,
    action: "member.suspend",
    targetIds: [userId],
    scope: null,
    detail: { name: user.name, keysRevoked: keys.modifiedCount },
  });
}

export async function restore(actor: Actor, userId: string): Promise<void> {
  const user = await mustExist(userId);
  const result = await members().updateOne(
    { _id: userId, suspendedAt: { $ne: null } },
    { $set: { suspendedAt: null, updatedAt: new Date() } },
  );
  if (result.modifiedCount)
    await audit({ actor, action: "member.restore", targetIds: [userId], scope: null, detail: { name: user.name } });
}

export interface Person {
  id: string;
  name: string;
  email: string;
  joinedAt: Date;
  role: Role;
  suspended: boolean;
  teams: { id: string; name: string; manager: boolean }[];
  liveKeys: number;
}

// Everyone with an account, for the admin page: who they are and what they can reach. Never what they remember, and
// no activity: not when they last connected, not how much they use it.
export async function listPeople(): Promise<Person[]> {
  const users = await (await adapter()).listUsers(1000, 0, { field: "createdAt", direction: "asc" });
  const ids = users.map((u) => u.id);
  const [memberDocs, teamDocs, keyStats] = await Promise.all([
    members()
      .find({ _id: { $in: ids } })
      .toArray(),
    teams().find({}).sort({ name: 1 }).toArray(),
    apiKeys()
      .aggregate<{ _id: string; live: number }>([
        { $match: { userId: { $in: ids } } },
        {
          $group: {
            _id: "$userId",
            live: { $sum: { $cond: [{ $eq: ["$revokedAt", null] }, 1, 0] } },
          },
        },
      ])
      .toArray(),
  ]);
  const memberBy = new Map(memberDocs.map((m) => [m._id, m]));
  const keysBy = new Map(keyStats.map((k) => [k._id, k]));
  return users.map((u) => {
    const member = memberBy.get(u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      joinedAt: new Date(u.createdAt),
      role: member?.role ?? "engineer",
      suspended: Boolean(member?.suspendedAt),
      teams: teamDocs
        .filter((t) => t.managerIds.includes(u.id) || t.memberIds.includes(u.id))
        .map((t) => ({ id: t._id.toHexString(), name: t.name, manager: t.managerIds.includes(u.id) })),
      liveKeys: keysBy.get(u.id)?.live ?? 0,
    };
  });
}

// Names for the people an audit entry mentions: an account's id, or an API key's id, to its owner's name.
export async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const users = await (await adapter()).listUsers(1000, 0);
  const byUser = new Map(users.map((u) => [u.id, u.name]));
  const keyIds = ids.filter((id) => !byUser.has(id) && ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const keys = keyIds.length
    ? await apiKeys()
        .find({ _id: { $in: keyIds } }, { projection: { userId: 1 } })
        .toArray()
    : [];
  const names = new Map(byUser);
  for (const k of keys) {
    const owner = byUser.get(k.userId);
    if (owner) names.set(k._id.toHexString(), owner);
  }
  return names;
}

// Teams

export const listTeams = (): Promise<TeamDoc[]> => teams().find({}).sort({ name: 1 }).toArray();

export async function createTeam(actor: Actor, rawName: string): Promise<TeamDoc> {
  const name = rawName.replace(/\s+/g, " ").trim();
  if (!name || name.length > 60) throw new Refusal("Give the team a name of 1 to 60 characters.");
  const team: TeamDoc = { _id: new ObjectId(), name, memberIds: [], managerIds: [], createdAt: new Date() };
  try {
    await teams().insertOne(team);
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000)
      throw new Refusal(`There's already a team called “${name}”.`);
    throw error;
  }
  await audit({ actor, action: "team.create", targetIds: [team._id.toHexString()], scope: null, detail: { name } });
  return team;
}

async function mustFindTeam(teamId: string): Promise<TeamDoc> {
  const team = ObjectId.isValid(teamId) ? await teams().findOne({ _id: new ObjectId(teamId) }) : null;
  if (!team) throw new Refusal("That team doesn't exist any more.");
  return team;
}

export async function deleteTeam(actor: Actor, teamId: string): Promise<void> {
  const team = await mustFindTeam(teamId);
  await teams().deleteOne({ _id: team._id });
  await audit({ actor, action: "team.delete", targetIds: [teamId], scope: null, detail: { name: team.name } });
}

// Puts someone in a team as a member or a manager, or takes them out (null). Only people whose role is Manager can
// manage a team.
export async function placeInTeam(
  actor: Actor,
  teamId: string,
  userId: string,
  as: "member" | "manager" | null,
): Promise<void> {
  const team = await mustFindTeam(teamId);
  const user = await mustExist(userId);
  if (as === "manager") {
    const { role } = await accessFor(userId);
    if (role !== "manager") throw new Refusal(`${user.name} is ${ROLE_LABELS[role]}: make them a Manager first.`);
  }
  const update =
    as === "manager"
      ? { $addToSet: { managerIds: userId }, $pull: { memberIds: userId } }
      : as === "member"
        ? { $addToSet: { memberIds: userId }, $pull: { managerIds: userId } }
        : { $pull: { memberIds: userId, managerIds: userId } };
  await teams().updateOne({ _id: team._id }, update);
  await audit({
    actor,
    action: "team.member",
    targetIds: [teamId, userId],
    scope: null,
    detail: { team: team.name, name: user.name, as },
  });
}
