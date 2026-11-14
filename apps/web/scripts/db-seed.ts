// pnpm db:seed: made-up memories for the governance UI and the harness, for one made-up person, so the pages have
// something to show. Idempotent: the same text in the same scope is kept once.
import { closeMongo } from "../server/db.ts";
import { ensureIndexes } from "../server/indexes.ts";
import { addMemory } from "../server/memory/store.ts";

const user = process.env.SEED_USER ?? "seed-user";
const scope = (project: string) => ({ org: "default", user, project });
const seeds = [
  { project: "*", kind: "preference", text: "Use pnpm, never npm or yarn.", status: "active" },
  {
    project: "*",
    kind: "convention",
    text: "Tests sit next to the code they test, named *.test.ts.",
    status: "active",
  },
  {
    project: "acme/web",
    kind: "decision",
    text: "Auth is Better Auth on MongoDB; no third-party identity provider.",
    status: "active",
  },
  {
    project: "acme/web",
    kind: "fact",
    text: "Staging deploys from the release branch, not from main.",
    status: "active",
  },
  {
    project: "acme/web",
    kind: "convention",
    text: "The assistant suggested keeping API handlers under 80 lines.",
    status: "candidate",
  },
] as const;

await ensureIndexes();
let made = 0;
for (const s of seeds) {
  const { created } = await addMemory({
    scope: scope(s.project),
    kind: s.kind,
    text: s.text,
    status: s.status,
    trust: s.status === "active" ? "explicit" : "inferred",
    confidence: s.status === "active" ? 0.85 : 0.45,
    provenance: { sessionID: null, messageID: null, eventId: null, source: "seed" },
  });
  if (created) made++;
}
console.log(`db:seed: ${made} memories added for ${user}`);
await closeMongo();
