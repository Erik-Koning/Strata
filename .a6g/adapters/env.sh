#!/usr/bin/env bash
# The team's own environment: the Agentic Memory web app on the team's own port, on the team's own MongoDB in Docker
# (the Atlas-local image, so Atlas Search and $vectorSearch work as they will in production), apart from the
# operator's own OpenCode, dev servers and databases. The planner runs up, reset, restart and down (a6g env …); anyone
# runs status. State lives in .a6g/run/env/ in the team's checkout.
#
# Docker: once the team is registered, the factory runs this with DOCKER_HOST set to the team's engine (the one
# a6g register chose), so docker reaches it as it is. This script never looks for a socket or chooses an engine.
#
#   .a6g/adapters/env.sh up|down|restart|reset|status
#
#   app      http://localhost:9316 (A6G_APP_PORT)     health: /api/health
#   MongoDB  mongodb://localhost:9317/agentic_memory?directConnection=true   container agentic-memory-a6g-mongo
#   settings .a6g/run/env/app.env (MEMORY_API_TOKEN, generated once; never committed)
#
# Until the skeleton exists (no package.json with a `dev` script), `up` serves a placeholder on the app's port that
# answers 200 on every path, so the health check holds now and proves the real app as soon as it's built.
set -uo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT" || exit 2
RUN="$ROOT/.a6g/run/env"
PORT="${A6G_APP_PORT:-9316}"
MONGO_PORT="${A6G_MONGO_PORT:-9317}"
URL="http://localhost:$PORT/api/health"
MONGO_CONTAINER="agentic-memory-a6g-mongo"
MONGO_VOLUME="agentic-memory-a6g-mongo"
MONGO_IMAGE="${A6G_MONGO_IMAGE:-mongodb/mongodb-atlas-local:8.0}"
MONGODB_URI="mongodb://localhost:$MONGO_PORT/agentic_memory?directConnection=true"
mkdir -p "$RUN"

# The tools, wherever they are (agents run with T3 Code's PATH, which may not have them). Only the CLIs: the Docker
# engine is DOCKER_HOST's.
if ! command -v node >/dev/null 2>&1; then
  for dir in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$dir/node" ] && export PATH="$dir:$PATH" && break
  done
fi
if ! command -v pnpm >/dev/null 2>&1; then
  for dir in "$HOME/Library/pnpm" /opt/homebrew/bin /usr/local/bin "$(dirname "$(command -v node 2>/dev/null || echo /nonexistent/node)")"; do
    [ -x "$dir/pnpm" ] && export PATH="$dir:$PATH" && break
  done
fi
if ! command -v docker >/dev/null 2>&1; then
  for dir in "$HOME/.rd/bin" /Applications/Docker.app/Contents/Resources/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$dir/docker" ] && export PATH="$dir:$PATH" && break
  done
fi

# Does the root package.json have this script? (The skeleton provides the contract's names; notes.md lists them.)
has_script() {
  [ -f "$ROOT/package.json" ] || return 1
  node -e 'const s=require(process.argv[1]).scripts||{};process.exit(s[process.argv[2]]?0:1)' "$ROOT/package.json" "$1" 2>/dev/null
}

# The team's own settings: generated once, never committed. The app and the plugin sandbox read this file.
ensure_app_env() {
  if [ ! -f "$RUN/app.env" ]; then
    local token
    token="$(openssl rand -hex 32)" || { echo "env: couldn't generate MEMORY_API_TOKEN (openssl)" >&2; return 1; }
    cat >"$RUN/app.env" <<EOF
# Written by .a6g/adapters/env.sh for the team's own environment. Local values only; never committed.
MEMORY_API_TOKEN=$token
EOF
  fi
  # The addresses follow the ports, so they're rewritten on every up.
  grep -v -E '^(PORT|MONGODB_URI|MEMORY_API_URL|MEMORY_AI_PROVIDER)=' "$RUN/app.env" >"$RUN/app.env.tmp" && mv "$RUN/app.env.tmp" "$RUN/app.env"
  cat >>"$RUN/app.env" <<EOF
PORT=$PORT
MONGODB_URI=$MONGODB_URI
MEMORY_API_URL=http://localhost:$PORT
MEMORY_AI_PROVIDER=stub
EOF
}

# MongoDB -------------------------------------------------------------------------------------------------------
mongo_running() { [ "$(docker inspect -f '{{.State.Running}}' "$MONGO_CONTAINER" 2>/dev/null)" = "true" ]; }
mongo_ready() {
  local health
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$MONGO_CONTAINER" 2>/dev/null)"
  case "$health" in
  healthy) return 0 ;;
  starting | unhealthy) return 1 ;;
  esac
  # An image without a health check: a TCP answer on the port will do.
  (exec 3<>"/dev/tcp/127.0.0.1/$MONGO_PORT") 2>/dev/null
}
mongo_up() {
  if mongo_running; then
    :
  elif docker inspect "$MONGO_CONTAINER" >/dev/null 2>&1; then
    docker start "$MONGO_CONTAINER" >>"$RUN/mongo.log" 2>&1 || { echo "env: couldn't start $MONGO_CONTAINER; see $RUN/mongo.log" >&2; return 1; }
  else
    echo "env: starting MongoDB ($MONGO_IMAGE) on port $MONGO_PORT (the first run pulls the image)"
    docker run -d --name "$MONGO_CONTAINER" -p "127.0.0.1:$MONGO_PORT:27017" -v "$MONGO_VOLUME:/data/db" "$MONGO_IMAGE" >>"$RUN/mongo.log" 2>&1 ||
      { echo "env: couldn't run $MONGO_IMAGE; see $RUN/mongo.log" >&2; return 1; }
  fi
  for _ in $(seq 1 90); do
    mongo_ready && { echo "env: MongoDB up at $MONGODB_URI"; return 0; }
    sleep 2
  done
  echo "env: MongoDB didn't answer on $MONGO_PORT in 3 minutes (docker logs $MONGO_CONTAINER)" >&2
  return 1
}
mongo_down() {
  mongo_running && docker stop "$MONGO_CONTAINER" >>"$RUN/mongo.log" 2>&1
  return 0
}
mongo_wipe() {
  docker rm -f "$MONGO_CONTAINER" >>"$RUN/mongo.log" 2>&1
  docker volume rm "$MONGO_VOLUME" >>"$RUN/mongo.log" 2>&1
  return 0
}

# The app ------------------------------------------------------------------------------------------------------
# Runs a root script with the environment's settings.
with_env() { (set -a; . "$RUN/app.env"; set +a; "$@"); }

app_up() {
  if curl -fsS -o /dev/null --max-time 3 "$URL"; then echo "env: app already up at $URL"; return 0; fi
  ensure_app_env || return 1
  local kind
  if has_script dev; then
    pnpm install --frozen-lockfile --prefer-offline >"$RUN/install.log" 2>&1 || { echo "env: install failed; see $RUN/install.log" >&2; return 1; }
    if has_script db:indexes; then
      with_env pnpm run db:indexes >"$RUN/indexes.log" 2>&1 || { echo "env: db:indexes failed; see $RUN/indexes.log" >&2; return 1; }
    fi
    (set -a; . "$RUN/app.env"; set +a; nohup pnpm run dev >"$RUN/app.log" 2>&1 & echo $! >"$RUN/app.pid")
    kind="app"
  else
    # Nothing to serve yet: a placeholder that answers 200 on every path (JSON under /api/), so the health check holds.
    (PORT="$PORT" nohup node -e '
      const http = require("http");
      const port = Number(process.env.PORT);
      http.createServer((req, res) => {
        if (req.url.startsWith("/api/")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, placeholder: true, service: "agentic-memory" }));
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<!doctype html><html lang=\"en\"><meta name=\"viewport\" content=\"width=device-width\"><title>Agentic Memory</title><main style=\"font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem\"><h1>Agentic Memory</h1><p>Placeholder: nothing is built yet. The team’s skeleton replaces this page.</p></main></html>");
      }).listen(port);
    ' >"$RUN/app.log" 2>&1 & echo $! >"$RUN/app.pid")
    kind="placeholder (nothing is built yet)"
  fi
  for _ in $(seq 1 120); do
    curl -fsS -o /dev/null --max-time 2 "$URL" && { echo "env: $kind up at $URL"; return 0; }
    sleep 2
  done
  echo "env: the app didn't answer at $URL in 4 minutes; see $RUN/app.log" >&2
  return 1
}
app_down() {
  if [ -f "$RUN/app.pid" ]; then
    pkill -P "$(cat "$RUN/app.pid")" 2>/dev/null
    kill "$(cat "$RUN/app.pid")" 2>/dev/null
  fi
  lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
  rm -f "$RUN/app.pid"
  return 0
}

# The verbs -----------------------------------------------------------------------------------------------------
up() {
  mongo_up || return 1
  app_up
}
down() {
  app_down
  mongo_down
  echo "env: app and MongoDB stopped (MongoDB keeps its data)"
}
# The app only: MongoDB keeps running (after-merge runs this).
restart() {
  app_down
  up
}
# Back to nothing: a fresh MongoDB, the indexes again, then the seed when the repository has one.
reset() {
  app_down
  mongo_down
  mongo_wipe
  up || return 1
  if has_script db:seed; then
    with_env pnpm run db:seed >"$RUN/seed.log" 2>&1 || { echo "env: db:seed failed; see $RUN/seed.log" >&2; return 1; }
    echo "env: seeded"
  fi
}
status() {
  local rc=0
  if curl -fsS -o /dev/null --max-time 3 "$URL"; then echo "env: app up at $URL"; else echo "env: app down ($URL)"; rc=1; fi
  if mongo_running; then
    if mongo_ready; then echo "env: MongoDB up at $MONGODB_URI ($MONGO_CONTAINER)"; else echo "env: MongoDB starting ($MONGO_CONTAINER)"; fi
  else
    echo "env: MongoDB down ($MONGO_CONTAINER)"
  fi
  [ -f "$RUN/app.env" ] && echo "env: settings in $RUN/app.env"
  return $rc
}

case "${1:-status}" in
up) up ;;
down) down ;;
restart) restart ;;
reset) reset ;;
status) status ;;
*) echo "usage: $0 up|down|restart|reset|status" >&2 && exit 2 ;;
esac
