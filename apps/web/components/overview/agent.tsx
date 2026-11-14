// "Your agent", last on the overview: the person's own Claude Code connection, and for people who use memory, what a
// new session is given at its start. With no key yet, a way to connect instead.
import type { MemoryHit } from "@strata/contracts";
import { ArrowRight, Cable } from "lucide-react";
import Link from "next/link";
import type { AgentHome } from "../../server/hub/overview.ts";
import { FrozenPreview } from "../frozen.tsx";
import { Ago } from "../time.tsx";

function ConnectBanner() {
  return (
    <Link
      href="/connect"
      className="card flex flex-wrap items-center gap-4 border-accent/30 bg-accent-soft p-5 transition-transform hover:-translate-y-px"
    >
      <span className="grid size-11 place-items-center rounded-[12px] bg-accent text-accent-ink">
        <Cable size={20} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-[16px]">Connect Claude Code</span>
        <span className="block text-[14px] text-ink-2">
          Make an API key, install the plugin, and your next session starts remembering.
        </span>
      </span>
      <ArrowRight size={18} aria-hidden className="text-accent-text" />
    </Link>
  );
}

function Connection({ agent }: { agent: AgentHome }) {
  const { lastSeen, live } = agent;
  return (
    <section className="card p-5" aria-labelledby="conn-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="conn-title" className="font-semibold text-[15px]">
          Claude Code
        </h3>
        <span className={`chip ${live ? "status-active" : lastSeen ? "" : "status-candidate"}`}>
          <span className={`dot ${live ? "" : "dot-hollow"}`} aria-hidden />
          {live ? "Connected" : lastSeen ? "Idle" : "Not connected yet"}
        </span>
      </div>
      {lastSeen ? (
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-ink-3">Last seen</dt>
          <dd>
            <Ago at={lastSeen.at} />
          </dd>
          <dt className="text-ink-3">Key</dt>
          <dd className="truncate">{lastSeen.key}</dd>
          <dt className="text-ink-3">Client</dt>
          <dd className="truncate font-mono text-[13px]">{lastSeen.client ?? "unknown"}</dd>
        </dl>
      ) : (
        <p className="mt-3 text-[14px] text-ink-3">
          You have a key; start a Claude Code session with the plugin and it shows up here.
        </p>
      )}
      <Link href="/connect" className="btn btn-sm mt-4 max-md:min-h-11">
        Manage keys
      </Link>
    </section>
  );
}

export function YourAgent({ agent, block }: { agent: AgentHome; block: MemoryHit[] | null }) {
  const preview = agent.project && block ? <FrozenPreview memories={block} project={agent.project} /> : null;
  return (
    <section aria-labelledby="agent-title" className="mt-10">
      <h2 id="agent-title" className="font-semibold text-[16px]">
        Your agent
      </h2>
      <p className="mt-0.5 mb-3 text-[13.5px] text-ink-3">
        Your own Claude Code connection, and what your sessions are told at their start. Nobody else sees this.
      </p>
      {agent.keys === 0 ? (
        <div className="flex flex-col gap-6">
          <ConnectBanner />
          {preview}
        </div>
      ) : preview ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="min-w-0">{preview}</div>
          <div className="min-w-0">
            <Connection agent={agent} />
          </div>
        </div>
      ) : (
        <div className="max-w-xl">
          <Connection agent={agent} />
        </div>
      )}
    </section>
  );
}
