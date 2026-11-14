// The app's settings, read once from the environment and checked. Every name is in .env.example with no value.
// The environment comes first, then .env.local (local-env.ts); tests (NODE_ENV=test) get only what they set.
import { z } from "zod";
import { localEnv } from "./local-env.ts";

const Settings = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required: put it in .env.local at the repository root"),
  // A service token with every scope: tests, scripts, the OpenCode sandbox. Optional: people use API keys.
  MEMORY_API_TOKEN: z.string().min(24).optional(),
  // Which provider: stub (deterministic, offline; its hash vectors are NOT semantic), voyage or openai (real
  // embeddings; the text work stays the stub's), or anthropic (Claude for summaries, drafts and answers; stub
  // embeddings). See server/ai/provider.ts.
  MEMORY_AI_PROVIDER: z.enum(["stub", "voyage", "openai", "anthropic"]).default("stub"),
  // The embedding model and its output size; each embeddings provider has a default (voyage-3.5 at 1024,
  // text-embedding-3-small at 1536). Changing either changes the vector index and needs `pnpm db:indexes` then
  // `pnpm db:reembed`.
  MEMORY_EMBED_MODEL: z.string().min(1).optional(),
  MEMORY_EMBED_DIMENSIONS: z.coerce.number().int().min(64).max(4096).optional(),
  MEMORY_EMBED_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // The model anthropic asks (server/ai/provider.ts has the default).
  MEMORY_AI_MODEL: z.string().min(1).max(200).optional(),
  // The keys, read by name only. Each is needed only by its own provider.
  VOYAGE_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(9316),
  // Email through Amazon SES: all four or none (sst.config.ts makes the send-only key).
  SES_REGION: z.string().min(1).optional(),
  SES_ACCESS_KEY_ID: z.string().min(1).optional(),
  SES_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),
});

const MAIL_SETTINGS = ["SES_REGION", "SES_ACCESS_KEY_ID", "SES_SECRET_ACCESS_KEY", "MAIL_FROM"] as const;

export interface MailConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  from: string;
}

export interface Config {
  mongoUri: string;
  serviceToken: string | null;
  aiProvider: "stub" | "voyage" | "openai" | "anthropic";
  embedModel: string | null;
  embedDimensions: number | null;
  embedTimeoutMs: number;
  voyageKey: string | null;
  openaiKey: string | null;
  aiModel: string | null;
  anthropicKey: string | null;
  authSecret: string;
  baseURL: string;
  // The email settings, or which of the four are missing (all four when email isn't set up). Checked when mail is
  // sent, not here: nothing else should stop working over a half-set optional feature.
  mail: MailConfig | { missing: string[] };
}

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const parsed = Settings.safeParse(process.env.NODE_ENV === "test" ? process.env : { ...localEnv(), ...process.env });
  if (!parsed.success)
    throw new Error(`Settings: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const env = parsed.data;
  // The session secret: set it anywhere real. Without one, a secret derived from the service token keeps sessions valid
  // across restarts of a local run; with neither, a development-only constant.
  const authSecret =
    env.BETTER_AUTH_SECRET ??
    (env.MEMORY_API_TOKEN ? `derived:${env.MEMORY_API_TOKEN}` : "strata-development-secret-only!!");
  const mail =
    env.SES_REGION && env.SES_ACCESS_KEY_ID && env.SES_SECRET_ACCESS_KEY && env.MAIL_FROM
      ? {
          region: env.SES_REGION,
          accessKeyId: env.SES_ACCESS_KEY_ID,
          secretAccessKey: env.SES_SECRET_ACCESS_KEY,
          from: env.MAIL_FROM,
        }
      : { missing: MAIL_SETTINGS.filter((name) => !env[name]) };
  cached = {
    mongoUri: env.MONGODB_URI,
    serviceToken: env.MEMORY_API_TOKEN ?? null,
    aiProvider: env.MEMORY_AI_PROVIDER,
    embedModel: env.MEMORY_EMBED_MODEL ?? null,
    embedDimensions: env.MEMORY_EMBED_DIMENSIONS ?? null,
    embedTimeoutMs: env.MEMORY_EMBED_TIMEOUT_MS,
    voyageKey: env.VOYAGE_API_KEY ?? null,
    openaiKey: env.OPENAI_API_KEY ?? null,
    aiModel: env.MEMORY_AI_MODEL ?? null,
    anthropicKey: env.ANTHROPIC_API_KEY ?? null,
    authSecret,
    baseURL: env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`,
    mail,
  };
  return cached;
}

// For tests that change the environment between cases.
export function resetConfig(): void {
  cached = null;
}
