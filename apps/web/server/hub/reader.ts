// Who is reading the hub, and whether they may. Every hub function takes the viewer (the page's Viewer, or an account
// id) and checks it here, whatever the page already checked: approved work is for everyone in the organisation who
// isn't suspended (access.ts), and a suspended person reads nothing.

import { cache } from "react";
import { type Access, can } from "../access.ts";
import { accessFor, Refusal } from "../people.ts";

export type ViewerRef = string | { userId: string };

export const viewerIdOf = (viewer: ViewerRef): string => (typeof viewer === "string" ? viewer : viewer.userId);

// The viewer's access when they may read approved work, else null.
// Looked up once per request: a page calls many hub functions, each checking the viewer, and every lookup is a round
// trip to the database. React's cache keeps it for one server render or action only, so a change is seen next request.
const accessOnce = cache((id: string) => accessFor(id));

export async function reader(viewer: ViewerRef): Promise<Access | null> {
  const id = viewerIdOf(viewer);
  if (!id) return null;
  const access = await accessOnce(id);
  return can.seeApproved(access) ? access : null;
}

// For writes: the viewer's access, or a refusal the page shows as it is.
export async function writer(viewer: ViewerRef): Promise<Access> {
  const access = await reader(viewer);
  if (!access) throw new Refusal("This account can't change anything here.");
  return access;
}
