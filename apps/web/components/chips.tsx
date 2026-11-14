import type { MemoryStatus } from "@strata/contracts";

const STATUS_LABEL: Record<MemoryStatus, string> = {
  active: "Active",
  candidate: "Candidate",
  superseded: "Superseded",
  archived: "Archived",
};

export function StatusChip({ status }: { status: MemoryStatus }) {
  return (
    <span className={`chip status-${status}`}>
      <span className={`dot ${status === "active" ? "" : "dot-hollow"}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function KindChip({ kind }: { kind: string }) {
  return <span className="chip capitalize">{kind}</span>;
}
