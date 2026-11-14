// The app's settings, read once from the environment and checked. Every name is in .env.example with no value.
import { z } from "zod";

const Settings = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required (the team's is in .a6g/run/env/app.env)"),
  // A service token with every scope: tests, scripts, the OpenCode sandbox. Optional: people use API keys.
  MEMORY_API_TOKEN: z.string().min(24).optional(),
  // Which embeddings: stub (deterministic hash vectors, offline, NOT semantic), voyage (Voyage AI) or openai. anthropic
  // is accepted for the summaries to come; Anthropic has no embeddings API, so it can't embed.
  MEMORY_AI_PROVIDER: z.enum(["stub", "voyage", "openai", "anthropic"]).default("stub"),
  // The embedding model and its output size; each provider has a default (voyage-3.5 at 1024, text-embedding-3-small
  // at 1536). Changing either changes the vector index and needs `pnpm db:indexes` then `pnpm db:reembed`.
  MEMORY_EMBED_MODEL: z.string().min(1).optional(),
  MEMORY_EMBED_DIMENSIONS: z.coerce.number().int().min(64).max(4096).optional(),
  MEMORY_EMBED_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // The keys, read by name only. Each is needed only by its own provider.
  VOYAGE_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().positive().default(9316),
});

export interface Config {
  mongoUri: string;
  serviceToken: string | null;
  aiProvider: "stub" | "voyage" | "openai" | "anthropic";
  embedModel: string | null;
  embedDimensions: number | null;
  embedTimeoutMs: number;
  voyageKey: string | null;
  openaiKey: string | null;
  authSecret: string;
  baseURL: string;
}

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const parsed = Settings.safeParse(process.env);
  if (!parsed.success)
    throw new Error(`Settings: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const env = parsed.data;
  // The session secret: set it anywhere real. Without one, a secret derived from the service token keeps sessions valid
  // across restarts of a local run; with neither, a development-only constant.
  const authSecret =
    env.BETTER_AUTH_SECRET ??
    (env.MEMORY_API_TOKEN ? `derived:${env.MEMORY_API_TOKEN}` : "strata-development-secret-only!!");
  cached = {
    mongoUri: env.MONGODB_URI,
    serviceToken: env.MEMORY_API_TOKEN ?? null,
    aiProvider: env.MEMORY_AI_PROVIDER,
    embedModel: env.MEMORY_EMBED_MODEL ?? null,
    embedDimensions: env.MEMORY_EMBED_DIMENSIONS ?? null,
    embedTimeoutMs: env.MEMORY_EMBED_TIMEOUT_MS,
    voyageKey: env.VOYAGE_API_KEY ?? null,
    openaiKey: env.OPENAI_API_KEY ?? null,
    authSecret,
    baseURL: env.BETTER_AUTH_URL ?? `http://localhost:${env.PORT}`,
  };
  return cached;
}

// For tests that change the environment between cases.
export function resetConfig(): void {
  cached = null;
}
