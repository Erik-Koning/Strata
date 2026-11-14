#!/usr/bin/env bash
# Run by T3 Code in every new member worktree (team.json worktreeSetup): install dependencies when the repository has
# them. Nothing to do while the repository is empty.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2
if ! command -v pnpm >/dev/null 2>&1; then
  for dir in "$HOME/Library/pnpm" /opt/homebrew/bin /usr/local/bin "$HOME"/.nvm/versions/node/*/bin; do
    [ -x "$dir/pnpm" ] && export PATH="$dir:$PATH" && break
  done
fi
if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile --prefer-offline
elif [ -f package-lock.json ]; then
  npm ci
else
  echo "worktree: nothing to install yet"
fi
