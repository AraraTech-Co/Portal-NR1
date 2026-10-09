import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  archiveHazard,
  archiveRisk,
  createHazard,
  createRisk,
  fetchHazards,
  fetchRisksByHazard,
  updateHazard,
  updateRisk,
  type Hazard,
  type HazardInput,
  type RiskRow,
} from "@/api/risks";
import {
  fetchActivities,
  fetchEstablishments,
  fetchSectors,
  type Activity,
  type Establishment,
  type Sector,
} from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { HAZARD_CATEGORY_LABEL, HAZARD_ORIGIN_LABEL, RISK_LEVEL_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/form.css";
import "./hazard-form.css";

const EMPTY: HazardInput = {
  description: "",
  category: "ACCIDENT",
  origin: "ROUTINE_REVIEW",
  source: "",
  consequences: "",
  exposed_group: "",
  exposure_time: "",
  exposure_frequency: "",
  exposure_intensity: "",
  monitoring_data: "",
};

function toInput(h: Hazard): HazardInput {
  return {
    description: h.description,
    category: h.category,
    origin: h.origin,
    source: h.source ?? "",
    consequences: h.consequences ?? "",
    exposed_group: h.exposedGroup ?? "",
    exposed_workers_count: h.exposedWorkersCount ?? undefined,
    exposure_time: h.exposureTime ?? "",
    exposure_frequency: h.exposureFrequency ?? "",
    exposure_intensity: h.exposureIntensity ?? "",
    monitoring_data: h.monitoringData ?? "",
  };
}

/** Os riscos de um perigo: o que pode acontecer com quem está exposto. */
function RiskList({
  hazard,
  canEdit,
  onChanged,
}: {
  hazard: Hazard;
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const [risks, setRisks] = useState<RiskRow[] | null>(null);
  const [novo, setNovo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const d = await fetchRisksByHazard(hazard.id);
    setRisks(d.risks);
  }, [hazard.id]);

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, [reload]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!novo.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createRisk(hazard.id, novo.trim());
      setNovo("");
      await reload();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  async function onRename(risk: RiskRow) {
    const value = window.prompt("Risco:", risk.description);
    if (value === null || !value.trim() || value.trim() === risk.description) return;
    try {
      await updateRisk(risk.id, value.trim());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    }
  }

  async function onArchive(risk: RiskRow) {
    if (!window.confirm(`Arquivar o risco “${risk.description}”? O histórico fica.`)) return;
    try {
      await archiveRisk(risk.id);
      await reload();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao arquivar");
    }
  }

  return (
    <div className="hz-risks">
      <h4>Riscos deste perigo</h4>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {risks === null ? (
        <p className="muted">Carregando…</p>
      ) : risks.length === 0 ? (
        <p className="muted">Nenhum risco. Descreva o que pode acontecer com quem está exposto.</p>
      ) : (
        <ul className="hz-risk-list">
          {risks.map((r) => {
            const level = r.assessments[0]?.resultingLevel ?? null;
            return (
              <li key={r.id}>
                <span>{r.description}</span>
                {level ? (
                  <Chip>{RISK_LEVEL_LABEL[level] ?? level}</Chip>
                ) : (
                  <Chip tone="warning">Sem avaliação</Chip>
                )}
                {canEdit && (
                  <span className="hz-risk-actions">
                    <Button type="button" variant="ghost" onClick={() => void onRename(r)}>
                      Renomear
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => void onArchive(r)}>
                      Arquivar
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <form className="hz-inline-add" onSubmit={onAdd}>
          <input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Ex.: Fratura por queda de altura"
            aria-label="Novo risco"
          />
          <Button type="submit" variant="secondary" disabled={busy || !novo.trim()}>
            Adicionar risco
          </Button>
        </form>
      )}
    </div>
  );
}

/** Registrar perigo e risco a partir da atividade. [S2-A] */
export function HazardFormPage() {
  const { canWrite } = useModuleAccess("inventario");
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [establishmentId, setEstablishmentId] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [activityId, setActivityId] = useState("");

  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [form, setForm] = useState<HazardInput>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchEstablishments(), fetchSectors(), fetchActivities()])
      .then(([e, s, a]) => {
        setEstablishments(e.establishments);
        setSectors(s.sectors);
        setActivities(a.activities);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
  }, []);

  const reloadHazards = useCallback(async () => {
    if (!activityId) {
      setHazards([]);
      return;
    }
    const d = await fetchHazards(activityId);
    setHazards(d.hazards);
  }, [activityId]);

  useEffect(() => {
    reloadHazards().catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, [reloadHazards]);

  const visibleSectors = sectors.filter((s) => !establishmentId || s.establishmentId === establishmentId);
  const visibleActivities = activities.filter((a) => (sectorId ? a.sectorId === sectorId : false));
  const activity = activities.find((a) => a.id === activityId) ?? null;

  function set<K extends keyof HazardInput>(key: K, value: HazardInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startEdit(h: Hazard) {
    setEditingId(h.id);
    setForm(toInput(h));
    setFormError(null);
    setFormOk(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY);
    setFormError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!activityId) {
      setFormError("Escolha a atividade onde o perigo existe.");
      return;
    }
    if (!form.description?.trim()) {
      setFormError("Descreva o perigo.");
      return;
    }
    setSaving(true);
    setFormError(null);
    setFormOk(null);
    try {
      const payload: HazardInput = {
        ...form,
        description: form.description.trim(),
        exposed_workers_count: form.exposed_workers_count ? Number(form.exposed_workers_count) : null,
      };
      if (editingId) {
        await updateHazard(editingId, payload);
        setFormOk("Perigo atualizado.");
      } else {
        await createHazard({ ...payload, activity_id: activityId });
        setFormOk("Perigo registrado. Agora descreva os riscos dele abaixo.");
      }
      setEditingId(null);
      setForm(EMPTY);
      await reloadHazards();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function onArchiveHazard(h: Hazard) {
    if (!window.confirm(`Arquivar o perigo “${h.description}”? O histórico fica.`)) return;
    try {
      await archiveHazard(h.id);
      await reloadHazards();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao arquivar");
    }
  }

  if (loading) return <LoadingState label="Carregando operação…" />;
  if (error) {
    return (
      <p className="page-error" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div>
      <p style={{ margin: "0 0 0.5rem" }}>
        <Link to="/inventario" className="muted">
          ← Inventário de riscos
        </Link>
      </p>
      <PageHeader
        title="Registrar perigo e risco"
        description="O perigo nasce de uma atividade. Escolha onde o trabalho acontece, descreva o perigo e, depois, o que pode acontecer com quem está exposto."
      />

      <section className="form-section">
        <h2>Onde o trabalho acontece</h2>
        <div className="form-grid cols-2">
          <label className="form-field">
            Estabelecimento
            <select
              value={establishmentId}
              onChange={(e) => {
                setEstablishmentId(e.target.value);
                setSectorId("");
                setActivityId("");
              }}
            >
              <option value="">Escolha…</option>
              {establishments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Setor
            <select
              value={sectorId}
              onChange={(e) => {
                setSectorId(e.target.value);
                setActivityId("");
              }}
              disabled={!establishmentId}
            >
              <option value="">Escolha…</option>
              {visibleSectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Atividade
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} disabled={!sectorId}>
              <option value="">Escolha…</option>
              {visibleActivities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {sectorId && visibleActivities.length === 0 && (
          <p className="muted">
            Nenhuma atividade neste setor. Cadastre em <Link to="/operacao">Operação</Link>.
          </p>
        )}
        {activity?.description && <p className="muted">{activity.description}</p>}
      </section>

      {activityId && (
        <>
          {hazards.length > 0 && (
            <section className="form-section">
              <h2>Perigos desta atividade</h2>
              <div className="hz-list">
                {hazards.map((h) => (
                  <article key={h.id} className="hz-item">
                    <div className="hz-item-head">
                      <strong>{h.description}</strong>
                      <Chip>{HAZARD_CATEGORY_LABEL[h.category] ?? h.category}</Chip>
                      {h.exposedWorkersCount != null && (
                        <span className="muted">{h.exposedWorkersCount} exposto(s)</span>
                      )}
                    </div>
                    {canWrite && (
                      <div className="hz-item-actions">
                        <Button type="button" variant="ghost" onClick={() => startEdit(h)}>
                          Editar perigo
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => void onArchiveHazard(h)}>
                          Arquivar
                        </Button>
                      </div>
                    )}
                    <RiskList hazard={h} canEdit={canWrite} onChanged={reloadHazards} />
                  </article>
                ))}
              </div>
            </section>
          )}

          {canWrite && (
            <section className="form-section">
              <h2>{editingId ? "Editar perigo" : "Novo perigo"}</h2>
              <form className="form-grid" onSubmit={onSubmit}>
                <label className="form-field">
                  O que é o perigo
                  <input
                    value={form.description ?? ""}
                    onChange={(e) => set("description", e.target.value)}
                    placeholder="Ex.: Trabalho em altura na escada do mezanino"
                    required
                  />
                </label>
                <div className="form-grid cols-2">
                  <label className="form-field">
                    Natureza
                    <select value={form.category} onChange={(e) => set("category", e.target.value)}>
                      {Object.entries(HAZARD_CATEGORY_LABEL).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-field">
                    Como foi identificado
                    <select value={form.origin} onChange={(e) => set("origin", e.target.value)}>
                      {Object.entries(HAZARD_ORIGIN_LABEL).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-grid cols-2">
                  <label className="form-field">
                    Fonte ou circunstância
                    <input
                      value={form.source ?? ""}
                      onChange={(e) => set("source", e.target.value)}
                      placeholder="Ex.: escada sem corrimão"
                    />
                  </label>
                  <label className="form-field">
                    Possíveis lesões ou agravos
                    <input
                      value={form.consequences ?? ""}
                      onChange={(e) => set("consequences", e.target.value)}
                      placeholder="Ex.: fratura, contusão"
                    />
                  </label>
                </div>
                <div className="form-grid cols-2">
                  <label className="form-field">
                    Quem fica exposto
                    <input
                      value={form.exposed_group ?? ""}
                      onChange={(e) => set("exposed_group", e.target.value)}
                      placeholder="Ex.: repositores do turno da tarde"
                    />
                  </label>
                  <label className="form-field">
                    Quantas pessoas
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={form.exposed_workers_count ?? ""}
                      onChange={(e) =>
                        set("exposed_workers_count", e.target.value === "" ? null : Number(e.target.value))
                      }
                    />
                    <span className="form-hint">Quanto mais gente exposta, mais urgente é a ação.</span>
                  </label>
                </div>
                <div className="form-grid cols-2">
                  <label className="form-field">
                    Tempo de exposição
                    <input
                      value={form.exposure_time ?? ""}
                      onChange={(e) => set("exposure_time", e.target.value)}
                      placeholder="Ex.: 2 h por turno"
                    />
                  </label>
                  <label className="form-field">
                    Com que frequência
                    <input
                      value={form.exposure_frequency ?? ""}
                      onChange={(e) => set("exposure_frequency", e.target.value)}
                      placeholder="Ex.: todos os dias"
                    />
                  </label>
                  <label className="form-field">
                    Intensidade
                    <input
                      value={form.exposure_intensity ?? ""}
                      onChange={(e) => set("exposure_intensity", e.target.value)}
                      placeholder="Ex.: 85 dB"
                    />
                  </label>
                  <label className="form-field">
                    Medições e laudos
                    <input
                      value={form.monitoring_data ?? ""}
                      onChange={(e) => set("monitoring_data", e.target.value)}
                      placeholder="Ex.: dosimetria de 03/2026"
                    />
                  </label>
                </div>
                {formError && (
                  <p className="form-error" role="alert">
                    {formError}
                  </p>
                )}
                {formOk && (
                  <p className="muted" role="status">
                    {formOk}
                  </p>
                )}
                <div className="form-actions">
                  <Button type="submit" disabled={saving}>
                    {saving ? "Salvando…" : editingId ? "Salvar perigo" : "Registrar perigo"}
                  </Button>
                  {editingId && (
                    <Button type="button" variant="ghost" onClick={cancelEdit}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
