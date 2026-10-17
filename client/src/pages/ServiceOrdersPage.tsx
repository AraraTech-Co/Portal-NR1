import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchServiceOrders,
  issueServiceOrder,
  type JobRoleServiceOrder,
} from "@/api/service-orders";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/data-table.css";
import "@/components/form.css";
import "./service-orders.css";

const DEFAULT_DUTIES = `Cumprir as medidas de prevenção indicadas nesta ordem de serviço.
Usar e conservar os equipamentos de proteção fornecidos pela empresa.
Comunicar ao supervisor qualquer situação de risco, acidente ou quase-acidente.
Colaborar com a organização na aplicação das normas de segurança e saúde.`;

const DEFAULT_EMERGENCY = `Em caso de acidente ou emergência: interromper a tarefa, acionar o supervisor e seguir o plano de emergência do estabelecimento.`;

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Emitir a ordem de serviço de uma função. Append-only: gera a versão seguinte. */
function IssueForm({
  roles,
  onIssued,
}: {
  roles: JobRoleServiceOrder[];
  onIssued: () => Promise<void>;
}) {
  const [jobRoleId, setJobRoleId] = useState("");
  const [duties, setDuties] = useState(DEFAULT_DUTIES);
  const [emergency, setEmergency] = useState(DEFAULT_EMERGENCY);
  const [responsibleName, setResponsibleName] = useState("");
  const [responsibleRole, setResponsibleRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<{ id: string; version: number; notified: number } | null>(
    null,
  );

  useEffect(() => {
    if (!jobRoleId && roles[0]) setJobRoleId(roles[0].id);
  }, [roles, jobRoleId]);

  const escolhida = roles.find((r) => r.id === jobRoleId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!jobRoleId) {
      setError("Escolha a função.");
      return;
    }
    if (!duties.trim()) {
      setError("Escreva as obrigações do trabalhador.");
      return;
    }
    setSaving(true);
    try {
      const res = await issueServiceOrder({
        jobRoleId,
        duties: duties.trim(),
        emergencyInstructions: emergency.trim() || undefined,
        responsibleName: responsibleName.trim() || undefined,
        responsibleRole: responsibleRole.trim() || undefined,
      });
      setOk({ ...res.service_order, notified: res.notified });
      await onIssued();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao emitir");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="form-section">
      <h2>Emitir ordem de serviço</h2>
      <p className="muted">
        A ordem sai do inventário da função: as atividades, os perigos, os riscos
        avaliados e as medidas de proteção que já existem. Emitir congela esse
        retrato e pede ciência nova de quem está na função.
      </p>
      <form className="form-grid" onSubmit={onSubmit}>
        <div className="form-grid cols-2">
          <label className="form-field">
            Função
            <select
              value={jobRoleId}
              onChange={(e) => setJobRoleId(e.target.value)}
              disabled={saving}
              required
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {r.establishment.name} · {r.sector}
                </option>
              ))}
            </select>
            {escolhida && (
              <span className="form-hint">
                {escolhida.people === 0
                  ? "Nenhum trabalhador ativo nesta função."
                  : `${escolhida.people} trabalhador(es) nesta função.`}
                {escolhida.current
                  ? ` Vigente: v${escolhida.current.version}. A nova será v${escolhida.current.version + 1}.`
                  : " Ainda sem ordem de serviço."}
              </span>
            )}
          </label>
          <label className="form-field">
            Responsável (opcional)
            <input
              value={responsibleName}
              onChange={(e) => setResponsibleName(e.target.value)}
              disabled={saving}
              placeholder="Em branco usa o responsável da organização"
            />
          </label>
        </div>
        <label className="form-field">
          Obrigações do trabalhador
          <textarea
            value={duties}
            onChange={(e) => setDuties(e.target.value)}
            disabled={saving}
            rows={5}
            required
          />
          <span className="form-hint">
            É o que a ordem de serviço dá a conhecer. Escreva na linguagem de
            quem faz a tarefa.
          </span>
        </label>
        <label className="form-field">
          O que fazer em emergência (opcional)
          <textarea
            value={emergency}
            onChange={(e) => setEmergency(e.target.value)}
            disabled={saving}
            rows={3}
          />
        </label>
        <label className="form-field">
          Cargo de quem assina (opcional)
          <input
            value={responsibleRole}
            onChange={(e) => setResponsibleRole(e.target.value)}
            disabled={saving}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {ok && (
          <p className="muted" role="status">
            Ordem v{ok.version} emitida.{" "}
            {ok.notified === 0
              ? "Nenhum trabalhador ativo para avisar."
              : `${ok.notified} pessoa(s) avisada(s) para dar ciência.`}{" "}
            <Link to={`/ordens-servico/${ok.id}`}>Abrir a ordem</Link>
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" disabled={saving}>
            {saving ? "Emitindo…" : "Emitir ordem de serviço"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * Ordem de serviço de SST por função (NR-1 1.4.1 "b"): o documento e a
 * ciência de quem trabalha. Função sem ordem aparece como pendente. [S7-F]
 */
export function ServiceOrdersPage() {
  const { canWrite } = useModuleAccess("documentos_pgr");
  const [roles, setRoles] = useState<JobRoleServiceOrder[]>([]);
  const [myJobRoleId, setMyJobRoleId] = useState<string | null>(null);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [establishmentId, setEstablishmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await fetchServiceOrders(establishmentId || undefined);
    setRoles(data.job_roles);
    setMyJobRoleId(data.my_job_role_id);
  }, [establishmentId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    fetchEstablishments()
      .then((data) => setEstablishments(data.establishments))
      .catch(() => setEstablishments([]));
  }, []);

  const minha = useMemo(() => roles.find((r) => r.is_mine) ?? null, [roles]);
  // Função sem ninguém não pede ordem agora: contar como pendência esconde
  // do dono as funções em que há gente trabalhando sem ordem. [B2-4-B]
  const pendentes = roles.filter((r) => !r.current && r.people > 0).length;
  const semCiencia = roles.reduce((soma, r) => soma + (r.current?.pending ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Ordens de serviço"
        description="A ordem de serviço de SST diz a cada função a que ela está exposta, como se proteger e o que é obrigação de quem trabalha — e registra a ciência de cada pessoa."
      />

      {minha?.current && (
        <section className="so-mine">
          <div>
            <h2>Sua ordem de serviço</h2>
            <p className="muted">
              {minha.name} · v{minha.current.version} · emitida em{" "}
              {formatDateTime(minha.current.issued_at)}
            </p>
          </div>
          <div className="so-mine-action">
            {minha.current.my_ack_at ? (
              <Chip tone="success">
                Ciência em {formatDateTime(minha.current.my_ack_at)}
              </Chip>
            ) : (
              <Chip tone="warning">Falta sua ciência</Chip>
            )}
            <Link to={`/ordens-servico/${minha.current.id}`}>
              <Button type="button" variant={minha.current.my_ack_at ? "secondary" : "primary"}>
                {minha.current.my_ack_at ? "Reler" : "Ler e dar ciência"}
              </Button>
            </Link>
          </div>
        </section>
      )}
      {myJobRoleId && !minha?.current && (
        <p className="filter-meta so-alert">
          Sua função ainda não tem ordem de serviço emitida.
        </p>
      )}

      {!loading && !error && roles.length > 0 && (pendentes > 0 || semCiencia > 0) && (
        <p className="filter-meta so-alert">
          {pendentes > 0 &&
            (pendentes === 1
              ? "1 função sem ordem de serviço."
              : `${pendentes} funções sem ordem de serviço.`)}
          {pendentes > 0 && semCiencia > 0 ? " " : ""}
          {semCiencia > 0 &&
            (semCiencia === 1
              ? "1 trabalhador ainda não deu ciência."
              : `${semCiencia} trabalhadores ainda não deram ciência.`)}
        </p>
      )}

      {establishments.length > 1 && (
        <label className="form-field so-filter">
          Estabelecimento
          <select
            value={establishmentId}
            onChange={(e) => setEstablishmentId(e.target.value)}
          >
            <option value="">Todos</option>
            {establishments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {loading && <LoadingState label="Carregando ordens de serviço…" />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && roles.length === 0 && (
        <EmptyState
          title="Nenhuma função cadastrada"
          description="A ordem de serviço é por função. Cadastre as funções em Operação para emitir."
        />
      )}

      {!loading && !error && roles.length > 0 && (
        <section className="form-section">
          <h2>Por função</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Função</th>
                  <th>Situação</th>
                  <th>Ciência</th>
                  <th>Emitida em</th>
                  <th aria-label="Abrir" />
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      <div className="muted">
                        {r.establishment.name} · {r.sector} ·{" "}
                        {r.people === 1 ? "1 pessoa" : `${r.people} pessoas`}
                        {r.is_mine && " · sua função"}
                      </div>
                    </td>
                    <td>
                      {r.current ? (
                        <>
                          <Chip tone="success">Emitida</Chip>
                          <div className="muted">
                            v{r.current.version}
                            {r.versions > 1 && ` de ${r.versions}`}
                          </div>
                        </>
                      ) : (
                        <Chip tone="warning">Sem ordem</Chip>
                      )}
                    </td>
                    <td>
                      {r.people === 0 ? (
                        <span className="muted">ninguém nesta função</span>
                      ) : r.current ? (
                        r.current.pending === 0 ? (
                          <span>
                            {r.current.acknowledged} de {r.people}
                            <div className="muted">todos deram ciência</div>
                          </span>
                        ) : (
                          <span>
                            {r.current.acknowledged} de {r.people}
                            <div className="so-pending">
                              {r.current.pending} sem ciência
                            </div>
                          </span>
                        )
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="muted">
                      {r.current ? (
                        <>
                          {formatDateTime(r.current.issued_at)}
                          <div>por {r.current.issued_by.name}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {r.current ? (
                        <Link to={`/ordens-servico/${r.current.id}`}>Abrir</Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {canWrite && roles.length > 0 && <IssueForm roles={roles} onIssued={reload} />}
    </div>
  );
}
