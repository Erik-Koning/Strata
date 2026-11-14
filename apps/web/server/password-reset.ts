// "Forgot your password?": Better Auth makes a token that works once and for an hour, and calls sendResetLink, which
// emails a link to /reset-password. The page answers the same whether or not the email has an account, so it can't be
// used to find out who has one.
//
// Where email isn't set up (a local run without the SES settings), the link goes to the server's log instead, and only
// outside production: a production log is no place for a link that sets someone's password.
import { config } from "./config.ts";
import { type Mail, sendMail } from "./mail.ts";

export const RESET_LINK_SECONDS = 60 * 60;

export const resetLink = (baseURL: string, token: string): string =>
  `${baseURL}/reset-password?token=${encodeURIComponent(token)}`;

export function resetEmail(to: string, link: string): Mail {
  return {
    to,
    subject: "Reset your Strata password",
    text: [
      "Someone asked to reset the password for the Strata account with this email address.",
      "",
      "To choose a new password, open this link within an hour:",
      link,
      "",
      "The link works once. If you didn't ask for this, ignore this email: your password stays as it is.",
    ].join("\n"),
  };
}

export async function sendResetLink(
  email: string,
  token: string,
  { production = process.env.NODE_ENV === "production" }: { production?: boolean } = {},
): Promise<void> {
  const { baseURL, mail } = config();
  const link = resetLink(baseURL, token);
  if ("missing" in mail) {
    if (production)
      console.error(
        `[password reset] Email isn't set up (missing ${mail.missing.join(", ")}): no link sent to ${email}.`,
      );
    else console.info(`[password reset] Email isn't set up here, so the link for ${email} is: ${link}`);
    return;
  }
  try {
    await sendMail(resetEmail(email, link));
  } catch (error) {
    console.error(`[password reset] Couldn't email ${email}:`, error);
    if (!production) console.info(`[password reset] The link for ${email} is: ${link}`);
  }
}
