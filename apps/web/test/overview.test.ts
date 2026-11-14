// What each role's overview leads with (HOME_FOCUS in access.ts): an engineer their own products; a manager, an
// executive and an admin every product, a manager told their teams can't narrow it yet, an admin given people and
// invitations. No database here.
import { describe, expect, it } from "vitest";
import { ROLES } from "../server/access.ts";
import { homeLayout } from "../server/hub/overview.ts";

describe("homeLayout", () => {
  it("leads an engineer with their own products", () => {
    expect(homeLayout("engineer")).toEqual({
      role: "engineer",
      focus: "friction",
      view: "engineer",
      teamsHint: false,
      admin: false,
    });
  });

  it("leads a manager with every product, and says their teams can't narrow it yet", () => {
    expect(homeLayout("manager")).toEqual({
      role: "manager",
      focus: "teams",
      view: "lead",
      teamsHint: true,
      admin: false,
    });
  });

  it("leads an executive and an admin with every product; only the admin gets people and invitations", () => {
    expect(homeLayout("exec")).toMatchObject({ view: "lead", teamsHint: false, admin: false });
    expect(homeLayout("admin")).toMatchObject({ view: "lead", teamsHint: false, admin: true });
    expect(homeLayout("admin", true).admin).toBe(false);
  });

  it("has a view for every role", () => {
    for (const role of ROLES) expect(["engineer", "lead"]).toContain(homeLayout(role).view);
  });
});
