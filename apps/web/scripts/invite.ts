// pnpm invite <email> [role]: an invite link, made from the command line. This is how the first admin gets in: only
// someone who holds the database's credentials can run it. Everyone after that is invited from the People page.
// The role defaults to admin. The link uses BETTER_AUTH_URL (or http://localhost:PORT), so set that to the address
// people will open.
import { isRole, ROLES } from "../server/access.ts";
import { closeMongo } from "../server/db.ts";
import { indexesReady } from "../server/indexes.ts";
import { createInvite, INVITE_DAYS, inviteLink } from "../server/invites.ts";
import { Refusal } from "../server/people.ts";

const [email, role = "admin"] = process.argv.slice(2);
if (!email || !isRole(role)) {
  console.error(`Usage: pnpm invite <email> [${ROLES.join("|")}]   (the role defaults to admin)`);
  process.exit(2);
}
try {
  await indexesReady();
  const { token, invite } = await createInvite(
    { kind: "service", id: "cli", label: "the command line" },
    { email, role },
  );
  console.log(`Invite for ${invite.email} as ${invite.role}. It works once and expires in ${INVITE_DAYS} days:\n`);
  console.log(`  ${inviteLink(token)}\n`);
} catch (error) {
  console.error(error instanceof Refusal ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeMongo();
}
