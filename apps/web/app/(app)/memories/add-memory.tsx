"use client";
import { Plus } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { type AddState, addMemory } from "./actions.ts";

export function AddMemory({ projects }: { projects: string[] }) {
  const [state, action, pending] = useActionState<AddState, FormData>(addMemory, { error: null, saved: 0 });
  const form = useRef<HTMLFormElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (state.saved) {
      form.current?.reset();
      if (details.current) details.current.open = false;
    }
  }, [state.saved]);
  return (
    <details ref={details} className="group sm:relative">
      <summary className="btn btn-primary btn-sm w-fit cursor-pointer list-none">
        <Plus size={14} aria-hidden /> Add a memory
      </summary>
      {/* Opens as a sheet under the button, over the page, so the list below doesn't jump. */}
      <form
        ref={form}
        action={action}
        className="card absolute inset-x-4 z-30 mt-2 grid gap-4 p-5 shadow-[var(--shadow-pop)] sm:inset-x-auto sm:right-0 sm:w-[min(680px,calc(100vw-3rem))] sm:grid-cols-[minmax(0,1fr)_180px_180px]"
      >
        <div className="sm:col-span-3">
          <label className="label" htmlFor="text">
            What should your agents remember?
          </label>
          <textarea
            id="text"
            name="text"
            className="input"
            placeholder="We deploy from the release branch, never from main."
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="kind">
            Kind
          </label>
          <select id="kind" name="kind" className="input" defaultValue="convention">
            <option value="preference">Preference</option>
            <option value="convention">Convention</option>
            <option value="decision">Decision</option>
            <option value="fact">Fact</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="project">
            Project
          </label>
          <input id="project" name="project" className="input" list="project-list" placeholder="All projects" />
          <datalist id="project-list">
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn btn-primary min-h-10 w-full" disabled={pending}>
            {pending ? "Saving…" : "Save memory"}
          </button>
        </div>
        {state.error ? (
          <p role="alert" className="text-[14px] text-danger sm:col-span-3">
            {state.error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
