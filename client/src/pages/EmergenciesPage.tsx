import { Fragment, FormEvent, useCallback, useEffect, useState } from "react";
import {
  addDrillEvidence,
  createEmergencyDrill,
  createEmergencyProcedure,
  drillEvidenceUrl,
  drillStatus,
  fetchEmergencyProcedure,
  fetchEmergencyProcedures,
  type DrillStatus,
  type EmergencyProcedure,
  type EmergencyProcedureDetail,
} from "@/api/emergencies";
import { createActionFromFinding } from "@/api/actions";
import { baixarArquivoPrivado } from "@/api/arquivo-privado";
import { AnexarPapel } from "@/components/AnexarPapel";
import { Dialog } from "@/components/Dialog";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import { CRITERIO_HINT, CRITERIO_LABEL, formatDay } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/data-table.css";
import "@/components/form.css";
import type { OrgMember } from "@/api/org-members";
const DRILL_LABEL: Record<DrillStatus, string> = {
  NO_SCHEDULE: "Sem periodicidade",
  NEVER_DONE: "Nunca feito",
  OVERDUE: "Simulado vencido",
  DUE_SOON: "Simulado próximo",
  OK: "Em dia",
};

function drillTone(
  status: DrillStatus,
): "neutral" | "warning" | "danger" | "success" {
  switch (status) {
    case "OVERDUE":
      return "danger";
    case "NEVER_DONE":
    case "DUE_SOON":
      return "warning";
    case "OK":
      return "success";
    default:
      return "neutral";
  }
}

export function EmergenciesPage() {
  const [procedures, setProcedures] = useState<EmergencyProcedure[]>([]);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Quem só consulta não cadastra procedimento nem simulado. [B2-4-F] */
  const { canWrite } = useModuleAccess("emergencias");
  const [showForm, setShowForm] = useState(false);

  const [establishmentId, setEstablishmentId] = useState("");
  const [scenario, setScenario] = useState("");
  const [firstAidMeans, setFirstAidMeans] = useState("");
  const [responsibleIds, setResponsibleIds] = useState<string[]>([]);
  const [responsibleMembers, setResponsibleMembers] = useState<OrgMember[]>([]);
  const [responsiblesExtra, setResponsiblesExtra] = useState("");
  const [evacuationPlan, setEvacuationPlan] = useState("");
  const [largeScaleMeasures, setLargeScaleMeasures] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /*
    O plano (primeiros socorros, responsáveis, saída) e o simulado
    (participantes, achados) não abriam em tela nenhuma, embora o servidor
    tivesse a consulta. [B3-4-B] [S7-E]
  */
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [aberto, setAberto] = useState<EmergencyProcedureDetail | null>(null);
  const [erroAberto, setErroAberto] = useState<string | null>(null);
  /* O achado do simulado não virava ação nem aparecia em outro lugar. */
  const [acaoDoAchado, setAcaoDoAchado] = useState<
    { drillId: string; findings: string } | null
  >(null);
  const [responsavel, setResponsavel] = useState("");
  const [prazoDaAcao, setPrazoDaAcao] = useState("");
  /* Sem critério de eficácia, a ação não abre. [B3-4-A] */
  const [criterioDaAcao, setCriterioDaAcao] = useState("");
  const [abrindoAcao, setAbrindoAcao] = useState(false);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);
  const [acaoFeita, setAcaoFeita] = useState<string | null>(null);

  const [drillFor, setDrillFor] = useState<string | null>(null);
  const [performedAt, setPerformedAt] = useState("");
  const [participants, setParticipants] = useState("");
  const [findings, setFindings] = useState("");
  const [drillSaving, setDrillSaving] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [proc, est] = await Promise.all([
      fetchEmergencyProcedures(),
      fetchEstablishments(),
    ]);
    setProcedures(proc.procedures);
    setEstablishments(est.establishments);
    /*
      O estabelecimento vinha escolhido como o primeiro da lista: quem
      cadastrava para outra unidade e não reparava gravava o procedimento na
      unidade errada. Agora quem cadastra escolhe. [CB-18]
    */
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
  }, [reload]);

  const attention = procedures.filter((p) => {
    const s = drillStatus(p);
    return s === "OVERDUE" || s === "NEVER_DONE";
  }).length;

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!establishmentId) {
      setFormError("Escolha a unidade a que este procedimento se aplica.");
      return;
    }
    if (scenario.trim().length < 2) {
      setFormError("Informe o cenário.");
      return;
    }
    if (responsibleIds.length === 0 && !responsiblesExtra.trim()) {
      setFormError("Selecione ao menos um responsável ou descreva o papel.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const fromPeople = responsibleMembers.map((m) => m.name).join(", ");
      const responsibles = [fromPeople, responsiblesExtra.trim()]
        .filter(Boolean)
        .join(fromPeople && responsiblesExtra.trim() ? " — " : "");
      await createEmergencyProcedure({
        establishmentId,
        scenario: scenario.trim(),
        firstAidMeans: firstAidMeans.trim(),
        responsibles,
        evacuationPlan: evacuationPlan.trim(),
        largeScaleMeasures: largeScaleMeasures.trim() || undefined,
      });
      setScenario("");
      setFirstAidMeans("");
      setResponsibleIds([]);
      setResponsibleMembers([]);
      setResponsiblesExtra("");
      setEvacuationPlan("");
      setLargeScaleMeasures("");
      setShowForm(false);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function carregarAberto(id: string) {
    setErroAberto(null);
    try {
      const { procedure } = await fetchEmergencyProcedure(id);
      setAberto(procedure);
    } catch (err) {
      setAberto(null);
      setErroAberto(
        err instanceof Error ? err.message : "Falha ao abrir o procedimento",
      );
    }
  }

  async function alternar(id: string) {
    if (abertoId === id) {
      setAbertoId(null);
      setAberto(null);
      return;
    }
    setAbertoId(id);
    setAberto(null);
    await carregarAberto(id);
  }

  /* O achado do simulado vira ação do plano, com responsável e prazo. */
  async function abrirAcaoDoAchado(e: FormEvent) {
    e.preventDefault();
    if (!acaoDoAchado || !responsavel || !prazoDaAcao || !criterioDaAcao.trim()) return;
    setAbrindoAcao(true);
    setErroDaAcao(null);
    try {
      const { action } = await createActionFromFinding({
        title: acaoDoAchado.findings.slice(0, 160),
        description: `Achado do simulado de emergência: ${acaoDoAchado.findings}`,
        assignee_id: responsavel,
        due_date: prazoDaAcao,
        priority: "HIGH",
        effectiveness_criteria: criterioDaAcao.trim(),
      });
      setAcaoDoAchado(null);
      setResponsavel("");
      setPrazoDaAcao("");
      setCriterioDaAcao("");
      setAcaoFeita(`Ação aberta no plano: "${action.title}".`);
    } catch (err) {
      setErroDaAcao(err instanceof Error ? err.message : "Falha ao abrir a ação");
    } finally {
      setAbrindoAcao(false);
    }
  }

  async function onDrill(e: FormEvent) {
    e.preventDefault();
    if (!drillFor || !performedAt) {
      setDrillError("Informe a data do exercício.");
      return;
    }
    setDrillSaving(true);
    setDrillError(null);
    try {
      await createEmergencyDrill(drillFor, {
        performedAt,
        participants: participants ? Number(participants) : undefined,
        findings: findings.trim() || undefined,
      });
      setDrillFor(null);
      setPerformedAt("");
      setParticipants("");
      setFindings("");
      await reload();
    } catch (err) {
      setDrillError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setDrillSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Emergências"
        description="O que fazer quando algo dá errado: quem socorre, com o que, e como todo mundo sai do local. Cada plano precisa ser treinado periodicamente."
        actions={
          canWrite ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? "Fechar formulário" : "Novo procedimento"}
            </Button>
          ) : undefined
        }
      />

      {attention > 0 && (
        <p
          className="filter-meta"
          style={{ color: "var(--sem-danger-fg)", fontWeight: 600 }}
        >
          {attention}{" "}
          {attention === 1
            ? "procedimento sem simulado em dia"
            : "procedimentos sem simulado em dia"}
          .
        </p>
      )}

      {canWrite && showForm && (
        <section className="form-section">
          <h2>Novo procedimento de emergência</h2>
          <p className="muted">
            NR-1 1.5.6.2: meios de primeiros socorros, responsáveis e plano de
            abandono do local.
          </p>
          <form className="form-grid" onSubmit={onCreate}>
            <label className="form-field">
              Estabelecimento
              <select
                value={establishmentId}
                onChange={(e) => setEstablishmentId(e.target.value)}
                disabled={saving}
                required
              >
                {/* Sem escolha feita por ninguém: o procedimento é de uma
                    unidade só, e errar a unidade é errar o documento. [CB-18] */}
                <option value="">Escolha a unidade…</option>
                {establishments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Cenário
              <input
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                placeholder="Ex.: Incêndio na produção"
                disabled={saving}
                required
              />
            </label>
            <label className="form-field">
              Meios de primeiros socorros / encaminhamento
              <textarea
                value={firstAidMeans}
                onChange={(e) => setFirstAidMeans(e.target.value)}
                disabled={saving}
                required
              />
            </label>
            <div className="form-field">
              <span>Responsáveis</span>
              <PeoplePicker
                mode="multiple"
                value={responsibleIds}
                disabled={saving}
                required
                onChange={(ids, members) => {
                  setResponsibleIds(ids);
                  setResponsibleMembers(members);
                }}
              />
              <p className="form-hint">
                Selecione as pessoas cadastradas. Se precisar citar brigada ou
                funções sem usuário, use o campo abaixo.
              </p>
              <input
                value={responsiblesExtra}
                onChange={(e) => setResponsiblesExtra(e.target.value)}
                placeholder="Ex.: Brigada de incêndio do 2º turno"
                disabled={saving}
              />
            </div>
            <label className="form-field">
              Plano de evacuação / abandono
              <textarea
                value={evacuationPlan}
                onChange={(e) => setEvacuationPlan(e.target.value)}
                disabled={saving}
                required
              />
            </label>
            <label className="form-field">
              Medidas para emergências de grande porte (opcional)
              <textarea
                value={largeScaleMeasures}
                onChange={(e) => setLargeScaleMeasures(e.target.value)}
                disabled={saving}
              />
            </label>
            {formError && <p className="form-error">{formError}</p>}
            <div className="form-actions">
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando…" : "Salvar procedimento"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {loading && <LoadingState label="Carregando emergências…" />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && procedures.length === 0 && (
        <EmptyState
          title="Nenhum procedimento cadastrado"
          description={
            /* Quem só lê recebia a instrução de quem cadastra. [S1-E] */
            canWrite
              ? "Cadastre os cenários de emergência da operação e registre os simulados."
              : "A empresa ainda não cadastrou procedimentos de emergência. Quando cadastrar, eles aparecem aqui."
          }
        />
      )}

      {!loading && !error && procedures.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cenário</th>
                <th>Local</th>
                <th>Simulados</th>
                <th>Último</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {procedures.map((p) => {
                const status = drillStatus(p);
                const open = abertoId === p.id;
                return (
                  <Fragment key={p.id}>
                  <tr
                    className={`is-clickable${open ? " is-open" : ""}`}
                    onClick={() => void alternar(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void alternar(p.id);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-expanded={open}
                  >
                    <td>
                      <strong>{p.scenario}</strong>
                    </td>
                    <td className="muted">{p.establishment.name}</td>
                    <td className="muted">{p._count.drills}</td>
                    <td className="muted">{formatDay(p.last_drill_at)}</td>
                    <td>
                      <Chip tone={drillTone(status)}>
                        {DRILL_LABEL[status]}
                      </Chip>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canWrite && (
                        <button
                          type="button"
                          className="filter-toggle"
                          onClick={() =>
                            setDrillFor((cur) => (cur === p.id ? null : p.id))
                          }
                        >
                          Registrar simulado
                        </button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={6} onClick={(e) => e.stopPropagation()}>
                        {erroAberto && (
                          <p className="form-error" role="alert">
                            {erroAberto}
                          </p>
                        )}
                        {!aberto && !erroAberto && <p className="muted">Abrindo…</p>}
                        {aberto && (
                          <div className="registro-aberto">
                            <h3 className="plano-titulo">O plano</h3>
                            <p>
                              <strong>Primeiros socorros e encaminhamento:</strong>{" "}
                              {aberto.firstAidMeans ?? (
                                <span className="muted">não registrado</span>
                              )}
                            </p>
                            <p>
                              <strong>Responsáveis:</strong>{" "}
                              {aberto.responsibles ?? (
                                <span className="muted">não registrado</span>
                              )}
                            </p>
                            <p>
                              <strong>Abandono do local:</strong>{" "}
                              {aberto.evacuationPlan ?? (
                                <span className="muted">não registrado</span>
                              )}
                            </p>
                            {aberto.largeScaleMeasures && (
                              <p>
                                <strong>Grande porte:</strong>{" "}
                                {aberto.largeScaleMeasures}
                              </p>
                            )}

                            <h3 className="plano-titulo">Simulados</h3>
                            {aberto.drills.length === 0 ? (
                              <p className="muted">Nenhum simulado registrado.</p>
                            ) : (
                              <ul className="simulados">
                                {aberto.drills.map((d) => (
                                  <li key={d.id}>
                                    <p className="simulado-cabeca">
                                      <strong>{formatDay(d.performedAt)}</strong>
                                      <span className="muted">
                                        {d.participants != null
                                          ? ` · ${d.participants} participante(s)`
                                          : " · participantes não registrados"}
                                        {` · registrado por ${d.recordedBy.name}`}
                                      </span>
                                    </p>
                                    <p>
                                      <strong>Achados:</strong>{" "}
                                      {d.findings ?? (
                                        <span className="muted">nenhum registrado</span>
                                      )}
                                    </p>
                                    {canWrite && d.findings && (
                                      <Button
                                        type="button"
                                        size="compact"
                                        variant="secondary"
                                        onClick={() => {
                                          setErroDaAcao(null);
                                          setAcaoFeita(null);
                                          setAcaoDoAchado({
                                            drillId: d.id,
                                            findings: d.findings!,
                                          });
                                        }}
                                      >
                                        Abrir ação para este achado
                                      </Button>
                                    )}
                                    <AnexarPapel
                                      canWrite={canWrite}
                                      label="Ata do simulado assinada"
                                      hint="Opcional: o registro no portal já é a prova. Até 20 MB."
                                      anexos={d.evidences ?? []}
                                      onSend={async (input) => {
                                        await addDrillEvidence(aberto.id, d.id, input);
                                        await carregarAberto(aberto.id);
                                      }}
                                      onOpen={(anexo) =>
                                        baixarArquivoPrivado(
                                          drillEvidenceUrl(aberto.id, d.id, anexo.id),
                                          anexo.fileName ?? "ata",
                                        )
                                      }
                                    />
                                  </li>
                                ))}
                              </ul>
                            )}
                            {acaoFeita && (
                              <p className="muted" role="status">
                                {acaoFeita}
                              </p>
                            )}
                          </div>
                        )}
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

      {/* O achado vira ação do plano: responsável, prazo e critério são obrigatórios. */}
      {acaoDoAchado && (
        <Dialog
          title="Abrir ação para o achado do simulado"
          description="A ação entra no Plano de ação, sem risco do inventário ligado — o achado veio do simulado, não de um perigo avaliado."
          onClose={() => setAcaoDoAchado(null)}
        >
          <form className="form-grid" onSubmit={abrirAcaoDoAchado}>
            <p className="form-hint">{acaoDoAchado.findings}</p>
            <label className="form-field">
              Responsável
              <PeoplePicker
                value={responsavel}
                onChange={(id) => setResponsavel(id)}
                disabled={abrindoAcao}
                required
              />
            </label>
            <label className="form-field">
              Prazo
              <input
                type="date"
                value={prazoDaAcao}
                onChange={(e) => setPrazoDaAcao(e.target.value)}
                disabled={abrindoAcao}
                required
              />
            </label>
            <label className="form-field">
              {CRITERIO_LABEL}
              <input
                value={criterioDaAcao}
                onChange={(e) => setCriterioDaAcao(e.target.value)}
                placeholder="Ex.: a porta lateral abre no próximo simulado"
                disabled={abrindoAcao}
                required
              />
              <span className="form-hint">{CRITERIO_HINT}</span>
            </label>
            {erroDaAcao && (
              <p className="form-error" role="alert">
                {erroDaAcao}
              </p>
            )}
            <div className="form-actions">
              <Button
                type="submit"
                disabled={
                  abrindoAcao || !responsavel || !prazoDaAcao || !criterioDaAcao.trim()
                }
              >
                {abrindoAcao ? "Abrindo…" : "Abrir ação"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {canWrite && drillFor && (
        <section className="form-section" style={{ marginTop: "1rem" }}>
          <h2>Registrar exercício simulado</h2>
          <p className="muted">
            NR-1 1.5.6.3 — registre data, participantes e achados do treino.
          </p>
          <form className="form-grid" onSubmit={onDrill}>
            <div className="form-grid cols-2">
              <label className="form-field">
                Quando foi feito
                <input
                  type="datetime-local"
                  value={performedAt}
                  onChange={(e) => setPerformedAt(e.target.value)}
                  disabled={drillSaving}
                  required
                />
              </label>
              <label className="form-field">
                Participantes (opcional)
                <input
                  type="number"
                  min={0}
                  value={participants}
                  onChange={(e) => setParticipants(e.target.value)}
                  disabled={drillSaving}
                />
              </label>
            </div>
            <label className="form-field">
              Achados / melhorias (opcional)
              <textarea
                value={findings}
                onChange={(e) => setFindings(e.target.value)}
                disabled={drillSaving}
              />
            </label>
            {drillError && <p className="form-error">{drillError}</p>}
            <div className="form-actions">
              <Button type="submit" disabled={drillSaving}>
                {drillSaving ? "Salvando…" : "Salvar simulado"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDrillFor(null)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
