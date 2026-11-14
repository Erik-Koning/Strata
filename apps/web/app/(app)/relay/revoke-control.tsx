"use client";
// Revoking, with an inline confirmation and a reason the recipient sees. From the moment it's revoked, every read of the
// handoff by the recipient answers as if it never existed.
import type { HandoffStatus } from "@strata/contracts";
import { Ban } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { revoke } from "./actions.ts";

export function RevokeControl({
  id,
  status,
  recipient,
}: {
  id: string;
  status: HandoffStatus;
  recipient: string | null;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = useId();
  if (!asking)
    return (
      <button
        type="button"
        className="btn btn-quiet btn-sm min-h-11 text-danger sm:min-h-8"
        onClick={() => setAsking(true)}
      >
        <Ban size={14} aria-hidden /> Revoke
      </button>
    );
  return (
    <div className="w-full basis-full rounded-[12px] border border-danger/30 bg-danger-soft px-4 py-3">
      <p className="font-medium text-[14px] text-danger">
        {status === "draft"
          ? "Revoke this draft? It was never shared, and it can't be approved afterwards."
          : `Revoke it? ${recipient ?? "The recipient"} loses access at once, even mid-session.`}
      </p>
      <label htmlFor={field} className="label mt-2.5">
        Reason <span className="font-normal text-ink-3">(optional{status === "draft" ? "" : ", they see it"})</span>
      </label>
      <input
        id={field}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        className="input"
        placeholder="Reassigned to another team"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-danger btn-sm min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await revoke(id, reason);
              if (result.error) setError(result.error);
              else setAsking(false);
            })
          }
        >
          {pending ? "Revoking…" : "Revoke now"}
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={() => {
            setAsking(false);
            setError(null);
          }}
        >
          Cancel
        </button>
        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
