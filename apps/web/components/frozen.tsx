// What a Claude Code session is given at its start, byte for byte: the frozen block the plugin keeps for the whole
// session. Shown so people can see exactly what their agents are told.
import { createHash } from "node:crypto";
import type { MemoryHit } from "@strata/contracts";
import { renderFrozen } from "@strata/contracts";
import { Lock } from "lucide-react";

export function FrozenPreview({ memories, project }: { memories: MemoryHit[]; project: string }) {
  const block = renderFrozen(memories);
  const bytes = Buffer.byteLength(block, "utf8");
  const sha = createHash("sha256").update(block).digest("hex").slice(0, 10);
  return (
    <section className="card overflow-hidden" aria-labelledby="frozen-title">
      <header className="flex flex-wrap items-center justify-between gap-2 border-line border-b px-5 py-3.5">
        <div>
          <h2 id="frozen-title" className="font-semibold text-[15px]">
            What Claude sees at the start of a session
          </h2>
          <p className="text-[13px] text-ink-3">
            Project <span className="font-mono text-ink-2">{project}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip chip-mono">{bytes.toLocaleString()} bytes</span>
          <span className="chip chip-mono">sha {sha}</span>
          <span className="chip status-active">
            <Lock size={12} aria-hidden /> Same bytes all session
          </span>
        </div>
      </header>
      {block ? (
        <pre className="ledger max-h-80 overflow-auto px-5 py-3">{block}</pre>
      ) : (
        <p className="ledger px-5 py-4 text-ink-3">
          Nothing yet. Once this project has active memories, they're given to every new session here, and the bytes
          stay the same until the session compacts.
        </p>
      )}
    </section>
  );
}
