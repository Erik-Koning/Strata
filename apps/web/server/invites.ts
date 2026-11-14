// Invitations: the only way to get an account. An admin (or `pnpm invite`, for the first admin) makes one for an email
// and a role; the link works once, for that email, for a week. Only the token's SHA-256 is kept, as with API keys.
import { createHash, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { isRole } from "./access.ts";
import { audit } from "./audit.ts";
import { auth } from "./auth.ts";
import { type InviteDoc, invites, teams } from "./collections.ts";
import { config } from "./config.ts";
import { type Actor, Refusal, startMember } from "./people.ts";

export const INVITE_DAYS = 7;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const inviteHash = (token: string): string => createHash("sha256").update(token).digest("hex");
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
export const inviteLink = (token: string): string => `${config().baseURL}/sign-up?invite=${encodeURIComponent(token)}`;

export async function createInvite(
  actor: Actor,
  input: { email: string; role: string; teamIds?: string[] },
): Promise<{ token: string; invite: InviteDoc }> {
  const email = normalizeEmail(input.email);
  if (!EMAIL.test(email) || email.length > 254) throw new Refusal("Enter an email address.");
  if (!isRole(input.role)) throw new Refusal("Choose a role.");
  const teamIds = [...new Set(input.teamIds ?? [])];
  if (teamIds.some((id) => !ObjectId.isValid(id)) || teamIds.length > 50)
    throw new Refusal("Choose teams from the list.");
  if (teamIds.length) {
    const found = await teams().countDocuments({ _id: { $in: teamIds.map((id) => new ObjectId(id)) } });
    if (found !== teamIds.length) throw new Refusal("One of those teams doesn't exist any more.");
  }
  const ctx = await auth().$context;
  if (await ctx.internalAdapter.findUserByEmail(email))
    throw new Refusal("There's already an account for that email. Change their role on the people list instead.");

  const now = new Date();
  // One live link per email: a new invite replaces any earlier one still open.
  const replaced = await invites().updateMany(
    { email, acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now } },
  );
  const token = `inv_${randomBytes(24).toString("base64url")}`;
  const invite: InviteDoc = {
    _id: new ObjectId(),
    email,
    role: input.role,
    teamIds,
    hash: inviteHash(token),
    createdBy: actor,
    createdAt: now,
    expiresAt: new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000),
    acceptedAt: null,
    acceptedBy: null,
    revokedAt: null,
  };
  await invites().insertOne(invite);
  await audit({
    actor,
    action: "invite.create",
    targetIds: [invite._id.toHexString()],
    scope: null,
    detail: { email, role: invite.role, teams: teamIds.length, replaced: replaced.modifiedCount },
  });
  return { token, invite };
}

const open = (now = new Date()) => ({ acceptedAt: null, revokedAt: null, expiresAt: { $gt: now } });

export async function findOpenInvite(token: string): Promise<InviteDoc | null> {
  if (!token.startsWith("inv_") || token.length > 100) return null;
  return invites().findOne({ hash: inviteHash(token), ...open() });
}

export const listOpenInvites = (): Promise<InviteDoc[]> =>
  invites().find(open()).sort({ createdAt: -1 }).limit(200).toArray();

export async function revokeInvite(actor: Actor, id: string): Promise<void> {
  if (!ObjectId.isValid(id)) return;
  const invite = await invites().findOneAndUpdate(
    { _id: new ObjectId(id), ...open() },
    { $set: { revokedAt: new Date() } },
  );
  if (invite)
    await audit({ actor, action: "invite.revoke", targetIds: [id], scope: null, detail: { email: invite.email } });
}

// Making the account an invite is for. The email is the invite's, whatever the form said; the role and the teams come
// with it. Better Auth's own sign-up route is closed (auth.ts), so this is the only way in.
export async function signUpWithInvite(input: {
  token: string;
  name: string;
  password: string;
  headers?: Headers;
}): Promise<{ userId: string; email: string }> {
  const invite = await findOpenInvite(input.token);
  if (!invite)
    throw new Refusal("This invite link has expired, was revoked, or was already used. Ask an admin for a new one.");
  const { user } = await auth().api.signUpEmail({
    body: { name: input.name, email: invite.email, password: input.password },
    headers: input.headers ?? new Headers(),
  });
  // Claimed once: a second use of the same link finds it accepted.
  const claimed = await invites().findOneAndUpdate(
    { _id: invite._id, acceptedAt: null, revokedAt: null },
    { $set: { acceptedAt: new Date(), acceptedBy: user.id } },
  );
  if (claimed) {
    await startMember(user.id, invite.role);
    if (invite.teamIds.length)
      await teams().updateMany(
        { _id: { $in: invite.teamIds.map((id) => new ObjectId(id)) } },
        invite.role === "manager" ? { $addToSet: { managerIds: user.id } } : { $addToSet: { memberIds: user.id } },
      );
    await audit({
      actor: { kind: "user", id: user.id, label: user.name },
      action: "invite.accept",
      targetIds: [invite._id.toHexString(), user.id],
      scope: null,
      detail: { email: invite.email, role: invite.role },
    });
  }
  return { userId: user.id, email: invite.email };
}
