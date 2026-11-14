// Who's looking: the signed-in person, from their session, with their role. Every page and server action starts here.
// A suspended person is treated as signed out.
import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "./access.ts";
import { auth } from "./auth.ts";
import { type Actor, accessFor } from "./people.ts";

export interface Viewer {
  userId: string;
  name: string;
  email: string;
  role: Role;
  // The teams this person manages.
  manages: string[];
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth()
    .api.getSession({ headers: await headers() })
    .catch(() => null);
  if (!session) return null;
  const access = await accessFor(session.user.id);
  if (access.suspended) return null;
  return {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: access.role,
    manages: access.manages,
  };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  return viewer;
}

// For admin pages: anyone else gets a 404, as if the page weren't there.
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.role !== "admin") notFound();
  return viewer;
}

// For admin server actions, which can be called without the page: checked on every call, whatever the page showed.
export async function adminActor(): Promise<Actor> {
  const viewer = await getViewer();
  if (viewer?.role !== "admin") throw new Error("Only an admin can do that.");
  return { kind: "user", id: viewer.userId, label: viewer.name };
}
