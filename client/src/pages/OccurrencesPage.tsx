import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import {
  createOccurrence,
  fetchOccurrences,
  type OccurrenceRow,
} from "@/api/occurrences";
import { fetchRisks, type RiskOption } from "@/api/risks";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { formatDay, OCCURRENCE_TYPE_LABEL } from "@/lib/labels";
import "@/components/data-table.css";
import "@/components/form.css";

const TYPE_HINT: Record<string, string> = {
  ACCIDENT: "Alguém se machucou durante o trabalho, com ou sem afastamento.",
  OCCUPATIONAL_DISEASE: "Adoecimento ligado ao trabalho ou ao ambiente.",
  DANGEROUS_EVENT:
    "Ninguém se feriu, mas poderia ter sido grave. A NR-1 manda analisar do mesmo jeito.",
};

function typeTone(type: string): "danger" | "warning" | "neutral" {
  switch (type) {
    case "ACCIDENT":
      return "danger";
    case "OCCUPATIONAL_DISEASE":
      return "warning";
    default:
      return "neutral";
  }
}

function isAnalyzed(row: OccurrenceRow): boolean {
  return Boolean(
    row.analyzedAt &&
      row.generatingSituation &&
      row.organizationalData &&
      row.preventionReview,
  );
}

export function OccurrencesPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<OccurrenceRow[]>([]);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [risks, setRisks] = useState<RiskOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);

  const [formType, setFormType] = useState("ACCIDENT");
  const [occurredAt, setOccurredAt] = useState("");
  const [description, setDescription] = useState("");
  const [establishmentId, setEstablishmentId] = useState("");
  const [riskId, setRiskId] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await fetchOccurrences(
      typeFilter ? { type: typeFilter } : undefined,
    );
    setRows(data.occurrences);
  }, [typeFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      reload(),
      fetchEstablishments(),
      fetchRisks().catch(() => ({ risks: [] as RiskOption[] })),
    ])
      .then(([, est, riskData]) => {
        if (cancelled) return;
        setEstablishments(est.establishments);
        setRisks(riskData.risks);
      })
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

  const filtered = useMemo(() => {
    if (!pendingOnly) return rows;
    return rows.filter((r) => !isAnalyzed(r));
  }, [rows, pendingOnly]);

  const pendingCount = rows.filter((r) => !isAnalyzed(r)).length;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!occurredAt) {
      setFormError("Informe a data.");
      return;
    }
    if (description.trim().length < 3) {
      setFormError("Conte o que aconteceu.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const data = await createOccurrence({
        type: formType,
        description: description.trim(),
        occurredAt,
        establishmentId: establishmentId || undefined,
        riskId: riskId || undefined,
      });
      navigate(`/ocorrencias/${data.occurrence.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao salvar");
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Ocorrências"
        description="Registre o que aconteceu e, depois, escreva a análise. Vale também para o susto que não machucou ninguém."
      />

      {pendingCount > 0 && (
        <p
          className="filter-meta"
          style={{ color: "var(--sem-danger-fg)", fontWeight: 600 }}
        >
          {pendingCount}{" "}
          {pendingCount === 1
            ? "ocorrência ainda sem análise"
            : "ocorrências ainda sem análise"}
          .
        </p>
      )}

      <section className="form-section">
        <h2>Registrar ocorrência</h2>
        <p className="muted">
          Registre rápido com o que se sabe agora. A análise completa fica na
          tela da ocorrência.
        </p>
        <form className="form-grid" onSubmit={onSubmit}>
          <div className="form-grid cols-2">
            <label className="form-field">
              O que foi
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                disabled={saving}
              >
                {Object.entries(OCCURRENCE_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="form-hint">{TYPE_HINT[formType]}</span>
            </label>
            <label className="form-field">
              Quando aconteceu
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                disabled={saving}
                required
              />
            </label>
          </div>
          <label className="form-field">
            O que aconteceu
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
              required
              placeholder="Descreva o fato com o que se sabe agora."
            />
          </label>
          <div className="form-grid cols-2">
            <label className="form-field">
              Estabelecimento (opcional)
              <select
                value={establishmentId}
                onChange={(e) => setEstablishmentId(e.target.value)}
                disabled={saving}
              >
                <option value="">—</option>
                {establishments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Risco relacionado (opcional)
              <select
                value={riskId}
                onChange={(e) => setRiskId(e.target.value)}
                disabled={saving}
              >
                <option value="">—</option>
                {risks.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.description}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {formError && <p className="form-error">{formError}</p>}
          <div className="form-actions">
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Registrar"}
            </Button>
          </div>
        </form>
      </section>

      <div className="filter-bar">
        <button
          type="button"
          className={`filter-toggle${pendingOnly ? " is-active" : ""}`}
          onClick={() => setPendingOnly((v) => !v)}
        >
          Sem análise
        </button>
        <label
          className="muted"
          style={{ marginLeft: "auto", fontSize: "0.8rem" }}
        >
          Tipo{" "}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filtrar por tipo"
          >
            <option value="">Todos</option>
            {Object.entries(OCCURRENCE_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!loading && !error && (
        <p className="filter-meta muted">
          <span>{filtered.length}</span>{" "}
          {filtered.length === 1 ? "ocorrência" : "ocorrências"}
        </p>
      )}

      {loading && <p className="muted">Carregando ocorrências…</p>}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          title="Nenhuma ocorrência neste filtro"
          description="Use o formulário acima para registrar a primeira."
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Tipo</th>
                <th>Descrição</th>
                <th>Local</th>
                <th>Análise</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const analyzed = isAnalyzed(row);
                return (
                  <tr key={row.id} className="is-clickable">
                    <td>
                      <Link to={`/ocorrencias/${row.id}`}>
                        {formatDay(row.occurredAt)}
                      </Link>
                    </td>
                    <td>
                      <Chip tone={typeTone(row.type)}>
                        {OCCURRENCE_TYPE_LABEL[row.type] ?? row.type}
                      </Chip>
                    </td>
                    <td>
                      {row.description.length > 140
                        ? `${row.description.slice(0, 140)}…`
                        : row.description}
                      <div className="muted" style={{ marginTop: "0.2rem" }}>
                        {row.reportedBy.name}
                      </div>
                    </td>
                    <td className="muted">
                      {row.establishment?.name ?? "—"}
                    </td>
                    <td>
                      {analyzed ? (
                        <Chip tone="success">Analisada</Chip>
                      ) : (
                        <Chip tone="warning">Pendente</Chip>
                      )}
                    </td>
                    <td className="muted">
                      {row._count.actions} · {row._count.evidences} ev.
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
