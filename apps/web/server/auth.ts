// Accounts and sessions (Better Auth, on the app's own database): sign up with a name, an email and a password, then
// a session cookie. API clients don't use these: they use API keys made on /connect (api-auth.ts).
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { config } from "./config.ts";
import { db, mongo } from "./db.ts";

function makeAuth() {
  const { authSecret, baseURL } = config();
  return betterAuth({
    appName: "Strata",
    baseURL,
    basePath: "/api/auth",
    secret: authSecret,
    database: mongodbAdapter(db(), { client: mongo() }),
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128, autoSignIn: true },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    advanced: { cookiePrefix: "strata" },
    plugins: [nextCookies()],
  });
}

const cache = globalThis as typeof globalThis & { strataAuth?: ReturnType<typeof makeAuth> };

export function auth(): ReturnType<typeof makeAuth> {
  cache.strataAuth ??= makeAuth();
  return cache.strataAuth;
}
