// Email, sent through Amazon SES from MAIL_FROM with the send-only key sst.config.ts makes. That key may send from
// that one address and nothing else. Nothing in the app sends email yet; this is the way it will.
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { config } from "./config.ts";

export interface Mail {
  to: string;
  subject: string;
  // Every email has a whole text part; the HTML part is optional and says the same.
  text: string;
  html?: string;
}

let client: SESv2Client | null = null;

export async function sendMail({ to, subject, text, html }: Mail): Promise<void> {
  const { mail } = config();
  if ("missing" in mail) throw new Error(`Email isn't set up: missing ${mail.missing.join(", ")}`);
  const { region, accessKeyId, secretAccessKey, from } = mail;
  client ??= new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: text, Charset: "UTF-8" },
            ...(html ? { Html: { Data: html, Charset: "UTF-8" } } : {}),
          },
        },
      },
    }),
  );
}
