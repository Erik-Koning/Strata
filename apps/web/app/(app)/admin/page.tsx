import type { Metadata } from "next";
import { Ago } from "../../../components/time.tsx";
import { ROLE_LABELS } from "../../../server/access.ts";
import { listOpenInvites } from "../../../server/invites.ts";
import { listPeople, listTeams } from "../../../server/people.ts";
import { requireAdmin } from "../../../server/viewer.ts";
import { PageHeader } from "../page-header.tsx";
import { cancelInvite, changeRole, removeTeam, restorePerson, suspendPerson } from "./actions.ts";
import { ConfirmButton, InviteForm, NewTeam, RoleSelect, TeamPeople } from "./controls.tsx";

export const metadata: Metadata = { title: "People" };

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export default async function AdminPage() {
  const viewer = await requireAdmin();
  const [everyone, teams, open] = await Promise.all([listPeople(), listTeams(), listOpenInvites()]);
  const byId = new Map(everyone.map((p) => [p.id, p]));
  const teamOptions = teams.map((t) => ({ id: t._id.toHexString(), name: t.name }));

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="People and access"
        lede="Invite people, choose what they can see, and cut off access. No one, admins included, can read another person's memory from here."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="card self-start" aria-labelledby="people-title">
          <header className="border-line border-b px-5 py-3.5">
            <h2 id="people-title" className="font-semibold text-[15px]">
              People <span className="font-normal text-ink-3">· {everyone.length}</span>
            </h2>
            <p className="text-[13px] text-ink-3">
              A role decides what someone's home view leads with. Approved records are for everyone; private memory is
              its owner's alone. Suspending ends their sessions and revokes their keys at once.
            </p>
          </header>
          <ul className="divide-y divide-line">
            {everyone.map((p) => {
              const you = p.id === viewer.userId;
              return (
                <li key={p.id} className={`px-5 py-4 ${p.suspended ? "bg-sunk" : ""}`}>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="truncate font-medium text-[14.5px]">
                        {p.name}
                        {you ? <span className="font-normal text-ink-3"> (you)</span> : null}
                      </p>
                      <p className="truncate text-[13px] text-ink-3">{p.email}</p>
                      {p.suspended || p.teams.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {p.suspended ? <span className="chip status-candidate">Suspended</span> : null}
                          {p.teams.map((t) => (
                            <span key={t.id} className="chip">
                              {t.manager ? "Manages " : ""}
                              {t.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="mt-2 text-[12.5px] text-ink-3">
                        {n(p.liveKeys, "live API key")} · joined <Ago at={p.joinedAt.toISOString()} />
                      </p>
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      <RoleSelect name={p.name} role={p.role} action={changeRole.bind(null, p.id)} />
                      {you ? null : p.suspended ? (
                        <ConfirmButton
                          label="Restore"
                          confirm="Restore access"
                          action={restorePerson.bind(null, p.id)}
                        />
                      ) : (
                        <ConfirmButton
                          label="Suspend"
                          confirm="Suspend now"
                          danger
                          action={suspendPerson.bind(null, p.id)}
                        />
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="flex flex-col gap-6">
          <section className="card p-5" aria-labelledby="invite-title">
            <h2 id="invite-title" className="font-semibold text-[15px]">
              Invite someone
            </h2>
            <p className="mb-4 text-[13px] text-ink-3">
              Accounts are by invitation only. The link makes their account with the role and teams you choose here.
            </p>
            <InviteForm teams={teamOptions} />
          </section>

          <section className="card" aria-labelledby="open-title">
            <header className="border-line border-b px-5 py-3.5">
              <h2 id="open-title" className="font-semibold text-[15px]">
                Open invitations <span className="font-normal text-ink-3">· {open.length}</span>
              </h2>
            </header>
            {open.length ? (
              <ul className="divide-y divide-line">
                {open.map((i) => (
                  <li key={i._id.toHexString()} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px]">{i.email}</p>
                      <p className="text-[12.5px] text-ink-3">
                        {ROLE_LABELS[i.role]} · made <Ago at={i.createdAt.toISOString()} /> by{" "}
                        {i.createdBy.id === viewer.userId ? "you" : i.createdBy.label}
                      </p>
                    </div>
                    <ConfirmButton
                      label="Revoke"
                      confirm="Revoke link"
                      danger
                      action={cancelInvite.bind(null, i._id.toHexString())}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-[13.5px] text-ink-3">None waiting.</p>
            )}
          </section>
        </div>
      </div>

      <section className="card mt-6" aria-labelledby="teams-title">
        <header className="flex flex-wrap items-end justify-between gap-4 border-line border-b px-5 py-4">
          <div className="min-w-0 max-w-xl">
            <h2 id="teams-title" className="font-semibold text-[15px]">
              Teams <span className="font-normal text-ink-3">· {teams.length}</span>
            </h2>
            <p className="text-[13px] text-ink-3">
              A manager's home view starts with the teams they manage: what shipped and who worked on it, never counts
              or rankings of people. Only people whose role is Manager can manage a team.
            </p>
          </div>
          <div className="w-full sm:w-[360px]">
            <NewTeam />
          </div>
        </header>
        {teams.length ? (
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {teams.map((t) => {
              const id = t._id.toHexString();
              const inTeam = [
                ...t.managerIds.map((uid) => ({ uid, manager: true })),
                ...t.memberIds.map((uid) => ({ uid, manager: false })),
              ].flatMap(({ uid, manager }) => {
                const p = byId.get(uid);
                return p ? [{ id: p.id, name: p.name, role: p.role, manager }] : [];
              });
              return (
                <div key={id} className="rounded-[12px] border border-line p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="min-w-0 flex-1 truncate font-semibold text-[14.5px]">{t.name}</h3>
                    <ConfirmButton label="Delete" confirm="Delete team" danger action={removeTeam.bind(null, id)} />
                  </div>
                  <TeamPeople
                    teamId={id}
                    teamName={t.name}
                    inTeam={inTeam}
                    everyone={everyone.map((p) => ({ id: p.id, name: p.name, role: p.role }))}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-5 py-6 text-[13.5px] text-ink-3">No teams yet. Add one above, then put people in it.</p>
        )}
      </section>
    </>
  );
}
