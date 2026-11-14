// Who's looking: the signed-in person, from their session. Every page and server action starts here.
import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth.ts";

export interface Viewer {
  userId: string;
  name: string;
  email: string;
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth()
    .api.getSession({ headers: await headers() })
    .catch(() => null);
  if (!session) return null;
  return { userId: session.user.id, name: session.user.name, email: session.user.email };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  return viewer;
}
