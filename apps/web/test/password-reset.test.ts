import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Nothing here sends a real email.
vi.mock("../server/mail.ts", () => ({ sendMail: vi.fn(async () => undefined) }));

const { resetConfig } = await import("../server/config.ts");
const { sendMail } = await import("../server/mail.ts");
const { resetEmail, resetLink, sendResetLink } = await import("../server/password-reset.ts");

const MAIL = {
  SES_REGION: "us-east-2",
  SES_ACCESS_KEY_ID: "AKIATEST",
  SES_SECRET_ACCESS_KEY: "secret",
  MAIL_FROM: "Strata <no-reply@strata.example.com>",
};
const saved = { ...process.env };

function withEnv(env: Record<string, string>) {
  for (const name of Object.keys(MAIL)) delete process.env[name];
  Object.assign(
    process.env,
    { MONGODB_URI: "mongodb://localhost/strata", BETTER_AUTH_URL: "https://strata.example.com" },
    env,
  );
  resetConfig();
}

describe("the reset link and its email", () => {
  it("points at the reset page, with the token escaped", () => {
    expect(resetLink("https://strata.example.com", "a b&c")).toBe(
      "https://strata.example.com/reset-password?token=a%20b%26c",
    );
  });

  it("says what it's for, how long it works, and what to do if it wasn't you", () => {
    const mail = resetEmail("ada@example.com", "https://strata.example.com/reset-password?token=t");
    expect(mail.to).toBe("ada@example.com");
    expect(mail.subject).toBe("Reset your Strata password");
    expect(mail.text).toContain("https://strata.example.com/reset-password?token=t");
    expect(mail.text).toContain("within an hour");
    expect(mail.text).toContain("works once");
    expect(mail.text).toContain("ignore this email");
  });
});

describe("sendResetLink", () => {
  let info: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.mocked(sendMail).mockClear();
    info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...saved };
    resetConfig();
    vi.restoreAllMocks();
  });

  it("emails the link when email is set up", async () => {
    withEnv(MAIL);
    await sendResetLink("ada@example.com", "tok");
    expect(sendMail).toHaveBeenCalledWith(
      resetEmail("ada@example.com", "https://strata.example.com/reset-password?token=tok"),
    );
    expect(info).not.toHaveBeenCalled();
  });

  it("prints the link to the log on a local run without email, and sends nothing", async () => {
    withEnv({});
    await sendResetLink("ada@example.com", "tok", { production: false });
    expect(sendMail).not.toHaveBeenCalled();
    expect(String(info.mock.calls[0]?.[0])).toContain("/reset-password?token=tok");
  });

  it("never puts the link in a production log, whether email is missing or fails", async () => {
    withEnv({});
    await sendResetLink("ada@example.com", "tok", { production: true });
    withEnv(MAIL);
    vi.mocked(sendMail).mockRejectedValueOnce(new Error("SES said no"));
    await sendResetLink("ada@example.com", "tok", { production: true });
    expect(info).not.toHaveBeenCalled();
    for (const call of error.mock.calls) expect(JSON.stringify(call)).not.toContain("token=tok");
  });
});
