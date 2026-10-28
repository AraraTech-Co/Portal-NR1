import { Fragment, useCallback, useEffect, useState } from "react";
import { request } from "@/api/client";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { NAV_GROUPS } from "@/layout/nav";
/*
  A forma comum do portal: o dia do desligamento, gravado sem hora, sai como
  o dia de calendário, e não como o instante passado para o fuso. [B3-1-E]
*/
import { avisoDoPapel, formatDay, ORG_ROLE_LABEL, PERMISSION_LABEL } from "@/lib/labels";
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
  permission: string;
  modules: Record<string, "read" | "write">;
  access_expires_at: string | null;
  /** active | dismissed | suspended | expired | inactive [S6-C] [CB-39] */
  status: string;
  status_since: string | null;
  status_by: string | null;
  job_role: string | null;
  registration: string | null;
  can_reset_password: boolean;
  can_change_role: boolean;
  can_suspend: boolean;
};

/**
 * Desligado, suspenso e prazo vencido apareciam todos como "Sem acesso". O
 * dono não tinha como saber quem saiu da empresa, quem foi bloqueado e quem
 * só precisa de renovação. [S6-C] [CB-39]
 */
const STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  dismissed: "Desligado",
  suspended: "Acesso suspenso",
  expired: "Prazo vencido",
  inactive: "Conta desativada",
};

function statusTone(status: string): "success" | "neutral" | "warning" {
  if (status === "active") return "success";
  if (status === "expired" || status === "suspended") return "warning";
  return "neutral";
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

type Assignable = { org_roles: string[] };

type Editing = { userId: string; org_role: string; access_until: string };

/** Hoje + n dias, no fuso de Brasília, em AAAA-MM-DD. */
function isoInDays(days: number): string {
  return new Date(Date.now() - 3 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

type Reset = { userId: string; name: string; password: string; copied: boolean };

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
  // A lista não tinha busca: o dono procurava nome por nome com Ctrl+F. [B2-1-I] [S6-C]
  const [busca, setBusca] = useState("");
  const [soSemAcesso, setSoSemAcesso] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reset, setReset] = useState<Reset | null>(null);
  const [assignable, setAssignable] = useState<Assignable>({ org_roles: [] });
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

  /** Suspender e devolver o acesso sem inventar um desligamento. [CB-44] */
  async function toggleAcesso(p: Person) {
    const suspender = p.status === "active" || p.status === "expired";
    setBusyId(p.id);
    setError(null);
    try {
      await request(`/api/pessoas-acessos/${p.id}/acesso`, {
        method: "POST",
        body: JSON.stringify({ suspend: suspender }),
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao mudar o acesso");
    } finally {
      setBusyId(null);
    }
  }

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

  const filtradas = (people ?? []).filter((p) => {
    if (soSemAcesso && p.status === "active") return false;
    const termo = semAcento(busca.trim());
    if (!termo) return true;
    return [
      p.name,
      p.login,
      p.email ?? "",
      p.registration ?? "",
      p.job_role ?? "",
      PERMISSION_LABEL[p.permission] ?? p.permission,
      STATUS_LABEL[p.status] ?? "",
    ].some((campo) => semAcento(campo).includes(termo));
  });

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
      {people && people.length > 0 && (
        <div className="people-filters">
          <label className="form-field">
            Buscar
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Nome, login, matrícula, função ou papel"
            />
          </label>
          <label className="people-check">
            <input
              type="checkbox"
              checked={soSemAcesso}
              onChange={(e) => setSoSemAcesso(e.target.checked)}
            />
            Só quem está sem acesso
          </label>
        </div>
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
              {filtradas.map((p) => {
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
                        <Chip tone={statusTone(p.status)}>
                          {STATUS_LABEL[p.status] ?? p.status}
                        </Chip>
                        {p.status === "active" && p.must_change_password && (
                          <div className="muted" style={{ marginTop: "0.2rem" }}>
                            precisa trocar a senha
                          </div>
                        )}
                        {p.status !== "active" && p.status_since && (
                          <div className="muted" style={{ marginTop: "0.2rem" }}>
                            desde {formatDay(p.status_since)}
                            {p.status_by ? ` · por ${p.status_by}` : ""}
                          </div>
                        )}
                        {p.status === "active" && p.access_expires_at && (
                          <div className="muted" style={{ marginTop: "0.2rem" }}>
                            acesso até {formatDay(p.access_expires_at)}
                          </div>
                        )}
                      </td>
                      <td>
                        {/* As ações da linha ficam lado a lado, não empilhadas. [B2-1-J] */}
                        <div className="form-actions people-row-actions">
                          <Button
                            type="button"
                            variant="ghost"
                            size="compact"
                            aria-expanded={open}
                            onClick={() => setOpenId(open ? null : p.id)}
                          >
                            {open ? "Fechar acessos" : "Ver acessos"}
                          </Button>
                          {p.can_suspend && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="compact"
                              disabled={busyId === p.id}
                              onClick={() => void toggleAcesso(p)}
                            >
                              {p.status === "suspended" ? "Devolver acesso" : "Suspender acesso"}
                            </Button>
                          )}
                          {p.can_change_role && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="compact"
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
                              size="compact"
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
                            {avisoDoPapel(editing.org_role) && editing.org_role !== p.org_role && (
                              <p className="form-hint is-warning" role="note">
                                {avisoDoPapel(editing.org_role)}
                              </p>
                            )}
                            {/* Dizia que o papel na conta vencia o da empresa.
                                Agora é um só, e é este. [OB-3] [S1-C] */}
                            <p className="muted">
                              Vale na hora, inclusive se a pessoa estiver com o portal aberto. É o
                              único papel dela: decide o que aparece no menu e o que ela pode fazer.
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
