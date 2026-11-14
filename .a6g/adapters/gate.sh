#!/usr/bin/env bash
# The checks CI runs, in the same order, on the checkout it's run in (a member's worktree, or the merge queue's
# scratch copy). Exit 0 only when every check passes. Prints one line per check and the tail of the first failure.
#
# The repository started empty, so the gate calls the contract's script names from the root package.json (notes.md:
# typecheck, lint, test, test:db, build) and skips, with a line, any the repository doesn't have yet. It passes on the
# empty repository today and proves the real thing as soon as the skeleton provides each script.
#
#   .a6g/adapters/gate.sh            every check (the merge queue runs this on the merged result)
#   .a6g/adapters/gate.sh --quick    the fast subset a builder runs before finishing (install, typecheck, lint, test)
set -uo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT" || exit 2
LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1
MONGO_PORT="${A6G_MONGO_PORT:-9317}"
# Database tests make their own database on the team's MongoDB (named after A6G_NAMESPACE, or at random), so two
# gates at once don't meet. A caller may point MONGODB_URI elsewhere (CI's service container); then it isn't probed.
MONGODB_PRESET="${MONGODB_URI:-}"
export MONGODB_URI="${MONGODB_URI:-mongodb://localhost:$MONGO_PORT/?directConnection=true}"
export MEMORY_AI_PROVIDER="${MEMORY_AI_PROVIDER:-stub}"
export CI=1

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

check() {
  local name="$1" started
  shift
  started=$(date +%s)
  if "$@" >"$LOGS/$name.log" 2>&1; then
    echo "gate: $name ok ($(($(date +%s) - started))s)"
    return 0
  fi
  echo "gate: $name FAILED ($(($(date +%s) - started))s)"
  tail -n 40 "$LOGS/$name.log"
  exit 1
}

if [ ! -f package.json ]; then
  echo "gate: nothing to check yet (no package.json: the skeleton isn't built)"
  echo "gate: all checks passed"
  exit 0
fi

# The package manager, from the lockfile; pnpm is the contract's.
if [ -f pnpm-lock.yaml ]; then PM=pnpm
elif [ -f package-lock.json ]; then PM=npm
elif [ -f bun.lock ] || [ -f bun.lockb ]; then PM=bun
else PM=pnpm; fi

has_script() { node -e 'const s=require(process.argv[1]).scripts||{};process.exit(s[process.argv[2]]?0:1)' "$ROOT/package.json" "$1" 2>/dev/null; }
run_script() {
  local name="$1"
  if has_script "$name"; then
    check "$name" "$PM" run "$name"
  else
    echo "gate: $name skipped (no \"$name\" script yet)"
  fi
}
mongo_answers() { (exec 3<>"/dev/tcp/127.0.0.1/$MONGO_PORT") 2>/dev/null; }

case "$PM" in
pnpm) if [ -f pnpm-lock.yaml ]; then check install pnpm install --frozen-lockfile --prefer-offline; else echo "gate: install skipped (no pnpm-lock.yaml yet)"; fi ;;
npm) check install npm ci ;;
bun) check install bun install --frozen-lockfile ;;
esac

run_script typecheck
run_script lint
run_script test
if [ "$QUICK" -eq 0 ]; then
  if has_script test:db; then
    if [ -n "$MONGODB_PRESET" ] || mongo_answers; then
      check test:db "$PM" run test:db
    else
      echo "gate: test:db FAILED: no MongoDB answers on port $MONGO_PORT (the team's environment is down: a6g env up, planner only)"
      exit 1
    fi
  else
    echo "gate: test:db skipped (no \"test:db\" script yet)"
  fi
  run_script build
fi
echo "gate: all checks passed"
