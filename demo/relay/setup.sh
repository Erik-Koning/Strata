#!/usr/bin/env bash
# Builds the Relay demo's repositories from scratch in DIR (default: ./.demo-run next to this script):
#   DIR/origin.git   the shared remote (a bare repository standing in for GitHub)
#   DIR/alice        Engineer A's clone: main, plus feat/compound-durations with a failing test, pushed
#   DIR/bob          Engineer B's clone, made from origin: nothing of Alice's but what she pushed
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dir="${1:-$here/.demo-run}"
if [ -e "$dir" ] && [ ! -f "$dir/.strata-relay-demo" ]; then
  echo "$dir exists and isn't a demo folder; choose another" >&2
  exit 1
fi
rm -rf "$dir"
mkdir -p "$dir"
touch "$dir/.strata-relay-demo"
g() { git -c user.name="$1" -c user.email="$2" -C "$3" "${@:4}"; }

git init -q --bare -b main "$dir/origin.git"
git clone -q "$dir/origin.git" "$dir/alice" 2>/dev/null
cp -R "$here/fixture/." "$dir/alice/"
g Alice alice@example.com "$dir/alice" switch -q -c main
g Alice alice@example.com "$dir/alice" add .
g Alice alice@example.com "$dir/alice" commit -qm "durations: parse single units"
g Alice alice@example.com "$dir/alice" push -q origin main

# Alice's work in progress: the tests for the feature, which fail, pushed on its branch.
g Alice alice@example.com "$dir/alice" switch -q -c feat/compound-durations
cp "$here/compound.test.js" "$dir/alice/test/compound.test.js"
g Alice alice@example.com "$dir/alice" add .
g Alice alice@example.com "$dir/alice" commit -qm "WIP: tests for compound durations (failing)"
g Alice alice@example.com "$dir/alice" push -q -u origin feat/compound-durations
git -C "$dir/alice" config user.name Alice
git -C "$dir/alice" config user.email alice@example.com

git clone -q "$dir/origin.git" "$dir/bob" 2>/dev/null
git -C "$dir/bob" config user.name Bob
git -C "$dir/bob" config user.email bob@example.com

echo "Relay demo repositories in $dir"
(cd "$dir/alice" && npm test >/dev/null 2>&1 && echo "alice: tests pass (unexpected)") || echo "alice: npm test fails on feat/compound-durations, as it should"
echo "bob:   $(git -C "$dir/bob" branch --show-current), remote branches: $(git -C "$dir/bob" branch -r | tr -d ' ' | tr '\n' ' ')"
