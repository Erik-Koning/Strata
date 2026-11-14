#!/usr/bin/env node
// CLI behind the slash commands: login, logout, whoami, projects, use, status, sync, dashboard.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { sessionForNote } from "./lib/active.mjs";
import { api } from "./lib/api.mjs";
import { enqueueEvent, flushEvents, pendingEvents } from "./lib/events.mjs";
import { gitContext, projectOf } from "./lib/git.mjs";
import { requestDeviceCode, waitForApproval } from "./lib/login.mjs";
import { buildOverview, openGaps, recurring, resolveGap } from "./lib/overview.mjs";
import { addFinding, approve, countByStatus, describeSession, listSessions } from "./lib/records.mjs";
import { renderRollup, rollups } from "./lib/rollups.mjs";
import { clearAuth, getAuth, getBinding, getHealth, p, readJson, serverUrl, setBinding } from "./lib/store.mjs";
import { summarizeSession } from "./lib/summarize.mjs";
import { flush, heldBreakdown } from "./lib/sync.mjs";
import { describeTeamResult, searchTeam, teamRollups } from "./lib/team.mjs";

const [command, ...args] = process.argv.slice(2);
const json = args.includes("--json");
const out = (text) => process.stdout.write(`${text}\n`);
const DASHBOARD_SERVER = fileURLToPath(new URL("./dashboard/server.mjs", import.meta.url));

function requireAuth() {
  const auth = getAuth();
  if (!auth?.token) {
    out(
      "Not signed in. Run /strata:login first. Everything captured so far is safe on this machine and will sync after sign-in.",
    );
    process.exit(1);
  }
  return auth;
}

function openBrowser(url) {
  if (process.env.STRATA_NO_BROWSER) return;
  const [cmd, ...rest] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    spawn(cmd, rest, { detached: true, stdio: "ignore", windowsHide: true })
      .on("error", () => {})
      .unref();
  } catch {
    // the URL is printed either way
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function dashboardAlive(info) {
  if (!info?.port) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/healthz`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

function describeHeld(held) {
  const parts = [];
  if (held.summarizing) parts.push(`${held.summarizing} being summarized`);
  if (held.needsReview) parts.push(`${held.needsReview} waiting for your review`);
  if (held.needsLink) parts.push(`${held.needsLink} need a Jira ticket or PR link`);
  if (held.noProject) parts.push(`${held.noProject} approved, waiting for a project`);
  if (held.signedOut) parts.push(`${held.signedOut} approved, waiting for sign-in`);
  if (held.rejected) parts.push(`${held.rejected} rejected by Strata`);
  if (held.local) parts.push(`${held.local} kept local on purpose`);
  return parts.join(", ");
}

const commands = {
  async login() {
    const device = await requestDeviceCode();
    const url = device.verification_uri_complete ?? device.verification_uri;
    out(`Open ${url}`);
    out(`and confirm this code: ${device.user_code}`);
    openBrowser(url);
    const user = await waitForApproval(device);
    out(`Signed in as ${user.name} (${user.email}).`);
    const result = await flush({ maxEntries: 500, budgetMs: 60_000 });
    if (result.sent)
      out(`Sent ${result.sent} approved summar${result.sent === 1 ? "y" : "ies"} that were waiting for sign-in.`);
    const held = describeHeld(heldBreakdown());
    if (held) out(`Still local: ${held}. Open /strata:dashboard to review, link or choose a project.`);
  },

  logout() {
    clearAuth();
    out("Signed out. Capture continues locally, and everything syncs after the next login.");
  },

  async whoami() {
    const auth = requireAuth();
    const me = await api("GET", "/v1/me", undefined, { token: auth.token });
    out(`${me.user.name} (${me.user.email}) on ${serverUrl()}`);
  },

  async projects() {
    const auth = requireAuth();
    const { projects } = await api("GET", "/v1/projects", undefined, { token: auth.token });
    if (json) return out(JSON.stringify(projects));
    for (const project of projects) out(`${project.id}\t${project.teamName} / ${project.name}`);
  },

  async use() {
    const auth = requireAuth();
    const projectId = args.find((a) => !a.startsWith("--"));
    if (!projectId) {
      out("Usage: use <projectId>");
      process.exit(1);
    }
    const { projects } = await api("GET", "/v1/projects", undefined, { token: auth.token });
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) {
      out(`No project "${projectId}" available to you.`);
      process.exit(1);
    }
    const git = gitContext(process.cwd());
    setBinding(git.repoKey, { projectId: project.id, name: project.name, teamName: project.teamName });
    out(`This repo now sends to ${project.teamName} / ${project.name}.`);
    const { sent } = await flush({ maxEntries: 500, budgetMs: 60_000 });
    if (sent) out(`Sent ${sent} approved summar${sent === 1 ? "y" : "ies"}.`);
  },

  status() {
    const auth = getAuth();
    const git = gitContext(process.cwd());
    const binding = getBinding(git.repoKey);
    const totals = countByStatus();
    const health = getHealth();
    const held = describeHeld(heldBreakdown());
    out(`server:   ${serverUrl()}`);
    out(`user:     ${auth?.user ? `${auth.user.name} (${auth.user.email})` : "not signed in"}`);
    out(`project:  ${binding ? `${binding.teamName} / ${binding.name}` : "none selected for this repo"}`);
    out(`jira:     ${git.jira.join(", ") || "none found in branch or recent commits"}`);
    out(`events:   ${pendingEvents()} waiting to send`);
    out(
      `local:    ${totals.sessions} sessions: ${totals.draft + totals.updated} to review, ${totals.ready} approved, ${totals.synced} sent, ${totals["needs-link"]} need a link`,
    );
    if (health.summarizerError) out(`summary:  ${health.summarizerError}`);
    if (held) out(`held:     ${held}`);
    if (health.authExpired) out("health:   sign-in expired, run /strata:login");
    else if (health.failures)
      out(`health:   ${health.failures} failed upload(s) in a row, last: ${health.lastError} (${health.lastErrorAt})`);
    else out("health:   ok");
  },

  async sync() {
    requireAuth();
    const [result, events] = await Promise.all([
      flush({ maxEntries: 500, budgetMs: 60_000 }),
      flushEvents({ force: true, budgetMs: 60_000 }),
    ]);
    out(
      `Sent ${result.sent} summar${result.sent === 1 ? "y" : "ies"}, ${events.sent} event${events.sent === 1 ? "" : "s"}${result.error || events.error ? ` (upload error: ${result.error ?? events.error})` : ""}.`,
    );
    const held = describeHeld(heldBreakdown());
    if (held) out(`Still local: ${held}.`);
  },

  // Background worker started by the Stop hook: turns the queued turn text into the session summary.
  async summarize() {
    const sid = args[0];
    if (!sid) throw new Error("Usage: summarize <sessionId>");
    await summarizeSession(sid);
  },

  // Approve a session's current summary from the terminal (the dashboard is where you read and edit it).
  approve() {
    const sid = args[0];
    const s = sid && describeSession(sid);
    if (!s?.summary) throw new Error("no summary for that session yet");
    if (!s.linked) throw new Error("link a Jira ticket or PR first (dashboard), or mark it as having no ticket");
    approve(sid);
    out(`Approved "${s.title}". Run /strata:sync to send it.`);
  },

  // Log a finding to the current session's draft and send it as a finding event. It still needs approval.
  async note() {
    const [kind, ...words] = args.filter((a) => a !== "--json");
    const root = process.cwd();
    const sid = sessionForNote(root);
    if (!sid) throw new Error("no active Claude Code session found for this directory");
    const res = addFinding(sid, kind, words.join(" "));
    const findingType = {
      insight: "insight",
      workflow: "workflow",
      "pain-point": "pain_point",
      gap: "context_gap",
    }[kind];
    if (findingType) {
      enqueueEvent({
        sessionID: sid,
        project: projectOf(root),
        kind: "finding",
        payload: { type: findingType, text: words.join(" ") },
      });
      await flushEvents().catch(() => undefined);
    }
    out(
      res.added
        ? `Recorded as a ${kind} in the session draft (revision ${res.revision}). Review it with /strata:review before anything is shared.`
        : "Already recorded.",
    );
  },

  // gaps                 list open gaps, numbered, and what keeps recurring
  // gaps resolve <n|text> mark one answered so it is no longer raised at session start
  gaps() {
    const repoKey = gitContext(process.cwd()).repoKey;
    const gaps = openGaps(repoKey, { limit: 20 });
    if (args[0] === "resolve") {
      const target = args.slice(1).join(" ");
      const picked = /^\d+$/.test(target) ? gaps[Number(target) - 1] : { text: target };
      if (!picked?.text) throw new Error("give the number from /strata:gaps, or the gap text");
      resolveGap(repoKey, picked.text);
      return out(`Marked as answered: ${picked.text}`);
    }
    out(
      gaps.length
        ? gaps.map((g, i) => `${i + 1}. ${g.text}${g.count > 1 ? ` (${g.count} sessions)` : ""}`).join("\n")
        : "No open context gaps recorded for this repo.",
    );
    const repeated = recurring(repoKey).filter((g) => g.kind === "pain-point");
    if (repeated.length)
      out(
        `\nPain points that keep coming back:\n${repeated.map((g) => `- ${g.text} (${g.count} sessions)`).join("\n")}`,
      );
  },

  // Sessions grouped by ticket or PR. --all includes every repo on this machine.
  async rollup() {
    if (args.includes("--team")) {
      const groups = await teamRollups(process.cwd());
      return out(
        groups.length
          ? groups
              .map((g) =>
                [
                  `## ${g.key}  [${g.sessions.length} session(s) by ${g.authors.join(", ") || "unknown"}]`,
                  ...g.sessions.map((s) => `- ${s.title}: ${s.built}`),
                  ...[
                    ["Insights", g.insights],
                    ["Workflow", g.workflow],
                    ["Pain points", g.painPoints],
                    ["Gaps", g.gaps],
                  ].flatMap(([l, a]) => (a?.length ? [`${l}:`, ...a.map((x) => `  - ${x}`)] : [])),
                ].join("\n"),
              )
              .join("\n\n")
          : "The team has no approved summaries yet.",
      );
    }
    const groups = rollups({ repoKey: args.includes("--all") ? null : gitContext(process.cwd()).repoKey });
    out(groups.length ? groups.map(renderRollup).join("\n\n") : "No summaries to roll up yet.");
  },

  // Search teammates' approved summaries (signed in) and the ones on this machine.
  async search() {
    const query = args.filter((a) => !a.startsWith("--")).join(" ");
    if (!query) throw new Error("Usage: search <words>");
    const team = await searchTeam(query, process.cwd());
    const words = query.toLowerCase().split(/\s+/);
    const local = listSessions().flatMap((s) =>
      Object.entries({
        built: [s.summary?.built],
        insight: s.summary?.insights,
        workflow: s.summary?.workflow,
        "pain-point": s.summary?.painPoints,
        gap: s.summary?.gaps,
        decision: s.summary?.decisions,
      }).flatMap(([kind, items]) =>
        (items ?? [])
          .filter((x) => x && words.every((w) => `${x} ${s.title}`.toLowerCase().includes(w)))
          .map((x) => `[${kind}] ${x} (${s.title})`),
      ),
    );
    if (team.length) out(`From the team:\n${team.map(describeTeamResult).join("\n")}`);
    if (local.length) out(`${team.length ? "\n" : ""}On this machine:\n${local.slice(0, 10).join("\n")}`);
    if (!team.length && !local.length) out("No matches.");
  },

  // What the next session in this repo will be told.
  overview() {
    out(buildOverview(gitContext(process.cwd()).repoKey) || "Nothing recorded for this repo yet.");
  },

  // Print the drafts that wait for the engineer; /review asks about each and calls approve.
  review() {
    const waiting = listSessions().filter(
      (s) => s.status === "draft" || s.status === "updated" || s.status === "needs-link",
    );
    if (!waiting.length) return out("Nothing waiting for review.");
    for (const s of waiting) {
      const sum = s.summary;
      out(`## ${s.title}  [${s.sessionId}]  (${s.status}${s.linked ? "" : ", needs a ticket or PR link"})`);
      if (sum.built) out(`Built: ${sum.built}`);
      if (sum.why) out(`Why: ${sum.why}`);
      for (const [label, list] of [
        ["Decisions", sum.decisions],
        ["Open", sum.open],
        ["Insights", sum.insights],
        ["Workflow", sum.workflow],
        ["Pain points", sum.painPoints],
        ["Gaps", sum.gaps],
      ]) {
        if (list?.length) out(`${label}:\n${list.map((x) => `  - ${x}`).join("\n")}`);
      }
      out("");
    }
  },

  // Background event flush used by the hooks.
  async "flush-events"() {
    await flushEvents({ force: true });
  },

  // Background flush used by the hooks.
  async flush() {
    await flush();
  },

  async dashboard() {
    if (args.includes("stop")) {
      const info = readJson(p("dashboard.json"), null);
      if (info?.pid) {
        try {
          process.kill(info.pid);
        } catch {
          // already gone
        }
      }
      fs.rmSync(p("dashboard.json"), { force: true });
      return out("Dashboard stopped.");
    }
    let info = readJson(p("dashboard.json"), null);
    if (!(await dashboardAlive(info))) {
      fs.rmSync(p("dashboard.json"), { force: true });
      spawn(process.execPath, [DASHBOARD_SERVER], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      for (let i = 0; i < 50; i += 1) {
        await sleep(100);
        info = readJson(p("dashboard.json"), null);
        if (await dashboardAlive(info)) break;
      }
      if (!(await dashboardAlive(info))) throw new Error("dashboard did not start; see ~/.strata/strata.log");
    }
    const url = `http://127.0.0.1:${info.port}/?t=${info.token}`;
    out(`Dashboard: ${url}`);
    if (!args.includes("--no-open")) openBrowser(url);
  },
};

try {
  if (!commands[command]) {
    out(
      "Usage: strata.mjs <login|logout|whoami|projects|use|status|sync|note|gaps|overview|rollup|search|review|approve|flush-events|dashboard>",
    );
    process.exit(1);
  }
  await commands[command]();
} catch (err) {
  out(`Error: ${err.message}`);
  process.exit(1);
}
