import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  createActivity,
  createEstablishment,
  createJobRole,
  createSector,
  fetchActivities,
  fetchEstablishments,
  fetchJobRoles,
  fetchSectors,
  type Activity,
  type Establishment,
  type JobRole,
  type Sector,
} from "@/api/operation";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import "@/components/form.css";
import "./operation.css";
import { LoadingState } from "@/components/LoadingState";

function canEditOperation(permission: string): boolean {
  return (
    permission === "master" ||
    permission === "owner" ||
    permission === "admin" ||
    permission === "sst"
  );
}

function Column({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="op-column">
      <header>
        <h2>{title}</h2>
        <p className="muted">{hint}</p>
      </header>
      {children}
    </section>
  );
}

function PickerItem({
  selected,
  title,
  meta,
  onSelect,
}: {
  selected: boolean;
  title: string;
  meta?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`op-picker${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="op-picker-title">{title}</span>
      {meta && <span className="op-picker-meta muted">{meta}</span>}
    </button>
  );
}

function QuickAdd({
  label,
  placeholder,
  disabled,
  onCreate,
}: {
  label: string;
  placeholder: string;
  disabled?: boolean;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Informe ao menos 2 caracteres.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (disabled) return null;

  return (
    <form className="op-quick-add" onSubmit={onSubmit}>
      <label className="form-field">
        {label}
        <div className="op-quick-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            disabled={saving}
          />
          <Button type="submit" variant="secondary" disabled={saving}>
            {saving ? "…" : "Add"}
          </Button>
        </div>
      </label>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}

export function OperationPage() {
  const { user } = useAuth();
  const canEdit = canEditOperation(user?.permission ?? "user");

  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [jobRoles, setJobRoles] = useState<JobRole[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [establishmentId, setEstablishmentId] = useState<string | null>(null);
  const [sectorId, setSectorId] = useState<string | null>(null);

  const [activityName, setActivityName] = useState("");
  const [activityDescription, setActivityDescription] = useState("");
  const [activityJobRoleIds, setActivityJobRoleIds] = useState<string[]>([]);
  const [activitySaving, setActivitySaving] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [est, sec, jobs, acts] = await Promise.all([
      fetchEstablishments(),
      fetchSectors(),
      fetchJobRoles(),
      fetchActivities(),
    ]);
    setEstablishments(est.establishments);
    setSectors(sec.sectors);
    setJobRoles(jobs.job_roles);
    setActivities(acts.activities);
    setEstablishmentId((current) => {
      if (current && est.establishments.some((e) => e.id === current)) {
        return current;
      }
      return est.establishments[0]?.id ?? null;
    });
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

  const visibleSectors = useMemo(
    () =>
      establishmentId
        ? sectors.filter((s) => s.establishmentId === establishmentId)
        : [],
    [sectors, establishmentId],
  );

  const visibleJobRoles = useMemo(
    () => (sectorId ? jobRoles.filter((j) => j.sectorId === sectorId) : []),
    [jobRoles, sectorId],
  );

  const visibleActivities = useMemo(
    () => (sectorId ? activities.filter((a) => a.sectorId === sectorId) : []),
    [activities, sectorId],
  );

  useEffect(() => {
    if (!sectorId || !visibleSectors.some((s) => s.id === sectorId)) {
      setSectorId(visibleSectors[0]?.id ?? null);
    }
  }, [visibleSectors, sectorId]);

  useEffect(() => {
    setActivityJobRoleIds([]);
  }, [sectorId]);

  async function onCreateActivity(e: FormEvent) {
    e.preventDefault();
    if (!establishmentId || !sectorId) return;
    const trimmed = activityName.trim();
    if (trimmed.length < 2) {
      setActivityError("Informe ao menos 2 caracteres.");
      return;
    }
    setActivitySaving(true);
    setActivityError(null);
    try {
      await createActivity({
        establishmentId,
        sectorId,
        name: trimmed,
        description: activityDescription.trim() || undefined,
        jobRoleIds: activityJobRoleIds,
      });
      setActivityName("");
      setActivityDescription("");
      setActivityJobRoleIds([]);
      await reload();
    } catch (err) {
      setActivityError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setActivitySaving(false);
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
      <PageHeader
        title="Operação"
        description="Mapa da empresa: estabelecimento → setor → função → atividade. É a base do inventário de riscos."
      />

      {establishments.length === 0 ? (
        <EmptyState
          title="Nenhum estabelecimento"
          description="Comece cadastrando o local onde o trabalho acontece."
          action={
            canEdit ? (
              <QuickAdd
                label="Novo estabelecimento"
                placeholder="Ex.: Planta Americana"
                onCreate={async (name) => {
                  await createEstablishment(name);
                  await reload();
                }}
              />
            ) : undefined
          }
        />
      ) : (
        <div className="op-grid">
          <Column
            title="Estabelecimentos"
            hint="Unidade física da empresa."
          >
            <div className="op-list">
              {establishments.map((e) => (
                <PickerItem
                  key={e.id}
                  selected={e.id === establishmentId}
                  title={e.name}
                  meta={e.address ?? undefined}
                  onSelect={() => {
                    setEstablishmentId(e.id);
                    setSectorId(null);
                  }}
                />
              ))}
            </div>
            {canEdit && (
              <QuickAdd
                label="Novo estabelecimento"
                placeholder="Nome do local"
                onCreate={async (name) => {
                  await createEstablishment(name);
                  await reload();
                }}
              />
            )}
          </Column>

          <Column title="Setores" hint="Áreas dentro do estabelecimento.">
            {!establishmentId ? (
              <p className="muted">Selecione um estabelecimento.</p>
            ) : (
              <>
                <div className="op-list">
                  {visibleSectors.length === 0 && (
                    <p className="muted">Nenhum setor neste local.</p>
                  )}
                  {visibleSectors.map((s) => (
                    <PickerItem
                      key={s.id}
                      selected={s.id === sectorId}
                      title={s.name}
                      onSelect={() => setSectorId(s.id)}
                    />
                  ))}
                </div>
                {canEdit && (
                  <QuickAdd
                    label="Novo setor"
                    placeholder="Ex.: Produção"
                    onCreate={async (name) => {
                      await createSector(establishmentId, name);
                      await reload();
                    }}
                  />
                )}
              </>
            )}
          </Column>

          <Column title="Funções" hint="Cargos que atuam no setor.">
            {!sectorId ? (
              <p className="muted">Selecione um setor.</p>
            ) : (
              <>
                <div className="op-list">
                  {visibleJobRoles.length === 0 && (
                    <p className="muted">Nenhuma função neste setor.</p>
                  )}
                  {visibleJobRoles.map((j) => (
                    <PickerItem
                      key={j.id}
                      selected={false}
                      title={j.name}
                      onSelect={() => undefined}
                    />
                  ))}
                </div>
                {canEdit && (
                  <QuickAdd
                    label="Nova função"
                    placeholder="Ex.: Operador"
                    onCreate={async (name) => {
                      await createJobRole(sectorId, name);
                      await reload();
                    }}
                  />
                )}
              </>
            )}
          </Column>

          <Column
            title="Atividades"
            hint="O que as pessoas fazem — base dos perigos."
          >
            {!sectorId ? (
              <p className="muted">Selecione um setor.</p>
            ) : (
              <>
                <div className="op-list">
                  {visibleActivities.length === 0 && (
                    <p className="muted">Nenhuma atividade neste setor.</p>
                  )}
                  {visibleActivities.map((a) => (
                    <div key={a.id} className="op-activity">
                      <strong>{a.name}</strong>
                      {a.description && (
                        <p className="muted">{a.description}</p>
                      )}
                      {a.job_role_ids.length > 0 && (
                        <p className="muted">
                          {a.job_role_ids.length}{" "}
                          {a.job_role_ids.length === 1 ? "função" : "funções"}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {canEdit && (
                  <form className="op-quick-add" onSubmit={onCreateActivity}>
                    <label className="form-field">
                      Nova atividade
                      <input
                        value={activityName}
                        onChange={(e) => setActivityName(e.target.value)}
                        placeholder="Ex.: Usinar eixo"
                        disabled={activitySaving}
                      />
                    </label>
                    <label className="form-field">
                      Como é feita (opcional)
                      <textarea
                        value={activityDescription}
                        onChange={(e) => setActivityDescription(e.target.value)}
                        disabled={activitySaving}
                      />
                    </label>
                    {visibleJobRoles.length > 0 && (
                      <fieldset className="op-jobs">
                        <legend className="muted">Quem executa</legend>
                        {visibleJobRoles.map((j) => (
                          <label key={j.id} className="op-check">
                            <input
                              type="checkbox"
                              checked={activityJobRoleIds.includes(j.id)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setActivityJobRoleIds((ids) =>
                                  checked
                                    ? [...new Set([...ids, j.id])]
                                    : ids.filter((id) => id !== j.id),
                                );
                              }}
                              disabled={activitySaving}
                            />
                            {j.name}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    {activityError && (
                      <p className="form-error">{activityError}</p>
                    )}
                    <Button type="submit" disabled={activitySaving}>
                      {activitySaving ? "Salvando…" : "Adicionar atividade"}
                    </Button>
                  </form>
                )}
              </>
            )}
          </Column>
        </div>
      )}
    </div>
  );
}
