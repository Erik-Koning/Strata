#!/usr/bin/env bash
# The finish line (team.json "finish"), and where the work stands ("progress"). Done means, together (brief.md, "How
# done is proven"):
#   - the full gate passes on the integration branch as it is now;
#   - the end-to-end suite passed at the branch's head and every journey has a passing spec (a6g e2e done);
#   - every page the harness lists passes its checks (a6g pages done);
#   - the brief's acceptance tests pass (pnpm test:acceptance), once the repository has them;
#   - nothing is open in the task graph: no task in triage, proposed, approved, building, review, blocked or question.
#
#   .a6g/adapters/finish.sh done      exit 0 only when all of that holds (the planner runs it through a6g finish)
#   .a6g/adapters/finish.sh status    one line per journey, what's open, and each condition
set -uo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT" || exit 2

if ! command -v node >/dev/null 2>&1; then
  for dir in "$HOME"/.nvm/versions/node/*/bin /opt/homebrew/bin /usr/local/bin; do
    [ -x "$dir/node" ] && export PATH="$dir:$PATH" && break
  done
fi
if ! command -v pnpm >/dev/null 2>&1; then
  for dir in "$HOME/Library/pnpm" /opt/homebrew/bin /usr/local/bin; do
    [ -x "$dir/pnpm" ] && export PATH="$dir:$PATH" && break
  done
fi
has_script() { [ -f "$ROOT/package.json" ] && node -e 'const s=require(process.argv[1]).scripts||{};process.exit(s[process.argv[2]]?0:1)' "$ROOT/package.json" "$1" 2>/dev/null; }

graph="$(a6g task list --all --json 2>/dev/null)" || { echo "finish: couldn't read the task graph (a6g task list --all --json)" >&2; exit 2; }
summary="$(node -e '
  const tasks = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const journeys = tasks.filter((t) => t.kind === "journey" && t.status !== "rejected");
  const open = tasks.filter((t) => t.kind !== "journey" && !["done", "rejected"].includes(t.status));
  for (const j of journeys) {
    const kids = tasks.filter((t) => t.parent === j.id && t.status !== "rejected");
    console.log(`journey #${j.id} ${j.status}: ${kids.filter((t) => t.status === "done").length}/${kids.length} tasks done · ${j.title}`);
  }
  const counts = {};
  for (const t of open) counts[t.status] = (counts[t.status] ?? 0) + 1;
  console.log(`open: ${open.length}${open.length ? " (" + Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ") + ")" : ""}`);
  console.log(`journeys: ${journeys.length}, done: ${journeys.filter((j) => j.status === "done").length}`);
' <<<"$graph")"
open=$(sed -nE 's/^open: ([0-9]+).*/\1/p' <<<"$summary")

case "${1:-status}" in
status)
  echo "$summary"
  if a6g e2e done >/dev/null 2>&1; then echo "e2e: done"; else echo "e2e: not done (a6g e2e status)"; fi
  if a6g pages done >/dev/null 2>&1; then echo "pages: done"; else echo "pages: not done (a6g pages status)"; fi
  if has_script test:acceptance; then echo "acceptance: pnpm test:acceptance exists (run by done)"; else echo "acceptance: no test:acceptance script yet"; fi
  ;;
done)
  if [ "${open:-0}" -ne 0 ]; then echo "finish: $open tasks still open"; exit 1; fi
  a6g e2e done >/dev/null 2>&1 || { echo "finish: the end-to-end suite isn't done (a6g e2e status)"; exit 1; }
  a6g pages done >/dev/null 2>&1 || { echo "finish: the pages aren't done (a6g pages status)"; exit 1; }
  has_script test:acceptance || { echo "finish: no test:acceptance script yet (the brief's acceptance list as tests)"; exit 1; }
  MEMORY_AI_PROVIDER="${MEMORY_AI_PROVIDER:-stub}" pnpm run test:acceptance >/dev/null 2>&1 || { echo "finish: pnpm test:acceptance fails"; exit 1; }
  "$ROOT/.a6g/adapters/gate.sh" >/dev/null 2>&1 || { echo "finish: the gate fails on the integration branch"; exit 1; }
  echo "finish: nothing open, the suite and the pages done, the acceptance tests and the gate pass"
  ;;
*) echo "usage: $0 done|status" >&2 && exit 2 ;;
esac
