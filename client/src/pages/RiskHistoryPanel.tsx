import { useEffect, useState } from "react";
import { fetchRiskHistory, type RiskHistory } from "@/api/inventory";
import { AUDIT_ACTION_LABEL } from "@/api/inspection";
import { Chip } from "@/components/Chip";
import { describeChange } from "@/lib/historico-do-risco";
import {
  ACTION_STATUS_LABEL,
  CONTROL_STATUS_LABEL,
  CONTROL_TYPE_LABEL,
  formatDay,
  RISK_LEVEL_LABEL,
} from "@/lib/labels";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Nome do que aconteceu, a partir da ação gravada na trilha.
 *
 * Só as mudanças de Operação tinham nome em português; o resto saía como
 * "assessment.validate". A lista é a mesma do Histórico do painel, com as
 * poucas que só aparecem aqui. [B2-4-E] [B2-1-C]
 */
const CHANGE_LABEL: Record<string, string> = {
  ...AUDIT_ACTION_LABEL,
  "change_event.create": "Mudança registrada na operação",
};

function levelTone(level: string | null) {
  if (!level) return "neutral" as const;
  const key = `risk-${level.toLowerCase()}`;
  const known = [
    "risk-trivial",
    "risk-tolerable",
    "risk-moderate",
    "risk-substantial",
    "risk-intolerable",
  ];
  return (known.includes(key) ? key : "neutral") as
    | "risk-trivial"
    | "risk-tolerable"
    | "risk-moderate"
    | "risk-substantial"
    | "risk-intolerable"
    | "neutral";
}

/**
 * Tudo o que aconteceu com um risco: de onde ele vem, as avaliações (inclusive
 * as substituídas), os controles, as ações e as mudanças na operação. [S2-N]
 */
export function RiskHistoryPanel({ riskId }: { riskId: string }) {
  const [data, setData] = useState<RiskHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetchRiskHistory(riskId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
      });
    return () => {
      cancelled = true;
    };
  }, [riskId]);

  if (error) {
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  }
  if (!data) return <p className="muted">Carregando histórico…</p>;

  const { risk, assessments, controls, actions, changes } = data;
  const current = assessments.find((a) => a.status === "VALIDATED" && !a.supersededAt);

  return (
    <div className="risk-history">
      <div className="risk-history-head">
        <div>
          <h3>{risk.description}</h3>
          <p className="muted">
            {risk.hazard.description} · {risk.hazard.establishment} · {risk.hazard.sector} ·{" "}
            {risk.hazard.activity}
          </p>
        </div>
        {current && (
          <Chip tone={levelTone(current.level)}>{RISK_LEVEL_LABEL[current.level] ?? current.level}</Chip>
        )}
      </div>

      {risk.needsReassessment && (
        <p className="risk-history-flag">
          Precisa de nova avaliação{risk.reassessmentReason ? `: ${risk.reassessmentReason}` : "."}
        </p>
      )}

      <section>
        <h4>Avaliações</h4>
        {assessments.length === 0 ? (
          <p className="muted">Nenhuma avaliação registrada.</p>
        ) : (
          <ol className="risk-history-list">
            {assessments.map((a) => (
              <li key={a.id} className={a.supersededAt ? "is-past" : undefined}>
                <div className="risk-history-row">
                  <Chip tone={levelTone(a.level)}>{RISK_LEVEL_LABEL[a.level] ?? a.level}</Chip>
                  <span>
                    Severidade {a.severity} · Probabilidade {a.probability}
                  </span>
                  <span className="muted">{a.methodology}</span>
                  {a.supersededAt && <span className="muted">substituída em {formatDay(a.supersededAt)}</span>}
                  {a.status === "DRAFT" && <Chip tone="warning">Rascunho</Chip>}
                </div>
                <p className="muted">
                  Avaliado por {a.assessor.name} em {formatDay(a.assessedAt)}
                  {a.validatedBy && a.validatedAt
                    ? ` · validado por ${a.validatedBy.name} em ${formatDay(a.validatedAt)}`
                    : " · ainda não validado"}
                  {a.expiresAt ? ` · revisar até ${formatDay(a.expiresAt)}` : ""}
                </p>
                {/*
                  Os três porquês saíam unidos por "·", sem nome: quem lia
                  tinha de deduzir qual era qual — e, se um faltasse, a ordem
                  deixava de dizer. [B2-2-B]
                */}
                {(a.severityReason || a.probabilityReason || a.controlsConsidered) && (
                  <dl className="risk-history-why">
                    {a.severityReason && (
                      <div>
                        <dt>Por que esta severidade</dt>
                        <dd>{a.severityReason}</dd>
                      </div>
                    )}
                    {a.probabilityReason && (
                      <div>
                        <dt>Por que esta probabilidade</dt>
                        <dd>{a.probabilityReason}</dd>
                      </div>
                    )}
                    {a.controlsConsidered && (
                      <div>
                        <dt>Medidas consideradas na avaliação</dt>
                        <dd>{a.controlsConsidered}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h4>Medidas de prevenção</h4>
        {controls.length === 0 ? (
          <p className="muted">Nenhuma medida registrada.</p>
        ) : (
          <ul className="risk-history-list">
            {controls.map((c) => (
              <li key={c.id}>
                <div className="risk-history-row">
                  <strong>{c.description}</strong>
                  <Chip>{CONTROL_TYPE_LABEL[c.type] ?? c.type}</Chip>
                  <Chip tone={c.status === "IMPLEMENTED" ? "success" : "warning"}>
                    {CONTROL_STATUS_LABEL[c.status] ?? c.status}
                  </Chip>
                  {c.implementedAt && <span className="muted">desde {formatDay(c.implementedAt)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4>Ações</h4>
        {actions.length === 0 ? (
          <p className="muted">Nenhuma ação aberta para este risco.</p>
        ) : (
          <ul className="risk-history-list">
            {actions.map((a) => (
              <li key={a.id}>
                <div className="risk-history-row">
                  <strong>{a.title}</strong>
                  <Chip tone={a.status === "VALIDATED" || a.status === "CLOSED" ? "success" : "info"}>
                    {ACTION_STATUS_LABEL[a.status] ?? a.status}
                  </Chip>
                  {a.dueDate && <span className="muted">prazo {formatDay(a.dueDate)}</span>}
                  {a.assignee && <span className="muted">{a.assignee.name}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        {/*
          A lista junta o que aconteceu com o risco (perigo, avaliação,
          validação, medida, ação) e o que mudou na operação. O título
          anterior prometia só a segunda metade. [B2-4-E]
        */}
        <h4>Tudo o que aconteceu com este risco</h4>
        <p className="muted">
          Na ordem em que foi gravado, com quem fez e quando.
        </p>
        {changes.length === 0 ? (
          <p className="muted">Nada registrado.</p>
        ) : (
          <ul className="risk-history-list">
            {changes.map((c) => {
              const details = describeChange(c.before, c.after);
              return (
                <li key={c.id}>
                  <div className="risk-history-row">
                    <strong>{CHANGE_LABEL[c.action] ?? c.action}</strong>
                    <span className="muted">
                      {c.actor?.name ?? "—"} · {formatDateTime(c.createdAt)}
                    </span>
                  </div>
                  {details.length > 0 && <p className="muted">{details.join(" · ")}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
