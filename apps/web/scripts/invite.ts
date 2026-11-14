// pnpm invite <email> [role]: how the first admin gets in. Only someone who holds the database's credentials can run
// it; everyone after that is invited from the People page. The role defaults to admin.
//
// An email with no account gets an invite link (it uses BETTER_AUTH_URL, or http://localhost:PORT, so set that to the
// address people will open). An email that already has an account, made before sign-up was by invitation, gets the
// role directly: otherwise an install whose people all signed up first could never have an admin.
import { isRole, ROLE_LABELS, ROLES } from "../server/access.ts";
import { auth } from "../server/auth.ts";
import { closeMongo } from "../server/db.ts";
import { indexesReady } from "../server/indexes.ts";
import { createInvite, INVITE_DAYS, inviteLink, normalizeEmail } from "../server/invites.ts";
import { Refusal, setRole } from "../server/people.ts";

const CLI = { kind: "service" as const, id: "cli", label: "the command line" };

const [email, role = "admin"] = process.argv.slice(2);
if (!email || !isRole(role)) {
  console.error(`Usage: pnpm invite <email> [${ROLES.join("|")}]   (the role defaults to admin)`);
  process.exit(2);
}
try {
  await indexesReady();
  const existing = await (await auth().$context).internalAdapter.findUserByEmail(normalizeEmail(email));
  if (existing) {
    await setRole(CLI, existing.user.id, role);
    console.log(`${existing.user.email} already has an account: their role is now ${ROLE_LABELS[role]}.`);
  } else {
    const { token, invite } = await createInvite(CLI, { email, role });
    console.log(`Invite for ${invite.email} as ${invite.role}. It works once and expires in ${INVITE_DAYS} days:\n`);
    console.log(`  ${inviteLink(token)}\n`);
  }
} catch (error) {
  console.error(error instanceof Refusal ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeMongo();
}
