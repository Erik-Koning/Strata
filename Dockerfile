# The Strata web app (apps/web) as one container: Next.js's standalone server, run as a user that isn't root, on port
# 3000. Built from the repository root so the workspace packages (packages/contracts) come with it. Settings come from
# the environment at run time, never from a file in the image (.dockerignore keeps .env* out). scripts/deploy.sh
# builds it for Lightsail (linux/amd64).

FROM node:24-alpine AS build
WORKDIR /repo
RUN npm install --global pnpm@12.15.0
COPY . .
# Only the web app and what it depends on: not the root's deploy tooling, not the plugins.
RUN pnpm install --frozen-lockfile --filter "@strata/web..."
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
# Building reads the settings, so it gets a placeholder database address for this one step; every page renders per
# request, so nothing connects to it. It isn't kept in the image.
RUN MONGODB_URI="mongodb://build-placeholder:27017/strata" pnpm --filter @strata/web run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# The standalone output mirrors the workspace (outputFileTracingRoot is the repository root), so the server is at
# apps/web/server.js; the static assets are copied in beside it.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
