import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createInviteLink,
  deactivateInviteLink,
  decideJoinRequest,
  fetchInviteLinks,
  fetchJoinRequests,
  type AssignableRoles,
  type InviteLink,
  type JoinRequest,
} from "@/api/invites";
import {
  fetchAccessibleAccounts,
  switchAccount,
  type AccessibleAccount,
} from "@/api/modules";
import { setToken } from "@/api/token";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { formatDay, ORG_ROLE_LABEL } from "@/lib/labels";
import "@/components/data-table.css";
import "@/components/form.css";
import { LoadingState } from "@/components/LoadingState";
import { ConsultaAcessos, FiscaisComAcesso } from "./ConsultaAcessos";
import { PessoasEAcessos } from "./PessoasEAcessos";

/** Hoje no fuso de Brasília, em AAAA-MM-DD. */
function todayIso(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** O fiscal entra por 30 dias se ninguém disser outra data. [S7-A] */
function defaultFiscalUntil(): string {
  return new Date(Date.now() - 3 * 3_600_000 + 30 * 86_400_000).toISOString().slice(0, 10);
}

function inviteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

export function AccountPage() {
  const { user, setUser } = useAuth();
  const [accounts, setAccounts] = useState<AccessibleAccount[]>([]);
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [assignable, setAssignable] = useState<AssignableRoles>({
    account_roles: ["USER"],
    org_roles: ["COLABORADOR"],
  });
  const [canManage, setCanManage] = useState(false);
  const [canDecide, setCanDecide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [roleMode, setRoleMode] = useState<"ON_APPROVE" | "FIXED">("ON_APPROVE");
  const [fixedRole, setFixedRole] = useState("USER");
  const [fixedOrgRole, setFixedOrgRole] = useState("COLABORADOR");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [decideRoles, setDecideRoles] = useState<
    Record<string, { role: string; org_role: string; access_until?: string }>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const acc = await fetchAccessibleAccounts();
    setAccounts(acc);

    let manageOk = false;
    let decideOk = false;
    try {
      const data = await fetchInviteLinks();
      setLinks(data.links);
      setAssignable(data.assignable);
      manageOk = true;
      if (data.assignable.account_roles[0]) {
        setFixedRole(data.assignable.account_roles[0]);
      }
      if (data.assignable.org_roles[0]) {
        setFixedOrgRole(data.assignable.org_roles[0]);
      }
    } catch {
      setLinks([]);
    }
    try {
      const data = await fetchJoinRequests();
      setRequests(data.requests);
      setAssignable((prev) => data.assignable ?? prev);
      decideOk = true;
      const next: Record<string, { role: string; org_role: string }> = {};
      for (const r of data.requests) {
        next[r.id] = {
          role: r.suggested_role ?? data.assignable.account_roles[0] ?? "USER",
          org_role:
            r.suggested_org_role ?? data.assignable.org_roles[0] ?? "COLABORADOR",
        };
      }
      setDecideRoles(next);
    } catch {
      setRequests([]);
    }
    setCanManage(manageOk);
    setCanDecide(decideOk);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    reload()
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload, user?.account.id]);

  async function onSwitch(accountId: string) {
    if (accountId === user?.account.id) return;
    setSwitching(accountId);
    try {
      const data = await switchAccount(accountId);
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao trocar conta");
    } finally {
      setSwitching(null);
    }
  }

  async function onCreateLink(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      const created = await createInviteLink({
        label: label.trim() || undefined,
        max_uses: maxUses ? Number(maxUses) : null,
        role_mode: roleMode,
        role: roleMode === "FIXED" ? fixedRole : undefined,
        org_role: roleMode === "FIXED" ? fixedOrgRole : undefined,
      });
      setLabel("");
      setMaxUses("");
      setRoleMode("ON_APPROVE");
      await navigator.clipboard.writeText(inviteUrl(created.link.path)).catch(() => {});
      setCopiedId(created.link.id);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao criar link");
    } finally {
      setCreating(false);
    }
  }

  async function onDeactivate(id: string) {
    setBusyId(id);
    try {
      await deactivateInviteLink(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao desativar");
    } finally {
      setBusyId(null);
    }
  }

  async function onDecide(
    id: string,
    action: "approve" | "reject",
    roleMode: JoinRequest["role_mode"],
  ) {
    setBusyId(id);
    try {
      const roles = decideRoles[id];
      await decideJoinRequest(id, {
        action,
        ...(action === "approve" && roleMode === "ON_APPROVE"
          ? {
              role: roles?.role,
              org_role: roles?.org_role,
              ...(roles?.org_role === "FISCAL"
                ? { access_until: roles.access_until || defaultFiscalUntil() }
                : {}),
            }
          : {}),
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao decidir");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Conta e usuários"
        description="Sessão, contas acessíveis, links de convite e pedidos de entrada."
      />

      {user && (
        <section className="form-section">
          <h2>Sessão</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <tbody>
                <tr>
                  <th>Nome</th>
                  <td>{user.name}</td>
                </tr>
                <tr>
                  <th>Login</th>
                  <td>{user.login}</td>
                </tr>
                <tr>
                  <th>Papel</th>
                  <td>
                    <Chip>{user.role}</Chip>
                    {user.is_master ? (
                      <span style={{ marginLeft: "0.4rem" }}>
                        <Chip tone="info">MASTER</Chip>
                      </span>
                    ) : null}
                  </td>
                </tr>
                <tr>
                  <th>Organização</th>
                  <td>{user.organization.name}</td>
                </tr>
                <tr>
                  <th>Conta ativa</th>
                  <td>{user.account.name}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {loading && <LoadingState />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {!loading && accounts.length > 0 && (
        <section className="form-section">
          <h2>Contas acessíveis</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Organização</th>
                  <th>Papel</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const active = a.id === user?.account.id;
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.name}</strong>
                      </td>
                      <td>{a.organization.name}</td>
                      <td className="muted">
                        {a.via_master
                          ? "Via MASTER"
                          : (a.account_role ?? "—")}
                      </td>
                      <td>
                        {active ? (
                          <Chip tone="success">Ativa</Chip>
                        ) : (
                          <Button
                            type="button"
                            disabled={switching === a.id}
                            onClick={() => onSwitch(a.id)}
                          >
                            {switching === a.id ? "Trocando…" : "Usar"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canDecide && (
        <section className="form-section">
          <h2>Pedidos de entrada</h2>
          {requests.length === 0 ? (
            <EmptyState
              title="Nenhum pedido pendente"
              description="Quando alguém usar um link de convite, o pedido aparece aqui."
            />
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pessoa</th>
                    <th>Cadastro</th>
                    <th>Conta</th>
                    <th>Papéis</th>
                    <th>Pedido</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.name}</strong>
                        <div className="muted">{r.email}</div>
                      </td>
                      <td>
                        {r.is_external
                          ? "Externo"
                          : (r.registration ?? "—")}
                      </td>
                      <td>
                        {r.account_name}
                        {r.invite_label ? (
                          <div className="muted">{r.invite_label}</div>
                        ) : null}
                      </td>
                      <td>
                        {r.role_mode === "FIXED" ? (
                          <span className="muted">
                            {r.suggested_role} · {r.suggested_org_role}
                          </span>
                        ) : (
                          <div className="form-grid cols-2">
                            <select
                              value={decideRoles[r.id]?.role ?? "USER"}
                              onChange={(e) =>
                                setDecideRoles((prev) => ({
                                  ...prev,
                                  [r.id]: {
                                    ...prev[r.id],
                                    role: e.target.value,
                                    org_role:
                                      prev[r.id]?.org_role ?? "COLABORADOR",
                                  },
                                }))
                              }
                            >
                              {assignable.account_roles.map((role) => (
                                <option key={role} value={role}>
                                  {role}
                                </option>
                              ))}
                            </select>
                            <select
                              value={decideRoles[r.id]?.org_role ?? "COLABORADOR"}
                              onChange={(e) =>
                                setDecideRoles((prev) => ({
                                  ...prev,
                                  [r.id]: {
                                    ...prev[r.id],
                                    role: prev[r.id]?.role ?? "USER",
                                    org_role: e.target.value,
                                  },
                                }))
                              }
                            >
                              {assignable.org_roles.map((role) => (
                                <option key={role} value={role}>
                                  {ORG_ROLE_LABEL[role] ?? role}
                                </option>
                              ))}
                            </select>
                            {decideRoles[r.id]?.org_role === "FISCAL" && (
                              <label className="form-field">
                                Acesso até
                                <input
                                  type="date"
                                  min={todayIso()}
                                  value={decideRoles[r.id]?.access_until || defaultFiscalUntil()}
                                  onChange={(e) =>
                                    setDecideRoles((prev) => ({
                                      ...prev,
                                      [r.id]: {
                                        ...prev[r.id],
                                        role: prev[r.id]?.role ?? "USER",
                                        org_role: "FISCAL",
                                        access_until: e.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="muted">{formatDay(r.created_at)}</td>
                      <td>
                        <div className="form-actions">
                          <Button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => onDecide(r.id, "approve", r.role_mode)}
                          >
                            Aceitar
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busyId === r.id}
                            onClick={() => onDecide(r.id, "reject", r.role_mode)}
                          >
                            Recusar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {canManage && (
        <section className="form-section">
          <h2>Links de convite</h2>
          <p className="muted">
            Gere um link público. Quem se cadastra fica pendente até aprovação.
            O link vale para a conta ativa ({user?.account.name}).
          </p>
          <form className="form-grid" onSubmit={onCreateLink}>
            <div className="form-grid cols-2">
              <label className="form-field">
                Rótulo (opcional)
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex.: Terceiros loja"
                  disabled={creating}
                />
              </label>
              <label className="form-field">
                Usos máximos (opcional)
                <input
                  type="number"
                  min={1}
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  disabled={creating}
                />
              </label>
            </div>
            <label className="form-field">
              Papéis
              <select
                value={roleMode}
                onChange={(e) =>
                  setRoleMode(e.target.value as "ON_APPROVE" | "FIXED")
                }
                disabled={creating}
              >
                <option value="ON_APPROVE">Definir na aprovação</option>
                <option value="FIXED">Fixos no link</option>
              </select>
            </label>
            {roleMode === "FIXED" && (
              <div className="form-grid cols-2">
                <label className="form-field">
                  Papel na conta
                  <select
                    value={fixedRole}
                    onChange={(e) => setFixedRole(e.target.value)}
                    disabled={creating}
                  >
                    {assignable.account_roles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  Papel na organização
                  <select
                    value={fixedOrgRole}
                    onChange={(e) => setFixedOrgRole(e.target.value)}
                    disabled={creating}
                  >
                    {assignable.org_roles.map((role) => (
                      <option key={role} value={role}>
                        {ORG_ROLE_LABEL[role] ?? role}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {formError && <p className="form-error">{formError}</p>}
            <div className="form-actions">
              <Button type="submit" disabled={creating}>
                {creating ? "Criando…" : "Criar link"}
              </Button>
            </div>
          </form>

          {links.length === 0 ? (
            <EmptyState
              title="Nenhum link"
              description="Crie um link para compartilhar o auto-cadastro."
            />
          ) : (
            <div className="data-table-wrap" style={{ marginTop: "1.25rem" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Link</th>
                    <th>Modo</th>
                    <th>Usos</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((link) => (
                    <tr key={link.id}>
                      <td>
                        <strong>{link.label ?? "Sem rótulo"}</strong>
                        <div className="muted" style={{ wordBreak: "break-all" }}>
                          {inviteUrl(link.path)}
                        </div>
                      </td>
                      <td className="muted">
                        {link.role_mode === "FIXED"
                          ? `${link.role} · ${link.org_role}`
                          : "Na aprovação"}
                      </td>
                      <td className="muted">
                        {link.used_count}
                        {link.max_uses != null ? ` / ${link.max_uses}` : ""}
                      </td>
                      <td>
                        {link.active ? (
                          <Chip tone="success">Ativo</Chip>
                        ) : (
                          <Chip>Inativo</Chip>
                        )}
                        {copiedId === link.id ? (
                          <span className="muted"> · Copiado</span>
                        ) : null}
                      </td>
                      <td>
                        <div className="form-actions">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                              void navigator.clipboard
                                .writeText(inviteUrl(link.path))
                                .then(() => setCopiedId(link.id));
                            }}
                          >
                            Copiar
                          </Button>
                          {link.active ? (
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={busyId === link.id}
                              onClick={() => onDeactivate(link.id)}
                            >
                              Desativar
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {canManage && <PessoasEAcessos />}
      {canManage && <FiscaisComAcesso />}
      {canManage && <ConsultaAcessos />}
    </div>
  );
}
