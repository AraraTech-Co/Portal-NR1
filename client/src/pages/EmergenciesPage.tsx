import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createEmergencyDrill,
  createEmergencyProcedure,
  drillStatus,
  fetchEmergencyProcedures,
  type DrillStatus,
  type EmergencyProcedure,
} from "@/api/emergencies";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import { formatDay } from "@/lib/labels";
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
    if (!establishmentId && est.establishments[0]) {
      setEstablishmentId(est.establishments[0].id);
    }
  }, [establishmentId]);

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
    if (!establishmentId || scenario.trim().length < 2) {
      setFormError("Informe estabelecimento e cenário.");
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
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Fechar formulário" : "Novo procedimento"}
          </Button>
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

      {showForm && (
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
          description="Cadastre os cenários de emergência da operação e registre os simulados."
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
                return (
                  <tr key={p.id}>
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
                    <td>
                      <button
                        type="button"
                        className="filter-toggle"
                        onClick={() =>
                          setDrillFor((cur) => (cur === p.id ? null : p.id))
                        }
                      >
                        Registrar simulado
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {drillFor && (
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
