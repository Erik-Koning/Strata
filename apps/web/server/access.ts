// Who may see what. The rules, from the design (docs/about.html, "Visibility into the work, not the worker"):
//
//   - Private stays private. A person's memories, events, summaries and draft records are theirs alone: no role,
//     admins included, reads them.
//   - Approved records are for everyone with access. A person's approval is what shares a record; after that, every
//     member of the organisation can see it.
//   - A role decides what a person's home view leads with, not what they're allowed to see.
//   - Who, never how much. Views show who worked on an area, never counts, rankings or comparisons of people, and no
//     activity: no time, no last-seen, no prompt history.
//
// The admin role adds running the install: people, roles, teams and invitations.
export const ROLES = ["engineer", "manager", "exec", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  engineer: "Engineer",
  manager: "Manager",
  exec: "Executive",
  admin: "Admin",
};

// What each role's home view leads with, as the invite form and the people list say it.
export const ROLE_HINTS: Record<Role, string> = {
  engineer: "Leads with the pain points and context gaps in their products. Everyone sees every approved record.",
  manager: "Leads with their teams' features and who worked on them: approved summaries, never counts or rankings.",
  exec: "Leads with progress and updates across every product.",
  admin: "Also runs the install: people, roles, teams and invitations.",
};

// What a role's home view puts first.
export type Focus = "friction" | "teams" | "progress";
export const HOME_FOCUS: Record<Role, Focus> = {
  engineer: "friction",
  manager: "teams",
  exec: "progress",
  admin: "progress",
};

export const isRole = (value: unknown): value is Role =>
  typeof value === "string" && (ROLES as readonly string[]).includes(value);

export interface Access {
  userId: string;
  role: Role;
  suspended: boolean;
  // The teams this person manages: where a manager's home view starts.
  manages: string[];
}

export const can = {
  // Run the install: people, roles, teams, invitations.
  administer: (a: Access): boolean => !a.suspended && a.role === "admin",
  // Approved, shared records: everyone in the organisation.
  seeApproved: (a: Access): boolean => !a.suspended,
  // Someone's own memories, events, summaries and drafts: that person, and nobody else, whatever their role.
  seePrivate: (a: Access, ownerId: string): boolean => !a.suspended && a.userId === ownerId,
};
