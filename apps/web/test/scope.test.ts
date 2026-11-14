import { describe, expect, it } from "vitest";
import { scopeFor } from "../server/api-auth.ts";
import { ApiError } from "../server/http.ts";

const key = { kind: "key" as const, userId: "u1", keyId: "k1", label: "laptop", client: null };
const service = { kind: "service" as const, label: "service token", client: null };

describe("scopeFor", () => {
  it("fills a key's org and person, and keeps the project it names", () => {
    expect(scopeFor(key, { project: "acme/web" })).toEqual({ org: "default", user: "u1", project: "acme/web" });
  });

  it("refuses a key that names another person or organisation", () => {
    expect(() => scopeFor(key, { project: "p", user: "u2" })).toThrow(ApiError);
    expect(() => scopeFor(key, { project: "p", org: "other" })).toThrow(ApiError);
  });

  it("lets the service token name any scope", () => {
    expect(scopeFor(service, { project: "p", user: "u9", org: "o" })).toEqual({ org: "o", user: "u9", project: "p" });
    expect(scopeFor(service, { project: "p" })).toEqual({ org: "default", user: "service", project: "p" });
  });
});
