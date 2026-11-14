"use server";
// The admin page's actions. Each one checks that the caller is an admin, on every call: a server action can be called
// without the page, so what the page showed is no guarantee.
import { revalidatePath } from "next/cache";
import { input, RefId, TeamPlace } from "../../../server/inputs.ts";
import { createInvite, inviteLink, revokeInvite, sendInviteLink } from "../../../server/invites.ts";
import { createTeam, deleteTeam, placeInTeam, Refusal, restore, setRole, suspend } from "../../../server/people.ts";
import { adminActor } from "../../../server/viewer.ts";

export interface Result {
  error: string | null;
}

async function attempt(work: () => Promise<unknown>): Promise<Result> {
  try {
    await work();
  } catch (error) {
    if (error instanceof Refusal) return { error: error.message };
    throw error;
  }
  revalidatePath("/admin");
  revalidatePath("/audit");
  return { error: null };
}

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

export interface InviteState {
  link: string | null;
  email: string;
  // Whether the link was also emailed to them (SES); the link is shown either way.
  emailed?: boolean;
  error: string | null;
}

export async function makeInvite(_: InviteState, form: FormData): Promise<InviteState> {
  const actor = await adminActor();
  const email = text(form, "email");
  try {
    const { token, invite } = await createInvite(actor, {
      email,
      role: text(form, "role"),
      teamIds: form.getAll("team").map(String),
    });
    const emailed = await sendInviteLink(invite.email, token, invite.role, actor.label);
    revalidatePath("/admin");
    return { link: inviteLink(token), email: invite.email, emailed, error: null };
  } catch (error) {
    if (error instanceof Refusal) return { link: null, email, error: error.message };
    throw error;
  }
}

export async function cancelInvite(id: string): Promise<Result> {
  const actor = await adminActor();
  const invite = input(RefId, id);
  return attempt(() => revokeInvite(actor, invite));
}

export async function changeRole(userId: string, role: string): Promise<Result> {
  const actor = await adminActor();
  const person = input(RefId, userId);
  // setRole refuses a name that isn't a role, with a message the page shows.
  const named = input(RefId, role);
  return attempt(() => setRole(actor, person, named));
}

export async function suspendPerson(userId: string): Promise<Result> {
  const actor = await adminActor();
  const person = input(RefId, userId);
  return attempt(() => suspend(actor, person));
}

export async function restorePerson(userId: string): Promise<Result> {
  const actor = await adminActor();
  const person = input(RefId, userId);
  return attempt(() => restore(actor, person));
}

export interface TeamState {
  error: string | null;
  // Bumped on each success, so the form can clear itself.
  made: number;
}

export async function addTeam(state: TeamState, form: FormData): Promise<TeamState> {
  const actor = await adminActor();
  const result = await attempt(() => createTeam(actor, text(form, "name")));
  return result.error ? { error: result.error, made: state.made } : { error: null, made: state.made + 1 };
}

export async function removeTeam(teamId: string): Promise<Result> {
  const actor = await adminActor();
  const team = input(RefId, teamId);
  return attempt(() => deleteTeam(actor, team));
}

export async function placePerson(teamId: string, userId: string, as: "member" | "manager" | null): Promise<Result> {
  const actor = await adminActor();
  const team = input(RefId, teamId);
  const person = input(RefId, userId);
  const place = TeamPlace.safeParse(as);
  if (!place.success) return { error: "Choose member or manager." };
  return attempt(() => placeInTeam(actor, team, person, place.data));
}
