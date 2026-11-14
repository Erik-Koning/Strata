// Accounts and sessions (Better Auth, on the app's own database): an invited person signs up with a name and a
// password, then has a session cookie. API clients don't use these: they use API keys made on /connect (api-auth.ts).
//
// Sign-up is by invitation only (invites.ts). Better Auth's own sign-up route is closed to HTTP, so the sign-up page's
// server action, which checks the invite, is the only way in; and the database hook refuses any account no open invite
// was made for, whatever path asks. A suspended person can't start a session.
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { invites, members } from "./collections.ts";
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
    disabledPaths: ["/sign-up/email"],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const invited = await invites().findOne({
              email: user.email.toLowerCase(),
              acceptedAt: null,
              revokedAt: null,
              expiresAt: { $gt: new Date() },
            });
            return invited ? undefined : false;
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const member = await members().findOne({ _id: String(session.userId) });
            return member?.suspendedAt ? false : undefined;
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

const cache = globalThis as typeof globalThis & { strataAuth?: ReturnType<typeof makeAuth> };

export function auth(): ReturnType<typeof makeAuth> {
  cache.strataAuth ??= makeAuth();
  return cache.strataAuth;
}
