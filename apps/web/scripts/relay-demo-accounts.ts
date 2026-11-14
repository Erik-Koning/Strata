// pnpm --filter @strata/web run relay:demo-accounts <out.json>: the Relay demo's three people, made the way anyone is
// (an invite, then sign-up with a password), each with an API key of their own. Run again, it reuses the accounts and
// makes fresh keys. Alice also gets two memories in the demo's project: one she'll share with the handoff, and one
// private one that must never reach Bob.
//
// The keys are written to <out.json> (keep it out of the repository). Passwords are the demo's, for signing in to the
// app as each person: DEMO_PASSWORD, or the default below.
import { writeFileSync } from "node:fs";
import { auth } from "../server/auth.ts";
import { closeMongo } from "../server/db.ts";
import { indexesReady } from "../server/indexes.ts";
import { createInvite, signUpWithInvite } from "../server/invites.ts";
import { createKey } from "../server/keys.ts";
import { saveMemory } from "../server/memory/save.ts";

const out = process.argv[2];
const project = process.argv[3] ?? "relay-demo/durations";
if (!out) {
  console.error("Usage: relay-demo-accounts.ts <out.json> [project]");
  process.exit(2);
}
const password = process.env.DEMO_PASSWORD ?? "relay-demo-password";
const CLI = { kind: "service" as const, id: "cli", label: "relay demo script" };

const PEOPLE = [
  { who: "alice", name: "Alice Archer", email: "alice@relay-demo.test", role: "engineer" },
  { who: "bob", name: "Bob Baker", email: "bob@relay-demo.test", role: "engineer" },
  { who: "mallory", name: "Mallory Moss", email: "mallory@relay-demo.test", role: "engineer" },
] as const;

try {
  await indexesReady();
  const ctx = await auth().$context;
  const result: Record<string, { id: string; name: string; email: string; key: string }> = {};
  for (const p of PEOPLE) {
    let user = (await ctx.internalAdapter.findUserByEmail(p.email))?.user;
    if (!user) {
      const { token } = await createInvite(CLI, { email: p.email, role: p.role });
      await signUpWithInvite({ token, name: p.name, password });
      user = (await ctx.internalAdapter.findUserByEmail(p.email))?.user;
    }
    if (!user) throw new Error(`couldn't make ${p.email}`);
    const { key } = await createKey(user.id, `relay demo (${p.who})`);
    result[p.who] = { id: user.id, name: user.name, email: user.email, key };
  }
  const alice = result.alice;
  let memories: { shared: string; private: string } | null = null;
  if (alice) {
    const actor = { kind: "user" as const, id: alice.id, label: alice.name };
    const scope = { org: "default", project, user: alice.id };
    const shared = await saveMemory({
      actor,
      scope,
      text: "Durations are always integer milliseconds: round once, at the end, never per part.",
      kind: "decision",
      sessionID: null,
      source: "manual",
    });
    const secret = await saveMemory({
      actor,
      scope,
      text: "Private: I'm interviewing elsewhere next week, don't mention it to the team.",
      kind: "fact",
      sessionID: null,
      source: "manual",
    });
    memories = { shared: shared._id.toHexString(), private: secret._id.toHexString() };
  }
  writeFileSync(out, `${JSON.stringify({ project, password, people: result, memories }, null, 2)}\n`, { mode: 0o600 });
  console.log(`Wrote ${Object.keys(result).length} accounts' keys to ${out} (project ${project})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeMongo();
}
