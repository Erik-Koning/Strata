import { describe, expect, it } from "vitest";
import { type Access, can, HOME_FOCUS, isRole, ROLES } from "../server/access.ts";

const person = (role: Access["role"], extra: Partial<Access> = {}): Access => ({
  userId: "u1",
  role,
  suspended: false,
  manages: [],
  ...extra,
});

describe("who may see what", () => {
  it("keeps a person's private memory theirs alone, whatever the role", () => {
    for (const role of ROLES) {
      expect(can.seePrivate(person(role), "u1")).toBe(true);
      expect(can.seePrivate(person(role, { manages: ["t1"] }), "someone-else")).toBe(false);
    }
  });

  it("shows approved records to everyone in the organisation", () => {
    for (const role of ROLES) expect(can.seeApproved(person(role))).toBe(true);
  });

  it("lets only admins run the install", () => {
    expect(can.administer(person("admin"))).toBe(true);
    for (const role of ["engineer", "manager", "exec"] as const) expect(can.administer(person(role))).toBe(false);
  });

  it("gives a suspended person nothing, not even their own memory through the pages", () => {
    const suspended = person("admin", { suspended: true });
    expect(can.administer(suspended)).toBe(false);
    expect(can.seeApproved(suspended)).toBe(false);
    expect(can.seePrivate(suspended, "u1")).toBe(false);
  });

  it("uses a role for what the home view leads with", () => {
    expect(HOME_FOCUS).toEqual({ engineer: "friction", manager: "teams", exec: "progress", admin: "progress" });
  });

  it("knows the roles and nothing else", () => {
    expect(isRole("manager")).toBe(true);
    expect(isRole("owner")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
