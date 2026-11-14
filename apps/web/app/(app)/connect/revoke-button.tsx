"use client";
import { useState, useTransition } from "react";
import { revoke } from "./actions.ts";

export function RevokeButton({ id, name }: { id: string; name: string }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  if (!asking)
    return (
      <button
        type="button"
        className="btn btn-quiet btn-sm min-h-11 text-danger sm:min-h-8"
        onClick={() => setAsking(true)}
      >
        Revoke
      </button>
    );
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        className="btn btn-danger btn-sm min-h-11 sm:min-h-8"
        disabled={pending}
        onClick={() => start(() => revoke(id))}
        aria-label={`Revoke ${name} now`}
      >
        {pending ? "Revoking…" : "Revoke now"}
      </button>
      <button type="button" className="btn btn-quiet btn-sm min-h-11 sm:min-h-8" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
