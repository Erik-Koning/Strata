import { dirname, resolve } from "node:path";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { CodeLine } from "../../../components/copy.tsx";
import { Ago } from "../../../components/time.tsx";
import { listKeys } from "../../../server/keys.ts";
import { requireViewer } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";
import { KeyMaker } from "./key-maker.tsx";
import { RefreshWhileWaiting } from "./refresh.tsx";
import { RevokeButton } from "./revoke-button.tsx";

export const metadata: Metadata = { title: "Connect" };

const LIVE_MS = 5 * 60 * 1000;

// Where the plugin is: this repository, which is also a Claude Code plugin marketplace (.claude-plugin/marketplace.json).
function repository(): string {
  const cwd = process.cwd();
  return cwd.endsWith("/apps/web") ? dirname(dirname(cwd)) : resolve(cwd);
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="group relative grid grid-cols-[36px_minmax(0,1fr)] gap-4 pb-9 last:pb-0">
      <span className="z-[1] grid size-9 place-items-center rounded-full border border-line-strong bg-surface font-mono font-medium text-[13px]">
        {n}
      </span>
      <span aria-hidden className="absolute top-9 bottom-0 left-[17.5px] w-px bg-line-strong group-last:hidden" />
      <div className="min-w-0 pt-1">
        <h2 className="font-semibold text-[16px]">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </li>
  );
}

export default async function ConnectPage() {
  const viewer = await requireViewer();
  const keys = await listKeys(viewer.userId);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:9316"}`;
  const live = keys.filter((k) => !k.revokedAt);
  const seen = live.some((k) => k.lastUsedAt);
  const repo = repository();

  return (
    <>
      <RefreshWhileWaiting waiting={live.length > 0 && !seen} />
      <PageHeader
        eyebrow="Connect"
        title="Connect Claude Code"
        lede="Four steps, about a minute. The plugin summarizes each session on your machine; you review it, and only what you approve is shared."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ol className="card p-6 sm:p-8">
          <Step n={1} title="Install the plugin">
            <p className="mb-3 text-[14px] text-ink-2">
              In Claude Code, add this repository as a plugin marketplace and install from it:
            </p>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
              <CodeLine code={`/plugin marketplace add ${repo}`} />
              <CodeLine code="/plugin install strata@strata" />
            </div>
            <p className="mt-3 text-[13.5px] text-ink-3">
              Or for one session: <span className="kbd break-all">claude --plugin-dir {repo}/clients/claude-code</span>
            </p>
          </Step>
          <Step n={2} title="Point it at this app">
            <p className="mb-3 text-[14px] text-ink-2">
              The plugin reads <span className="kbd">STRATA_URL</span> from the environment, or the server URL in its
              dashboard. Set it in <span className="kbd">~/.claude/settings.json</span> under{" "}
              <span className="kbd">env</span>, or in your shell.
            </p>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
              <CodeLine code={`STRATA_URL=${origin}`} />
            </div>
            <p className="mt-3 text-[13.5px] text-ink-3">
              Settings, sign-in and review live in <span className="kbd">/strata:dashboard</span>.
            </p>
          </Step>
          <Step n={3} title="Sign in">
            <p className="mb-3 text-[14px] text-ink-2">
              Run this in Claude Code. It opens a browser and waits; approve the code on this site.
            </p>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
              <CodeLine code="/strata:login" />
            </div>
          </Step>
          <Step n={4} title="Start a session">
            <p className="text-[14px] text-ink-2">
              Open Claude Code in any project. It writes a summary on your machine when work finishes; review and
              approve it in <span className="kbd">/strata:dashboard</span>, and only approved summaries arrive here
              {live.length && !seen ? " (this page checks every 5 seconds)" : ""}.
            </p>
          </Step>
        </ol>

        <section className="card self-start" aria-labelledby="keys-title">
          <header className="border-line border-b px-5 py-3.5">
            <h2 id="keys-title" className="font-semibold text-[15px]">
              Your keys
            </h2>
            <p className="text-[13px] text-ink-3">
              API keys are for scripts and older clients. The Claude Code plugin signs in with{" "}
              <span className="kbd">/strata:login</span>. Revoking one cuts it off at once.
            </p>
            <div className="mt-3">
              <KeyMaker origin={origin} />
            </div>
          </header>
          {keys.length ? (
            <ul className="divide-y divide-line">
              {keys.map((k) => {
                const isLive = !k.revokedAt && k.lastUsedAt && Date.now() - k.lastUsedAt.getTime() < LIVE_MS;
                const state = k.revokedAt
                  ? "Revoked"
                  : isLive
                    ? "Connected"
                    : k.lastUsedAt
                      ? "Idle"
                      : "Waiting for first use";
                return (
                  <li key={k._id.toHexString()} className={`px-5 py-4 ${k.revokedAt ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium text-[14.5px]">{k.name}</span>
                      <span
                        className={`chip ${isLive ? "status-active" : k.revokedAt ? "status-archived" : "status-candidate"}`}
                      >
                        <span className={`dot ${isLive ? "" : "dot-hollow"}`} aria-hidden /> {state}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
                      <span className="font-mono">{k.prefix}…</span>
                      {k.lastClient ? <span className="font-mono">{k.lastClient}</span> : null}
                      <span>
                        {k.lastUsedAt ? (
                          <>
                            last used <Ago at={k.lastUsedAt.toISOString()} />
                          </>
                        ) : (
                          <>
                            made <Ago at={k.createdAt.toISOString()} />
                          </>
                        )}
                      </span>
                      {!k.revokedAt ? (
                        <span className="ml-auto">
                          <RevokeButton id={k._id.toHexString()} name={k.name} />
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-6 text-[14px] text-ink-3">No keys yet. Make one in step 1.</p>
          )}
        </section>
      </div>
    </>
  );
}
