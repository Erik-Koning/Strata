"use client";
import { LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";

// A button that asks once before it acts, and shows why if the action is refused.
export function ConfirmButton({
  label,
  confirm,
  action,
  danger = false,
}: {
  label: string;
  confirm: string;
  action: () => Promise<{ error: string | null }>;
  danger?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col items-end gap-1.5">
      {asking ? (
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            className={`btn btn-sm min-h-11 sm:min-h-8 ${danger ? "btn-danger" : "btn-primary"}`}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await action();
                setError(result.error);
                setAsking(false);
              })
            }
          >
            {pending ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : null}
            {confirm}
          </button>
          <button type="button" className="btn btn-quiet btn-sm min-h-11 sm:min-h-8" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={`btn btn-quiet btn-sm min-h-11 sm:min-h-8 ${danger ? "text-danger" : ""}`}
          onClick={() => {
            setError(null);
            setAsking(true);
          }}
        >
          {label}
        </button>
      )}
      {error ? (
        <span role="alert" className="max-w-[260px] text-right text-[12.5px] text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
