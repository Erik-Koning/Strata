import { describe, expect, it } from "vitest";
import { withDatabase } from "./test-database.ts";

describe("withDatabase", () => {
  it("replaces the database, keeping the hosts, the credentials and the options", () => {
    expect(withDatabase("mongodb+srv://u:p%2Fq@c0.x.mongodb.net/?retryWrites=true&w=majority", "t")).toBe(
      "mongodb+srv://u:p%2Fq@c0.x.mongodb.net/t?retryWrites=true&w=majority",
    );
    expect(withDatabase("mongodb+srv://u:p@c0.x.mongodb.net/strata?appName=a", "t")).toBe(
      "mongodb+srv://u:p@c0.x.mongodb.net/t?appName=a",
    );
    expect(withDatabase("mongodb://h1:27017,h2:27017/strata", "t")).toBe("mongodb://h1:27017,h2:27017/t");
  });

  it("adds a database to an address that names none", () => {
    expect(withDatabase("mongodb+srv://u:p@c0.x.mongodb.net", "t")).toBe("mongodb+srv://u:p@c0.x.mongodb.net/t");
    expect(withDatabase("mongodb://localhost:27017?directConnection=true", "t")).toBe(
      "mongodb://localhost:27017/t?directConnection=true",
    );
  });

  it("refuses anything that isn't a MongoDB address", () => {
    expect(() => withDatabase("postgres://x/y", "t")).toThrow(/mongodb/);
  });
});
