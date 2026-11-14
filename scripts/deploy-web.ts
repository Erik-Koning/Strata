// pnpm deploy:web: the Strata web app on AWS Lightsail, at https://strata.anythingfactory.dev.
//
//   AWS_PROFILE=<the account's profile> pnpm deploy:web             build, push, deploy, and the domain the first time
//   AWS_PROFILE=<the account's profile> pnpm deploy:web --skip-build deploy the image already pushed for this commit
//   AWS_PROFILE=<the account's profile> pnpm deploy:web --check      read-only: what exists, what a deploy would do
//
// Every step is safe to run again: what exists is kept. The pieces, all in us-east-2 unless said otherwise:
//   - ECR repository strata-web, holding one image per commit (built for linux/amd64, which Lightsail runs);
//   - Lightsail container service strata (micro, one node: about $10 a month), which pulls from ECR with its own role;
//   - the app's settings in SSM, /strata/production/web-env (MONGODB_URI, the session secret, the public address),
//     made on the first run from this machine's .env.local and a new random secret, plus the mail settings that
//     sst.config.ts keeps in /strata/production/mail-env. Settings never go in the image or in the output;
//   - a Lightsail certificate for the domain, validated and pointed at by records in the anythingfactory.dev zone.
//
// MongoDB Atlas must accept connections from Lightsail, whose addresses aren't fixed: if the health check says the
// database is down, add 0.0.0.0/0 to the cluster's Network Access list (or move to a fixed egress later).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { localEnv } from "../apps/web/server/local-env.ts";

const REGION = "us-east-2";
const SERVICE = "strata";
const REPO = "strata-web";
const ZONE = "anythingfactory.dev";
const DOMAIN = `strata.${ZONE}`;
const CERT = "strata-web";
const WEB_ENV = "/strata/production/web-env";
const MAIL_ENV = "/strata/production/mail-env";
const PORT = "3000";

const flags = new Set(process.argv.slice(2));
const checkOnly = flags.has("--check");
const skipBuild = flags.has("--skip-build");
const say = (line: string) => console.log(`deploy:web  ${line}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One AWS CLI call, its JSON answer parsed here and never printed whole: some answers carry settings.
function aws<T = unknown>(args: string[]): T {
  const out = execFileSync("aws", [...args, "--region", REGION, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return (out.trim() ? JSON.parse(out) : null) as T;
}
// The same, or null when AWS says the thing isn't there.
function awsMaybe<T = unknown>(args: string[]): T | null {
  try {
    return aws<T>(args);
  } catch (error) {
    const text = String((error as { stderr?: unknown }).stderr ?? error);
    if (/NotFound|does not exist|DoesNotExist|RepositoryNotFound|ParameterNotFound/i.test(text)) return null;
    throw new Error(text.trim().split("\n").slice(-1)[0] ?? text);
  }
}

// A private scratch folder for the files the CLI reads settings from; removed on the way out, whatever happens.
const scratch = mkdtempSync(join(tmpdir(), "strata-deploy-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const fileArg = (name: string, value: unknown) => {
  const path = join(scratch, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value), { mode: 0o600 });
  return `file://${path}`;
};

async function waitFor(what: string, test: () => boolean | string, everyMs = 10_000, limitMs = 20 * 60_000) {
  const until = Date.now() + limitMs;
  for (;;) {
    const result = test();
    if (result === true) return;
    if (typeof result === "string") throw new Error(`${what}: ${result}`);
    if (Date.now() > until) throw new Error(`${what}: still waiting after ${Math.round(limitMs / 60_000)} min`);
    await sleep(everyMs);
  }
}

interface ServiceView {
  state: string;
  url: string | null;
  principal: string | null;
  domains: Record<string, string[]> | null;
}
const service = () =>
  awsMaybe<ServiceView>([
    "lightsail",
    "get-container-services",
    "--service-name",
    SERVICE,
    "--query",
    "containerServices[0].{state:state,url:url,principal:privateRegistryAccess.ecrImagePullerRole.principalArn,domains:publicDomainNames}",
  ]);

const account = aws<{ Account: string }>(["sts", "get-caller-identity"]).Account;
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
const registry = `${account}.dkr.ecr.${REGION}.amazonaws.com`;
const image = `${registry}/${REPO}:${commit}`;
say(`account ${account}, commit ${commit}${dirty ? ", with uncommitted changes" : ""}`);
if (dirty && !checkOnly) throw new Error("commit or stash your changes first: the image is tagged with the commit");

// 1. The image
const repo = awsMaybe(["ecr", "describe-repositories", "--repository-names", REPO]);
const pushed = repo
  ? awsMaybe(["ecr", "describe-images", "--repository-name", REPO, "--image-ids", `imageTag=${commit}`])
  : null;
say(`ECR ${REPO}: ${repo ? "exists" : "missing"}; image ${commit}: ${pushed ? "pushed" : "not pushed"}`);

// 2. The service, the settings, the certificate: what exists now
const existing = service();
const settings = awsMaybe(["ssm", "get-parameter", "--name", WEB_ENV, "--query", "Parameter.Name"]);
const certificate = awsMaybe<{ status: string }[]>([
  "lightsail",
  "get-certificates",
  "--certificate-name",
  CERT,
  "--query",
  "certificates[].{status:certificateDetail.status}",
]);
say(
  `Lightsail ${SERVICE}: ${existing ? `${existing.state}, ${existing.url ?? "no address yet"}` : "missing (will be made: micro, ~$10/month)"}`,
);
say(`settings ${WEB_ENV}: ${settings ? "exist" : "missing (will be made from .env.local and a new session secret)"}`);
say(`certificate ${CERT}: ${certificate?.[0]?.status ?? "missing (will be requested for " + DOMAIN + ")"}`);
if (checkOnly) process.exit(0);

// 1. Build and push, for the processor Lightsail runs.
if (!repo)
  aws(["ecr", "create-repository", "--repository-name", REPO, "--image-scanning-configuration", "scanOnPush=true"]);
if (!pushed && !skipBuild) {
  say(`building ${image} for linux/amd64 (a few minutes on an ARM Mac)`);
  const password = execFileSync("aws", ["ecr", "get-login-password", "--region", REGION], { encoding: "utf8" });
  execFileSync("docker", ["login", "--username", "AWS", "--password-stdin", registry], {
    input: password,
    stdio: ["pipe", "ignore", "inherit"],
  });
  execFileSync("docker", ["buildx", "build", "--platform", "linux/amd64", "-t", image, "--push", "."], {
    stdio: "inherit",
  });
} else if (!pushed) throw new Error(`no image for ${commit} in ECR: run without --skip-build`);

// 2. The service, and its right to pull from the repository.
if (!existing) {
  say(`making the Lightsail service ${SERVICE}`);
  aws([
    "lightsail",
    "create-container-service",
    "--service-name",
    SERVICE,
    "--power",
    "micro",
    "--scale",
    "1",
    "--private-registry-access",
    "ecrImagePullerRole={isActive=true}",
    "--query",
    "containerService.state",
  ]);
}
await waitFor("the service to be ready", () => {
  const s = service();
  return s ? ["READY", "RUNNING"].includes(s.state) || (s.state === "DISABLED" ? "it's disabled" : false) : false;
});
const principal = service()?.principal;
if (!principal) throw new Error("the service has no ECR puller role: turn on private registry access");
aws([
  "ecr",
  "set-repository-policy",
  "--repository-name",
  REPO,
  "--policy-text",
  fileArg("ecr-policy.json", {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "LightsailStrataPulls",
        Effect: "Allow",
        Principal: { AWS: principal },
        Action: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
      },
    ],
  }),
  "--query",
  "repositoryName",
]);

// 3. The settings: made once, then read from SSM on every deploy, so any machine with the account can deploy.
if (!settings) {
  const mongo = localEnv().MONGODB_URI;
  if (!mongo || /localhost|127\.0\.0\.1/.test(mongo))
    throw new Error("MONGODB_URI in .env.local must be the Atlas cluster");
  const lines = [
    `MONGODB_URI=${mongo}`,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}`,
    `BETTER_AUTH_URL=https://${DOMAIN}`,
    "MEMORY_AI_PROVIDER=stub",
  ];
  aws([
    "ssm",
    "put-parameter",
    "--name",
    WEB_ENV,
    "--type",
    "SecureString",
    "--description",
    "Strata web app settings for Lightsail, as KEY=VALUE lines",
    "--value",
    fileArg("web-env.txt", `${lines.join("\n")}\n`),
    "--query",
    "Version",
  ]);
  say(`saved the settings in ${WEB_ENV}`);
}
const read = (name: string) =>
  awsMaybe<string>(["ssm", "get-parameter", "--name", name, "--with-decryption", "--query", "Parameter.Value"]);
const environment: Record<string, string> = {};
for (const text of [read(MAIL_ENV), read(WEB_ENV)])
  for (const [key, value] of Object.entries(parseEnv(text ?? ""))) if (value !== undefined) environment[key] = value;
for (const key of ["MONGODB_URI", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"])
  if (!environment[key]) throw new Error(`${WEB_ENV} has no ${key}`);
environment.NODE_ENV = "production";
environment.PORT = PORT;

// 4. The deployment, healthy only when the database answers.
say(`deploying ${commit}`);
aws([
  "lightsail",
  "create-container-service-deployment",
  "--service-name",
  SERVICE,
  "--containers",
  fileArg("containers.json", { web: { image, environment, ports: { [PORT]: "HTTP" } } }),
  "--public-endpoint",
  fileArg("endpoint.json", {
    containerName: "web",
    containerPort: Number(PORT),
    healthCheck: {
      path: "/api/health",
      successCodes: "200",
      intervalSeconds: 10,
      timeoutSeconds: 5,
      healthyThreshold: 2,
      unhealthyThreshold: 3,
    },
  }),
  "--query",
  "containerService.state",
]);
const deploymentState = () =>
  aws<string | null>([
    "lightsail",
    "get-container-service-deployments",
    "--service-name",
    SERVICE,
    "--query",
    "max_by(deployments, &version).state",
  ]);
await waitFor("the deployment", () => {
  const state = deploymentState();
  if (state === "FAILED")
    return "it failed its health check. If the logs say the database is unreachable, let Lightsail through Atlas's Network Access list";
  return state === "ACTIVE";
});
const live = service();
say(`live at ${live?.url}`);

// 5. The domain: a certificate validated through the zone, attached to the service, and a record pointing at it.
const zoneId = aws<string>([
  "route53",
  "list-hosted-zones-by-name",
  "--dns-name",
  ZONE,
  "--max-items",
  "1",
  "--query",
  "HostedZones[0].Id",
]).replace("/hostedzone/", "");
const upsert = (name: string, value: string) =>
  aws([
    "route53",
    "change-resource-record-sets",
    "--hosted-zone-id",
    zoneId,
    "--change-batch",
    fileArg(`dns-${name}.json`, {
      Changes: [
        {
          Action: "UPSERT",
          ResourceRecordSet: { Name: name, Type: "CNAME", TTL: 300, ResourceRecords: [{ Value: value }] },
        },
      ],
    }),
    "--query",
    "ChangeInfo.Status",
  ]);
if (!certificate?.length) {
  say(`requesting a certificate for ${DOMAIN}`);
  aws([
    "lightsail",
    "create-certificate",
    "--certificate-name",
    CERT,
    "--domain-name",
    DOMAIN,
    "--query",
    "certificate.certificateArn",
  ]);
}
const validationRecord = () =>
  aws<{ name: string | null; value: string | null } | null>([
    "lightsail",
    "get-certificates",
    "--certificate-name",
    CERT,
    "--include-certificate-details",
    "--query",
    "certificates[0].certificateDetail.domainValidationRecords[0].resourceRecord.{name:name,value:value}",
  ]);
await waitFor("the certificate's validation record", () => Boolean(validationRecord()?.name), 5_000, 5 * 60_000);
const validation = validationRecord();
if (validation?.name && validation.value) upsert(validation.name, validation.value);
await waitFor(
  "the certificate",
  () => {
    const status = aws<string>([
      "lightsail",
      "get-certificates",
      "--certificate-name",
      CERT,
      "--query",
      "certificates[0].certificateDetail.status",
    ]);
    return status === "ISSUED" || (["FAILED", "VALIDATION_TIMED_OUT", "REVOKED"].includes(status) ? status : false);
  },
  15_000,
  30 * 60_000,
);
if (!live?.domains?.[CERT]?.includes(DOMAIN)) {
  say(`attaching ${DOMAIN} to the service`);
  aws([
    "lightsail",
    "update-container-service",
    "--service-name",
    SERVICE,
    "--public-domain-names",
    fileArg("domains.json", { [CERT]: [DOMAIN] }),
    "--query",
    "containerService.state",
  ]);
  await waitFor("the service to take the domain", () => ["READY", "RUNNING"].includes(service()?.state ?? ""));
}
const host = new URL(live?.url ?? "").host;
upsert(`${DOMAIN}.`, host);
say(`${DOMAIN} points at ${host}`);

// 6. Is it answering on its own name? DNS can take a few minutes to reach everyone.
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(`https://${DOMAIN}/api/health`);
    const body = (await res.json()) as { db?: string };
    say(`https://${DOMAIN}/api/health: ${res.status}, database ${body.db ?? "?"}`);
    if (res.ok) break;
  } catch {
    if (i === 0) say(`waiting for https://${DOMAIN} to answer`);
  }
  await sleep(20_000);
}
