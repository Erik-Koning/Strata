// People, roles, teams and invitations, through Better Auth and the app's own collections, on a database of their own
// on MONGODB_URI's server, dropped afterwards.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const name = `am_people_${randomBytes(4).toString("hex")}`;
const base = process.env.MONGODB_URI ?? "mongodb://localhost:9317/?directConnection=true";
process.env.MONGODB_URI = base.replace(/\/([^/?]*)(\?|$)/, `/${name}$2`);
process.env.MEMORY_AI_PROVIDER = "stub";

const { db, closeMongo } = await import("../server/db.ts");
const { ensureIndexes } = await import("../server/indexes.ts");
const { auth } = await import("../server/auth.ts");
const { config } = await import("../server/config.ts");
const { createInvite, signUpWithInvite, findOpenInvite, revokeInvite, inviteLink } = await import(
  "../server/invites.ts"
);
const people = await import("../server/people.ts");
const { createKey } = await import("../server/keys.ts");
const { apiKeys, audits, invites, teams } = await import("../server/collections.ts");

const CLI = { kind: "service" as const, id: "cli", label: "command line" };
const PASSWORD = "correct horse battery";
let n = 0;
const email = (who: string) => `${who}.${++n}@example.com`;

async function join(address: string, role: string, teamIds: string[] = []) {
  const { token } = await createInvite(CLI, { email: address, role, teamIds });
  const { userId } = await signUpWithInvite({ token, name: address.split(".")[0] ?? "x", password: PASSWORD });
  return userId;
}
const actor = (id: string) => ({ kind: "user" as const, id, label: "an admin" });
const signIn = (address: string) =>
  auth().api.signInEmail({ body: { email: address, password: PASSWORD }, headers: new Headers() });

beforeAll(async () => {
  await ensureIndexes();
});
afterAll(async () => {
  await db().dropDatabase();
  await closeMongo();
});

describe("sign-up is by invitation only", () => {
  it("closes Better Auth's own sign-up route", async () => {
    const res = await auth().handler(
      new Request(`${config().baseURL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: config().baseURL },
        body: JSON.stringify({ name: "Mallory", email: "mallory@example.com", password: PASSWORD }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("refuses an account no invite was made for, whatever path asks", async () => {
    await expect(
      auth().api.signUpEmail({
        body: { name: "Mallory", email: "mallory@example.com", password: PASSWORD },
        headers: new Headers(),
      }),
    ).rejects.toThrow();
    await expect(signUpWithInvite({ token: "inv_made_up_token", name: "M", password: PASSWORD })).rejects.toThrow(
      people.Refusal,
    );
  });

  it("makes the account the invite is for, with its role and teams, once", async () => {
    const team = await people.createTeam(CLI, "Payments");
    const address = email("Grace").toUpperCase();
    const { token, invite } = await createInvite(CLI, {
      email: address,
      role: "manager",
      teamIds: [team._id.toHexString()],
    });
    expect(inviteLink(token)).toBe(`${config().baseURL}/sign-up?invite=${token}`);
    expect(invite.hash).not.toContain(token.slice(4));
    const { userId, email: made } = await signUpWithInvite({ token, name: "Grace", password: PASSWORD });
    expect(made).toBe(address.toLowerCase());
    const access = await people.accessFor(userId);
    expect(access).toMatchObject({ role: "manager", suspended: false, manages: [team._id.toHexString()] });
    expect((await invites().findOne({ _id: invite._id }))?.acceptedBy).toBe(userId);
    expect(await audits().countDocuments({ action: "invite.accept", targetIds: userId })).toBe(1);
    // The same link again: used.
    await expect(signUpWithInvite({ token, name: "Grace again", password: PASSWORD })).rejects.toThrow(people.Refusal);
  });

  it("puts anyone but a manager in their teams as a member", async () => {
    const team = await people.createTeam(CLI, "Platform");
    const userId = await join(email("ada"), "engineer", [team._id.toHexString()]);
    const stored = await teams().findOne({ _id: team._id });
    expect(stored?.memberIds).toContain(userId);
    expect(stored?.managerIds).not.toContain(userId);
  });

  it("keeps one live link per email, and none once revoked or expired", async () => {
    const address = email("lin");
    const first = await createInvite(CLI, { email: address, role: "engineer" });
    const second = await createInvite(CLI, { email: address, role: "exec" });
    expect(await findOpenInvite(first.token)).toBeNull();
    expect((await findOpenInvite(second.token))?.role).toBe("exec");
    await revokeInvite(CLI, second.invite._id.toHexString());
    expect(await findOpenInvite(second.token)).toBeNull();
    const third = await createInvite(CLI, { email: address, role: "engineer" });
    await invites().updateOne({ _id: third.invite._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await findOpenInvite(third.token)).toBeNull();
  });

  it("refuses an invite for an email that has an account, a bad email, a role that isn't one", async () => {
    const address = email("taken");
    await join(address, "engineer");
    await expect(createInvite(CLI, { email: address, role: "engineer" })).rejects.toThrow(/already an account/);
    await expect(createInvite(CLI, { email: "not-an-email", role: "engineer" })).rejects.toThrow(people.Refusal);
    await expect(createInvite(CLI, { email: email("x"), role: "owner" })).rejects.toThrow(people.Refusal);
  });
});

describe("roles", () => {
  it("never lets the last admin go", async () => {
    await db().collection("members").deleteMany({ role: "admin" });
    const first = await join(email("first"), "admin");
    await expect(people.setRole(actor("someone"), first, "engineer")).rejects.toThrow(/at least one admin/);
    await expect(people.suspend(actor("someone"), first)).rejects.toThrow(/at least one admin/);
    const second = await join(email("second"), "engineer");
    await people.setRole(actor(first), second, "admin");
    await people.setRole(actor(second), first, "engineer");
    expect((await people.accessFor(first)).role).toBe("engineer");
    expect(await audits().countDocuments({ action: "member.role", targetIds: first })).toBe(1);
  });

  it("lets only managers manage a team, and keeps a demoted manager in it as a member", async () => {
    const team = await people.createTeam(CLI, "Growth");
    const teamId = team._id.toHexString();
    const engineer = await join(email("eng"), "engineer");
    await expect(people.placeInTeam(CLI, teamId, engineer, "manager")).rejects.toThrow(/make them a Manager/);
    await people.setRole(CLI, engineer, "manager");
    await people.placeInTeam(CLI, teamId, engineer, "manager");
    expect((await people.accessFor(engineer)).manages).toEqual([teamId]);
    await people.setRole(CLI, engineer, "engineer");
    const stored = await teams().findOne({ _id: team._id });
    expect(stored?.managerIds).not.toContain(engineer);
    expect(stored?.memberIds).toContain(engineer);
    await people.placeInTeam(CLI, teamId, engineer, null);
    expect((await teams().findOne({ _id: team._id }))?.memberIds).not.toContain(engineer);
  });

  it("refuses two teams with the same name, whatever the case", async () => {
    await people.createTeam(CLI, "Search");
    await expect(people.createTeam(CLI, "  search ")).rejects.toThrow(/already a team/);
  });
});

describe("suspending someone", () => {
  it("ends their sessions, revokes their keys, and stops them signing in until restored", async () => {
    const address = email("sus");
    const userId = await join(address, "engineer");
    await createKey(userId, "laptop");
    await signIn(address);
    const { internalAdapter } = await auth().$context;
    expect((await internalAdapter.listSessions(userId)).length).toBeGreaterThan(0);

    await people.suspend(actor("an-admin"), userId);
    expect((await people.accessFor(userId)).suspended).toBe(true);
    expect(await apiKeys().countDocuments({ userId, revokedAt: null })).toBe(0);
    expect(await internalAdapter.listSessions(userId)).toHaveLength(0);
    // Past the password check, refused at the session: the sign-in form tells them they're suspended.
    await expect(signIn(address)).rejects.toMatchObject({ body: { code: "FAILED_TO_CREATE_SESSION" } });
    expect(await people.isSuspendedEmail(address.toUpperCase())).toBe(true);

    await people.restore(actor("an-admin"), userId);
    expect(await people.isSuspendedEmail(address)).toBe(false);
    await expect(signIn(address)).resolves.toBeTruthy();
    // Keys stay revoked: they make new ones.
    expect(await apiKeys().countDocuments({ userId, revokedAt: null })).toBe(0);
  });

  it("can't be done to yourself", async () => {
    const userId = await join(email("self"), "admin");
    await expect(people.suspend(actor(userId), userId)).rejects.toThrow(/yourself/);
  });
});

describe("the people list", () => {
  it("shows who people are and what they can reach: nothing they remember, no activity", async () => {
    const team = await people.createTeam(CLI, "Data");
    const userId = await join(email("list"), "exec", [team._id.toHexString()]);
    await createKey(userId, "desktop");
    const person = (await people.listPeople()).find((p) => p.id === userId);
    expect(person).toMatchObject({ role: "exec", suspended: false, liveKeys: 1 });
    expect(person?.teams).toEqual([{ id: team._id.toHexString(), name: "Data", manager: false }]);
    expect(Object.keys(person ?? {}).sort()).toEqual(
      ["email", "id", "joinedAt", "liveKeys", "name", "role", "suspended", "teams"].sort(),
    );
  });
});

describe("the admins' audit log", () => {
  it("shows changes to access, and nothing people did in their own memory", async () => {
    const { orgAuditTrail } = await import("../server/stats.ts");
    const { audit } = await import("../server/audit.ts");
    const someone = actor("person-1");
    await audit({ actor: someone, action: "memory.save", targetIds: ["m1"], scope: null, detail: { kind: "fact" } });
    await audit({ actor: someone, action: "memory.forget", targetIds: ["m1"], scope: null, detail: {} });
    await audit({ actor: someone, action: "key.create", targetIds: ["k1"], scope: null, detail: { name: "laptop" } });
    await people.createTeam(CLI, "Audit check");
    const actions = new Set((await orgAuditTrail(1000)).map((e) => e.action));
    expect(actions.has("team.create")).toBe(true);
    expect(actions.has("invite.accept")).toBe(true);
    for (const own of ["memory.save", "memory.forget", "memory.compress", "memory.promote", "key.create"])
      expect(actions.has(own as never)).toBe(false);
  });
});
