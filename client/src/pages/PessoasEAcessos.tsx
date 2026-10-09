import { Fragment, useCallback, useEffect, useState } from "react";
import { request } from "@/api/client";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { NAV_GROUPS } from "@/layout/nav";
import { ORG_ROLE_LABEL, PERMISSION_LABEL } from "@/lib/labels";
import "@/components/form.css";
import "./pessoas-acessos.css";

type Person = {
  id: string;
  name: string;
  login: string;
  email: string | null;
  active: boolean;
  must_change_password: boolean;
  org_role: string;
  account_role: string | null;
  permission: string;
  modules: Record<string, "read" | "write">;
  access_expires_at: string | null;
  job_role: string | null;
  registration: string | null;
  can_reset_password: boolean;
  can_change_role: boolean;
};

type Assignable = { account_roles: string[]; org_roles: string[] };

type Editing = { userId: string; org_role: string; account_role: string | null; access_until: string };

const ACCOUNT_ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner da conta",
  ADMIN: "Admin da conta",
  USER: "Usuário da conta",
};

/** Hoje + n dias, no fuso de Brasília, em AAAA-MM-DD. */
function isoInDays(days: number): string {
  return new Date(Date.now() - 3 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

type Reset = { userId: string; name: string; password: string; copied: boolean };

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** O que a pessoa faz em cada tela, agrupado como no menu. */
function Acessos({ modules }: { modules: Person["modules"] }) {
  const groups = NAV_GROUPS.map((g) => ({
    title: g.title,
    items: g.items.filter((i) => modules[i.moduleId]),
  })).filter((g) => g.items.length > 0);

  if (groups.length === 0) return <p className="muted">Nenhuma tela liberada.</p>;
  return (
    <div className="people-access-groups">
      {groups.map((g) => (
        <div key={g.title}>
          <h4>{g.title}</h4>
          <ul>
            {g.items.map((i) => (
              <li key={i.moduleId}>
                <span>{i.label}</span>
                {modules[i.moduleId] === "write" ? (
                  <Chip tone="info">Lê e grava</Chip>
                ) : (
                  <Chip>Só lê</Chip>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Quem está na organização, com o papel e o acesso de cada um [S1-B], e
 * redefinir a senha de quem está abaixo [S1-D]. Fica em Conta e usuários.
 */
export function PessoasEAcessos() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reset, setReset] = useState<Reset | null>(null);
  const [assignable, setAssignable] = useState<Assignable>({ account_roles: [], org_roles: [] });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await request<{ people: Person[]; assignable: Assignable }>("/api/pessoas-acessos");
    setPeople(data.people);
    setAssignable(data.assignable);
  }, []);

  function startEdit(p: Person) {
    setEditError(null);
    setEditing({
      userId: p.id,
      org_role: p.org_role,
      account_role: p.account_role,
      access_until: p.access_expires_at
        ? new Date(new Date(p.access_expires_at).getTime() - 3 * 3_600_000).toISOString().slice(0, 10)
        : isoInDays(30),
    });
  }

  /** Muda o papel de quem já foi aprovado. [S1-O] */
  async function saveRole(p: Person) {
    if (!editing) return;
    setBusyId(p.id);
    setEditError(null);
    try {
      await request(`/api/pessoas-acessos/${p.id}/papel`, {
        method: "PATCH",
        body: JSON.stringify({
          org_role: editing.org_role,
          ...(editing.account_role && editing.account_role !== p.account_role
            ? { account_role: editing.account_role }
            : {}),
          ...(editing.org_role === "FISCAL" ? { access_until: editing.access_until } : {}),
        }),
      });
      setEditing(null);
      await reload();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Falha ao mudar o papel");
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, [reload]);

  async function onReset(p: Person) {
    const ok = window.confirm(
      `Redefinir a senha de ${p.name}?\n\nA sessão aberta dela cai, e no próximo acesso ela entra com uma senha provisória e precisa trocar.`,
    );
    if (!ok) return;
    setBusyId(p.id);
    setError(null);
    setReset(null);
    try {
      const data = await request<{ temporary_password: string }>(
        `/api/pessoas-acessos/${p.id}/redefinir-senha`,
        { method: "POST" },
      );
      setReset({ userId: p.id, name: p.name, password: data.temporary_password, copied: false });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao redefinir a senha");
    } finally {
      setBusyId(null);
    }
  }

  async function copy() {
    if (!reset) return;
    try {
      await navigator.clipboard.writeText(reset.password);
      setReset({ ...reset, copied: true });
    } catch {
      /* a senha continua na tela para copiar à mão */
    }
  }

  return (
    <section className="form-section">
      <h2>Pessoas e acessos</h2>
      <p className="muted">
        Quem está na organização, com que papel e o que pode fazer em cada tela.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!error && people === null && <p className="muted">Carregando…</p>}
      {people && (
        <div className="data-table-wrap people-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Papel</th>
                <th>Situação</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const open = openId === p.id;
                const showReset = reset?.userId === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr className={open ? "is-open" : undefined}>
                      <td>
                        <strong>{p.name}</strong>
                        <div className="muted">{p.email ?? p.login}</div>
                        {(p.job_role || p.registration) && (
                          <div className="muted">
                            {[p.job_role, p.registration && `matrícula ${p.registration}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                      </td>
                      <td>
                        {PERMISSION_LABEL[p.permission] ?? p.permission}
                        {ORG_ROLE_LABEL[p.org_role] &&
                          ORG_ROLE_LABEL[p.org_role] !== PERMISSION_LABEL[p.permission] && (
                            <div className="muted">na empresa: {ORG_ROLE_LABEL[p.org_role]}</div>
                          )}
                      </td>
                      <td>
                        {!p.active ? (
                          <Chip tone="neutral">Sem acesso</Chip>
                        ) : p.must_change_password ? (
                          <Chip tone="warning">Precisa trocar a senha</Chip>
                        ) : (
                          <Chip tone="success">Ativo</Chip>
                        )}
                        {p.access_expires_at && (
                          <div className="muted" style={{ marginTop: "0.2rem" }}>
                            acesso até {formatDay(p.access_expires_at)}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="form-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            aria-expanded={open}
                            onClick={() => setOpenId(open ? null : p.id)}
                          >
                            {open ? "Fechar acessos" : "Ver acessos"}
                          </Button>
                          {p.can_change_role && (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busyId === p.id}
                              onClick={() => (editing?.userId === p.id ? setEditing(null) : startEdit(p))}
                            >
                              Mudar papel
                            </Button>
                          )}
                          {p.can_reset_password && (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busyId === p.id}
                              onClick={() => void onReset(p)}
                            >
                              {busyId === p.id ? "Redefinindo…" : "Redefinir senha"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {editing?.userId === p.id && (
                      <tr className="people-expand">
                        <td colSpan={4}>
                          <div className="people-panel people-edit">
                            <div className="form-grid cols-2">
                              <label className="form-field">
                                Papel na empresa
                                <select
                                  value={editing.org_role}
                                  onChange={(e) => setEditing({ ...editing, org_role: e.target.value })}
                                >
                                  {[...new Set([p.org_role, ...assignable.org_roles])].map((r) => (
                                    <option key={r} value={r}>
                                      {ORG_ROLE_LABEL[r] ?? r}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {p.account_role && (
                                <label className="form-field">
                                  Papel na conta
                                  <select
                                    value={editing.account_role ?? p.account_role}
                                    disabled={!assignable.account_roles.includes(p.account_role)}
                                    onChange={(e) => setEditing({ ...editing, account_role: e.target.value })}
                                  >
                                    {[...new Set([p.account_role, ...assignable.account_roles])].map((r) => (
                                      <option key={r} value={r}>
                                        {ACCOUNT_ROLE_LABEL[r] ?? r}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              {editing.org_role === "FISCAL" && (
                                <label className="form-field">
                                  Acesso até
                                  <input
                                    type="date"
                                    min={isoInDays(0)}
                                    value={editing.access_until}
                                    onChange={(e) => setEditing({ ...editing, access_until: e.target.value })}
                                  />
                                </label>
                              )}
                            </div>
                            <p className="muted">
                              Vale na hora, inclusive se a pessoa estiver com o portal aberto. O papel na
                              conta, quando é Admin ou Owner, vale mais que o papel na empresa.
                            </p>
                            {editError && (
                              <p className="form-error" role="alert">
                                {editError}
                              </p>
                            )}
                            <div className="form-actions">
                              <Button type="button" disabled={busyId === p.id} onClick={() => void saveRole(p)}>
                                {busyId === p.id ? "Salvando…" : "Salvar papel"}
                              </Button>
                              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    {showReset && reset && (
                      <tr className="people-expand">
                        <td colSpan={4}>
                          <div className="people-panel people-reset" role="status">
                            <p>
                              Senha provisória de <strong>{reset.name}</strong>:
                            </p>
                            <div className="people-reset-row">
                              <code>{reset.password}</code>
                              <Button type="button" variant="secondary" onClick={() => void copy()}>
                                {reset.copied ? "Copiada" : "Copiar"}
                              </Button>
                              <Button type="button" variant="ghost" onClick={() => setReset(null)}>
                                Pronto
                              </Button>
                            </div>
                            <p className="muted">
                              Passe só para a pessoa. Ela troca no primeiro acesso, e esta senha não
                              aparece de novo.
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                    {open && (
                      <tr className="people-expand">
                        <td colSpan={4}>
                          <div className="people-panel">
                            <Acessos modules={p.modules} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
