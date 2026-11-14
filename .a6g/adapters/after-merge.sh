#!/usr/bin/env bash
# After a merge into the integration branch: a6g merge runs this outside the merge lock, under the app lock, with
# BEFORE and AFTER (the commits the branch moved between) and A6G_LIGHT=1 when the planner asked for a light run.
# Restarts the team's app on the merged code (env.sh restart: install, indexes, the app; MongoDB keeps running), then
# the factory's own checks after merges (the end-to-end suite, page checks) run against it. Lines starting "after:" go
# into the merge's report.
set -uo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT" || exit 2
mkdir -p "$ROOT/.a6g/run/env"
"$ROOT/.a6g/adapters/env.sh" restart >"$ROOT/.a6g/run/env/after-merge.log" 2>&1 || {
  echo "after: the app didn't restart on ${AFTER:0:7}; see .a6g/run/env/after-merge.log and app.log"
  exit 1
}
echo "after: app restarted at ${AFTER:0:7}"
