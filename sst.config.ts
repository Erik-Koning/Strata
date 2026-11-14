/// <reference path="./.sst/platform/config.d.ts" />
// Strata on AWS. For now this is only email, and only sending: strata.anythingfactory.dev made an Amazon SES sender,
// and a key that may send from one address there and nothing else. The web app isn't deployed from here yet.
//
// The domain is set up by the production stage alone. SES holds one identity per domain in a region, so two stages
// can't each own it, and production is protected and kept if removed, so its mail outlives every other stage:
//   - the SES identity, with Easy DKIM (three CNAMEs in the anythingfactory.dev zone) and a DMARC policy;
//   - its own MAIL FROM domain, mail.strata.anythingfactory.dev (an MX and an SPF record), so SPF lines up too.
// Every stage gets its own send-only key (an IAM user that may send from SENDER and nothing else). It's never an
// output: it goes into an encrypted SSM parameter, written as the lines apps/web/.env.local takes (the echo starts
// them on a line of their own if the file doesn't end in one):
//
//   AWS_PROFILE=<the account's profile> pnpm sst deploy --stage production
//   { echo; aws ssm get-parameter --region us-east-2 --name /strata/production/mail-env --with-decryption \
//     --query Parameter.Value --output text; } >> apps/web/.env.local
//
// The account's SES is out of the sandbox in us-east-2, so it can send to anyone from there.
const REGION = "us-east-2";
const ZONE = "anythingfactory.dev";
const DOMAIN = `strata.${ZONE}`;
const MAIL_FROM_DOMAIN = `mail.${DOMAIN}`;
const SENDER = `no-reply@${DOMAIN}`;

export default $config({
  app(input) {
    return {
      name: "strata",
      home: "aws",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      providers: { aws: { region: REGION } },
    };
  },
  async run() {
    const production = $app.stage === "production";

    if (production) {
      const email = new sst.aws.Email("Email", {
        sender: DOMAIN,
        dns: sst.aws.dns(),
        dmarc: "v=DMARC1; p=quarantine; adkim=r; aspf=r",
      });
      new aws.sesv2.EmailIdentityMailFromAttributes("EmailMailFrom", {
        emailIdentity: email.nodes.identity.emailIdentity,
        mailFromDomain: MAIL_FROM_DOMAIN,
        behaviorOnMxFailure: "USE_DEFAULT_VALUE",
      });
      const zone = aws.route53.getZoneOutput({ name: ZONE });
      new aws.route53.Record("EmailMailFromMx", {
        zoneId: zone.zoneId,
        name: MAIL_FROM_DOMAIN,
        type: "MX",
        ttl: 1800,
        records: [`10 feedback-smtp.${REGION}.amazonses.com`],
      });
      new aws.route53.Record("EmailMailFromSpf", {
        zoneId: zone.zoneId,
        name: MAIL_FROM_DOMAIN,
        type: "TXT",
        ttl: 1800,
        records: ["v=spf1 include:amazonses.com ~all"],
      });
    }

    // The key the app sends with. Lightsail and a local run can't take an IAM role, so it's a user's key, allowed to
    // send from SENDER only.
    const mailer = new aws.iam.User("Mailer", { path: "/strata/" });
    new aws.iam.UserPolicy("MailerSends", {
      user: mailer.name,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["ses:SendEmail", "ses:SendRawEmail"],
            Resource: "*",
            Condition: { StringEquals: { "ses:FromAddress": SENDER } },
          },
        ],
      }),
    });
    const key = new aws.iam.AccessKey("MailerKey", { user: mailer.name });
    const from = production ? `Strata <${SENDER}>` : `Strata (${$app.stage}) <${SENDER}>`;
    const parameter = new aws.ssm.Parameter("MailEnv", {
      name: `/strata/${$app.stage}/mail-env`,
      type: "SecureString",
      description: "Strata's send-only SES key, as the lines apps/web/.env.local takes",
      value: $interpolate`SES_REGION=${REGION}
SES_ACCESS_KEY_ID=${key.id}
SES_SECRET_ACCESS_KEY=${key.secret}
MAIL_FROM="${from}"
`,
    });

    return { sender: SENDER, mailEnv: parameter.name };
  },
});
