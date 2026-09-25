import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  analyzeOccurrence,
  fetchOccurrence,
  type OccurrenceDetail,
} from "@/api/occurrences";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import {
  ACTION_PRIORITY_LABEL,
  ACTION_STATUS_LABEL,
  formatDay,
  OCCURRENCE_TYPE_LABEL,
} from "@/lib/labels";
import "@/components/data-table.css";
import "@/components/form.css";
import "./occurrence-detail.css";
import { LoadingState } from "@/components/LoadingState";

export function OccurrenceDetailPage() {
  const { id } = useParams();
  const [row, setRow] = useState<OccurrenceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [generatingSituation, setGeneratingSituation] = useState("");
  const [organizationalData, setOrganizationalData] = useState("");
  const [preventionReview, setPreventionReview] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const data = await fetchOccurrence(id);
    setRow(data.occurrence);
    setGeneratingSituation(data.occurrence.generatingSituation ?? "");
    setOrganizationalData(data.occurrence.organizationalData ?? "");
    setPreventionReview(data.occurrence.preventionReview ?? "");
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
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
  }, [load]);

  async function onAnalyze(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    if (
      generatingSituation.trim().length < 3 ||
      organizationalData.trim().length < 3 ||
      preventionReview.trim().length < 3
    ) {
      setFormError("Preencha os três campos da análise (NR-1 1.5.5.5).");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await analyzeOccurrence(id, {
        generatingSituation: generatingSituation.trim(),
        organizationalData: organizationalData.trim(),
        preventionReview: preventionReview.trim(),
      });
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Carregando ocorrência…" />;
  if (error) {
    return (
      <p className="page-error" role="alert">
        {error}
      </p>
    );
  }
  if (!row) {
    return (
      <EmptyState
        title="Ocorrência não encontrada"
        description="Ela pode ter sido removida ou não pertence a esta conta."
        action={
          <Link to="/ocorrencias" className="filter-toggle">
            Voltar à lista
          </Link>
        }
      />
    );
  }

  const analyzed = Boolean(
    row.analyzedAt &&
      row.generatingSituation &&
      row.organizationalData &&
      row.preventionReview,
  );

  return (
    <div>
      <p className="occ-back">
        <Link to="/ocorrencias">← Ocorrências</Link>
      </p>
      <PageHeader
        title={OCCURRENCE_TYPE_LABEL[row.type] ?? row.type}
        description={formatDay(row.occurredAt)}
        actions={
          analyzed ? (
            <Chip tone="success">Analisada</Chip>
          ) : (
            <Chip tone="warning">Análise pendente</Chip>
          )
        }
      />

      <section className="occ-block">
        <h2>O que aconteceu</h2>
        <p>{row.description}</p>
        <p className="muted">
          Registrado por {row.reportedBy.name}
          {row.establishment ? ` · ${row.establishment.name}` : ""}
          {row.risk ? ` · Risco: ${row.risk.description}` : ""}
        </p>
      </section>

      <section className="occ-block">
        <h2>Análise (NR-1 1.5.5.5)</h2>
        {analyzed ? (
          <>
            <dl className="occ-dl">
              <div>
                <dt>Situações geradoras</dt>
                <dd>{row.generatingSituation}</dd>
              </div>
              <div>
                <dt>Dados organizacionais</dt>
                <dd>{row.organizationalData}</dd>
              </div>
              <div>
                <dt>Revisão das medidas</dt>
                <dd>{row.preventionReview}</dd>
              </div>
            </dl>
            {row.analyzedBy && row.analyzedAt && (
              <p className="muted">
                Analisado por {row.analyzedBy.name} em{" "}
                {formatDay(row.analyzedAt)}
              </p>
            )}
          </>
        ) : (
          <form className="form-grid" onSubmit={onAnalyze}>
            <p className="muted" style={{ margin: 0 }}>
              A fiscalização procura a análise escrita: o que gerou o problema e
              o que muda nas medidas de prevenção.
            </p>
            <label className="form-field">
              Situações geradoras (atividade, ambiente, organização do trabalho)
              <textarea
                value={generatingSituation}
                onChange={(e) => setGeneratingSituation(e.target.value)}
                disabled={saving}
                required
              />
            </label>
            <label className="form-field">
              Dados organizacionais / epidemiológicos / relatos
              <textarea
                value={organizationalData}
                onChange={(e) => setOrganizationalData(e.target.value)}
                disabled={saving}
                required
              />
            </label>
            <label className="form-field">
              Revisão e aprimoramento das medidas existentes
              <textarea
                value={preventionReview}
                onChange={(e) => setPreventionReview(e.target.value)}
                disabled={saving}
                required
              />
            </label>
            {formError && <p className="form-error">{formError}</p>}
            <div className="form-actions">
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando…" : "Registrar análise"}
              </Button>
            </div>
          </form>
        )}
      </section>

      <section className="occ-block">
        <h2>Ações vinculadas</h2>
        {row.actions.length === 0 ? (
          <p className="muted">Nenhuma ação gerada a partir desta ocorrência.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ação</th>
                  <th>Prioridade</th>
                  <th>Situação</th>
                  <th>Prazo</th>
                </tr>
              </thead>
              <tbody>
                {row.actions.map((a) => (
                  <tr key={a.id}>
                    <td>{a.title}</td>
                    <td>{ACTION_PRIORITY_LABEL[a.priority] ?? a.priority}</td>
                    <td>{ACTION_STATUS_LABEL[a.status] ?? a.status}</td>
                    <td>{formatDay(a.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
