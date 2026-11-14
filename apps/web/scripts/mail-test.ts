// pnpm mail:test <email>: sends one short email through SES, to check the key, the sender and the domain end to end.
import { config } from "../server/config.ts";
import { sendMail } from "../server/mail.ts";

const [to] = process.argv.slice(2);
if (!to?.includes("@")) {
  console.error("Usage: pnpm mail:test <email>");
  process.exit(2);
}
try {
  const { mail } = config();
  const from = "from" in mail ? mail.from : "(not set up)";
  await sendMail({
    to,
    subject: "Strata can send email",
    text: `This is a test from Strata's mailer, sent through Amazon SES as ${from}. Nothing to do.`,
  });
  console.log(`Sent to ${to} from ${from}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
