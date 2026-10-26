import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { canCloseOccurrenceAnalysis } from "@/lib/module-access";
import {
  addOccurrenceAction,
  analyzeOccurrence,
  fetchOccurrence,
  type OccurrenceDetail,
} from "@/api/occurrences";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { Dialog } from "@/components/Dialog";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
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
  const { user } = useAuth();
  const podeAnalisar = canCloseOccurrenceAnalysis(user?.permission);
  const [row, setRow] = useState<OccurrenceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [generatingSituation, setGeneratingSituation] = useState("");
  const [organizationalData, setOrganizationalData] = useState("");
  const [preventionReview, setPreventionReview] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /*
    Nenhuma tela abria ação a partir da ocorrência: o caminho existia só no
    servidor, e "Ações vinculadas" ficava sempre vazia. [B3-4-C]
  */
  const [abrindoAcao, setAbrindoAcao] = useState(false);
  const [tituloDaAcao, setTituloDaAcao] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [prazo, setPrazo] = useState("");
  const [salvandoAcao, setSalvandoAcao] = useState(false);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);

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
        </p>
        {/*
          O risco aparecia só como texto, sem caminho para ele, para a ação
          nem para o histórico, onde se vê a reavaliação que esta análise
          pediu. [B3-4-C]
        */}
        {row.risk && (
          <p className="occ-risco">
            <strong>Risco:</strong> {row.risk.description}{" "}
            <Link to={`/inventario?risco=${row.risk.id}`}>
              abrir no inventário, com o histórico
            </Link>
          </p>
        )}
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
        ) : !podeAnalisar ? (
          /* Quem viu relata; quem responde tecnicamente analisa e encerra.
             O formulário não aparece para quem não pode encerrar. [S3-E] */
          <p className="muted">
            Análise pendente. Quem responde tecnicamente pelo SST é quem
            analisa e encerra esta ocorrência.
          </p>
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
        <p className="muted">
          {row.risk
            ? "As ações do risco ligado, abertas antes ou depois desta ocorrência."
            : "Esta ocorrência não está ligada a um risco do inventário."}
        </p>
        {podeAnalisar && (
          <div className="form-actions">
            <Button
              type="button"
              size="compact"
              variant="secondary"
              onClick={() => {
                setErroDaAcao(null);
                setTituloDaAcao("");
                setResponsavel("");
                setPrazo("");
                setAbrindoAcao(true);
              }}
            >
              Abrir ação a partir desta ocorrência
            </Button>
          </div>
        )}
        {row.actions.length === 0 ? (
          <p className="muted">Nenhuma ação para este risco, nem desta ocorrência.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ação</th>
                  <th>De onde veio</th>
                  <th>Responsável</th>
                  <th>Situação</th>
                  <th>Prazo</th>
                </tr>
              </thead>
              <tbody>
                {row.actions.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to="/acoes">{a.title}</Link>
                      <span className="muted occ-sub">
                        {ACTION_PRIORITY_LABEL[a.priority] ?? a.priority}
                      </span>
                    </td>
                    <td className="muted">
                      {a.from_occurrence ? "desta ocorrência" : "do risco"}
                    </td>
                    <td className="muted">{a.assignee?.name ?? "—"}</td>
                    <td>
                      {ACTION_STATUS_LABEL[a.status] ?? a.status}
                      {/* É a resposta a "o que mudou depois". [B3-4-C] */}
                      {a.validatedAt && (
                        <span className="muted occ-sub">
                          validada em {formatDay(a.validatedAt)}
                          {a.validatedBy ? ` por ${a.validatedBy.name}` : ""}
                        </span>
                      )}
                    </td>
                    <td>{formatDay(a.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {abrindoAcao && (
        <Dialog
          title="Abrir ação a partir desta ocorrência"
          description="A ação entra no Plano de ação ligada a esta ocorrência e ao risco dela. Responsável e prazo são obrigatórios."
          onClose={() => setAbrindoAcao(false)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!id) return;
              setSalvandoAcao(true);
              setErroDaAcao(null);
              try {
                await addOccurrenceAction(id, {
                  title: tituloDaAcao.trim(),
                  assignee_id: responsavel,
                  due_date: prazo,
                  priority: "HIGH",
                });
                setAbrindoAcao(false);
                await load();
              } catch (err) {
                setErroDaAcao(
                  err instanceof Error ? err.message : "Falha ao abrir a ação",
                );
              } finally {
                setSalvandoAcao(false);
              }
            }}
          >
            <label className="form-field">
              O que será feito
              <input
                value={tituloDaAcao}
                onChange={(e) => setTituloDaAcao(e.target.value)}
                placeholder="Ex.: Instalar proteção com intertravamento"
                disabled={salvandoAcao}
                required
              />
            </label>
            <label className="form-field">
              Responsável
              <PeoplePicker
                value={responsavel}
                onChange={(quem) => setResponsavel(quem)}
                disabled={salvandoAcao}
                required
              />
            </label>
            <label className="form-field">
              Prazo
              <input
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
                disabled={salvandoAcao}
                required
              />
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
                  salvandoAcao || !tituloDaAcao.trim() || !responsavel || !prazo
                }
              >
                {salvandoAcao ? "Abrindo…" : "Abrir ação"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
