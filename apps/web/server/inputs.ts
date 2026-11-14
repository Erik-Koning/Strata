// What server actions accept. A server action is an endpoint: anyone signed in can call it with any arguments, whatever
// the page's types say, so each action reads its arguments through `input` and a value the page would never send is
// refused before it reaches the database. The rules come from the contract where the API has the same one, so a page
// and the API can't disagree about what's valid.
import { ObjectIdHex } from "@strata/contracts";
import { z } from "zod";

export class InvalidInput extends Error {}

export function input<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new InvalidInput(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "),
    );
  return parsed.data;
}

// The memories a person picked on the Memories page. Ids that aren't ids are dropped, as the page never sends them;
// anything that isn't a list is refused.
export const MemoryIds = z
  .array(z.unknown())
  .transform((ids) => ids.filter((id): id is string => ObjectIdHex.safeParse(id).success).slice(0, 500));

// Keeping a candidate, or archiving a memory: the only two changes the Memories page offers.
export const StatusChange = z.object({ id: ObjectIdHex, status: z.enum(["active", "archived"]) });

// A person, a team, an invitation or a key, by the id the page was given. Some are Better Auth's ids, not ObjectIds, so
// only the type and the length are checked here; the function that looks it up refuses one that doesn't exist.
export const RefId = z.string().min(1).max(200);

// Where an admin puts someone in a team; null takes them out.
export const TeamPlace = z.enum(["member", "manager"]).nullable();
