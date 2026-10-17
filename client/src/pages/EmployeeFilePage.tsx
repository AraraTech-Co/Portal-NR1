import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  dismissEmployee,
  fetchEmployeeFile,
  reinstateEmployee,
  updateEmployeeProfile,
  REQUIREMENT_STATUS_LABEL,
  WORKER_BOND_LABEL,
  type EmployeeFile,
} from "@/api/people";
import { fetchContractorList } from "@/api/contractors";
import { fetchJobRoles, type JobRole } from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import {
  ACTION_STATUS_LABEL,
  EXAM_KIND_LABEL,
  formatDay,
  isOverdue,
  ORG_ROLE_LABEL,
} from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/form.css";
import "./people.css";

function hojeIso(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** CPF legível: a ficha é para ler, não para conferir dígito a dígito. */
function formatCpf(value: string | null): string {
  const d = (value ?? "").replace(/\D/g, "");
  if (d.length !== 11) return value ?? "—";
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "ok") return "success";
  if (status === "rejected") return "danger";
  if (status === "pending") return "neutral";
  return "warning";
}

const AUDIT_LABEL: Record<string, string> = {
  "employee_profile.create": "Ficha criada",
  "employee_profile.update": "Ficha alterada",
  "employee_profile.dismiss": "Desligamento registrado",
  "employee_profile.reinstate": "Desligamento revertido",
};

/** Registrar o desligamento — data, motivo, e o acesso cai junto. [S5-H] */
function DismissForm({
  profileId,
  onDone,
}: {
  profileId: string;
  onDone: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState(hojeIso());
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await dismissEmployee(profileId, { dismissedAt: data, reason: motivo.trim() || undefined });
      setAberto(false);
      setMotivo("");
      await onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao registrar");
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <Button type="button" variant="secondary" onClick={() => setAberto(true)}>
        Registrar desligamento
      </Button>
    );
  }

  return (
    <form className="form-grid people-dismiss" onSubmit={onSubmit}>
      <p className="muted">
        Ao registrar, o acesso ao portal cai na hora — inclusive se a pessoa
        estiver com o portal aberto. A ficha e tudo o que ela assinou continuam
        guardados.
      </p>
      <div className="form-grid cols-2">
        <label className="form-field">
          Último dia de trabalho
          <input
            type="date"
            value={data}
            max={hojeIso()}
            onChange={(e) => setData(e.target.value)}
            required
          />
        </label>
        <label className="form-field">
          Motivo (opcional)
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={300}
            placeholder="Ex.: pedido de demissão"
          />
        </label>
      </div>
      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" disabled={salvando}>
          {salvando ? "Registrando…" : "Confirmar desligamento"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * Editar o cadastro da pessoa.
 *
 * A planilha criava a ficha completa, mas a tela só deixava mudar o vínculo:
 * quem entrou por convite, ou com a função escrita diferente do cadastro,
 * ficava sem função e sem CPF, e não havia onde pôr. O servidor já aceitava
 * todos estes campos. [S1-A] [CB-1] [CB-3]
 */
function CadastroEditor({
  profileId,
  profile,
  canEdit,
  onSaved,
}: {
  profileId: string;
  profile: EmployeeFile["profile"];
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [registration, setRegistration] = useState(profile.registration ?? "");
  const [taxId, setTaxId] = useState(profile.taxId ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [jobRoleId, setJobRoleId] = useState(profile.jobRole?.id ?? "");
  const [admittedAt, setAdmittedAt] = useState(
    profile.admittedAt ? String(profile.admittedAt).slice(0, 10) : "",
  );
  const [funcoes, setFuncoes] = useState<JobRole[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    fetchJobRoles()
      .then((d) => setFuncoes(d.job_roles))
      .catch(() => setFuncoes([]));
  }, [aberto]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await updateEmployeeProfile(profileId, {
        registration: registration.trim(),
        tax_id: taxId.trim(),
        phone: phone.trim(),
        job_role_id: jobRoleId || null,
        admitted_at: admittedAt || null,
      });
      setAberto(false);
      await onSaved();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return canEdit ? (
      <div className="people-dismiss-slot">
        <Button type="button" variant="ghost" onClick={() => setAberto(true)}>
          Editar cadastro
        </Button>
      </div>
    ) : null;
  }

  return (
    <form className="form-grid people-dismiss" onSubmit={salvar}>
      <div className="form-grid cols-2">
        <label className="form-field">
          Matrícula
          <input
            value={registration}
            onChange={(e) => setRegistration(e.target.value)}
            maxLength={40}
          />
        </label>
        <label className="form-field">
          CPF
          <input
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder="000.000.000-00"
          />
          <span className="form-hint">
            Obrigatório no ASO (NR-7 7.5.19.1 b). Deixe em branco se ainda não
            tiver.
          </span>
        </label>
      </div>
      <div className="form-grid cols-2">
        <label className="form-field">
          Função
          <select value={jobRoleId} onChange={(e) => setJobRoleId(e.target.value)}>
            <option value="">Sem função</option>
            {funcoes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <span className="form-hint">
            É da função que saem os perigos e a ordem de serviço da pessoa.
          </span>
        </label>
        <label className="form-field">
          Admissão
          <input
            type="date"
            value={admittedAt}
            onChange={(e) => setAdmittedAt(e.target.value)}
          />
        </label>
      </div>
      <label className="form-field">
        Telefone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
      </label>
      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar cadastro"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * Vínculo: empregado, terceirizado, temporário, aprendiz ou estagiário —
 * e, quando não é empregado, de que empresa contratada ele vem. A
 * fiscalização pergunta quem é quem no mesmo ambiente (NR-1 1.5.8). [S1-G]
 */
function BondEditor({
  profileId,
  bond,
  contractorId,
  canEdit,
  onSaved,
}: {
  profileId: string;
  bond: string;
  contractorId: string | null;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [vinculo, setVinculo] = useState(bond);
  const [empresa, setEmpresa] = useState(contractorId ?? "");
  const [empresas, setEmpresas] = useState<{ id: string; name: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!editando) return;
    fetchContractorList()
      .then((rows) => setEmpresas(rows.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setEmpresas([]));
  }, [editando]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await updateEmployeeProfile(profileId, {
        bond: vinculo,
        contractor_id: vinculo === "EMPLOYEE" ? null : empresa || null,
      });
      setEditando(false);
      await onSaved();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  if (!editando) {
    return (
      <>
        {canEdit && (
          <div className="people-dismiss-slot">
            <Button type="button" variant="ghost" onClick={() => setEditando(true)}>
              Mudar vínculo
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <form className="form-grid people-dismiss" onSubmit={salvar}>
      <label className="form-field">
        Vínculo
        <select value={vinculo} onChange={(e) => setVinculo(e.target.value)}>
          {Object.entries(WORKER_BOND_LABEL).map(([codigo, rotulo]) => (
            <option key={codigo} value={codigo}>
              {rotulo}
            </option>
          ))}
        </select>
      </label>
      {vinculo !== "EMPLOYEE" && (
        <label className="form-field">
          Empresa contratada
          <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
            <option value="">Não informada</option>
            {empresas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="form-hint">
            Cadastre a empresa em Terceiros para ligar a pessoa a ela.
          </span>
        </label>
      )}
      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar vínculo"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditando(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * A ficha de uma pessoa: cadastro, vínculo, acesso ao portal, o que a função
 * exige e o que ela cumpriu, ordem de serviço, ações e histórico. [S6-C]
 */
export function EmployeeFilePage() {
  const { id = "" } = useParams();
  const { canManage } = useModuleAccess("colaboradores");
  const [data, setData] = useState<EmployeeFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acao, setAcao] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await fetchEmployeeFile(id));
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    load().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function reverter() {
    setAcao("reverter");
    try {
      await reinstateEmployee(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao reverter");
    } finally {
      setAcao(null);
    }
  }

  if (error && !data) {
    return (
      <div>
        <p className="page-error" role="alert">
          {error}
        </p>
        <Link to="/colaboradores">Voltar aos colaboradores</Link>
      </div>
    );
  }
  if (!data) return <LoadingState label="Carregando a ficha…" />;

  const { profile, membership } = data;
  const desligado = Boolean(profile.dismissedAt);

  return (
    <div className="people-file">
      <Link to="/colaboradores" className="people-back">
        ← Colaboradores
      </Link>

      <PageHeader
        title={profile.user.name}
        description={
          profile.jobRole
            ? `${profile.jobRole.name} · ${profile.jobRole.sector.name} · ${profile.jobRole.sector.establishment.name}`
            : "Sem função atribuída"
        }
      />

      {desligado && (
        <section className="people-dismissed-banner">
          <div>
            <strong>Desligado em {formatDay(profile.dismissedAt)}</strong>
            {profile.dismissalReason && <div>Motivo: {profile.dismissalReason}</div>}
            {profile.dismissedBy && (
              <div className="muted">Registrado por {profile.dismissedBy.name}</div>
            )}
          </div>
          {canManage && (
            <Button type="button" variant="secondary" disabled={acao === "reverter"} onClick={() => void reverter()}>
              {acao === "reverter" ? "Revertendo…" : "Reverter desligamento"}
            </Button>
          )}
        </section>
      )}

      <div className="people-grid">
        <section className="form-section">
          <h2>Cadastro</h2>
          <dl className="people-facts">
            <div>
              <dt>Login</dt>
              <dd>{profile.user.login}</dd>
            </div>
            <div>
              <dt>Matrícula</dt>
              <dd>{profile.registration ?? "—"}</dd>
            </div>
            <div>
              <dt>CPF</dt>
              <dd>{formatCpf(profile.taxId)}</dd>
            </div>
            <div>
              <dt>Telefone</dt>
              <dd>{profile.phone ?? "—"}</dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd>{profile.user.email ?? "—"}</dd>
            </div>
            <div>
              <dt>Admissão</dt>
              <dd>{formatDay(profile.admittedAt)}</dd>
            </div>
            <div>
              <dt>Vínculo</dt>
              <dd>
                {WORKER_BOND_LABEL[profile.bond] ?? profile.bond}
                {profile.contractor && (
                  <span className="muted"> · {profile.contractor.name}</span>
                )}
              </dd>
            </div>
          </dl>
          <CadastroEditor
            profileId={id}
            profile={profile}
            canEdit={canManage && !desligado}
            onSaved={load}
          />
          <BondEditor
            profileId={id}
            bond={profile.bond}
            contractorId={profile.contractorId}
            canEdit={canManage && !desligado}
            onSaved={load}
          />
        </section>

        <section className="form-section">
          <h2>Acesso ao portal</h2>
          {membership ? (
            <dl className="people-facts">
              <div>
                <dt>Papel</dt>
                <dd>{ORG_ROLE_LABEL[membership.role] ?? membership.role}</dd>
              </div>
              <div>
                <dt>Situação</dt>
                <dd>
                  {membership.access_active ? (
                    <Chip tone="success">Entra no portal</Chip>
                  ) : (
                    <Chip tone="neutral">Sem acesso</Chip>
                  )}
                </dd>
              </div>
              {membership.access_expires_at && (
                <div>
                  <dt>Acesso até</dt>
                  <dd>{formatDay(membership.access_expires_at)}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="muted">Esta pessoa não tem vínculo de acesso nesta empresa.</p>
          )}
          {canManage && !desligado && (
            <div className="people-dismiss-slot">
              <DismissForm profileId={id} onDone={load} />
            </div>
          )}
        </section>

        <section className="form-section">
          <h2>O que a função exige</h2>
          {data.requirements.length === 0 ? (
            <p className="muted">
              Nenhuma exigência cadastrada para esta função.
            </p>
          ) : (
            <ul className="people-list">
              {data.requirements.map((q) => (
                <li key={q.id}>
                  <div>
                    <strong>{q.name}</strong>
                    {q.certificate?.expires_at && (
                      <div className="muted">
                        vale até {formatDay(q.certificate.expires_at)}
                      </div>
                    )}
                  </div>
                  <Chip tone={statusTone(q.status)}>
                    {REQUIREMENT_STATUS_LABEL[q.status] ?? q.status}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="form-section">
          <h2>Ordem de serviço</h2>
          {data.service_order ? (
            <p>
              <Link to={`/ordens-servico/${data.service_order.id}`}>
                v{data.service_order.version}
              </Link>{" "}
              · emitida em {formatDay(data.service_order.issued_at)}
              <br />
              {data.service_order.acknowledged_at ? (
                <Chip tone="success">
                  Ciência em {formatDateTime(data.service_order.acknowledged_at)}
                </Chip>
              ) : (
                <Chip tone="warning">Ainda sem ciência</Chip>
              )}
            </p>
          ) : (
            <p className="muted">
              A função desta pessoa ainda não tem ordem de serviço emitida.
            </p>
          )}
        </section>

        {data.exams.length > 0 && (
          <section className="form-section">
            <h2>Exames ocupacionais</h2>
            <ul className="people-list">
              {data.exams.map((e) => (
                <li key={e.id}>
                  <div>
                    <strong>{EXAM_KIND_LABEL[e.kind] ?? e.kind}</strong>
                    <div className="muted">
                      {e.performedAt ? `feito em ${formatDay(e.performedAt)}` : "sem data"}
                    </div>
                  </div>
                  {e.dueAt && <span className="muted">vence {formatDay(e.dueAt)}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.actions.length > 0 && (
          <section className="form-section">
            <h2>Ações no nome dela</h2>
            <ul className="people-list">
              {data.actions.map((a) => (
                <li key={a.id}>
                  <div>
                    <strong>{a.title}</strong>
                    <div className="muted">
                      {ACTION_STATUS_LABEL[a.status] ?? a.status}
                      {a.dueDate ? ` · prazo ${formatDay(a.dueDate)}` : ""}
                    </div>
                  </div>
                  {isOverdue(a.dueDate, a.status) && <Chip tone="danger">Atrasada</Chip>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.history.length > 0 && (
          <section className="form-section">
            <h2>Histórico da ficha</h2>
            <ul className="people-history">
              {data.history.map((h) => (
                <li key={h.id}>
                  <span className="muted">{formatDateTime(h.at)}</span>
                  <span>{AUDIT_LABEL[h.action] ?? h.action}</span>
                  <span className="muted">{h.who}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
