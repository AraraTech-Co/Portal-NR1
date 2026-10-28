import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { canalPath, canalUrl } from "@/lib/canal";
import { formatDay, ORG_ROLE_LABEL } from "@/lib/labels";
import "@/components/data-table.css";
import "@/components/form.css";
import { LoadingState } from "@/components/LoadingState";
import { ConsultaAcessos, FiscaisComAcesso } from "./ConsultaAcessos";
import { ImportPeople } from "./ImportPeople";
import { EthicsCommitteeSection } from "./EthicsCommitteeSection";
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

function menorPapelNaEmpresa(papeis: string[]): string {
  if (papeis.includes("COLABORADOR")) return "COLABORADOR";
  return papeis[0] ?? "COLABORADOR";
}

export function AccountPage() {
  /*
    As contas acessíveis vêm da sessão, não de uma busca desta tela: a troca
    também acontece pelo rodapé do menu, e as duas precisam concordar.
    [S1-K]
  */
  const { user, accounts, switchAccount } = useAuth();
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [assignable, setAssignable] = useState<AssignableRoles>({
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
  /** Último dia em que o link funciona. [S1-L] */
  const [expiresAt, setExpiresAt] = useState("");
  const [fixedOrgRole, setFixedOrgRole] = useState("COLABORADOR");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [canalCopiado, setCanalCopiado] = useState(false);

  const [decideRoles, setDecideRoles] = useState<
    Record<
      string,
      {
        org_role: string;
        /** Definidos por quem aprova, não por quem se cadastrou. [S1-M] */
        registration?: string;
        is_external?: boolean;
        access_until?: string;
      }
    >
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    let manageOk = false;
    let decideOk = false;
    try {
      const data = await fetchInviteLinks();
      setLinks(data.links);
      setAssignable(data.assignable);
      manageOk = true;
      /*
        O formulário pegava o primeiro papel da lista, que para o master é
        OWNER: quem ajustasse só o papel na empresa entregava acesso total da
        conta a todo mundo que usasse o link. O padrão é o menor. [B2-1-A]
      */
      setFixedOrgRole(menorPapelNaEmpresa(data.assignable.org_roles));
    } catch {
      setLinks([]);
    }
    try {
      const data = await fetchJoinRequests();
      setRequests(data.requests);
      setAssignable((prev) => data.assignable ?? prev);
      decideOk = true;
      const next: Record<string, { org_role: string }> = {};
      for (const r of data.requests) {
        next[r.id] = {
          org_role:
            r.suggested_org_role ?? menorPapelNaEmpresa(data.assignable.org_roles),
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

  /*
    Um lugar só: o endereço mostrado e o endereço copiado têm de ser o mesmo,
    e é a empresa da sessão que abre o canal — não a conta, que está ali ao
    lado na mesma tela. [CB-63]
  */
  const canalDaEmpresa = user
    ? canalUrl(window.location.origin, user.organization.id)
    : "";

  async function onSwitch(accountId: string) {
    if (accountId === user?.account.id) return;
    setSwitching(accountId);
    try {
      await switchAccount(accountId);
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
        expires_at: expiresAt || null,
        role_mode: roleMode,
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

  async function onDecide(id: string, action: "approve" | "reject") {
    setBusyId(id);
    try {
      const roles = decideRoles[id];
      await decideJoinRequest(id, {
        action,
        ...(action === "approve"
          ? {
              org_role: roles?.org_role,
              registration: roles?.is_external
                ? undefined
                : roles?.registration?.trim() || undefined,
              is_external: roles?.is_external ?? false,
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
        description="Sessão, canal de denúncia, contas acessíveis, links de convite e pedidos de entrada."
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
                    {/* Papel em palavra, não em código. [B2-1-C] */}
                    <Chip>{ORG_ROLE_LABEL[user.role] ?? user.role}</Chip>
                    {user.is_master ? (
                      <span style={{ marginLeft: "0.4rem" }}>
                        <Chip tone="info">Alcança todas as contas</Chip>
                      </span>
                    ) : null}
                  </td>
                </tr>
                <tr>
                  <th>Organização</th>
                  <td>{user.organization.name}</td>
                </tr>
                <tr>
                  <th>Senha</th>
                  <td>
                    {/* Trocar a própria senha, sem depender de ninguém. [B2-1-G] */}
                    {/* Parecia texto comum. [B2-1-G] */}
                    <Link to="/trocar-senha" className="btn btn-secondary btn-compact">
                      Trocar minha senha
                    </Link>
                  </td>
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

      {user && (
        <section className="form-section">
          <h2>Canal de denúncia</h2>
          <p className="muted">
            {/*
              O canal existia e o endereço não aparecia em tela nenhuma: o
              identificador da empresa é um código de 36 caracteres, e a
              empresa tinha de pedir o link ao suporte para divulgá-lo.
              [CB-63]
            */}
            Este é o endereço do canal de {user.organization.name}. Ele abre
            sem login: quem denuncia não precisa ter conta no portal, e o
            relato anônimo não guarda quem escreveu. Divulgue onde a sua gente
            vê — quadro de avisos, contracheque, intranet, contrato de
            terceiro.
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.7rem 0.8rem",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              background: "var(--muted)",
            }}
          >
            <code style={{ wordBreak: "break-all", fontSize: "0.85rem" }}>
              {canalDaEmpresa}
            </code>
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(canalDaEmpresa)
                    .then(() => setCanalCopiado(true));
                }}
              >
                {canalCopiado ? "Copiado" : "Copiar"}
              </Button>
              <Link
                to={canalPath(user.organization.id)}
                target="_blank"
                rel="noreferrer"
              >
                Abrir o canal
              </Link>
            </div>
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
                          ? "Por ser master da empresa"
                          : (ORG_ROLE_LABEL[a.org_role ?? ""] ?? a.org_role ?? "—")}
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
                        <div className="muted">{r.email ?? "sem e-mail"}</div>
                      </td>
                      {/* A pessoa não escolhe mais estes dois; quem aprova
                          define. [S1-M] [S1-Q] */}
                      <td>
                        <label
                          className="form-field"
                          style={{ flexDirection: "row", alignItems: "center", gap: "0.4rem" }}
                        >
                          <input
                            type="checkbox"
                            checked={decideRoles[r.id]?.is_external ?? false}
                            onChange={(e) =>
                              setDecideRoles((prev) => ({
                                ...prev,
                                [r.id]: {
                                  ...prev[r.id],
                                  org_role: prev[r.id]?.org_role ?? "COLABORADOR",
                                  is_external: e.target.checked,
                                },
                              }))
                            }
                          />
                          <span>Externo</span>
                        </label>
                        {!decideRoles[r.id]?.is_external && (
                          <input
                            value={decideRoles[r.id]?.registration ?? ""}
                            placeholder="Matrícula"
                            onChange={(e) =>
                              setDecideRoles((prev) => ({
                                ...prev,
                                [r.id]: {
                                  ...prev[r.id],
                                  org_role: prev[r.id]?.org_role ?? "COLABORADOR",
                                  registration: e.target.value,
                                },
                              }))
                            }
                          />
                        )}
                      </td>
                      <td>
                        {r.account_name}
                        {r.invite_label ? (
                          <div className="muted">{r.invite_label}</div>
                        ) : null}
                      </td>
                      <td>
                        {
                          /*
                            O papel fixo no link vira sugestão: quem aprova
                            pode revê-lo. Antes, o pedido chegava com o papel
                            travado — e o que o link disse valia mesmo que a
                            pessoa fosse outra coisa. [S1-P]
                          */
                          <div className="form-grid">
                            {r.role_mode === "FIXED" && (
                              <span className="form-hint">
                                O link sugeria{" "}
                                {ORG_ROLE_LABEL[r.suggested_org_role ?? ""] ??
                                  r.suggested_org_role}
                                .
                              </span>
                            )}
                            <select
                              value={decideRoles[r.id]?.org_role ?? "COLABORADOR"}
                              onChange={(e) =>
                                setDecideRoles((prev) => ({
                                  ...prev,
                                  [r.id]: {
                                    ...prev[r.id],
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
                                        org_role: "FISCAL",
                                        access_until: e.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                            )}
                          </div>
                        }
                      </td>
                      <td className="muted">{formatDay(r.created_at)}</td>
                      <td>
                        <div className="form-actions">
                          <Button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => onDecide(r.id, "approve")}
                          >
                            Aceitar
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busyId === r.id}
                            onClick={() => onDecide(r.id, "reject")}
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
                  placeholder="Ex.: turma da manutenção"
                  disabled={creating}
                />
                {/* "Rótulo" e "usos máximos" não se explicavam. [S1-L] */}
                <span className="form-hint">
                  Um nome só para você reconhecer o link nesta lista. Quem
                  recebe o link não vê.
                </span>
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
                <span className="form-hint">
                  Quantas pessoas podem se cadastrar por este link. Em branco,
                  quantas vierem.
                </span>
              </label>
            </div>
            <label className="form-field">
              Vale até (opcional)
              <input
                type="date"
                min={todayIso()}
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={creating}
              />
              {/*
                O portal já recusava link vencido; só não havia como informar
                a validade. [S1-L]
              */}
              <span className="form-hint">
                Depois desse dia o link para de funcionar. Em branco, vale até
                alguém desativar.
              </span>
            </label>
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
              /* Um papel só: o da empresa. [OB-3] [S1-C] */
              <div className="form-grid">
                <label className="form-field">
                  Papel na empresa
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
                    <th>Papel</th>
                    <th>Usos</th>
                    {/* Quem entrou por cada link, e até quando ele vale. [S5-I] */}
                    <th>Quem usou</th>
                    <th>Situação</th>
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
                          ? (ORG_ROLE_LABEL[link.org_role ?? ""] ?? link.org_role)
                          : "Na aprovação"}
                      </td>
                      <td className="muted">
                        {link.used_count}
                        {link.max_uses != null ? ` / ${link.max_uses}` : ""}
                      </td>
                      <td className="muted">
                        {link.used_by.length === 0 ? (
                          "ninguém ainda"
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                            {link.used_by.map((u, i) => (
                              <li key={`${link.id}-${i}`}>
                                {u.name}
                                {u.status === "PENDING" && " (esperando aprovação)"}
                                {u.status === "REJECTED" && " (recusado)"}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td>
                        {/* A situação vem do servidor: era calculada em dois lugares. */}
                        {link.situation === "off" ? (
                          <Chip>Desligado</Chip>
                        ) : link.situation === "exhausted" ? (
                          <Chip tone="neutral">Esgotado</Chip>
                        ) : link.situation === "expired" ? (
                          <Chip tone="neutral">Vencido</Chip>
                        ) : (
                          <Chip tone="success">Ativo</Chip>
                        )}
                        {link.expires_at && (
                          <div className="muted" style={{ fontSize: "0.78rem" }}>
                            vale até {formatDay(link.expires_at)}
                          </div>
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

      {canManage && <ImportPeople />}
      {canManage && <PessoasEAcessos />}
      {/* Quem é o comitê de ética é decisão de acesso. [CB-27] */}
      {canManage && <EthicsCommitteeSection />}
      {canManage && <FiscaisComAcesso />}
      {canManage && <ConsultaAcessos />}
    </div>
  );
}
