"use client";
// The admin page's interactive pieces. Every change goes through a server action that checks the caller again.
import { LoaderCircle, Plus, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { CodeLine } from "../../../components/copy.tsx";
import { ROLE_HINTS, ROLE_LABELS, ROLES, type Role } from "../../../server/access.ts";
import { addTeam, type InviteState, makeInvite, placePerson, type Result, type TeamState } from "./actions.ts";

function Problem({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[13.5px] text-danger">
      {error}
    </p>
  );
}

export function RoleSelect({
  name,
  role,
  action,
}: {
  name: string;
  role: Role;
  action: (role: Role) => Promise<Result>;
}) {
  const [value, setValue] = useState<Role>(role);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setValue(role), [role]);
  return (
    <span className="flex flex-col items-end gap-1.5">
      <select
        className="input min-h-11 w-auto py-0 text-[14px] sm:min-h-9"
        aria-label={`Role for ${name}`}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as Role;
          setValue(next);
          start(async () => {
            const result = await action(next);
            setError(result.error);
            if (result.error) setValue(role);
          });
        }}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="max-w-[260px] text-right text-[12.5px] text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function InviteForm({ teams }: { teams: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(makeInvite, {
    link: null,
    email: "",
    error: null,
  });
  const [role, setRole] = useState<Role>("engineer");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.link) form.current?.reset();
  }, [state.link]);
  return (
    <div className="flex flex-col gap-4">
      <form ref={form} action={action} className="flex flex-col gap-4" noValidate>
        <div>
          <label className="label" htmlFor="invite-email">
            Email
          </label>
          <input
            className="input"
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder="name@company.com"
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="invite-role">
            Role
          </label>
          <select
            className="input"
            id="invite-role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            aria-describedby="invite-role-hint"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <p id="invite-role-hint" className="mt-1.5 text-[13px] text-ink-3">
            {ROLE_HINTS[role]}
          </p>
        </div>
        {teams.length ? (
          <fieldset>
            <legend className="label">{role === "manager" ? "Teams they manage" : "Teams they're in"}</legend>
            <div className="flex flex-wrap gap-2">
              {teams.map((t) => (
                <label
                  key={t.id}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-line-strong px-3 text-[14px] sm:min-h-9"
                >
                  <input type="checkbox" name="team" value={t.id} className="size-4 accent-[var(--accent)]" />
                  {t.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <Problem error={state.error} />
        <button type="submit" className="btn btn-primary min-h-11" disabled={pending}>
          {pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : null}
          Make an invite link
        </button>
      </form>
      {state.link ? (
        <div className="rounded-[12px] border border-line bg-surface-2 p-4" aria-live="polite">
          <p className="mb-2 font-medium text-[14px]">Invite link for {state.email}</p>
          <CodeLine code={state.link} />
          <p className="mt-2 text-[13px] text-ink-3">
            Send it to them yourself. It's shown once, works once, only for that email, and expires in 7 days.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function NewTeam() {
  const [state, action, pending] = useActionState<TeamState, FormData>(addTeam, { error: null, made: 0 });
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.made) form.current?.reset();
  }, [state.made]);
  return (
    <form ref={form} action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="team-name">
          Team name
        </label>
        <input
          className="input min-w-0 flex-1"
          id="team-name"
          name="name"
          placeholder="New team, e.g. Payments"
          maxLength={60}
          required
        />
        <button type="submit" className="btn min-h-11 flex-none" disabled={pending}>
          <Plus size={15} aria-hidden /> Add team
        </button>
      </div>
      <Problem error={state.error} />
    </form>
  );
}

interface Someone {
  id: string;
  name: string;
  role: Role;
}

export function TeamPeople({
  teamId,
  teamName,
  inTeam,
  everyone,
}: {
  teamId: string;
  teamName: string;
  inTeam: (Someone & { manager: boolean })[];
  everyone: Someone[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const outside = everyone.filter((p) => !inTeam.some((m) => m.id === p.id));
  const [who, setWho] = useState("");
  const chosen = outside.find((p) => p.id === who);
  const run = (work: () => Promise<Result>) =>
    start(async () => {
      const result = await work();
      setError(result.error);
      if (!result.error) setWho("");
    });
  return (
    <div className="flex flex-col gap-3">
      {inTeam.length ? (
        <ul className="flex flex-col gap-1">
          {inTeam.map((m) => (
            <li key={m.id} className="flex min-h-9 items-center gap-2 text-[14px]">
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              {m.manager ? <span className="chip status-active">Manager</span> : null}
              <button
                type="button"
                className="btn btn-quiet btn-sm min-h-11 px-2 sm:min-h-8"
                disabled={pending}
                aria-label={`Take ${m.name} out of ${teamName}`}
                onClick={() => run(() => placePerson(teamId, m.id, null))}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13.5px] text-ink-3">No one yet.</p>
      )}
      {outside.length ? (
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor={`add-${teamId}`}>
            Add someone to {teamName}
          </label>
          <select
            id={`add-${teamId}`}
            className="input min-h-11 min-w-0 basis-full text-[14px] sm:min-h-9"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">Add someone…</option>
            {outside.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {ROLE_LABELS[p.role]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm min-h-11 flex-1 sm:min-h-9"
            disabled={!chosen || pending}
            onClick={() => chosen && run(() => placePerson(teamId, chosen.id, "member"))}
          >
            As member
          </button>
          <button
            type="button"
            className="btn btn-sm min-h-11 flex-1 sm:min-h-9"
            disabled={chosen?.role !== "manager" || pending}
            title={
              chosen && chosen.role !== "manager" ? "Only people whose role is Manager can manage a team" : undefined
            }
            onClick={() => chosen && run(() => placePerson(teamId, chosen.id, "manager"))}
          >
            As manager
          </button>
        </div>
      ) : null}
      <Problem error={error} />
    </div>
  );
}
