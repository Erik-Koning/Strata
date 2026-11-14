import { afterEach, describe, expect, it } from "vitest";
import { config, resetConfig } from "../server/config.ts";
import { sendMail } from "../server/mail.ts";

const MAIL = {
  SES_REGION: "us-east-2",
  SES_ACCESS_KEY_ID: "AKIATEST",
  SES_SECRET_ACCESS_KEY: "secret",
  MAIL_FROM: "Strata <no-reply@strata.example.com>",
};
const saved = { ...process.env };

function withEnv(env: Record<string, string>) {
  for (const name of Object.keys(MAIL)) delete process.env[name];
  Object.assign(process.env, { MONGODB_URI: "mongodb://localhost/strata" }, env);
  resetConfig();
}

describe("the email settings", () => {
  afterEach(() => {
    process.env = { ...saved };
    resetConfig();
  });

  it("name all four as missing when none are set", () => {
    withEnv({});
    expect(config().mail).toEqual({ missing: Object.keys(MAIL) });
  });

  it("are read when all four are set", () => {
    withEnv(MAIL);
    expect(config().mail).toEqual({
      region: "us-east-2",
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret",
      from: "Strata <no-reply@strata.example.com>",
    });
  });

  it("don't stop the rest of the app when some are set without the rest", () => {
    const { MAIL_FROM: _, SES_SECRET_ACCESS_KEY: __, ...partial } = MAIL;
    withEnv(partial);
    expect(config().mongoUri).toBe("mongodb://localhost/strata");
    expect(config().mail).toEqual({ missing: ["SES_SECRET_ACCESS_KEY", "MAIL_FROM"] });
  });

  it("refuse to send, naming what's missing, before reaching SES", async () => {
    const { SES_REGION: _, ...partial } = MAIL;
    withEnv(partial);
    await expect(sendMail({ to: "someone@example.com", subject: "s", text: "t" })).rejects.toThrow(
      "Email isn't set up: missing SES_REGION",
    );
  });
});
