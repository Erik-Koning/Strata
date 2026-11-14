import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../proxy.ts";

const visit = (path: string) => proxy(new NextRequest(`http://test${path}`));

describe("the sign-in gate", () => {
  it("lets the bearer-key APIs reach their own checks, including the documented /v1 contract", () => {
    for (const path of ["/api/memory/events", "/api/v1/me", "/v1/me", "/v1/auth/device"]) {
      expect(visit(path).headers.get("location")).toBeNull();
    }
  });

  it("sends a signed-out person to sign in, remembering where they were going", () => {
    const response = visit("/records?status=draft");
    expect(new URL(response.headers.get("location")).pathname).toBe("/sign-in");
    expect(new URL(response.headers.get("location")).searchParams.get("next")).toBe("/records?status=draft");
  });
});
